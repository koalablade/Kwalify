import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, playlistHistoryTable, savedPlaylistsTable } from "../db";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
import {
  blendEmotionProfiles,
  fingerprintToEmotionProfile,
  loadReferenceFingerprint,
  type ReferenceFingerprint,
} from "../lib/reference-playlist";
import { eq, desc, and } from "drizzle-orm";
import { parseEmotionalDestination } from "../lib/emotion-destination";
import {
  buildAlbumAppearanceMap,
  buildArtistAppearanceMap,
  buildFreshnessStats,
  countRecentJourneyArc,
  journeyArcCooldownMultiplier,
  sceneClonePenalty,
} from "../lib/playlist-freshness";
import { rediscoveryJitter } from "../lib/rediscovery";
import { buildLibrarySignals, type LikedSongRow } from "../lib/library-signals";
import { detectRediscoveryMode, type RediscoveryMode } from "../lib/forgotten-favourites";
import { detectMusicChapters, matchChapterFromVibe } from "../lib/music-life-chapters";
import { detectArchaeologyIntent } from "../lib/library-archaeology";
import { computeSurpriseMix } from "../lib/human-surprise";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { getUserGenreProfileForGenerate } from "../lib/genre-profile-cache";
import { buildGenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import {
  getCachedGenreStack,
  setCachedGenreStack,
} from "../lib/genre-stack-cache";
import {
  getGenerateCacheKey,
  getCachedGenerateResult,
  setCachedGenerateResult,
} from "../lib/generate-result-cache";
import { createRequestBudget } from "../lib/request-budget";
import {
  REQUEST_HARD_TIMEOUT_MS,
  MINIMAL_GENRE_STACK_THRESHOLD,
} from "../lib/production-limits";
import {
  acquireGenerateSession,
  endGenerateSession,
  setGeneratePhase,
  isGenerateCancelled,
  getPendingSpotifyPlaylistId,
  setPendingSpotifyPlaylistId,
  clearPendingSpotifyPlaylist,
  getGenerateProgress,
} from "../lib/generate-session";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { isShuttingDown } from "../lib/shutdown";
import {
  buildFallbackPipelineResult,
  formatTracksForApi,
} from "../lib/generate-helpers";
import { decodeIntent } from "../lib/intent-decoder";
import { computeTemporalMemory } from "../lib/temporal-memory";
import { buildPlaylistPipeline } from "../core/playlist-pipeline";
import type { GenreAudit } from "../lib/genre-audit";
import { summarizePipeline } from "../lib/scoring-explanation";
import { scorePromptConfidence } from "../lib/prompt-confidence";
import { buildGenerationExplanation } from "../lib/vibe-explanation";
import { buildMomentUnderstanding } from "../lib/moment-understanding";
import { detectMixedEmotions } from "../lib/multi-emotion";
import {
  analyzeVibeWithContext,
  generatePlaylistName,
  detectVibeKind,
  detectJourneyArc,
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

function staleGenerate(userId: string, requestId: string): boolean {
  return isGenerateCancelled(userId, requestId);
}

/** Consistent /generate failure payload (API shape unchanged). */
function generateFail(
  res: import("express").Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({
    success: false,
    code,
    error,
    tracks: [],
    spotifyUnavailable: true,
    ...extra,
  });
}

router.get("/generate/status", (req, res): void => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const progress = getGenerateProgress(req.session.spotifyUserId);
  res.json({
    phase: progress?.phase ?? "idle",
    requestId: progress?.requestId ?? null,
    active: !!progress,
  });
});

router.post("/generate", async (req, res): Promise<void> => {
  const startMs = Date.now();
  let requestId = "";
  let sessionUserId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    if (!getFeatures().spotify.enabled) {
      generateFail(res, 503, "SPOTIFY_DISABLED", "Spotify is not configured on this server.");
      return;
    }
    if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
      generateFail(res, 401, "NOT_AUTHENTICATED", "Not authenticated");
      return;
    }

    if (isShuttingDown()) {
      generateFail(
        res,
        503,
        "SERVER_RESTARTING",
        "Server is updating — wait about 30 seconds, then try again."
      );
      return;
    }

    const userId = req.session.spotifyUserId;

    const rateCheck = checkRateLimit(userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.resetInMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      generateFail(
        res,
        429,
        "RATE_LIMITED",
        `Too many requests. Please wait ${retryAfterSec}s before generating again.`,
        { retry_after: retryAfterSec }
      );
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

    const varietyBoostRequested = rawBody.varietyBoost === true;

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
      ...(referencePlaylistRaw ? { referencePlaylist: referencePlaylistRaw } : {}),
      ...(varietyBoostRequested ? { varietyBoost: true } : {}),
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      generateFail(res, 400, "INVALID_REQUEST", parsed.error.message);
      return;
    }

    const { vibe, mode, length, referencePlaylist, varietyBoost } = parsed.data;

    const acquired = acquireGenerateSession(userId, { force: !!varietyBoost });
    if (!acquired) {
      req.log.info({ userId, code: "GENERATION_IN_PROGRESS" }, "Rejected duplicate generate");
      generateFail(
        res,
        409,
        "GENERATION_IN_PROGRESS",
        "A playlist is already being generated. Wait for it to finish or try again in a moment."
      );
      return;
    }
    requestId = acquired;
    sessionUserId = userId;
    setGeneratePhase(userId, requestId, "starting");
    heartbeatTimer = setInterval(() => {
      const progress = getGenerateProgress(userId);
      req.log.info(
        {
          requestId,
          ms: Date.now() - startMs,
          phase: progress?.phase ?? "unknown",
        },
        "Generate in progress"
      );
    }, 15_000);

    try {

    const mixedEmotions = detectMixedEmotions(vibe);
    const destParse = parseEmotionalDestination(vibe);

    let emotionProfile: EmotionProfile;
    let experienceScene: ReturnType<typeof analyzeVibeWithContext>["experienceScene"] = null;
    let sceneJourneyArc: ReturnType<typeof analyzeVibeWithContext>["journeyArc"] | null = null;
    let momentPipeline: ReturnType<typeof analyzeMomentPipeline> | null = null;
    try {
      momentPipeline = analyzeMomentPipeline(vibe);
      emotionProfile = momentPipeline.profile;
      experienceScene = momentPipeline.experienceScene;
      sceneJourneyArc = momentPipeline.journeyArc;
      req.log.info(
        {
          emotionProfile,
          experienceScene,
          sceneJourneyArc,
          mixedEmotions,
          canonicalScene: momentPipeline.canonicalScene?.sceneId,
          intent: momentPipeline.intent.intent,
        },
        "Emotion profile computed"
      );
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
      } catch (refErr: any) {
        const refStatus = refErr?.response?.status;
        req.log.warn(
          { status: refStatus, referencePlaylist },
          "Reference playlist load failed — continuing with text vibe only"
        );
      }
    }

    setGeneratePhase(userId, requestId, "loading_library");
    const likedRowsRaw = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));

    const { valid: likedSongs, dropped: droppedTracks } = sanitizeLikedSongs(likedRowsRaw);
    if (droppedTracks > 0) {
      req.log.warn({ droppedTracks, userId }, "Dropped invalid liked-song rows");
    }

    if (likedSongs.length === 0) {
      setGeneratePhase(userId, requestId, "error");
      generateFail(
        res,
        400,
        "LIBRARY_EMPTY",
        "No liked songs found. Please sync your Spotify library first."
      );
      return;
    }

    if (likedSongs.length < 12) {
      setGeneratePhase(userId, requestId, "error");
      generateFail(
        res,
        400,
        "LIBRARY_TOO_SMALL",
        "Library is too small to generate. Sync more liked songs from Spotify first."
      );
      return;
    }

    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      requestId,
      userId,
      likedSongs,
      emotionProfile,
      length,
      mode,
      vibe,
      maxPerArtist: mode === "strict" ? 2 : mode === "balanced" ? 3 : 5,
    };

    const vibeKind = detectVibeKind(vibe, emotionProfile);
    const budget = createRequestBudget(startMs);
    const resultCacheKey = getGenerateCacheKey({
      userId,
      vibe,
      vibeKind,
      mode,
      length,
      referencePlaylist: !!referencePlaylist,
    });

    res.setTimeout(REQUEST_HARD_TIMEOUT_MS + 2000, () => {
      if (res.headersSent || staleGenerate(userId, requestId)) return;
      const ctx = (req as { _genCtx?: {
        likedSongs: typeof likedSongs;
        emotionProfile: EmotionProfile;
        length: number;
        maxPerArtist?: number;
        vibe: string;
        mode: string;
      } })._genCtx;
      req.log.error({ userId, requestId, code: "TIMEOUT" }, "Generate hard timeout — emergency fallback");
      if (!ctx?.likedSongs?.length) {
        res.status(504).json({
          success: false,
          error: "Generation timed out. Please try again.",
          code: "TIMEOUT",
          tracks: [],
        });
        return;
      }
      const maxPerArtist =
        ctx.mode === "strict" ? 2 : ctx.mode === "balanced" ? 3 : 5;
      const pipeline = buildFallbackPipelineResult({
        tracks: ctx.likedSongs,
        emotionProfile: ctx.emotionProfile,
        playlistLength: ctx.length,
        maxPerArtist,
        librarySize: ctx.likedSongs.length,
      });
      const playlistName = generatePlaylistName(ctx.vibe, ctx.emotionProfile);
      res.json({
        success: true,
        fastFallback: true,
        code: "TIMEOUT_FALLBACK",
        playlistName,
        name: playlistName,
        vibe: ctx.vibe,
        mode: ctx.mode,
        count: pipeline.finalTracks.length,
        totalTracks: pipeline.finalTracks.length,
        spotifyUnavailable: true,
        tracks: formatTracksForApi(pipeline.finalTracks),
      });
    });

    if (!varietyBoost) {
      const cached = getCachedGenerateResult(resultCacheKey);
      if (cached) {
        if (staleGenerate(userId, requestId)) return;
        setGeneratePhase(userId, requestId, "done");
        req.log.info({ userId, resultCacheKey }, "Generate result cache hit");
        res.json({
          success: true,
          cached: true,
          tracks: formatTracksForApi(cached.finalTracks),
          playlistName: cached.playlistName,
          name: cached.playlistName,
          vibe: cached.vibe,
          mode: cached.mode,
          count: cached.finalTracks.length,
          totalTracks: cached.finalTracks.length,
          emotionProfile: cached.emotionProfile,
          ...(cached.spotifyPlaylistUrl
            ? { spotifyPlaylistUrl: cached.spotifyPlaylistUrl }
            : { spotifyUnavailable: true as const }),
        });
        return;
      }
    }

    const promptConfidence = scorePromptConfidence(vibe, emotionProfile, {
      experienceSceneMatched: !!experienceScene,
      hasJourneyDestination: !!destParse.desired,
      mixedEmotions,
    });
    req.log.info({ vibe, vibeKind, promptConfidence }, "Vibe kind detected");

    const recentPlaylists = await db
      .select()
      .from(playlistHistoryTable)
      .where(eq(playlistHistoryTable.spotifyUserId, userId))
      .orderBy(desc(playlistHistoryTable.createdAt))
      .limit(25);

    const freshnessStats = buildFreshnessStats(
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      }))
    );

    const trackIdToArtist = new Map(likedSongs.map((s) => [s.trackId, s.artistName]));
    const trackIdToAlbum = new Map(likedSongs.map((s) => [s.trackId, s.albumName]));
    const artistAppearances = buildArtistAppearanceMap(
      recentPlaylists.map((p) => ({ vibe: p.vibe, trackIds: (p.trackIds as string[]) ?? [] })),
      trackIdToArtist
    );
    const albumAppearances = buildAlbumAppearanceMap(
      recentPlaylists.map((p) => ({ vibe: p.vibe, trackIds: (p.trackIds as string[]) ?? [] })),
      trackIdToAlbum
    );

    const cloneMultiplier = sceneClonePenalty(
      vibe,
      emotionProfile,
      freshnessStats.recentSceneFingerprints,
      momentPipeline?.canonicalScene?.sceneId ?? experienceScene?.sceneId
    );

    const humanIntent = momentPipeline?.intent ?? decodeIntent(vibe);
    const sonicProfile = momentPipeline?.sonicProfile ?? null;
    const scenePrototype = momentPipeline?.prototype ?? null;
    const memoryWeight =
      momentPipeline?.canonicalScene && momentPipeline.canonicalScene.confidence >= 0.65
        ? 0.55
        : momentPipeline?.experienceScene
          ? 0.35
          : 0;

    const journeyArc =
      sceneJourneyArc && sceneJourneyArc !== "default"
        ? sceneJourneyArc
        : detectJourneyArc(vibe, emotionProfile);

    const archaeology = detectArchaeologyIntent(vibe);
    let rediscoveryMode: RediscoveryMode = detectRediscoveryMode(vibe);
    if (archaeology) rediscoveryMode = archaeology.rediscoveryMode;

    const likedRows: LikedSongRow[] = likedSongs.map((s) => ({
      trackId: s.trackId,
      artistName: s.artistName,
      albumName: s.albumName,
      addedAt: s.addedAt,
      energy: s.energy,
      valence: s.valence,
      acousticness: s.acousticness,
      danceability: s.danceability,
    }));

    const musicChapters = detectMusicChapters(likedRows);
    const chapterMatch = matchChapterFromVibe(vibe, musicChapters, likedRows);

    const librarySignals = buildLibrarySignals(
      likedRows,
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
        createdAt: p.createdAt,
      }))
    );

    const surpriseMix = computeSurpriseMix({
      profile: emotionProfile,
      vibe,
      rediscoveryMode,
      archaeology,
      journeyArc,
      mode: mode as "strict" | "balanced" | "chaotic",
    });

    const arcRepeatCount = countRecentJourneyArc(
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      })),
      journeyArc
    );
    const journeyArcMultiplier = journeyArcCooldownMultiplier(arcRepeatCount);

    setGeneratePhase(userId, requestId, "building_profile");
    let t0 = Date.now();
    const { profile: userGenreProfile, cacheHit } = getUserGenreProfileForGenerate(
      userId,
      likedSongs,
      vibe
    );
    req.log.info(
      { ms: Date.now() - t0, tracks: likedSongs.length, cacheHit },
      "Genre profile built"
    );

    const recentTrackLists = recentPlaylists.map((p) => (p.trackIds as string[]) ?? []);
    const recentTrackPenaltyScale = varietyBoost ? 1.75 : 1;
    const freshnessCloneMultiplier = varietyBoost
      ? cloneMultiplier * 0.88
      : cloneMultiplier;
    const stackCacheKey = `${resultCacheKey}:${likedSongs.length}`;

    t0 = Date.now();
    req.log.info({ tracks: likedSongs.length }, "Building genre stack");
    let genreStack = getCachedGenreStack(stackCacheKey);
    const stackFromCache = !!genreStack;
    if (!genreStack) {
      genreStack = buildGenreIntelligenceStack({
        tracks:
          likedSongs.length >= MINIMAL_GENRE_STACK_THRESHOLD ? [] : likedSongs,
        userProfile: userGenreProfile,
        vibe,
        recentPlaylistTrackIds: recentTrackLists,
      });
      setCachedGenreStack(stackCacheKey, genreStack);
    }
    req.log.info(
      {
        ms: Date.now() - t0,
        tracks: likedSongs.length,
        stackFromCache,
        microGenres: genreStack.stats.microGenreCount,
        ontologyEdges: genreStack.stats.ontologyEdges,
      },
      "Genre stack built"
    );

    const maxPerArtist = mode === "strict" ? 2 : mode === "balanced" ? 3 : 5;

    const allowHolidaySeason =
      /\b(christmas|xmas|holiday|festive|winter holiday)\b/i.test(vibe) ||
      (humanIntent.intent === "nostalgia" && /\bchristmas|holiday\b/i.test(vibe));

    setGeneratePhase(userId, requestId, "scoring");
    t0 = Date.now();
    req.log.info({ tracks: likedSongs.length, stackFromCache }, "Starting hybrid scoring");
    const useFastFallback = budget.shouldFastFallback() || budget.isExpired();

    let pipeline: ReturnType<typeof buildPlaylistPipeline>;
    if (useFastFallback) {
      req.log.warn(
        { ms: Date.now() - startMs, remainingMs: budget.remainingMs(), code: "FAST_FALLBACK" },
        "Time budget — fast fallback playlist"
      );
      pipeline = buildFallbackPipelineResult({
        tracks: likedSongs,
        emotionProfile,
        playlistLength: length,
        maxPerArtist,
        librarySize: likedSongs.length,
      });
    } else {
      pipeline = buildPlaylistPipeline({
      likedSongs,
      vibe,
      mode: mode as "strict" | "balanced" | "chaotic",
      playlistLength: length,
      referencePlaylist: !!referencePlaylist,
      emotionProfile,
      vibeKind,
      intent: humanIntent,
      humanIntent,
      canonical: momentPipeline?.canonicalScene ?? null,
      prototype: scenePrototype,
      sonicProfile,
      userGenreProfile,
      genreStack,
      surpriseMix,
      journeyArc,
      maxPerArtist,
      recentPlaylistTrackIds: recentTrackLists,
      memoryByTrack: (trackId) => {
        const signal = librarySignals.tracks.get(trackId);
        if (!signal) return 0.35;
        const tm = computeTemporalMemory(signal);
        return Math.max(0, Math.min(1, 0.42 + tm.scoreModifier * 2));
      },
      noveltyByTrack: (trackId) =>
        Math.max(0, Math.min(1, 0.32 + (rediscoveryJitter(trackId, startMs) + 0.02) / 0.06)),
      postScore: {
        referenceFingerprint,
        memoryWeight,
        emotionProfile,
        librarySignals,
        rediscoveryMode,
        archaeology,
        chapterMatch,
        startMs,
        promptConfidenceMultiplier: promptConfidence.qualityBoost,
        journeyArcMultiplier,
        freshness: {
          stats: freshnessStats,
          artistAppearances,
          albumAppearances,
          globalCloneMultiplier: freshnessCloneMultiplier,
        },
        vibe,
      },
      varietyPenaltyScale: recentTrackPenaltyScale,
      genrePost: {
        allowHoliday: allowHolidaySeason,
        suppressGenres: allowHolidaySeason ? [] : ["christmas"],
      },
    });
    }

    type PlaylistTrack = (typeof likedSongs)[number] & {
      score: number;
      rediscoveryScore?: number;
      narrativeRole?: string;
    };
    setGeneratePhase(userId, requestId, "composing");
    let finalTracks = pipeline.finalTracks as PlaylistTrack[];
    const sorted = pipeline.sorted;
    const scoringDiagnostics = pipeline.scoringDiagnostics;
    const genreAudit: GenreAudit = pipeline.genreAudit;
    const { structured, afterDeadZone, afterSmoothing, afterArtistSep } = pipeline.composeMeta;

    const scoringPool = (pipeline.scoringDiagnostics.scoringPool ?? {}) as {
      librarySize?: number;
      hybridPoolSize?: number;
      poolCapped?: boolean;
    };
    req.log.info(
      {
        ms: Date.now() - t0,
        totalMs: Date.now() - startMs,
        totalSongs: likedSongs.length,
        hybridPool: scoringPool.hybridPoolSize,
        poolCapped: scoringPool.poolCapped,
        excluded: pipeline.hybridExcludedCount,
      },
      "Hybrid scoring complete"
    );

    req.log.info({ genreAudit, genreStack: genreStack.stats }, "Genre coverage enforcement");

    const explanation = buildGenerationExplanation({
      profile: emotionProfile,
      vibe,
      journeyArc,
      experienceScene,
      mixedEmotions,
      promptConfidence,
      socialContext: undefined,
      season: undefined,
    });

    const momentUnderstanding = buildMomentUnderstanding({
      vibe,
      profile: emotionProfile,
      journeyArc,
      destParse,
      mixedEmotions,
      explanation,
      experienceScene,
      socialContext: undefined,
      season: undefined,
      librarySize: likedSongs.length,
      tracksSelected: finalTracks.length,
      rediscoveryMode,
      chapterLabel: chapterMatch?.chapter.label ?? null,
      surpriseMix,
      archaeologyActive: !!archaeology,
    });

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
      req.log.warn({ userId, code: "EMPTY_POOL" }, "Empty pipeline — trying fallback");
      const rescue = buildFallbackPipelineResult({
        tracks: likedSongs,
        emotionProfile,
        playlistLength: length,
        maxPerArtist,
        librarySize: likedSongs.length,
      });
      if (rescue.finalTracks.length > 0) {
        pipeline = rescue;
        finalTracks = rescue.finalTracks as PlaylistTrack[];
      } else {
        setGeneratePhase(userId, requestId, "error");
        if (staleGenerate(userId, requestId)) return;
        generateFail(
          res,
          400,
          "EMPTY_PLAYLIST",
          "Could not build a playlist — nothing matched this vibe with your current library. Try Balanced or Chaotic mode, a broader vibe, or wait a moment and regenerate.",
          {
            hint: "Sync more liked songs if your library is small. This is not a Spotify API limit.",
          }
        );
        return;
      }
    }

    if (staleGenerate(userId, requestId)) return;

    const playlistName = generatePlaylistName(vibe, emotionProfile);

    const trackObjects = finalTracks.map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
    }));

    setGeneratePhase(userId, requestId, "spotify");
    let spotifyPlaylistUrl: string | null = null;

    if (!staleGenerate(userId, requestId)) {
      try {
        const freshTokens = await getValidAccessToken(
          req.session.spotifyTokens!,
          userId
        );
        if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
          req.session.spotifyTokens = freshTokens;
        }
        const trackUris = finalTracks.map((t) => `spotify:track:${t.trackId}`);
        const pendingId = getPendingSpotifyPlaylistId(userId);
        const spotifyResult = await createSpotifyPlaylist(
          freshTokens.accessToken,
          userId,
          playlistName,
          trackUris,
          {
            existingPlaylistId: pendingId,
            onPlaylistCreated: (id) =>
              setPendingSpotifyPlaylistId(userId, requestId, id),
          }
        );
        clearPendingSpotifyPlaylist(userId, requestId);
        spotifyPlaylistUrl = spotifyResult.url;
        req.log.info(
          { spotifyPlaylistId: spotifyResult.id, userId, reused: !!pendingId },
          "Spotify playlist created"
        );
      } catch (spotifyErr: any) {
        req.log.warn(
          {
            code: "SPOTIFY_CREATE_FAILED",
            err: spotifyErr?.message,
            status: spotifyErr?.response?.status,
          },
          "Spotify playlist creation failed — degrading gracefully"
        );
      }
    }

    setGeneratePhase(userId, requestId, "saving");

    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: { ...emotionProfile, journeyArc } as any,
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
        emotionProfile: { ...emotionProfile, journeyArc } as any,
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

    const datedLikes = likedSongs.filter((s) => s.addedAt);
    const recentCutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
    const recentLikeShare =
      datedLikes.length > 0
        ? datedLikes.filter((s) => s.addedAt!.getTime() > recentCutoff).length / datedLikes.length
        : 0;
    const librarySyncHint =
      datedLikes.length >= 200 && recentLikeShare > 0.85
        ? "Most cached likes look recently added. Run a full library sync from the app so older favourites are included."
        : null;

    if (!varietyBoost) {
      setCachedGenerateResult(resultCacheKey, {
        playlistName,
        vibe,
        mode,
        finalTracks: finalTracks.map((t) => ({
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName,
          albumName: t.albumName,
          albumArt: t.albumArt ?? null,
          durationMs: t.durationMs ?? null,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
          tempo: t.tempo ?? null,
          score: Math.round(t.score * 100) / 100,
          rediscoveryScore: t.rediscoveryScore,
          narrativeRole: t.narrativeRole,
        })),
        emotionProfile: { ...emotionProfile, journeyArc },
        spotifyPlaylistUrl,
        cachedAt: Date.now(),
      });
    }

    setGeneratePhase(userId, requestId, "done");
    if (staleGenerate(userId, requestId)) return;

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
      emotionProfile: { ...emotionProfile, journeyArc },
      experienceScene,
      momentUnderstanding,
      emotionalIntelligence: momentPipeline
        ? {
            pipeline: momentPipeline.pipelineSummary,
            ...summarizePipeline({
              canonical: momentPipeline.canonicalScene,
              prototype: momentPipeline.prototype,
              intent: momentPipeline.intent,
              physics: momentPipeline.physics,
              graphPaths: momentPipeline.graph.propagationPath,
            }),
            sonicTraits: momentPipeline.sonicProfile?.traits ?? [],
            scoringDiagnostics,
            genreAudit,
          }
        : {
            scoringDiagnostics,
            genreAudit,
            genreIntelligence: {
              ontologyNodes: genreStack.stats.ontologyNodes,
              microGenres: genreStack.stats.microGenreCount,
              embeddingVersion: genreStack.stats.embeddingVersion,
            },
          },
      explanation,
      promptConfidence,
      libraryIntelligence: {
        rediscoveryMode,
        archaeology: archaeology
          ? { concept: archaeology.concept, label: archaeology.label }
          : null,
        chapter: chapterMatch
          ? {
              id: chapterMatch.chapter.id,
              label: chapterMatch.chapter.label,
              trackCount: chapterMatch.chapter.trackIds.length,
            }
          : null,
        surpriseMix,
        chaptersAvailable: musicChapters.length,
        userGenreVector: userGenreProfile.vector,
        dominantGenres: userGenreProfile.dominant,
        genreAudit,
        genreIntelligence: {
          ontologyNodes: genreStack.stats.ontologyNodes,
          ontologyTargetMet: genreStack.stats.ontologyTargetMet,
          ontologyEdges: genreStack.stats.ontologyEdges,
          microGenres: genreStack.stats.microGenreCount,
          topMicroLabels: genreStack.stats.topMicroLabels,
          embeddingVersion: genreStack.stats.embeddingVersion,
          vectorStoreSizes: genreStack.stats.vectorStoreSizes,
          strengthenedEdges: genreStack.userLayer.strengthenedEdges.length,
        },
      },
      vibeKind,
      journeyArc,
      referenceMatch: referenceFingerprint
        ? {
            playlistId: referencePlaylistId,
            sampleCount: referenceFingerprint.sampleCount,
            valence: Math.round(referenceFingerprint.valence * 100) / 100,
            energy: Math.round(referenceFingerprint.energy * 100) / 100,
          }
        : null,
      referencePlaylistWarning: referencePlaylist && !referenceFingerprint
        ? "Could not read that reference playlist. If it is public, try the open.spotify.com link; if it is yours, log out and back in to refresh permissions. Generation used your text vibe only."
        : null,
      librarySyncHint,
      tracks: formatTracksForApi(finalTracks),
      ...(pipeline.scoringDiagnostics?.fastFallback
        ? { fastFallback: true }
        : {}),
    });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionUserId && requestId) {
        endGenerateSession(sessionUserId, requestId);
      }
    }
  } catch (fatalErr: any) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    req.log.error(
      { err: fatalErr?.message, code: "INTERNAL_ERROR", userId: sessionUserId },
      "Unhandled error in /generate"
    );
    if (sessionUserId && requestId) {
      setGeneratePhase(sessionUserId, requestId, "error");
      endGenerateSession(sessionUserId, requestId);
    }
    if (!res.headersSent && !staleGenerate(sessionUserId, requestId)) {
      const timedOut = Date.now() - startMs >= REQUEST_HARD_TIMEOUT_MS - 1000;
      const ctx = (req as { _genCtx?: {
        likedSongs: { trackId: string; trackName: string; artistName: string; albumName: string }[];
        emotionProfile: EmotionProfile;
        length: number;
        vibe: string;
        mode: string;
      } })._genCtx;
      if (timedOut && ctx?.likedSongs?.length) {
        const maxPerArtist =
          ctx.mode === "strict" ? 2 : ctx.mode === "balanced" ? 3 : 5;
        const pipeline = buildFallbackPipelineResult({
          tracks: ctx.likedSongs as Parameters<typeof buildFallbackPipelineResult>[0]["tracks"],
          emotionProfile: ctx.emotionProfile,
          playlistLength: ctx.length,
          maxPerArtist,
          librarySize: ctx.likedSongs.length,
        });
        const playlistName = generatePlaylistName(ctx.vibe, ctx.emotionProfile);
        res.json({
          success: true,
          fastFallback: true,
          code: "TIMEOUT_FALLBACK",
          playlistName,
          name: playlistName,
          vibe: ctx.vibe,
          mode: ctx.mode,
          count: pipeline.finalTracks.length,
          totalTracks: pipeline.finalTracks.length,
          spotifyUnavailable: true,
          tracks: formatTracksForApi(pipeline.finalTracks),
        });
      } else {
        res.status(timedOut ? 504 : 500).json({
          success: false,
          error: timedOut
            ? "Generation took too long. Try Balanced mode or regenerate in a moment."
            : "An unexpected error occurred. Please try again.",
          code: timedOut ? "TIMEOUT" : "INTERNAL_ERROR",
          tracks: [],
        });
      }
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
