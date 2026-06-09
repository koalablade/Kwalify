/**
 * Purpose: CRUD routes for saved playlists — list, share, feedback, delete.
 * Responsibilities:
 *   - GET /playlists        — return saved playlists for the authenticated user
 *   - GET /share/:id        — return a playlist by id for the public share page
 *   - POST /playlists/:id/feedback — record a thumbs-up/neutral/down reaction
 *   - DELETE /playlists/:id — delete a playlist owned by the authenticated user
 * Dependencies: drizzle-orm, db (saved_playlists, playlist_feedback tables)
 */
import { Router, type IRouter } from "express";
import { db } from "../db";
import {
  likedSongsTable,
  playlistFeedbackTable,
  savedPlaylistsTable,
} from "../db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { onTrackRemoved, onTrackSave, onTrackSkip, type FeedbackTrack } from "../lib/feedback-memory";
import { markGenerateResultCacheStale } from "../lib/generate-result-cache";

const router: IRouter = Router();

const FeedbackTrackSchema = z.object({
  trackId: z.string().min(1),
  trackName: z.string().nullable().optional(),
  artistId: z.string().nullable().optional(),
  artistName: z.string().nullable().optional(),
  albumId: z.string().nullable().optional(),
  albumName: z.string().nullable().optional(),
  genrePrimary: z.string().nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  energy: z.number().nullable().optional(),
});

const TrackFeedbackBodySchema = z.object({
  trackId: z.string().min(1).optional(),
  action: z.enum(["skip", "remove", "save", "like", "dislike"]),
  playlistId: z.string().optional(),
  context: z.object({ vibe: z.string().optional() }).passthrough().optional(),
  vibe: z.string().optional(),
  bridgeGenre: z.string().optional(),
  track: FeedbackTrackSchema.partial().optional(),
}).passthrough();

const ImplicitFeedbackBodySchema = z.object({
  trackId: z.string().min(1),
  playDuration: z.number().min(0).max(60 * 60 * 6).default(0),
  skipped: z.boolean().optional(),
  sessionId: z.string().min(1).max(120),
  trackName: z.string().nullable().optional(),
  artistId: z.string().nullable().optional(),
  artistName: z.string().nullable().optional(),
  albumId: z.string().nullable().optional(),
  albumName: z.string().nullable().optional(),
  genrePrimary: z.string().nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  energy: z.number().nullable().optional(),
}).passthrough();

const ReplaceTrackBodySchema = z.object({
  trackId: z.string().min(1),
  vibe: z.string().optional(),
});

function trackFromPayload(trackId: string, payload: Record<string, unknown>, bodyTrack: Partial<FeedbackTrack> | undefined): FeedbackTrack {
  return {
    trackId,
    trackName: bodyTrack?.trackName ?? (typeof payload.trackName === "string" ? payload.trackName : null),
    artistId: bodyTrack?.artistId ?? (typeof payload.artistId === "string" ? payload.artistId : null),
    artistName: bodyTrack?.artistName ?? (typeof payload.artistName === "string" ? payload.artistName : null),
    albumId: bodyTrack?.albumId ?? (typeof payload.albumId === "string" ? payload.albumId : null),
    albumName: bodyTrack?.albumName ?? (typeof payload.albumName === "string" ? payload.albumName : null),
    genrePrimary: bodyTrack?.genrePrimary ?? (typeof payload.genrePrimary === "string" ? payload.genrePrimary : null),
    genres: bodyTrack?.genres ?? (Array.isArray(payload.genres) ? payload.genres.filter((value): value is string => typeof value === "string") : null),
    energy: bodyTrack?.energy ?? (typeof payload.energy === "number" ? payload.energy : null),
  };
}

async function isOwnedPlaylist(userId: string, playlistId: string | undefined): Promise<boolean> {
  if (!playlistId) return true;
  const numericId = Number(playlistId);
  if (!Number.isInteger(numericId)) return false;
  const rows = await db
    .select({ id: savedPlaylistsTable.id })
    .from(savedPlaylistsTable)
    .where(and(eq(savedPlaylistsTable.id, numericId), eq(savedPlaylistsTable.userId, userId)))
    .limit(1);
  return !!rows[0];
}

function feedbackTracks(value: unknown): FeedbackTrack[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((track) => {
      if (!track || typeof track !== "object") return null;
      const t = track as Record<string, unknown>;
      const trackId = typeof t["trackId"] === "string"
        ? t["trackId"]
        : typeof t["id"] === "string"
          ? t["id"]
          : null;
      if (!trackId) return null;
      return {
        trackId,
        artistName: typeof t["artistName"] === "string" ? t["artistName"] : typeof t["artist"] === "string" ? t["artist"] : null,
        genrePrimary: typeof t["genrePrimary"] === "string" ? t["genrePrimary"] : null,
        energy: typeof t["energy"] === "number" ? t["energy"] : null,
      };
    })
    .filter((track): track is FeedbackTrack => !!track);
}

function trackGenreTerms(track: Record<string, unknown>): string[] {
  const rawGenres = [
    track["genrePrimary"],
    ...(Array.isArray(track["genres"]) ? track["genres"] : []),
    ...(Array.isArray(track["spotifyArtistGenres"]) ? track["spotifyArtistGenres"] : []),
    ...(Array.isArray(track["albumGenres"]) ? track["albumGenres"] : []),
  ];
  return rawGenres
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
}

function formatReplacementTrack(row: typeof likedSongsTable.$inferSelect): Record<string, unknown> {
  const spotifyGenres = Array.isArray(row.spotifyArtistGenres) ? row.spotifyArtistGenres.filter((value): value is string => typeof value === "string") : [];
  const albumGenres = Array.isArray(row.albumGenres) ? row.albumGenres.filter((value): value is string => typeof value === "string") : [];
  return {
    id: row.trackId,
    trackId: row.trackId,
    name: row.trackName,
    trackName: row.trackName,
    artist: row.artistName,
    artistName: row.artistName,
    album: row.albumName,
    albumName: row.albumName,
    albumArt: row.albumArt ?? null,
    durationMs: row.durationMs,
    energy: row.energy ?? null,
    valence: row.valence ?? null,
    tempo: row.tempo ?? null,
    genrePrimary: spotifyGenres[0] ?? albumGenres[0] ?? null,
    genres: [...new Set([...spotifyGenres, ...albumGenres])].slice(0, 8),
    replacement: true,
  };
}

function scoreReplacementCandidate(
  row: typeof likedSongsTable.$inferSelect,
  removedTrack: Record<string, unknown>,
  usedTrackIds: Set<string>,
): number {
  if (usedTrackIds.has(row.trackId)) return -Infinity;
  let score = 0;
  const removedGenres = new Set(trackGenreTerms(removedTrack));
  const candidateGenres = trackGenreTerms(row as unknown as Record<string, unknown>);
  if (candidateGenres.some((genre) => removedGenres.has(genre))) score += 4;
  if (row.artistName === removedTrack["artistName"] || row.artistName === removedTrack["artist"]) score += 1;
  const removedEnergy = typeof removedTrack["energy"] === "number" ? removedTrack["energy"] : null;
  if (removedEnergy != null && row.energy != null) score += 1 - Math.min(1, Math.abs(row.energy - removedEnergy));
  if (typeof row.popularity === "number") score += Math.max(0, 1 - Math.abs(row.popularity - 58) / 100);
  return score;
}

router.get("/playlists", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  try {
    const playlists = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.userId, userId))
      .orderBy(desc(savedPlaylistsTable.createdAt));

    res.json({
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        emotionProfile: p.emotionProfile ?? null,
        tracks: p.tracks ?? [],
        createdAt: p.createdAt.toISOString(),
        spotifyUrl: p.spotifyUrl ?? null,
        vibe: p.vibe ?? null,
        mode: p.mode ?? null,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching playlists");
    res.status(500).json({ error: "Failed to fetch playlists." });
  }
});

router.get("/share/:id", async (req, res): Promise<void> => {
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.id, playlistId))
      .limit(1);
    const playlist = rows[0];
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }
    const ep = (playlist.emotionProfile ?? {}) as {
      journeyArc?: string;
      librarySize?: number;
      timeOfDay?: string | null;
      environment?: string | null;
      nostalgia?: number;
      calm?: number;
    };
    res.json({
      id: playlist.id,
      name: playlist.name,
      vibe: playlist.vibe ?? null,
      mode: playlist.mode ?? null,
      emotionProfile: playlist.emotionProfile ?? null,
      journeyArc: ep.journeyArc ?? null,
      librarySize: ep.librarySize ?? null,
      tracks: playlist.tracks ?? [],
      trackCount: Array.isArray(playlist.tracks) ? playlist.tracks.length : 0,
      spotifyUrl: playlist.spotifyUrl ?? null,
      createdAt: playlist.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch playlist." });
  }
});

router.post("/playlists/:id/feedback", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }

  const reaction = String(req.body?.reaction ?? "").trim();
  if (!["up", "neutral", "down"].includes(reaction)) {
    res.status(400).json({ error: "Invalid reaction. Use up, neutral, or down." });
    return;
  }

  const vibe = String(req.body?.vibe ?? "").trim().slice(0, 200);
  if (!vibe) {
    res.status(400).json({ error: "Vibe is required for feedback." });
    return;
  }

  try {
    const owned = await db
      .select({ id: savedPlaylistsTable.id, tracks: savedPlaylistsTable.tracks })
      .from(savedPlaylistsTable)
      .where(
        and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId))
      )
      .limit(1);
    if (!owned[0]) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    await db
      .delete(playlistFeedbackTable)
      .where(
        and(
          eq(playlistFeedbackTable.playlistId, playlistId),
          eq(playlistFeedbackTable.userId, userId)
        )
      );
    await db.insert(playlistFeedbackTable).values({ playlistId, userId, vibe, reaction });
    if (reaction === "down") {
      for (const track of feedbackTracks(owned[0].tracks).slice(0, 50)) {
        await onTrackRemoved(userId, track, { mood: vibe });
      }
      markGenerateResultCacheStale(userId, vibe);
    }

    req.log.info({ userId, playlistId, reaction }, "Playlist feedback recorded");
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error saving playlist feedback");
    res.status(500).json({ error: "Failed to save feedback." });
  }
});

router.post("/feedback/track", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const parsed = TrackFeedbackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid track feedback payload.", details: parsed.error.message });
    return;
  }
  const action = parsed.data.action;
  const trackId = parsed.data.trackId ?? parsed.data.track?.trackId;
  const track = trackFromPayload(trackId ?? "", parsed.data as Record<string, unknown>, parsed.data.track);
  if (!track.trackId) {
    res.status(400).json({ error: "trackId is required." });
    return;
  }
  if (!(await isOwnedPlaylist(userId, parsed.data.playlistId))) {
    res.status(403).json({ error: "Playlist feedback can only update the owner's taste memory." });
    return;
  }

  try {
    const memory = action === "save" || action === "like"
      ? await onTrackSave(userId, track)
      : action === "skip"
        ? await onTrackSkip(userId, track)
        : await onTrackRemoved(userId, track, {
            mood: typeof req.body?.vibe === "string"
              ? req.body.vibe
              : typeof parsed.data.context?.vibe === "string"
                ? parsed.data.context.vibe
                : null,
            bridgeGenre: parsed.data.bridgeGenre ?? null,
          });
    markGenerateResultCacheStale(userId, parsed.data.playlistId);
    res.json({ success: true, feedbackMemory: memory });
  } catch (err: any) {
    req.log.error({ err }, "Error saving track feedback memory");
    res.status(500).json({ error: "Failed to save track feedback." });
  }
});

router.post("/feedback/implicit", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const parsed = ImplicitFeedbackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid implicit feedback payload.", details: parsed.error.message });
    return;
  }
  const playDuration = parsed.data.playDuration;
  const skipped = parsed.data.skipped === true || playDuration > 0 && playDuration < 30;

  try {
    const track = trackFromPayload(parsed.data.trackId, parsed.data as Record<string, unknown>, parsed.data);
    const memory = skipped
      ? await onTrackSkip(userId, track, playDuration > 0 && playDuration < 30 ? 2 : 1)
      : await onTrackSave(userId, track, 0.25);
    markGenerateResultCacheStale(userId, parsed.data.sessionId);
    res.json({ success: true, inferred: skipped ? "skip" : "listen", feedbackMemory: memory });
  } catch (err: any) {
    req.log.error({ err }, "Error saving implicit feedback");
    res.status(500).json({ error: "Failed to save implicit feedback." });
  }
});

router.post("/playlists/:id/replace-track", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }
  const parsed = ReplaceTrackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid replace payload.", details: parsed.error.message });
    return;
  }

  try {
    const owned = await db
      .select({ id: savedPlaylistsTable.id, tracks: savedPlaylistsTable.tracks, vibe: savedPlaylistsTable.vibe })
      .from(savedPlaylistsTable)
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)))
      .limit(1);
    const playlist = owned[0];
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    const tracks = Array.isArray(playlist.tracks) ? [...playlist.tracks] as Record<string, unknown>[] : [];
    const removeIndex = tracks.findIndex((track) => track["trackId"] === parsed.data.trackId || track["id"] === parsed.data.trackId);
    if (removeIndex < 0) {
      res.status(404).json({ error: "Track not found in playlist." });
      return;
    }
    const removedTrack = tracks[removeIndex];
    await onTrackRemoved(userId, {
      trackId: parsed.data.trackId,
      trackName: typeof removedTrack["trackName"] === "string" ? removedTrack["trackName"] : typeof removedTrack["name"] === "string" ? removedTrack["name"] : null,
      artistName: typeof removedTrack["artistName"] === "string" ? removedTrack["artistName"] : typeof removedTrack["artist"] === "string" ? removedTrack["artist"] : null,
      albumName: typeof removedTrack["albumName"] === "string" ? removedTrack["albumName"] : typeof removedTrack["album"] === "string" ? removedTrack["album"] : null,
      genrePrimary: typeof removedTrack["genrePrimary"] === "string" ? removedTrack["genrePrimary"] : null,
      genres: Array.isArray(removedTrack["genres"]) ? removedTrack["genres"].filter((value): value is string => typeof value === "string") : null,
      energy: typeof removedTrack["energy"] === "number" ? removedTrack["energy"] : null,
    }, { mood: parsed.data.vibe ?? playlist.vibe ?? null });

    const usedTrackIds = new Set(tracks.map((track) => String(track["trackId"] ?? track["id"] ?? "")));
    const library = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    const replacementRow = library
      .map((row) => ({ row, score: scoreReplacementCandidate(row, removedTrack, usedTrackIds) }))
      .sort((a, b) => b.score - a.score)[0]?.row;
    if (!replacementRow) {
      res.status(404).json({ error: "No replacement candidate found." });
      return;
    }
    const replacement = formatReplacementTrack(replacementRow);
    tracks[removeIndex] = replacement;

    await db
      .update(savedPlaylistsTable)
      .set({ tracks })
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)));
    markGenerateResultCacheStale(userId, String(playlistId));
    req.log.info({ userId, playlistId, removedTrackId: parsed.data.trackId, replacementTrackId: replacementRow.trackId }, "Playlist track replaced");
    res.json({ success: true, removedTrackId: parsed.data.trackId, replacement });
  } catch (err: any) {
    req.log.error({ err }, "Error replacing playlist track");
    res.status(500).json({ error: "Failed to replace track." });
  }
});

router.delete("/playlists/:id", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);

  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }

  try {
    const deleted = await db
      .delete(savedPlaylistsTable)
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)))
      .returning({ id: savedPlaylistsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error deleting playlist");
    res.status(500).json({ error: "Failed to delete playlist." });
  }
});

export default router;
