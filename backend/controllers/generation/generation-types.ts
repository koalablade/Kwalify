/** Shared generation controller types and constants. */
import type { EmotionProfile } from "../../lib/emotion";
import type { V3MetadataTrack } from "../../lib/v3-track-contract";

export const EXECUTION_HEALTH_BASELINE_SIZE = 50;
export const STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO = 0.85;
export const STRICT_EXPLICIT_ERA_EVIDENCE_RATIO = 0.85;

export type ExecutionHealthState = "HEALTHY" | "DEGRADED" | "BROKEN";
export type ExecutionHealthCause =
  | "DUPLICATE_RETRIEVAL"
  | "DUPLICATE_SCORING"
  | "CACHE_BYPASS_FAILURE"
  | "MULTI_HYDRATION"
  | "V3_REENTRY"
  | "CONTROLLER_PIPELINE_CONFLICT"
  | "UNEXPECTED_FALLBACK_PATH";

export type ExecutionHealthProfile = {
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

export type ExecutionHealthBaselineEntry = Pick<
  ExecutionHealthProfile,
  "hydrationCount" | "retrievalPassCount" | "scoringPassCount"
> & {
  latencyCategory: "FAST" | "NORMAL" | "SLOW";
};


import type { SessionSnapshot } from "../../core/cache/session-snapshot-cache";
import type { FeedbackMemory } from "../../lib/feedback-memory";
import type { LikedSong, PlaylistHistory } from "../../db/schema/kwalah";

export type GenerateSessionSnapshot = SessionSnapshot<
  LikedSong,
  PlaylistHistory,
  FeedbackMemory
>;

export type GenerationSideEffectPolicy = {
  mode: "production" | "audit";
  allowSpotifyPlaylistCreate: boolean;
  allowSavedPlaylistWrites: boolean;
  allowHistoryWrites: boolean;
  allowFeedbackWrites: boolean;
  allowAnalyticsWrites: boolean;
  allowResultCacheWrites: boolean;
  bypassRateLimit: boolean;
};

export const PRODUCTION_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "production",
  allowSpotifyPlaylistCreate: true,
  allowSavedPlaylistWrites: true,
  allowHistoryWrites: true,
  allowFeedbackWrites: true,
  allowAnalyticsWrites: true,
  allowResultCacheWrites: true,
  bypassRateLimit: false,
};

export const AUDIT_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "audit",
  allowSpotifyPlaylistCreate: false,
  allowSavedPlaylistWrites: false,
  allowHistoryWrites: false,
  allowFeedbackWrites: false,
  allowAnalyticsWrites: false,
  allowResultCacheWrites: false,
  bypassRateLimit: true,
};

export const NEUTRAL_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

export type PreV3TimingBreakdown = {
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

export type PreV3StageName =
  | "dbSessionLoad"
  | "userHistoryFetch"
  | "genreProfileBuild"
  | "librarySignalLoad"
  | "embeddingPrep"
  | "promptNormalization";

export type DbSessionLoadStageName =
  | "userProfileQuery"
  | "userPreferencesQuery"
  | "playlistHistoryQuery"
  | "recentTracksQuery"
  | "implicitFeedbackQuery";

export type PreV3StageRecord = {
  stage: string;
  durationMs: number;
  inputSize: number;
  outputSize: number;
  cacheHit: boolean;
};

export type DbSessionLoadStageRecord = PreV3StageRecord & {
  rowsReturned: number;
};

export type PreV3PerformanceReport = {
  totalPreV3Time: number;
  stageBreakdown: PreV3StageRecord[];
  dbSessionLoadStages: DbSessionLoadStageRecord[];
  bottleneckStage: string | null;
};

export type ProductionTimelineStage =
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

export type ProductionTimeline = {
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

export type QualitySignalContext = {
  primary: string;
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
  canonicalHints: string[];
};

export type ConstraintLayer = {
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

export type LockedIntent = {
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

export type ConstraintTrack = V3MetadataTrack<{
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
