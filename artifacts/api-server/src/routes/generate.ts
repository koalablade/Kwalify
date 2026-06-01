import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, playlistHistoryTable } from "../db";
import { eq } from "drizzle-orm";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
import {
  analyzeVibe,
  scoreSong,
  buildPlaylistStructure,
  limitArtistRepetition,
  generatePlaylistName,
  filterDeadZones,
  smoothEnergyCurve,
  separateAdjacentArtists,
  enforceArc,
  type EmotionProfile,
} from "../lib/emotion";
import { GeneratePlaylistBody } from "../zod/api";
import { checkRateLimit } from "../lib/rate-limit";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const NEUTRAL_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

router.post("/generate", async (req, res): Promise<void> => {
  try {
    // Guard: playlist creation calls the Spotify API — requires credentials.
    if (!getFeatures().spotify.enabled) {
      res.status(503).json({ error: "Spotify is not configured on this server." });
      return;
    }
    if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const userId = req.session.spotifyUserId;

    const rateCheck = checkRateLimit(userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.resetInMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec}s before generating again.`,
      });
      return;
    }

    const rawBody = req.body ?? {};
    const vibeRaw = rawBody.vibe ?? "";
    const modeRaw = rawBody.mode ?? "balanced";
    const lengthRaw = rawBody.length ?? 25;
    const parsedLength =
      typeof lengthRaw === "string" ? parseInt(lengthRaw, 10) : Number(lengthRaw);

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { vibe, mode, length } = parsed.data;

    let emotionProfile: EmotionProfile;
    try {
      emotionProfile = analyzeVibe(vibe);
      req.log.info({ emotionProfile }, "Emotion profile computed");
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed — using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }

    const likedSongs = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));

    if (likedSongs.length === 0) {
      res.status(400).json({
        error: "No liked songs found. Please sync your Spotify library first.",
      });
      return;
    }

    const scored = likedSongs.map((song) => ({
      ...song,
      score: scoreSong(
        {
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
        },
        emotionProfile,
        mode as "strict" | "balanced" | "chaotic"
      ),
    }));

    req.log.info({ totalSongs: likedSongs.length }, "Songs scored");

    const recentPlaylists = await db
      .select()
      .from(playlistHistoryTable)
      .where(eq(playlistHistoryTable.spotifyUserId, userId))
      .limit(5);

    const recentTrackIds = new Set<string>();
    for (const pl of recentPlaylists) {
      const ids = (pl.trackIds as string[]) ?? [];
      ids.forEach((id) => recentTrackIds.add(id));
    }

    const penalised = scored.map((song) => ({
      ...song,
      score: recentTrackIds.has(song.trackId) ? song.score * 0.6 : song.score,
    }));

    const maxPerArtist = mode === "strict" ? 2 : mode === "balanced" ? 3 : 5;
    const sorted = penalised.sort((a, b) => b.score - a.score);
    const diversified = limitArtistRepetition(sorted, maxPerArtist);

    const poolTarget = Math.ceil(length * 1.6);
    const structured = buildPlaylistStructure(
      diversified,
      poolTarget,
      mode as "strict" | "balanced" | "chaotic"
    );

    const afterDeadZone = filterDeadZones(structured, length);
    const afterSmoothing = smoothEnergyCurve(afterDeadZone, 0.35, 0.65);
    const afterArtistSep = separateAdjacentArtists(afterSmoothing);
    const afterArc = enforceArc(afterArtistSep);
    const finalTracks = afterArc.slice(0, length);

    req.log.info(
      {
        poolAfterStructure: structured.length,
        afterDeadZone: afterDeadZone.length,
        afterSmoothing: afterSmoothing.length,
        afterArtistSep: afterArtistSep.length,
        finalTracks: finalTracks.length,
      },
      "Quality engine pipeline complete"
    );

    if (finalTracks.length === 0) {
      res.status(400).json({
        error: "Could not build a playlist. Try syncing more songs.",
      });
      return;
    }

    let playlistId: string;
    let playlistUrl: string;

    const playlistName = generatePlaylistName(vibe, emotionProfile);
    const trackUris = finalTracks.map((t) => `spotify:track:${t.trackId}`);

    try {
      // MUST be the user's OAuth token — a Client Credentials token will always 403 here.
      const freshTokens = await getValidAccessToken(req.session.spotifyTokens);
      req.session.spotifyTokens = freshTokens;

      const accessToken = freshTokens.accessToken;
      req.log.info({
        userId,
        accessTokenExists: !!accessToken,
        accessTokenPreview: accessToken?.slice(0, 12) ?? "MISSING",
        msg: "[playlist-create-debug] about to create playlist",
      });

      const result = await createSpotifyPlaylist(
        accessToken,
        userId,
        playlistName,
        trackUris
      );
      playlistId = result.id;
      playlistUrl = result.url;
    } catch (spotifyErr: any) {
      const status = spotifyErr?.response?.status ?? 500;
      req.log.error({
        userId,
        status,
        spotifyError: spotifyErr?.response?.data,
        msg: "[playlist-create-error] Spotify rejected playlist creation",
      }, "Spotify playlist creation failed");

      if (status === 401) {
        res.status(401).json({ error: "Spotify session expired. Please log in again." });
      } else if (status === 403) {
        res.status(403).json({ error: "Spotify permission denied. Check your app scopes." });
      } else if (status === 429) {
        res.status(429).json({ error: "Spotify rate limit hit. Please try again in a moment." });
      } else {
        res.status(500).json({ error: "Failed to create Spotify playlist. Please try again." });
      }
      return;
    }

    await db.insert(playlistHistoryTable).values({
      spotifyUserId: userId,
      playlistId,
      playlistUrl,
      name: playlistName,
      vibe,
      mode,
      trackCount: finalTracks.length,
      emotionProfile: emotionProfile as any,
      trackIds: finalTracks.map((t) => t.trackId) as any,
    });

    req.log.info({ userId, playlistId, trackCount: finalTracks.length }, "Playlist created");

    res.json({
      playlistId,
      playlistUrl,
      url: playlistUrl,
      name: playlistName,
      vibe,
      mode,
      count: finalTracks.length,
      totalTracks: finalTracks.length,
      emotionProfile,
      tracks: finalTracks.map((t) => ({
        id: t.trackId,
        name: t.trackName,
        artist: t.artistName,
        album: t.albumName,
        albumArt: t.albumArt ?? null,
        durationMs: t.durationMs,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        tempo: t.tempo ?? null,
        score: Math.round(t.score * 100) / 100,
      })),
    });
  } catch (fatalErr: any) {
    req.log.error({ err: fatalErr }, "Unhandled error in /generate");
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "An unexpected error occurred. Please try again.",
        playlist: [],
      });
    }
  }
});

export default router;
