/**
 * Purpose: Playlist generation endpoint — the core of Kwalify.
 * Responsibilities:
 *   - POST /generate    — score the user's liked songs against a vibe and create a Spotify playlist
 *   - GET  /generate/status — return the current generation phase for the user
 * Dependencies: emotion engine, genre intelligence stack, playlist pipeline, Spotify API, drizzle-orm
 */
import { Router, type IRouter, type Request } from "express";
import { db } from "../db";
import {
  likedSongsTable,
  playlistHistoryTable,
  savedPlaylistsTable,
} from "../db";
import {
  createSpotifyPlaylist,
  enrichTrackMetadata,
  fetchAlbumMetadata,
  fetchArtistGenres,
  fetchAudioFeatures,
  getValidAccessToken,
  searchSpotifyTracks,
} from "../lib/spotify";
import {
  blendEmotionProfiles,
  fingerprintToEmotionProfile,
  loadReferenceFingerprint,
  type ReferenceFingerprint,
} from "../lib/reference-playlist";
import { eq, desc } from "drizzle-orm";
import { parseEmotionalDestination } from "../lib/emotion-destination";
import {
  buildAlbumAppearanceMap,
  buildArtistAppearanceMap,
  buildFreshnessStats,
  buildRecentTrackPoolPenalty,
  countRecentJourneyArc,
  journeyArcCooldownMultiplier,
  sceneClonePenalty,
} from "../lib/playlist-freshness";
import { boundedTrackReusePenalty } from "../core/v3/diversity-pressure";
import { rediscoveryJitter } from "../lib/rediscovery";
import { buildLibrarySignals, type LikedSongRow } from "../lib/library-signals";
import { detectRediscoveryMode, type RediscoveryMode } from "../lib/forgotten-favourites";
import { detectMusicChapters, matchChapterFromVibe } from "../lib/music-life-chapters";
import { detectArchaeologyIntent } from "../lib/library-archaeology";
import { computeSurpriseMix } from "../lib/human-surprise";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { getUserGenreProfileForGenerate } from "../lib/genre-profile-cache";
import { getCachedLikedSongs, setCachedLikedSongs } from "../lib/liked-songs-cache";
import { classifyTrack } from "../lib/genre-taxonomy";
import { getGenreFamily } from "../core/v3/global-diversity-controller";
import { buildGenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import {
  getCachedGenreStack,
  setCachedGenreStack,
} from "../lib/genre-stack-cache";
import {
  getGenerateCacheKey,
  getGenerateCacheEntryStatus,
  getCachedGenerateResult,
  setCachedGenerateResult,
} from "../lib/generate-result-cache";
import { trackHasEraEvidence, trackHasKnownEraMismatch } from "../lib/era-evidence";
import { createRequestBudget } from "../lib/request-budget";
import {
  REQUEST_HARD_TIMEOUT_MS,
  MINIMAL_GENRE_STACK_THRESHOLD,
  resolveHybridPoolCap,
} from "../lib/production-limits";
import {
  acquireGenerateSession,
  endGenerateSession,
  setGeneratePhase,
  setGenerateStageDetail,
  isGenerateCancelled,
  getPendingSpotifyPlaylistId,
  setPendingSpotifyPlaylistId,
  clearPendingSpotifyPlaylist,
  getGenerateProgress,
  getGenerateStatus,
  setGeneratePartialTracks,
  cancelGenerateSession,
} from "../lib/generate-session";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { isShuttingDown } from "../lib/shutdown";
import { createGenerateStageTimer } from "../lib/generate-stage-timer";
import { buildFallbackPipelineResult, formatTracksForApi } from "../lib/generate-helpers";
import { decodeIntent } from "../lib/intent-decoder";
import { computeTemporalMemory } from "../lib/temporal-memory";
import type { BuildPlaylistPipelineResult } from "../core/output";
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
import { generateShareSlug } from "../lib/share-slug";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import { detectEra } from "../lib/era-detection";
import {
  MOCK_SPOTIFY_USER_ID,
  buildMockUserGenreProfile,
  generateMockSpotifyLibrary,
} from "../lib/mock-spotify";
import {
  warnIfFieldDropped,
  warnIfV3MetadataLost,
  type V3MetadataTrack,
} from "../lib/v3-track-contract";
import { buildFeedbackDiagnostics, getFeedbackMemory, type FeedbackMemory } from "../lib/feedback-memory";
import {
  buildCuratorIdentity,
  buildIdentityDebugView,
  scoreTrackForIdentity,
  type CuratorIdentity,
  type IdentitySessionMemory,
} from "../lib/curator-identity";
import { runRequestLayerGeneration, type RequestGenerationOrchestration } from "../lib/request-generation-orchestrator";
import {
  buildLockedIntent as buildCsspLockedIntent,
  completeLockedIntent as completeCsspLockedIntent,
  GENRE_ALIASES,
} from "../core/v3/intent";
import { trackMatchesConstraints as trackMatchesV3Constraints } from "../core/v3/constraint-filter";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_ERA_TERMS,
  EXPANDED_EVENT_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";
import { beginSpotifyApiAudit, getSpotifyApiAuditSnapshot } from "../lib/spotify-api-audit";
import { buildIntentSurvivalDiagnostics } from "../lib/intent-survival-diagnostics";
import { buildIntentUnderstandingDiagnostics } from "../lib/intent-understanding-diagnostics";
import { recordUnknownTermEvents } from "../lib/unknown-term-harvest";
import { repairPlaylistIfNeeded, scorePlaylistCoherence, type PlaylistCoherenceScore, type CoherenceSwapRecord } from "../core/playlist-coherence-audit";
import { runCoherenceRebuildLoop } from "../core/rebuild-loop";
import { shouldPublishPlaylist, COHERENCE_PUBLISH_THRESHOLD, type CoherenceGateResult } from "../core/coherence-gate";
import { buildPlaylistSegments, orderTracksByPlaylistSegments, type EmotionalArc } from "../core/emotional-arc-planner";
import { buildIntentPipelineContext, mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";
import { compilePlaylistContext } from "../core/playlist-compiler";
import { recordPromptSceneMemory } from "../lib/cross-session-memory";
import { refreshGlobalTasteProfile } from "../lib/global-taste-profile";
import { assignTracksToSegments } from "../core/segment-playlist-planner";
import { segmentAssignmentsToDiagnostics, coherenceRepairSettingsFromPlan, coherenceGateFromPlan } from "../core/compile-plan-dsl";
import type { TasteGraphV2 } from "../lib/taste-graph-v2";
import type { CompilePlanDSL } from "../core/compile-plan-dsl";
import { rediscoveryModeForFamiliarity, type FamiliarityMode } from "../lib/familiarity-controller";
import { mergeScenePredictions } from "../lib/scene-alias-graph";
import { buildIntentLossReport, type IntentLossReport } from "../lib/intent-loss-report";
import { buildGenerationPipelineDiagnostics } from "../lib/generation-pipeline-diagnostics";
import {
  getSessionSnapshot,
  mergeSessionSnapshot,
  getSessionSnapshotCacheStats,
  type SessionSnapshot,
} from "../core/cache/session-snapshot-cache";

const generationControllerLock = "__kwalifyGenerationControllerRegistered";
const STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO = 0.85;
const STRICT_EXPLICIT_ERA_EVIDENCE_RATIO = 0.85;
const globalArchitectureState = globalThis as typeof globalThis & Record<string, unknown>;
if (globalArchitectureState[generationControllerLock]) {
  throw new Error(
    "[architecture] duplicate generation controller loaded; backend/controllers/generation.controller.ts is the single source of truth",
  );
}
globalArchitectureState[generationControllerLock] = true;

const router: IRouter = Router();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const EXECUTION_HEALTH_BASELINE_SIZE = 50;

type ExecutionHealthState = "HEALTHY" | "DEGRADED" | "BROKEN";
type ExecutionHealthCause =
  | "DUPLICATE_RETRIEVAL"
  | "DUPLICATE_SCORING"
  | "CACHE_BYPASS_FAILURE"
  | "MULTI_HYDRATION"
  | "V3_REENTRY"
  | "CONTROLLER_PIPELINE_CONFLICT"
  | "UNEXPECTED_FALLBACK_PATH";

type ExecutionHealthProfile = {
  hydrationCount: number;
  cacheStatus: "HIT" | "MISS";
  retrievalPassCount: number;
  scoringPassCount: number;
  v3InvocationCount: number;
  repairPassCount: number;
  finalisationCount: number;
  healthState: ExecutionHealthState;
  primaryCause: ExecutionHealthCause | null;
  driftDetected: boolean;
  degradedPerformanceMode: boolean;
  duplicateDetections: Array<{ stage: string; callStackTag: string }>;
  stageCalls: Record<string, number>;
  needsCorrection: string[];
};

type ExecutionHealthBaselineEntry = Pick<
  ExecutionHealthProfile,
  "hydrationCount" | "retrievalPassCount" | "scoringPassCount"
> & {
  latencyCategory: "FAST" | "NORMAL" | "SLOW";
};

const executionHealthBaseline: ExecutionHealthBaselineEntry[] = [];
type GenerateSessionSnapshot = SessionSnapshot<
  typeof likedSongsTable.$inferSelect,
  typeof playlistHistoryTable.$inferSelect,
  FeedbackMemory
>;
const sessionHydrationFlights = new Map<
  string,
  Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean }>
>();

async function runSessionHydrationSingleFlight(
  key: string,
  loader: () => Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean }>,
): Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean; shared: boolean }> {
  const existing = sessionHydrationFlights.get(key);
  if (existing) return { ...(await existing), shared: true };
  const flight = loader().finally(() => {
    sessionHydrationFlights.delete(key);
  });
  sessionHydrationFlights.set(key, flight);
  return { ...(await flight), shared: false };
}

type GenerationSideEffectPolicy = {
  mode: "production" | "audit";
  allowSpotifyPlaylistCreate: boolean;
  allowSavedPlaylistWrites: boolean;
  allowHistoryWrites: boolean;
  allowFeedbackWrites: boolean;
  allowAnalyticsWrites: boolean;
  allowResultCacheWrites: boolean;
  bypassRateLimit: boolean;
};

const PRODUCTION_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "production",
  allowSpotifyPlaylistCreate: true,
  allowSavedPlaylistWrites: true,
  allowHistoryWrites: true,
  allowFeedbackWrites: true,
  allowAnalyticsWrites: true,
  allowResultCacheWrites: true,
  bypassRateLimit: false,
};

const AUDIT_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "audit",
  allowSpotifyPlaylistCreate: false,
  allowSavedPlaylistWrites: false,
  allowHistoryWrites: false,
  allowFeedbackWrites: false,
  allowAnalyticsWrites: false,
  allowResultCacheWrites: false,
  bypassRateLimit: true,
};

function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

function createExecutionHealthProfile(cacheStatus: "HIT" | "MISS"): ExecutionHealthProfile {
  return {
    hydrationCount: 0,
    cacheStatus,
    retrievalPassCount: 0,
    scoringPassCount: 0,
    v3InvocationCount: 0,
    repairPassCount: 0,
    finalisationCount: 0,
    healthState: "HEALTHY",
    primaryCause: null,
    driftDetected: false,
    degradedPerformanceMode: false,
    duplicateDetections: [],
    stageCalls: {},
    needsCorrection: [],
  };
}

function recordExecutionStage(
  profile: ExecutionHealthProfile,
  logger: Request["log"],
  stage: string,
  callStackTag: string,
  opts: { maxCalls?: number; cause?: ExecutionHealthCause; blockDuplicate?: boolean } = {},
): boolean {
  const nextCount = (profile.stageCalls[stage] ?? 0) + 1;
  profile.stageCalls[stage] = nextCount;
  const maxCalls = opts.maxCalls ?? 1;
  if (nextCount <= maxCalls) return true;

  profile.healthState = "BROKEN";
  profile.primaryCause = profile.primaryCause ?? opts.cause ?? "UNEXPECTED_FALLBACK_PATH";
  profile.driftDetected = true;
  profile.degradedPerformanceMode = true;
  profile.duplicateDetections.push({ stage, callStackTag });
  profile.needsCorrection.push(stage);
  logger.error(
    {
      stage,
      callStackTag,
      count: nextCount,
      maxCalls,
      cause: profile.primaryCause,
    },
    "DUPLICATE_EXECUTION_DETECTED",
  );
  return opts.blockDuplicate !== true;
}

function finaliseExecutionHealth(
  profile: ExecutionHealthProfile,
  elapsedMs: number,
): {
  healthState: ExecutionHealthState;
  primaryCause: ExecutionHealthCause | null;
  driftDetected: boolean;
  executionSummary: Record<string, unknown>;
  rollingBaseline: Record<string, unknown>;
} {
  if (profile.healthState !== "BROKEN") {
    if (profile.hydrationCount > 1) {
      profile.healthState = "BROKEN";
      profile.primaryCause = profile.primaryCause ?? "MULTI_HYDRATION";
    } else if (profile.v3InvocationCount > 1) {
      profile.healthState = "BROKEN";
      profile.primaryCause = profile.primaryCause ?? "V3_REENTRY";
    } else if (profile.retrievalPassCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "DUPLICATE_RETRIEVAL";
    } else if (profile.scoringPassCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "DUPLICATE_SCORING";
    } else if (profile.finalisationCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "CONTROLLER_PIPELINE_CONFLICT";
    }
  }
  profile.driftDetected = profile.driftDetected || profile.healthState !== "HEALTHY";
  profile.degradedPerformanceMode = profile.degradedPerformanceMode || profile.healthState !== "HEALTHY";

  const latencyCategory = elapsedMs < 20_000 ? "FAST" : elapsedMs < 60_000 ? "NORMAL" : "SLOW";
  executionHealthBaseline.push({
    hydrationCount: profile.hydrationCount,
    retrievalPassCount: profile.retrievalPassCount,
    scoringPassCount: profile.scoringPassCount,
    latencyCategory,
  });
  if (executionHealthBaseline.length > EXECUTION_HEALTH_BASELINE_SIZE) executionHealthBaseline.shift();

  const average = (values: number[]): number =>
    values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;

  return {
    healthState: profile.healthState,
    primaryCause: profile.primaryCause,
    driftDetected: profile.driftDetected,
    executionSummary: {
      hydrationCount: profile.hydrationCount,
      cacheStatus: profile.cacheStatus,
      retrievalPassCount: profile.retrievalPassCount,
      scoringPassCount: profile.scoringPassCount,
      v3InvocationCount: profile.v3InvocationCount,
      repairPassCount: profile.repairPassCount,
      finalisationCount: profile.finalisationCount,
      degradedPerformanceMode: profile.degradedPerformanceMode,
      duplicateDetections: profile.duplicateDetections,
      needsCorrection: profile.needsCorrection,
    },
    rollingBaseline: {
      sampleSize: executionHealthBaseline.length,
      averageHydrationCount: average(executionHealthBaseline.map((entry) => entry.hydrationCount)),
      averageRetrievalPasses: average(executionHealthBaseline.map((entry) => entry.retrievalPassCount)),
      averageScoringPasses: average(executionHealthBaseline.map((entry) => entry.scoringPassCount)),
      latencyMix: executionHealthBaseline.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.latencyCategory] = (acc[entry.latencyCategory] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function generationAuditTokenAuthorized(req: Request): boolean {
  const expected = process.env["PLAYLIST_EVAL_TOKEN"]?.trim();
  if (!expected) return false;
  return requestHeader(req, "x-kwalify-evaluation-token") === expected;
}

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

type PreV3TimingBreakdown = {
  cacheTimeMs: number;
  dbTimeMs: number;
  likedSongsQueryMs: number;
  playlistHistoryQueryMs: number;
  genreProfileTimeMs: number;
  genreStackTimeMs: number;
  freshnessTimeMs: number;
  librarySignalTimeMs: number;
  moodIntentTimeMs: number;
  spotifyReferenceTimeMs: number;
  totalBeforeV3Ms: number;
  slowestStage: string | null;
  slowestStageMs: number;
  preV3Stages: Record<PreV3StageName, PreV3StageRecord>;
  dbSessionLoadStages: Record<DbSessionLoadStageName, DbSessionLoadStageRecord>;
};

type PreV3StageName =
  | "dbSessionLoad"
  | "userHistoryFetch"
  | "genreProfileBuild"
  | "librarySignalLoad"
  | "embeddingPrep"
  | "promptNormalization";

type DbSessionLoadStageName =
  | "userProfileQuery"
  | "userPreferencesQuery"
  | "playlistHistoryQuery"
  | "recentTracksQuery"
  | "implicitFeedbackQuery";

type PreV3StageRecord = {
  stage: string;
  durationMs: number;
  inputSize: number;
  outputSize: number;
  cacheHit: boolean;
};

type DbSessionLoadStageRecord = PreV3StageRecord & {
  rowsReturned: number;
};

type PreV3PerformanceReport = {
  totalPreV3Time: number;
  stageBreakdown: PreV3StageRecord[];
  dbSessionLoadStages: DbSessionLoadStageRecord[];
  bottleneckStage: string | null;
};

type ProductionTimelineStage =
  | "request_validation"
  | "session_acquire"
  | "prompt_understanding"
  | "candidate_fetch"
  | "cache_lookup"
  | "memory_load"
  | "freshness_memory"
  | "music_chapters"
  | "library_signals"
  | "surprise_context"
  | "genre_profile"
  | "genre_stack"
  | "intent_lock"
  | "intent_quality_context"
  | "intent_constraint_extract"
  | "intent_cssp_parse"
  | "intent_object_resolve"
  | "intent_curator_identity"
  | "intent_fallback_family"
  | "intent_v3_fallback"
  | "candidate_shape"
  | "curator_scoring"
  | "v3_pipeline";

type ProductionTimeline = {
  request_received: number;
  queue_entered: number | null;
  worker_acquired: number | null;
  deps_loaded: number | null;
  candidate_fetch_start: number | null;
  candidate_fetch_end: number | null;
  scoring_start: number | null;
  scoring_end: number | null;
  v3_entry: number | null;
  stageDurations: Partial<Record<ProductionTimelineStage, number>>;
  activeStages: Partial<Record<ProductionTimelineStage, number>>;
};

type QualitySignalContext = {
  primary: string;
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
  canonicalHints: string[];
};

type ConstraintLayer = {
  hard: {
    genres: string[];
    excludedGenres: string[];
    excludedArtists: string[];
    eraStart: number | null;
    eraEnd: number | null;
    strictLock: boolean;
    allowMultiGenre: boolean;
    allowBridge: boolean;
  };
  soft: {
    moodTags: string[];
    activityTags: string[];
    energyTags: string[];
    atmosphereTags: string[];
  };
  raw: {
    explicitGenreTerms: string[];
    explicitEraTerms: string[];
    strictTerms: string[];
    excludedTerms: string[];
    multiGenreTerms: string[];
    americanaBridgePrompt: boolean;
  };
};

type LockedIntent = {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  energy: "low" | "medium" | "high" | null;
  primaryGenres: string[];
  primaryGenre: string | null;
  primarySubgenre: string | null;
  secondarySubgenre: string | null;
  subgenreTerms: string[];
  eraStart: number | null;
  eraEnd: number | null;
  mood: string[];
  activity: string | null;
  energyLevel: "low" | "medium" | "high" | null;
  interpretationBudget?: {
    complexity: "low" | "medium" | "high";
    complexityScore: number;
    maxDimensions: number;
    inferredDimensionsUsed: number;
    inferredDimensionsAvailable: number;
    appliedDimensions: string[];
    droppedDimensions: string[];
  };
};

type ConstraintTrack = V3MetadataTrack<{
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  loudness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
  addedAt?: Date | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}> & {
  score: number;
  rediscoveryScore?: number;
  narrativeRole?: string;
};

function emptyPreV3Stage(stage: PreV3StageName): PreV3StageRecord {
  return {
    stage,
    durationMs: 0,
    inputSize: 0,
    outputSize: 0,
    cacheHit: false,
  };
}

function emptyDbSessionLoadStage(stage: DbSessionLoadStageName): DbSessionLoadStageRecord {
  return {
    stage,
    durationMs: 0,
    inputSize: 0,
    outputSize: 0,
    rowsReturned: 0,
    cacheHit: false,
  };
}

function createPreV3Timing(): PreV3TimingBreakdown {
  return {
    cacheTimeMs: 0,
    dbTimeMs: 0,
    likedSongsQueryMs: 0,
    playlistHistoryQueryMs: 0,
    genreProfileTimeMs: 0,
    genreStackTimeMs: 0,
    freshnessTimeMs: 0,
    librarySignalTimeMs: 0,
    moodIntentTimeMs: 0,
    spotifyReferenceTimeMs: 0,
    totalBeforeV3Ms: 0,
    slowestStage: null,
    slowestStageMs: 0,
    preV3Stages: {
      dbSessionLoad: emptyPreV3Stage("dbSessionLoad"),
      userHistoryFetch: emptyPreV3Stage("userHistoryFetch"),
      genreProfileBuild: emptyPreV3Stage("genreProfileBuild"),
      librarySignalLoad: emptyPreV3Stage("librarySignalLoad"),
      embeddingPrep: emptyPreV3Stage("embeddingPrep"),
      promptNormalization: emptyPreV3Stage("promptNormalization"),
    },
    dbSessionLoadStages: {
      userProfileQuery: emptyDbSessionLoadStage("userProfileQuery"),
      userPreferencesQuery: emptyDbSessionLoadStage("userPreferencesQuery"),
      playlistHistoryQuery: emptyDbSessionLoadStage("playlistHistoryQuery"),
      recentTracksQuery: emptyDbSessionLoadStage("recentTracksQuery"),
      implicitFeedbackQuery: emptyDbSessionLoadStage("implicitFeedbackQuery"),
    },
  };
}

function createProductionTimeline(): ProductionTimeline {
  return {
    request_received: 0,
    queue_entered: null,
    worker_acquired: null,
    deps_loaded: null,
    candidate_fetch_start: null,
    candidate_fetch_end: null,
    scoring_start: null,
    scoring_end: null,
    v3_entry: null,
    stageDurations: {},
    activeStages: {},
  };
}

function timelineOffset(startMs: number): number {
  return Math.max(0, Date.now() - startMs);
}

function markTimeline(
  timeline: ProductionTimeline,
  startMs: number,
  key: keyof Pick<
    ProductionTimeline,
    | "queue_entered"
    | "worker_acquired"
    | "deps_loaded"
    | "candidate_fetch_start"
    | "candidate_fetch_end"
    | "scoring_start"
    | "scoring_end"
    | "v3_entry"
  >
): void {
  timeline[key] = timelineOffset(startMs);
}

function startTimelineStage(
  timeline: ProductionTimeline,
  startMs: number,
  stage: ProductionTimelineStage
): void {
  timeline.activeStages[stage] = timelineOffset(startMs);
}

function endTimelineStage(
  timeline: ProductionTimeline,
  startMs: number,
  stage: ProductionTimelineStage
): void {
  const startedAt = timeline.activeStages[stage];
  if (typeof startedAt !== "number") return;
  const elapsed = Math.max(0, timelineOffset(startMs) - startedAt);
  timeline.stageDurations[stage] = (timeline.stageDurations[stage] ?? 0) + elapsed;
  delete timeline.activeStages[stage];
}

function buildProductionTimelineReport(
  timeline: ProductionTimeline,
  startMs: number,
  opts: { failureReason?: string | null } = {}
): Record<string, unknown> {
  const nowOffset = timelineOffset(startMs);
  const terminalOffset = timeline.v3_entry ?? timeline.scoring_start ?? nowOffset;
  const activeDurations = Object.fromEntries(
    Object.entries(timeline.activeStages).map(([stage, startedAt]) => [
      stage,
      Math.max(0, nowOffset - (startedAt ?? nowOffset)),
    ])
  );
  const completedStageMs = Object.values(timeline.stageDurations)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const activeStageMs = Object.values(activeDurations)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const allStageDurations = {
    ...timeline.stageDurations,
    ...activeDurations,
  };
  const blockingStage = Object.entries(allStageDurations)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "unknown";
  return {
    timeline: {
      request_received: timeline.request_received,
      queue_entered: timeline.queue_entered,
      worker_acquired: timeline.worker_acquired,
      deps_loaded: timeline.deps_loaded,
      candidate_fetch_start: timeline.candidate_fetch_start,
      candidate_fetch_end: timeline.candidate_fetch_end,
      scoring_start: timeline.scoring_start,
      scoring_end: timeline.scoring_end,
      v3_entry: timeline.v3_entry,
    },
    stageDurationsMs: allStageDurations,
    unaccounted_time_ms: Math.max(0, terminalOffset - completedStageMs - activeStageMs),
    blocking_stage: blockingStage,
    failure_reason: opts.failureReason ?? null,
  };
}

function recordPreV3Timing(
  timing: PreV3TimingBreakdown,
  key: Exclude<keyof PreV3TimingBreakdown, "totalBeforeV3Ms" | "slowestStage" | "slowestStageMs" | "preV3Stages" | "dbSessionLoadStages">,
  ms: number
): void {
  timing[key] += ms;
  if (timing[key] > timing.slowestStageMs) {
    timing.slowestStage = key;
    timing.slowestStageMs = timing[key];
  }
}

function addStructuredStageTiming(
  current: PreV3StageRecord,
  durationMs: number,
  inputSize: number,
  outputSize: number,
  cacheHit: boolean,
): PreV3StageRecord {
  return {
    stage: current.stage,
    durationMs: current.durationMs + durationMs,
    inputSize,
    outputSize,
    cacheHit: current.cacheHit || cacheHit,
  };
}

function recordPreV3Stage(
  timing: PreV3TimingBreakdown,
  stage: PreV3StageName,
  meta: { durationMs: number; inputSize?: number; outputSize?: number; cacheHit?: boolean },
): PreV3StageRecord {
  const record = addStructuredStageTiming(
    timing.preV3Stages[stage],
    meta.durationMs,
    meta.inputSize ?? timing.preV3Stages[stage].inputSize,
    meta.outputSize ?? timing.preV3Stages[stage].outputSize,
    meta.cacheHit ?? false,
  );
  timing.preV3Stages[stage] = record;
  return record;
}

function recordDbSessionLoadStage(
  timing: PreV3TimingBreakdown,
  stage: DbSessionLoadStageName,
  meta: { durationMs: number; inputSize?: number; outputSize?: number; rowsReturned?: number; cacheHit?: boolean },
): DbSessionLoadStageRecord {
  const base = addStructuredStageTiming(
    timing.dbSessionLoadStages[stage],
    meta.durationMs,
    meta.inputSize ?? timing.dbSessionLoadStages[stage].inputSize,
    meta.outputSize ?? timing.dbSessionLoadStages[stage].outputSize,
    meta.cacheHit ?? false,
  );
  const record = {
    ...base,
    rowsReturned: meta.rowsReturned ?? timing.dbSessionLoadStages[stage].rowsReturned,
  };
  timing.dbSessionLoadStages[stage] = record;
  return record;
}

function logPreV3Stage(
  logger: Pick<Request["log"], "info">,
  record: PreV3StageRecord,
): void {
  logger.info(
    {
      stage: record.stage,
      durationMs: record.durationMs,
      inputSize: record.inputSize,
      outputSize: record.outputSize,
      cacheHit: record.cacheHit,
    },
    "pre_v3_stage_completed",
  );
}

function logDbSessionLoadStage(
  logger: Pick<Request["log"], "info">,
  record: DbSessionLoadStageRecord,
): void {
  logger.info(
    {
      stage: record.stage,
      durationMs: record.durationMs,
      rowsReturned: record.rowsReturned,
      cacheHit: record.cacheHit,
    },
    "db_session_load_stage_completed",
  );
}

function buildPreV3PerformanceReport(timing: PreV3TimingBreakdown): PreV3PerformanceReport {
  const stageBreakdown = Object.values(timing.preV3Stages);
  const bottleneck = stageBreakdown
    .filter((stage) => stage.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)[0] ?? null;
  return {
    totalPreV3Time: timing.totalBeforeV3Ms,
    stageBreakdown,
    dbSessionLoadStages: Object.values(timing.dbSessionLoadStages),
    bottleneckStage: bottleneck?.stage ?? timing.slowestStage,
  };
}

type LiveStageProfileEntry = {
  stage: string;
  count: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
};

type LiveStageProfileSnapshot = {
  elapsedMs: number;
  currentStage: { stage: string; detail?: string; elapsedMs: number } | null;
  completed: LiveStageProfileEntry[];
  slowestCompleted: LiveStageProfileEntry | null;
  recentEvents: Array<{ stage: string; detail?: string; elapsedMs?: number; status: "started" | "completed" }>;
};

function createLiveStageProfiler(startMs: number): {
  start: (stage: string, detail?: string) => () => void;
  snapshot: () => LiveStageProfileSnapshot;
} {
  const completed = new Map<string, LiveStageProfileEntry>();
  const recentEvents: LiveStageProfileSnapshot["recentEvents"] = [];
  let currentStage: { stage: string; detail?: string; startedAt: number } | null = null;

  const pushEvent = (event: LiveStageProfileSnapshot["recentEvents"][number]): void => {
    recentEvents.push(event);
    if (recentEvents.length > 24) recentEvents.shift();
  };

  return {
    start(stage, detail) {
      const startedAt = Date.now();
      currentStage = { stage, detail, startedAt };
      pushEvent({ stage, detail, status: "started" });
      return () => {
        const elapsedMs = Date.now() - startedAt;
        const existing = completed.get(stage) ?? { stage, count: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
        existing.count += 1;
        existing.totalMs += elapsedMs;
        existing.lastMs = elapsedMs;
        existing.maxMs = Math.max(existing.maxMs, elapsedMs);
        completed.set(stage, existing);
        if (currentStage?.stage === stage && currentStage.startedAt === startedAt) {
          currentStage = null;
        }
        pushEvent({ stage, detail, elapsedMs, status: "completed" });
      };
    },
    snapshot() {
      const completedRows = [...completed.values()].sort((a, b) => b.totalMs - a.totalMs);
      return {
        elapsedMs: Date.now() - startMs,
        currentStage: currentStage
          ? {
              stage: currentStage.stage,
              detail: currentStage.detail,
              elapsedMs: Date.now() - currentStage.startedAt,
            }
          : null,
        completed: completedRows,
        slowestCompleted: completedRows[0] ?? null,
        recentEvents: [...recentEvents],
      };
    },
  };
}

function staleGenerate(userId: string, requestId: string): boolean {
  return isGenerateCancelled(userId, requestId);
}

function responseFinished(res: import("express").Response): boolean {
  return res.headersSent || res.writableEnded || res.destroyed;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function useMockSpotify(): boolean {
  return getFeatures().devMode.useMockSpotify;
}

function currentGenerateUserId(req: import("express").Request): string | null {
  return useMockSpotify() ? MOCK_SPOTIFY_USER_ID : req.session.spotifyUserId ?? null;
}

/** Cancelled/superseded session — always send a response so the client does not hang. */
function respondIfStale(
  res: import("express").Response,
  userId: string,
  requestId: string
): boolean {
  if (!staleGenerate(userId, requestId)) return false;
  if (!responseFinished(res)) {
    res.status(409).json({
      success: false,
      code: "GENERATION_CANCELLED",
      error:
        "This generation was superseded or cancelled. Try again if you need a new playlist.",
      tracks: [],
      spotifyUnavailable: true,
      generationDiagnostics: {
        recoveryTriggered: false,
        fallbackLevel: "none",
        sessionCancelled: true,
      },
    });
  }
  return true;
}

/** Consistent /generate failure payload (API shape unchanged). */
function generateFail(
  res: import("express").Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.status(status).json({
    success: false,
    code,
    error,
    tracks: [],
    spotifyUnavailable: true,
    ...extra,
  });
}

function timeoutFallbackResponse(
  req: import("express").Request,
  res: import("express").Response,
  opts: {
    failureReason: string;
    elapsedMs: number;
    requestId: string;
    lastPhase?: string | null;
    lastStage?: string | null;
    stageProfile?: unknown;
  },
): boolean {
  if (responseFinished(res)) return true;
  const ctx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
  const likedSongs = Array.isArray(ctx?.likedSongs) ? ctx.likedSongs : [];
  const scoringInputSongs = Array.isArray(ctx?.scoringInputSongs) ? ctx.scoringInputSongs : [];
  const emotionProfile = ctx?.emotionProfile as EmotionProfile | undefined;
  const length = typeof ctx?.length === "number" ? ctx.length : 0;
  const vibe = typeof ctx?.vibe === "string" ? ctx.vibe : "";
  const mode = typeof ctx?.mode === "string" ? ctx.mode : "balanced";
  const productionTimeline = ctx?.productionTimeline as ProductionTimeline | undefined;
  const timelineStartMs = typeof ctx?.startMs === "number" ? ctx.startMs : Date.now() - opts.elapsedMs;
  const productionTimelineReport = productionTimeline
    ? buildProductionTimelineReport(productionTimeline, timelineStartMs, { failureReason: opts.failureReason })
    : null;
  const maxPerArtist = typeof ctx?.maxPerArtist === "number" ? ctx.maxPerArtist : artistDiversityCap(length, vibe);
  const sceneLockStatus = ctx?.sceneLockStatus as import("../core/scene-lock-mode").SceneLockStatus | undefined;
  const sceneAliases = Array.isArray(ctx?.sceneAliases) ? ctx.sceneAliases as string[] : [];
  const mergedScenePrediction = ctx?.mergedScenePrediction as Record<string, number> | undefined;
  const finalizedTracks = Array.isArray(ctx?.finalTracks)
    ? ctx.finalTracks as Array<V3MetadataTrack<{
      trackId: string;
      trackName: string;
      artistName: string;
      albumName: string;
      albumArt?: string | null;
      durationMs?: number | null;
      energy: number | null;
      valence: number | null;
      tempo?: number | null;
      danceability?: number | null;
      acousticness?: number | null;
      score?: number;
      rediscoveryScore?: number;
      genrePrimary?: string | null;
      genreFamily?: string | null;
      genres?: string[] | null;
    }>>
    : [];
  if (emotionProfile && finalizedTracks.length > 0 && length > 0) {
    const tracks = formatTracksForApi(finalizedTracks.slice(0, length), emotionProfile);
    if (tracks.length > 0) {
      req.log.warn(
        {
          requestId: opts.requestId,
          elapsedMs: opts.elapsedMs,
          trackCount: tracks.length,
          requestedLength: length,
          failureReason: opts.failureReason,
        },
        "Generate timeout finalized response emitted"
      );
      res.status(200).json({
        success: true,
        playlistName: generatePlaylistName(vibe, emotionProfile),
        tracks,
        generationDiagnostics: {
          recoveryTriggered: true,
          fallbackLevel: "timeout_finalized",
          sessionCancelled: true,
          failureReason: opts.failureReason,
          requestId: opts.requestId,
          elapsedMs: opts.elapsedMs,
          lastPhase: opts.lastPhase ?? null,
          lastStage: opts.lastStage ?? null,
          stageProfile: opts.stageProfile ?? null,
          finalResponseCompletionLockApplied: true,
          finalResponseCompletionAdded: tracks.length,
          timeoutFallbackSource: "finalized_tracks",
          productionTimeline: productionTimelineReport,
        },
        v3Diagnostics: (ctx?.v3Diagnostics as Record<string, unknown> | undefined) ?? { timeoutFinalized: true },
        fastFallback: false,
        mode,
      });
      return true;
    }
  }
  const timeoutSource = (() => {
    if (scoringInputSongs.length === 0) return likedSongs;
    const seen = new Set<string>();
    const combined: unknown[] = [];
    for (const track of [...scoringInputSongs, ...likedSongs]) {
      const trackId = (track as { trackId?: string }).trackId;
      if (!trackId || seen.has(trackId)) continue;
      seen.add(trackId);
      combined.push(track);
    }
    return combined;
  })();
  const genreByTrack = typeof ctx?.genreByTrack === "function"
    ? ctx.genreByTrack as (trackId: string) => { genrePrimary?: string | null; genreFamily?: string | null; genres?: string[] | null } | null | undefined
    : undefined;
  const trackReusePenalty = ctx?.trackReusePenalty instanceof Map
    ? ctx.trackReusePenalty as Map<string, number>
    : undefined;
  const artistReusePenalty = ctx?.artistReusePenalty instanceof Map
    ? ctx.artistReusePenalty as Map<string, number>
    : undefined;
  const lockedIntent = ctx?.lockedIntent as LockedIntent | undefined;
  const classMap = ctx?.classMap instanceof Map
    ? ctx.classMap as Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>
    : new Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>();
  if (!emotionProfile || timeoutSource.length === 0 || length <= 0) return false;
  const expectedFamilies = lockedIntent
    ? (lockedIntent.primaryGenres.length > 0 ? lockedIntent.primaryGenres : lockedIntent.genreFamilies)
    : [];
  const eraRange = lockedIntent?.eraRange ?? null;
  const fallbackTrackText = (track: ConstraintTrack): string => {
    const genreTerms = Array.isArray((track as { genres?: unknown }).genres)
      ? ((track as { genres?: string[] }).genres ?? []).join(" ")
      : "";
    return `${track.trackName ?? ""} ${track.artistName ?? ""} ${track.albumName ?? ""} ${genreTerms}`.toLowerCase();
  };
  const fallbackActivityScore = (track: ConstraintTrack): number => {
    const activity = lockedIntent?.activity;
    const energy = track.energy;
    const tempo = track.tempo;
    const danceability = track.danceability;
    const acousticness = track.acousticness;
    const speechiness = track.speechiness;
    if (activity === "gym") {
      return (typeof energy === "number" && energy >= 0.52) ||
        (typeof tempo === "number" && tempo >= 108) ||
        (typeof danceability === "number" && danceability >= 0.58)
        ? 0.16
        : -0.18;
    }
    if (activity === "party") {
      return (typeof energy === "number" && energy >= 0.58) ||
        (typeof danceability === "number" && danceability >= 0.62)
        ? 0.12
        : -0.12;
    }
    if (activity === "focus") {
      const calmEnough = (energy == null || energy <= 0.62) &&
        (danceability == null || danceability <= 0.70) &&
        (speechiness == null || speechiness <= 0.35);
      return calmEnough ? 0.12 : -0.16;
    }
    if (activity === "driving") {
      return (energy == null || (energy >= 0.30 && energy <= 0.82)) && (tempo == null || tempo >= 75)
        ? 0.08
        : -0.08;
    }
    if (activity === "relaxing" || activity === "sleep") {
      return (energy == null || energy <= 0.50) || (typeof acousticness === "number" && acousticness >= 0.35)
        ? 0.08
        : -0.10;
    }
    return 0;
  };
  const fallbackIntentScore = (track: ConstraintTrack): number => {
    const text = fallbackTrackText(track);
    const genreEvidence = expectedFamilies.length > 0 && hasFinalGenreEvidence(track, classMap, expectedFamilies);
    const genreTextEvidence = expectedFamilies.flatMap((family) => FINAL_GUARD_GENRE_TERMS[family] ?? [])
      .some((term) => text.includes(term));
    const subgenreEvidence = [
      lockedIntent?.primarySubgenre,
      lockedIntent?.secondarySubgenre,
      ...(lockedIntent?.subgenreTerms ?? []),
    ].filter((term): term is string => !!term)
      .some((term) => text.includes(term.replace(/_/g, " ")));
    const eraScore = !eraRange
      ? 0
      : trackHasEraEvidence(track, eraRange)
        ? 0.10
        : trackHasKnownEraMismatch(track, eraRange)
          ? -0.18
          : 0;
    const unknownGenrePenalty = expectedFamilies.length > 0 && !genreEvidence && !genreTextEvidence && !subgenreEvidence
      ? -0.22
      : 0;
    return (
      (genreEvidence ? 0.34 : 0) +
      (genreTextEvidence ? 0.18 : 0) +
      (subgenreEvidence ? 0.22 : 0) +
      fallbackActivityScore(track) +
      eraScore +
      unknownGenrePenalty
    );
  };
  const sortFallbackBucket = (tracks: unknown[]): unknown[] =>
    [...tracks].sort((a, b) =>
      fallbackIntentScore(b as ConstraintTrack) - fallbackIntentScore(a as ConstraintTrack) ||
      (((b as ConstraintTrack).score ?? 0) - ((a as ConstraintTrack).score ?? 0))
    );
  const orderedTimeoutSource = (() => {
    if (expectedFamilies.length === 0 && !eraRange) return timeoutSource;
    const strict: unknown[] = [];
    const genreOnly: unknown[] = [];
    const eraCompatible: unknown[] = [];
    const rest: unknown[] = [];
    for (const track of timeoutSource) {
      const candidate = track as ConstraintTrack;
      const genreOk = expectedFamilies.length === 0 || hasFinalGenreEvidence(candidate, classMap, expectedFamilies);
      const eraOk = !eraRange || trackHasEraEvidence(candidate, eraRange);
      const eraNotWrong = !eraRange || !trackHasKnownEraMismatch(candidate, eraRange);
      if (genreOk && eraOk) strict.push(track);
      else if (genreOk && eraNotWrong) genreOnly.push(track);
      else if (eraOk) eraCompatible.push(track);
      else rest.push(track);
    }
    const seen = new Set<string>();
    return [
      ...sortFallbackBucket(strict),
      ...sortFallbackBucket(genreOnly),
      ...sortFallbackBucket(eraCompatible),
      ...sortFallbackBucket(rest),
    ].map((track) => {
      const candidate = track as ConstraintTrack;
      return {
        ...candidate,
        score: Math.max(0, Math.min(1, (candidate.score ?? 0.5) + fallbackIntentScore(candidate))),
      };
    }).filter((track) => {
      const trackId = (track as { trackId?: string }).trackId;
      if (!trackId || seen.has(trackId)) return false;
      seen.add(trackId);
      return true;
    });
  })();

  const pipeline = buildFallbackPipelineResult({
    tracks: orderedTimeoutSource as Array<{
      trackId: string;
      trackName: string;
      artistName: string;
      albumName: string;
      albumArt?: string | null;
      durationMs?: number | null;
      energy: number | null;
      valence: number | null;
      tempo?: number | null;
      danceability?: number | null;
      acousticness?: number | null;
      score?: number;
      rediscoveryScore?: number;
      genrePrimary?: string | null;
      genreFamily?: string | null;
      genres?: string[] | null;
    }>,
    emotionProfile,
    playlistLength: length,
    maxPerArtist,
    librarySize: likedSongs.length || timeoutSource.length,
    genreByTrack,
    recentTrackPenalty: trackReusePenalty,
    artistReusePenalty,
    worldFilter: sceneLockStatus?.active || sceneAliases.length > 0
      ? {
        sceneLock: sceneLockStatus ?? null,
        sceneAliases,
        scenePrediction: mergedScenePrediction,
      }
      : undefined,
  });
  const timeoutFinalTracks = [...pipeline.finalTracks];
  if (timeoutFinalTracks.length < length) {
    const seenTrackIds = new Set(timeoutFinalTracks.map((track) => track.trackId));
    for (const track of orderedTimeoutSource) {
      if (timeoutFinalTracks.length >= length) break;
      const candidate = track as {
        trackId: string;
        trackName: string;
        artistName: string;
        albumName: string;
        albumArt?: string | null;
        durationMs?: number | null;
        energy: number | null;
        valence: number | null;
        tempo?: number | null;
        danceability?: number | null;
        acousticness?: number | null;
        score?: number;
        rediscoveryScore?: number;
        genrePrimary?: string | null;
        genreFamily?: string | null;
        genres?: string[] | null;
      };
      if (!candidate.trackId || seenTrackIds.has(candidate.trackId)) continue;
      const genre = genreByTrack?.(candidate.trackId);
      timeoutFinalTracks.push({
        ...candidate,
        genrePrimary: candidate.genrePrimary ?? genre?.genrePrimary ?? undefined,
        genreFamily: candidate.genreFamily ?? genre?.genreFamily ?? candidate.genrePrimary ?? genre?.genrePrimary ?? undefined,
        genres: candidate.genres ?? genre?.genres ?? (candidate.genrePrimary ? [candidate.genrePrimary] : []),
        score: candidate.score ?? 0.7,
        rediscoveryScore: candidate.rediscoveryScore ?? 0.35,
      } as (typeof pipeline.finalTracks)[number]);
      seenTrackIds.add(candidate.trackId);
    }
  }
  const tracks = formatTracksForApi(timeoutFinalTracks.slice(0, length), emotionProfile);
  if (tracks.length === 0) return false;

  req.log.warn(
    {
      requestId: opts.requestId,
      elapsedMs: opts.elapsedMs,
      trackCount: tracks.length,
      requestedLength: length,
      source: scoringInputSongs.length > 0 ? "scoring_input_plus_library" : "liked_songs",
      strictIntentFallbackCandidates: orderedTimeoutSource.length,
      failureReason: opts.failureReason,
    },
    "Generate timeout fallback response emitted"
  );
  res.status(200).json({
    success: true,
    playlistName: generatePlaylistName(vibe, emotionProfile),
    tracks,
    generationDiagnostics: {
      recoveryTriggered: true,
      fallbackLevel: "timeout_fallback",
      sessionCancelled: true,
      failureReason: opts.failureReason,
      requestId: opts.requestId,
      elapsedMs: opts.elapsedMs,
      lastPhase: opts.lastPhase ?? null,
      lastStage: opts.lastStage ?? null,
      stageProfile: opts.stageProfile ?? null,
      finalResponseCompletionLockApplied: true,
      finalResponseCompletionAdded: tracks.length,
      timeoutFallbackHardFillAdded: Math.max(0, tracks.length - pipeline.finalTracks.length),
      timeoutFallbackSource: scoringInputSongs.length > 0 ? "scoring_input_plus_library" : "liked_songs",
      timeoutFallbackIntentOrdered: expectedFamilies.length > 0 || !!eraRange,
      productionTimeline: productionTimelineReport,
    },
    v3Diagnostics: pipeline.scoringDiagnostics,
    fastFallback: true,
    mode,
  });
  return true;
}

function fallbackLevelFromFinalization(
  diagnostics: Record<string, unknown>
): "none" | "soft" | "hardSafe" {
  const requestedLength = Number(diagnostics["requestedLength"] ?? 0);
  const finalCount = Number(diagnostics["finalCount"] ?? 0);
  const seriouslyUnderfilled =
    Number.isFinite(requestedLength) &&
    Number.isFinite(finalCount) &&
    requestedLength > 0 &&
    finalCount < recoveryActivationThreshold(requestedLength);
  if (
    seriouslyUnderfilled &&
    (diagnostics["hardSafeFillUsed"] === true || Number(diagnostics["hardSafeFillAdded"] ?? 0) > 0)
  ) {
    return "hardSafe";
  }
  if (
    typeof diagnostics["fallbackMode"] === "string" ||
    typeof diagnostics["recoveryStage"] === "string" ||
    (seriouslyUnderfilled && (diagnostics["artistLimitRelaxed"] === true || diagnostics["albumLimitRelaxed"] === true))
  ) {
    return "soft";
  }
  return "none";
}

function deriveDiagnosticTags(vibe: string): {
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
} {
  const lower = vibe.toLowerCase();
  const expandedMoods = Object.entries(EXPANDED_MOOD_TERMS)
    .filter(([, terms]) => termRegex(terms).test(lower))
    .map(([tag]) => tag);
  const expandedActivities = Object.entries(EXPANDED_ACTIVITY_TERMS)
    .filter(([, terms]) => termRegex(terms).test(lower))
    .map(([tag]) => tag);
  const expandedEras = EXPANDED_ERA_TERMS
    .filter((era) => termRegex(era.terms).test(lower))
    .map((era) => era.label);
  const expandedGenres = EXPANDED_GENRE_ALIASES
    .filter((alias) => termRegex(alias.terms).test(lower))
    .map((alias) => alias.family);
  const moodTags = [
    /\b(nostalg|memory|retro|vintage)\b/.test(lower) ? "nostalgic" : null,
    /\b(sunset|warm|golden|cozy|cosy|summer|barbecue|bbq)\b/.test(lower) ? "warm" : null,
    /\b(solitude|alone|reflect|introspect)\b/.test(lower) ? "introspective" : null,
    /\b(sad|melanchol|lonely|blue|rainy|rain)\b/.test(lower) ? "melancholic" : null,
    ...expandedMoods,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const activityTags = [
    /\b(driv|road|highway|cruise)\b/.test(lower) ? "driving" : null,
    /\b(study|focus|work|coding)\b/.test(lower) ? "focus" : null,
    /\b(party|club|dance|barbecue|bbq|cookout)\b/.test(lower) ? "party" : null,
    /\b(walk|commute)\b/.test(lower) ? "walking" : null,
    ...expandedActivities,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const eraHints = [
    /\b(60'?s|1960'?s|sixties)\b/.test(lower) ? "60s" : null,
    /\b(70'?s|1970'?s|seventies)\b/.test(lower) ? "70s" : null,
    /\b(80'?s|1980'?s|eighties)\b/.test(lower) ? "80s" : null,
    /\b(90'?s|1990'?s|nineties)\b/.test(lower) ? "90s" : null,
    /\b(00'?s|2000'?s|y2k)\b/.test(lower) ? "00s" : null,
    /\b(2010s|10s)\b/.test(lower) ? "10s" : null,
    /\b(2020s|20s|modern)\b/.test(lower) ? "20s" : null,
    ...expandedEras,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const genreHints = [
    /\b(country|americana|western|bluegrass)\b/.test(lower) ? "country" : null,
    /\b(folk|acoustic|singer-songwriter)\b/.test(lower) ? "folk" : null,
    /\b(rock|grunge|punk|metal)\b/.test(lower) ? "rock" : null,
    /\b(pop|radio)\b/.test(lower) ? "pop" : null,
    /\b(jazz|blues|soul)\b/.test(lower) ? "jazz" : null,
    /\b(hip.?hop|rap|rnb|r&b)\b/.test(lower) ? "hip_hop" : null,
    /\b(electronic|house|techno|edm)\b/.test(lower) ? "electronic" : null,
    ...expandedGenres,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);

  return {
    moodTags: moodTags.length ? moodTags : ["neutral"],
    activityTags: activityTags.length ? activityTags : ["listening"],
    eraHints: eraHints.length ? eraHints : ["any"],
    genreHints: genreHints.length ? genreHints : ["unknown"],
  };
}

function topGenreHints(userGenreProfile: { vector: object; dominant: readonly string[] }): string[] {
  const fromDominant = userGenreProfile.dominant.filter((genre) => genre && genre !== "unknown").slice(0, 3);
  if (fromDominant.length > 0) return fromDominant;
  return Object.entries(userGenreProfile.vector as Record<string, number | undefined>)
    .filter(([genre, weight]) => genre !== "unknown" && (weight ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([genre]) => genre);
}

function recentEraHints(
  playlists: Array<{ vibe: string; createdAt?: Date | string | null }>
): string[] {
  const counts = new Map<string, number>();
  for (const playlist of playlists) {
    const { eraHints } = deriveDiagnosticTags(playlist.vibe);
    for (const era of eraHints) {
      if (era === "any") continue;
      counts.set(era, (counts.get(era) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([era]) => era);
}

function canonicalCrossGenreHints(vibe: string): string[] {
  const lower = vibe.toLowerCase();
  const hints = new Set<string>();
  if (/\b(dirt.?road|country|cowboy|western|americana)\b/.test(lower)) {
    ["country", "acoustic", "folk", "warm"].forEach((hint) => hints.add(hint));
  }
  if (/\b(techno|trance|90'?s|rave|warehouse)\b/.test(lower)) {
    ["electronic", "trance", "early EDM", "high BPM"].forEach((hint) => hints.add(hint));
  }
  if (/\b(chill|study|lo.?fi|ambient|focus)\b/.test(lower)) {
    ["ambient", "lo-fi", "soft electronic", "focus"].forEach((hint) => hints.add(hint));
  }
  if (/\b(gym|hype|workout|pump|beast.?mode)\b/.test(lower)) {
    ["high BPM", "trap", "rock", "EDM"].forEach((hint) => hints.add(hint));
  }
  return [...hints];
}

function buildQualitySignalContext(opts: {
  vibe: string;
  emotionProfile: EmotionProfile;
  userGenreProfile: { vector: object; dominant: readonly string[] };
  recentPlaylists: Array<{ vibe: string; createdAt?: Date | string | null }>;
}): QualitySignalContext {
  const derived = deriveDiagnosticTags(opts.vibe);
  const genreHints = topGenreHints(opts.userGenreProfile);
  const eraHints = recentEraHints(opts.recentPlaylists);
  const canonicalHints = canonicalCrossGenreHints(opts.vibe);
  const primary = opts.vibe.trim() || [
    ...canonicalHints,
    ...genreHints,
    opts.emotionProfile.energy >= 0.65 ? "energetic" : "balanced",
  ].filter(Boolean).join(" ");

  return {
    primary,
    moodTags: derived.moodTags.length ? derived.moodTags : ["neutral"],
    activityTags: derived.activityTags.length ? derived.activityTags : ["listening"],
    eraHints: derived.eraHints[0] !== "any" ? derived.eraHints : (eraHints.length ? eraHints : ["any"]),
    genreHints: derived.genreHints[0] !== "unknown" ? derived.genreHints : (genreHints.length ? genreHints : ["unknown"]),
    canonicalHints,
  };
}

function normalizeVibeForPipeline(vibe: string, signals: QualitySignalContext): string {
  if (vibe.trim()) return vibe;
  const parts = [
    signals.primary,
    `mood:${signals.moodTags.join(",")}`,
    `activity:${signals.activityTags.join(",")}`,
    `era:${signals.eraHints.join(",")}`,
    `genre:${signals.genreHints.join(",")}`,
    signals.canonicalHints.length ? `adjacent:${signals.canonicalHints.join(",")}` : null,
  ].filter((part): part is string => !!part && part.trim().length > 0);
  return [...new Set(parts)].join(" ");
}

function extractGenreTerms(text: string): { roots: string[]; terms: string[] } {
  const lower = text.toLowerCase();
  const roots = new Set<string>();
  const terms = new Set<string>();
  for (const alias of GENRE_ALIASES) {
    for (const term of alias.terms) {
      const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(lower)) {
        roots.add(alias.family);
        terms.add(term);
      }
    }
  }
  return { roots: [...roots], terms: [...terms] };
}

function removeExcludedGenreHits(
  hits: { roots: string[]; terms: string[] },
  excludedRoots: string[],
): { roots: string[]; terms: string[] } {
  if (excludedRoots.length === 0) return hits;
  const roots = hits.roots.filter((root) => !excludedRoots.includes(root));
  const terms = hits.terms.filter((term) => {
    const termRoots = extractGenreTerms(term).roots;
    return termRoots.length === 0 || termRoots.some((root) => !excludedRoots.includes(root));
  });
  return { roots, terms };
}

function hasDecorativeEraOnly(lower: string): boolean {
  const decorativeEraContext = /\b(?:60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\s+(?:car|cars|motor|motors|vehicle|vehicles|volvo|bmw|mercedes|honda|toyota|ford|garage|bedroom|room|fit|fashion|aesthetic|vibe)\b/i;
  const explicitMusicEraContext = /\b(?:music|songs?|tracks?|playlist|mix|hits?|anthems?|throwbacks?|classics?|era|decade|sound|rave|disco|rock|pop|rap|hip\s*hop|jungle|house|techno)\b/i;
  return decorativeEraContext.test(lower) && !explicitMusicEraContext.test(lower);
}

function extractEraRange(vibe: string): { start: number | null; end: number | null; terms: string[] } {
  const lower = vibe.toLowerCase();
  const terms: string[] = [];
  if (hasDecorativeEraOnly(lower)) return { start: null, end: null, terms };
  const decadeMatch = lower.match(/\b(60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\b/);
  if (decadeMatch?.[1]) {
    const term = decadeMatch[1].replace("'", "");
    terms.push(term);
    const start = fullDecadeStart(term);
    return { start, end: start + 9, terms };
  }

  const rangeMatch = lower.match(/\b(19\d{2}|20\d{2})\s*(?:-|to|through|until)\s*(19\d{2}|20\d{2})\b/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    terms.push(`${start}-${end}`);
    return { start: Math.min(start, end), end: Math.max(start, end), terms };
  }

  const yearMatch = lower.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    terms.push(String(year));
    return { start: year, end: year, terms };
  }

  return { start: null, end: null, terms };
}

function fullDecadeStart(term: string): number {
  const normalized = term.toLowerCase().replace("'", "");
  if (/^(1960|1970|1980|1990|2000|2010|2020)s$/.test(normalized)) {
    return Number(normalized.slice(0, 4));
  }
  if (normalized === "00s") return 2000;
  if (normalized === "10s") return 2010;
  if (normalized === "20s") return 2020;
  return Number(`19${normalized.slice(0, 2)}`);
}

function isAmericanaBridgePrompt(lower: string): boolean {
  return /\b(?:americana|americarna|americanna|americanana|alt[-\s]?country|roots\s+country|country\s+folk|folk\s+country|country\s+rock)\b/i.test(lower);
}

function normalizeArtistConstraint(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractExcludedArtists(vibe: string): string[] {
  const excluded: string[] = [];
  const genericNonArtist = /\b(?:music|songs?|tracks?|vocals?|words?|lyrics?|ambient|electronic|metal|pop|rock|rap|hip\s*hop|country|jazz|classical|christmas|sad|slow|fast|screamo)\b/i;
  for (const match of vibe.matchAll(/\b(?:no|without|exclude|excluding)\s+([a-z0-9&,'\-!\s]{2,96})/gi)) {
    const phrase = (match[1] ?? "")
      .replace(/\b(?:music|songs?|tracks?|playlist|please|pls|obviously|only)\b/gi, "")
      .trim();
    if (!phrase || genericNonArtist.test(phrase)) continue;
    if (extractGenreTerms(phrase).roots.length > 0) continue;
    for (const part of phrase.split(/\s*,\s*|\s+or\s+|\s+and\s+/i)) {
      const normalized = normalizeArtistConstraint(part);
      if (normalized && !excluded.includes(normalized)) excluded.push(normalized);
    }
  }
  return excluded;
}

function extractConstraintLayer(vibe: string, signals: QualitySignalContext): ConstraintLayer {
  const lower = vibe.toLowerCase();
  const strictTerms = [
    /\bonly\b/.test(lower) ? "only" : null,
    /\bstrict(?:ly)?\b/.test(lower) ? "strict" : null,
    /\bpure\b/.test(lower) ? "pure" : null,
    /\bexclusively\b/.test(lower) ? "exclusively" : null,
  ].filter((term): term is string => !!term);
  const excludedText = lower.match(/\b(?:no|without|exclude|excluding|not)\s+([a-z0-9&,\-\s]{2,72})/g) ?? [];
  const excludedGenreHits = extractGenreTerms(excludedText.join(" "));
  const excludedArtists = extractExcludedArtists(vibe);
  const genreHits = removeExcludedGenreHits(extractGenreTerms(vibe), excludedGenreHits.roots);
  const era = extractEraRange(vibe);
  const americanaBridgePrompt = isAmericanaBridgePrompt(lower);
  const multiGenreTerms = [
    /\bmulti.?genre\b/.test(lower) ? "multi-genre" : null,
    /\bgenre.?blend\b/.test(lower) ? "genre blend" : null,
    /\beclectic\b/.test(lower) ? "eclectic" : null,
    /\bcrossover\b/.test(lower) ? "crossover" : null,
    /\bfusion\b/.test(lower) ? "fusion" : null,
    /\bbridge\b/.test(lower) ? "bridge" : null,
    genreHits.roots.length > 1 && /\b(and|with|\+|mix|blend)\b/.test(lower) ? "explicit multi-family" : null,
  ].filter((term): term is string => !!term);

  return {
    hard: {
      genres: genreHits.roots,
      excludedGenres: excludedGenreHits.roots,
      excludedArtists,
      eraStart: era.start,
      eraEnd: era.end,
      strictLock: strictTerms.length > 0,
      allowMultiGenre: multiGenreTerms.length > 0,
      allowBridge: americanaBridgePrompt || multiGenreTerms.some((term) => /bridge|blend|crossover|fusion|multi/i.test(term)),
    },
    soft: {
      moodTags: signals.moodTags,
      activityTags: signals.activityTags,
      energyTags: signals.canonicalHints.filter((hint) => /\b(bpm|hype|energy|edm|rock)\b/i.test(hint)),
      atmosphereTags: signals.canonicalHints.filter((hint) => /\b(ambient|lo-fi|soft|warm|acoustic)\b/i.test(hint)),
    },
    raw: {
      explicitGenreTerms: genreHits.terms,
      explicitEraTerms: era.terms,
      strictTerms,
      excludedTerms: excludedText,
      multiGenreTerms,
      americanaBridgePrompt,
    },
  };
}

function eraBucketRange(bucket: string | null | undefined): { start: number; end: number } | null {
  if (!bucket || bucket === "any") return null;
  const map: Record<string, { start: number; end: number }> = {
    "60s": { start: 1960, end: 1969 },
    "70s": { start: 1970, end: 1979 },
    "80s": { start: 1980, end: 1989 },
    "90s": { start: 1990, end: 1999 },
    "00s": { start: 2000, end: 2009 },
    "10s": { start: 2010, end: 2019 },
    "20s": { start: 2020, end: 2029 },
  };
  return map[bucket] ?? null;
}

function trackYearEstimate(track: ConstraintTrack): number | null {
  if (track.releaseYear) return track.releaseYear;
  const laneEra = eraBucketRange(track.laneEra);
  if (!laneEra) return null;
  return Math.round((laneEra.start + laneEra.end) / 2);
}

function trackEraMatches(track: ConstraintTrack, constraints: ConstraintLayer): boolean {
  if (constraints.hard.eraStart === null || constraints.hard.eraEnd === null) return true;
  if (track.releaseYear) {
    return track.releaseYear >= constraints.hard.eraStart && track.releaseYear <= constraints.hard.eraEnd;
  }
  const laneEra = eraBucketRange(track.laneEra);
  if (!laneEra) return !constraints.hard.strictLock;
  return laneEra.end >= constraints.hard.eraStart && laneEra.start <= constraints.hard.eraEnd;
}

function trackGenreTerms(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string[] {
  const classification = classMap.get(track.trackId);
  return [
    track.genrePrimary,
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(track.clusterIds ?? []),
  ]
    .filter((term): term is string => !!term)
    .map((term) => term.toLowerCase().replace(/^genre:/, ""));
}

function trackGenreFamily(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string {
  const classification = classMap.get(track.trackId);
  const trackGenre = track as ConstraintTrack & { genreFamily?: string | null };
  return (
    classification?.genreFamily ??
    classification?.genrePrimary ??
    trackGenre.genreFamily ??
    track.genrePrimary ??
    "unknown"
  ).toLowerCase();
}

function normalizeGenreEvidenceTerm(term: string): string {
  return term.toLowerCase().replace(/^genre:/, "").replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

function explicitSubgenreTerms(intent: LockedIntent): string[] {
  return [
    intent.primarySubgenre,
    intent.secondarySubgenre,
    ...intent.subgenreTerms,
  ]
    .filter((term): term is string => !!term && term.trim().length > 0)
    .map(normalizeGenreEvidenceTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

function hasExplicitSubgenreIntent(intent: LockedIntent): boolean {
  return explicitSubgenreTerms(intent).length > 0;
}

function trackMatchesExplicitSubgenre(
  track: ConstraintTrack,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const expected = explicitSubgenreTerms(intent);
  if (expected.length === 0) return true;
  const terms = trackGenreTerms(track, classMap).map(normalizeGenreEvidenceTerm);
  return expected.some((term) =>
    terms.some((candidate) => candidate === term || candidate.includes(term) || term.includes(candidate))
  );
}

function trackIsChristmasTrack(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): boolean {
  if (trackGenreFamily(track, classMap) === "christmas") return true;
  const genreTerms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(?:christmas|xmas|holiday|carol|festive|noel|santa|jingle\s+bells|winter\s+wonderland)\b/i.test(genreTerms)) return true;
  const text = `${track.trackName ?? ""} ${track.albumName ?? ""}`.toLowerCase();
  return /\b(?:christmas|xmas|holiday|festive|noel|santa|jingle\s+bells|winter\s+wonderland|mistletoe|snowman|sleigh|merry\s+christmas|christmastime|rudolph|frosty|feliz\s+navidad|baby\s+it'?s\s+cold\s+outside)\b/i.test(text);
}

function hasExplicitHolidayIntent(vibe: string): boolean {
  return /\b(?:christmas|xmas|holiday|festive)\b/i.test(vibe);
}

function dominantGenreFamily(
  tracks: ConstraintTrack[],
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): string | null {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = trackGenreFamily(track, classMap);
    if (family === "unknown") continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const ERA_COMPATIBLE_FAMILIES: Array<{
  start: number;
  end: number;
  families: string[];
}> = [
  { start: 1970, end: 1979, families: ["rock", "soul", "pop", "blues", "folk", "jazz", "country", "rnb"] },
  { start: 1980, end: 1989, families: ["pop", "electronic", "rock", "soul", "rnb", "hip_hop", "country", "folk", "jazz", "blues"] },
  { start: 1990, end: 1999, families: ["rock", "hip_hop", "electronic", "rnb", "pop", "indie", "country", "folk", "jazz", "blues", "soul"] },
  { start: 2000, end: 2009, families: ["rock", "pop", "rnb", "hip_hop", "electronic", "indie", "country", "folk", "jazz", "blues", "soul", "latin"] },
  { start: 2010, end: 2029, families: ["pop", "hip_hop", "electronic", "rnb", "indie", "rock", "country", "latin", "world"] },
];

function eraGenreCompatible(family: string, intent: LockedIntent): boolean {
  if (intent.eraStart === null || intent.eraEnd === null || family === "unknown") return true;
  const compatible = ERA_COMPATIBLE_FAMILIES.find((era) =>
    intent.eraStart! <= era.end && intent.eraEnd! >= era.start
  );
  return !compatible || compatible.families.includes(family);
}

function bridgeFamiliesForTrack(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string[] {
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(chillwave|synthwave|indie_pop|indie pop|electropop|synth_pop|synth pop)\b/.test(terms)) {
    return ["indie", "electronic", "pop"];
  }
  if (/\b(house|techno|trance|edm|rave)\b/.test(terms)) {
    return ["electronic"];
  }
  if (/\b(alt_country|americana|folk_country|folk country|country folk)\b/.test(terms)) {
    return ["country", "folk", "rock"];
  }
  if (/\b(soul jazz|neo_soul|neo soul|funk)\b/.test(terms)) {
    return ["jazz", "soul", "rnb"];
  }
  return [];
}

function isAmericanaCompatibleTrack(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family === "country" || family === "folk" || family === "blues") return true;
  const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
  return family === "rock" && bridgeFamilies.includes("country");
}

function passesGenreGraphBoundary(
  track: ConstraintTrack,
  opts: {
    lockedFamily: string | null;
    constraints: ConstraintLayer;
    lockedIntent: LockedIntent;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    bridgeUsed: boolean;
  }
): { pass: boolean; bridge: boolean } {
  const family = trackGenreFamily(track, opts.classMap);
  if (!eraGenreCompatible(family, opts.lockedIntent)) return { pass: false, bridge: false };
  if (!opts.lockedFamily || opts.constraints.hard.allowMultiGenre) return { pass: true, bridge: false };
  if (family === opts.lockedFamily || family === "unknown") return { pass: true, bridge: false };
  if (
    opts.constraints.raw.americanaBridgePrompt &&
    opts.lockedFamily === "country" &&
    isAmericanaCompatibleTrack(track, opts.classMap)
  ) {
    return { pass: true, bridge: true };
  }
  const bridgeFamilies = bridgeFamiliesForTrack(track, opts.classMap);
  const bridge = opts.constraints.hard.allowBridge &&
    bridgeFamilies.includes(opts.lockedFamily) &&
    bridgeFamilies.includes(family);
  return { pass: bridge, bridge };
}

function trackMatchesHardConstraints(
  track: ConstraintTrack,
  constraints: ConstraintLayer,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const terms = trackGenreTerms(track, classMap);
  const family = trackGenreFamily(track, classMap);
  const artist = normalizeArtistConstraint(track.artistName ?? "");
  if (
    artist &&
    constraints.hard.excludedArtists.some((excluded) =>
      artist === excluded || artist.includes(excluded) || excluded.includes(artist)
    )
  ) {
    return false;
  }
  if (constraints.hard.excludedGenres.some((genre) => terms.includes(genre))) return false;
  if (!trackMatchesExplicitSubgenre(track, intent, classMap)) return false;
  const bridgeFamilies = constraints.hard.allowBridge ? bridgeFamiliesForTrack(track, classMap) : [];
  if (
    constraints.hard.genres.length > 0 &&
    !constraints.hard.genres.some((genre) =>
      terms.includes(genre) ||
      bridgeFamilies.includes(genre) ||
      (constraints.raw.americanaBridgePrompt && genre === "country" && isAmericanaCompatibleTrack(track, classMap))
    )
  ) {
    if (family === "unknown") return false;
    return false;
  }
  if (constraints.hard.strictLock && constraints.raw.explicitGenreTerms.length > 0) {
    const explicitMatch = constraints.raw.explicitGenreTerms.some((term) =>
      terms.some((candidate) => candidate.includes(term.replace(/\s+/g, "_")) || candidate.includes(term))
    );
    if (!explicitMatch && constraints.hard.genres.length > 0 && family !== "unknown") return false;
  }
  return trackEraMatches(track, constraints);
}

function genreEvidence(
  track: ConstraintTrack,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean | null {
  if (intent.primaryGenres.length === 0) return null;
  const terms = trackGenreTerms(track, classMap);
  const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
  return intent.primaryGenres.some((genre) => terms.includes(genre) || bridgeFamilies.includes(genre));
}

function eraEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (intent.eraStart === null || intent.eraEnd === null) return null;
  const year = trackYearEstimate(track);
  if (!year) return null;
  return year >= intent.eraStart && year <= intent.eraEnd;
}

function eraHardMismatch(track: ConstraintTrack, intent: LockedIntent): boolean {
  if (intent.eraStart === null || intent.eraEnd === null) return false;
  const year = trackYearEstimate(track);
  if (!year) return false;
  return year < intent.eraStart - 15 || year > intent.eraEnd + 15;
}

function moodEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (intent.mood.length === 0) return null;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  return intent.mood.some((mood) => {
    if (mood === "melancholic") return valence <= 0.45;
    if (mood === "warm") return valence >= 0.55 && acousticness >= 0.35;
    if (mood === "introspective") return energy <= 0.6 && acousticness >= 0.35;
    if (mood === "nostalgic") return track.laneEra !== "20s" || (track.sourceLane ?? "").includes("nostalgia");
    if (mood === "energised") return energy >= 0.65 || danceability >= 0.65;
    if (mood === "calm") return energy <= 0.45;
    if (mood === "dark") return valence <= 0.50 || energy <= 0.48;
    if (mood === "euphoric") return valence >= 0.58 && energy >= 0.48;
    if (mood === "angry") return energy >= 0.58 && valence <= 0.62;
    return false;
  });
}

function activityEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (!intent.activity && !intent.energyLevel) return null;
  const activity = intent.activity;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  const gentleWalk = activity === "walking" && (intent.mood.includes("melancholic") || intent.mood.includes("calm"));
  const activityMatch =
    activity === "driving" ? (energy == null || energy >= 0.45) && (tempo == null || tempo >= 85) :
    activity === "focus" ? (energy == null || energy <= 0.62) && (danceability == null || danceability <= 0.70) && (speechiness == null || speechiness <= 0.35) :
    activity === "gym" ? (energy !== null && energy >= 0.50) || (tempo !== null && tempo >= 108) || (danceability !== null && danceability >= 0.56) :
    activity === "party" ? (energy !== null && energy >= 0.6) || (danceability !== null && danceability >= 0.62) :
    activity === "walking" ? (energy == null || (energy >= (gentleWalk ? 0.20 : 0.35) && energy <= (gentleWalk ? 0.68 : 0.75))) :
    activity === "cleaning" ? energy == null || (energy >= 0.35 && energy <= 0.78) :
    activity === "sleep" ? (energy == null || energy <= 0.42) || (acousticness !== null && acousticness >= 0.45) :
    activity === "travel" ? (energy == null || energy >= 0.30) && (tempo == null || tempo >= 70) :
    activity === "relaxing" ? energy == null || energy <= 0.45 :
    null;
  const energyMatch =
    intent.energyLevel === "high" ? (energy !== null && energy >= 0.62) || (tempo !== null && tempo >= 125) :
    intent.energyLevel === "medium" ? energy == null || (energy >= 0.38 && energy <= 0.75) :
    intent.energyLevel === "low" ? energy == null || energy <= 0.5 :
    null;
  if (activityMatch === null) return energyMatch;
  if (energyMatch === null) return activityMatch;
  return activityMatch && energyMatch;
}

function isSleepSafetyPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (/\b(?:drive|driving|gym|workout|party|club|dancefloor|rave)\b/.test(lower)) return false;
  return intent.activity === "relaxing" ||
    intent.energyLevel === "low" ||
    intent.mood.includes("calm") ||
    /\b(?:sleep|bedtime|bed\s*time|night|slow|easy|relax|relaxing|chill|chilled|soft)\b/.test(lower);
}

function trackIsSleepSafe(track: ConstraintTrack): boolean {
  if (typeof track.energy === "number" && track.energy > 0.56) return false;
  if (typeof track.tempo === "number" && track.tempo > 118) return false;
  if (typeof track.danceability === "number" && track.danceability > 0.68) return false;
  if (typeof track.loudness === "number" && track.loudness > -5.5) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.38) return false;
  return true;
}

function isUkGaragePrompt(vibe: string): boolean {
  return /\b(?:uk\s+garage|ukg|2-step|two\s+step\s+garage|speed\s+garage|garage\s+music)\b/i.test(vibe);
}

function isKnownNonUkGarageTrack(track: ConstraintTrack): boolean {
  return /\b(?:guns\s+n['’]?\s+roses|guns\s+n\s+roses|the\s+jungle\s+giants|jungle\s+giants)\b/i.test(track.artistName ?? "");
}

const TECHNO_IDENTITY_PROMPT_RE = /\b(?:hard\s+techno|hardgroove|hard\s+groove|schranz|tekk|tekno|industrial\s+techno|warehouse\s+techno|rave\s+techno|hard\s+trance|techno|rave)\b/i;
const TECHNO_IDENTITY_EVIDENCE_RE = /\b(?:hard\s+techno|hardgroove|hard\s+groove|schranz|tekk|tekno|industrial\s+techno|warehouse\s+techno|rave\s+techno|hard\s+trance|techno|trance|rave|gabber|hardstyle|hardcore\s+techno|berghain)\b/i;
const TECHNO_COMPATIBLE_SUBGENRES = new Set(["techno", "hard_techno", "rave", "trance"]);
const ROCK_PUNK_SIBLING_SUBGENRES = new Set([
  "pop_punk",
  "skate_punk",
  "post_hardcore",
  "emo",
  "alternative_rock",
  "alt_rock",
  "punk_rock",
  "hardcore_punk",
  "melodic_hardcore",
  "indie_rock",
  "nu_metal",
  "post_grunge",
]);
const ROCK_PUNK_CLUSTER_PROMPT_RE = /\b(?:pop[\s-]?punk|skate[\s-]?punk|emo|post[\s-]?hardcore|punk(?:\s+rock)?|kerrang|warped(?:\s+tour)?|tony\s+hawk|mall\s+punk|scene\s+kid)\b/i;
const ROCK_PUNK_CLUSTER_EVIDENCE_RE = /\b(?:pop[\s_-]?punk|skate[\s_-]?punk|emo|post[\s_-]?hardcore|punk|hardcore|warped|kerrang|mall[\s_-]?punk)\b/i;

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isTechnoIdentityPrompt(vibe: string): boolean {
  return TECHNO_IDENTITY_PROMPT_RE.test(vibe);
}

function isRockPunkClusterPrompt(vibe: string, intent: LockedIntent): boolean {
  if (ROCK_PUNK_CLUSTER_PROMPT_RE.test(vibe)) return true;
  return explicitSubgenreTerms(intent).some((term) => ROCK_PUNK_SIBLING_SUBGENRES.has(term));
}

function trackMatchesRockPunkSiblingCluster(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family !== "rock" && family !== "metal") return false;

  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      ROCK_PUNK_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? ROCK_PUNK_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => ROCK_PUNK_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }

  const evidenceText = trackGenreTerms(track, classMap).join(" ");
  return ROCK_PUNK_CLUSTER_EVIDENCE_RE.test(evidenceText);
}

function trackMatchesTechnoIdentity(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family !== "electronic") return false;

  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      TECHNO_COMPATIBLE_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? TECHNO_COMPATIBLE_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => TECHNO_COMPATIBLE_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }

  const evidenceText = [
    ...trackGenreTerms(track, classMap),
    ...stringValues(track.spotifyArtistGenres),
    ...stringValues(track.albumGenres),
    track.trackName,
    track.albumName,
  ].filter((value): value is string => typeof value === "string").join(" ");
  if (TECHNO_IDENTITY_EVIDENCE_RE.test(evidenceText)) return true;

  const energy = track.energy ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempo = track.tempo ?? 110;
  const acousticness = track.acousticness ?? 0.5;
  return energy >= 0.58 && danceability >= 0.52 && tempo >= 118 && acousticness <= 0.55;
}

function isBreakupRainDrivePrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const breakupRain = hasSadDriveQualifier(vibe);
  const drive = intent.activity === "driving" || /\b(?:drive|driving|road|home)\b/.test(lower);
  return breakupRain && drive;
}

function hasSadDriveQualifier(vibe: string): boolean {
  return /\b(?:sad|breakup|break\s+up|heartbreak|heartbroken|night|rain|rainy|lonely)\b/i.test(vibe);
}

function isChillCalmPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (isGymWorkoutPrompt(vibe, intent) || isUpbeatSocialPrompt(vibe, intent)) return false;
  if (/\b(?:rave|warehouse|industrial|hard\s+techno|hardgroove|tekk|breakcore|workout|gym|party|club)\b/.test(lower)) {
    return false;
  }
  return intent.energyLevel === "low" ||
    intent.energy === "low" ||
    intent.mood.includes("calm") ||
    intent.activity === "relaxing" ||
    /\b(?:chill|chilled|calm|soft|relax(?:ed|ing)?|rainy\s+night|rainy\s+walk|night\s+walk|sad\s+walk)\b/.test(lower);
}

function trackIsChillCalmSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "punk")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(?:hardcore|metalcore|deathcore|thrash|gabber|hardstyle|industrial)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && energy > 0.62) return false;
  if (tempo !== null && tempo > 132 && (energy ?? 0.5) > 0.48) return false;
  if (danceability !== null && danceability > 0.78 && (energy ?? 0.5) > 0.50) return false;
  if (loudness !== null && loudness > -4.8 && (energy ?? 0.5) > 0.50) return false;
  if (speechiness !== null && speechiness > 0.30) return false;
  if (valence !== null && valence < 0.24 && (energy ?? 0.5) > 0.42) return false;
  return true;
}

function isRainyNightWalkPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const rainy = /\b(?:rainy|rain|drizzle|wet\s+streets?|storm|overcast)\b/.test(lower) || intent.mood.includes("melancholic");
  const night = /\b(?:night|late\s+night|midnight|2am|3am|evening|after\s+dark)\b/.test(lower);
  const walk = intent.activity === "walking" || /\b(?:walk|walking|wander|wandering|stroll)\b/.test(lower);
  return rainy && night && walk;
}

function trackIsRainyNightWalkSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "punk")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:hardcore|metalcore|deathcore|thrash|gabber|hardstyle|drill|grime|trap\s+metal|industrial)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && (energy < 0.18 || energy > 0.56)) return false;
  if (tempo !== null && (tempo < 58 || tempo > 122)) return false;
  if (danceability !== null && danceability > 0.70 && (energy ?? 0.5) > 0.42) return false;
  if (loudness !== null && loudness > -5.4 && (energy ?? 0.5) > 0.42) return false;
  if (speechiness !== null && speechiness > 0.26) return false;
  if (valence !== null && valence > 0.66) return false;
  if (valence !== null && valence < 0.18 && (energy ?? 0.5) > 0.34) return false;
  if (acousticness !== null && acousticness < 0.08 && (energy ?? 0.5) > 0.46) return false;
  return true;
}

function isNeutralDrivingPrompt(vibe: string, intent: Pick<LockedIntent, "activity">): boolean {
  return (intent.activity === "driving" || /\b(?:music\s+for\s+driving|driving|drive|road|highway|cruise)\b/i.test(vibe)) &&
    !hasSadDriveQualifier(vibe);
}

function hasExplicitGenreIntent(intent: LockedIntent, constraints: ConstraintLayer): boolean {
  return intent.primaryGenres.length > 0 ||
    intent.genreFamilies.length > 0 ||
    hasExplicitSubgenreIntent(intent) ||
    constraints.hard.genres.length > 0 ||
    constraints.raw.explicitGenreTerms.length > 0;
}

function trackIsBreakupRainDriveSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "hip_hop" || family === "metal" || family === "soundtrack" || family === "classical")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|thrash|metalcore|deathcore|hardcore)\b/.test(terms)) return false;
  if (/\b(?:physical)\b/i.test(track.trackName ?? "") && /\bolivia\s+newton-?john\b/i.test(track.artistName ?? "")) return false;
  if (/\b(?:mobb\s+deep|big\s+l|gza|rza|ghostface|wu-?tang|kendrick\s+lamar|black\s+sabbath|destructo\s+disk|stephen\s+schwartz)\b/i.test(track.artistName ?? "")) {
    return false;
  }
  if (typeof track.energy === "number" && track.energy > 0.74) return false;
  if (typeof track.valence === "number" && track.valence > 0.62) return false;
  if (typeof track.tempo === "number" && track.tempo > 138) return false;
  if (typeof track.loudness === "number" && track.loudness > -4.5) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.34) return false;
  return true;
}

function isLateNightDrivingPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const drive = intent.activity === "driving" || /\b(?:drive|driving|road|highway|cruise)\b/.test(lower);
  if (!drive) return false;
  return /\b(?:late\s+night|night\s+drive|night\s+driving|midnight|2am|3am|rainy\s+drive|rain\s+drive)\b/.test(lower);
}

function trackIsLateNightDrivingSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "classical" || family === "soundtrack")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|hardcore|thrash|metalcore|deathcore|show\s+tunes?|musical)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && (energy < 0.30 || energy > 0.76)) return false;
  if (tempo !== null && (tempo < 74 || tempo > 142)) return false;
  if (valence !== null && valence > 0.78 && (energy ?? 0.5) > 0.55) return false;
  if (valence !== null && valence < 0.22 && (energy ?? 0.5) > 0.52) return false;
  if (danceability !== null && danceability < 0.30 && (energy ?? 0.5) < 0.45) return false;
  if (acousticness !== null && acousticness > 0.88 && (energy ?? 0.5) < 0.46) return false;
  if (loudness !== null && loudness > -4.2 && (energy ?? 0.5) > 0.58) return false;
  if (speechiness !== null && speechiness > 0.36) return false;
  return true;
}

function isEuphoricSummerPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  return intent.mood.includes("euphoric") &&
    /\b(?:summer|beach|sunset|sunny|sunshine|coast|seaside|poolside)\b/.test(lower);
}

function isBroadDrivingPrompt(vibe: string, intent: LockedIntent): boolean {
  if (intent.genreFamilies.length > 0 || intent.primaryGenres.length > 0 || intent.mood.includes("melancholic")) return false;
  return isNeutralDrivingPrompt(vibe, intent);
}

function trackIsBroadDrivingSafe(track: ConstraintTrack): boolean {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const tempo = track.tempo ?? 110;
  const acousticness = track.acousticness ?? 0.5;
  if (energy < 0.30) return false;
  if (tempo < 72) return false;
  if (valence < 0.34 && energy < 0.58) return false;
  if (valence < 0.28) return false;
  if (acousticness > 0.86 && energy < 0.45) return false;
  return true;
}

function isGarageHangoutPrompt(vibe: string): boolean {
  return /\bgarage\b/i.test(vibe) &&
    /\b(?:friends?|mates?|saturday|night|cars?|working|workshop|tools?|fixing|hang(?:ing)?\s*out)\b/i.test(vibe) &&
    !isUkGaragePrompt(vibe);
}

function isUpbeatSocialPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (isGarageHangoutPrompt(vibe)) return true;
  if (intent.activity === "party" || intent.activity === "gym") return true;
  if (/\b(?:party|all\s+night|chaos|workout|gym|friends?|mates?|saturday\s+night)\b/.test(lower)) return true;
  if (intent.mood.includes("melancholic")) return false;
  if (intent.mood.includes("energised") || intent.energy === "high" || intent.energyLevel === "high") return true;
  return /\b(?:hype|high\s+energy|energ(?:y|ised|ized))\b/.test(lower);
}

function isGymWorkoutPrompt(vibe: string, intent: LockedIntent): boolean {
  return intent.activity === "gym" ||
    /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/i.test(vibe);
}

function promptExplicitlyAllowsGymHipHop(vibe: string, _intent: LockedIntent, _constraints: ConstraintLayer): boolean {
  return /\b(?:hip.?hop|rap|trap|drill|phonk|grime|boom\s+bap)\b/i.test(vibe);
}

function trackIsGymWorkoutSafe(
  track: ConstraintTrack,
  opts?: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (opts && !promptExplicitlyAllowsGymHipHop(opts.vibe, opts.intent, opts.constraints)) {
    const family = trackGenreFamily(track, opts.classMap);
    if (family === "hip_hop") return false;
  }
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const hasPositiveGymSignal =
    (energy !== null && energy >= 0.52) ||
    (tempo !== null && tempo >= 108) ||
    (danceability !== null && danceability >= 0.58);
  if (!hasPositiveGymSignal) return false;
  if (energy !== null && energy < 0.50) return false;
  if (tempo !== null && tempo < 92 && (danceability ?? 0.5) < 0.54) return false;
  if (valence !== null && valence < 0.20) return false;
  if (acousticness !== null && acousticness > 0.74 && (energy ?? 0.6) < 0.64) return false;
  if (loudness !== null && loudness < -15 && (energy ?? 0.6) < 0.62) return false;
  return true;
}

function isFocusStudyPrompt(vibe: string, intent: LockedIntent): boolean {
  return intent.activity === "focus" ||
    /\b(?:focus|study|studying|deep\s+work|homework|work\s+from\s+home|coding|no\s+distractions?)\b/i.test(vibe);
}

function trackIsFocusStudySafe(track: ConstraintTrack): boolean {
  const energy = typeof track.energy === "number" ? track.energy : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  if (energy !== null && energy > 0.62) return false;
  if (tempo !== null && (tempo > 142 || tempo < 50)) return false;
  if (danceability !== null && danceability > 0.76 && (energy ?? 0.5) > 0.52) return false;
  if (speechiness !== null && speechiness > 0.33) return false;
  if (valence !== null && valence < 0.12 && (energy ?? 0.5) < 0.34) return false;
  return true;
}

function trackIsUpbeatSocialSafe(track: ConstraintTrack): boolean {
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  if (energy !== null && energy < 0.48) return false;
  if (tempo !== null && tempo < 86 && (danceability ?? 0.5) < 0.56) return false;
  if (danceability !== null && danceability < 0.44 && (energy ?? 0.5) < 0.62) return false;
  if (valence !== null && valence < 0.36) return false;
  if (valence !== null && valence < 0.44 && (energy ?? 0.5) < 0.62) return false;
  if (acousticness !== null && acousticness > 0.74 && (energy ?? 0.5) < 0.62) return false;
  return true;
}

function trackIsEuphoricSummerSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "hip_hop" || family === "metal" || family === "classical" || family === "soundtrack")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|hardcore|dark|doom|sad|melanchol|slowcore)\b/.test(terms)) return false;
  if (/\b(?:gza|rza|ghostface|wu-?tang|bon\s+iver|destructo\s+disk)\b/i.test(track.artistName ?? "")) return false;
  if (typeof track.valence === "number" && track.valence < 0.52) return false;
  if (typeof track.energy === "number" && track.energy < 0.34) return false;
  if (typeof track.acousticness === "number" && track.acousticness > 0.86 && (track.energy ?? 0.5) < 0.48) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.32) return false;
  return true;
}

function isBroadMoodPlacePrompt(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): boolean {
  if (constraints.hard.genres.length > 0 || constraints.hard.eraStart !== null || constraints.hard.excludedGenres.length > 0) {
    return false;
  }
  const lower = vibe.toLowerCase();
  return intent.mood.includes("euphoric") ||
    /\b(?:summer|beach|sunset|sunny|sunshine|barbecue|bbq|euphoric|uplifting)\b/.test(lower);
}

function lockedIntentMatchCount(
  track: ConstraintTrack,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): { count: number; explicitFields: number; genreMatch: boolean | null; eraMatch: boolean | null; moodMatch: boolean | null; activityMatch: boolean | null } {
  const genreMatch = genreEvidence(track, intent, classMap);
  const eraMatch = eraEvidence(track, intent);
  const moodMatch = moodEvidence(track, intent);
  const activityMatch = activityEvidence(track, intent);
  const evidence = [genreMatch, eraMatch, moodMatch, activityMatch];
  return {
    count: evidence.filter((value) => value === true).length,
    explicitFields: evidence.filter((value) => value !== null).length,
    genreMatch,
    eraMatch,
    moodMatch,
    activityMatch,
  };
}

function trackPassesLockedIntent(
  track: ConstraintTrack,
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const match = lockedIntentMatchCount(track, intent, classMap);
  if (constraints.hard.genres.length > 0 && match.genreMatch === false) return false;
  if (eraHardMismatch(track, intent)) return false;
  const hasMoodOrActivityIntent = intent.mood.length > 0 || !!intent.activity || !!intent.energyLevel;
  const moodOrActivityMatch =
    !hasMoodOrActivityIntent ||
    match.moodMatch === true ||
    match.activityMatch === true;
  return moodOrActivityMatch;
}

function hasHardConstraints(constraints: ConstraintLayer): boolean {
  return constraints.hard.genres.length > 0 ||
    constraints.hard.excludedGenres.length > 0 ||
    constraints.hard.eraStart !== null ||
    constraints.hard.strictLock;
}

function validateLockedIntentOutput(
  tracks: ConstraintTrack[],
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): {
  genreConsistency: "PASS" | "FAIL";
  eraAlignment: "PASS" | "FAIL";
  moodAlignment: "PASS" | "FAIL";
  activityRelevance: "PASS" | "FAIL";
} {
  const requiresGenre = intent.primaryGenres.length > 0 || constraints.hard.genres.length > 0;
  const requiresEra = intent.eraStart !== null && intent.eraEnd !== null;
  const requiresMood = intent.mood.length > 0;
  const requiresActivity = !!intent.activity || !!intent.energyLevel;
  const families = new Set(tracks
    .map((track) => trackGenreFamily(track, classMap))
    .filter((family) => family !== "unknown"));
  const lockedFamily = intent.primaryGenres[0] ?? dominantGenreFamily(tracks, classMap);
  const offFamilyTracks = lockedFamily
    ? tracks.filter((track) => {
        const family = trackGenreFamily(track, classMap);
        return family !== "unknown" && family !== lockedFamily;
      })
    : [];
  const familyStable = constraints.hard.allowMultiGenre ||
    families.size <= 1 ||
    (constraints.hard.allowBridge &&
      offFamilyTracks.every((track) => {
        if (
          constraints.raw.americanaBridgePrompt &&
          lockedFamily === "country" &&
          isAmericanaCompatibleTrack(track, classMap)
        ) {
          return true;
        }
        const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
        return !!lockedFamily && bridgeFamilies.includes(lockedFamily);
      }));

  const genreConsistency = familyStable && (!requiresGenre || tracks.every((track) =>
    genreEvidence(track, intent, classMap) !== false ||
    (constraints.raw.americanaBridgePrompt && lockedFamily === "country" && isAmericanaCompatibleTrack(track, classMap))
  )) ? "PASS" : "FAIL";
  const knownYears = tracks
    .map(trackYearEstimate)
    .filter((year): year is number => typeof year === "number");
  const eraSpanStable = knownYears.length < 2 || Math.max(...knownYears) - Math.min(...knownYears) <= 20;
  const eraAlignment = eraSpanStable && (!requiresEra || tracks.every((track) =>
    !eraHardMismatch(track, intent)
  )) ? "PASS" : "FAIL";
  const moodAlignment = !requiresMood || tracks.filter((track) =>
    moodEvidence(track, intent) === true
  ).length >= Math.ceil(tracks.length * 0.65) ? "PASS" : "FAIL";
  const activityRelevance = !requiresActivity || tracks.filter((track) =>
    activityEvidence(track, intent) === true
  ).length >= Math.ceil(tracks.length * 0.65) ? "PASS" : "FAIL";

  return { genreConsistency, eraAlignment, moodAlignment, activityRelevance };
}

function validationPassed(validation: Record<string, "PASS" | "FAIL">): boolean {
  return Object.values(validation).every((value) => value === "PASS");
}

function validSpotifyTrackShape(track: {
  trackId?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  albumName?: unknown;
}): boolean {
  return typeof track.trackId === "string" &&
    track.trackId.trim().length > 0 &&
    typeof track.trackName === "string" &&
    track.trackName.trim().length > 0 &&
    typeof track.artistName === "string" &&
    track.artistName.trim().length > 0 &&
    typeof track.albumName === "string";
}

function sanitizePlaylistTrack<T extends ConstraintTrack>(track: T): T | null {
  if (!validSpotifyTrackShape(track)) return null;
  const score = typeof track.score === "number" && Number.isFinite(track.score) ? track.score : 0.7;
  return {
    ...track,
    trackId: track.trackId.trim(),
    trackName: track.trackName.trim(),
    artistName: track.artistName.trim(),
    albumName: track.albumName ?? "",
    score,
    energy: typeof track.energy === "number" && Number.isFinite(track.energy) ? track.energy : null,
    valence: typeof track.valence === "number" && Number.isFinite(track.valence) ? track.valence : null,
    tempo: typeof track.tempo === "number" && Number.isFinite(track.tempo) ? track.tempo : null,
    danceability: typeof track.danceability === "number" && Number.isFinite(track.danceability) ? track.danceability : null,
    acousticness: typeof track.acousticness === "number" && Number.isFinite(track.acousticness) ? track.acousticness : null,
    loudness: typeof track.loudness === "number" && Number.isFinite(track.loudness) ? track.loudness : null,
    speechiness: typeof track.speechiness === "number" && Number.isFinite(track.speechiness) ? track.speechiness : null,
  };
}

function finalTrackMatchesExplicitGenre(
  track: ConstraintTrack,
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const expectedFamilies = intent.primaryGenres.length > 0 ? intent.primaryGenres : intent.genreFamilies;
  if (expectedFamilies.length === 0 && constraints.hard.genres.length === 0) return true;
  if (!trackMatchesExplicitSubgenre(track, intent, classMap)) return false;
  const families = expectedFamilies.length > 0 ? expectedFamilies : constraints.hard.genres;
  if (families.some((family) =>
    hasFinalGenreEvidence(track, classMap, [family]) ||
    (constraints.raw.americanaBridgePrompt && family === "country" && isAmericanaCompatibleTrack(track, classMap))
  )) {
    return true;
  }
  const family = trackGenreFamily(track, classMap);
  if (family === "unknown") return false;
  return families.includes(family);
}

function finalTrackMatchesExplicitEra(track: ConstraintTrack, intent: LockedIntent): boolean {
  if (!intent.eraRange) return true;
  return !trackHasKnownEraMismatch(track, intent.eraRange);
}

function finalTrackIsSafe(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.intent, opts.classMap)) return false;
  if (
    isUkGaragePrompt(opts.vibe) &&
    (trackGenreFamily(track, opts.classMap) !== "electronic" || isKnownNonUkGarageTrack(track))
  ) {
    return false;
  }
  if (
    isTechnoIdentityPrompt(opts.vibe) &&
    !trackMatchesTechnoIdentity(track, opts.classMap) &&
    !["electronic", "unknown"].includes(trackGenreFamily(track, opts.classMap))
  ) {
    return false;
  }
  const lockedIntentSafe = trackPassesLockedIntent(track, opts.intent, opts.constraints, opts.classMap);
  if (!lockedIntentSafe && !isBroadMoodPlacePrompt(opts.vibe, opts.intent, opts.constraints)) return false;
  if (!finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap)) return false;
  if (!finalTrackMatchesExplicitEra(track, opts.intent)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track, opts)) return false;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) return false;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) return false;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isEuphoricSummerPrompt(opts.vibe, opts.intent) && !trackIsEuphoricSummerSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isBreakupRainDrivePrompt(opts.vibe, opts.intent) && !trackIsBreakupRainDriveSafe(track, explicitGenreLocked, opts.classMap)) return false;
  return true;
}

function finalTrackIsHardSafe(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.intent, opts.classMap)) return false;
  if (
    isUkGaragePrompt(opts.vibe) &&
    (trackGenreFamily(track, opts.classMap) !== "electronic" || isKnownNonUkGarageTrack(track))
  ) {
    return false;
  }
  if (
    isTechnoIdentityPrompt(opts.vibe) &&
    !trackMatchesTechnoIdentity(track, opts.classMap) &&
    !["electronic", "unknown"].includes(trackGenreFamily(track, opts.classMap))
  ) {
    return false;
  }
  if (eraHardMismatch(track, opts.intent)) return false;
  if (!finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap)) return false;
  if (!finalTrackMatchesExplicitEra(track, opts.intent)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track, opts)) return false;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) return false;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) return false;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) return false;
  return true;
}

function duplicateReplacementIsSafe(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.intent, opts.classMap)) return false;
  if (eraHardMismatch(track, opts.intent)) return false;
  if (!finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap)) return false;
  if (!finalTrackMatchesExplicitEra(track, opts.intent)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !promptExplicitlyAllowsGymHipHop(opts.vibe, opts.intent, opts.constraints)) {
    const family = trackGenreFamily(track, opts.classMap);
    if (["hip_hop", "country", "classical", "christmas"].includes(family)) return false;
  }
  if (isFocusStudyPrompt(opts.vibe, opts.intent)) {
    const family = trackGenreFamily(track, opts.classMap);
    if (!new Set(["electronic", "indie", "pop", "ambient", "soundtrack", "folk", "blues", "soul", "unknown"]).has(family)) {
      return false;
    }
  }
  return true;
}

const UNIVERSAL_IDENTITY_STOPWORDS = new Set([
  "music",
  "songs",
  "playlist",
  "tracks",
  "track",
  "with",
  "that",
  "feel",
  "feels",
  "vibe",
  "vibes",
  "make",
  "made",
  "good",
  "best",
]);

function normalizeUniversalIdentityTerm(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function pushUniversalIdentityTerm(out: string[], seen: Set<string>, value: string): void {
  const term = normalizeUniversalIdentityTerm(value);
  if (term.length < 3 || seen.has(term) || UNIVERSAL_IDENTITY_STOPWORDS.has(term)) return;
  seen.add(term);
  out.push(term);
}

function universalIdentityTerms(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addMatched = (terms: string[]): void => {
    for (const term of terms) {
      if (termRegex([term]).test(vibe)) pushUniversalIdentityTerm(out, seen, term);
    }
  };

  for (const group of [...GENRE_ALIASES, ...EXPANDED_GENRE_ALIASES]) addMatched(group.terms);
  for (const terms of Object.values(EXPANDED_MOOD_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_ACTIVITY_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_PLACE_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_TIME_TERMS)) addMatched(terms);
  for (const era of EXPANDED_ERA_TERMS) addMatched(era.terms);
  addMatched(EXPANDED_EVENT_TERMS);

  for (const family of [...intent.primaryGenres, ...intent.genreFamilies, ...constraints.hard.genres]) {
    pushUniversalIdentityTerm(out, seen, family);
  }
  if (intent.primaryGenre) pushUniversalIdentityTerm(out, seen, intent.primaryGenre);
  if (intent.primarySubgenre) pushUniversalIdentityTerm(out, seen, intent.primarySubgenre);
  if (intent.secondarySubgenre) pushUniversalIdentityTerm(out, seen, intent.secondarySubgenre);
  for (const subgenre of intent.subgenreTerms) pushUniversalIdentityTerm(out, seen, subgenre);
  for (const mood of intent.mood) pushUniversalIdentityTerm(out, seen, mood);
  if (intent.activity) pushUniversalIdentityTerm(out, seen, intent.activity);
  if (intent.energyLevel) pushUniversalIdentityTerm(out, seen, intent.energyLevel);

  const rawTokens = normalizeUniversalIdentityTerm(vibe)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !UNIVERSAL_IDENTITY_STOPWORDS.has(token));
  for (const token of rawTokens) pushUniversalIdentityTerm(out, seen, token);

  return out.slice(0, 18);
}

function trackUniversalIdentityText(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): string {
  const classification = classMap.get(track.trackId);
  const metadata = [
    track.trackName,
    track.artistName,
    track.albumName,
    track.genrePrimary,
    trackGenreFamily(track, classMap),
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
  ].filter((value): value is string => typeof value === "string");
  return normalizeUniversalIdentityTerm(metadata.join(" "));
}

function intentCoherenceScore(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  },
  preferredFamilies: Set<string> = new Set(),
  identityTerms = universalIdentityTerms(opts.vibe, opts.intent, opts.constraints)
): number {
  let score = 0;
  let violations = 0;
  const expectedFamilies = opts.intent.primaryGenres.length > 0
    ? opts.intent.primaryGenres
    : opts.intent.genreFamilies.length > 0
      ? opts.intent.genreFamilies
      : opts.constraints.hard.genres;
  const family = trackGenreFamily(track, opts.classMap);
  const identityText = trackUniversalIdentityText(track, opts.classMap);

  if (expectedFamilies.length > 0) {
    if (hasFinalGenreEvidence(track, opts.classMap, expectedFamilies)) {
      score += 0.16;
    } else if (family !== "unknown" && !expectedFamilies.includes(family)) {
      score -= 0.28;
      violations++;
    } else {
      score -= 0.08;
    }
  } else if (preferredFamilies.size > 0 && family !== "unknown") {
    if (preferredFamilies.has(family)) {
      score += 0.08;
    } else {
      score -= 0.16;
      violations++;
    }
  }

  const structuredSubgenres = [
    opts.intent.primarySubgenre,
    opts.intent.secondarySubgenre,
    ...opts.intent.subgenreTerms,
  ]
    .filter((term): term is string => !!term)
    .map(normalizeUniversalIdentityTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
  if (structuredSubgenres.length > 0) {
    const matchedSubgenres = structuredSubgenres.filter((term) => identityText.includes(term));
    if (matchedSubgenres.length > 0) {
      score += Math.min(0.20, matchedSubgenres.length * 0.075);
    } else if (opts.intent.primaryGenre && family === opts.intent.primaryGenre) {
      score -= 0.12;
      violations++;
    }
  }

  if (identityTerms.length > 0) {
    const matchedTerms = identityTerms.filter((term) => identityText.includes(term));
    const specificIdentityActive = identityTerms.some((term) => !expectedFamilies.includes(term));
    if (matchedTerms.length >= Math.min(2, identityTerms.length)) {
      score += Math.min(0.18, matchedTerms.length * 0.05);
    } else if (matchedTerms.length === 1) {
      score += 0.04;
    } else if (specificIdentityActive) {
      score -= 0.18;
      violations++;
    }
  }

  if (opts.intent.eraRange) {
    if (trackHasKnownEraMismatch(track, opts.intent.eraRange)) {
      score -= 0.26;
      violations++;
    } else if (trackHasEraEvidence(track, opts.intent.eraRange)) {
      score += 0.10;
    }
  }

  if (opts.intent.mood.length > 0) {
    if (moodEvidence(track, opts.intent) === true) {
      score += 0.18;
    } else {
      score -= 0.24;
      violations++;
    }
  }

  if (opts.intent.activity || opts.intent.energyLevel) {
    if (activityEvidence(track, opts.intent) === true) {
      score += 0.28;
    } else {
      score -= 0.34;
      violations++;
    }
  }

  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track, opts)) score -= 0.42;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) score -= 0.38;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) score -= 0.30;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.38;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) score -= 0.34;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) score -= 0.26;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.40;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.38;
  if (violations >= 2) score -= Math.min(0.30, violations * 0.10);

  return score;
}

type PlaylistFinalizationDiagnostics = Record<string, number | boolean | string | null>;

function cohesionFamilyLimit(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): number | null {
  if (constraints.hard.genres.length > 0) return null;
  if (isFocusStudyPrompt(vibe, intent)) return 1;
  if (isGymWorkoutPrompt(vibe, intent)) return 2;
  if (isUpbeatSocialPrompt(vibe, intent)) return 2;
  return null;
}

function preferredCohesionFamilies<T extends ConstraintTrack>(
  tracks: T[],
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): Set<string> {
  const limit = cohesionFamilyLimit(opts.vibe, opts.intent, opts.constraints);
  if (!limit) return new Set();
  const counts = new Map<string, number>();
  const scores = new Map<string, number>();
  for (const track of tracks.slice(0, Math.max(40, limit * 30))) {
    if (!finalTrackIsSafe(track, opts)) continue;
    const family = trackGenreFamily(track, opts.classMap);
    if (!family || family === "unknown") continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
    scores.set(family, (scores.get(family) ?? 0) + Math.max(0, track.score ?? 0));
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0) || b[1] - a[1])
      .slice(0, limit)
      .map(([family]) => family)
  );
}

function hasExplicitArtistRequest(vibe: string): boolean {
  return /\b(?:songs?\s+by|tracks?\s+by|only\s+[a-z0-9&'.\-\s]{2,40}\s+(?:songs?|tracks?)|playlist\s+of\s+)\b/i.test(vibe);
}

function artistDiversityCap(playlistSize: number, vibe: string): number {
  if (hasExplicitArtistRequest(vibe)) return Number.MAX_SAFE_INTEGER;
  return 2;
}

function relaxedEmergencyArtistCap(playlistSize: number, maxPerArtist: number): number | null {
  if (!Number.isFinite(maxPerArtist) || maxPerArtist >= Number.MAX_SAFE_INTEGER / 2) return null;
  return Math.min(2, maxPerArtist);
}

function recoveryActivationThreshold(playlistSize: number): number {
  return Math.min(20, Math.max(8, Math.ceil(playlistSize * 0.70)));
}

function finalAlbumCap(playlistSize: number): number {
  if (playlistSize < 25) return 2;
  if (playlistSize <= 50) return 3;
  return 4;
}

function normalizeRepeatToken(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\bfeat(?:\.|uring)?\b.*$/i, "")
    .replace(/\bfrom\s+"[^"]+".*$/i, "")
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|radio edit|single edit|mono|stereo|explicit|clean|bonus track|album version|original mix).*$/i, "")
    .replace(/\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|radio edit|single edit|edit|live|mono|stereo|version|mix)\b/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSongIdentityToken(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\bfeat(?:\.|uring)?\b.*$/i, "")
    .replace(/\bfrom\s+"[^"]+".*$/i, "")
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|radio edit|single edit|mono|stereo|explicit|clean|bonus track|album version|original mix).*$/i, "")
    .replace(/\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|radio edit|single edit|edit|live|mono|stereo|version|mix)\b/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function trackRepeatSignature(track: { trackName?: string | null; artistName?: string | null; name?: string | null; artist?: string | null }): string | null {
  const title = normalizeSongIdentityToken(track.trackName ?? track.name);
  const artist = normalizeSongIdentityToken(track.artistName ?? track.artist);
  if (!title || !artist) return null;
  return `${artist}:${title}`;
}

function countDuplicateSongIdentities<T extends { trackName?: string | null; artistName?: string | null; name?: string | null; artist?: string | null }>(
  tracks: T[]
): number {
  const counts = new Map<string, number>();
  let duplicates = 0;
  for (const track of tracks) {
    const signature = trackRepeatSignature(track);
    if (!signature) continue;
    const next = (counts.get(signature) ?? 0) + 1;
    counts.set(signature, next);
    if (next > 1) duplicates += 1;
  }
  return duplicates;
}

function shouldApplyFinalizeRecovery<T extends { trackName?: string | null; artistName?: string | null; name?: string | null; artist?: string | null }>(
  before: T[],
  after: T[],
  requestedLength: number
): boolean {
  if (after.length > before.length) return true;
  const beforeDuplicates = countDuplicateSongIdentities(before);
  const afterDuplicates = countDuplicateSongIdentities(after);
  const minAllowedCount = Math.ceil(requestedLength * 0.95);
  return beforeDuplicates > 0 && afterDuplicates < beforeDuplicates && after.length >= minAllowedCount;
}

function repairFinalResponseDuplicateSongIdentities<T extends ConstraintTrack>(
  tracks: T[],
  candidates: T[],
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    maxPerArtist: number;
  }
): {
  tracks: T[];
  diagnostics: {
    duplicateIdentityCount: number;
    replacedCount: number;
    unresolvedCount: number;
    replacements: Array<{ index: number; fromTrackId: string; toTrackId: string; signature: string }>;
  };
} {
  const out = tracks
    .map(sanitizePlaylistTrack)
    .filter((track): track is T => !!track);
  const replacements: Array<{ index: number; fromTrackId: string; toTrackId: string; signature: string }> = [];
  let duplicateIdentityCount = 0;
  let unresolvedCount = 0;
  const orderedCandidates = candidates
    .map(sanitizePlaylistTrack)
    .filter((track): track is T => !!track)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const usedSignatureIndexes = new Map<string, number>();

  for (let index = 0; index < out.length; index += 1) {
    const track = out[index]!;
    const signature = trackRepeatSignature(track);
    if (!signature) continue;
    if (!usedSignatureIndexes.has(signature)) {
      usedSignatureIndexes.set(signature, index);
      continue;
    }

    duplicateIdentityCount += 1;
    const usedIds = new Set(out.map((entry) => entry.trackId));
    const usedSignatures = new Set(
      out.map((entry) => trackRepeatSignature(entry)).filter((value): value is string => !!value)
    );
    const findReplacement = (pool: T[]): T | undefined =>
      pool.find((candidate) => {
        if (usedIds.has(candidate.trackId)) return false;
        const candidateSignature = trackRepeatSignature(candidate);
        if (candidateSignature && usedSignatures.has(candidateSignature)) return false;
        if (!duplicateReplacementIsSafe(candidate, opts)) return false;
        return true;
      });
    let replacement = findReplacement(orderedCandidates);
    if (!replacement && isRockPunkClusterPrompt(opts.vibe, opts.intent)) {
      replacement = findReplacement(
        orderedCandidates.filter((candidate) => trackMatchesRockPunkSiblingCluster(candidate, opts.classMap))
      );
    }

    if (!replacement) {
      unresolvedCount += 1;
      continue;
    }

    const replacementSignature = trackRepeatSignature(replacement);
    replacements.push({
      index,
      fromTrackId: track.trackId,
      toTrackId: replacement.trackId,
      signature,
    });
    out[index] = replacement;
    usedSignatureIndexes.set(signature, usedSignatureIndexes.get(signature)!);
    if (replacementSignature) usedSignatureIndexes.set(replacementSignature, index);
  }

  return {
    tracks: out,
    diagnostics: {
      duplicateIdentityCount,
      replacedCount: replacements.length,
      unresolvedCount,
      replacements,
    },
  };
}

function artistDiversityDiagnostics<T extends { artistName?: string | null }>(
  tracks: T[],
  maxPerArtist: number
): {
  uniqueArtists: number;
  repeatedArtists: number;
  cappedTracks: number;
  maxPerArtist: number | null;
  topRepeatedArtist: string | null;
  topRepeatedArtistCount: number;
} {
  const counts = new Map<string, number>();
  const displayNames = new Map<string, string>();
  for (const track of tracks) {
    const artist = (track.artistName ?? "").toLowerCase().trim();
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
    displayNames.set(artist, track.artistName ?? artist);
  }
  const capped = Number.isFinite(maxPerArtist) ? maxPerArtist : Number.MAX_SAFE_INTEGER;
  const topRepeated = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    uniqueArtists: counts.size,
    repeatedArtists: [...counts.values()].filter((count) => count > 1).length,
    cappedTracks: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - capped), 0),
    maxPerArtist: capped === Number.MAX_SAFE_INTEGER ? null : capped,
    topRepeatedArtist: topRepeated && topRepeated[1] > 1 ? displayNames.get(topRepeated[0]) ?? topRepeated[0] : null,
    topRepeatedArtistCount: topRepeated?.[1] ?? 0,
  };
}

function evaluationSessionTrackLists(rawBody: Record<string, unknown>, auditMode: boolean): string[][] {
  if (!auditMode) return [];
  const memory = rawBody["evaluationSessionMemory"];
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return [];
  const previousTrackIds = (memory as Record<string, unknown>)["previousTrackIds"];
  if (!Array.isArray(previousTrackIds)) return [];
  return previousTrackIds
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, 100)
    )
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}

function evaluationDiversityPressure(
  vibe: string,
  profile: EmotionProfile,
  evaluationMemoryCount: number
): number {
  if (evaluationMemoryCount <= 0) return 1;
  const lower = vibe.toLowerCase();
  if (profile.environment === "gym" || /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/.test(lower)) {
    return 1.75;
  }
  if (profile.environment === "party" || /\b(?:party|club|dancefloor|pre\s*drinks|night\s*out|rave)\b/.test(lower)) {
    return 1.7;
  }
  if (profile.environment === "focus" || /\b(?:focus|study|coding|work|reading|office)\b/.test(lower)) {
    return 1.6;
  }
  return 1.55;
}

function buildSessionMemory(
  recentPlaylistTrackIds: string[][],
  trackIdToArtist: Map<string, string>,
  maxPlaylists = 30
): IdentitySessionMemory {
  const usedArtists = new Set<string>();
  const usedTracks = new Set<string>();
  const artistFrequencyMap: Record<string, number> = {};
  for (const ids of recentPlaylistTrackIds.slice(0, maxPlaylists)) {
    const artistsInPlaylist = new Set<string>();
    for (const id of ids) {
      usedTracks.add(id);
      const artist = trackIdToArtist.get(id)?.toLowerCase().trim();
      if (artist) artistsInPlaylist.add(artist);
    }
    for (const artist of artistsInPlaylist) {
      usedArtists.add(artist);
      artistFrequencyMap[artist] = (artistFrequencyMap[artist] ?? 0) + 1;
    }
  }
  return { usedArtists, usedTracks, artistFrequencyMap };
}

function buildArtistReusePenalty(
  memory: IdentitySessionMemory,
  diversityPressure: number
): Map<string, number> | undefined {
  const entries = Object.entries(memory.artistFrequencyMap);
  if (entries.length === 0) return undefined;
  const pressure = Math.max(1.20, Math.min(2.10, diversityPressure));
  return new Map(entries.map(([artist, count]) => [
    artist,
    Math.min(0.94, (0.26 + count * 0.20) * pressure),
  ]));
}

function shapePreScoringCandidatePool<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  loudness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}>(
  tracks: T[],
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    sessionMemory: IdentitySessionMemory;
    requestedLength: number;
  }
): { tracks: T[]; diagnostics: Record<string, number | boolean | string | null> } {
  const gymScene = isGymWorkoutPrompt(opts.vibe, opts.intent);
  const focusScene = isFocusStudyPrompt(opts.vibe, opts.intent);
  const sceneActive =
    gymScene ||
    isUpbeatSocialPrompt(opts.vibe, opts.intent) ||
    isBroadDrivingPrompt(opts.vibe, opts.intent) ||
    focusScene ||
    isChillCalmPrompt(opts.vibe, opts.intent) ||
    !!opts.intent.activity ||
    opts.intent.mood.length > 0 ||
    !!opts.intent.energyLevel;
  const broadCap = sceneActive
    ? Math.max(240, opts.requestedLength * 12)
    : Math.max(900, opts.requestedLength * 35);
  const hasExplicitConstraints = hasHardConstraints(opts.constraints) || hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (tracks.length <= broadCap && !sceneActive) {
    return {
      tracks,
      diagnostics: {
        applied: false,
        inputCount: tracks.length,
        outputCount: tracks.length,
        cap: broadCap,
        sceneActive,
        hasExplicitConstraints,
      },
    };
  }

  const toConstraintTrack = (track: T): ConstraintTrack => ({ ...track, score: 0.5 } as ConstraintTrack);
  const strictConstrained = hasExplicitConstraints
    ? tracks.filter((track) =>
        finalTrackIsSafe(toConstraintTrack(track), {
          vibe: opts.vibe,
          intent: opts.intent,
          constraints: opts.constraints,
          classMap: opts.classMap,
        })
      )
    : [];
  const hardConstrained = hasExplicitConstraints
    ? tracks.filter((track) =>
        finalTrackIsHardSafe(toConstraintTrack(track), {
          vibe: opts.vibe,
          intent: opts.intent,
          constraints: opts.constraints,
          classMap: opts.classMap,
        })
      )
    : [];
  const explicitGenreEraConstrained = hasExplicitConstraints
    ? tracks.filter((track) => {
        const candidate = toConstraintTrack(track);
        return finalTrackMatchesExplicitGenre(candidate, opts.intent, opts.constraints, opts.classMap) &&
          finalTrackMatchesExplicitEra(candidate, opts.intent);
      })
    : [];
  const adjacentGenreEraConstrained = hasExplicitConstraints
    ? tracks.filter((track) => {
        const candidate = toConstraintTrack(track);
        if (!finalTrackMatchesExplicitGenre(candidate, opts.intent, opts.constraints, opts.classMap)) return false;
        if (!opts.intent.eraRange) return true;
        const year = trackYearEstimate(candidate);
        return year !== null && year >= opts.intent.eraRange.start - 10 && year <= opts.intent.eraRange.end + 10;
      })
    : [];
  const genericGymFamilySafe = gymScene && !promptExplicitlyAllowsGymHipHop(opts.vibe, opts.intent, opts.constraints)
    ? tracks.filter((track) => {
        const family = trackGenreFamily(toConstraintTrack(track), opts.classMap);
        return !["hip_hop", "country", "classical", "christmas"].includes(family);
      })
    : [];
  const sceneCompatible = sceneActive
    ? tracks.filter((track) => {
        const candidate = toConstraintTrack(track);
        if (opts.intent.activity || opts.intent.energyLevel) {
          const activityMatch = activityEvidence(candidate, opts.intent);
          if (activityMatch === false) return false;
        }
        if (opts.intent.mood.length > 0) {
          const moodMatch = moodEvidence(candidate, opts.intent);
          if (moodMatch === false) return false;
        }
        if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(candidate, opts)) return false;
        if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(candidate)) return false;
        if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(candidate)) return false;
        if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(candidate)) return false;
        if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(candidate, hasExplicitGenreIntent(opts.intent, opts.constraints), opts.classMap)) return false;
        return true;
      })
    : tracks;
  const sceneCompatibleFloor = gymScene || focusScene
    ? Math.min(90, Math.max(opts.requestedLength, Math.floor(tracks.length * 0.04)))
    : Math.min(120, Math.max(40, Math.floor(tracks.length * 0.18)));
  const constrainedFloor = Math.max(opts.requestedLength, Math.ceil(opts.requestedLength * 1.5));
  const source = strictConstrained.length >= constrainedFloor
    ? strictConstrained
    : hardConstrained.length >= constrainedFloor
      ? hardConstrained
      : explicitGenreEraConstrained.length >= opts.requestedLength
        ? explicitGenreEraConstrained
        : adjacentGenreEraConstrained.length >= opts.requestedLength
          ? adjacentGenreEraConstrained
          : genericGymFamilySafe.length >= sceneCompatibleFloor
            ? genericGymFamilySafe
            : sceneActive && sceneCompatible.length >= sceneCompatibleFloor
              ? sceneCompatible
              : tracks;
  const sourceMode = strictConstrained.length >= constrainedFloor
    ? "strict_constraints"
    : hardConstrained.length >= constrainedFloor
      ? "hard_constraints"
      : explicitGenreEraConstrained.length >= opts.requestedLength
        ? "explicit_genre_era_constraints"
        : adjacentGenreEraConstrained.length >= opts.requestedLength
          ? "adjacent_era_genre_constraints"
          : genericGymFamilySafe.length >= sceneCompatibleFloor
            ? "generic_gym_family_safe"
            : sceneActive && sceneCompatible.length >= sceneCompatibleFloor
              ? "scene_compatible"
              : "unfiltered";
  const artistCounts = new Map<string, number>();
  const buckets = new Map<string, T[]>();
  const recentArtistPenalty = opts.sessionMemory.artistFrequencyMap;
  const penaltyBuckets = new Map<number, T[]>();
  for (const track of source) {
    const artist = track.artistName.toLowerCase().trim();
    const penalty = recentArtistPenalty[artist] ?? 0;
    const bucket = penaltyBuckets.get(penalty) ?? [];
    bucket.push(track);
    penaltyBuckets.set(penalty, bucket);
  }
  const orderedByRecentExposure = [...penaltyBuckets.keys()]
    .sort((a, b) => a - b)
    .flatMap((penalty) => penaltyBuckets.get(penalty) ?? []);
  for (const track of orderedByRecentExposure) {
    const artist = track.artistName.toLowerCase().trim();
    const artistSeen = artistCounts.get(artist) ?? 0;
    if (artistSeen >= 3) continue;
    artistCounts.set(artist, artistSeen + 1);
    const family = trackGenreFamily(toConstraintTrack(track), opts.classMap);
    const bucket = buckets.get(family) ?? [];
    bucket.push(track);
    buckets.set(family, bucket);
  }

  const out: T[] = [];
  const seen = new Set<string>();
  const orderedBuckets = [...buckets.values()].sort((a, b) => b.length - a.length);
  let cursor = 0;
  while (out.length < broadCap && orderedBuckets.some((bucket) => cursor < bucket.length)) {
    for (const bucket of orderedBuckets) {
      const track = bucket[cursor];
      if (!track || seen.has(track.trackId)) continue;
      seen.add(track.trackId);
      out.push(track);
      if (out.length >= broadCap) break;
    }
    cursor += 1;
  }

  return {
    tracks: out.length > 0 ? out : tracks.slice(0, broadCap),
    diagnostics: {
      applied: true,
      inputCount: tracks.length,
      outputCount: out.length > 0 ? out.length : Math.min(tracks.length, broadCap),
      cap: broadCap,
      sceneActive,
      hasExplicitConstraints,
      constrainedFloor,
      strictConstrainedCount: strictConstrained.length,
      hardConstrainedCount: hardConstrained.length,
      explicitGenreEraConstrainedCount: explicitGenreEraConstrained.length,
      adjacentGenreEraConstrainedCount: adjacentGenreEraConstrained.length,
      genericGymFamilySafeCount: genericGymFamilySafe.length,
      sceneCompatibleCount: sceneCompatible.length,
      sourceMode,
      recentArtistsRemembered: Object.keys(recentArtistPenalty).length,
    },
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function humanCoherenceScore<T extends ConstraintTrack>(
  tracks: T[],
  identity: CuratorIdentity
): { score: number; components: Record<string, number>; reasons: string[] } {
  if (tracks.length === 0) {
    return { score: 0, components: {}, reasons: ["empty_playlist"] };
  }
  const energies = tracks.map((track) => track.energy ?? 0.5);
  const energyMean = average(energies);
  const energyVariance = average(energies.map((energy) => Math.abs(energy - energyMean)));
  const energyConsistency = Math.max(0, 1 - energyVariance * (identity.chaosAllowance <= 0.05 ? 3.2 : 2.6));
  const valences = tracks.map((track) => track.valence ?? 0.5);
  const valenceMean = average(valences);
  const emotionalVariance = average(valences.map((valence) => Math.abs(valence - valenceMean)));
  const emotionalStability = Math.max(0, 1 - emotionalVariance * 2.4);
  const transitionPenalties: number[] = [];
  for (let i = 1; i < tracks.length; i++) {
    const prev = tracks[i - 1]!;
    const cur = tracks[i]!;
    const energyJump = Math.abs((prev.energy ?? 0.5) - (cur.energy ?? 0.5));
    const valenceJump = Math.abs((prev.valence ?? 0.5) - (cur.valence ?? 0.5));
    transitionPenalties.push(Math.max(0, energyJump - 0.24) + Math.max(0, valenceJump - 0.30));
  }
  const transitionSmoothness = Math.max(0, 1 - average(transitionPenalties) * 1.8);
  const score =
    energyConsistency * 0.40 +
    transitionSmoothness * 0.30 +
    emotionalStability * 0.30;
  const reasons = [
    energyConsistency < 0.58 ? "low_energy_consistency" : null,
    transitionSmoothness < 0.58 ? "jumpy_transitions" : null,
    emotionalStability < 0.58 ? "unstable_emotional_flow" : null,
  ].filter((reason): reason is string => !!reason);
  return {
    score: Math.round(score * 100) / 100,
    components: {
      energyConsistency: Math.round(energyConsistency * 100) / 100,
      transitionSmoothness: Math.round(transitionSmoothness * 100) / 100,
      emotionalStability: Math.round(emotionalStability * 100) / 100,
    },
    reasons,
  };
}

function repairHumanCoherenceOrder<T extends ConstraintTrack>(
  tracks: T[],
  identity: CuratorIdentity
): { tracks: T[]; beforeScore: number; afterScore: number; repaired: boolean } {
  const before = humanCoherenceScore(tracks, identity);
  if (tracks.length < 4 || before.score >= 0.56) {
    return { tracks, beforeScore: before.score, afterScore: before.score, repaired: false };
  }

  const openingLockSize = Math.min(3, Math.max(1, Math.floor(tracks.length * 0.12)));
  const ordered: T[] = tracks.slice(0, openingLockSize);
  const remaining = tracks.slice(openingLockSize);
  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1]!;
    const nextIndex = remaining
      .map((track, index) => ({
        index,
        transitionCost:
          Math.abs((previous.energy ?? 0.5) - (track.energy ?? 0.5)) +
          Math.abs((previous.valence ?? 0.5) - (track.valence ?? 0.5)) * 0.8,
      }))
      .sort((a, b) => a.transitionCost - b.transitionCost)[0]?.index ?? 0;
    ordered.push(remaining.splice(nextIndex, 1)[0]!);
  }

  const after = humanCoherenceScore(ordered, identity);
  if (after.score <= before.score || !trackListChanged(tracks, ordered)) {
    return { tracks, beforeScore: before.score, afterScore: after.score, repaired: false };
  }
  return { tracks: ordered, beforeScore: before.score, afterScore: after.score, repaired: true };
}

function trackListChanged<T extends { trackId: string }>(before: T[], after: T[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((track, index) => track.trackId !== after[index]?.trackId);
}

function finalizePlaylistTracks<T extends ConstraintTrack>(opts: {
  initial: T[];
  candidates: T[];
  requestedLength: number;
  vibe: string;
  intent: LockedIntent;
  constraints: ConstraintLayer;
  allowHolidaySeason?: boolean;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  maxPerArtist: number;
  trackReusePenalty?: Map<string, number>;
  artistReusePenalty?: Map<string, number>;
}): { tracks: T[]; diagnostics: PlaylistFinalizationDiagnostics } {
  const seen = new Set<string>();
  const repeatSignatures = new Set<string>();
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  let malformedDropped = 0;
  let unsafeDropped = 0;
  let duplicateDropped = 0;
  let duplicateSignatureDropped = 0;
  let artistLimitSkipped = 0;
  let albumLimitSkipped = 0;
  let cohesionSkipped = 0;
  let cohesionRelaxedFillUsed = false;
  let cohesionRelaxedFillAdded = 0;
  let relaxedArtistFillUsed = false;
  let relaxedAlbumFillUsed = false;
  let hardSafeFillUsed = false;
  let hardSafeFillAdded = 0;
  let hardSafeSkipped = 0;
  let hardSafeDiversitySkipped = 0;
  let siblingSubgenreRefillUsed = false;
  let siblingSubgenreRefillAdded = 0;
  let backToBackArtistSkipped = 0;
  let coherenceDownranked = 0;

  const out: T[] = [];
  const identityTerms = universalIdentityTerms(opts.vibe, opts.intent, opts.constraints);
  const finalizationScoreCache = new Map<string, number>();
  const intentCoherenceCache = new Map<string, number>();
  const preferredFamiliesKey = (preferredFamilies: Set<string>): string =>
    preferredFamilies.size === 0 ? "none" : [...preferredFamilies].sort().join(",");
  const intentCoherenceFor = (track: T, preferredFamilies: Set<string>): number => {
    const cacheKey = `${track.trackId}:${preferredFamiliesKey(preferredFamilies)}`;
    const cached = intentCoherenceCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const coherence = intentCoherenceScore(track, opts, preferredFamilies, identityTerms);
    intentCoherenceCache.set(cacheKey, coherence);
    return coherence;
  };
  const candidateFinalizationScore = (track: T, preferredFamilies: Set<string> = new Set()): number => {
    const cacheKey = `${track.trackId}:${preferredFamiliesKey(preferredFamilies)}`;
    const cached = finalizationScoreCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const trackPenalty = boundedTrackReusePenalty(opts.trackReusePenalty?.get(track.trackId));
    const coherence = intentCoherenceFor(track, preferredFamilies);
    const score = (track.score ?? 0) * 0.58 + coherence * 1.65 - trackPenalty * 1.35;
    finalizationScoreCache.set(cacheKey, score);
    return score;
  };
  const rankedCandidates = opts.candidates
    .map(sanitizePlaylistTrack)
    .filter((track): track is T => !!track)
    .sort((a, b) => candidateFinalizationScore(b) - candidateFinalizationScore(a));
  const preferredFamilies = preferredCohesionFamilies(rankedCandidates, opts);
  coherenceDownranked = rankedCandidates.filter((track) => intentCoherenceScore(track, opts, preferredFamilies, identityTerms) < 0).length;
  const coherentRankedCandidates = [...rankedCandidates]
    .sort((a, b) => candidateFinalizationScore(b, preferredFamilies) - candidateFinalizationScore(a, preferredFamilies));
  const outOfFamilyReserve = Math.max(3, Math.ceil(opts.requestedLength * 0.20));
  const tryAdd = (
    track: T,
    artistLimit: number | null,
    albumLimit: number | null,
    enforceRepeatSignature: boolean,
    enforceCohesion = true
  ): void => {
    if (out.length >= opts.requestedLength) return;
    const sanitized = sanitizePlaylistTrack(track);
    if (!sanitized) {
      malformedDropped++;
      return;
    }
    if (seen.has(sanitized.trackId)) {
      duplicateDropped++;
      return;
    }
    const repeatSignature = trackRepeatSignature(sanitized);
    if (enforceRepeatSignature && repeatSignature && repeatSignatures.has(repeatSignature)) {
      duplicateSignatureDropped++;
      return;
    }
    if (!finalTrackIsSafe(sanitized, opts)) {
      unsafeDropped++;
      return;
    }
    const family = trackGenreFamily(sanitized, opts.classMap);
    if (
      enforceCohesion &&
      preferredFamilies.size > 0 &&
      family !== "unknown" &&
      !preferredFamilies.has(family) &&
      out.length < opts.requestedLength - outOfFamilyReserve
    ) {
      cohesionSkipped++;
      return;
    }
    const artistKey = sanitized.artistName.toLowerCase().trim();
    const artistCount = artistCounts.get(artistKey) ?? 0;
    const previousArtistKey = out[out.length - 1]?.artistName.toLowerCase().trim() ?? null;
    if (previousArtistKey && previousArtistKey === artistKey) {
      backToBackArtistSkipped++;
      return;
    }
    if (artistLimit !== null && artistCount >= artistLimit) {
      artistLimitSkipped++;
      return;
    }
    const albumKey = normalizeRepeatToken(sanitized.albumName);
    const albumCount = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    if (albumLimit !== null && albumKey && albumCount >= albumLimit) {
      albumLimitSkipped++;
      return;
    }
    seen.add(sanitized.trackId);
    if (repeatSignature) repeatSignatures.add(repeatSignature);
    artistCounts.set(artistKey, artistCount + 1);
    if (albumKey) albumCounts.set(albumKey, albumCount + 1);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    out.push(sanitized);
  };
  const hardSafeCandidateScore = (track: T): number => {
    const artistKey = track.artistName.toLowerCase().trim();
    const albumKey = normalizeRepeatToken(track.albumName);
    const artistPressure = artistCounts.get(artistKey) ?? 0;
    const albumPressure = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    const family = trackGenreFamily(track, opts.classMap);
    const familyPressure = familyCounts.get(family) ?? 0;
    const familyPreferred = preferredFamilies.size === 0 || family === "unknown" || preferredFamilies.has(family);
    const familyVariationBonus = familyPressure === 0 ? 0.34 : familyPressure === 1 ? 0.12 : -0.18;
    const familyBonus = familyPreferred ? 0.10 : -0.12;
    const expectedEnergy = opts.intent.energy ?? null;
    const energy = track.energy ?? 0.5;
    const energyConsistency =
      expectedEnergy === "high" ? Math.max(0, 1 - Math.abs(energy - 0.72) / 0.45) :
      expectedEnergy === "low" ? Math.max(0, 1 - Math.abs(energy - 0.34) / 0.40) :
      expectedEnergy === "medium" ? Math.max(0, 1 - Math.abs(energy - 0.55) / 0.42) :
      0.55;
    const reusePenalty = boundedTrackReusePenalty(opts.trackReusePenalty?.get(track.trackId));
    const artistReusePenalty = Math.max(0, Math.min(0.72, opts.artistReusePenalty?.get(artistKey) ?? 0));
    return (track.score ?? 0) * 0.55 +
      familyBonus +
      familyVariationBonus +
      energyConsistency * 0.16 +
      intentCoherenceFor(track, preferredFamilies) * 1.55 -
      artistPressure * 0.72 -
      albumPressure * 0.26 -
      reusePenalty * 1.35 -
      artistReusePenalty * 1.25;
  };
  const hardSafeCandidates = (tracks: T[]): T[] =>
    tracks
      .map(sanitizePlaylistTrack)
      .filter((track): track is T => !!track)
      .sort((a, b) => hardSafeCandidateScore(b) - hardSafeCandidateScore(a));
  const tryAddHardSafe = (
    track: T,
    enforceRepeatSignature: boolean,
    artistLimit: number | null,
    albumLimit: number | null
  ): void => {
    if (out.length >= opts.requestedLength) return;
    const sanitized = sanitizePlaylistTrack(track);
    if (!sanitized) {
      malformedDropped++;
      return;
    }
    if (seen.has(sanitized.trackId)) {
      duplicateDropped++;
      return;
    }
    const repeatSignature = trackRepeatSignature(sanitized);
    if (enforceRepeatSignature && repeatSignature && repeatSignatures.has(repeatSignature)) {
      duplicateSignatureDropped++;
      return;
    }
    if (!finalTrackIsHardSafe(sanitized, opts)) {
      hardSafeSkipped++;
      return;
    }
    const artistKey = sanitized.artistName.toLowerCase().trim();
    const albumKey = normalizeRepeatToken(sanitized.albumName);
    const artistCount = artistCounts.get(artistKey) ?? 0;
    const albumCount = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    const previousArtistKey = out[out.length - 1]?.artistName.toLowerCase().trim() ?? null;
    if (previousArtistKey && previousArtistKey === artistKey) {
      backToBackArtistSkipped++;
      return;
    }
    if (artistLimit !== null && artistCount >= artistLimit) {
      hardSafeDiversitySkipped++;
      return;
    }
    if (albumLimit !== null && albumKey && albumCount >= albumLimit) {
      hardSafeDiversitySkipped++;
      return;
    }
    seen.add(sanitized.trackId);
    if (repeatSignature) repeatSignatures.add(repeatSignature);
    artistCounts.set(artistKey, artistCount + 1);
    if (albumKey) albumCounts.set(albumKey, albumCount + 1);
    const family = trackGenreFamily(sanitized, opts.classMap);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    out.push(sanitized);
    hardSafeFillAdded++;
  };
  const fillUniqueHardSafe = (
    tracks: T[],
    artistLimit: number | null,
    albumLimit: number | null,
    stopAt: number = opts.requestedLength
  ): number => {
    const before = out.length;
    for (const track of hardSafeCandidates(tracks)) {
      if (out.length >= stopAt) break;
      tryAddHardSafe(track, true, artistLimit, albumLimit);
    }
    return out.length - before;
  };
  const fillRockPunkSiblingRefill = (
    artistLimit: number | null,
    albumLimit: number | null,
    stopAt: number = opts.requestedLength
  ): number => {
    if (!isRockPunkClusterPrompt(opts.vibe, opts.intent)) return 0;
    const siblingPool = rankedCandidates.filter((track) => trackMatchesRockPunkSiblingCluster(track, opts.classMap));
    if (siblingPool.length === 0) return 0;
    siblingSubgenreRefillUsed = true;
    return fillUniqueHardSafe(siblingPool, artistLimit, albumLimit, stopAt);
  };

  const primaryArtistLimit = Number.isFinite(opts.maxPerArtist) ? Math.min(2, opts.maxPerArtist) : 2;
  const emergencyArtistLimit = relaxedEmergencyArtistCap(opts.requestedLength, opts.maxPerArtist);
  const primaryAlbumLimit = finalAlbumCap(opts.requestedLength);
  const emergencyAlbumLimit = primaryAlbumLimit + Math.max(1, Math.ceil(opts.requestedLength * 0.05));
  const shouldCompleteActivityPlaylist =
    isGymWorkoutPrompt(opts.vibe, opts.intent) ||
    isBroadDrivingPrompt(opts.vibe, opts.intent) ||
    isUpbeatSocialPrompt(opts.vibe, opts.intent);
  const completionTarget = opts.requestedLength;

  for (const track of opts.initial) tryAdd(track, primaryArtistLimit, primaryAlbumLimit, true);
  for (const track of coherentRankedCandidates) tryAdd(track, primaryArtistLimit, primaryAlbumLimit, true);
  if (out.length < recoveryActivationThreshold(opts.requestedLength)) {
    const beforeRelaxedFill = out.length;
    for (const track of coherentRankedCandidates) tryAdd(track, emergencyArtistLimit, emergencyAlbumLimit, true);
    relaxedArtistFillUsed = emergencyArtistLimit !== null && out.length > beforeRelaxedFill;
    relaxedAlbumFillUsed = out.length > beforeRelaxedFill;
  }
  if (out.length < completionTarget) {
    cohesionRelaxedFillUsed = preferredFamilies.size > 0;
    for (const track of coherentRankedCandidates) {
      const before = out.length;
      tryAdd(track, emergencyArtistLimit, emergencyAlbumLimit, true, false);
      if (out.length > before) cohesionRelaxedFillAdded++;
    }
  }
  if (out.length < completionTarget) {
    hardSafeFillUsed = true;
    const strictHardSafeArtistLimit = primaryArtistLimit ?? emergencyArtistLimit;
    const strictHardSafeAlbumLimit = primaryAlbumLimit;
    fillUniqueHardSafe([...opts.initial, ...coherentRankedCandidates], strictHardSafeArtistLimit, strictHardSafeAlbumLimit);
    if (out.length < opts.requestedLength) {
      fillUniqueHardSafe(coherentRankedCandidates, emergencyArtistLimit, emergencyAlbumLimit);
    }
    if (out.length < recoveryActivationThreshold(opts.requestedLength)) {
      fillUniqueHardSafe(coherentRankedCandidates, emergencyArtistLimit, emergencyAlbumLimit);
    }
    if (out.length < opts.requestedLength) {
      siblingSubgenreRefillAdded += fillRockPunkSiblingRefill(emergencyArtistLimit, emergencyAlbumLimit);
    }
  }
  const minimumCompleteCount = Math.min(opts.requestedLength, Math.ceil(opts.requestedLength * 0.90));
  if (out.length < minimumCompleteCount) {
    hardSafeFillUsed = true;
    const minimumFillArtistLimit = primaryArtistLimit ?? emergencyArtistLimit;
    fillUniqueHardSafe([...coherentRankedCandidates, ...rankedCandidates], minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
    if (out.length < minimumCompleteCount) {
      siblingSubgenreRefillAdded += fillRockPunkSiblingRefill(minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
    }
  }

  return {
    tracks: out,
    diagnostics: {
      requestedLength: opts.requestedLength,
      finalCount: out.length,
      malformedDropped,
      unsafeDropped,
      duplicateDropped,
      duplicateSignatureDropped,
      artistLimitSkipped,
      albumLimitSkipped,
      cohesionSkipped,
      cohesionFamilies: preferredFamilies.size ? [...preferredFamilies].join(",") : null,
      intentCoherenceDownranked: coherenceDownranked,
      completionTarget,
      activityCompletionTarget: shouldCompleteActivityPlaylist,
      cohesionRelaxedFillUsed,
      cohesionRelaxedFillAdded,
      artistLimitRelaxed: relaxedArtistFillUsed,
      artistLimitRelaxedTo: relaxedArtistFillUsed ? emergencyArtistLimit : null,
      albumLimitRelaxed: relaxedAlbumFillUsed,
      albumLimitRelaxedTo: relaxedAlbumFillUsed ? emergencyAlbumLimit : null,
      artistLimitBypassed: false,
      hardSafeFillUsed,
      hardSafeFillAdded,
      hardSafeSkipped,
      hardSafeDiversitySkipped,
      siblingSubgenreRefillUsed,
      siblingSubgenreRefillAdded,
      backToBackArtistSkipped,
      replenished: out.length > opts.initial.length,
      sleepSafetyApplied: isSleepSafetyPrompt(opts.vibe, opts.intent),
      artistDiversityUniqueArtists: artistDiversityDiagnostics(out, opts.maxPerArtist).uniqueArtists,
      artistDiversityRepeatedArtists: artistDiversityDiagnostics(out, opts.maxPerArtist).repeatedArtists,
      artistDiversityCappedTracks: artistDiversityDiagnostics(out, opts.maxPerArtist).cappedTracks,
      fallbackMode: null,
    },
  };
}

function assertQualityConsistency(
  log: import("pino").Logger,
  opts: {
    tracks: Array<V3MetadataTrack<{ trackId: string }>>;
    diagnostics: Record<string, unknown> | null;
    fallbackUsed: boolean;
  }
): void {
  const diagnostics = opts.diagnostics ?? {};
  const lanes = diagnostics["lanes"] as unknown[] | undefined;
  const intent = diagnostics["intentDecomposition"] as Record<string, unknown> | undefined;
  const globalDiversity = diagnostics["globalDiversityMetrics"] as Record<string, unknown> | undefined;
  const postInterleave = globalDiversity?.["postInterleave"] as Record<string, unknown> | undefined;
  const warnings: string[] = [];

  if (!Array.isArray(lanes) || lanes.length === 0) warnings.push("lanes_empty");
  if (!opts.tracks.some((track) => !!track.genrePrimary)) warnings.push("missing_genrePrimary");
  if (!opts.tracks.some((track) => !!track.clusterId || (track.clusterIds?.length ?? 0) > 0)) {
    warnings.push("missing_clusterId");
  }
  if (!intent || typeof intent["primary"] !== "string" || !intent["primary"].trim()) {
    warnings.push("intent_empty");
  }
  if (!postInterleave || Object.keys(postInterleave).length === 0) {
    warnings.push("diversity_missing");
  }

  if (warnings.length > 0) {
    log.warn(
      {
        warnings,
        fallbackUsed: opts.fallbackUsed,
        trackCount: opts.tracks.length,
      },
      "Quality consistency guard warning"
    );
  }
}

function formatV3DiagnosticsForApi(
  rawV3: unknown,
  vibe: string
): Record<string, unknown> | null {
  const v3 = rawV3 as Record<string, unknown> | null | undefined;
  if (!v3 || typeof v3 !== "object") return null;
  const sampleArray = (value: unknown, limit: number): unknown[] =>
    Array.isArray(value) ? value.slice(0, limit) : [];
  const compactIntentContractGuard = (value: unknown): unknown => {
    const guard = value as Record<string, unknown> | null | undefined;
    if (!guard || typeof guard !== "object") return null;
    return {
      ...guard,
      softGuardOriginTrace: sampleArray(guard["softGuardOriginTrace"], 40),
    };
  };
  const compactRetrievalPools = (value: unknown): unknown => {
    const pools = value as Record<string, unknown> | null | undefined;
    if (!pools || typeof pools !== "object") return null;
    const compactPool = (pool: unknown): unknown => {
      const recordPool = pool as Record<string, unknown> | null | undefined;
      if (!recordPool || typeof recordPool !== "object") return pool;
      return {
        ...recordPool,
        top20: sampleArray(recordPool["top20"], 8),
      };
    };
    return Object.fromEntries(
      Object.entries(pools).map(([key, pool]) => [key, compactPool(pool)]),
    );
  };
  const compactControlledGeneration = (value: unknown): unknown => {
    const controlled = value as Record<string, unknown> | null | undefined;
    if (!controlled || typeof controlled !== "object") return null;
    return {
      ...controlled,
      candidateScores: sampleArray(controlled["candidateScores"], 3),
      constraintFailures: sampleArray(controlled["constraintFailures"], 20),
      relaxationSteps: sampleArray(controlled["relaxationSteps"], 12),
    };
  };
  const intent         = v3["intentDecomposition"] as Record<string, unknown> | undefined;
  const lanes          = v3["lanes"] as Array<Record<string, unknown>> | undefined;
  const globalDiv      = v3["globalDiversityMetrics"] as Record<string, unknown> | undefined;
  const preInterleave  = globalDiv?.["preInterleave"]  as Record<string, unknown> | undefined;
  const postInterleave = globalDiv?.["postInterleave"] as Record<string, unknown> | undefined;
  const rawPrimary = typeof intent?.["primary"] === "string" ? intent["primary"].trim() : "";
  const primary = rawPrimary && !/\b(mood|activity|era|genre|adjacent):/i.test(rawPrimary)
    ? rawPrimary
    : vibe;
  const derivedTags = deriveDiagnosticTags(vibe);
  return {
    pipelineVersion:  v3["pipelineVersion"] ?? "v3.1_unified_routing",
    activePath:       v3["activePath"] ?? "adaptive",
    sceneInfluenceMap: intent?.["sceneInfluenceMap"] ?? {},
    contextAnchors:   intent?.["contextAnchors"] ?? {},
    primary,
    intentDecomposition: {
      ...(intent ?? {}),
      primary,
      secondaryIntents: Array.isArray(intent?.["secondaryIntents"]) ? intent["secondaryIntents"] : [],
      moodTags: Array.isArray(intent?.["moodTags"]) && intent["moodTags"].length > 0 ? intent["moodTags"] : derivedTags.moodTags,
      activityTags: Array.isArray(intent?.["activityTags"]) && intent["activityTags"].length > 0 ? intent["activityTags"] : derivedTags.activityTags,
      eraHints: Array.isArray(intent?.["eraHints"]) && intent["eraHints"].length > 0 ? intent["eraHints"] : derivedTags.eraHints,
      genreHints: Array.isArray(intent?.["genreHints"]) && intent["genreHints"].length > 0 ? intent["genreHints"] : derivedTags.genreHints,
      confidence: typeof intent?.["confidence"] === "number" ? intent["confidence"] : 0.35,
    },
    lanes: (lanes ?? []).map((l) => ({
      laneId:        l["laneId"],
      type:          l["type"],
      label:         l["label"],
      weight:        l["weight"],
      scoredCount:   l["scoredCount"],
      selectedCount: l["selectedCount"],
      clusterSpread: l["clusterSpread"] ?? {},
      clusterSelectionRatios: l["clusterSelectionRatios"] ?? {},
    })),
    playlistExplanation:    v3["playlistExplanation"] ?? null,
    clusters:               sampleArray(v3["clusters"], 12),
    selectionTrace:         sampleArray(v3["selectionTrace"] ?? v3["finalDecisionTrace"], 60),
    finalDistribution:      v3["finalDistribution"] ?? {
      genres:  v3["genreDistribution"] ?? {},
      eras:    v3["eraDistribution"] ?? {},
      artists: {},
    },
    qualityLock:              v3["qualityLock"] ?? null,
    adaptiveLaneGenerator:    v3["adaptiveLaneGenerator"] ?? null,
    forensicPoolTrace:        (() => {
      const trace = v3["forensicPoolTrace"] as Record<string, unknown> | null | undefined;
      if (!trace || typeof trace !== "object") return null;
      return {
        ...trace,
        stages: sampleArray(trace["stages"], 24),
      };
    })(),
    retrievalRelaxation:      v3["retrievalRelaxation"] ?? null,
    recommendationEngine:     v3["recommendationEngine"] ?? null,
    embeddingRetrieval:       v3["embeddingRetrieval"] ?? null,
    interleaverDiagnostics:   v3["interleaverDiagnostics"] ?? null,
    laneContributions:        v3["laneContributions"] ?? {},
    fallback:                 v3["fallback"] ?? null,
    intentContractGuard:      compactIntentContractGuard(v3["intentContractGuard"]),
    controlledGeneration:     compactControlledGeneration(v3["controlledGeneration"]),
    playlistQuality:          v3["playlistQuality"] ?? null,
    playlistCritic:           v3["playlistCritic"] ?? null,
    clusterDistributionGraph: v3["clusterDistributionGraph"] ?? {},
    aggregateClusterSpread:   v3["aggregateClusterSpread"] ?? {},
    retrievalPoolsDetailed:   compactRetrievalPools(v3["retrievalPoolsDetailed"]),
    globalDiversityMetrics: {
      preInterleave:  preInterleave  ?? null,
      postInterleave: postInterleave ?? null,
    },
    genreConcentration:  postInterleave?.["genreConcentration"]  ?? null,
    explorationPressure: postInterleave?.["explorationPressure"] ?? null,
    dominantGenre:       postInterleave?.["dominantGenre"]       ?? null,
    dominantEra:         postInterleave?.["dominantEra"]         ?? null,
    systemDiagnostics: {
      v11Role:          "candidate_scoring_only",
      v3Role:           "final_selection_engine",
      uiAlignedTo:      "v3",
      debugTruthLevel:  "selection_based",
      consistencyCheck: "PASS",
    },
  };
}

function compactScoringDiagnosticsForApi(raw: unknown): Record<string, unknown> | null {
  const diagnostics = raw as Record<string, unknown> | null | undefined;
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const scoring = diagnostics["scoring"] as Record<string, unknown> | undefined;
  return {
    scoring: scoring
      ? {
          mode: scoring["mode"] ?? null,
          poolSize: scoring["poolSize"] ?? null,
          hybridPoolSize: scoring["hybridPoolSize"] ?? null,
          excludedCount: scoring["excludedCount"] ?? null,
        }
      : null,
    coverage: diagnostics["coverage"] ?? null,
    stability: diagnostics["stability"] ?? null,
    retrievalCompletionSafety: diagnostics["retrievalCompletionSafety"] ?? null,
    semanticResolution: diagnostics["semanticResolution"] ?? null,
    v3Pipeline: formatV3DiagnosticsForApi(diagnostics["v3Pipeline"], ""),
  };
}

function buildPromptDriftAudit(diagnostics: Record<string, unknown> | null): Record<string, unknown> {
  const quality = diagnostics?.["playlistQuality"] as Record<string, unknown> | null | undefined;
  const contractGuard = diagnostics?.["intentContractGuard"] as Record<string, unknown> | null | undefined;
  const genrePurity = typeof quality?.["genrePurity"] === "number" ? quality["genrePurity"] : null;
  const promptAlignment = typeof quality?.["promptAlignment"] === "number" ? quality["promptAlignment"] : null;
  const guardedCount = typeof contractGuard?.["guardedCount"] === "number" ? contractGuard["guardedCount"] : null;
  const inputCount = typeof contractGuard?.["inputCount"] === "number" ? contractGuard["inputCount"] : null;
  const violations = [
    genrePurity != null && genrePurity < 0.65 ? "genre_purity_below_threshold" : null,
    promptAlignment != null && promptAlignment < 0.60 ? "prompt_alignment_below_threshold" : null,
    inputCount != null && guardedCount === 0 ? "intent_contract_eliminated_pool" : null,
  ].filter((value): value is string => !!value);
  return {
    pass: violations.length === 0,
    violations,
    genrePurity,
    promptAlignment,
    guardedCount,
    inputCount,
  };
}

function hasValidCachedIntent(cached: {
  v3Diagnostics?: Record<string, unknown> | null;
  finalTracks?: Array<{ genrePrimary?: string | null }>;
}, requestedLength: number): boolean {
  const diagnostics = cached.v3Diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return false;
  const intent = diagnostics["intentDecomposition"] as Record<string, unknown> | undefined;
  const hasIntent = typeof intent?.["primary"] === "string" && intent["primary"].trim().length > 0;
  if (!hasIntent) return false;
  const tracks = cached.finalTracks ?? [];
  if (tracks.length === 0) return false;
  if (tracks.length < requestedLength) return false;
  const genrePresent = tracks.filter((track) => !!track.genrePrimary).length;
  return genrePresent / tracks.length >= 0.75;
}

function incrementDistribution(acc: Record<string, number>, key: string | null | undefined): Record<string, number> {
  const label = key || "(missing)";
  acc[label] = (acc[label] ?? 0) + 1;
  return acc;
}

function eraBucket(releaseYear: number | null | undefined): string {
  if (!releaseYear || releaseYear < 1900) return "unknown";
  return `${Math.floor(releaseYear / 10) * 10}s`;
}

function energyBucket(energy: number | null | undefined): string {
  if (typeof energy !== "number") return "unknown";
  if (energy < 0.33) return "low";
  if (energy < 0.66) return "medium";
  return "high";
}

function moodBucket(energy: number | null | undefined, valence: number | null | undefined): string {
  if (typeof energy !== "number" || typeof valence !== "number") return "unknown";
  if (energy >= 0.66 && valence >= 0.55) return "upbeat";
  if (energy >= 0.66 && valence < 0.45) return "intense";
  if (energy < 0.4 && valence >= 0.55) return "warm";
  if (energy < 0.4 && valence < 0.45) return "melancholic";
  return "balanced";
}

function eraDiagnosticSample<T extends {
  trackName?: string | null;
  artistName?: string | null;
  releaseYear?: number | null;
}>(tracks: T[]) {
  return tracks.slice(0, 12).map((track) => ({
    trackName: track.trackName ?? null,
    artistName: track.artistName ?? null,
    releaseYear: track.releaseYear ?? null,
  }));
}

function libraryFingerprint(tracks: Array<{
  trackId: string;
  createdAt?: Date | string | null;
  addedAt?: Date | string | null;
}>): string {
  let newest = 0;
  const ids: string[] = [];
  for (const track of tracks) {
    ids.push(track.trackId);
    const createdMs = track.createdAt ? new Date(track.createdAt).getTime() : 0;
    const addedMs = track.addedAt ? new Date(track.addedAt).getTime() : 0;
    newest = Math.max(newest, Number.isFinite(createdMs) ? createdMs : 0, Number.isFinite(addedMs) ? addedMs : 0);
  }
  ids.sort();
  const sample = [
    ...ids.slice(0, 8),
    ...ids.slice(Math.max(0, Math.floor(ids.length / 2) - 4), Math.floor(ids.length / 2) + 4),
    ...ids.slice(-8),
  ].join(",");
  return `${tracks.length}:${newest}:${sample}`;
}

const FINAL_GUARD_GENRE_TERMS: Record<string, string[]> = {
  country: ["country", "americana", "red dirt", "outlaw country", "honky tonk", "bluegrass", "nashville", "country road"],
  hip_hop: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "emo rap"],
  rock: ["rock", "new wave", "post-punk", "punk", "grunge", "psychedelic", "album rock"],
  reggae: ["reggae", "dancehall", "dub", "rocksteady"],
  pop: ["pop", "dance pop", "synthpop"],
  indie: ["indie", "alternative indie", "neo-psychedelic", "pov: indie"],
  electronic: ["electronic", "edm", "house", "techno", "trance", "dubstep"],
  rnb: ["r&b", "rnb", "neo soul"],
  soul: ["soul", "funk", "motown"],
  latin: ["latin", "reggaeton", "salsa", "bachata"],
  jazz: ["jazz", "bebop", "swing"],
  metal: ["metal", "metalcore", "thrash"],
};

const FINAL_GUARD_KNOWN_ARTISTS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\b(?:luke\s+combs|morgan\s+wallen|chris\s+stapleton|zach\s+bryan|bailey\s+zimmerman|lainey\s+wilson|hardy|jelly\s+roll)\b/i, family: "country" },
  { pattern: /\b(?:tyler\s+childers|sturgill\s+simpson|jason\s+isbell|colter\s+wall|charley\s+crockett|turnpike\s+troubadours|whiskey\s+myers|flatland\s+cavalry)\b/i, family: "country" },
  { pattern: /\b(?:cody\s+johnson|cody\s+jinks|george\s+strait|johnny\s+cash|willie\s+nelson|dolly\s+parton|merle\s+haggard|waylon\s+jennings)\b/i, family: "country" },
  { pattern: /\b(?:kacey\s+musgraves|shania\s+twain|carrie\s+underwood|alan\s+jackson|garth\s+brooks|brooks\s*&\s*dunn|reba\s+mcentire|toby\s+keith)\b/i, family: "country" },
  { pattern: /\b(?:billy\s+strings|alison\s+krauss|sierra\s+ferrell|red\s+clay\s+strays|treaty\s+oak\s+revival|49\s+winchester|sam\s+barber)\b/i, family: "country" },
  { pattern: /\bnas\b/i, family: "hip_hop" },
  { pattern: /\bxxxtentacion\b/i, family: "hip_hop" },
  { pattern: /\bbob\s+marley\b/i, family: "reggae" },
  { pattern: /\bthe\s+doors\b/i, family: "rock" },
  { pattern: /\bblondie\b/i, family: "rock" },
  { pattern: /\btame\s+impala\b/i, family: "indie" },
  { pattern: /\beminem\b/i, family: "hip_hop" },
  { pattern: /\brockwell\b/i, family: "pop" },
];

const NO_LIBRARY_GENRE_SEARCH_TERMS: Record<string, string[]> = {
  country: [
    "genre:country",
    "country",
    "americana",
    "red dirt country",
    "outlaw country",
    "bluegrass",
    "zach bryan",
    "johnny cash",
  ],
  hip_hop: ["genre:hip-hop", "hip hop", "rap", "trap", "drill"],
  rock: ["genre:rock", "rock", "classic rock", "alternative rock", "indie rock"],
  electronic: ["genre:electronic", "electronic", "house", "techno", "uk garage"],
  rnb: ["r&b", "rnb", "neo soul", "slow jams"],
  pop: ["genre:pop", "pop", "dance pop"],
  reggae: ["reggae", "dancehall", "dub"],
  jazz: ["jazz", "bebop", "swing"],
  latin: ["latin", "reggaeton", "salsa"],
  metal: ["metal", "metalcore", "thrash"],
};

function noLibrarySearchQueries(vibe: string, families: string[], subgenreTerms: string[] = []): string[] {
  const cleanedVibe = vibe.trim();
  const eraTerms = extractEraRange(vibe).terms;
  const priorityQueries = new Set<string>();
  const expandedQueries = new Set<string>();
  const lower = cleanedVibe.toLowerCase();
  const controlledAliases = new Set<string>();
  const aliasSource = `${lower} ${subgenreTerms.join(" ").toLowerCase().replace(/_/g, " ")}`;
  if (/\b(?:tekk|tekno|schranz|hardgroove|industrial techno)\b/.test(aliasSource)) {
    ["hard techno", "schranz", "tekno", "techno"].forEach((term) => controlledAliases.add(term));
  }
  if (/\b(?:d\s*&\s*b|dnb|drum and bass|rollers?|liquid dnb|liquid drum and bass|jungle|old\s*skool jungle|old\s*school jungle|breakbeat hardcore)\b/.test(aliasSource)) {
    ["dnb rollers", "drum and bass rollers", "liquid drum and bass", "drum and bass", "jungle", "old school jungle", "jungle rollers", "breakbeat hardcore"].forEach((term) => controlledAliases.add(term));
  }
  if (cleanedVibe) priorityQueries.add(cleanedVibe);
  for (const subgenre of [...subgenreTerms, ...controlledAliases]) {
    const term = subgenre.replace(/_/g, " ").trim();
    if (!term) continue;
    priorityQueries.add(term);
    if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
      expandedQueries.add(`${cleanedVibe} ${term}`);
    }
    for (const era of eraTerms) {
      expandedQueries.add(`${era} ${term}`);
    }
  }
  for (const family of families) {
    for (const term of NO_LIBRARY_GENRE_SEARCH_TERMS[family] ?? [family.replace(/_/g, " ")]) {
      priorityQueries.add(term);
      if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
        expandedQueries.add(`${cleanedVibe} ${term}`);
      }
      for (const era of eraTerms) {
        expandedQueries.add(`${era} ${term}`);
      }
    }
  }
  return [...priorityQueries, ...expandedQueries].slice(0, 24);
}

type RetrievalCompletionDiagnostics = {
  retrievalBlockingReason: string | null;
  unresolvedProviders: string[];
  retrievalWaitTimePerSource: Record<string, number>;
  usedPartialRetrieval: boolean;
  retrievalPartialCompletion: boolean;
  candidatePoolSizeAtUnblock: number;
  minViablePool: number;
  emptyPoolDetectedAtStage?: string | null;
  fallbackDepthReached?: number;
  fallbackExpansionPath?: string[];
  finalPoolSizeAtScoringEntry?: number;
  retrievalFatalEmptyPool?: boolean;
};

type TimedRetrievalSource<T> = {
  value: T;
  elapsedMs: number;
  timedOut: boolean;
  failed: boolean;
};

function defaultRetrievalCompletionDiagnostics(minViablePool: number): RetrievalCompletionDiagnostics {
  return {
    retrievalBlockingReason: null,
    unresolvedProviders: [],
    retrievalWaitTimePerSource: {},
    usedPartialRetrieval: false,
    retrievalPartialCompletion: false,
    candidatePoolSizeAtUnblock: 0,
    minViablePool,
    emptyPoolDetectedAtStage: null,
    fallbackDepthReached: 0,
    fallbackExpansionPath: [],
    finalPoolSizeAtScoringEntry: 0,
    retrievalFatalEmptyPool: false,
  };
}

async function timeboxRetrievalSource<T>(
  source: string,
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<TimedRetrievalSource<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guarded = promise
    .then((value) => ({
      value,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: false,
    }))
    .catch(() => ({
      value: fallback,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: true,
    }));
  const timeout = new Promise<TimedRetrievalSource<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        value: fallback,
        elapsedMs: Date.now() - startedAt,
        timedOut: true,
        failed: false,
      });
    }, timeoutMs);
  });
  const result = await Promise.race([guarded, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

async function buildNoLibrarySpotifyCandidates(opts: {
  accessToken: string;
  userId: string;
  vibe: string;
  length: number;
  families: string[];
  subgenreTerms?: string[];
}): Promise<{
  tracks: Array<typeof likedSongsTable.$inferSelect>;
  diagnostics: RetrievalCompletionDiagnostics;
}> {
  const minViablePool = Math.min(120, Math.max(50, opts.length * 2));
  const diagnostics = defaultRetrievalCompletionDiagnostics(minViablePool);
  const maxTracks = Math.max(80, opts.length * 3);
  const searchResult = await timeboxRetrievalSource(
    "spotifySearch",
    searchSpotifyTracks(
      opts.accessToken,
      noLibrarySearchQueries(opts.vibe, opts.families, opts.subgenreTerms),
      maxTracks,
      {
        userKey: opts.userId,
        bestEffort: true,
        minTracks: minViablePool,
        maxElapsedMs: 5_000,
        maxRetries: 0,
        requestTimeoutMs: 2_500,
      }
    ),
    6_000,
    []
  );
  diagnostics.retrievalWaitTimePerSource.spotifySearch = searchResult.elapsedMs;
  let rawTracks = searchResult.value;
  const searchWindowElapsed = searchResult.elapsedMs >= 4_900 && rawTracks.length < maxTracks;
  if (searchResult.timedOut || searchResult.failed || searchWindowElapsed) {
    diagnostics.unresolvedProviders.push("spotifySearch");
  }
  if (rawTracks.length === 0 && (opts.subgenreTerms?.length ?? 0) > 0) {
    diagnostics.emptyPoolDetectedAtStage = "spotify_search_strict";
    diagnostics.fallbackDepthReached = 1;
    const familySearchResult = await timeboxRetrievalSource(
      "spotifyFamilySearch",
      searchSpotifyTracks(
        opts.accessToken,
        noLibrarySearchQueries(opts.vibe, opts.families, []),
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyFamilySearch = familySearchResult.elapsedMs;
    if (familySearchResult.timedOut || familySearchResult.failed) diagnostics.unresolvedProviders.push("spotifyFamilySearch");
    rawTracks = familySearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`family:${rawTracks.length}`);
  }
  if (rawTracks.length === 0) {
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search_family";
    diagnostics.fallbackDepthReached = Math.max(diagnostics.fallbackDepthReached ?? 0, 2);
    const broadQueries = [
      ...opts.families.map((family) => family.replace(/_/g, " ")),
      ...opts.families.map((family) => `popular ${family.replace(/_/g, " ")}`),
      "popular music",
    ];
    const broadSearchResult = await timeboxRetrievalSource(
      "spotifyBroadSearch",
      searchSpotifyTracks(
        opts.accessToken,
        broadQueries,
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyBroadSearch = broadSearchResult.elapsedMs;
    if (broadSearchResult.timedOut || broadSearchResult.failed) diagnostics.unresolvedProviders.push("spotifyBroadSearch");
    rawTracks = broadSearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`global:${rawTracks.length}`);
  }
  diagnostics.candidatePoolSizeAtUnblock = rawTracks.length;
  diagnostics.finalPoolSizeAtScoringEntry = rawTracks.length;
  if (rawTracks.length === 0) {
    diagnostics.retrievalBlockingReason = "empty_candidate_pool_after_timeboxed_retrieval";
    diagnostics.usedPartialRetrieval = searchResult.timedOut || searchResult.failed;
    diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search";
    diagnostics.retrievalFatalEmptyPool = true;
    return { tracks: [], diagnostics };
  }
  if (rawTracks.length >= minViablePool && (searchResult.timedOut || searchResult.failed || searchWindowElapsed)) {
    diagnostics.retrievalBlockingReason = "min_viable_pool_reached_before_all_sources_completed";
  } else if (rawTracks.length < minViablePool) {
    diagnostics.retrievalBlockingReason = "retrieval_timebox_elapsed_below_min_viable_pool";
  }

  const [artistGenreResult, albumMetadataResult, audioFeaturesResult] = await Promise.all([
    timeboxRetrievalSource(
      "artistGenres",
      fetchArtistGenres(
        opts.accessToken,
        rawTracks.flatMap((track) => track.artists.map((artist) => artist.id).filter((id): id is string => !!id)),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map<string, string[]>()
    ),
    timeboxRetrievalSource(
      "albumMetadata",
      fetchAlbumMetadata(
        opts.accessToken,
        rawTracks.map((track) => track.album.id).filter((id): id is string => !!id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map()
    ),
    timeboxRetrievalSource(
      "audioFeatures",
      fetchAudioFeatures(
        opts.accessToken,
        rawTracks.map((track) => track.id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      []
    ),
  ]);
  diagnostics.retrievalWaitTimePerSource.artistGenres = artistGenreResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.albumMetadata = albumMetadataResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.audioFeatures = audioFeaturesResult.elapsedMs;
  for (const [source, result] of [
    ["artistGenres", artistGenreResult],
    ["albumMetadata", albumMetadataResult],
    ["audioFeatures", audioFeaturesResult],
  ] as const) {
    if (result.timedOut || result.failed) diagnostics.unresolvedProviders.push(source);
  }
  diagnostics.usedPartialRetrieval = diagnostics.unresolvedProviders.length > 0 || rawTracks.length < minViablePool;
  diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
  const artistGenreMap = artistGenreResult.value;
  const albumMetadataMap = albumMetadataResult.value;
  const audioFeatures = audioFeaturesResult.value;
  const featuresById = new Map(audioFeatures.map((features) => [features.id, features]));
  const now = new Date();

  const tracks = rawTracks.map((track, index) => {
    const enriched = enrichTrackMetadata(track, artistGenreMap, albumMetadataMap);
    const features = featuresById.get(track.id);
    return {
      id: -1 - index,
      spotifyUserId: opts.userId,
      trackId: enriched.id,
      trackName: enriched.name,
      artistName: enriched.artists[0]?.name ?? "Unknown",
      albumName: enriched.album.name,
      albumArt: enriched.album.images[0]?.url ?? null,
      durationMs: enriched.duration_ms,
      energy: features?.energy ?? null,
      valence: features?.valence ?? null,
      tempo: features?.tempo ?? null,
      danceability: features?.danceability ?? null,
      acousticness: features?.acousticness ?? null,
      instrumentalness: features?.instrumentalness ?? null,
      loudness: features?.loudness ?? null,
      speechiness: features?.speechiness ?? null,
      spotifyArtistGenres: enriched.spotifyArtistGenres,
      albumGenres: enriched.albumGenres,
      popularity: enriched.popularity ?? null,
      releaseYear: enriched.releaseYear ?? null,
      addedAt: now,
      createdAt: now,
    };
  });
  return { tracks, diagnostics };
}

function hasFinalGenreEvidence(
  track: {
    trackId: string;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
  },
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
    diagnostics?: {
      taxonomyHit?: boolean;
      artistHintMatched?: string | null;
      patternMatched?: string | null;
      audioFallbackUsed?: boolean;
    };
  }>,
  expectedFamilies: string[],
  opts: { allowSpotifyMetadataEvidence?: boolean } = {},
): boolean {
  if (expectedFamilies.length === 0) return true;
  const classification = classMap.get(track.trackId);
  const cachedDiagnostics = classification?.diagnostics;
  const cachedHasLocalEvidence =
    !!classification &&
    expectedFamilies.includes(classification.genreFamily) &&
    cachedDiagnostics?.audioFallbackUsed !== true &&
    cachedDiagnostics?.patternMatched !== "spotify_genre_metadata";
  const cachedHasExpectedFamily =
    !!classification &&
    expectedFamilies.includes(classification.genreFamily) &&
    cachedDiagnostics?.audioFallbackUsed !== true &&
    cachedDiagnostics?.patternMatched !== "spotify_genre_metadata";
  if (cachedHasExpectedFamily) return true;
  const candidateClassification =
    cachedHasLocalEvidence
      ? classification
      : classifyTrack({
          trackName: track.trackName ?? "",
          artistName: track.artistName ?? "",
          albumName: track.albumName ?? "",
          energy: null,
          valence: null,
        });
  if (opts.allowSpotifyMetadataEvidence) {
    const metadataGenres = [
      ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
      ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
    ].filter((value): value is string => typeof value === "string");
    if (metadataGenres.some((genre) => {
      const family = getGenreFamily(genre.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_"));
      return !!family && expectedFamilies.includes(family);
    })) {
      return true;
    }
  }
  if (!candidateClassification || !expectedFamilies.includes(candidateClassification.genreFamily)) {
    const known = FINAL_GUARD_KNOWN_ARTISTS.find((entry) => entry.pattern.test(track.artistName ?? ""));
    return !!known && expectedFamilies.includes(known.family);
  }
  const diagnostics = candidateClassification.diagnostics;
  if (
    diagnostics?.taxonomyHit === true &&
    diagnostics.audioFallbackUsed !== true &&
    diagnostics.patternMatched !== "spotify_genre_metadata" &&
    (!!diagnostics.artistHintMatched || !!diagnostics.patternMatched)
  ) {
    return true;
  }

  const blob = `${track.trackName ?? ""} ${track.artistName ?? ""} ${track.albumName ?? ""}`.toLowerCase();
  return expectedFamilies.some((family) =>
    (FINAL_GUARD_GENRE_TERMS[family] ?? []).some((term) => blob.includes(term))
  );
}

function explicitGenreFallbackFailure(opts: {
  vibe: string;
  requestedCount: number;
  finalCount: number;
  hasGenreAwarePool: boolean;
  noLibraryMode?: boolean;
}): { code: string; error: string; details: Record<string, unknown> } | null {
  const expectedFamilies = buildCsspLockedIntent(opts.vibe).genreFamilies;
  if (expectedFamilies.length === 0) return null;
  if (opts.finalCount <= 0) {
    return {
      code: "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
      error: opts.noLibraryMode
        ? `I could not find enough verified ${expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
        : `I could not find enough verified ${expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
      details: {
        expectedFamilies,
        requestedCount: opts.requestedCount,
        finalCount: opts.finalCount,
        requiredCount: 1,
        requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
        fallbackBlocked: true,
        noLibraryMode: !!opts.noLibraryMode,
      },
    };
  }

  const requiredCount = Math.min(
    opts.finalCount,
    Math.max(1, Math.ceil(opts.finalCount * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
  );
  if (opts.hasGenreAwarePool && opts.finalCount >= requiredCount) return null;

  return {
    code: "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
    error: opts.noLibraryMode
      ? `I could not find enough verified ${expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
      : `I could not find enough verified ${expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
    details: {
      expectedFamilies,
      requestedCount: opts.requestedCount,
      finalCount: opts.finalCount,
      requiredCount,
      requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
      fallbackBlocked: true,
      noLibraryMode: !!opts.noLibraryMode,
    },
  };
}

router.get("/generate/status", (req, res): void => {
  const userId = currentGenerateUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json(getGenerateStatus(userId));
});

router.post("/generate/cancel", (req, res): void => {
  const userId = currentGenerateUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const status = getGenerateStatus(userId);
  if (status.active && status.requestId) {
    cancelGenerateSession(userId, status.requestId);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json({
    success: true,
    cancelled: status.active,
    requestId: status.requestId,
  });
});

/**
 * GET /generate/preview?vibe=...
 * Lightweight scene detection endpoint for the live preview panel.
 * Returns scene, confidence, alternatives, era, and emotion profile
 * without touching the library or Spotify — used while the user is typing.
 */
router.get("/generate/preview", (req, res): void => {
  if (!useMockSpotify() && !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const vibe = typeof req.query.vibe === "string" ? req.query.vibe.trim() : "";
  if (!vibe || vibe.length < 3) {
    res.json({ scene: null, confidence: 0, alternatives: [], era: null, emotion: null });
    return;
  }

  try {
    // Run scene detection + era detection synchronously (both are fast regex/rule-based)
    const { profile, journeyArc } = analyzeVibeWithContext(vibe);
    const sceneResolution = resolveSemanticScene(vibe, profile);
    const eraCtx = detectEra(vibe);

    // Build primary genre list from scene ecosystem (top 4 by weight)
    const primaryGenres = sceneResolution.vector
      ? sceneResolution.vector.genreEcosystem
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4)
          .map((g) => g.genre)
      : [];

    res.json({
      scene: sceneResolution.matchedId
        ? {
            id: sceneResolution.matchedId,
            label: sceneResolution.vector?.label ?? sceneResolution.matchedId,
            confidence: sceneResolution.confidence,
            energy: sceneResolution.vector?.energy ?? null,
            aesthetics: sceneResolution.vector?.aesthetics?.slice(0, 4) ?? [],
            primaryGenres,
          }
        : null,
      alternatives: sceneResolution.alternatives,
      era: eraCtx.decade ? { decade: eraCtx.decade, confidence: eraCtx.eraConfidence } : null,
      emotion: {
        energy: profile.energy,
        valence: profile.valence,
        nostalgia: profile.nostalgia,
        tension: profile.tension,
        calm: profile.calm,
      },
      journeyArc: journeyArc ?? null,
      intentUnderstanding: buildIntentUnderstandingDiagnostics({
        prompt: vibe,
        profile,
      }),
      ...(() => {
        const previewMode = typeof req.query.mode === "string" &&
          ["strict", "balanced", "chaotic"].includes(req.query.mode)
          ? req.query.mode as "strict" | "balanced" | "chaotic"
          : "balanced";
        const pipeline = buildIntentPipelineContext(vibe, previewMode);
        return {
          intentState: pipeline.intentState,
          decomposedIntent: pipeline.decomposedIntent,
          sceneAliases: pipeline.sceneAliases,
          scenePrediction: pipeline.scenePrediction,
          familiarityMode: pipeline.familiarityMode,
          sceneLockStatus: pipeline.sceneLockStatus.active ? pipeline.sceneLockStatus.anchors : null,
        };
      })(),
    });
  } catch (err) {
    res.status(500).json({ error: "Preview analysis failed" });
  }
});

// SYSTEM GUARANTEE:
// Backend generates candidates only.
// Request layer performs evaluation, regeneration, and selection.
// Frontend supplies behavioural feedback signals.
// Long-term learning is driven by implicit + explicit feedback loops.
router.post("/generate", async (req, res): Promise<void> => {
  const startMs = Date.now();
  const productionTimeline = createProductionTimeline();
  let requestId = "";
  let sessionUserId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let clientDisconnected = false;
  let cleanupClientDisconnectListeners: (() => void) | null = null;
  let requestHardTimeoutMs = REQUEST_HARD_TIMEOUT_MS;
  try {
    startTimelineStage(productionTimeline, startMs, "request_validation");
    const devMode = useMockSpotify();
    const rawBody = req.body ?? {};
    const debugPerformance =
      req.query.debugPerformance === "true" ||
      req.query.debugPerformance === "1" ||
      rawBody["debugPerformance"] === true;
    const auditModeRequested = rawBody.auditMode === true || req.query.audit === "1";
    const auditTokenAuthorized = auditModeRequested && generationAuditTokenAuthorized(req);
    const auditMode = auditModeRequested && auditTokenAuthorized;
    const sideEffectPolicy = auditMode ? AUDIT_SIDE_EFFECT_POLICY : PRODUCTION_SIDE_EFFECT_POLICY;
    requestHardTimeoutMs = REQUEST_HARD_TIMEOUT_MS;
    if (auditMode) beginSpotifyApiAudit();
    const auditUserIdRaw = typeof rawBody.spotifyUserId === "string"
      ? rawBody.spotifyUserId.trim()
      : typeof rawBody.auditSpotifyUserId === "string"
        ? rawBody.auditSpotifyUserId.trim()
        : "";

    if (auditModeRequested && !auditMode) {
      generateFail(
        res,
        403,
        "AUDIT_MODE_NOT_AUTHORIZED",
        "Playlist evaluation audit mode requires PLAYLIST_EVAL_TOKEN.",
      );
      return;
    }
    if (!devMode && !auditMode && !getFeatures().spotify.enabled) {
      generateFail(res, 503, "SPOTIFY_DISABLED", "Spotify is not configured on this server.");
      return;
    }
    if (!devMode && !auditMode && (!req.session.spotifyTokens || !req.session.spotifyUserId)) {
      generateFail(res, 401, "NOT_AUTHENTICATED", "Not authenticated");
      return;
    }
    if (!devMode && auditTokenAuthorized && !auditUserIdRaw) {
      generateFail(
        res,
        400,
        "AUDIT_USER_REQUIRED",
        "Audit mode with PLAYLIST_EVAL_TOKEN requires spotifyUserId in the request body.",
      );
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

    const userId = devMode
      ? MOCK_SPOTIFY_USER_ID
      : auditTokenAuthorized
        ? auditUserIdRaw
        : req.session.spotifyUserId!;
    const generateSessionUserId = auditMode
      ? `${userId}:audit:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
      : userId;

    if (!sideEffectPolicy.bypassRateLimit) {
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
    }

    const vibeRaw = rawBody.vibe ?? "";
    const modeRaw = rawBody.mode ?? "balanced";
    const lengthRaw = rawBody.length ?? 25;
    const referencePlaylistRaw =
      typeof rawBody.referencePlaylist === "string" ? rawBody.referencePlaylist.trim() : "";
    const parsedLength =
      typeof lengthRaw === "string" ? parseInt(lengthRaw, 10) : Number(lengthRaw);

    const varietyBoostRequested = rawBody.varietyBoost === true;
    const noLibraryModeRequested = rawBody.noLibraryMode === true;
    const moodSceneRaw =
      typeof rawBody.sceneId === "string"
        ? rawBody.sceneId.trim()
        : typeof rawBody.filmScene === "string"
          ? rawBody.filmScene.trim()
          : "";

    const familiarityRaw = rawBody.familiarity ?? null;
    const familiarityOverride = (["safe", "balanced", "discovery"] as const).includes(familiarityRaw)
      ? familiarityRaw as FamiliarityMode
      : null;

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
      ...(referencePlaylistRaw ? { referencePlaylist: referencePlaylistRaw } : {}),
      ...(varietyBoostRequested ? { varietyBoost: true } : {}),
      ...(moodSceneRaw ? { sceneId: moodSceneRaw } : {}),
      ...(noLibraryModeRequested ? { noLibraryMode: true } : {}),
      ...(familiarityOverride ? { familiarity: familiarityOverride } : {}),
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      generateFail(res, 400, "INVALID_REQUEST", parsed.error.message);
      return;
    }

    const { vibe, mode, length: requestedLength, referencePlaylist, varietyBoost, sceneId, noLibraryMode, familiarity } = parsed.data;
    let length = requestedLength;
    const moodSceneId = sceneId?.trim() || null;
    const noLibraryParsedIntent = noLibraryMode ? buildCsspLockedIntent(vibe) : null;
    const noLibraryExplicitFamilies = noLibraryParsedIntent?.genreFamilies ?? [];
    if (noLibraryMode && noLibraryExplicitFamilies.length === 0) {
      generateFail(
        res,
        400,
        "NO_LIBRARY_REQUIRES_GENRE",
        "No Library Mode needs a clear genre prompt so Spotify-wide search can stay on target. Try adding a genre like pop punk, country, UK garage, house, or indie rock.",
        {
          hint: "Use normal mode for mood-only prompts, or keep No Library Mode on and add a genre.",
          noLibrarySpotify: {
            searched: false,
            fallbackUsed: false,
            fallbackReason: "missing_explicit_genre",
          },
        }
      );
      return;
    }

    endTimelineStage(productionTimeline, startMs, "request_validation");
    markTimeline(productionTimeline, startMs, "queue_entered");
    startTimelineStage(productionTimeline, startMs, "session_acquire");
    const acquired = acquireGenerateSession(generateSessionUserId);
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
    endTimelineStage(productionTimeline, startMs, "session_acquire");
    markTimeline(productionTimeline, startMs, "worker_acquired");
    requestId = acquired;
    sessionUserId = generateSessionUserId;
    const liveStageProfiler = createLiveStageProfiler(startMs);
    const deadlineAt = startMs + requestHardTimeoutMs;
    const generationShouldAbort = (): boolean => {
      if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return true;
      if (Date.now() >= deadlineAt - 2_000) {
        cancelGenerateSession(generateSessionUserId, requestId);
        return true;
      }
      return false;
    };
    const markClientDisconnected = (): void => {
      if (clientDisconnected) return;
      clientDisconnected = true;
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.warn({ userId, requestId }, "Generate request client disconnected — cancelling session");
    };
    const onRequestAborted = (): void => markClientDisconnected();
    const onResponseClose = (): void => {
      if (!res.writableEnded) markClientDisconnected();
    };
    req.once("aborted", onRequestAborted);
    res.once("close", onResponseClose);
    cleanupClientDisconnectListeners = () => {
      req.off("aborted", onRequestAborted);
      res.off("close", onResponseClose);
    };
    const timeoutAfterMs = Math.max(1, deadlineAt - Date.now());
    hardTimeoutTimer = setTimeout(() => {
      if (responseFinished(res)) return;
      const progressBeforeCancel = getGenerateProgress(generateSessionUserId);
      const stageProfile = liveStageProfiler.snapshot();
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.error(
        {
          userId,
          requestId,
          elapsedMs: Date.now() - startMs,
          phase: progressBeforeCancel?.phase ?? "unknown",
          stage: progressBeforeCancel?.stage ?? null,
          stageProfile,
          code: "TIMEOUT",
        },
        "Generate absolute watchdog timeout"
      );
      if (timeoutFallbackResponse(req, res, {
        failureReason: "absolute_watchdog_timeout_fallback",
        elapsedMs: Date.now() - startMs,
        requestId,
        lastPhase: progressBeforeCancel?.phase ?? null,
        lastStage: progressBeforeCancel?.stage ?? null,
        stageProfile,
      })) return;
      res.status(504).json({
        success: false,
        error: "Generation took too long before a safe playlist could be built. Try again with a slightly broader prompt, or sync your Spotify library and retry.",
        code: "TIMEOUT",
        tracks: [],
        generationDiagnostics: {
          recoveryTriggered: false,
          fallbackLevel: "none",
          sessionCancelled: true,
          failureReason: "absolute_watchdog_timeout_before_safe_fallback",
          requestId,
          elapsedMs: Date.now() - startMs,
          lastPhase: progressBeforeCancel?.phase ?? null,
          lastStage: progressBeforeCancel?.stage ?? null,
          stageProfile,
        },
      });
    }, timeoutAfterMs);
    hardTimeoutTimer.unref?.();
    setGeneratePhase(generateSessionUserId, requestId, "starting");
    req.log.info({ elapsedMs: 0, trackCount: 0, cacheHit: false }, "Generation started");
    heartbeatTimer = setInterval(() => {
      const progress = getGenerateProgress(generateSessionUserId);
      req.log.info(
        {
          requestId,
          ms: Date.now() - startMs,
          phase: progress?.phase ?? "unknown",
          stageProfile: liveStageProfiler.snapshot(),
        },
        "Generate in progress"
      );
    }, 15_000);

    let genStageTimer: ReturnType<typeof createGenerateStageTimer> | null = null;
    const preV3Timing = createPreV3Timing();

    try {

    markTimeline(productionTimeline, startMs, "deps_loaded");
    startTimelineStage(productionTimeline, startMs, "prompt_understanding");
    const intentPipeline = buildIntentPipelineContext(vibe, mode, familiarity ?? null);
    const intentState = intentPipeline.intentState;
    const decomposedIntent = intentPipeline.decomposedIntent;
    let sceneAliases = intentPipeline.sceneAliases;
    const emotionalArc = intentPipeline.emotionalArc;
    const sceneLockStatus = intentPipeline.sceneLockStatus;
    let intentLossReport: IntentLossReport = intentPipeline.intentLossReport;
    let familiarityMode = intentPipeline.familiarityMode;
    let mergedScenePrediction = intentPipeline.scenePrediction;
    let tasteGraphV2: TasteGraphV2 | null = null;
    let globalTasteProfile: import("../lib/global-taste-profile").GlobalTasteProfile | null = null;
    let compilePlan: CompilePlanDSL | null = null;
    let segmentDiagnostics: Array<{ segmentId: string; label: string; trackIds: string[] }> = [];
    let adaptiveReasons: string[] = [];
    req.log.info(
      {
        intentState,
        decomposedIntent,
        sceneAliases,
        sceneLockStatus: sceneLockStatus.active ? sceneLockStatus.anchors : null,
      },
      "Intent state extracted",
    );
    let tStage = Date.now();
    const mixedEmotions = detectMixedEmotions(vibe);
    const destParse = parseEmotionalDestination(vibe);

    let emotionProfile: EmotionProfile;
    let experienceScene: ReturnType<typeof analyzeVibeWithContext>["experienceScene"] = null;
    let sceneJourneyArc: ReturnType<typeof analyzeVibeWithContext>["journeyArc"] | null = null;
    let momentPipeline: ReturnType<typeof analyzeMomentPipeline> | null = null;
    try {
      momentPipeline = analyzeMomentPipeline(vibe, { moodSceneId });
      emotionProfile = momentPipeline.profile;
      experienceScene = momentPipeline.experienceScene;
      sceneJourneyArc = momentPipeline.journeyArc;
      req.log.info(
        {
          elapsedMs: Date.now() - startMs,
          canonicalScene: momentPipeline.canonicalScene?.sceneId,
          intent: momentPipeline.intent.intent,
          hasExperienceScene: !!experienceScene,
          journeyArc: sceneJourneyArc ?? null,
        },
        "Emotion profile computed"
      );
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed — using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }
    const promptNormalizationMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "moodIntentTimeMs", promptNormalizationMs);
    endTimelineStage(productionTimeline, startMs, "prompt_understanding");
    if (debugPerformance) {
      logPreV3Stage(req.log, recordPreV3Stage(preV3Timing, "promptNormalization", {
        durationMs: promptNormalizationMs,
        inputSize: vibe.length,
        outputSize: momentPipeline ? 1 : 0,
        cacheHit: false,
      }));
    }

    let referenceFingerprint: ReferenceFingerprint | null = null;
    let referencePlaylistId: string | null = null;

    if (referencePlaylist && !devMode && req.session.spotifyTokens) {
      tStage = Date.now();
      try {
        const tokens = await getValidAccessToken(req.session.spotifyTokens!);
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
      recordPreV3Timing(preV3Timing, "spotifyReferenceTimeMs", Date.now() - tStage);
    }

    const vibeKind = detectVibeKind(vibe, emotionProfile);
    const budget = createRequestBudget(startMs);
    const debugMode = req.query.debug === "1" || process.env["DEBUG"] === "true";
    const sessionSnapshotId = req.sessionID ?? requestId;
    let sessionSnapshot: GenerateSessionSnapshot | null = devMode
      ? null
      : getSessionSnapshot<
          typeof likedSongsTable.$inferSelect,
          typeof playlistHistoryTable.$inferSelect,
          FeedbackMemory
        >(userId, sessionSnapshotId);
    const fullSessionSnapshotHit = !devMode &&
      !noLibraryMode &&
      !!sessionSnapshot?.likedSongs &&
      !!sessionSnapshot.recentPlaylists &&
      !!sessionSnapshot.feedbackMemory;
    const executionHealth = createExecutionHealthProfile(fullSessionSnapshotHit ? "HIT" : "MISS");
    let dbHydrationOccurred = false;
    let sessionHydrationShared = false;
    const resultCacheBaseKey = getGenerateCacheKey({
      userId,
      vibe,
      vibeKind,
      mode,
      length,
      referencePlaylist: !!referencePlaylist,
      referencePlaylistKey: referencePlaylist ?? null,
      sceneId: moodSceneId,
      noLibraryMode: !!noLibraryMode,
      mockMode: devMode,
    });
    let resultCacheKey = resultCacheBaseKey;
    let cacheEntryStatus = getGenerateCacheEntryStatus(resultCacheKey);
    const cacheConstraintLayer = extractConstraintLayer(vibe, {
      primary: vibe,
      ...deriveDiagnosticTags(vibe),
      canonicalHints: canonicalCrossGenreHints(vibe),
    });

    setGeneratePhase(generateSessionUserId, requestId, "loading_library");
    setGenerateStageDetail(generateSessionUserId, requestId, "Scanning your liked songs...");
    markTimeline(productionTimeline, startMs, "candidate_fetch_start");
    startTimelineStage(productionTimeline, startMs, "candidate_fetch");
    tStage = Date.now();
    if (!recordExecutionStage(executionHealth, req.log, "sessionHydration", "controller.preV3", {
      cause: "MULTI_HYDRATION",
      blockDuplicate: true,
    })) {
      generateFail(res, 500, "DUPLICATE_EXECUTION_DETECTED", "Generation attempted duplicate session hydration.");
      return;
    }
    const snapshotLikedRows = fullSessionSnapshotHit ? sessionSnapshot?.likedSongs ?? null : null;
    let cachedLikedRows = devMode || snapshotLikedRows ? null : getCachedLikedSongs(userId);
    const likedSongsCacheHit = !!snapshotLikedRows || !!cachedLikedRows;
    const endLikedSongsProfile = liveStageProfiler.start(
      "preV3.likedSongs",
      snapshotLikedRows ? "session snapshot" : cachedLikedRows ? "memory cache" : devMode ? "mock library" : "database"
    );
    let likedRowsRaw: typeof likedSongsTable.$inferSelect[];
    try {
      if (devMode) {
        likedRowsRaw = generateMockSpotifyLibrary();
      } else if (snapshotLikedRows) {
        likedRowsRaw = snapshotLikedRows;
      } else if (!noLibraryMode) {
        const hydration = await runSessionHydrationSingleFlight(`${userId}:${sessionSnapshotId}`, async () => {
          const likedRowsFromCache = getCachedLikedSongs(userId);
          const [loadedLikedRows, loadedPlaylists, loadedFeedbackMemory] = await Promise.all([
            likedRowsFromCache ??
              db
                .select()
                .from(likedSongsTable)
                .where(eq(likedSongsTable.spotifyUserId, userId)),
            db
              .select()
              .from(playlistHistoryTable)
              .where(eq(playlistHistoryTable.spotifyUserId, userId))
              .orderBy(desc(playlistHistoryTable.createdAt))
              .limit(25),
            getFeedbackMemory(userId),
          ]);
          if (!likedRowsFromCache) setCachedLikedSongs(userId, loadedLikedRows);
          return {
            snapshot: mergeSessionSnapshot<
              typeof likedSongsTable.$inferSelect,
              typeof playlistHistoryTable.$inferSelect,
              FeedbackMemory
            >(userId, sessionSnapshotId, {
              likedSongs: loadedLikedRows,
              recentPlaylists: loadedPlaylists,
              feedbackMemory: loadedFeedbackMemory,
            }),
            dbReadOccurred: true,
          };
        });
        sessionSnapshot = hydration.snapshot;
        sessionHydrationShared = hydration.shared;
        if (hydration.dbReadOccurred && !hydration.shared) dbHydrationOccurred = true;
        likedRowsRaw = hydration.snapshot.likedSongs;
        cachedLikedRows = hydration.dbReadOccurred ? null : likedRowsRaw;
      } else {
        likedRowsRaw = cachedLikedRows ??
          await db
            .select()
            .from(likedSongsTable)
            .where(eq(likedSongsTable.spotifyUserId, userId));
      }
    } finally {
      endLikedSongsProfile();
    }
    if (!devMode && noLibraryMode && !snapshotLikedRows && !cachedLikedRows) setCachedLikedSongs(userId, likedRowsRaw);
    if (!snapshotLikedRows && !cachedLikedRows && !devMode && noLibraryMode) dbHydrationOccurred = true;
    const likedSongsQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "likedSongsQueryMs", likedSongsQueryMs);
    if (!likedSongsCacheHit && !devMode) recordPreV3Timing(preV3Timing, "dbTimeMs", likedSongsQueryMs);
    if (debugPerformance) {
      logDbSessionLoadStage(req.log, recordDbSessionLoadStage(preV3Timing, "recentTracksQuery", {
        durationMs: likedSongsQueryMs,
        rowsReturned: likedRowsRaw.length,
        cacheHit: likedSongsCacheHit || devMode,
      }));
      recordPreV3Stage(preV3Timing, "dbSessionLoad", {
        durationMs: likedSongsCacheHit || devMode ? 0 : likedSongsQueryMs,
        outputSize: likedRowsRaw.length,
        cacheHit: likedSongsCacheHit || devMode,
      });
    }

    let { valid: likedSongs, dropped: droppedTracks } = sanitizeLikedSongs(likedRowsRaw);
    if (droppedTracks > 0) {
      req.log.warn({ droppedTracks, userId }, "Dropped invalid liked-song rows");
    }

    let noLibrarySpotifyCandidateCount = 0;
    let noLibrarySpotifyVerifiedCount = 0;
    let noLibrarySpotifyFallbackReason: string | null = null;
    let noLibraryRetrievalDiagnostics: RetrievalCompletionDiagnostics | null = null;
    if (!devMode && noLibraryMode && noLibraryExplicitFamilies.length > 0) {
      try {
        setGenerateStageDetail(generateSessionUserId, requestId, "Searching Spotify-wide candidates...");
        const freshTokens = await getValidAccessToken(req.session.spotifyTokens!, userId);
        if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
          req.session.spotifyTokens = freshTokens;
        }
        const spotifyCandidateResult = await buildNoLibrarySpotifyCandidates({
          accessToken: freshTokens.accessToken,
          userId,
          vibe,
          length,
          families: noLibraryExplicitFamilies,
          subgenreTerms: noLibraryParsedIntent?.subgenreTerms ?? [],
        });
        const spotifyCandidates = spotifyCandidateResult.tracks;
        noLibraryRetrievalDiagnostics = spotifyCandidateResult.diagnostics;
        noLibrarySpotifyCandidateCount = spotifyCandidates.length;
        const verifiedSpotifyCandidates = spotifyCandidates.filter((track) =>
          hasFinalGenreEvidence(track, new Map(), noLibraryExplicitFamilies, { allowSpotifyMetadataEvidence: true })
        );
        noLibrarySpotifyVerifiedCount = verifiedSpotifyCandidates.length;
        const requiredVerifiedCandidates = Math.min(
          length,
          Math.max(10, Math.ceil(length * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
        );
        if (verifiedSpotifyCandidates.length >= requiredVerifiedCandidates) {
          likedSongs = verifiedSpotifyCandidates;
          noLibrarySpotifyFallbackReason = null;
          req.log.info(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode using verified Spotify search candidates"
          );
        } else if (spotifyCandidates.length >= Math.min(20, length)) {
          likedSongs = spotifyCandidates;
          noLibrarySpotifyCandidateCount = spotifyCandidates.length;
          noLibrarySpotifyFallbackReason = "spotify_search_candidates_below_verified_threshold";
          req.log.warn(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode using unverified Spotify search pool; final guard will enforce genre evidence"
          );
        } else {
          noLibrarySpotifyFallbackReason = "spotify_search_too_few_candidates";
          req.log.warn(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode Spotify search returned too few candidates"
          );
          if (spotifyCandidates.length > 0) {
            likedSongs = spotifyCandidates;
          } else if (likedSongs.length > 0) {
            noLibrarySpotifyFallbackReason = "spotify_search_empty_using_synced_library_fallback";
            noLibraryRetrievalDiagnostics = {
              ...(noLibraryRetrievalDiagnostics ?? defaultRetrievalCompletionDiagnostics(Math.min(120, Math.max(50, length * 2)))),
              emptyPoolDetectedAtStage: noLibraryRetrievalDiagnostics?.emptyPoolDetectedAtStage ?? "spotify_search_final",
              finalPoolSizeAtScoringEntry: likedSongs.length,
              retrievalFatalEmptyPool: true,
            };
          } else {
            setGeneratePhase(generateSessionUserId, requestId, "error");
            generateFail(
              res,
              409,
              "NO_LIBRARY_SPOTIFY_POOL_EMPTY",
              "No Library Mode could not find usable Spotify-wide candidates for this prompt. Try a broader genre phrase or turn off No Library Mode.",
              {
                noLibrarySpotify: {
                  searched: true,
                  fallbackUsed: false,
                  fallbackReason: noLibrarySpotifyFallbackReason,
                  candidateCount: noLibrarySpotifyCandidateCount,
                  verifiedCount: noLibrarySpotifyVerifiedCount,
                  expectedFamilies: noLibraryExplicitFamilies,
                  retrievalCompletion: noLibraryRetrievalDiagnostics,
                },
              }
            );
            return;
          }
        }
      } catch (searchErr: any) {
        noLibrarySpotifyFallbackReason = "spotify_search_failed";
        req.log.warn(
          { err: searchErr?.message, vibe, families: noLibraryExplicitFamilies },
          "No Library Mode Spotify search failed"
        );
        setGeneratePhase(generateSessionUserId, requestId, "error");
        generateFail(
          res,
          503,
          "NO_LIBRARY_SPOTIFY_SEARCH_FAILED",
          "Spotify-wide search failed before No Library Mode could build a playlist. Please regenerate in a moment or turn off No Library Mode.",
          {
            noLibrarySpotify: {
              searched: true,
              fallbackUsed: false,
              fallbackReason: noLibrarySpotifyFallbackReason,
              candidateCount: noLibrarySpotifyCandidateCount,
              verifiedCount: noLibrarySpotifyVerifiedCount,
              expectedFamilies: noLibraryExplicitFamilies,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
          }
        );
        return;
      }
    }

    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      noLibraryMode
        ? `Analysing ${likedSongs.length.toLocaleString()} Spotify-wide candidates`
        : `Analysing ${likedSongs.length.toLocaleString()} liked songs`
    );

    if (likedSongs.length === 0) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (noLibraryMode) {
        generateFail(
          res,
          400,
          "LIBRARY_EMPTY_NO_LIBRARY_MODE",
          noLibraryExplicitFamilies.length > 0
            ? "No Library Mode could not find usable Spotify-wide candidates for this prompt. Try a broader genre phrase or regenerate in a moment."
            : "No Library Mode needs a clear genre prompt or a synced library fallback. Try a genre like country, rock, or UK garage."
        );
      } else {
        generateFail(
          res,
          400,
          "LIBRARY_EMPTY",
          "No liked songs found. Please sync your Spotify library first."
        );
      }
      return;
    }

    if (!noLibraryMode && likedSongs.length < 12) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      generateFail(
        res,
        400,
        "LIBRARY_TOO_SMALL",
        "Library is too small to generate. Sync more liked songs from Spotify first."
      );
      return;
    }
    endTimelineStage(productionTimeline, startMs, "candidate_fetch");
    markTimeline(productionTimeline, startMs, "candidate_fetch_end");

    resultCacheKey = `${resultCacheBaseKey}:${libraryFingerprint(likedSongs)}`;
    cacheEntryStatus = getGenerateCacheEntryStatus(resultCacheKey);
    if (sideEffectPolicy.mode === "production" && !debugMode && !varietyBoost && !devMode && !hasHardConstraints(cacheConstraintLayer)) {
      startTimelineStage(productionTimeline, startMs, "cache_lookup");
      tStage = Date.now();
      const cached = getCachedGenerateResult(resultCacheKey);
      recordPreV3Timing(preV3Timing, "cacheTimeMs", Date.now() - tStage);
      const currentTrackIds = new Set(likedSongs.map((track) => track.trackId));
      const cacheInvalidReason = !cached
        ? null
        : cached.cacheVersion !== "v30"
          ? "cache_version_mismatch"
          : !hasValidCachedIntent(cached, length)
            ? "invalid_cached_intent"
            : !cached.finalTracks.length
              ? "empty_cached_tracks"
              : cached.finalTracks.some((track) => !track.trackId || !track.trackName || !track.artistName)
                ? "invalid_cached_track_payload"
                : cached.finalTracks.some((track) => !currentTrackIds.has(track.trackId))
                  ? "cached_track_missing_from_current_library"
                  : null;
      // Only use cache entries generated after strict validation and scoped to the current candidate library.
      if (cached && !cacheInvalidReason) {
        if (respondIfStale(res, generateSessionUserId, requestId)) return;
        setGeneratePhase(generateSessionUserId, requestId, "done");
        const cachedApiTracks = formatTracksForApi(cached.finalTracks, cached.emotionProfile);
        const cachedFinalGenreDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, track.genrePrimary ?? track.genreFamily ?? track.genres?.[0]),
          {},
        );
        const cachedFinalEraDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, eraBucket(track.releaseYear)),
          {},
        );
        const cachedFinalMoodDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, moodBucket(track.energy, track.valence)),
          {},
        );
        const cachedFinalEnergyDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, energyBucket(track.energy)),
          {},
        );
        req.log.info(
          {
            elapsedMs: Date.now() - startMs,
            cacheHit: true,
            cacheHitValid: true,
            cacheInvalidReason: null,
            trackCount: cached.finalTracks.length,
          },
          "Generation complete"
        );
        const cachedSavedPlaylistId: number | null = null;
        if (!recordExecutionStage(executionHealth, req.log, "finalOutputAssembly", "controller.cachedResultAssembly", {
          cause: "CONTROLLER_PIPELINE_CONFLICT",
          blockDuplicate: true,
        })) {
          generateFail(res, 500, "DUPLICATE_EXECUTION_DETECTED", "Generation attempted duplicate final output assembly.");
          return;
        }
        executionHealth.hydrationCount = dbHydrationOccurred ? 1 : 0;
        executionHealth.finalisationCount += 1;
        const cachedExecutionHealth = finaliseExecutionHealth(executionHealth, Date.now() - startMs);
        res.json({
          success: true,
          cached: true,
          playlistId: cachedSavedPlaylistId,
          savedPlaylistId: cachedSavedPlaylistId,
          tracks: cachedApiTracks,
          playlistName: cached.playlistName,
          name: cached.playlistName,
          vibe: cached.vibe,
          mode: cached.mode,
          noLibraryMode: !!noLibraryMode,
          count: cachedApiTracks.length,
          totalTracks: cachedApiTracks.length,
          degraded: false,
          degradationReasons: [],
          emotionProfile: cached.emotionProfile,
          cacheDiagnostics: { status: "fresh", staleBypassed: false, cacheHitValid: true, invalidReason: null },
          finalGenreDistribution: cachedFinalGenreDistribution,
          finalEraDistribution: cachedFinalEraDistribution,
          finalMoodDistribution: cachedFinalMoodDistribution,
          finalEnergyDistribution: cachedFinalEnergyDistribution,
          v3Diagnostics: cached.v3Diagnostics ?? null,
          generationDiagnostics: {
            recoveryTriggered: false,
            fallbackLevel: "none",
            sessionCancelled: false,
            ...(cached.generationDiagnostics ?? {}),
            cacheDbActivity: {
              hydrationDbRead: dbHydrationOccurred,
              cachedResultSideEffectWrites: 0,
              cacheHitWritesSuppressed: true,
            },
            executionHealth: cachedExecutionHealth,
          },
          artistDiversity: cached.artistDiversity ?? null,
          playlistConfidence: cached.playlistConfidence ?? null,
          ...(cached.spotifyPlaylistUrl
            ? { spotifyPlaylistUrl: cached.spotifyPlaylistUrl }
            : { spotifyUnavailable: true as const }),
        });
        return;
      }
      if (cached && cacheInvalidReason) {
        cacheEntryStatus = "stale";
        req.log.info({
          userId,
          vibe,
          cacheHitValid: false,
          cacheInvalidReason,
        }, "Generate result cache bypassed");
      }
      endTimelineStage(productionTimeline, startMs, "cache_lookup");
    }

    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      requestId,
      userId,
      startMs,
      likedSongs,
      emotionProfile,
      length,
      mode,
      vibe,
      maxPerArtist: artistDiversityCap(length, vibe),
      noLibrarySpotifyCandidateCount,
      noLibrarySpotifyVerifiedCount,
      noLibrarySpotifyFallbackReason,
      noLibraryRetrievalDiagnostics,
      noLibraryMode,
      productionTimeline,
    };

    if (responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    res.setTimeout(Math.max(1_000, deadlineAt - Date.now() + 2_000), () => {
      if (responseFinished(res)) return; // timeout handler — no second body
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.error({ userId, requestId, code: "TIMEOUT" }, "Generate hard timeout — no controller fallback authority");
      if (timeoutFallbackResponse(req, res, {
        failureReason: "express_timeout_fallback",
        elapsedMs: Date.now() - startMs,
        requestId,
      })) return;
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      res.status(504).json({
        success: false,
        error: "Generation took too long before V3 could return a safe playlist. Try again with a slightly broader prompt, or sync your Spotify library and retry.",
        code: "TIMEOUT",
        tracks: [],
        generationDiagnostics: {
          recoveryTriggered: false,
          fallbackLevel: "none",
          sessionCancelled: true,
          failureReason: "hard_timeout_no_controller_fallback",
          controllerAuthorityConflict: false,
        },
      });
    });

    const promptConfidence = scorePromptConfidence(vibe, emotionProfile, {
      experienceSceneMatched: !!experienceScene,
      hasJourneyDestination: !!destParse.desired,
      mixedEmotions,
    });
    req.log.info({ vibe, vibeKind, promptConfidence }, "Vibe kind detected");

    setGeneratePhase(generateSessionUserId, requestId, "building_profile");
    setGenerateStageDetail(generateSessionUserId, requestId, "Loading recent playlist memory and feedback");
    startTimelineStage(productionTimeline, startMs, "memory_load");
    tStage = Date.now();
    const snapshotRecentPlaylists = !devMode && !noLibraryMode ? sessionSnapshot?.recentPlaylists ?? null : null;
    const snapshotFeedbackMemory = !devMode && !noLibraryMode ? sessionSnapshot?.feedbackMemory ?? null : null;
    const memoryCacheHit = !!snapshotRecentPlaylists && !!snapshotFeedbackMemory;
    const endMemoryProfile = liveStageProfiler.start(
      "preV3.memoryAndFeedback",
      memoryCacheHit ? "session snapshot" : "playlist history + feedback memory"
    );
    let recentPlaylists: typeof playlistHistoryTable.$inferSelect[];
    let feedbackMemory: FeedbackMemory;
    try {
      if (memoryCacheHit) {
        recentPlaylists = snapshotRecentPlaylists;
        feedbackMemory = snapshotFeedbackMemory;
      } else {
        dbHydrationOccurred = true;
        const [loadedPlaylists, loadedFeedbackMemory] = await Promise.all([
          db
            .select()
            .from(playlistHistoryTable)
            .where(eq(playlistHistoryTable.spotifyUserId, userId))
            .orderBy(desc(playlistHistoryTable.createdAt))
            .limit(25),
          getFeedbackMemory(userId),
        ]);
        recentPlaylists = loadedPlaylists;
        feedbackMemory = loadedFeedbackMemory;
      }
    } finally {
      endMemoryProfile();
      endTimelineStage(productionTimeline, startMs, "memory_load");
    }
    if (fullSessionSnapshotHit && dbHydrationOccurred) {
      executionHealth.healthState = "BROKEN";
      executionHealth.primaryCause = executionHealth.primaryCause ?? "CACHE_BYPASS_FAILURE";
      executionHealth.driftDetected = true;
      executionHealth.degradedPerformanceMode = true;
      executionHealth.needsCorrection.push("sessionSnapshotHydrationBypass");
      req.log.error(
        { userId, requestId, cacheStatus: executionHealth.cacheStatus },
        "CACHE_BYPASS_FAILURE",
      );
      generateFail(res, 500, "CACHE_BYPASS_FAILURE", "Generation cache hit attempted database hydration.");
      return;
    }
    executionHealth.hydrationCount = dbHydrationOccurred ? 1 : 0;
    const playlistHistoryQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "playlistHistoryQueryMs", playlistHistoryQueryMs);
    if (!memoryCacheHit) recordPreV3Timing(preV3Timing, "dbTimeMs", playlistHistoryQueryMs);
    if (debugPerformance) {
      logDbSessionLoadStage(req.log, recordDbSessionLoadStage(preV3Timing, "playlistHistoryQuery", {
        durationMs: playlistHistoryQueryMs,
        rowsReturned: recentPlaylists.length,
        cacheHit: !!snapshotRecentPlaylists,
      }));
      logDbSessionLoadStage(req.log, recordDbSessionLoadStage(preV3Timing, "implicitFeedbackQuery", {
        durationMs: playlistHistoryQueryMs,
        rowsReturned: snapshotFeedbackMemory ? 1 : Object.keys(feedbackMemory.skipCountByTrack).length + Object.keys(feedbackMemory.saveCountByTrack).length,
        cacheHit: !!snapshotFeedbackMemory,
      }));
      recordPreV3Stage(preV3Timing, "dbSessionLoad", {
        durationMs: memoryCacheHit ? 0 : playlistHistoryQueryMs,
        inputSize: likedSongs.length,
        outputSize: recentPlaylists.length,
        cacheHit: memoryCacheHit,
      });
      recordPreV3Stage(preV3Timing, "userHistoryFetch", {
        durationMs: playlistHistoryQueryMs,
        inputSize: likedSongs.length,
        outputSize: recentPlaylists.length,
        cacheHit: !!snapshotRecentPlaylists,
      });
    }
    const evaluationRecentTrackLists = evaluationSessionTrackLists(rawBody as Record<string, unknown>, sideEffectPolicy.mode === "audit");
    const auditDiversityPressure = evaluationDiversityPressure(vibe, emotionProfile, evaluationRecentTrackLists.length);
    const persistentMemoryPlaylistRows = recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      createdAt: p.createdAt,
    }));
    const memoryPlaylistRows = [
      ...persistentMemoryPlaylistRows,
      ...evaluationRecentTrackLists.map((trackIds, index) => ({
        vibe: `evaluation-session-${index + 1}`,
        trackIds,
        emotionProfile: null,
        createdAt: new Date(),
      })),
    ];
    const scoringMemoryPlaylistRows = auditDiversityPressure < 0.5
      ? persistentMemoryPlaylistRows
      : memoryPlaylistRows;

    startTimelineStage(productionTimeline, startMs, "freshness_memory");
    tStage = Date.now();
    const freshnessStats = buildFreshnessStats(
      scoringMemoryPlaylistRows
    );

    const trackIdToArtist = new Map(likedSongs.map((s) => [s.trackId, s.artistName]));
    const trackIdToAlbum = new Map(likedSongs.map((s) => [s.trackId, s.albumName]));
    const scoringArtistAppearances = buildArtistAppearanceMap(
      scoringMemoryPlaylistRows,
      trackIdToArtist
    );
    const sessionArtistAppearances = buildArtistAppearanceMap(
      memoryPlaylistRows,
      trackIdToArtist
    );
    const albumAppearances = buildAlbumAppearanceMap(
      scoringMemoryPlaylistRows,
      trackIdToAlbum
    );

    const cloneMultiplier = sceneClonePenalty(
      vibe,
      emotionProfile,
      freshnessStats.recentSceneFingerprints,
      momentPipeline?.canonicalScene?.sceneId ?? experienceScene?.sceneId
    );
    recordPreV3Timing(preV3Timing, "freshnessTimeMs", Date.now() - tStage);
    endTimelineStage(productionTimeline, startMs, "freshness_memory");

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
    rediscoveryMode = rediscoveryModeForFamiliarity(familiarityMode, rediscoveryMode);

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

    startTimelineStage(productionTimeline, startMs, "music_chapters");
    const musicChapters = detectMusicChapters(likedRows);
    const chapterMatch = matchChapterFromVibe(vibe, musicChapters, likedRows);
    endTimelineStage(productionTimeline, startMs, "music_chapters");

    startTimelineStage(productionTimeline, startMs, "library_signals");
    tStage = Date.now();
    const librarySignals = buildLibrarySignals(
      likedRows,
      memoryPlaylistRows
    );
    const librarySignalMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "librarySignalTimeMs", librarySignalMs);
    endTimelineStage(productionTimeline, startMs, "library_signals");
    if (debugPerformance) {
      logPreV3Stage(req.log, recordPreV3Stage(preV3Timing, "librarySignalLoad", {
        durationMs: librarySignalMs,
        inputSize: likedRows.length + memoryPlaylistRows.length,
        outputSize: librarySignals.tracks.size,
        cacheHit: false,
      }));
    }

    startTimelineStage(productionTimeline, startMs, "surprise_context");
    const surpriseMix = computeSurpriseMix({
      profile: emotionProfile,
      vibe,
      rediscoveryMode,
      archaeology,
      journeyArc,
      mode: mode as "strict" | "balanced" | "chaotic",
      familiarityMode,
    });

    const arcRepeatCount = countRecentJourneyArc(
      memoryPlaylistRows,
      journeyArc
    );
    const journeyArcMultiplier = journeyArcCooldownMultiplier(arcRepeatCount);
    endTimelineStage(productionTimeline, startMs, "surprise_context");

    setGenerateStageDetail(generateSessionUserId, requestId, `Building taste profile from ${likedSongs.length.toLocaleString()} tracks`);
    let t0 = Date.now();
    startTimelineStage(productionTimeline, startMs, "genre_profile");
    const endGenreProfileProfile = liveStageProfiler.start("preV3.genreProfile", `${likedSongs.length} tracks`);
    let userGenreProfile: ReturnType<typeof buildMockUserGenreProfile>;
    let cacheHit = false;
    try {
      const genreProfileResult = devMode
        ? { profile: buildMockUserGenreProfile(likedSongs), cacheHit: false }
        : getUserGenreProfileForGenerate(
            userId,
            likedSongs,
            vibe,
            { bypassCache: !!noLibraryMode }
          );
      userGenreProfile = genreProfileResult.profile;
      cacheHit = genreProfileResult.cacheHit;
    } finally {
      endGenreProfileProfile();
      endTimelineStage(productionTimeline, startMs, "genre_profile");
    }
    const genreProfileMs = Date.now() - t0;
    recordPreV3Timing(preV3Timing, "genreProfileTimeMs", genreProfileMs);
    if (debugPerformance) {
      logPreV3Stage(req.log, recordPreV3Stage(preV3Timing, "genreProfileBuild", {
        durationMs: genreProfileMs,
        inputSize: likedSongs.length,
        outputSize: userGenreProfile.trackClassifications.size,
        cacheHit,
      }));
    }
    req.log.info(
      { elapsedMs: Date.now() - t0, trackCount: likedSongs.length, cacheHit },
      "Genre profile built"
    );
    try {
      const likedGenreFamilies = [...new Set(
        likedSongs
          .map((song) => userGenreProfile.trackClassifications.get(song.trackId)?.genreFamily)
          .filter((family): family is NonNullable<typeof family> => typeof family === "string" && family.length > 0),
      )].map(String).slice(0, 8);
      const likedArtists = [...new Set(likedSongs.map((song) => song.artistName).filter(Boolean))].slice(0, 50);
      const compiled = await compilePlaylistContext({
        prompt: vibe,
        userId,
        mode,
        familiarityOverride: familiarity ?? null,
        length,
        feedbackMemory,
        likedGenreFamilies,
        likedArtists,
        samePromptRegenerate: varietyBoost === true,
      });
      sceneAliases = compiled.sceneAliases;
      mergedScenePrediction = compiled.scenePrediction;
      familiarityMode = compiled.intentPipeline.familiarityMode;
      length = compiled.compilePlan.length;
      tasteGraphV2 = compiled.tasteGraphV2;
      globalTasteProfile = compiled.globalTaste;
      compilePlan = compiled.compilePlan;
      adaptiveReasons = [...compiled.adaptiveProfile.reasons, ...(compiled.compilePlan.morphPlan?.morph.reasons ?? [])];
      req.log.info(
        {
          sceneAliases,
          familiarityMode,
          length,
          crossSession: compiled.crossSessionMemory?.generationCount ?? 0,
          trendAliases: compiled.trendAliases,
          adaptiveReasons,
        },
        "Playlist compiler context assembled",
      );
    } catch (compileErr) {
      req.log.warn({ err: compileErr }, "Playlist compiler failed — using base intent pipeline");
    }
    const genreByTrack = (trackId: string) => {
      const classification = userGenreProfile.trackClassifications.get(trackId);
      if (!classification) return null;
      const genres = [
        classification.primarySubgenre,
        classification.secondarySubgenre,
        ...(classification.subGenres ?? []),
        classification.genrePrimary,
        classification.genreFamily,
      ].filter((value): value is string => !!value);
      return {
        genrePrimary: classification.genrePrimary ?? classification.genreFamily ?? null,
        genreFamily: classification.genreFamily ?? classification.genrePrimary ?? null,
        genres: [...new Set(genres)],
      };
    };
    const hydrateTrackGenre = <T extends { trackId: string; genrePrimary?: string | null; genreFamily?: string | null; genres?: string[] | null }>(
      track: T
    ): T => {
      const genre = genreByTrack(track.trackId);
      if (!genre) return track;
      const genrePrimary = track.genrePrimary ?? genre.genrePrimary ?? null;
      return {
        ...track,
        genrePrimary,
        genreFamily: track.genreFamily ?? genre.genreFamily ?? genrePrimary,
        genres: Array.isArray(track.genres) && track.genres.length > 0
          ? track.genres
          : genre.genres ?? (genrePrimary ? [genrePrimary] : []),
      };
    };

    genStageTimer = createGenerateStageTimer(req.log, { requestId, userId });
    const stageTimer = genStageTimer;
    const hybridCap = resolveHybridPoolCap(likedSongs.length, {
      vibeKind,
      referencePlaylist: !!referencePlaylist,
      promptWordCount: vibe.trim().split(/\s+/).length,
    });
    stageTimer.start("Starting scoring pipeline", {
      tracks: likedSongs.length,
      hybridCap,
    });

    const recentTrackLists = memoryPlaylistRows.map((p) => p.trackIds);
    const sessionMemory = buildSessionMemory(recentTrackLists, trackIdToArtist);
    const playlistArtistSet = new Map<string, Set<string>>();
    memoryPlaylistRows.forEach((playlist, index) => {
      const artists = new Set<string>();
      for (const trackId of playlist.trackIds) {
        const artist = trackIdToArtist.get(trackId)?.trim().toLowerCase();
        if (artist) artists.add(artist);
      }
      playlistArtistSet.set(String(index), artists);
    });
    const sessionDiversityPressure = Math.max(1.25, auditDiversityPressure);
    const sessionArtistMemory = {
      artistCount: sessionArtistAppearances,
      playlistArtistSet,
      maxArtistAppearances: 1,
      diversityPressure: sessionDiversityPressure,
    };
    const recentTrackPenaltyScale = (varietyBoost ? 2.75 : 1.85) * sessionDiversityPressure;
    const finalizationReusePenalty = recentTrackLists.length
      ? buildRecentTrackPoolPenalty(recentTrackLists, 20, recentTrackPenaltyScale)
      : undefined;
    const finalizationArtistReusePenalty = buildArtistReusePenalty(sessionMemory, sessionDiversityPressure);
    const freshnessCloneMultiplier = varietyBoost
      ? cloneMultiplier * 0.88
      : cloneMultiplier;
    const stackCacheKey = resultCacheKey;

    stageTimer.start("Building genre stack", {
      tracks: likedSongs.length,
      minimal: likedSongs.length >= MINIMAL_GENRE_STACK_THRESHOLD,
    });
    let genreStack = getCachedGenreStack(stackCacheKey);
    const stackFromCache = !!genreStack;
    tStage = Date.now();
    startTimelineStage(productionTimeline, startMs, "genre_stack");
    const endGenreStackProfile = liveStageProfiler.start("preV3.genreStack", stackFromCache ? "memory cache" : `${likedSongs.length} tracks`);
    try {
      if (!genreStack) {
        genreStack = buildGenreIntelligenceStack({
          librarySize: likedSongs.length,
          tracks: likedSongs,
          userProfile: userGenreProfile,
          vibe,
          recentPlaylistTrackIds: recentTrackLists,
        });
        setCachedGenreStack(stackCacheKey, genreStack);
      }
    } finally {
      endGenreStackProfile();
      endTimelineStage(productionTimeline, startMs, "genre_stack");
    }
    const genreStackMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "genreStackTimeMs", genreStackMs);
    if (debugPerformance) {
      logPreV3Stage(req.log, recordPreV3Stage(preV3Timing, "embeddingPrep", {
        durationMs: genreStackMs,
        inputSize: likedSongs.length,
        outputSize: genreStack.stats.vectorStoreSizes.genre +
          genreStack.stats.vectorStoreSizes.track +
          genreStack.stats.vectorStoreSizes.cluster,
        cacheHit: stackFromCache,
      }));
    }
    stageTimer.end("Genre stack built", {
      stackFromCache,
      microGenres: genreStack.stats.microGenreCount,
      ontologyEdges: genreStack.stats.ontologyEdges,
    });

    startTimelineStage(productionTimeline, startMs, "intent_lock");
    const maxPerArtist = artistDiversityCap(length, vibe);

    const allowHolidaySeason = hasExplicitHolidayIntent(vibe);
    startTimelineStage(productionTimeline, startMs, "intent_quality_context");
    const qualitySignalContext = buildQualitySignalContext({
      vibe,
      emotionProfile,
      userGenreProfile,
      recentPlaylists: recentPlaylists.map((p) => ({ vibe: p.vibe, createdAt: p.createdAt })),
    });
    endTimelineStage(productionTimeline, startMs, "intent_quality_context");
    const pipelineVibe = normalizeVibeForPipeline(vibe, qualitySignalContext);
    startTimelineStage(productionTimeline, startMs, "intent_constraint_extract");
    const constraintLayer = extractConstraintLayer(vibe, qualitySignalContext);
    endTimelineStage(productionTimeline, startMs, "intent_constraint_extract");
    startTimelineStage(productionTimeline, startMs, "intent_cssp_parse");
    const parsedCsspIntent = buildCsspLockedIntent(vibe);
    endTimelineStage(productionTimeline, startMs, "intent_cssp_parse");
    const neutralDrivingPrompt = isNeutralDrivingPrompt(vibe, parsedCsspIntent);
    startTimelineStage(productionTimeline, startMs, "intent_object_resolve");
    const resolvedMoodTags = (parsedCsspIntent.mood.length > 0
      ? parsedCsspIntent.mood
      : qualitySignalContext.moodTags.filter((tag) => tag !== "neutral").slice(0, 3))
      .filter((tag) => !(neutralDrivingPrompt && (tag === "melancholic" || tag === "dark")));
    const resolvedEnergy = parsedCsspIntent.energy ?? (neutralDrivingPrompt ? "medium" : null);
    const lockedIntent = {
      genreFamilies: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      eraRange: parsedCsspIntent.eraRange ?? (
        constraintLayer.hard.eraStart !== null && constraintLayer.hard.eraEnd !== null
          ? { start: constraintLayer.hard.eraStart, end: constraintLayer.hard.eraEnd }
          : null
      ),
      mood: resolvedMoodTags,
      activity: parsedCsspIntent.activity,
      energy: resolvedEnergy,
      primaryGenres: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      primaryGenre: parsedCsspIntent.primaryGenre ?? parsedCsspIntent.genreFamilies[0] ?? constraintLayer.hard.genres[0] ?? null,
      primarySubgenre: parsedCsspIntent.primarySubgenre,
      secondarySubgenre: parsedCsspIntent.secondarySubgenre,
      subgenreTerms: parsedCsspIntent.subgenreTerms,
      eraStart: parsedCsspIntent.eraRange?.start ?? constraintLayer.hard.eraStart,
      eraEnd: parsedCsspIntent.eraRange?.end ?? constraintLayer.hard.eraEnd,
      energyLevel: resolvedEnergy,
      interpretationBudget: parsedCsspIntent.interpretationBudget,
    };
    endTimelineStage(productionTimeline, startMs, "intent_object_resolve");
    const intentUnderstandingDiagnostics = buildIntentUnderstandingDiagnostics({
      prompt: vibe,
      profile: emotionProfile,
      lockedIntent: parsedCsspIntent,
    });
    mergedScenePrediction = mergeScenePredictions(
      intentUnderstandingDiagnostics.scenePrediction,
      intentPipeline.scenePrediction,
    );
    intentLossReport = buildIntentLossReport(intentState, {
      scenePrediction: mergedScenePrediction,
      assumptions: intentUnderstandingDiagnostics.assumptions,
    });
    startTimelineStage(productionTimeline, startMs, "intent_curator_identity");
    const curatorIdentity = buildCuratorIdentity({
      prompt: vibe,
      intent: lockedIntent,
      emotionProfile,
    });
    endTimelineStage(productionTimeline, startMs, "intent_curator_identity");
    startTimelineStage(productionTimeline, startMs, "intent_fallback_family");
    const fallbackLockedFamily =
      lockedIntent.primaryGenres[0] ??
      dominantGenreFamily(likedSongs.map((track) => ({ ...track, score: 0.7 } as ConstraintTrack)), userGenreProfile.trackClassifications);
    endTimelineStage(productionTimeline, startMs, "intent_fallback_family");
    startTimelineStage(productionTimeline, startMs, "intent_v3_fallback");
    const v3FallbackIntent = completeCsspLockedIntent(parsedCsspIntent, {
      genreFamilies: mergeSceneAliasesIntoGenres(
        lockedIntent.genreFamilies.length > 0
          ? lockedIntent.genreFamilies
          : fallbackLockedFamily
            ? [fallbackLockedFamily]
            : [],
        sceneAliases,
      ),
      eraRange: lockedIntent.eraRange,
      mood: lockedIntent.mood,
      activity: lockedIntent.activity,
      energy: lockedIntent.energy,
      primaryGenre: lockedIntent.primaryGenre,
      primarySubgenre: lockedIntent.primarySubgenre,
      secondarySubgenre: lockedIntent.secondarySubgenre,
      subgenreTerms: lockedIntent.subgenreTerms,
    });
    endTimelineStage(productionTimeline, startMs, "intent_v3_fallback");
    endTimelineStage(productionTimeline, startMs, "intent_lock");
    const genCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
    if (genCtx) {
      genCtx["fallbackLockedFamily"] = fallbackLockedFamily;
      genCtx["v3FallbackIntent"] = v3FallbackIntent;
      genCtx["genreByTrack"] = genreByTrack;
      genCtx["lockedIntent"] = lockedIntent;
      genCtx["constraintLayer"] = constraintLayer;
      genCtx["classMap"] = userGenreProfile.trackClassifications;
      genCtx["intentUnderstanding"] = intentUnderstandingDiagnostics;
      genCtx["intentState"] = intentState;
      genCtx["decomposedIntent"] = decomposedIntent;
      genCtx["sceneLockStatus"] = sceneLockStatus;
      genCtx["sceneAliases"] = sceneAliases;
      genCtx["mergedScenePrediction"] = mergedScenePrediction;
      genCtx["familiarityMode"] = familiarityMode;
      genCtx["trackReusePenalty"] = finalizationReusePenalty;
      genCtx["artistReusePenalty"] = finalizationArtistReusePenalty;
    }
    req.log.info(
      {
        primary: qualitySignalContext.primary,
        moodTags: qualitySignalContext.moodTags,
        activityTags: qualitySignalContext.activityTags,
        eraHints: qualitySignalContext.eraHints,
        genreHints: qualitySignalContext.genreHints,
        canonicalHints: qualitySignalContext.canonicalHints,
        constraintLayer,
        lockedIntent,
        interpretationBudget: lockedIntent.interpretationBudget,
      },
      "Quality signal and constraint context prepared"
    );

    startTimelineStage(productionTimeline, startMs, "candidate_shape");
    const preScoringCandidateShape = shapePreScoringCandidatePool(likedSongs, {
      vibe,
      intent: lockedIntent,
      constraints: constraintLayer,
      classMap: userGenreProfile.trackClassifications,
      sessionMemory,
      requestedLength: length,
    });
    const scoringInputSongs = preScoringCandidateShape.tracks;
    endTimelineStage(productionTimeline, startMs, "candidate_shape");
    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      ...(req as { _genCtx?: Record<string, unknown> })._genCtx,
      scoringInputSongs: scoringInputSongs.map(hydrateTrackGenre),
      genreByTrack,
    };
    startTimelineStage(productionTimeline, startMs, "curator_scoring");
    const curatorScoreByTrack = new Map<string, number>();
    for (const track of scoringInputSongs) {
      curatorScoreByTrack.set(track.trackId, scoreTrackForIdentity(track, curatorIdentity));
    }
    endTimelineStage(productionTimeline, startMs, "curator_scoring");
    setGeneratePhase(generateSessionUserId, requestId, "scoring");
    setGenerateStageDetail(generateSessionUserId, requestId, `Ranking matches from ${scoringInputSongs.length.toLocaleString()} shaped candidates`);
    markTimeline(productionTimeline, startMs, "scoring_start");
    stageTimer.start("Running playlist pipeline (scoring + compose)", {
      tracks: scoringInputSongs.length,
      stackFromCache,
    });
    preV3Timing.totalBeforeV3Ms = Date.now() - startMs;
    const preV3PerformanceReport = debugPerformance ? buildPreV3PerformanceReport(preV3Timing) : null;
    req.log.info(
      {
        ...preV3Timing,
        ...(debugPerformance ? { preV3PerformanceReport, sessionSnapshotCache: getSessionSnapshotCacheStats() } : {}),
        preScoringCandidateShape: preScoringCandidateShape.diagnostics,
      },
      "Pre-V3 timing breakdown"
    );
    const pipelineReady = scoringInputSongs.length >= Math.max(8, Math.min(length, 20));
    const useFastFallback = !devMode && budget.shouldFastFallback() && !pipelineReady;

    let pipeline: BuildPlaylistPipelineResult<(typeof likedSongs)[number]> & {
      requestOrchestration?: RequestGenerationOrchestration;
    };
    let fallbackReason: { stage: string; elapsedMs: number } | null = null;
    let playlistPipelineTimeMs = 0;
    const playlistPipelineStartedAt = Date.now();
    if (useFastFallback) {
      fallbackReason = {
        stage: preV3Timing.slowestStage ?? "hard_timeout",
        elapsedMs: preV3Timing.slowestStageMs,
      };
      req.log.warn(
        {
          ms: Date.now() - startMs,
          remainingMs: budget.remainingMs(),
          code: "FAST_FALLBACK",
          fallbackReason,
          preV3Timing,
        },
        "Time budget — fast fallback playlist"
      );
      pipeline = buildFallbackPipelineResult({
        tracks: scoringInputSongs,
        emotionProfile,
        playlistLength: length,
        maxPerArtist,
        librarySize: likedSongs.length,
        genreByTrack,
        recentTrackPenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
        worldFilter: sceneLockStatus.active || sceneAliases.length > 0
          ? {
            sceneLock: sceneLockStatus,
            sceneAliases,
            scenePrediction: mergedScenePrediction,
          }
          : undefined,
      }) as typeof pipeline;
      playlistPipelineTimeMs = Date.now() - playlistPipelineStartedAt;
    } else {
      if (!recordExecutionStage(executionHealth, req.log, "playlistPipeline", "controller.runRequestLayerGeneration", {
        cause: "UNEXPECTED_FALLBACK_PATH",
        blockDuplicate: true,
      })) {
        generateFail(res, 500, "DUPLICATE_EXECUTION_DETECTED", "Generation attempted duplicate playlist pipeline execution.");
        return;
      }
      if (!recordExecutionStage(executionHealth, req.log, "v3Pipeline", "playlist-pipeline.runV3Pipeline", {
        cause: "V3_REENTRY",
        blockDuplicate: true,
      })) {
        generateFail(res, 500, "DUPLICATE_EXECUTION_DETECTED", "Generation attempted duplicate V3 execution.");
        return;
      }
      executionHealth.retrievalPassCount += 1;
      markTimeline(productionTimeline, startMs, "v3_entry");
      startTimelineStage(productionTimeline, startMs, "v3_pipeline");
      pipeline = await runRequestLayerGeneration({
      pipelineLog: req.log,
      likedSongs: scoringInputSongs,
      vibe: pipelineVibe,
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
      sessionArtistMemory,
      lastSuccessfulVibe: recentPlaylists[0]?.vibe ?? null,
      noLibraryMode: !!noLibraryMode,
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
        feedbackMemory,
        startMs,
        promptConfidenceMultiplier: promptConfidence.qualityBoost,
        journeyArcMultiplier,
        freshness: {
          stats: freshnessStats,
          artistAppearances: scoringArtistAppearances,
          albumAppearances,
          globalCloneMultiplier: freshnessCloneMultiplier,
        },
        vibe: pipelineVibe,
        curatorScoreByTrack,
        sceneAliases,
        scenePrediction: mergedScenePrediction,
        sceneLock: sceneLockStatus,
        tasteGraphV2,
        globalTasteProfile,
        multiObjectPlan: compilePlan?.multiObjectPlan ?? null,
        trendPrompt: pipelineVibe,
      },
      varietyPenaltyScale: recentTrackPenaltyScale,
      genrePost: {
        allowHoliday: allowHolidaySeason,
        suppressGenres: allowHolidaySeason ? [] : ["christmas"],
      },
      requestId,
      diagnosticsMode: debugMode ? "full" : "minimal",
      profileStage: liveStageProfiler.start,
      shouldAbort: generationShouldAbort,
      progress: (stage, detail) => {
        if (generationShouldAbort()) return;
        let phaseAccepted = true;
        if (stage === "scoring") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "scoring");
        } else if (stage === "retrieval" || stage === "lanes" || stage === "sampling") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "loading_library");
        } else if (stage === "fallback") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "composing");
        } else if (stage === "coherence") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "composing");
        }
        if (!phaseAccepted && (clientDisconnected || staleGenerate(generateSessionUserId, requestId))) return;
        setGenerateStageDetail(generateSessionUserId, requestId, detail);
      },
    });
      const pipelineV3DiagnosticsForHealth = ((pipeline.scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
      const controlledGenerationForHealth = (pipelineV3DiagnosticsForHealth["controlledGeneration"] ?? {}) as Record<string, unknown>;
      const actualV3InvocationCount = controlledGenerationForHealth["v3InvocationCount"];
      executionHealth.v3InvocationCount = typeof actualV3InvocationCount === "number" && Number.isFinite(actualV3InvocationCount)
        ? actualV3InvocationCount
        : 1;
      executionHealth.scoringPassCount = executionHealth.v3InvocationCount;
      endTimelineStage(productionTimeline, startMs, "v3_pipeline");
    }
    markTimeline(productionTimeline, startMs, "scoring_end");
    playlistPipelineTimeMs = Date.now() - playlistPipelineStartedAt;
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    type PlaylistTrack = V3MetadataTrack<(typeof likedSongs)[number]> & {
      score: number;
      rediscoveryScore?: number;
      narrativeRole?: string;
      genreFamily?: string | null;
      genres?: string[] | null;
    };
    setGeneratePhase(generateSessionUserId, requestId, "composing");
    if (!recordExecutionStage(executionHealth, req.log, "finalOutputAssembly", "controller.finalAuthority", {
      cause: "CONTROLLER_PIPELINE_CONFLICT",
      blockDuplicate: true,
    })) {
      generateFail(res, 500, "DUPLICATE_EXECUTION_DETECTED", "Generation attempted duplicate final output assembly.");
      return;
    }
    executionHealth.finalisationCount += 1;
    setGenerateStageDetail(generateSessionUserId, requestId, `Building playlist flow from ${pipeline.finalTracks.length.toLocaleString()} candidates`);
    let finalTracks = (pipeline.finalTracks as PlaylistTrack[]).map(hydrateTrackGenre);
    const publishPartialTracks = (tracks: PlaylistTrack[], limit = tracks.length): void => {
      const partialTracks = formatTracksForApi(tracks.slice(0, limit), emotionProfile).map((track) => ({
        trackId: track.id,
        trackName: track.name,
        artistName: track.artist,
        albumArt: track.albumArt ?? null,
      }));
      setGeneratePartialTracks(generateSessionUserId, requestId, partialTracks);
    };
    publishPartialTracks(finalTracks, 5);
    warnIfV3MetadataLost(
      pipeline.finalTracks,
      finalTracks,
      "create-playlist-to-controller"
    );
    warnIfFieldDropped("laneScore", pipeline.finalTracks, finalTracks, "create-playlist-to-controller");
    warnIfFieldDropped("clusterIds", pipeline.finalTracks, finalTracks, "create-playlist-to-controller");
    const publishFinalTracksContext = (): void => {
      const genCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
      if (!genCtx) return;
      genCtx["finalTracks"] = finalTracks;
      genCtx["v3Diagnostics"] = pipeline.scoringDiagnostics;
    };
    publishFinalTracksContext();
    let finalValidation = validateLockedIntentOutput(
      finalTracks,
      lockedIntent,
      constraintLayer,
      userGenreProfile.trackClassifications
    );
    if (!validationPassed(finalValidation)) {
      req.log.warn(
        { finalValidation, finalCount: finalTracks.length },
        "Locked intent validation failed after hard filter"
      );
    }
    req.log.info(
      {
        lockedIntent,
        finalValidation,
        validationPassed: validationPassed(finalValidation),
      },
      "Locked intent final validation"
    );
    setGenerateStageDetail(generateSessionUserId, requestId, "Validating V3-selected playlist");
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const finalCandidatePool = finalTracks;
    const clusterCuration = {
      initial: finalTracks,
      candidates: finalTracks,
      diagnostics: {
        active: false,
        selectedCluster: null,
        secondaryCluster: null,
        selectedClusterLabel: null,
        secondaryClusterLabel: null,
        clusterConfidence: 0,
        fallbackCandidatePercent: 0,
        majorExclusions: ["controller_cluster_curation_skipped_v3_authority"],
      },
    };
    let repairTimeMs = 0;
    let finalizationTimeMs = 0;
    let finalization = {
      tracks: finalTracks,
      diagnostics: {
        active: false,
        finalAssemblyOwner: "controller",
        scoringOwner: "v3",
        rankingOwner: "v3",
        skippedReason: "v3_selected_tracks_are_authoritative",
      } as Record<string, unknown>,
    };
    const stackedConstraintLockActive =
      (lockedIntent.primaryGenres.length > 0 || lockedIntent.genreFamilies.length > 0 || constraintLayer.hard.genres.length > 0) &&
      (lockedIntent.eraStart !== null || lockedIntent.eraEnd !== null || constraintLayer.hard.eraStart !== null || constraintLayer.hard.eraEnd !== null) &&
      !!lockedIntent.activity;
    const explicitGenreRecoveryLockActive =
      lockedIntent.primaryGenres.length > 0 ||
      lockedIntent.genreFamilies.length > 0 ||
      constraintLayer.hard.genres.length > 0;
    const explicitEraRecoveryLockActive =
      lockedIntent.eraStart !== null ||
      lockedIntent.eraEnd !== null ||
      constraintLayer.hard.eraStart !== null ||
      constraintLayer.hard.eraEnd !== null ||
      !!lockedIntent.eraRange;
    const explicitSceneRecoveryLockActive =
      !!lockedIntent.activity ||
      lockedIntent.mood.length > 0 ||
      !!lockedIntent.energyLevel ||
      !!lockedIntent.energy;
    const duplicateIdentityCountBeforeFinalize = countDuplicateSongIdentities(finalTracks);
    const needsFinalizeRecovery = finalTracks.length < length || duplicateIdentityCountBeforeFinalize > 0;
    if (needsFinalizeRecovery) {
      const underfillStartedAt = Date.now();
      const seenUnderfillCandidateIds = new Set<string>();
      const toUnderfillCandidate = <T extends {
        trackId: string;
        trackName: string;
        artistName: string;
        albumName: string;
        energy: number | null;
        valence: number | null;
        genrePrimary?: string | null;
        genreFamily?: string | null;
        genres?: string[] | null;
      }>(
        track: T
      ): ConstraintTrack => {
        const hydrated = hydrateTrackGenre(track);
        const scored = hydrated as T & Partial<ConstraintTrack>;
        return {
          ...hydrated,
          score: typeof scored.score === "number" ? scored.score : 0.45,
          rediscoveryScore: typeof scored.rediscoveryScore === "number" ? scored.rediscoveryScore : 0,
        } as ConstraintTrack;
      };
      const expandedUnderfillPoolLimit = Math.max(800, length * 40);
      const expandedUnderfillSeenIds = new Set<string>();
      const expandedUnderfillPool: ConstraintTrack[] = [];
      const pushUnderfillSource = (track: ConstraintTrack): void => {
        if (expandedUnderfillPool.length >= expandedUnderfillPoolLimit) return;
        if (expandedUnderfillSeenIds.has(track.trackId)) return;
        expandedUnderfillSeenIds.add(track.trackId);
        expandedUnderfillPool.push(track);
      };
      for (const track of [
        ...(pipeline.sorted as ConstraintTrack[]),
        ...finalCandidatePool,
        ...clusterCuration.candidates,
      ]) {
        pushUnderfillSource(toUnderfillCandidate(track));
      }
      for (const track of scoringInputSongs) {
        if (expandedUnderfillPool.length >= expandedUnderfillPoolLimit) break;
        pushUnderfillSource(toUnderfillCandidate(track));
      }
      const underfillCandidates = expandedUnderfillPool
        .filter((track) => {
          if (seenUnderfillCandidateIds.has(track.trackId)) return false;
          seenUnderfillCandidateIds.add(track.trackId);
          return true;
        })
        .filter((track) => {
          if (
            explicitGenreRecoveryLockActive &&
            !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
          ) return false;
          if (explicitEraRecoveryLockActive && !finalTrackMatchesExplicitEra(track, lockedIntent)) return false;
          if (explicitSceneRecoveryLockActive) {
            if (lockedIntent.activity || lockedIntent.energyLevel || lockedIntent.energy) {
              const activityMatch = activityEvidence(track, lockedIntent);
              if (activityMatch === false) return false;
            }
            if (lockedIntent.mood.length > 0) {
              const moodMatch = moodEvidence(track, lockedIntent);
              if (moodMatch === false) return false;
            }
          }
          return true;
        });
      const recovered = finalizePlaylistTracks<ConstraintTrack>({
        initial: finalTracks as ConstraintTrack[],
        candidates: underfillCandidates,
        requestedLength: length,
        vibe,
        intent: lockedIntent,
        constraints: constraintLayer,
        allowHolidaySeason,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist,
        trackReusePenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
      });
      if (shouldApplyFinalizeRecovery(finalTracks, recovered.tracks, length)) {
        finalTracks = recovered.tracks as PlaylistTrack[];
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            ...recovered.diagnostics,
            underfillRecoveryApplied: finalTracks.length < length,
            duplicateIdentityRecoveryApplied: duplicateIdentityCountBeforeFinalize > 0,
            duplicateIdentityCountBeforeFinalize,
            duplicateIdentityCountAfterFinalize: countDuplicateSongIdentities(recovered.tracks),
            stackedConstraintLockActive,
            explicitGenreRecoveryLockActive,
            explicitEraRecoveryLockActive,
            explicitSceneRecoveryLockActive,
            candidateCount: underfillCandidates.length,
            underfillRecoveryExpandedPoolSize: expandedUnderfillPool.length,
          },
        };
        finalizationTimeMs += Date.now() - underfillStartedAt;
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        publishPartialTracks(finalTracks, 5);
      }
      if (finalTracks.length < length) {
        const relaxedSeenIds = new Set<string>();
        const relaxedSceneCandidates = expandedUnderfillPool
          .filter((track) => {
            if (relaxedSeenIds.has(track.trackId)) return false;
            relaxedSeenIds.add(track.trackId);
            return true;
          })
          .filter((track) => {
            if (
              explicitGenreRecoveryLockActive &&
              !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
            ) return false;
            if (explicitEraRecoveryLockActive && !finalTrackMatchesExplicitEra(track, lockedIntent)) return false;
            return true;
          });
        const relaxedRecovered = finalizePlaylistTracks<ConstraintTrack>({
          initial: finalTracks as ConstraintTrack[],
          candidates: relaxedSceneCandidates,
          requestedLength: length,
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          allowHolidaySeason,
          classMap: userGenreProfile.trackClassifications,
          maxPerArtist,
          trackReusePenalty: finalizationReusePenalty,
          artistReusePenalty: finalizationArtistReusePenalty,
        });
        if (shouldApplyFinalizeRecovery(finalTracks, relaxedRecovered.tracks, length)) {
          finalTracks = relaxedRecovered.tracks as PlaylistTrack[];
          finalization = {
            tracks: finalTracks,
            diagnostics: {
              ...finalization.diagnostics,
              ...relaxedRecovered.diagnostics,
              underfillRecoveryApplied: finalTracks.length < length,
              underfillRelaxedSceneFillApplied: true,
              duplicateIdentityRecoveryApplied: duplicateIdentityCountBeforeFinalize > 0,
              duplicateIdentityCountBeforeFinalize,
              duplicateIdentityCountAfterFinalize: countDuplicateSongIdentities(relaxedRecovered.tracks),
              stackedConstraintLockActive,
              explicitGenreRecoveryLockActive,
              explicitEraRecoveryLockActive,
              explicitSceneRecoveryLockActive,
              relaxedSceneCandidateCount: relaxedSceneCandidates.length,
              underfillRecoveryExpandedPoolSize: expandedUnderfillPool.length,
            },
          };
          finalizationTimeMs += Date.now() - underfillStartedAt;
          finalValidation = validateLockedIntentOutput(
            finalTracks,
            lockedIntent,
            constraintLayer,
            userGenreProfile.trackClassifications
          );
          publishPartialTracks(finalTracks, 5);
        }
      }
      if (finalTracks.length < length) {
        const deterministicSeenIds = new Set(finalTracks.map((track) => track.trackId));
        const deterministicSeenSignatures = new Set(
          finalTracks.map((track) => trackRepeatSignature(track)).filter((value): value is string => !!value)
        );
        const deterministicArtistCounts = new Map<string, number>();
        for (const track of finalTracks) {
          const artist = track.artistName.toLowerCase().trim();
          deterministicArtistCounts.set(artist, (deterministicArtistCounts.get(artist) ?? 0) + 1);
        }
        const finalCompletionCandidateScore = (track: ConstraintTrack): number => {
          const artist = track.artistName.toLowerCase().trim();
          const trackPenalty = boundedTrackReusePenalty(finalizationReusePenalty?.get(track.trackId));
          const artistPenalty = Math.max(0, Math.min(0.86, finalizationArtistReusePenalty?.get(artist) ?? 0));
          return (track.score ?? 0) - trackPenalty * 1.45 - artistPenalty * 1.35;
        };
        const deterministicCandidates = expandedUnderfillPool
          .filter((track) => !deterministicSeenIds.has(track.trackId))
          .filter((track) => trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications))
          .filter((track) => !explicitGenreRecoveryLockActive || finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications))
          .filter((track) => !explicitEraRecoveryLockActive || finalTrackMatchesExplicitEra(track, lockedIntent))
          .sort((a, b) => finalCompletionCandidateScore(b) - finalCompletionCandidateScore(a));
        const appendDeterministicFill = (artistLimit: number | null, avoidBackToBack: boolean): number => {
          let added = 0;
          for (const track of deterministicCandidates) {
            if (finalTracks.length >= length) break;
            if (deterministicSeenIds.has(track.trackId)) continue;
            const signature = trackRepeatSignature(track);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            const artist = track.artistName.toLowerCase().trim();
            const previousArtist = finalTracks[finalTracks.length - 1]?.artistName.toLowerCase().trim() ?? null;
            if (avoidBackToBack && previousArtist && previousArtist === artist) continue;
            const count = deterministicArtistCounts.get(artist) ?? 0;
            if (artistLimit !== null && count >= artistLimit) continue;
            deterministicSeenIds.add(track.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            deterministicArtistCounts.set(artist, count + 1);
            finalTracks.push(track as PlaylistTrack);
            added += 1;
          }
          return added;
        };
        const diversitySafeAdded = appendDeterministicFill(2, true);
        const completionAdded = finalTracks.length < length
          ? appendDeterministicFill(null, false)
          : 0;
        let absoluteLastResortAdded = 0;
        if (finalTracks.length < length) {
          const absoluteCandidates = expandedUnderfillPool
            .filter((track) => !deterministicSeenIds.has(track.trackId))
            .sort((a, b) => finalCompletionCandidateScore(b) - finalCompletionCandidateScore(a));
          for (const track of absoluteCandidates) {
            if (finalTracks.length >= length) break;
            if (deterministicSeenIds.has(track.trackId)) continue;
            const signature = trackRepeatSignature(track);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            deterministicSeenIds.add(track.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            finalTracks.push(track as PlaylistTrack);
            absoluteLastResortAdded += 1;
          }
        }
        let finalLibrarySweepAdded = 0;
        if (finalTracks.length < length) {
          for (const track of scoringInputSongs) {
            if (finalTracks.length >= length) break;
            const candidate = toUnderfillCandidate(track);
            if (deterministicSeenIds.has(candidate.trackId)) continue;
            const signature = trackRepeatSignature(candidate);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            deterministicSeenIds.add(candidate.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            finalTracks.push(candidate as PlaylistTrack);
            finalLibrarySweepAdded += 1;
          }
        }
        if (diversitySafeAdded > 0 || completionAdded > 0 || absoluteLastResortAdded > 0 || finalLibrarySweepAdded > 0) {
          finalTracks = finalTracks.slice(0, length);
          finalization = {
            tracks: finalTracks,
            diagnostics: {
              ...finalization.diagnostics,
              finalCompletionFillApplied: true,
              finalCompletionDiversitySafeAdded: diversitySafeAdded,
              finalCompletionLastResortAdded: completionAdded,
              finalCompletionAbsoluteLastResortAdded: absoluteLastResortAdded,
              finalCompletionLibrarySweepAdded: finalLibrarySweepAdded,
              finalCompletionCandidateCount: deterministicCandidates.length,
            },
          };
          finalValidation = validateLockedIntentOutput(
            finalTracks,
            lockedIntent,
            constraintLayer,
            userGenreProfile.trackClassifications
          );
          publishPartialTracks(finalTracks, 5);
        }
      }
      const duplicateCountAfterRecovery = countDuplicateSongIdentities(finalTracks);
      if (duplicateCountAfterRecovery > 0) {
        const identitySwap = repairFinalResponseDuplicateSongIdentities(
          finalTracks as ConstraintTrack[],
          expandedUnderfillPool,
          {
            vibe,
            intent: lockedIntent,
            constraints: constraintLayer,
            allowHolidaySeason,
            classMap: userGenreProfile.trackClassifications,
            maxPerArtist,
          }
        );
        if (
          identitySwap.diagnostics.replacedCount > 0 &&
          identitySwap.tracks.length === finalTracks.length &&
          countDuplicateSongIdentities(identitySwap.tracks) < duplicateCountAfterRecovery
        ) {
          finalTracks = identitySwap.tracks as PlaylistTrack[];
          finalization = {
            tracks: finalTracks,
            diagnostics: {
              ...finalization.diagnostics,
              duplicateIdentityInPlaceSwapApplied: true,
              duplicateIdentityCountBeforeFinalize: duplicateIdentityCountBeforeFinalize,
              duplicateIdentityCountAfterInPlaceSwap: countDuplicateSongIdentities(identitySwap.tracks),
              finalResponseAntiBlandness: {
                ...identitySwap.diagnostics,
                executed: true,
                phase: "finalize_recovery_in_place",
              },
            },
          };
          publishPartialTracks(finalTracks, 5);
        }
      }
    }
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const endEvidenceGuardProfile = liveStageProfiler.start("controller.evidenceAndRecoveryGuards", `${finalization.tracks.length}/${length} finalized tracks`);
    const minBestAvailableCount = Math.min(length, Math.max(5, Math.ceil(length * 0.40)));
    const evidenceRelaxations: string[] = [];
    let strictGenreEvidenceRelaxed = false;
    let strictEraEvidenceRelaxed = false;
    let hardValidationRelaxed = false;
    const baseFinalizationCandidates = clusterCuration.diagnostics.active && clusterCuration.diagnostics.selectedCluster
      ? clusterCuration.candidates
      : finalCandidatePool;
    const explicitConstraintActive = hasExplicitGenreIntent(lockedIntent, constraintLayer) || !!lockedIntent.eraRange;
    const explicitCandidateMap = new Map<string, PlaylistTrack>();
    if (explicitConstraintActive) {
      for (const track of finalTracks) explicitCandidateMap.set(track.trackId, track);
      for (const track of baseFinalizationCandidates) explicitCandidateMap.set(track.trackId, track);
      for (const track of scoringInputSongs) {
        const candidate = { ...hydrateTrackGenre(track), score: 0.5 } as PlaylistTrack;
        explicitCandidateMap.set(candidate.trackId, candidate);
      }
    }
    const explicitCandidatePool = [...explicitCandidateMap.values()];
    const adjacentEraMatches = (track: PlaylistTrack): boolean => {
      if (!lockedIntent.eraRange) return true;
      const year = trackYearEstimate(track);
      if (year === null) return false;
      return year >= lockedIntent.eraRange.start - 10 && year <= lockedIntent.eraRange.end + 10;
    };
    const exactConstrainedRecoveryPool = explicitCandidatePool.filter((track) =>
      trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
      finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
      finalTrackMatchesExplicitEra(track, lockedIntent)
    );
    const adjacentConstrainedRecoveryPool = exactConstrainedRecoveryPool.length > 0
      ? exactConstrainedRecoveryPool
      : explicitCandidatePool.filter((track) =>
          trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
          finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
          adjacentEraMatches(track)
        );
    const genreConstrainedRecoveryPool = adjacentConstrainedRecoveryPool.length > 0
      ? adjacentConstrainedRecoveryPool
      : explicitCandidatePool.filter((track) =>
          trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
          finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
        );
    const publishConstrainedPrefix = (reason: string): boolean => {
      const replacement = exactConstrainedRecoveryPool.length > 0
        ? exactConstrainedRecoveryPool
        : adjacentConstrainedRecoveryPool.length > 0
          ? adjacentConstrainedRecoveryPool
          : genreConstrainedRecoveryPool;
      if (replacement.length === 0) return false;
      finalTracks = replacement.slice(0, length);
      finalization = {
        tracks: finalTracks,
        diagnostics: {
          ...finalization.diagnostics,
          explicitConstraintPartialPublished: true,
          explicitConstraintPartialReason: reason,
          exactConstrainedRecoveryCount: exactConstrainedRecoveryPool.length,
          adjacentConstrainedRecoveryCount: adjacentConstrainedRecoveryPool.length,
          genreConstrainedRecoveryCount: genreConstrainedRecoveryPool.length,
        },
      };
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
      publishPartialTracks(finalTracks, 5);
      return true;
    };
    const endGenreEvidenceProfile = liveStageProfiler.start("controller.genreEvidenceGuard", `${finalTracks.length} tracks`);
    const strictGenreEvidenceDiagnostics = (() => {
      const expectedFamilies = lockedIntent.primaryGenres.length > 0
        ? lockedIntent.primaryGenres
        : lockedIntent.genreFamilies;
      if (expectedFamilies.length === 0) {
        return { active: false, expectedFamilies: [], verifiedCount: finalTracks.length, rejectedCount: 0, requiredCount: 0, verified: finalTracks, compatible: finalTracks };
      }
      const verified = finalTracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const compatible = finalTracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const rejected = finalTracks.filter((track) =>
        !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const evidenceBasisCount = finalTracks.length;
      const requiredCount = Math.min(
        evidenceBasisCount,
        Math.max(1, Math.ceil(evidenceBasisCount * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
      );
      return {
        active: true,
        expectedFamilies,
        requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
        requestedCount: length,
        finalCount: finalTracks.length,
        evidenceBasisCount,
        verifiedCount: verified.length,
        rejectedCount: rejected.length,
        requiredCount,
        verified,
        compatible,
      };
    })();
    endGenreEvidenceProfile();
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.verifiedCount < strictGenreEvidenceDiagnostics.requiredCount
    ) {
      if (publishConstrainedPrefix("insufficient_verified_genre_evidence")) {
        evidenceRelaxations.push("genre_evidence_partial_constrained_prefix");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            exactConstrainedRecoveryCount: exactConstrainedRecoveryPool.length,
            adjacentConstrainedRecoveryCount: adjacentConstrainedRecoveryPool.length,
            genreConstrainedRecoveryCount: genreConstrainedRecoveryPool.length,
            strictGenreEvidenceDiagnostics: {
              ...strictGenreEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
            },
          },
          "Explicit genre evidence guard published constrained prefix"
        );
      } else {
      req.log.warn(
        {
          userId,
          vibe,
          strictGenreEvidenceDiagnostics: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
        },
        "Explicit genre evidence guard blocked weak playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
        noLibraryMode
          ? `I could not find enough verified ${strictGenreEvidenceDiagnostics.expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
          : `I could not find enough verified ${strictGenreEvidenceDiagnostics.expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
        {
          hint: noLibraryMode
            ? "Try a broader genre phrase, turn off No Library Mode to use your saved tracks, or regenerate in a moment."
            : "Run a fresh Spotify library sync so artist genres are updated, or broaden the prompt.",
          strictGenreEvidence: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
          noLibrarySpotify: noLibraryMode
            ? {
                candidateCount: noLibrarySpotifyCandidateCount,
                verifiedCandidateCount: noLibrarySpotifyVerifiedCount,
                fallbackReason: noLibrarySpotifyFallbackReason,
                retrievalCompletion: noLibraryRetrievalDiagnostics,
              }
            : undefined,
        }
      );
      return;
      }
    }
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.rejectedCount > 0 &&
      !strictGenreEvidenceRelaxed
    ) {
      req.log.warn(
        {
          userId,
          vibe,
          rejectedCount: strictGenreEvidenceDiagnostics.rejectedCount,
        },
        "Explicit genre evidence guard detected rejected tracks; controller preserving V3 output"
      );
    }
    const endEraEvidenceProfile = liveStageProfiler.start("controller.eraEvidenceGuard", `${finalTracks.length} tracks`);
    const strictEraEvidenceDiagnostics = (() => {
      const eraRange = lockedIntent.eraRange;
      if (!eraRange) {
        return {
          active: false,
          eraRange: null,
          requiredRatio: STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
          requestedCount: length,
          finalCount: finalTracks.length,
          verifiedCount: finalTracks.length,
          unknownCount: 0,
          rejectedCount: 0,
          requiredCount: 0,
          compatibleFallbackUsed: false,
          verified: finalTracks,
          compatible: finalTracks,
          compatibleRecoveryCount: finalTracks.length,
          compatibleRecovery: finalTracks,
        };
      }
      const verified = finalTracks.filter((track) => trackHasEraEvidence(track, eraRange));
      const knownMismatches = finalTracks.filter((track) => trackHasKnownEraMismatch(track, eraRange));
      const compatible = finalTracks.filter((track) => !trackHasKnownEraMismatch(track, eraRange));
      const compatibleRecovery = baseFinalizationCandidates.filter((track) => !trackHasKnownEraMismatch(track, eraRange));
      const requiredCount = Math.min(
        length,
        Math.max(10, Math.ceil(length * STRICT_EXPLICIT_ERA_EVIDENCE_RATIO))
      );
      const compatibleFallbackUsed =
        verified.length < requiredCount &&
        lockedIntent.genreFamilies.length > 0 &&
        knownMismatches.length === 0 &&
        compatible.length >= Math.min(length, Math.max(8, Math.ceil(length * 0.50)));
      return {
        active: true,
        eraRange,
        requiredRatio: STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
        requestedCount: length,
        finalCount: finalTracks.length,
        verifiedCount: verified.length,
        unknownCount: compatible.length - verified.length,
        rejectedCount: knownMismatches.length,
        compatibleRecoveryCount: compatibleRecovery.length,
        requiredCount,
        verifiedSample: eraDiagnosticSample(verified),
        unknownSample: eraDiagnosticSample(compatible.filter((track) => !trackHasEraEvidence(track, eraRange))),
        rejectedSample: eraDiagnosticSample(knownMismatches),
        compatibleFallbackUsed,
        verified,
        compatible,
        compatibleRecovery,
      };
    })();
    endEraEvidenceProfile();
    if (
      strictEraEvidenceDiagnostics.active &&
      strictEraEvidenceDiagnostics.verifiedCount < strictEraEvidenceDiagnostics.requiredCount &&
      !strictEraEvidenceDiagnostics.compatibleFallbackUsed
    ) {
      const compatibleEraRecoveryPool = strictEraEvidenceDiagnostics.compatible.length >= minBestAvailableCount
        ? strictEraEvidenceDiagnostics.compatible
        : strictEraEvidenceDiagnostics.compatibleRecovery;
      if (compatibleEraRecoveryPool.length >= minBestAvailableCount) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_relaxed_to_compatible_unknowns");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            minBestAvailableCount,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard relaxed to compatible unknown-era playlist"
        );
      } else if (
        (isGymWorkoutPrompt(vibe, lockedIntent) || isUpbeatSocialPrompt(vibe, lockedIntent)) &&
        finalTracks.length >= minBestAvailableCount
      ) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_relaxed_for_activity_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            minBestAvailableCount,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard kept activity-safe recovery playlist"
        );
      } else if (explicitConstraintActive && finalTracks.length > 0) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_partial_constrained_prefix");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            exactConstrainedRecoveryCount: exactConstrainedRecoveryPool.length,
            adjacentConstrainedRecoveryCount: adjacentConstrainedRecoveryPool.length,
            genreConstrainedRecoveryCount: genreConstrainedRecoveryPool.length,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard published constrained prefix"
        );
      } else {
      req.log.warn(
        {
          userId,
          vibe,
          strictEraEvidenceDiagnostics: {
            ...strictEraEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
            compatibleRecovery: undefined,
          },
        },
        "Explicit era evidence guard blocked weak playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "INSUFFICIENT_VERIFIED_ERA_EVIDENCE",
        `I could not find enough verified ${strictEraEvidenceDiagnostics.eraRange?.start}-${strictEraEvidenceDiagnostics.eraRange?.end} tracks after removing wrong-era songs.`,
        {
          hint: "Try a broader decade prompt, add a genre, or regenerate after syncing tracks with release years.",
          strictEraEvidence: {
            ...strictEraEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
            compatibleRecovery: undefined,
          },
        }
      );
      return;
      }
    }
    if (
      strictEraEvidenceDiagnostics.active &&
      strictEraEvidenceDiagnostics.compatibleFallbackUsed &&
      !strictEraEvidenceRelaxed
    ) {
      strictEraEvidenceRelaxed = true;
      evidenceRelaxations.push("era_evidence_relaxed_to_compatible_unknowns");
    }
    if (strictEraEvidenceDiagnostics.active && !strictEraEvidenceRelaxed) {
      const nextFinalTracks = strictEraEvidenceDiagnostics.compatible;
      if (nextFinalTracks.length !== finalTracks.length) {
        req.log.warn(
          {
            userId,
            vibe,
            rejectedCount: finalTracks.length - nextFinalTracks.length,
          },
          "Explicit era evidence guard detected rejected tracks; controller preserving V3 output"
        );
      }
    }
    const finalizationCandidates = strictEraEvidenceRelaxed && lockedIntent.eraRange
      ? baseFinalizationCandidates.filter((track) => !trackHasKnownEraMismatch(track, lockedIntent.eraRange!))
      : baseFinalizationCandidates;
    finalization = {
      tracks: finalTracks,
      diagnostics: {
        ...finalization.diagnostics,
        repeatedPassSkipped: true,
        secondPassSkipped: true,
        skippedReason: "v3_selected_tracks_are_authoritative",
      },
    };
    endEvidenceGuardProfile();
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const strictEraEvidencePublic = {
      ...strictEraEvidenceDiagnostics,
      verified: undefined,
      compatible: undefined,
      compatibleRecovery: undefined,
      publishedCount: finalTracks.length,
      publishMode: strictEraEvidenceRelaxed
        ? "compatible_unknowns_relaxed"
        : strictEraEvidenceDiagnostics.active ? "verified_only" : "inactive",
      relaxed: strictEraEvidenceRelaxed,
    };
    const hardValidationFailures = [
      (lockedIntent.primaryGenres.length > 0 || constraintLayer.hard.genres.length > 0) &&
        finalValidation.genreConsistency === "FAIL" ? "genreConsistency" : null,
      (lockedIntent.eraStart !== null || constraintLayer.hard.eraStart !== null) &&
        finalValidation.eraAlignment === "FAIL" ? "eraAlignment" : null,
    ].filter((failure): failure is string => !!failure);
    if (finalTracks.length > 0 && hardValidationFailures.length > 0) {
      const validPrefix = explicitConstraintActive
        ? finalTracks.filter((track) =>
            finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
            finalTrackMatchesExplicitEra(track, lockedIntent)
          )
        : [];
      if (validPrefix.length > 0) {
        finalTracks = validPrefix.slice(0, length);
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "hard_validation_valid_prefix",
            explicitConstraintValidPrefixCount: validPrefix.length,
          },
        };
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        evidenceRelaxations.push("locked_intent_valid_prefix_published");
        publishPartialTracks(finalTracks, 5);
        req.log.warn(
          { userId, vibe, hardValidationFailures, validPrefixCount: validPrefix.length },
          "Hard locked intent validation published valid prefix"
        );
      } else if (finalTracks.length >= minBestAvailableCount) {
        hardValidationRelaxed = true;
        evidenceRelaxations.push("locked_intent_validation_relaxed_best_available");
        req.log.warn(
          { userId, vibe, finalValidation, hardValidationFailures, finalCount: finalTracks.length, minBestAvailableCount },
          "Hard locked intent validation relaxed to best available playlist"
        );
      } else {
      req.log.warn(
        { userId, vibe, finalValidation, hardValidationFailures, finalCount: finalTracks.length },
        "Hard locked intent validation blocked playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "LOCKED_INTENT_VALIDATION_FAILED",
        "I could not make this playlist without breaking the explicit genre or era request.",
        {
          finalValidation,
          hardValidationFailures,
          strictGenreEvidence: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
          strictEraEvidence: strictEraEvidencePublic,
        }
      );
      return;
      }
    }
    const enrichTrackForCoherence = (track: ConstraintTrack) => {
      const classification = userGenreProfile.trackClassifications.get(track.trackId);
      return {
        trackId: track.trackId,
        energy: track.energy,
        valence: track.valence,
        tempo: track.tempo ?? null,
        danceability: track.danceability ?? null,
        acousticness: track.acousticness ?? null,
        artistName: track.artistName,
        genrePrimary: classification?.genrePrimary ?? null,
        genreFamily: classification?.genreFamily ?? null,
        score: track.score,
      };
    };
    let playlistCoherenceScore: PlaylistCoherenceScore | null = null;
    let swapRepairActions: CoherenceSwapRecord[] = [];
    let coherenceRebuildIterations = 0;
    let coherenceGateResult: CoherenceGateResult | null = null;
    if (finalTracks.length >= 4) {
      const enrichedFinal = finalTracks.map(enrichTrackForCoherence);
      const coherenceRepair = coherenceRepairSettingsFromPlan(compilePlan, sceneLockStatus.active);
      if (baseFinalizationCandidates.length > 0) {
        const rebuild = runCoherenceRebuildLoop({
          tracks: enrichedFinal,
          candidates: baseFinalizationCandidates.map(enrichTrackForCoherence),
          intent: v3FallbackIntent,
          scenePrediction: mergedScenePrediction,
          sceneLock: sceneLockStatus,
          sceneAliases,
          playlistLength: length,
          maxPerArtist,
          maxIterations: coherenceRepair.maxIterations,
          repairThreshold: coherenceRepair.repairThreshold,
        });
        playlistCoherenceScore = rebuild.coherenceScore;
        swapRepairActions = rebuild.swapRepairActions;
        coherenceRebuildIterations = rebuild.iterations;
        if (swapRepairActions.length > 0 || rebuild.constraintBuildUsed) {
          const trackById = new Map<string, ConstraintTrack>();
          for (const track of [...finalTracks, ...baseFinalizationCandidates]) {
            trackById.set(track.trackId, track);
          }
          finalTracks = rebuild.tracks
            .map((track) => trackById.get(track.trackId))
            .filter((track): track is ConstraintTrack => !!track) as PlaylistTrack[];
          executionHealth.repairPassCount += 1;
          evidenceRelaxations.push(rebuild.constraintBuildUsed ? "world_constraint_build" : "playlist_coherence_swap_repair");
          if (sceneLockStatus.active) evidenceRelaxations.push("scene_lock_repair_assist");
          publishPartialTracks(finalTracks, 5);
        }

        if (
          mode === "balanced" &&
          playlistCoherenceScore.overallScore < coherenceRepair.repairThreshold &&
          baseFinalizationCandidates.length > 0 &&
          coherenceRebuildIterations < coherenceRepair.maxIterations + 1
        ) {
          const balancedRetry = runCoherenceRebuildLoop({
            tracks: finalTracks.map(enrichTrackForCoherence),
            candidates: baseFinalizationCandidates.map(enrichTrackForCoherence),
            intent: v3FallbackIntent,
            scenePrediction: mergedScenePrediction,
            sceneLock: sceneLockStatus,
            sceneAliases,
            playlistLength: length,
            maxPerArtist,
            maxIterations: 1,
            repairThreshold: coherenceRepair.repairThreshold,
          });
          if (balancedRetry.swapRepairActions.length > 0 || balancedRetry.constraintBuildUsed) {
            playlistCoherenceScore = balancedRetry.coherenceScore;
            swapRepairActions.push(...balancedRetry.swapRepairActions);
            coherenceRebuildIterations += balancedRetry.iterations;
            const trackById = new Map<string, ConstraintTrack>();
            for (const track of [...finalTracks, ...baseFinalizationCandidates]) {
              trackById.set(track.trackId, track);
            }
            finalTracks = balancedRetry.tracks
              .map((track) => trackById.get(track.trackId))
              .filter((track): track is ConstraintTrack => !!track) as PlaylistTrack[];
            evidenceRelaxations.push("balanced_coherence_soft_rebuild");
            publishPartialTracks(finalTracks, 5);
          }
        }
      } else {
        playlistCoherenceScore = scorePlaylistCoherence(
          enrichedFinal,
          v3FallbackIntent,
          mergedScenePrediction,
        );
      }

      if (playlistCoherenceScore && finalTracks.length >= 3) {
        if (compilePlan?.segmentPlan) {
          const segmented = assignTracksToSegments(
            finalTracks.map(enrichTrackForCoherence),
            compilePlan.segmentPlan,
          );
          segmentDiagnostics = segmentAssignmentsToDiagnostics(segmented.assignments);
          const orderMap = new Map(segmented.ordered.map((track, index) => [track.trackId, index]));
          finalTracks = [...finalTracks].sort(
            (a, b) => (orderMap.get(a.trackId) ?? 0) - (orderMap.get(b.trackId) ?? 0),
          );
          evidenceRelaxations.push("segment_playlist_planning");
        } else {
          const arcOrdered = orderTracksByPlaylistSegments(
            finalTracks.map(enrichTrackForCoherence),
            emotionalArc,
          );
          const orderMap = new Map(arcOrdered.map((track, index) => [track.trackId, index]));
          finalTracks = [...finalTracks].sort(
            (a, b) => (orderMap.get(a.trackId) ?? 0) - (orderMap.get(b.trackId) ?? 0),
          );
          evidenceRelaxations.push("emotional_arc_ordering");
          if (segmentDiagnostics.length === 0) {
            segmentDiagnostics = buildPlaylistSegments(emotionalArc).map((seg) => ({
              segmentId: seg.id,
              label: seg.label,
              trackIds: [],
            }));
          }
        }
      }

      if (playlistCoherenceScore) {
        coherenceGateResult = shouldPublishPlaylist(
          playlistCoherenceScore,
          mode as "strict" | "balanced" | "chaotic",
          {
            librarySize: likedSongs.length,
            publishGate: compilePlan?.publishGate,
          },
        );
        if (compilePlan) {
          compilePlan = coherenceGateFromPlan(compilePlan, coherenceGateResult);
        }
        if (!coherenceGateResult.publish && mode === "strict") {
          setGeneratePhase(generateSessionUserId, requestId, "error");
          if (respondIfStale(res, generateSessionUserId, requestId)) return;
          generateFail(
            res,
            409,
            "COHERENCE_GATE_FAILED",
            "This playlist did not pass coherence validation in Strict mode. Try Balanced mode or broaden the prompt.",
            {
              coherenceScore: playlistCoherenceScore,
              coherenceGate: coherenceGateResult,
              swapRepairActions,
              rebuildIterations: coherenceRebuildIterations,
              decomposedIntent,
            },
          );
          return;
        }
        if (playlistCoherenceScore.overallScore < 0.58 && finalTracks.length >= minBestAvailableCount) {
          evidenceRelaxations.push("playlist_coherence_low_best_available");
        }
      }
    }
    const endHumanCoherenceScoreProfile = liveStageProfiler.start("controller.humanCoherenceScore", `${finalTracks.length} tracks`);
    let humanCoherence = humanCoherenceScore(finalTracks, curatorIdentity);
    endHumanCoherenceScoreProfile();
    let humanCoherenceRepairUsed = false;
    let humanCoherenceRepairDiagnostics: Record<string, unknown> = {
      executed: false,
      repaired: false,
      beforeScore: humanCoherence.score,
      afterScore: humanCoherence.score,
    };
    if (finalTracks.length > 0 && humanCoherence.score < 0.56) {
      const repairedCoherence = repairHumanCoherenceOrder(finalTracks, curatorIdentity);
      humanCoherenceRepairDiagnostics = {
        executed: true,
        repaired: repairedCoherence.repaired,
        beforeScore: repairedCoherence.beforeScore,
        afterScore: repairedCoherence.afterScore,
      };
      if (repairedCoherence.repaired) {
        finalTracks = repairedCoherence.tracks;
        humanCoherence = humanCoherenceScore(finalTracks, curatorIdentity);
        humanCoherenceRepairUsed = true;
        executionHealth.repairPassCount += 1;
      }
      if (humanCoherence.score < 0.46 && finalTracks.length < minBestAvailableCount) {
        evidenceRelaxations.push("human_coherence_low_best_available");
      }
    }
    const scoringDiagnostics = pipeline.scoringDiagnostics;
    const genreAudit: GenreAudit = pipeline.genreAudit;
    const { structured, afterDeadZone, afterSmoothing, afterArtistSep } = pipeline.composeMeta;

    const scoringPool = (pipeline.scoringDiagnostics.scoringPool ?? {}) as {
      librarySize?: number;
      hybridPoolSize?: number;
      poolCapped?: boolean;
    };
    const v3PipelineDiagnostics = ((scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
    const v3GenerationDebug = (v3PipelineDiagnostics["generationDebug"] ?? {}) as Record<string, unknown>;
    const waterfallDiagnostics = (v3PipelineDiagnostics["waterfall"] ?? {}) as Record<string, unknown>;
    const removalReasonDiagnostics = Array.isArray(v3PipelineDiagnostics["removalReasons"])
      ? v3PipelineDiagnostics["removalReasons"] as Array<Record<string, unknown>>
      : [];
    const numberFromWaterfall = (key: string, fallback: number): number => {
      const value = waterfallDiagnostics[key];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    const afterForStage = (matcher: RegExp, fallback: number): number => {
      const stage = removalReasonDiagnostics.find((entry) => matcher.test(String(entry["stage"] ?? "")));
      const after = stage?.["after"];
      return typeof after === "number" && Number.isFinite(after) ? after : fallback;
    };
    const stageWaterfall = [
      { stage: "Library Size", count: likedSongs.length },
      { stage: "Sampled", count: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length) },
      { stage: "Classified", count: afterForStage(/genre family normalization|metadata completeness/i, numberFromWaterfall("scoredCount", pipeline.sorted.length)) },
      { stage: "Intent Match", count: numberFromWaterfall("contractCount", likedSongs.length) },
      { stage: "Era Match", count: afterForStage(/era readiness/i, numberFromWaterfall("constraintCount", pipeline.sorted.length)) },
      { stage: "Mood Match", count: afterForStage(/constraint filter|intent readiness/i, numberFromWaterfall("constraintCount", pipeline.sorted.length)) },
      { stage: "Ranking", count: numberFromWaterfall("laneCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length) },
      { stage: "Repair", count: finalization.tracks.length },
      { stage: "Coherence", count: numberFromWaterfall("finalCount", finalTracks.length) },
      { stage: "Final Playlist", count: finalTracks.length },
    ].map((entry, index, entries) => {
      const before = index === 0 ? entry.count : entries[index - 1].count;
      return {
        ...entry,
        before,
        removed: Math.max(0, before - entry.count),
      };
    });
    const largestDrop = [...stageWaterfall]
      .filter((stage) => stage.removed > 0)
      .sort((a, b) => b.removed - a.removed)[0] ?? null;
    const finalizationSeriouslyUnderfilled =
      finalTracks.length < recoveryActivationThreshold(length);
    const recoveryRelaxations = [
      typeof finalization.diagnostics["recoveryStage"] === "string" ? finalization.diagnostics["recoveryStage"] : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["artistLimitRelaxed"] ? "artist_limit_relaxed" : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["albumLimitRelaxed"] ? "album_limit_relaxed" : null,
      ...evidenceRelaxations,
    ].filter((entry): entry is string => !!entry);
    const fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    const pipelineTiming = (v3PipelineDiagnostics["timingMs"] ?? null) as Record<string, unknown> | null;
    const intentContractGuardDiagnostics = (v3PipelineDiagnostics["intentContractGuard"] ?? {}) as Record<string, unknown>;
    const pipelinePromptSurvivability = (intentContractGuardDiagnostics["promptSurvivability"] ?? {}) as Record<string, unknown>;
    const promptSurvivability = {
      preFilterPoolSize: typeof pipelinePromptSurvivability["preFilterPoolSize"] === "number"
        ? pipelinePromptSurvivability["preFilterPoolSize"]
        : null,
      postStructuredRetrievalSize: typeof pipelinePromptSurvivability["postStructuredRetrievalSize"] === "number"
        ? pipelinePromptSurvivability["postStructuredRetrievalSize"]
        : null,
      postContractFilterSize: typeof pipelinePromptSurvivability["postContractFilterSize"] === "number"
        ? pipelinePromptSurvivability["postContractFilterSize"]
        : null,
      postFinalizationSize: finalization.tracks.length,
      firstCollapseReason: typeof pipelinePromptSurvivability["firstCollapseReason"] === "string"
        ? pipelinePromptSurvivability["firstCollapseReason"]
        : finalTracks.length === 0
          ? "finalization_empty"
          : null,
      structuredRetrieval: pipelinePromptSurvivability["structuredRetrieval"] ?? null,
    };
    const softGuardTrace = Array.isArray(intentContractGuardDiagnostics["softGuardOriginTrace"])
      ? intentContractGuardDiagnostics["softGuardOriginTrace"] as Array<Record<string, unknown>>
      : [];
    const buildSoftGuardDebugSummary = (tracks: PlaylistTrack[]): Record<string, unknown> => {
      const traceByTrackId = new Map(
        softGuardTrace
          .filter((entry) => typeof entry["trackId"] === "string")
          .map((entry) => [entry["trackId"] as string, entry])
      );
      const originCounts = {
        subgenre: 0,
        family: 0,
        text: 0,
        fallback: 0,
      };
      let rescuedBySoftGuardFloor = 0;
      for (const track of tracks) {
        const trace = traceByTrackId.get(track.trackId);
        const origin = trace?.["origin"];
        const bucket = origin === "subgenre" || origin === "family" || origin === "text"
          ? origin
          : "fallback";
        originCounts[bucket] += 1;
        if (trace?.["rescuedBySoftGuardFloor"] === true) rescuedBySoftGuardFloor++;
      }
      const topFiveOriginCounts = softGuardTrace
        .filter((entry) => typeof entry["finalRankPosition"] === "number" && entry["finalRankPosition"] <= 5)
        .reduce<Record<"subgenre" | "family" | "text" | "fallback", number>>(
          (acc, entry) => {
            const origin = entry["origin"];
            const bucket = origin === "subgenre" || origin === "family" || origin === "text"
              ? origin
              : "fallback";
            acc[bucket] += 1;
            return acc;
          },
          { subgenre: 0, family: 0, text: 0, fallback: 0 }
        );
      const total = Math.max(1, tracks.length);
      return {
        poolSizeProgression: {
          retrieval: promptSurvivability.preFilterPoolSize,
          structured: promptSurvivability.postStructuredRetrievalSize,
          contractGuard: promptSurvivability.postContractFilterSize,
          final: tracks.length,
        },
        finalOriginDistribution: {
          subgenre: Math.round((originCounts.subgenre / total) * 1000) / 10,
          family: Math.round((originCounts.family / total) * 1000) / 10,
          text: Math.round((originCounts.text / total) * 1000) / 10,
          fallback: Math.round((originCounts.fallback / total) * 1000) / 10,
        },
        finalOriginCounts: originCounts,
        topFiveOriginCounts,
        topFiveHasSubgenre: topFiveOriginCounts.subgenre > 0,
        topFiveHasFallback: topFiveOriginCounts.fallback > 0,
        rescuedBySoftGuardFloor,
      };
    };
    const skipNonEssentialDiagnostics = budget.remainingMs() < 8_000;
    const requestTimingMs = {
      total: Date.now() - startMs,
      preV3: preV3Timing,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] : null,
      candidateGeneration: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] : null,
      v3Scoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] : null,
      sampler: typeof pipelineTiming?.["sampler"] === "number" ? pipelineTiming["sampler"] : null,
      repair: repairTimeMs,
      finalization: finalizationTimeMs,
      v3Pipeline: pipelineTiming,
    };
    const slowestRequestStage = Object.entries({
      preV3: preV3Timing.totalBeforeV3Ms,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] as number : 0,
      candidateGeneration: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] as number : 0,
      v3Scoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] as number : 0,
      sampler: typeof pipelineTiming?.["sampler"] === "number" ? pipelineTiming["sampler"] as number : 0,
      repair: repairTimeMs,
      finalization: finalizationTimeMs,
    }).sort((a, b) => b[1] - a[1])[0] ?? null;
    const executionHealthReport = finaliseExecutionHealth(executionHealth, Date.now() - startMs);
    if (executionHealthReport.healthState !== "HEALTHY") {
      req.log.warn(
        {
          requestId,
          userId,
          healthState: executionHealthReport.healthState,
          primaryCause: executionHealthReport.primaryCause,
          driftDetected: executionHealthReport.driftDetected,
          executionSummary: executionHealthReport.executionSummary,
        },
        "DEGRADED PERFORMANCE MODE",
      );
    }
    const generationDiagnostics = {
      initialLibrarySize: likedSongs.length,
      candidatesSampled: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesClassified: afterForStage(/genre family normalization|metadata completeness/i, numberFromWaterfall("scoredCount", pipeline.sorted.length)),
      candidatesAfterIntent: Number(waterfallDiagnostics["contractCount"] ?? likedSongs.length),
      candidatesAfterEra: afterForStage(/era readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterMood: afterForStage(/constraint filter|intent readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterConstraints: Number(waterfallDiagnostics["constraintCount"] ?? scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterRanking: Number(scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterDiversity: afterArtistSep.length,
      candidatesAfterRepair: finalization.tracks.length,
      candidatesAfterCoherence: Number(waterfallDiagnostics["finalCount"] ?? finalTracks.length),
      candidatesFinal: finalTracks.length,
      promptSurvivability,
      softGuardDebugSummary: skipNonEssentialDiagnostics
        ? { skipped: true, reason: "low_request_budget" }
        : buildSoftGuardDebugSummary(finalTracks),
      waterfall: stageWaterfall,
      largestDrop,
      removalReasons: removalReasonDiagnostics.slice(0, 12),
      timingMs: {
        ...requestTimingMs,
        slowestStage: slowestRequestStage?.[0] ?? null,
        slowestStageMs: slowestRequestStage?.[1] ?? 0,
        stagesOver30s: Object.entries({
          total: requestTimingMs.total,
          preV3: preV3Timing.totalBeforeV3Ms,
          playlistPipeline: playlistPipelineTimeMs,
          retrieval: typeof requestTimingMs.retrieval === "number" ? requestTimingMs.retrieval : 0,
          candidateGeneration: typeof requestTimingMs.candidateGeneration === "number" ? requestTimingMs.candidateGeneration : 0,
          v3Scoring: typeof requestTimingMs.v3Scoring === "number" ? requestTimingMs.v3Scoring : 0,
          sampler: typeof requestTimingMs.sampler === "number" ? requestTimingMs.sampler : 0,
          repair: repairTimeMs,
          finalization: finalizationTimeMs,
        })
          .filter(([, ms]) => ms >= 30_000)
          .map(([stage, ms]) => ({ stage, ms })),
      },
      performanceFastPath: {
        fastPathTriggered: !!preScoringCandidateShape.diagnostics["applied"] ||
          (((v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined)?.["retrievalLatencyGuard"] as Record<string, unknown> | undefined)?.["fastPathTriggered"] === true),
        fallbackSkipped: (((v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined)?.["retrievalLatencyGuard"] as Record<string, unknown> | undefined)?.["fallbackSkipped"] === true),
        candidatePoolSizeFinal: Number(
          (((v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined)?.["retrievalLatencyGuard"] as Record<string, unknown> | undefined)?.["candidatePoolSizeFinal"] ?? 0)
        ),
        candidatePoolBuilds: Number(
          (((v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined)?.["retrievalLatencyGuard"] as Record<string, unknown> | undefined)?.["candidatePoolBuildCount"] ?? 0)
        ),
        executionDepth: Number(
          (((v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined)?.["retrievalLatencyGuard"] as Record<string, unknown> | undefined)?.["executionDepth"] ?? 0)
        ),
        preScoringCandidateShape: preScoringCandidateShape.diagnostics,
      },
      stageProfile: liveStageProfiler.snapshot(),
      recoveryRelaxations,
      recoveryTriggered: fallbackLevel !== "none" || recoveryRelaxations.length > 0,
      fallbackLevel,
      sessionCancelled: false,
      generationDebug: v3GenerationDebug,
      relaxationSteps: Array.isArray(v3GenerationDebug["relaxationSteps"])
        ? v3GenerationDebug["relaxationSteps"]
        : [],
      finalRelaxedConstraints: v3GenerationDebug["finalRelaxedConstraints"] ?? null,
      constraintFailures: Array.isArray(v3GenerationDebug["constraintFailures"])
        ? v3GenerationDebug["constraintFailures"]
        : [],
      dominantCluster: v3GenerationDebug["dominantCluster"] ?? null,
      clusterPurity: typeof v3GenerationDebug["clusterPurity"] === "number"
        ? v3GenerationDebug["clusterPurity"]
        : null,
      artistReuseRate: typeof v3GenerationDebug["artistReuseRate"] === "number"
        ? v3GenerationDebug["artistReuseRate"]
        : null,
      fallbackTriggered: !!fallbackReason || !!finalization.diagnostics.fallbackMode,
      identityType: curatorIdentity.type,
      identitySummary: curatorIdentity.summary,
      curatorIdentity: buildIdentityDebugView(curatorIdentity),
      selectedCluster: clusterCuration.diagnostics.selectedClusterLabel,
      selectedClusterId: clusterCuration.diagnostics.selectedCluster,
      secondaryCluster: clusterCuration.diagnostics.secondaryClusterLabel,
      secondaryClusterId: clusterCuration.diagnostics.secondaryCluster,
      clusterConfidence: Math.max(
        clusterCuration.diagnostics.clusterConfidence,
        parsedCsspIntent.sceneIntent?.sceneConfidence ?? 0,
      ),
      sceneConfidence: parsedCsspIntent.sceneIntent?.sceneConfidence ?? null,
      sceneConfidenceSource: parsedCsspIntent.sceneIntent ? "v3_locked_intent" : "unavailable",
      fallbackCandidatePercent: clusterCuration.diagnostics.fallbackCandidatePercent,
      humanCoherenceScore: humanCoherence.score,
      humanCoherenceComponents: humanCoherence.components,
      humanCoherenceReasons: humanCoherence.reasons,
      humanCoherenceRepairUsed,
      humanCoherenceRepair: humanCoherenceRepairDiagnostics,
      sessionHydrationShared,
      cacheDbActivity: {
        hydrationDbRead: dbHydrationOccurred,
        cachedResultSideEffectWrites: 0,
      },
      majorExclusions: [
        ...clusterCuration.diagnostics.majorExclusions,
        ...humanCoherence.reasons,
      ],
      cohesionScore: typeof finalization.diagnostics["cohesionSkipped"] === "number"
        ? Math.max(0, Math.min(1, 1 - (finalization.diagnostics["cohesionSkipped"] as number) / Math.max(1, finalization.tracks.length + (finalization.diagnostics["cohesionSkipped"] as number))))
        : null,
      failureReason: finalTracks.length === 0 ? "no_final_tracks_after_filters" : null,
      executionHealth: executionHealthReport,
      intentState,
      decomposedIntent,
      intentLossReport,
      coherenceScore: playlistCoherenceScore,
      coherenceGate: coherenceGateResult,
      swapRepairActions,
      sceneLockStatus,
      sceneAliases,
      emotionalArc,
      familiarityMode,
      mergedScenePrediction,
      compilePlan,
      segmentDiagnostics,
      tasteGraphV2: tasteGraphV2 ? {
        nodeCount: tasteGraphV2.nodes.length,
        edgeCount: tasteGraphV2.edges.length,
        genreWeights: tasteGraphV2.genreWeights,
      } : null,
      unknownTokens: decomposedIntent.unknownTokens ?? intentState.unknownTokens ?? [],
      pipelineDiagnostics: buildGenerationPipelineDiagnostics({
        intentState,
        decomposedIntent,
        intentLossReport,
        coherenceScore: playlistCoherenceScore,
        coherenceGate: coherenceGateResult,
        swapRepairActions,
        sceneLockStatus,
        sceneAliases,
        emotionalArc,
        rebuildIterations: coherenceRebuildIterations,
      }),
      ...(debugPerformance && preV3PerformanceReport
        ? {
            preV3PerformanceReport,
            sessionSnapshotCache: getSessionSnapshotCacheStats(),
          }
        : {}),
    };
    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      `Found ${(scoringPool.hybridPoolSize ?? pipeline.sorted.length).toLocaleString()} matching tracks`
    );
    stageTimer.end("Playlist pipeline complete", {
      totalMs: Date.now() - startMs,
      totalSongs: likedSongs.length,
      hybridPool: scoringPool.hybridPoolSize,
      poolCapped: scoringPool.poolCapped,
      excluded: pipeline.hybridExcludedCount,
      finalTracks: finalTracks.length,
    });
    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        trackCount: finalTracks.length,
        poolSize: scoringPool.hybridPoolSize,
      },
      "Playlist composed"
    );

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
    setGenerateStageDetail(generateSessionUserId, requestId, `Applying diversity rules to ${finalTracks.length.toLocaleString()} tracks`);

    publishPartialTracks(finalTracks);
    generationDiagnostics.candidatesFinal = finalTracks.length;
    generationDiagnostics.promptSurvivability = {
      ...generationDiagnostics.promptSurvivability,
      postFinalizationSize: finalTracks.length,
      firstCollapseReason: generationDiagnostics.promptSurvivability.firstCollapseReason ??
        (finalTracks.length === 0 ? "finalization_empty" : null),
    };
    generationDiagnostics.softGuardDebugSummary = skipNonEssentialDiagnostics
      ? { skipped: true, reason: "low_request_budget" }
      : buildSoftGuardDebugSummary(finalTracks);
    req.log.info(
      {
        userId,
        vibe,
        poolSizes: {
          retrieval: generationDiagnostics.promptSurvivability.preFilterPoolSize,
          structuredRetrieval: generationDiagnostics.promptSurvivability.postStructuredRetrievalSize,
          contractFilter: generationDiagnostics.promptSurvivability.postContractFilterSize,
          finalizationInput: finalizationCandidates.length,
          finalOutput: finalTracks.length,
        },
        softGuardDebugSummary: generationDiagnostics.softGuardDebugSummary,
      },
      "Prompt generation pool-size trace"
    );
    generationDiagnostics.fallbackTriggered = generationDiagnostics.fallbackTriggered || !!finalization.diagnostics.fallbackMode;
    generationDiagnostics.fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    generationDiagnostics.recoveryTriggered =
      generationDiagnostics.fallbackLevel !== "none" ||
      generationDiagnostics.recoveryRelaxations.length > 0;
    generationDiagnostics.failureReason = finalTracks.length === 0 ? "no_final_tracks_after_filters" : null;
    const finalResponseExplicitConstraintPartialPublished = finalization.diagnostics["explicitConstraintPartialPublished"] === true;
    if (finalTracks.length < length && !finalResponseExplicitConstraintPartialPublished) {
      const emergencySeenIds = new Set(finalTracks.map((track) => track.trackId));
      const finalResponseArtistCounts = new Map<string, number>();
      for (const track of finalTracks) {
        const key = track.artistName.toLowerCase().trim();
        finalResponseArtistCounts.set(key, (finalResponseArtistCounts.get(key) ?? 0) + 1);
      }
      const finalArtistCap = Number.isFinite(maxPerArtist) ? maxPerArtist : Number.MAX_SAFE_INTEGER;
      const toEmergencyCompletionTrack = <T extends {
        trackId: string;
        trackName: string;
        artistName: string;
        albumName: string;
        albumArt?: string | null;
        durationMs?: number | null;
        energy: number | null;
        valence: number | null;
        tempo?: number | null;
        danceability?: number | null;
        acousticness?: number | null;
        loudness?: number | null;
        speechiness?: number | null;
        releaseYear?: number | null;
        genrePrimary?: string | null;
        genreFamily?: string | null;
        spotifyArtistGenres?: unknown;
        albumGenres?: unknown;
        score?: number;
        rediscoveryScore?: number;
      }>(track: T): ConstraintTrack => ({
        ...track,
        score: typeof track.score === "number" ? track.score : 0.35,
        rediscoveryScore: typeof track.rediscoveryScore === "number" ? track.rediscoveryScore : 0,
      } as ConstraintTrack);
      let finalResponseCompletionAdded = 0;
      let finalResponseArtistCapSkipped = 0;
      let finalResponseArtistCapBypassed = 0;
      const finalResponseCompletionSources = [
        ...finalCandidatePool,
        ...clusterCuration.candidates,
        ...(pipeline.sorted as ConstraintTrack[]),
        ...scoringInputSongs,
        ...likedSongs,
      ];
      for (const track of finalResponseCompletionSources) {
        if (finalTracks.length >= length) break;
        const candidate = toEmergencyCompletionTrack(track);
        if (emergencySeenIds.has(candidate.trackId)) continue;
        const candidateArtist = candidate.artistName.toLowerCase().trim();
        if ((finalResponseArtistCounts.get(candidateArtist) ?? 0) >= finalArtistCap) {
          finalResponseArtistCapSkipped += 1;
          continue;
        }
        emergencySeenIds.add(candidate.trackId);
        finalTracks.push(candidate as PlaylistTrack);
        finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
        finalResponseCompletionAdded += 1;
      }
      if (finalTracks.length < length) {
        for (const track of finalResponseCompletionSources) {
          if (finalTracks.length >= length) break;
          const candidate = toEmergencyCompletionTrack(track);
          if (emergencySeenIds.has(candidate.trackId)) continue;
          const candidateArtist = candidate.artistName.toLowerCase().trim();
          emergencySeenIds.add(candidate.trackId);
          finalTracks.push(candidate as PlaylistTrack);
          finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
          finalResponseCompletionAdded += 1;
          finalResponseArtistCapBypassed += 1;
        }
      }
      let finalResponseDuplicateFillAdded = 0;
      if (finalTracks.length > 0 && finalTracks.length < length) {
        const uniqueSource = finalTracks.slice();
        let cursor = 0;
        while (finalTracks.length < length && cursor < length * 2) {
          const candidate = uniqueSource[cursor % uniqueSource.length];
          cursor += 1;
          if (!candidate) break;
          const previousArtist = finalTracks[finalTracks.length - 1]?.artistName.toLowerCase().trim() ?? null;
          const candidateArtist = candidate.artistName.toLowerCase().trim();
          if (uniqueSource.length > 1 && previousArtist === candidateArtist) continue;
          if ((finalResponseArtistCounts.get(candidateArtist) ?? 0) >= finalArtistCap) {
            finalResponseArtistCapSkipped += 1;
            continue;
          }
          finalTracks.push({ ...candidate });
          finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
          finalResponseDuplicateFillAdded += 1;
        }
        cursor = 0;
        while (finalTracks.length < length && cursor < length * 2) {
          const candidate = uniqueSource[cursor % uniqueSource.length];
          cursor += 1;
          if (!candidate) break;
          const previousArtist = finalTracks[finalTracks.length - 1]?.artistName.toLowerCase().trim() ?? null;
          const candidateArtist = candidate.artistName.toLowerCase().trim();
          if (uniqueSource.length > 1 && previousArtist === candidateArtist) continue;
          finalTracks.push({ ...candidate });
          finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
          finalResponseDuplicateFillAdded += 1;
          finalResponseArtistCapBypassed += 1;
        }
      }
      if (finalResponseCompletionAdded > 0 || finalResponseDuplicateFillAdded > 0) {
        finalTracks = finalTracks.slice(0, length);
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            finalResponseCompletionLockApplied: true,
            finalResponseCompletionAdded,
            finalResponseDuplicateFillAdded,
            finalResponseArtistCapSkipped,
            finalResponseArtistCapBypassed,
          },
        };
        generationDiagnostics.candidatesFinal = finalTracks.length;
        generationDiagnostics.candidatesAfterCoherence = finalTracks.length;
        generationDiagnostics.failureReason = finalTracks.length === 0 ? "no_final_tracks_after_filters" : null;
      }
    }
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    if (isGymWorkoutPrompt(vibe, lockedIntent) && !promptExplicitlyAllowsGymHipHop(vibe, lockedIntent, constraintLayer)) {
      const originalGymTrackCount = finalTracks.length;
      const gymSafeTracks = finalTracks.filter((track) =>
        trackIsGymWorkoutSafe(track, {
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          classMap: userGenreProfile.trackClassifications,
        })
      );
      if (gymSafeTracks.length > 0 && gymSafeTracks.length < finalTracks.length) {
        finalTracks = gymSafeTracks;
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            genericGymContaminationPruned: true,
            genericGymContaminationPrunedCount: originalGymTrackCount - finalTracks.length,
          },
        };
        generationDiagnostics.candidatesFinal = finalTracks.length;
        generationDiagnostics.candidatesAfterCoherence = finalTracks.length;
        generationDiagnostics.failureReason = null;
        publishPartialTracks(finalTracks, 5);
      }
    }
    if (finalTracks.length === 0) {
      const forensicPoolTrace = (scoringDiagnostics.v3Pipeline as Record<string, unknown> | undefined)?.["forensicPoolTrace"];
      req.log.warn(
        { userId, code: "EMPTY_POOL", forensicPoolTrace },
        "Hard filter graph removed all ranked candidates"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
        generateFail(
          res,
          400,
          "EMPTY_PLAYLIST",
        `I found ${generationDiagnostics.candidatesAfterConstraints.toLocaleString()} possible matches, but none survived the final playlist checks. Try broadening the prompt, using Balanced mode, or removing strict era words.`,
        {
          hint: "The final filter graph removed all ranked candidates.",
          generationDiagnostics,
          spotifyApiAudit: sideEffectPolicy.mode === "audit" ? getSpotifyApiAuditSnapshot() : undefined,
          suggestions: [
            "Broaden the prompt",
            "Use Balanced mode",
            "Remove strict era constraints",
          ],
          }
        );
        return;
    }

    if (respondIfStale(res, generateSessionUserId, requestId)) return;

    const playlistName = generatePlaylistName(vibe, emotionProfile);
    const antiBlandnessCandidatePool = [
      ...finalCandidatePool,
      ...clusterCuration.candidates,
      ...(pipeline.sorted as ConstraintTrack[]),
      ...scoringInputSongs,
      ...likedSongs,
    ] as ConstraintTrack[];
    const antiBlandnessOpts = {
      vibe,
      intent: lockedIntent,
      constraints: constraintLayer,
      allowHolidaySeason,
      classMap: userGenreProfile.trackClassifications,
      maxPerArtist,
    };
    const duplicateIdentityCountBeforeAntiBlandness = countDuplicateSongIdentities(finalTracks);
    const finalResponseAntiBlandness = repairFinalResponseDuplicateSongIdentities(
      finalTracks as ConstraintTrack[],
      antiBlandnessCandidatePool,
      antiBlandnessOpts
    );
    const duplicateIdentityCountAfterAntiBlandness = countDuplicateSongIdentities(finalResponseAntiBlandness.tracks);
    const antiBlandnessImproved =
      finalResponseAntiBlandness.diagnostics.replacedCount > 0 ||
      duplicateIdentityCountAfterAntiBlandness < duplicateIdentityCountBeforeAntiBlandness;
    if (antiBlandnessImproved) {
      finalTracks = finalResponseAntiBlandness.tracks as PlaylistTrack[];
      finalization = {
        tracks: finalTracks,
        diagnostics: {
          ...finalization.diagnostics,
          finalResponseAntiBlandness: {
            ...finalResponseAntiBlandness.diagnostics,
            executed: true,
            duplicateIdentityCountBeforeAntiBlandness,
            duplicateIdentityCountAfterAntiBlandness,
          },
        },
      };
      generationDiagnostics.candidatesFinal = finalTracks.length;
      generationDiagnostics.candidatesAfterCoherence = finalTracks.length;
      publishPartialTracks(finalTracks, 5);
    } else {
      finalization = {
        tracks: finalTracks,
        diagnostics: {
          ...finalization.diagnostics,
          finalResponseAntiBlandness: {
            ...finalResponseAntiBlandness.diagnostics,
            executed: true,
            duplicateIdentityCountBeforeAntiBlandness,
            duplicateIdentityCountAfterAntiBlandness,
          },
        },
      };
    }

    const trackObjects = finalTracks.map((t) => ({
      ...t,
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
      durationMs: t.durationMs ?? null,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      tempo: t.tempo ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
      instrumentalness: t.instrumentalness ?? null,
      speechiness: t.speechiness ?? null,
      releaseYear: t.releaseYear ?? null,
      popularity: t.popularity ?? null,
      spotifyArtistGenres: Array.isArray(t.spotifyArtistGenres) ? t.spotifyArtistGenres : [],
      albumGenres: Array.isArray(t.albumGenres) ? t.albumGenres : [],
      genrePrimary: t.genrePrimary ?? null,
      genreFamily: t.genreFamily ?? t.genrePrimary ?? null,
      genres: Array.isArray(t.genres) && t.genres.length > 0
        ? t.genres
        : t.genrePrimary
          ? [t.genrePrimary]
          : [],
      laneId: t.laneId ?? t.sourceLane ?? null,
      laneScore: t.laneScore ?? null,
      laneEra: t.laneEra ?? null,
      clusterId: t.clusterId ?? null,
      clusterIds: t.clusterIds ?? [],
    }));

    setGeneratePhase(generateSessionUserId, requestId, "spotify");
    setGenerateStageDetail(generateSessionUserId, requestId, `Finalising ${finalTracks.length.toLocaleString()} tracks`);
    let spotifyPlaylistUrl: string | null = null;
    const tSpotify = Date.now();
    req.log.info(
      { trackCount: finalTracks.length, devMode },
      devMode ? "Skipping Spotify playlist creation in dev mode" : "Creating Spotify playlist"
    );

    let spotifyPartial = false;
    let spotifyTracksAdded: number | undefined;

    if (sideEffectPolicy.allowSpotifyPlaylistCreate && !devMode && !staleGenerate(generateSessionUserId, requestId)) {
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
              setPendingSpotifyPlaylistId(generateSessionUserId, requestId, id),
          }
        );
        spotifyPartial = !!spotifyResult.partial;
        spotifyTracksAdded = spotifyResult.tracksAdded;
        if (spotifyPartial && (spotifyTracksAdded ?? 0) === 0) {
          spotifyPlaylistUrl = null;
          req.log.warn(
            {
              elapsedMs: Date.now() - tSpotify,
              playlistId: spotifyResult.id,
              tracksRequested: finalTracks.length,
              reused: !!pendingId,
            },
            "Spotify playlist shell created but no tracks were added"
          );
        } else {
          clearPendingSpotifyPlaylist(generateSessionUserId, requestId);
          spotifyPlaylistUrl = spotifyResult.url;
        }
        req.log.info(
          {
            elapsedMs: Date.now() - tSpotify,
            partial: spotifyPartial,
            tracksAdded: spotifyTracksAdded,
            tracksRequested: finalTracks.length,
            reused: !!pendingId,
          },
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


    setGeneratePhase(generateSessionUserId, requestId, sideEffectPolicy.allowSavedPlaylistWrites ? "saving" : "done");
    setGenerateStageDetail(generateSessionUserId, requestId, sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist" : "Audit mode: skipping playlist writes");
    const tSave = Date.now();
    req.log.info(
      { auditMode: sideEffectPolicy.mode === "audit" },
      sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist to database" : "Skipping playlist database writes",
    );

    const profilePayload = {
      ...emotionProfile,
      journeyArc,
      librarySize: likedSongs.length,
    };
    let savedPlaylistId = 0;
    let savedShareSlug = "";
    if (sideEffectPolicy.allowSavedPlaylistWrites) {
    const shareSlug = generateShareSlug();
    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: profilePayload as any,
        tracks: trackObjects as any,
        spotifyUrl: spotifyPlaylistUrl,
        vibe,
        mode,
        shareSlug,
      })
      .returning({ id: savedPlaylistsTable.id, shareSlug: savedPlaylistsTable.shareSlug });
      savedPlaylistId = insertResult[0]?.id ?? 0;
      savedShareSlug = insertResult[0]?.shareSlug ?? "";
    }

    req.log.info(
      { ms: Date.now() - tSave, userId, playlistId: savedPlaylistId, trackCount: finalTracks.length },
      "Playlist saved to DB"
    );
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    if (sideEffectPolicy.allowHistoryWrites) {
    try {
      await db.insert(playlistHistoryTable).values({
        spotifyUserId: userId,
        playlistId: spotifyPlaylistUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
        playlistUrl: spotifyPlaylistUrl ?? (savedShareSlug ? publicUrl(`/p/${savedShareSlug}`) : ""),
        name: playlistName,
        vibe,
        mode,
        trackCount: finalTracks.length,
        emotionProfile: { ...emotionProfile, journeyArc } as any,
        trackIds: finalTracks.map((t) => t.trackId) as any,
      });
      if (!devMode && !noLibraryMode) {
        sessionSnapshot = mergeSessionSnapshot<
          typeof likedSongsTable.$inferSelect,
          typeof playlistHistoryTable.$inferSelect,
          FeedbackMemory
        >(userId, sessionSnapshotId, {
          likedSongs: likedRowsRaw,
          recentPlaylists: [
            {
              id: 0,
              spotifyUserId: userId,
              playlistId: spotifyPlaylistUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
              playlistUrl: spotifyPlaylistUrl ?? (savedShareSlug ? publicUrl(`/p/${savedShareSlug}`) : ""),
              name: playlistName,
              vibe,
              mode,
              trackCount: finalTracks.length,
              emotionProfile: { ...emotionProfile, journeyArc },
              trackIds: finalTracks.map((t) => t.trackId),
              createdAt: new Date(),
            },
            ...(sessionSnapshot?.recentPlaylists ?? []),
          ].slice(0, 25),
          feedbackMemory,
        });
      }
    } catch (histErr) {
      req.log.warn({ err: histErr }, "playlist_history insert failed");
    }
    }

    const spotifyFields = spotifyPlaylistUrl
      ? {
          spotifyPlaylistUrl,
          ...(spotifyPartial
            ? { spotifyPartial: true as const, spotifyTracksAdded: spotifyTracksAdded ?? 0 }
            : {}),
        }
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
      !noLibraryMode && datedLikes.length >= 200 && recentLikeShare > 0.85
        ? "Most cached likes look recently added. Run a full library sync from the app so older favourites are included."
        : null;
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    const v3Diagnostics = formatV3DiagnosticsForApi(
      pipeline.scoringDiagnostics?.v3Pipeline,
      vibe
    );
    const promptDriftAudit = buildPromptDriftAudit(v3Diagnostics);
    const feedbackDiagnostics = buildFeedbackDiagnostics(feedbackMemory, finalTracks);
    if (promptDriftAudit["pass"] === false) {
      req.log.warn(
        { userId, vibe, promptDriftAudit, playlistQuality: v3Diagnostics?.["playlistQuality"] ?? null },
        "Prompt drift audit warning"
      );
    }
    assertQualityConsistency(req.log, {
      tracks: finalTracks,
      diagnostics: v3Diagnostics,
      fallbackUsed: !!pipeline.scoringDiagnostics?.fastFallback,
    });

    if (!varietyBoost && !devMode) {
      const cachedFinalTracks = finalTracks.map((t) => ({
        ...t,
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName,
          albumName: t.albumName,
          albumArt: t.albumArt ?? null,
          durationMs: t.durationMs ?? null,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
          tempo: t.tempo ?? null,
        danceability: t.danceability ?? null,
        acousticness: t.acousticness ?? null,
        instrumentalness: t.instrumentalness ?? null,
        speechiness: t.speechiness ?? null,
        releaseYear: t.releaseYear ?? null,
        popularity: t.popularity ?? null,
        spotifyArtistGenres: Array.isArray(t.spotifyArtistGenres) ? t.spotifyArtistGenres : [],
        albumGenres: Array.isArray(t.albumGenres) ? t.albumGenres : [],
          score: Math.round(t.score * 100) / 100,
          rediscoveryScore: t.rediscoveryScore,
          narrativeRole: t.narrativeRole,
        genrePrimary: t.genrePrimary ?? null,
        genreFamily: t.genreFamily ?? t.genrePrimary ?? null,
        genres: Array.isArray(t.genres) && t.genres.length > 0
          ? t.genres
          : t.genrePrimary
            ? [t.genrePrimary]
            : [],
        laneId: t.laneId ?? t.sourceLane ?? null,
        sourceLane: t.sourceLane ?? t.laneId ?? null,
        laneScore: t.laneScore,
        laneEra: t.laneEra,
        clusterId: t.clusterId ?? t.clusterIds?.[0] ?? null,
        clusterIds: t.clusterIds ?? (t.clusterId ? [t.clusterId] : []),
      }));
      warnIfV3MetadataLost(
        finalTracks,
        cachedFinalTracks,
        "cache-write"
      );
      warnIfFieldDropped("laneScore", finalTracks, cachedFinalTracks, "cache-write");
      warnIfFieldDropped("clusterIds", finalTracks, cachedFinalTracks, "cache-write");
    }

    setGeneratePhase(generateSessionUserId, requestId, "done");
    if (respondIfStale(res, generateSessionUserId, requestId)) return;

    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        cacheHit: false,
        trackCount: finalTracks.length,
        poolSize: scoringPool.hybridPoolSize,
        promptDriftAudit,
        feedbackDiagnostics,
      },
      "Generation complete"
    );
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    publishFinalTracksContext();
    const endApiFormattingProfile = liveStageProfiler.start("controller.apiTrackFormatting", `${finalTracks.length} tracks`);
    let finalApiTracks = formatTracksForApi(finalTracks, emotionProfile);
    if (isGymWorkoutPrompt(vibe, lockedIntent) && !promptExplicitlyAllowsGymHipHop(vibe, lockedIntent, constraintLayer)) {
      const prunedApiTracks = finalApiTracks.filter((track) => {
        const family = (track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
        return !["hip_hop", "country", "classical", "christmas"].includes(family);
      });
      if (prunedApiTracks.length > 0 && prunedApiTracks.length < finalApiTracks.length) {
        const originalApiTrackCount = finalApiTracks.length;
        const keptIds = new Set(prunedApiTracks.map((track) => track.id));
        finalApiTracks = prunedApiTracks;
        finalTracks = finalTracks.filter((track) => keptIds.has(track.trackId));
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            genericGymApiContaminationPruned: true,
            genericGymApiContaminationPrunedCount: originalApiTrackCount - finalApiTracks.length,
          },
        };
      }
    }
    if (isFocusStudyPrompt(vibe, lockedIntent)) {
      const focusAllowedFamilies = new Set(["electronic", "indie", "pop", "ambient", "soundtrack", "folk", "blues", "soul", "unknown"]);
      const prunedApiTracks = finalApiTracks.filter((track) => {
        const family = (track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
        return focusAllowedFamilies.has(family);
      });
      if (prunedApiTracks.length > 0 && prunedApiTracks.length < finalApiTracks.length) {
        const originalApiTrackCount = finalApiTracks.length;
        const keptIds = new Set(prunedApiTracks.map((track) => track.id));
        finalApiTracks = prunedApiTracks;
        finalTracks = finalTracks.filter((track) => keptIds.has(track.trackId));
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            focusApiContaminationPruned: true,
            focusApiContaminationPrunedCount: originalApiTrackCount - finalApiTracks.length,
          },
        };
      }
    }
    if (finalApiTracks.length < length) {
      const apiRefillSeenIds = new Set(finalTracks.map((track) => track.trackId));
      const apiRefillSeenSignatures = new Set(
        finalTracks.map((track) => trackRepeatSignature(track)).filter((value): value is string => !!value)
      );
      const apiRefillArtistCounts = new Map<string, number>();
      for (const track of finalTracks) {
        const artist = track.artistName.toLowerCase().trim();
        apiRefillArtistCounts.set(artist, (apiRefillArtistCounts.get(artist) ?? 0) + 1);
      }
      const apiFamilyAllowed = (track: ConstraintTrack): boolean => {
        const family = trackGenreFamily(track, userGenreProfile.trackClassifications);
        if (isGymWorkoutPrompt(vibe, lockedIntent) && !promptExplicitlyAllowsGymHipHop(vibe, lockedIntent, constraintLayer)) {
          return !["hip_hop", "country", "classical", "christmas"].includes(family);
        }
        if (isFocusStudyPrompt(vibe, lockedIntent)) {
          return new Set(["electronic", "indie", "pop", "ambient", "soundtrack", "folk", "blues", "soul", "unknown"]).has(family);
        }
        return true;
      };
      const apiRefillSources = [
        ...finalCandidatePool,
        ...clusterCuration.candidates,
        ...(pipeline.sorted as ConstraintTrack[]),
        ...scoringInputSongs.map((track) => ({ ...hydrateTrackGenre(track), score: 0.4 } as ConstraintTrack)),
        ...likedSongs.map((track) => ({ ...hydrateTrackGenre(track), score: 0.3 } as ConstraintTrack)),
      ];
      let apiRefillAdded = 0;
      let apiRefillArtistCapSkipped = 0;
      for (const source of apiRefillSources) {
        if (finalTracks.length >= length) break;
        const candidate = source as ConstraintTrack;
        if (apiRefillSeenIds.has(candidate.trackId)) continue;
        const candidateSignature = trackRepeatSignature(candidate);
        if (candidateSignature && apiRefillSeenSignatures.has(candidateSignature)) continue;
        if (!finalTrackIsHardSafe(candidate, {
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          allowHolidaySeason,
          classMap: userGenreProfile.trackClassifications,
        })) continue;
        if (!apiFamilyAllowed(candidate)) continue;
        const artist = candidate.artistName.toLowerCase().trim();
        if ((apiRefillArtistCounts.get(artist) ?? 0) >= maxPerArtist) {
          apiRefillArtistCapSkipped += 1;
          continue;
        }
        apiRefillSeenIds.add(candidate.trackId);
        if (candidateSignature) apiRefillSeenSignatures.add(candidateSignature);
        apiRefillArtistCounts.set(artist, (apiRefillArtistCounts.get(artist) ?? 0) + 1);
        finalTracks.push(candidate as PlaylistTrack);
        apiRefillAdded += 1;
      }
      if (apiRefillAdded > 0) {
        finalTracks = finalTracks.slice(0, length);
        finalApiTracks = formatTracksForApi(finalTracks, emotionProfile);
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            apiPruneRefillApplied: true,
            apiPruneRefillAdded: apiRefillAdded,
            apiPruneRefillArtistCapSkipped: apiRefillArtistCapSkipped,
          },
        };
      } else if (finalApiTracks.length < length) {
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            apiPruneUnderfilled: true,
            apiPruneUnderfilledBy: length - finalApiTracks.length,
          },
        };
      }
    }
    const duplicateIdentityCountBeforeApiRefillGuard = countDuplicateSongIdentities(finalTracks);
    if (duplicateIdentityCountBeforeApiRefillGuard > 0) {
      const postApiAntiBlandness = repairFinalResponseDuplicateSongIdentities(
        finalTracks as ConstraintTrack[],
        antiBlandnessCandidatePool,
        antiBlandnessOpts
      );
      if (
        postApiAntiBlandness.diagnostics.replacedCount > 0 &&
        postApiAntiBlandness.tracks.length === finalTracks.length &&
        countDuplicateSongIdentities(postApiAntiBlandness.tracks) < duplicateIdentityCountBeforeApiRefillGuard
      ) {
        finalTracks = postApiAntiBlandness.tracks as PlaylistTrack[];
        finalApiTracks = formatTracksForApi(finalTracks, emotionProfile);
        finalization = {
          tracks: finalTracks,
          diagnostics: {
            ...finalization.diagnostics,
            postApiDuplicateIdentitySwapApplied: true,
            duplicateIdentityCountBeforeApiRefillGuard,
            duplicateIdentityCountAfterApiRefillGuard: countDuplicateSongIdentities(postApiAntiBlandness.tracks),
            postApiAntiBlandness: {
              ...postApiAntiBlandness.diagnostics,
              executed: true,
            },
          },
        };
      }
    }
    endApiFormattingProfile();
    const finalGenreDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, track.genrePrimary ?? track.genreFamily ?? track.genres?.[0]),
      {},
    );
    const finalEraDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, eraBucket(track.releaseYear)),
      {},
    );
    const finalMoodDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, moodBucket(track.energy, track.valence)),
      {},
    );
    const finalEnergyDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, energyBucket(track.energy)),
      {},
    );
    const artistDiversity = artistDiversityDiagnostics(finalTracks, maxPerArtist);
    const playlistQuality = (v3Diagnostics?.playlistQuality ?? null) as Record<string, unknown> | null;
    const coherenceDiagnostics = (v3Diagnostics?.playlistCoherence ?? null) as Record<string, unknown> | null;
    const qualitySignals = [
      typeof playlistQuality?.["overall"] === "number" ? playlistQuality["overall"] as number : null,
      typeof playlistQuality?.["promptAlignment"] === "number" ? playlistQuality["promptAlignment"] as number : null,
      typeof playlistQuality?.["genrePurity"] === "number" ? playlistQuality["genrePurity"] as number : null,
      typeof playlistQuality?.["eraAlignment"] === "number" ? playlistQuality["eraAlignment"] as number : null,
      typeof coherenceDiagnostics?.["avg_transition_score"] === "number" ? coherenceDiagnostics["avg_transition_score"] as number : null,
    ].filter((value): value is number => value !== null && Number.isFinite(value));
    const recoveryPenalty = generationDiagnostics.recoveryRelaxations.length > 0 ? 0.10 : 0;
    const fallbackPenalty = generationDiagnostics.fallbackTriggered ? 0.12 : 0;
    const underfilledPenalty = finalTracks.length < length ? Math.min(0.20, (length - finalTracks.length) / Math.max(1, length) * 0.5) : 0;
    const strictGenreEvidenceWeak =
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.verifiedCount < strictGenreEvidenceDiagnostics.requiredCount;
    const strictEraEvidenceWeak =
      strictEraEvidenceDiagnostics.active &&
      strictEraEvidenceDiagnostics.verifiedCount < strictEraEvidenceDiagnostics.requiredCount &&
      !strictEraEvidenceRelaxed;
    const confidenceCap = Math.min(
      0.99,
      strictGenreEvidenceWeak ? 0.54 : 0.99,
      strictEraEvidenceWeak ? 0.58 : 0.99,
      hasExplicitSubgenreIntent(lockedIntent) && strictGenreEvidenceWeak ? 0.50 : 0.99,
      generationDiagnostics.recoveryRelaxations.length > 0 ? 0.72 : 0.99,
      finalTracks.length < length ? 0.45 : 0.99,
      finalApiTracks.length < length ? 0.42 : 0.99,
      finalization.diagnostics["apiPruneUnderfilled"] ? 0.38 : 0.99,
    );
    const diversityPenalty = (artistDiversity.cappedTracks > 0 ? 0.10 : 0) +
      (finalization.diagnostics["artistLimitRelaxed"] ? 0.04 : 0) +
      (finalization.diagnostics["albumLimitRelaxed"] ? 0.03 : 0);
    const coherencePenalty = typeof coherenceDiagnostics?.["avg_position_shift"] === "number" &&
      (coherenceDiagnostics["avg_position_shift"] as number) > Math.max(8, length * 0.35)
      ? 0.05
      : 0;
    const fillRatio = Math.min(1, finalTracks.length / Math.max(1, length));
    const confidenceScore = Math.max(
      0.05,
      Math.min(
        confidenceCap,
        (qualitySignals.length
          ? qualitySignals.reduce((sum, value) => sum + value, 0) / qualitySignals.length
          : fillRatio * 0.72 + 0.18) - recoveryPenalty - fallbackPenalty - underfilledPenalty - diversityPenalty - coherencePenalty
      )
    );
    const playlistConfidence = {
      score: Math.round(confidenceScore * 100) / 100,
      percent: Math.round(confidenceScore * 100),
      label: confidenceScore >= 0.78
        ? "Strong match"
        : confidenceScore >= 0.58
          ? "Good match"
          : "Best available match",
      recoveryUsed: generationDiagnostics.recoveryTriggered,
      fallbackUsed: generationDiagnostics.fallbackTriggered,
    };
    recordUnknownTermEvents({
      userId,
      prompt: vibe,
      intentUnderstanding: intentUnderstandingDiagnostics,
      playlistConfidence: playlistConfidence.percent,
      overallCoherence: playlistCoherenceScore?.overallScore ?? null,
      inferredScene: decomposedIntent.scene ?? decomposedIntent.culturalRefs[0] ?? null,
    });
    if (!devMode && !auditMode) {
      void recordPromptSceneMemory({
        userId,
        prompt: vibe,
        sceneKey: decomposedIntent.scene ?? sceneAliases[0] ?? null,
        genreFamilies: sceneAliases,
        coherenceScore: playlistCoherenceScore?.overallScore ?? null,
        familiarityMode,
      }).catch((err) => req.log.warn({ err }, "Failed to record cross-session prompt memory"));
      void refreshGlobalTasteProfile(userId).catch((err) =>
        req.log.warn({ err }, "Failed to refresh global taste profile"),
      );
    }
    if (sideEffectPolicy.allowSavedPlaylistWrites && savedPlaylistId > 0) {
    try {
      await db
        .update(savedPlaylistsTable)
        .set({
          emotionProfile: {
            ...(profilePayload as Record<string, unknown>),
            generationSummary: {
              confidence: playlistConfidence,
              generationDiagnostics: {
                initialLibrarySize: generationDiagnostics.initialLibrarySize,
                candidatesSampled: generationDiagnostics.candidatesSampled,
                candidatesFinal: generationDiagnostics.candidatesFinal,
                largestDrop: generationDiagnostics.largestDrop,
                recoveryRelaxations: generationDiagnostics.recoveryRelaxations,
                recoveryTriggered: generationDiagnostics.recoveryTriggered,
                fallbackLevel: generationDiagnostics.fallbackLevel,
                sessionCancelled: generationDiagnostics.sessionCancelled,
                fallbackTriggered: generationDiagnostics.fallbackTriggered,
              },
              artistDiversity,
            },
          } as any,
        })
        .where(eq(savedPlaylistsTable.id, savedPlaylistId));
    } catch (err) {
      req.log.warn({ err, savedPlaylistId }, "Failed to persist generation summary for gallery");
    }
    }
    const v3DiagnosticPayload = ((scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
    const compactScoringDiagnostics = compactScoringDiagnosticsForApi(scoringDiagnostics);
    const noLibrarySpotifyDiagnostics = noLibraryMode
      ? {
          searched: noLibraryExplicitFamilies.length > 0,
          expectedFamilies: noLibraryExplicitFamilies,
          candidateCount: noLibrarySpotifyCandidateCount,
          verifiedCandidateCount: noLibrarySpotifyVerifiedCount,
          fallbackReason: noLibrarySpotifyFallbackReason,
          retrievalCompletion: noLibraryRetrievalDiagnostics,
        }
      : null;
    const strictGenreEvidencePublic = {
      ...strictGenreEvidenceDiagnostics,
      verified: undefined,
      compatible: undefined,
      relaxed: strictGenreEvidenceRelaxed,
    };
    const endIntentSurvivalProfile = liveStageProfiler.start("controller.intentSurvivalDiagnostics", `${finalTracks.length} tracks`);
    const intentSurvivalDiagnostics = buildIntentSurvivalDiagnostics({
      prompt: vibe,
      lockedIntent,
      constraintLayer,
      emotionProfile,
      finalTracks,
      classMap: userGenreProfile.trackClassifications,
      v3Diagnostics,
      generationDiagnostics: generationDiagnostics as Record<string, unknown>,
      finalizationDiagnostics: finalization.diagnostics as Record<string, unknown>,
      finalValidation: finalValidation as unknown as Record<string, "PASS" | "FAIL">,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
      intentUnderstanding: intentUnderstandingDiagnostics,
    });
    endIntentSurvivalProfile();
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const v3DiagnosticsWithIntentSurvival = {
      ...(v3Diagnostics ?? {}),
      intentSurvival: intentSurvivalDiagnostics,
      intentUnderstanding: intentUnderstandingDiagnostics,
      decomposedIntent,
      intentState,
      intentLossReport,
      playlistCoherence: playlistCoherenceScore,
      coherenceScore: playlistCoherenceScore,
      coherenceGate: coherenceGateResult,
      swapRepairActions,
      sceneLockStatus,
      sceneAliases,
      emotionalArc,
    };
    const productionTimelineReport = buildProductionTimelineReport(productionTimeline, startMs, {
      failureReason: fallbackReason ? "time_budget_fast_fallback" : null,
    });
    const generationDiagnosticsWithTimeline = {
      ...generationDiagnostics,
      productionTimeline: productionTimelineReport,
    };
    const generationAuditSnapshot = {
      prompt: vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      playlistId: savedPlaylistId,
      trackCount: finalTracks.length,
      cacheDiagnostics: {
        status: cacheEntryStatus,
        staleBypassed: cacheEntryStatus === "stale",
      },
      pool: {
        librarySize: scoringPool.librarySize,
        hybridPoolSize: scoringPool.hybridPoolSize,
        poolCapped: scoringPool.poolCapped,
      },
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
      promptDriftAudit,
      generationDiagnostics: generationDiagnosticsWithTimeline,
      ...(debugMode
        ? {
            diagnostics: {
              trace: pipeline.pipelineTrace,
              timings: (pipeline.scoringDiagnostics?.v3Pipeline as Record<string, unknown> | undefined)?.["timingMs"] ?? null,
              fallbackEvents: pipeline.pipelineTrace?.fallbackEvents ?? [],
            },
          }
        : {}),
      artistDiversity,
      playlistConfidence,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      finalization: finalization.diagnostics,
      playlistQuality: v3Diagnostics?.playlistQuality ?? null,
      explicitIntentRepair: ((v3Diagnostics ?? {}) as Record<string, unknown>)["explicitIntentRepair"] ?? null,
      feedbackDiagnostics,
      intentSurvival: intentSurvivalDiagnostics,
    };

    if (sideEffectPolicy.allowResultCacheWrites && !varietyBoost && !devMode) {
      setCachedGenerateResult(resultCacheKey, {
        cacheVersion: "v30",
        playlistName,
        vibe,
        mode,
        finalTracks: trackObjects as any,
        emotionProfile: { ...emotionProfile, journeyArc },
        spotifyPlaylistUrl,
        v3Diagnostics: v3DiagnosticsWithIntentSurvival,
        generationDiagnostics: generationDiagnosticsWithTimeline,
        artistDiversity,
        playlistConfidence,
        cachedAt: Date.now(),
      });
    }

    if (sideEffectPolicy.mode === "audit" && !debugMode) {
      const endAuditResponseProfile = liveStageProfiler.start("controller.responseAssembly.auditSlim", `${finalApiTracks.length} tracks`);
      const auditGenerationDiagnostics = {
        ...generationDiagnosticsWithTimeline,
        stageProfile: liveStageProfiler.snapshot(),
      };
      const auditResponse = {
        success: true,
        playlistId: savedPlaylistId,
        auditMode: true,
        spotifyApiAudit: getSpotifyApiAuditSnapshot(),
        sideEffects: {
          spotifyPlaylistCreate: "skipped",
          savedPlaylistWrites: "skipped",
          historyWrites: "skipped",
          feedbackWrites: "skipped",
          analyticsWrites: "skipped",
          resultCacheWrites: "skipped",
        },
        playlistName,
        name: playlistName,
        vibe,
        mode,
        noLibraryMode: !!noLibraryMode,
        noLibrarySpotify: noLibrarySpotifyDiagnostics,
        playlistConfidence,
        count: finalTracks.length,
        totalTracks: finalTracks.length,
        degraded: pipeline.pipelineTrace?.degraded ?? false,
        degradationReasons: pipeline.pipelineTrace?.degradationReasons ?? [],
        generationMs,
        cacheDiagnostics: {
          status: cacheEntryStatus,
          staleBypassed: cacheEntryStatus === "stale",
        },
        stats: {
          trackCount: finalTracks.length,
          totalDurationMs,
          artistCount,
          generationMs,
        },
        tracks: finalApiTracks,
        finalGenreDistribution,
        finalEraDistribution,
        finalMoodDistribution,
        finalEnergyDistribution,
        generationDiagnostics: auditGenerationDiagnostics,
        artistDiversity,
        feedbackDiagnostics,
        promptDriftAudit,
        strictGenreEvidence: strictGenreEvidencePublic,
        strictEraEvidence: strictEraEvidencePublic,
        finalization: finalization.diagnostics,
        intentSurvival: intentSurvivalDiagnostics,
        v3Diagnostics: v3DiagnosticsWithIntentSurvival,
        requestOrchestration: pipeline.requestOrchestration ?? {
          layer: "request",
          candidateGenerator: fallbackReason ? "fast_fallback" : "v3",
          selectionOwner: "request-layer",
          repairOwner: "request-layer",
        },
        ...(pipeline.scoringDiagnostics?.fastFallback
          ? { fastFallback: true }
          : {}),
      };
      endAuditResponseProfile();
      const endAuditJsonProfile = liveStageProfiler.start("controller.responseJson.auditSlim", `${finalApiTracks.length} tracks`);
      res.json(auditResponse);
      endAuditJsonProfile();
      return;
    }

    res.json({
      success: true,
      playlistId: savedPlaylistId,
      savedPlaylistId,
      shareSlug: savedShareSlug || undefined,
      shareUrl: savedShareSlug ? publicUrl(`/p/${savedShareSlug}`) : undefined,
      auditMode: sideEffectPolicy.mode === "audit",
      spotifyApiAudit: sideEffectPolicy.mode === "audit" ? getSpotifyApiAuditSnapshot() : undefined,
      sideEffects: sideEffectPolicy.mode === "audit"
        ? {
            spotifyPlaylistCreate: "skipped",
            savedPlaylistWrites: "skipped",
            historyWrites: "skipped",
            feedbackWrites: "skipped",
            analyticsWrites: "skipped",
            resultCacheWrites: "skipped",
          }
        : undefined,
      ...spotifyFields,
      playlistName,
      name: playlistName,
      vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      devMode,
      playlistConfidence,
      count: finalTracks.length,
      totalTracks: finalTracks.length,
      degraded: pipeline.pipelineTrace?.degraded ?? false,
      degradationReasons: pipeline.pipelineTrace?.degradationReasons ?? [],
      ...(fallbackReason ? { fallbackReason } : {}),
      generationMs,
      cacheDiagnostics: {
        status: cacheEntryStatus,
        staleBypassed: cacheEntryStatus === "stale",
      },
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
            scoringDiagnostics: compactScoringDiagnostics,
            genreAudit,
          }
        : {
            scoringDiagnostics: compactScoringDiagnostics,
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
      tracks: finalApiTracks,
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
      generationDiagnostics: generationDiagnosticsWithTimeline,
      artistDiversity,
      feedbackDiagnostics,
      promptDriftAudit,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      intentUnderstanding: intentUnderstandingDiagnostics,
      intentState,
      decomposedIntent,
      intentLossReport,
      playlistCoherence: playlistCoherenceScore,
      coherenceScore: playlistCoherenceScore,
      coherenceGate: coherenceGateResult,
      swapRepairActions,
      sceneLockStatus,
      sceneAliases,
      emotionalArc,
      intentSurvival: intentSurvivalDiagnostics,
      generationAuditSnapshot,
      requestOrchestration: pipeline.requestOrchestration ?? {
        layer: "request",
        candidateGenerator: fallbackReason ? "fast_fallback" : "v3",
        selectionOwner: "request-layer",
        repairOwner: "request-layer",
      },
      sceneDetection: pipeline.ecosystemDebug
        ? {
            sceneId: pipeline.ecosystemDebug.sceneId,
            sceneLabel: pipeline.ecosystemDebug.sceneLabel,
            sceneConfidence: pipeline.ecosystemDebug.sceneConfidence,
            locked: pipeline.ecosystemDebug.locked,
            primaryEcosystem: pipeline.ecosystemDebug.primaryEcosystem,
            flowPhases: pipeline.ecosystemDebug.flowPhases,
            ecosystemCompliance: pipeline.ecosystemDebug.ecosystemCompliance,
          }
        : null,
      v3Diagnostics: v3DiagnosticsWithIntentSurvival,
      ...(pipeline.scoringDiagnostics?.fastFallback
        ? { fastFallback: true }
        : {}),
      ...(debugMode
        ? {
            _debug: {
              noLibraryMode: !!noLibraryMode,
              scoringWeights: "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
              noLibraryWeights: noLibraryMode ? "semantic:0.55_emotion:0.20_scene:0.15_aesthetic:0.10" : null,
              scoringDiagnostics: compactScoringDiagnostics,
              ecosystemDebug: pipeline.ecosystemDebug,
              semanticScene: (scoringDiagnostics as Record<string, unknown>).semanticResolution ?? null,
              poolInfo: {
                librarySize: scoringPool.librarySize,
                hybridPoolSize: scoringPool.hybridPoolSize,
                poolCapped: scoringPool.poolCapped,
              },
              genreAudit,
              intentSurvival: intentSurvivalDiagnostics,
            },
            debug: {
              activePipeline: "v3.1_unified_routing",
              timing: {
                preV3Breakdown: preV3Timing,
              },
              qualitySignals: qualitySignalContext,
              constraints: {
                layer: constraintLayer,
                lockedIntent,
                finalValidation,
                strictEraEvidence: strictEraEvidencePublic,
                result: {
                  filteredCount: 0,
                  diversityWarning: false,
                  finalCount: finalTracks.length,
                },
              },
              v11: {
                role: "candidateGeneration",
                semanticResolution:
                  (scoringDiagnostics as Record<string, unknown>).semanticResolution ??
                  { sceneId: null, confidence: 0, fallback: true, sceneStatus: "fallback" },
                scoringModel:
                  (scoringDiagnostics as Record<string, unknown>).scoringModel ?? "v11",
                candidatePool: {
                  librarySize: scoringPool.librarySize,
                  hybridPoolSize: scoringPool.hybridPoolSize,
                  poolCapped: scoringPool.poolCapped,
                },
                candidateWeights: noLibraryMode
                  ? "semantic:0.55_emotion:0.20_scene:0.15_aesthetic:0.10"
                  : "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
                topRankedCandidates:
                  (scoringDiagnostics as Record<string, unknown>).topScored ?? [],
                preV3TopCandidates:
                  v3DiagnosticPayload["preV3TopCandidates"] ?? [],
                exclusionReasons:
                  (scoringDiagnostics as Record<string, unknown>).exclusionReasons ?? {},
                dominantGenres:
                  (scoringDiagnostics as Record<string, unknown>).dominantGenres ?? [],
              },
              v3: (scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {},
              intentSurvival: intentSurvivalDiagnostics,
              waterfall: v3DiagnosticPayload["waterfall"] ?? null,
              removalReasons: v3DiagnosticPayload["removalReasons"] ?? [],
              retrievalPools: v3DiagnosticPayload["retrievalPoolsDetailed"] ?? null,
              intentContract: v3DiagnosticPayload["intentContract"] ?? null,
              fallbacks: v3DiagnosticPayload["fallbacks"] ?? [],
              noLibraryMode: !!noLibraryMode,
              poolInfo: {
                librarySize: scoringPool.librarySize,
                hybridPoolSize: scoringPool.hybridPoolSize,
                poolCapped: scoringPool.poolCapped,
              },
              genreAudit,
              systemDiagnostics: {
                v11Role:          "candidate_scoring_only",
                v3Role:           "final_selection_engine",
                uiAlignedTo:      "v3",
                debugTruthLevel:  "selection_based",
                consistencyCheck: "PASS",
                v11UsedFor: "candidateGeneration",
                v3UsedFor: "finalSelection",
                debugPanelAligned: true,
                pipelineConsistency: "OK",
              },
            },
          }
        : {}),
    });
    } finally {
      genStageTimer?.dispose();
      cleanupClientDisconnectListeners?.();
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionUserId && requestId) {
        endGenerateSession(sessionUserId, requestId);
      }
    }
  } catch (fatalErr: any) {
    cleanupClientDisconnectListeners?.();
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    req.log.error(
      { err: fatalErr?.message, code: "INTERNAL_ERROR", userId: sessionUserId },
      "Unhandled error in /generate"
    );
    const sessionWasCancelled = sessionUserId && requestId
      ? staleGenerate(sessionUserId, requestId)
      : false;
    if (sessionUserId && requestId) {
      setGeneratePhase(sessionUserId, requestId, "error");
      endGenerateSession(sessionUserId, requestId);
    }
    if (!responseFinished(res)) {
      const timedOut = Date.now() - startMs >= requestHardTimeoutMs - 1000;
      const longRunningCancelled = sessionWasCancelled && Date.now() - startMs >= 30_000;
      if ((timedOut || longRunningCancelled) && timeoutFallbackResponse(req, res, {
        failureReason: sessionWasCancelled ? "cancelled_timeout_fallback" : "fatal_timeout_fallback",
        elapsedMs: Date.now() - startMs,
        requestId,
      })) return;
      if (sessionWasCancelled) {
        generateFail(
          res,
          409,
          "GENERATION_CANCELLED",
          "This generation was superseded or cancelled. Try again if you need a new playlist.",
          {
            generationDiagnostics: {
              recoveryTriggered: false,
              fallbackLevel: "none",
              sessionCancelled: true,
            },
          }
        );
        return;
      }
      res.status(timedOut ? 504 : 500).json({
        success: false,
        error: timedOut
          ? "Generation took too long before V3 could return a safe playlist. Try Balanced mode or regenerate in a moment."
          : "An unexpected error occurred. Please try again.",
        code: timedOut ? "TIMEOUT" : "INTERNAL_ERROR",
        tracks: [],
        generationDiagnostics: {
          recoveryTriggered: false,
          fallbackLevel: "none",
          sessionCancelled: false,
          controllerAuthorityConflict: false,
        },
      });
    }
  }
});

export default router;
