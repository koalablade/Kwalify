/**
 * Purpose: CRUD routes for saved playlists — list, share, feedback, delete.
 * Responsibilities:
 *   - GET /playlists        — return saved playlists for the authenticated user
 *   - GET /share/:slug      — return a playlist by opaque share slug for the public share page
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
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { onTrackRemoved, onTrackSave, onTrackSkip, onTrackUndoFeedback, type FeedbackMemory, type FeedbackTrack } from "../lib/feedback-memory";
import { markGenerateResultCacheStale } from "../lib/generate-result-cache";
import { recordSceneFeedbackDown } from "../lib/scene-feedback-memory";
import { checkRateLimit } from "../lib/rate-limit";
import { sendApiError } from "../lib/api-error-envelope";
import { recordUserFeedbackEvent } from "../lib/ops-metrics";
import { hashedIdTag } from "../lib/pii";
import {
  isBetaEvidenceCaptureEnabled,
  mapFeedbackTypeToVerdict,
  type BetaEvidenceVerdict,
} from "../lib/beta-generation-evidence";
import { appendEvidenceFeedbackFireAndForget } from "../lib/beta-evidence-store";
import type { Request, Response } from "express";

const router: IRouter = Router();

function apiErr(res: Response, req: Request, status: number, code: string, error: string, opts: { retryAfterSeconds?: number } = {}): void {
  sendApiError(res, status, code, error, { requestId: String(req.id), ...opts });
}

type ShareTrack = {
  trackName?: string;
  name?: string;
  artistName?: string;
  artist?: string;
  albumArt?: string;
  album_art?: string;
  whyReasons?: string[];
};

function publicShareTracks(tracks: unknown): ShareTrack[] {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((raw) => {
    const t = (raw ?? {}) as ShareTrack;
    return {
      trackName: t.trackName ?? t.name ?? "Unknown",
      artistName: t.artistName ?? t.artist ?? "Unknown artist",
      albumArt: t.albumArt ?? t.album_art ?? undefined,
      whyReasons: Array.isArray(t.whyReasons) ? t.whyReasons.slice(0, 3) : [],
    };
  });
}

function publicSharePayload(playlist: typeof savedPlaylistsTable.$inferSelect) {
  const ep = (playlist.emotionProfile ?? {}) as {
    journeyArc?: string;
    librarySize?: number;
    timeOfDay?: string | null;
    environment?: string | null;
  };
  const tracks = publicShareTracks(playlist.tracks);
  return {
    id: playlist.id,
    shareSlug: playlist.shareSlug ?? null,
    name: playlist.name,
    vibe: playlist.vibe ?? null,
    mode: playlist.mode ?? null,
    journeyArc: ep.journeyArc ?? null,
    librarySize: ep.librarySize ?? null,
    timeOfDay: ep.timeOfDay ?? null,
    environment: ep.environment ?? null,
    tracks,
    trackCount: tracks.length,
    spotifyUrl: playlist.spotifyUrl ?? null,
    createdAt: playlist.createdAt.toISOString(),
  };
}

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
  action: z.enum(["skip", "remove", "save", "like", "dislike", "undo"]),
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
  eventType: z.enum(["listen", "skip", "replay", "session_dropoff", "manual_save"]).optional(),
  replayCount: z.number().min(0).max(100).optional(),
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
  const tracks: FeedbackTrack[] = [];
  for (const track of value) {
    if (!track || typeof track !== "object") continue;
    const t = track as Record<string, unknown>;
    const trackId = typeof t["trackId"] === "string"
      ? t["trackId"]
      : typeof t["id"] === "string"
        ? t["id"]
        : null;
    if (!trackId) continue;
    tracks.push({
      trackId,
      artistName: typeof t["artistName"] === "string" ? t["artistName"] : typeof t["artist"] === "string" ? t["artist"] : null,
      genrePrimary: typeof t["genrePrimary"] === "string" ? t["genrePrimary"] : null,
      energy: typeof t["energy"] === "number" ? t["energy"] : null,
    });
  }
  return tracks;
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
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 12;
  const requestedOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;

  try {
    const [playlists, totalRow] = await Promise.all([
      db
        .select()
        .from(savedPlaylistsTable)
        .where(eq(savedPlaylistsTable.userId, userId))
        .orderBy(desc(savedPlaylistsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(savedPlaylistsTable)
        .where(eq(savedPlaylistsTable.userId, userId)),
    ]);
    const total = Number(totalRow[0]?.count ?? playlists.length);

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
        shareSlug: p.shareSlug ?? null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + playlists.length < total,
    });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching playlists");
    apiErr(res, req, 500, "PLAYLISTS_FETCH_FAILED", "Failed to fetch playlists.");
  }
});

router.get("/share/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug ?? "").trim();
  if (!slug || slug.length < 6 || /^\d+$/.test(slug)) {
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
    return;
  }
  try {
    const rows = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.shareSlug, slug))
      .limit(1);
    const playlist = rows[0];
    if (!playlist) {
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
      return;
    }
    res.json(publicSharePayload(playlist));
  } catch (err: any) {
    apiErr(res, req, 500, "PLAYLIST_FETCH_FAILED", "Failed to fetch playlist.");
  }
});

/** Anonymous thumbs on shared playlists (no taste memory — analytics only). */
router.post("/share/:slug/track-react", async (req, res): Promise<void> => {
  const slug = String(req.params.slug ?? "").trim();
  const trackId = String(req.body?.trackId ?? "").trim();
  const reaction = String(req.body?.reaction ?? "").trim();
  if (!slug || !trackId || !["up", "down"].includes(reaction)) {
    apiErr(res, req, 400, "INVALID_SHARE_REACTION", "slug, trackId, and reaction (up|down) required.");
    return;
  }
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const rateCheck = checkRateLimit(`share-react:ip:${clientIp}`, 30, 60_000);
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil(rateCheck.resetInMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    apiErr(res, req, 429, "RATE_LIMITED", "Too many reactions. Please try again later.");
    return;
  }
  try {
    const rows = await db
      .select({ id: savedPlaylistsTable.id })
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.shareSlug, slug))
      .limit(1);
    if (!rows[0]) {
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
      return;
    }
    req.log.info({ slug, playlistId: rows[0].id, trackId, reaction }, "Share page track reaction");
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Share track reaction failed");
    apiErr(res, req, 500, "REACTION_FAILED", "Could not record reaction.");
  }
});

router.get("/playlists/:id/feedback", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    apiErr(res, req, 400, "INVALID_PLAYLIST_ID", "Invalid playlist id.");
    return;
  }

  try {
    const rows = await db
      .select({
        reaction: playlistFeedbackTable.reaction,
        vibe: playlistFeedbackTable.vibe,
        sceneId: playlistFeedbackTable.sceneId,
        createdAt: playlistFeedbackTable.createdAt,
      })
      .from(playlistFeedbackTable)
      .where(
        and(
          eq(playlistFeedbackTable.playlistId, playlistId),
          eq(playlistFeedbackTable.userId, userId),
        ),
      )
      .orderBy(desc(playlistFeedbackTable.createdAt))
      .limit(1);

    res.json(rows[0] ?? { reaction: null, vibe: null, sceneId: null, createdAt: null });
  } catch (err) {
    req.log.error({ err, playlistId, userId }, "Failed to load playlist feedback");
    apiErr(res, req, 500, "FEEDBACK_LOAD_FAILED", "Failed to load feedback.");
  }
});

router.post("/playlists/:id/feedback", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    apiErr(res, req, 400, "INVALID_PLAYLIST_ID", "Invalid playlist id.");
    return;
  }

  const reaction = String(req.body?.reaction ?? "").trim();
  if (!["up", "neutral", "down"].includes(reaction)) {
    apiErr(res, req, 400, "INVALID_REACTION", "Invalid reaction. Use up, neutral, or down.");
    return;
  }

  const vibe = String(req.body?.vibe ?? "").trim().slice(0, 200);
  if (!vibe) {
    apiErr(res, req, 400, "VIBE_REQUIRED", "Vibe is required for feedback.");
    return;
  }

  const sceneId =
    typeof req.body?.sceneId === "string" ? req.body.sceneId.trim().slice(0, 120) : null;

  try {
    const owned = await db
      .select({ id: savedPlaylistsTable.id, tracks: savedPlaylistsTable.tracks })
      .from(savedPlaylistsTable)
      .where(
        and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId))
      )
      .limit(1);
    if (!owned[0]) {
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
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
    await db.insert(playlistFeedbackTable).values({
      playlistId,
      userId,
      vibe,
      reaction,
      ...(sceneId ? { sceneId } : {}),
    });
    if (reaction === "down") {
      recordSceneFeedbackDown(userId, vibe, sceneId);
      for (const track of feedbackTracks(owned[0].tracks).slice(0, 50)) {
        await onTrackRemoved(userId, track, { mood: vibe });
      }
      markGenerateResultCacheStale(userId, vibe);
    }

    req.log.info({ userId, playlistId, reaction }, "Playlist feedback recorded");
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error saving playlist feedback");
    apiErr(res, req, 500, "FEEDBACK_SAVE_FAILED", "Failed to save feedback.");
  }
});

const UserFeedbackBodySchema = z.object({
  type: z.enum(["save", "skip", "regenerate", "captured", "missed"]),
  requestId: z.string().min(1).max(120).optional(),
  playlistId: z.union([z.number(), z.string()]).optional(),
  verdict: z.enum(["good", "mixed", "bad"]).optional(),
  opinion: z.string().max(2000).optional(),
  reasons: z.array(z.string().max(80)).max(20).optional(),
});

router.post("/feedback", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const parsed = UserFeedbackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    apiErr(res, req, 400, "INVALID_FEEDBACK", `Invalid feedback payload. ${parsed.error.message}`);
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parsed.data.playlistId != null ? String(parsed.data.playlistId) : undefined;
  const requestId = parsed.data.requestId ?? String(req.id);
  recordUserFeedbackEvent();
  req.log.info(
    {
      event: "user_feedback",
      type: parsed.data.type,
      requestId,
      playlistId: playlistId ?? null,
      userId: hashedIdTag(userId),
    },
    "user_feedback",
  );
  if (isBetaEvidenceCaptureEnabled() && parsed.data.requestId) {
    const verdict: BetaEvidenceVerdict | null =
      parsed.data.verdict ?? mapFeedbackTypeToVerdict(parsed.data.type);
    appendEvidenceFeedbackFireAndForget({
      kind: "feedback",
      generationEvidenceId: requestId,
      requestId,
      recordedAt: new Date().toISOString(),
      testerId: hashedIdTag(userId),
      verdict,
      reasons: parsed.data.reasons,
      opinion: parsed.data.opinion ?? null,
      ratings: { feedbackType: parsed.data.type },
    });
  }
  res.json({ success: true });
});

router.post("/feedback/track", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const parsed = TrackFeedbackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    apiErr(res, req, 400, "INVALID_TRACK_FEEDBACK", `Invalid track feedback payload. ${parsed.error.message}`);
    return;
  }
  const action = parsed.data.action;
  const trackId = parsed.data.trackId ?? parsed.data.track?.trackId;
  const track = trackFromPayload(trackId ?? "", parsed.data as Record<string, unknown>, parsed.data.track);
  if (!track.trackId) {
    apiErr(res, req, 400, "TRACK_ID_REQUIRED", "trackId is required.");
    return;
  }
  if (!(await isOwnedPlaylist(userId, parsed.data.playlistId))) {
    apiErr(res, req, 403, "FEEDBACK_FORBIDDEN", "Playlist feedback can only update the owner's taste memory.");
    return;
  }

  try {
    let memory: FeedbackMemory;
    if (action === "undo") {
      memory = await onTrackUndoFeedback(userId, track);
    } else if (action === "save" || action === "like") {
      memory = await onTrackSave(userId, track);
    } else if (action === "skip") {
      memory = await onTrackSkip(userId, track);
    } else {
      memory = await onTrackRemoved(userId, track, {
        mood: typeof req.body?.vibe === "string"
          ? req.body.vibe
          : typeof parsed.data.context?.vibe === "string"
            ? parsed.data.context.vibe
            : null,
        bridgeGenre: parsed.data.bridgeGenre ?? null,
      });
    }
    const feedbackType =
      action === "save" || action === "like" ? "save"
      : action === "skip" ? "skip"
      : action;
    recordUserFeedbackEvent();
    req.log.info(
      {
        event: "user_feedback",
        type: feedbackType,
        requestId:
          typeof parsed.data.context?.requestId === "string"
            ? parsed.data.context.requestId
            : String(req.id),
        playlistId: parsed.data.playlistId ?? null,
        trackId: track.trackId,
        userId: hashedIdTag(userId),
      },
      "user_feedback",
    );
    markGenerateResultCacheStale(userId, parsed.data.playlistId);
    res.json({ success: true, feedbackMemory: memory });
  } catch (err: any) {
    req.log.error({ err }, "Error saving track feedback memory");
    apiErr(res, req, 500, "TRACK_FEEDBACK_FAILED", "Failed to save track feedback.");
  }
});

router.post("/feedback/implicit", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const parsed = ImplicitFeedbackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    apiErr(res, req, 400, "INVALID_IMPLICIT_FEEDBACK", `Invalid implicit feedback payload. ${parsed.error.message}`);
    return;
  }
  const playDuration = parsed.data.playDuration;
  const skipped = parsed.data.skipped === true || parsed.data.eventType === "skip" || playDuration > 0 && playDuration < 30;

  try {
    const track = trackFromPayload(parsed.data.trackId, parsed.data as Record<string, unknown>, parsed.data);
    const memory = parsed.data.eventType === "replay"
      ? await onTrackSave(userId, track, Math.max(1.5, parsed.data.replayCount ?? 1.5))
      : parsed.data.eventType === "manual_save"
        ? await onTrackSave(userId, track, 2)
        : parsed.data.eventType === "session_dropoff"
          ? await onTrackSkip(userId, track, 1.25)
          : skipped
            ? await onTrackSkip(userId, track, playDuration > 0 && playDuration < 30 ? 2 : 1)
            : await onTrackSave(userId, track, 0.25);
    markGenerateResultCacheStale(userId, parsed.data.sessionId);
    res.json({ success: true, inferred: parsed.data.eventType ?? (skipped ? "skip" : "listen"), feedbackMemory: memory });
  } catch (err: any) {
    req.log.error({ err }, "Error saving implicit feedback");
    apiErr(res, req, 500, "IMPLICIT_FEEDBACK_FAILED", "Failed to save implicit feedback.");
  }
});

router.post("/playlists/:id/replace-track", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    apiErr(res, req, 400, "INVALID_PLAYLIST_ID", "Invalid playlist id.");
    return;
  }
  const parsed = ReplaceTrackBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    apiErr(res, req, 400, "INVALID_REPLACE_PAYLOAD", `Invalid replace payload. ${parsed.error.message}`);
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
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
      return;
    }

    const tracks = Array.isArray(playlist.tracks) ? [...playlist.tracks] as Record<string, unknown>[] : [];
    const removeIndex = tracks.findIndex((track) => track["trackId"] === parsed.data.trackId || track["id"] === parsed.data.trackId);
    if (removeIndex < 0) {
      apiErr(res, req, 404, "TRACK_NOT_IN_PLAYLIST", "Track not found in playlist.");
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
      apiErr(res, req, 404, "NO_REPLACEMENT", "No replacement candidate found.");
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
    apiErr(res, req, 500, "REPLACE_TRACK_FAILED", "Failed to replace track.");
  }
});

router.delete("/playlists/:id", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    apiErr(res, req, 401, "NOT_AUTHENTICATED", "Not authenticated");
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);

  if (isNaN(playlistId)) {
    apiErr(res, req, 400, "INVALID_PLAYLIST_ID", "Invalid playlist id.");
    return;
  }

  try {
    const deleted = await db
      .delete(savedPlaylistsTable)
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)))
      .returning({ id: savedPlaylistsTable.id });

    if (deleted.length === 0) {
    apiErr(res, req, 404, "PLAYLIST_NOT_FOUND", "Playlist not found.");
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error deleting playlist");
    apiErr(res, req, 500, "DELETE_PLAYLIST_FAILED", "Failed to delete playlist.");
  }
});

export default router;
