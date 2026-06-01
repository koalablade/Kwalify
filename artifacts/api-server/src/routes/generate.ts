import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, playlistHistoryTable, savedPlaylistsTable } from "../db";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
import { eq, desc, and } from "drizzle-orm";
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

    const poolTarget = Math.max(Math.ceil(length * 3), 75);
    const structured = buildPlaylistStructure(
      diversified,
      poolTarget,
      mode as "strict" | "balanced" | "chaotic"
    );

    // Shuffle only the top half of the pool so each regen call picks different
    // tracks from the high-quality set, without demoting any low-scoring song
    // into the top half (bottom half ordering is preserved).
    const pool = structured.slice(0, poolTarget);
    const halfLen = Math.floor(pool.length / 2);
    for (let i = halfLen - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const shuffledStructured = [...pool, ...structured.slice(poolTarget)];

    const afterDeadZone = filterDeadZones(shuffledStructured, length);
    const smoothMin = Math.max(0.05, emotionProfile.energy - 0.5);
    const smoothMax = Math.min(0.95, emotionProfile.energy + 0.5);
    const afterSmoothing = smoothEnergyCurve(afterDeadZone, smoothMin, smoothMax);
    const afterArtistSep = separateAdjacentArtists(afterSmoothing);
    const afterArc = enforceArc(afterArtistSep, emotionProfile);
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

    const playlistName = generatePlaylistName(vibe, emotionProfile);

    const trackObjects = finalTracks.map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
    }));

    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: emotionProfile as any,
        tracks: trackObjects as any,
      })
      .returning({ id: savedPlaylistsTable.id });

    const savedPlaylistId = insertResult[0]?.id ?? 0;

    req.log.info({ userId, playlistId: savedPlaylistId, trackCount: finalTracks.length }, "Playlist saved to DB");

    // Attempt Spotify playlist creation — graceful degradation on any failure
    let spotifyPlaylistUrl: string | null = null;

    try {
      const freshTokens = await getValidAccessToken(req.session.spotifyTokens!);
      if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
        req.session.spotifyTokens = freshTokens;
      }
      const trackUris = finalTracks.map((t) => `spotify:track:${t.trackId}`);
      const spotifyResult = await createSpotifyPlaylist(
        freshTokens.accessToken,
        userId,
        playlistName,
        trackUris
      );
      spotifyPlaylistUrl = spotifyResult.url;
      req.log.info({ spotifyPlaylistId: spotifyResult.id, userId }, "Spotify playlist created");
    } catch (spotifyErr: any) {
      req.log.warn(
        { err: spotifyErr?.message, status: spotifyErr?.response?.status },
        "Spotify playlist creation failed — degrading gracefully"
      );
    }

    const spotifyFields = spotifyPlaylistUrl
      ? { spotifyPlaylistUrl }
      : { spotifyUnavailable: true as const };

    res.json({
      success: true,
      playlistId: savedPlaylistId,
      ...spotifyFields,
      playlistName,
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
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching playlists");
    res.status(500).json({ error: "Failed to fetch playlists." });
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
