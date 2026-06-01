import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, playlistHistoryTable, savedPlaylistsTable } from "../db";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
import {
  blendEmotionProfiles,
  fingerprintToEmotionProfile,
  loadReferenceFingerprint,
  referenceSimilarityBonus,
  type ReferenceFingerprint,
} from "../lib/reference-playlist";
import { eq, desc, and } from "drizzle-orm";
import {
  analyzeVibe,
  scoreSong,
  buildPlaylistStructure,
  limitArtistRepetition,
  generatePlaylistName,
  refineSongScore,
  detectVibeKind,
  passesSunnyGate,
  filterDeadZones,
  smoothEnergyCurve,
  separateAdjacentArtists,
  enforceArc,
  type EmotionProfile,
} from "../lib/emotion";
import { GeneratePlaylistBody } from "../zod/api";
import { checkRateLimit } from "../lib/rate-limit";
import { getFeatures } from "../lib/env";
import { publicUrl } from "../lib/public-url";

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
  const startMs = Date.now();
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
    const referencePlaylistRaw =
      typeof rawBody.referencePlaylist === "string" ? rawBody.referencePlaylist.trim() : "";
    const parsedLength =
      typeof lengthRaw === "string" ? parseInt(lengthRaw, 10) : Number(lengthRaw);

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
      ...(referencePlaylistRaw ? { referencePlaylist: referencePlaylistRaw } : {}),
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { vibe, mode, length, referencePlaylist } = parsed.data;

    let emotionProfile: EmotionProfile;
    try {
      emotionProfile = analyzeVibe(vibe);
      req.log.info({ emotionProfile }, "Emotion profile computed");
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed — using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }

    let referenceFingerprint: ReferenceFingerprint | null = null;
    let referencePlaylistId: string | null = null;

    if (referencePlaylist) {
      try {
        const tokens = await getValidAccessToken(req.session.spotifyTokens);
        const loaded = await loadReferenceFingerprint(tokens.accessToken, referencePlaylist);
        if (loaded) {
          referenceFingerprint = loaded.fingerprint;
          referencePlaylistId = loaded.playlistId;
          const refProfile = fingerprintToEmotionProfile(referenceFingerprint);
          const refWeight = mode === "strict" ? 0.65 : mode === "balanced" ? 0.55 : 0.42;
          emotionProfile = blendEmotionProfiles(emotionProfile, refProfile, refWeight);
          req.log.info(
            {
              referencePlaylistId,
              sampleCount: referenceFingerprint.sampleCount,
              refValence: referenceFingerprint.valence,
              refEnergy: referenceFingerprint.energy,
            },
            "Reference playlist fingerprint applied"
          );
        } else {
          req.log.warn({ referencePlaylist }, "Reference playlist had too few audio features");
        }
      } catch (refErr) {
        req.log.warn({ err: refErr, referencePlaylist }, "Reference playlist load failed");
      }
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

    const vibeKind = detectVibeKind(vibe, emotionProfile);
    req.log.info({ vibe, vibeKind, emotionProfile }, "Vibe kind detected");

    const scored = likedSongs.map((song) => {
      const base = scoreSong(
        {
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
        },
        emotionProfile,
        mode as "strict" | "balanced" | "chaotic",
        vibeKind
      );
      let score = refineSongScore(
        base,
        {
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
          instrumentalness: song.instrumentalness,
          speechiness: song.speechiness,
        },
        emotionProfile
      );

      if (referenceFingerprint) {
        score += referenceSimilarityBonus(
          {
            energy: song.energy,
            valence: song.valence,
            tempo: song.tempo,
            danceability: song.danceability,
            acousticness: song.acousticness,
          },
          referenceFingerprint,
          mode as "strict" | "balanced" | "chaotic"
        );
      }

      return { ...song, score };
    });

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

    let penalised = scored.map((song) => ({
      ...song,
      score: recentTrackIds.has(song.trackId) ? song.score * 0.6 : song.score,
    }));

    if (vibeKind === "sunny") {
      const gated = penalised.filter((s) =>
        passesSunnyGate({
          valence: s.valence,
          energy: s.energy,
          acousticness: s.acousticness,
        })
      );
      if (gated.length >= Math.min(length * 2, penalised.length * 0.15)) {
        penalised = gated;
        req.log.info(
          { kept: gated.length, dropped: scored.length - gated.length },
          "Sunny vibe gate applied"
        );
      }
    }

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
    const isSpecificLateScene =
      emotionProfile.timeOfDay === "late_night" &&
      (emotionProfile.environment === "urban" || emotionProfile.nostalgia > 0.45);
    const energyWindow =
      vibeKind === "sunny" ? 0.28 : isSpecificLateScene ? 0.32 : 0.5;
    const smoothMin = Math.max(0.05, emotionProfile.energy - energyWindow);
    const smoothMax = Math.min(0.95, emotionProfile.energy + energyWindow);
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

    // Attempt Spotify playlist creation first — graceful degradation on any failure
    let spotifyPlaylistUrl: string | null = null;

    try {
      const freshTokens = await getValidAccessToken(req.session.spotifyTokens!);
      if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
        req.session.spotifyTokens = freshTokens;
      }
      req.log.info({ userId, sessionUserId: req.session.spotifyUserId, tokenExpiresAt: freshTokens.expiresAt }, "[playlist-debug] token identity before create");
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

    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: emotionProfile as any,
        tracks: trackObjects as any,
        spotifyUrl: spotifyPlaylistUrl,
        vibe,
        mode,
      })
      .returning({ id: savedPlaylistsTable.id });

    const savedPlaylistId = insertResult[0]?.id ?? 0;

    req.log.info({ userId, playlistId: savedPlaylistId, trackCount: finalTracks.length }, "Playlist saved to DB");

    try {
      await db.insert(playlistHistoryTable).values({
        spotifyUserId: userId,
        playlistId: spotifyPlaylistUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
        playlistUrl: spotifyPlaylistUrl ?? publicUrl(`/p/${savedPlaylistId}`),
        name: playlistName,
        vibe,
        mode,
        trackCount: finalTracks.length,
        emotionProfile: emotionProfile as any,
        trackIds: finalTracks.map((t) => t.trackId) as any,
      });
    } catch (histErr) {
      req.log.warn({ err: histErr }, "playlist_history insert failed");
    }

    const spotifyFields = spotifyPlaylistUrl
      ? { spotifyPlaylistUrl }
      : { spotifyUnavailable: true as const };

    const totalDurationMs = finalTracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
    const artistCount = new Set(finalTracks.map((t) => t.artistName)).size;
    const generationMs = Date.now() - startMs;

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
      generationMs,
      stats: {
        trackCount: finalTracks.length,
        totalDurationMs,
        artistCount,
        generationMs,
      },
      emotionProfile,
      vibeKind,
      referenceMatch: referenceFingerprint
        ? {
            playlistId: referencePlaylistId,
            sampleCount: referenceFingerprint.sampleCount,
            valence: Math.round(referenceFingerprint.valence * 100) / 100,
            energy: Math.round(referenceFingerprint.energy * 100) / 100,
          }
        : null,
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
    res.json({
      id: playlist.id,
      name: playlist.name,
      vibe: playlist.vibe ?? null,
      emotionProfile: playlist.emotionProfile ?? null,
      tracks: playlist.tracks ?? [],
      spotifyUrl: playlist.spotifyUrl ?? null,
      createdAt: playlist.createdAt.toISOString(),
      userId: playlist.userId,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch playlist." });
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
