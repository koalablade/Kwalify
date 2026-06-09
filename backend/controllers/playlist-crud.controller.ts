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
  playlistFeedbackTable,
  savedPlaylistsTable,
} from "../db";
import { eq, desc, and } from "drizzle-orm";
import { onTrackRemoved, onTrackSave, onTrackSkip, type FeedbackTrack } from "../lib/feedback-memory";
import { markGenerateResultCacheStale } from "../lib/generate-result-cache";

const router: IRouter = Router();

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
  const action = String(req.body?.action ?? "").trim();
  const bodyTrack = req.body?.track as FeedbackTrack | undefined;
  const trackId = typeof req.body?.trackId === "string" ? req.body.trackId : bodyTrack?.trackId;
  const track: FeedbackTrack | undefined = trackId
    ? {
        trackId,
        trackName: bodyTrack?.trackName ?? (typeof req.body?.trackName === "string" ? req.body.trackName : null),
        artistId: bodyTrack?.artistId ?? (typeof req.body?.artistId === "string" ? req.body.artistId : null),
        artistName: bodyTrack?.artistName ?? (typeof req.body?.artistName === "string" ? req.body.artistName : null),
        albumId: bodyTrack?.albumId ?? (typeof req.body?.albumId === "string" ? req.body.albumId : null),
        albumName: bodyTrack?.albumName ?? (typeof req.body?.albumName === "string" ? req.body.albumName : null),
        genrePrimary: bodyTrack?.genrePrimary ?? (typeof req.body?.genrePrimary === "string" ? req.body.genrePrimary : null),
        genres: bodyTrack?.genres ?? (Array.isArray(req.body?.genres) ? req.body.genres : null),
        energy: bodyTrack?.energy ?? (typeof req.body?.energy === "number" ? req.body.energy : null),
      }
    : undefined;
  if (!track?.trackId || !["remove", "skip", "save", "like", "dislike"].includes(action)) {
    res.status(400).json({ error: "Expected action skip, remove, save, like, or dislike and a track payload." });
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
              : typeof req.body?.context?.vibe === "string"
                ? req.body.context.vibe
                : null,
            bridgeGenre: typeof req.body?.bridgeGenre === "string" ? req.body.bridgeGenre : null,
          });
    markGenerateResultCacheStale(userId, typeof req.body?.playlistId === "string" ? req.body.playlistId : undefined);
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
  const trackId = String(req.body?.trackId ?? "").trim();
  const playDuration = Number(req.body?.playDuration ?? 0);
  const skipped = !!req.body?.skipped || playDuration > 0 && playDuration < 30;
  if (!trackId) {
    res.status(400).json({ error: "trackId is required." });
    return;
  }

  try {
    const track: FeedbackTrack = {
      trackId,
      trackName: typeof req.body?.trackName === "string" ? req.body.trackName : null,
      artistId: typeof req.body?.artistId === "string" ? req.body.artistId : null,
      artistName: typeof req.body?.artistName === "string" ? req.body.artistName : null,
      albumId: typeof req.body?.albumId === "string" ? req.body.albumId : null,
      albumName: typeof req.body?.albumName === "string" ? req.body.albumName : null,
      genrePrimary: typeof req.body?.genrePrimary === "string" ? req.body.genrePrimary : null,
      genres: Array.isArray(req.body?.genres) ? req.body.genres : null,
      energy: typeof req.body?.energy === "number" ? req.body.energy : null,
    };
    const memory = skipped
      ? await onTrackSkip(userId, track, playDuration > 0 && playDuration < 30 ? 2 : 1)
      : await onTrackSave(userId, track, 0.25);
    markGenerateResultCacheStale(userId, typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined);
    res.json({ success: true, inferred: skipped ? "skip" : "listen", feedbackMemory: memory });
  } catch (err: any) {
    req.log.error({ err }, "Error saving implicit feedback");
    res.status(500).json({ error: "Failed to save implicit feedback." });
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
