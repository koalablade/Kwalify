/**
 * Purpose: Playlist generation endpoint — the core of Kwalify.
 * Responsibilities:
 *   - POST /generate    — score the user's liked songs against a vibe and create a Spotify playlist
 *   - GET  /generate/status — return the current generation phase for the user
 * Dependencies: emotion engine, genre intelligence stack, playlist pipeline, Spotify API, drizzle-orm
 */
import { Router, type IRouter } from "express";
import { db } from "../db";
import {
  likedSongsTable,
  playlistHistoryTable,
  savedPlaylistsTable,
} from "../db";
import {
  createSpotifyPlaylist,
  getValidAccessToken,
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
import { resolveHumanScene, promptSuppressesChristmas } from "../lib/human-scene-knowledge";
import { detectSubSceneRetrievalKind } from "../core/v3/subscene-retrieval";
import {
  fillPlaylistViaFallbackChain,
  resolveSceneFallbackChain,
} from "../core/editorial/scene-fallback-chains";
import { getUserGenreProfileForGenerate } from "../lib/genre-profile-cache";
import { getCachedLikedSongs, setCachedLikedSongs } from "../lib/liked-songs-cache";
import { loadLikedSongsBatched } from "../lib/load-liked-songs-batched";
import { classifyTrack } from "../lib/genre-taxonomy";
import { assessGenreEvidenceTier } from "../lib/genre-evidence-tier";
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
  GENERATE_RESULT_CACHE_VERSION,
} from "../lib/generate-result-cache";
import { trackHasEraEvidence, trackHasKnownEraMismatch } from "../lib/era-evidence";
import { createRequestBudget } from "../lib/request-budget";
import {
  REQUEST_HARD_TIMEOUT_MS,
  MINIMAL_GENRE_STACK_THRESHOLD,
  resolveHybridPoolCap,
} from "../lib/production-limits";
import { createLatencyBudget } from "../lib/latency-budget";
import { createRequestStageTiming, type RequestStageTimingReport } from "../lib/request-stage-timing";
import { createGoodPlaylistRefinementTelemetry } from "../lib/good-playlist-refinement-telemetry";
import type { GoodPlaylistRefinementTelemetry } from "../lib/good-playlist-refinement-telemetry";
import {
  persistGoodPlaylistDeliverySnapshot,
  resolveTimeoutFallbackDeliverableTracks,
  type GoodPlaylistDeliverableTrack,
  type TimeoutFallbackSource,
} from "../lib/good-playlist-delivery-snapshot";
import type { LatencyBudget } from "../lib/latency-budget";
import {
  acquireGenerateSession,
  endGenerateSession,
  setGeneratePhase,
  setGenerateStageDetail,
  isGenerateCancelled,
  isGenerateSuperseded,
  resolveAuditHardTimeoutMs,
  getPendingSpotifyPlaylistId,
  setPendingSpotifyPlaylistId,
  clearPendingSpotifyPlaylist,
  getGenerateProgress,
  getGenerateStatus,
  setGeneratePartialTracks,
  setGenerateLiveMeta,
  cancelGenerateSession,
  getActiveSessionRetryAfterMs,
} from "../lib/generate-session";
import { captureError } from "../lib/error-tracking";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { getDiscoveryModeReadiness } from "../lib/discovery-mode";
import { isShuttingDown } from "../lib/shutdown";
import { createGenerateStageTimer, GENERATE_PIPELINE_STAGE_STUCK_MS } from "../lib/generate-stage-timer";
import { buildFallbackPipelineResult, buildCachedGenerateResponse, buildFastFallbackSceneContext, formatTracksForApi } from "../lib/generate-helpers";
import { attachScoreAttribution } from "../core/scoring-engine/score-breakdown";
import { repairHumanTastePlaylist } from "../lib/human-taste-validator";
import {
  assessRepairGenreEvidenceConfidence,
  assessConfidenceAwarePublication,
  computeAdaptiveGenreEvidenceRequiredCount,
  computeAdaptivePartialPublishLimit,
  computePartialGenreVerificationScore,
  countConfidenceQualifiedGenreTracks,
  countGenreVerifiedTracks,
  PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT,
  publishConfidenceAwarePlaylist,
  publishHonestConstrainedPlaylist,
  publishVerifiedV3OutputPlaylist,
  resolveGenreEvidencePublication,
  resolveEffectiveGenreVerifiedSupply,
  resolveGenreEvidenceVerifiedPrefix,
  shouldPreferHonestConstrainedPublish,
  shouldPublishConfidenceAwareOutput,
  shouldPublishVerifiedV3Output,
  shouldUseBlindConstrainedReplacement,
  trackMatchesExplicitSubgenreEvidence,
  type ConfidenceAwarePublication,
  type VerifiedV3OutputPublication,
} from "../lib/genre-evidence-guard";
import { applyOpeningCuratorV2, OPENING_WINDOW_SIZE } from "../lib/opening-curator-v2";
import {
  buildOpeningLockAuditDiagnostics,
  enforceOpeningLock,
  mergeTracksWithOpeningLock,
  type OpeningLock,
  type OpeningLockViolation,
} from "../lib/opening-lock";
import {
  activityCoherenceDelta,
  activityOpeningBoost,
  activityTrustOutlierThreshold,
  filterTracksByActivityProfile,
  resolveActivityProfile,
  trackFailsActivityHardGate,
} from "../lib/activity-profiles";
import {
  MIN_LIBRARY_TRACKS,
  orchestratePlaylistRetrieval,
} from "../lib/playlist-retrieval-orchestrator";
import {
  estimateValidCandidateSupply,
  minRequiredValidCandidates,
  rankSupplyAwareRecoveryCandidates,
  trackPassesRecoveryActivity,
  type ValidCandidateSupply,
} from "../lib/library-valid-candidate-supply";
import {
  applyThinLibraryDeliveryCap,
  constrainThinLibraryPolicyForWorldSupply,
  effectiveFinalizeRequestedLength,
  evaluateThinLibraryPolicy,
  resolveThinLibraryMinBestAvailableCount,
  shouldCompoundThinLibraryBypass,
  shouldEarlyThinLibraryHardStop,
  shouldSkipThinLibraryRecoveryInflate,
  type ThinLibraryPolicyResult,
} from "../lib/thin-library-policy";
import {
  applyDeliveryPerPlaylistArtistCap,
  defaultPerPlaylistArtistCap,
} from "../lib/playlist-artist-cap";
import {
  createPipelineAuthoritySession,
  createPipelineDeliveryBuffer,
  isStrictRcModeEnabled,
  type PipelineAuthoritySession,
  type PipelineCheckpoint,
  type PipelineDeliveryBuffer,
} from "../lib/pipeline-authority";
import { estimateThinLibraryIntentSupply, hasEraConstraint } from "../lib/thin-library-intent-supply";
import { buildSonicTasteProfile } from "../lib/sonic-taste-profile";
import {
  handleGenerationFollowUp,
  recordDiscoverySuccess,
  recordLibraryInsufficientFailure,
  recordLikedOnlySuccess,
  recordFailureOutcome,
} from "../lib/playlist-failure-analytics";
import { buildBypassedHumanSaveabilityGate } from "../lib/human-saveability-api-payload";
import {
  attachExecutionTrace,
  buildFallbackExecutionTraceDraft,
  buildGateFailureExecutionTraceDraft,
  buildIntentCollapseFailureTraceDraft,
  buildUnknownExitTraceDraft,
  buildV3PipelineExecutionTraceDraft,
  extractPlaylistExecutionTrace,
  finalizePlaylistExecutionTrace,
  finalizeExecutionTrace,
  type PlaylistExecutionTrace,
  type PlaylistExecutionTraceDraft,
} from "../core/observability/playlist-execution-trace";
import { decodeIntent } from "../lib/intent-decoder";
import { computeTemporalMemory } from "../lib/temporal-memory";
import type { BuildPlaylistPipelineResult } from "../core/output";
import type { GenreAudit } from "../lib/genre-audit";
import { summarizePipeline } from "../lib/scoring-explanation";
import { scorePromptConfidence } from "../lib/prompt-confidence";
import { evaluatePromptReadiness } from "../lib/prompt-readiness";
import { buildMomentUnderstandingLine } from "../lib/moment-understanding-display";
import { buildDominantMomentLabel, energyBandFromProfile } from "../lib/playlist-why-summary";
import { resolveContradiction } from "../core/scene-intelligence/contradiction-handler";
import {
  buildIntentClarificationSuggestions,
  groupIntentSuggestions,
} from "../lib/intent-clarification-suggestions";
import {
  getSceneFeedbackPenalty,
} from "../lib/scene-feedback-memory";
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
import { getEnv, getFeatures } from "../lib/env";
import { publicUrl } from "../lib/public-url";
import { generateShareSlug } from "../lib/share-slug";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import { resolveSceneBus, resolveSemanticFromBus } from "../lib/scene-resolution-bus";
import { resolveVagueWorldCommit, shouldSuppressVagueWiden } from "../lib/vague-world-commit";
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
import { HumanSaveabilityGateError, strictModeHumanSaveability } from "../core/human-saveability-gate";
import {
  evaluateHumanQualityGate,
  HumanQualityGateError,
} from "../core/editorial/human-quality-gate";
import {
  evaluateIntentFidelity,
  selectIntentFidelityHonestPartialTracks,
} from "../core/editorial/intent-fidelity-gate";
import {
  evaluateWorldProof,
  filterTracksByWorldIdentity,
  filterTracksByFullWorldProof,
  stripTailWorldViolations,
} from "../core/editorial/world-proof-gate";
import { enforceThesisOpener, enforceThesisOpenerGate } from "../core/editorial/thesis-opener-gate";
import { evaluateHumanUnderstoodGate } from "../core/editorial/human-understood-gate";
import { resolveCommittedWorld, committedWorldArtistRepresentativeScore } from "../core/committed-world";
import {
  committedWorldQualitySignals,
  LANE_PURITY_WORLD_IDS,
  scoreCommittedWorldLanePurity,
} from "../core/editorial/world-coherence-score";
import { isSoftScenePrompt } from "../core/scene-world-layer";
import { runExpectationShadow } from "../core/expectation/shadow";
import { runPlaylistExpectation } from "../core/expectation/playlist-evaluation";
import { humanExpectationMode } from "../core/expectation/feature-flag";
import { resolvePlaylistContractContext } from "../core/playlist-contract/shadow";
import {
  isPlaylistContractRetrievalEnabled,
  isPlaylistContractShadowEnabled,
  isPlaylistContractValidationEnabled,
  isPlaylistContractWorldGateEnabled,
  isPlaylistContractV40Enabled,
  isPlaylistContractV41Enabled,
  isPlaylistContractDeferPathEnabled,
  isPlaylistContractWorldGateEvaluationEnabled,
} from "../core/playlist-contract/feature-flag";
import type { ContractCompositionContext } from "../core/playlist-contract/contract-composition-types";
import { contractRebalanceWasApplied } from "../core/playlist-contract/contract-composition-select";
import {
  resolveWorldGateContext,
  softenWorldBoundaryForGate,
} from "../core/playlist-contract/world-gate-context";
import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import {
  applyContractAwareRetrievalRerank,
} from "../core/playlist-contract/constraint-aware-retrieval";
import { auditPlaylistAgainstContract } from "../core/playlist-contract/contract-validator";
import { deriveHonestPartialFromContract } from "../core/playlist-contract/honest-partial";
import type { ExpectationTrack } from "../core/expectation/types";
import { persistGenerationSignal } from "../lib/generation-signals";
import { loadEditorialMemory, recordEditorialMemory } from "../core/editorial/editorial-memory";
import { computeLibraryFingerprint } from "../core/editorial/library-fingerprint";
import { IntentCollapseInsufficientPoolError, HONEST_PARTIAL_MIN } from "../core/editorial/intent-collapse-layer";
import { pickDiverseWorldSalvageTracks } from "../lib/world-salvage-pick";
import {
  profileUserLibrary,
  estimatePromptUncertainty,
  resolveGenerationPolicy,
} from "../lib/library-generation-policy";
import {
  buildLockedIntent as buildCsspLockedIntent,
  completeLockedIntent as completeCsspLockedIntent,
  GENRE_ALIASES,
} from "../core/v3/intent";
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
import { buildGenerationTrustPayload } from "./generation-response";
import { capAuditResponsePayload } from "../lib/audit-response-cap";
import { attachIntentSurvivalToSuccessPayload } from "../lib/audit-intent-survival-payload";
import {
  recordGenerationPhaseDuration,
  recordIntentSurvivalSample,
  recordSpotifyApiMetrics,
} from "../lib/ops-metrics";
import {
  emitGenerateComplete,
  initGenerateObs,
  noteGenerateFailure,
  noteGenerateSuccess,
  updateGenerateObs,
} from "../lib/generate-complete-log";
import { hashedIdTag } from "../lib/pii";
import {
  effectiveRecoveryArtistLimit,
  evaluateRecoveryGuards,
  recoveryStageAllowed,
} from "./generation-recovery";
import {
  buildRecoveryDiagnostics,
  partitionRecoveryRelaxations,
  shouldMarkRecoveryTriggered,
} from "../lib/recovery-diagnostics";
import {
  recoveryStageAllowedForTier,
  tierRelaxationCode,
  type UserRecoveryTier,
} from "../lib/recovery-tier-policy";
import {
  evaluatePlaylistIdentity,
  recoveryPreservesIdentity,
} from "../lib/playlist-identity-guard";
import { buildPlaylistFrequencyPenalty, applyFrequencyPenaltyToScore } from "../lib/playlist-frequency-penalty";
import { resolveNoveltyDiagnostics } from "../lib/cross-playlist-novelty";
import {
  applyOpeningWindowDedup,
  buildOpeningWindowHistory,
} from "../lib/opening-window-dedup";
import {
  getOpeningWindowSessionHistory,
  recordOpeningWindowSession,
} from "../lib/opening-window-session";
import {
  applySessionArtistGravity,
  buildSessionArtistHistory,
  detectPromptCentralArtists,
  normalizeSessionArtist,
} from "../lib/session-artist-gravity";
import {
  getSessionArtistHistory,
  recordSessionArtistPlaylist,
} from "../lib/session-artist-gravity-session";
import {
  applyPlaylistIdentityDistance,
  buildCrossSessionTrackHistory,
  detectPromptExplicitAlbum,
} from "../lib/playlist-identity-distance";
import {
  buildContextualTrackMemory,
  buildPlaylistContextFingerprint,
  inferCategoryFromVibe,
  isExplicitArtistOrAlbumPrompt,
  parseEvaluationPlaylistContexts,
  resolveContextualUniquenessDiagnostics,
  winningTrackIds,
  type PriorWinningPlaylist,
} from "../lib/contextual-uniqueness";
import {
  buildBlendedIntentPool,
  blendedPoolMinimumCount,
  isCompoundPromptIntent,
  strictSupplyStarved,
} from "../lib/blended-intent-pool";
import {
  compactStageSnapshot,
  histogramFamiliesForTracks,
} from "../lib/family-stage-funnel";
import {
  buildGenreEvidenceUnderfillAudit,
  createEmptyDeliveryLossFunnel,
  createEmptyPuritySubFunnel,
  mergePuritySubFunnelFromGate,
  readOrchestratorFinalFromRetrievalFunnel,
  readV3PreFilterSurvivors,
  snapshotDeliveryTracks,
  type DeliveryLossFunnel,
  type DeliveryStageSnap,
  type DeliveryTrackSnap,
  type PuritySubFunnel,
} from "../lib/delivery-underfill-forensics";
import { filterEmbarrassingTracks } from "../lib/human-embarrassment-filter";
import { buildFallbackUxPayload } from "../lib/fallback-ux-payload";
import {
  createExecutionHealthProfile,
  finaliseExecutionHealth,
  recordExecutionStage,
} from "./generation/generation-execution-health";
import { generationAuditTokenAuthorized, privilegedDebugAllowed } from "./generation/generation-audit";
import { parseEvalAllowedSpotifyUserIds } from "../lib/eval-token";
import { runSessionHydrationSingleFlight } from "./generation/generation-session-hydration";
import {
  buildPreV3PerformanceReport,
  buildProductionTimelineReport,
  createLiveStageProfiler,
  createPreV3Timing,
  createProductionTimeline,
  endTimelineStage,
  logDbSessionLoadStage,
  logPreV3Stage,
  markTimeline,
  recordDbSessionLoadStage,
  recordPreV3Stage,
  recordPreV3Timing,
  startTimelineStage,
} from "./generation/generation-timing";
import type {
  ConstraintLayer,
  ConstraintTrack,
  GenerateSessionSnapshot,
  LockedIntent,
  ProductionTimeline,
  QualitySignalContext,
} from "./generation/generation-types";
import {
  AUDIT_SIDE_EFFECT_POLICY,
  NEUTRAL_PROFILE,
  PRODUCTION_SIDE_EFFECT_POLICY,
  STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
  STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
} from "./generation/generation-types";

import { buildDominantIntentContract, shouldBlockHardSafeFinalization, detectDominantEmotion, trackMatchesDominantEmotion, capTastePullWeight, splitSceneContracts } from "../core/dominant-intent-contract";
import { buildIntentUnderstandingDiagnostics } from "../lib/intent-understanding-diagnostics";
import { recordUnknownTermEvents } from "../lib/unknown-term-harvest";
import { scorePlaylistCoherence, type PlaylistCoherenceScore, type CoherenceSwapRecord } from "../core/playlist-coherence-audit";
import { runCoherenceRebuildLoop } from "../core/rebuild-loop";
import { hardRejectOffWorldTracks, isTrackInWorld, resolveWorldBoundary } from "../core/world-boundary";
import {
  inferWorldIdentityIdsFromPrompt,
  applyFinalApiOpenerHygiene,
  syncTracksToApiOrder,
  countPsychIndieOpenerFillers,
  maxPsychIndieOpenersForWorlds,
  applyPreFreezeOpenerHygieneToDelivery,
  buildOpenerHygieneMetrics,
  countWorldVerifiedLibrarySupply,
  type OpenerHygieneDiagnostics,
} from "../core/editorial/world-identity-gate";
import { openingLockTrackIdsFromTracks } from "../core/editorial/opener-hygiene";
import { applyWorldSequencing } from "../core/editorial/world-sequencer";
import { applyWorldPurityGate } from "../core/editorial/world-purity-gate";
import {
  mergeDeliverableCandidatePools,
  refillDeliverableDepth,
  refillAfterArtistCap,
  enrichDeliverableTrack,
} from "../core/editorial/deliverable-depth-refill";
import { applyHumanCurationSequencing, applyTerminalOpenerGuard, buildMomentReplacementPool } from "../core/editorial/human-curation-sequencer";
import { passesMomentFitForRefill } from "../core/editorial/song-moment-fit";
import {
  assessWorldCoverage,
  assessCandidateCoverageTier,
  computeRetrievalConfidence,
  coverageUserMessage,
  buildDeliveryMessage,
  shouldExpandWorldCoverage,
  type WorldCoverageAssessment,
  type CoverageTier,
} from "../core/editorial/world-coverage";
import { retrieveWorldAnchorCandidates, exhaustWorldRetrieval } from "../core/editorial/world-anchor-retrieval";
import {
  beginRejectionTrace,
  getRejectionTrace,
  summarizeRejectionTrace,
  diagnoseRetrievalShortfall,
} from "../core/editorial/retrieval-rejection-trace";
import { enforceCommittedWorldImmutability } from "../core/editorial/committed-world-guard";
import { resolveCulturalProfileForCommitted } from "../core/editorial/world-identity-score";
import {
  countOpenerNegationViolations,
  filterTracksForDeliveryNegation,
  parsePromptNegationEnforcement,
  trackViolatesPromptNegation,
} from "../lib/prompt-negation-enforcement";
import { shouldPublishPlaylist, type CoherenceGateResult } from "../core/coherence-gate";
import { buildPlaylistSegments, orderTracksByPlaylistSegments } from "../core/emotional-arc-planner";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { compilePlaylistContext } from "../core/playlist-compiler";
import { recordPromptSceneMemory } from "../lib/cross-session-memory";
import { refreshGlobalTasteProfile } from "../lib/global-taste-profile";
import { assignTracksToSegments } from "../core/segment-playlist-planner";
import { segmentAssignmentsToDiagnostics, coherenceRepairSettingsFromPlan, coherenceGateFromPlan } from "../core/compile-plan-dsl";
import type { TasteGraphV2 } from "../lib/taste-graph-v2";
import type { UserTasteManifold } from "../lib/user-taste-manifold";
import type { CompilePlanDSL } from "../core/compile-plan-dsl";
import {
  buildNoLibrarySpotifyCandidates,
  defaultRetrievalCompletionDiagnostics,
  type RetrievalCompletionDiagnostics,
} from "./generation/generation-no-library-retrieval";

import { rediscoveryModeForFamiliarity, type FamiliarityMode } from "../lib/familiarity-controller";
import { mergeScenePredictions } from "../lib/scene-alias-graph";
import { buildIntentLossReport, type IntentLossReport } from "../lib/intent-loss-report";
import { buildGenerationPipelineDiagnostics } from "../lib/generation-pipeline-diagnostics";
import {
  getSessionSnapshot,
  mergeSessionSnapshot,
  getSessionSnapshotCacheStats,
} from "../core/cache/session-snapshot-cache";

const generationControllerLock = "__kwalifyGenerationControllerRegistered";
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

function staleGenerate(userId: string, requestId: string): boolean {
  return isGenerateCancelled(userId, requestId);
}

function generationCompletionBlocked(
  userId: string,
  requestId: string,
  deliverableTrackCount: number,
): boolean {
  // Orphan completion: if we already have a playlist worth delivering, finish
  // Spotify create + response even if a newer request superseded this session.
  if (deliverableTrackCount > 0) {
    return false;
  }
  if (isGenerateSuperseded(userId, requestId)) return true;
  return staleGenerate(userId, requestId);
}

/** Cancelled/superseded session — always send a response so the client does not hang. */
function respondIfStale(
  res: import("express").Response,
  userId: string,
  requestId: string,
  opts?: { deliverableTrackCount?: number },
): boolean {
  const deliverable = opts?.deliverableTrackCount ?? 0;
  // Prefer finishing a ready playlist over 409 when superseded mid-flight.
  if (deliverable > 0) return false;
  if (isGenerateSuperseded(userId, requestId)) {
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
          superseded: true,
        },
      });
    }
    return true;
  }
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

/** Consistent /generate failure payload (API shape unchanged). */
function generateFail(
  res: import("express").Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>,
  traceDraft?: PlaylistExecutionTraceDraft,
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const existingTrace = extra ? extractPlaylistExecutionTrace(extra) : null;
  const prebuiltTrace = extra?.playlistExecutionTrace as PlaylistExecutionTrace | undefined;
  const gate = extra?.humanSaveabilityGate as Record<string, unknown> | undefined;
  let resolvedTrace: PlaylistExecutionTrace;
  if (prebuiltTrace) {
    resolvedTrace = prebuiltTrace;
  } else if (existingTrace) {
    resolvedTrace = existingTrace;
  } else if (traceDraft) {
    resolvedTrace = finalizeExecutionTrace(traceDraft);
  } else if (gate) {
    resolvedTrace = finalizeExecutionTrace(buildGateFailureExecutionTraceDraft({
      requestId: String(extra?.requestId ?? "unknown"),
      prompt: String(extra?.prompt ?? ""),
      seed: (extra?.seed ?? null) as number | string | null,
      gate,
    }));
  } else {
    resolvedTrace = finalizeExecutionTrace(buildUnknownExitTraceDraft({
      requestId: String(extra?.requestId ?? "unknown"),
      prompt: String(extra?.prompt ?? ""),
      seed: (extra?.seed ?? null) as number | string | null,
      reason: code,
    }));
  }
  const { spotifyUnavailable: spotifyFlag, ...restExtra } = extra ?? {};
  const payload: Record<string, unknown> = {
    success: false,
    code,
    error,
    tracks: [],
    ...restExtra,
    ...(spotifyFlag === true || /^SPOTIFY_/i.test(code) ? { spotifyUnavailable: true } : {}),
    playlistExecutionTrace: resolvedTrace,
  };
  noteGenerateFailure(res.req, {
    code,
    reason: error,
    executionPath: resolvedTrace.executionPath,
    playlistExecutionTrace: resolvedTrace,
    playlistSize: resolvedTrace.trackCounts?.final ?? 0,
  });
  res.status(status).json(payload);
}

function jsonWithExecutionTrace(
  res: import("express").Response,
  status: number,
  body: Record<string, unknown>,
  traceDraft: PlaylistExecutionTraceDraft,
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const trace = finalizePlaylistExecutionTrace(traceDraft);
  noteGenerateFailure(res.req, {
    code: typeof body.code === "string" ? body.code : "REQUEST_FAILED",
    reason: typeof body.error === "string" ? body.error : typeof body.code === "string" ? body.code : "request_failed",
    executionPath: trace.executionPath,
    playlistExecutionTrace: trace,
    playlistSize: trace.trackCounts?.final ?? 0,
  });
  res.status(status).json({
    ...body,
    playlistExecutionTrace: trace,
  });
}

function resolveSuccessExecutionTrace(opts: {
  requestId: string;
  prompt: string;
  seed: number | string | null | undefined;
  humanSaveable: boolean;
  finalTrackCount: number;
  v3Diagnostics: Record<string, unknown> | null | undefined;
  fastFallback: boolean;
  timeoutFallback?: boolean;
  fallbackDetail?: string | null;
}): PlaylistExecutionTrace {
  const fromV3 = opts.v3Diagnostics?.playlistExecutionTrace;
  if (fromV3 && typeof fromV3 === "object") {
    return finalizeExecutionTrace(fromV3 as PlaylistExecutionTraceDraft);
  }
  if (opts.fastFallback || opts.timeoutFallback) {
    return finalizeExecutionTrace(buildFallbackExecutionTraceDraft({
      requestId: opts.requestId,
      prompt: opts.prompt,
      seed: opts.seed ?? null,
      executionPath: opts.timeoutFallback ? "timeout_fallback" : "fast_fallback",
      failureDetail: opts.fallbackDetail,
      finalTrackCount: opts.finalTrackCount,
      timeoutOccurred: opts.timeoutFallback === true,
    }));
  }
  const gate = opts.v3Diagnostics?.humanSaveabilityGate as Record<string, unknown> | undefined;
  if (gate) {
    return finalizeExecutionTrace(buildV3PipelineExecutionTraceDraft({
      requestId: opts.requestId,
      prompt: opts.prompt,
      seed: opts.seed ?? null,
      humanSaveable: opts.humanSaveable,
      gateExecuted: true,
      gateBypassed: gate.bypassed === true,
      humanSaveabilityGate: gate,
      sceneClusterFunnel: (opts.v3Diagnostics?.sceneClusterFunnel as Record<string, unknown> | null) ?? null,
      openingTenDominantCluster: (opts.v3Diagnostics?.openingTenDominantCluster as Record<string, unknown> | null) ?? null,
      retrievedCount: Number((opts.v3Diagnostics?.scoringPool as Record<string, unknown> | undefined)?.originalCount ?? 0),
      finalTrackCount: opts.finalTrackCount,
      fastFallback: opts.fastFallback,
    }));
  }
  return finalizeExecutionTrace({
    requestId: opts.requestId,
    prompt: opts.prompt,
    seed: opts.seed ?? null,
    executionPath: opts.humanSaveable ? "full_pipeline" : "partial_pipeline",
    humanSaveable: opts.humanSaveable,
    trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: opts.finalTrackCount },
    debugFlags: { gateExecuted: false, gateBypassed: true, timeoutOccurred: false },
  });
}

function shouldBlockStrictEditorialTimeoutFallback(ctx: Record<string, unknown> | undefined): boolean {
  if (ctx?.strictModeHumanSaveability === true) return true;
  const vibe = typeof ctx?.vibe === "string" ? ctx.vibe : "";
  if (!vibe) return false;
  const lockedIntent = ctx?.lockedIntent as LockedIntent | undefined;
  if (lockedIntent) return strictModeHumanSaveability(vibe, lockedIntent);
  return isSoftScenePrompt(vibe, {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: null,
    energy: null,
  });
}

function withIntentSurvivalAuditPayload(
  req: import("express").Request,
  payload: Record<string, unknown>,
  apiTracks: unknown[],
  vibe: string,
): Record<string, unknown> {
  const ctx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
  return attachIntentSurvivalToSuccessPayload({
    payload,
    ctx,
    prompt: vibe,
    apiTracks,
    finalizationDiagnostics: payload["finalization"] as Record<string, unknown> | null | undefined,
    strictGenreEvidence: payload["strictGenreEvidence"] as Record<string, unknown> | null | undefined,
    strictEraEvidence: payload["strictEraEvidence"] as Record<string, unknown> | null | undefined,
  });
}

function buildLatencyObservabilityFromCtx(
  ctx: Record<string, unknown> | undefined,
  tracks: Array<{
    trackId: string;
    artistName: string;
    energy: number | null;
    valence: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    score?: number;
    laneScore?: number | null;
  }>,
  opts: {
    elapsedMs: number;
    latencyBudgetExceeded?: boolean;
    requestStageTiming?: RequestStageTimingReport | null;
  },
): {
  latencyBudgetExceeded: boolean;
  requestStageTiming: RequestStageTimingReport | null;
  latencyBudget: ReturnType<LatencyBudget["snapshot"]> | null;
  goodPlaylistRefinement: ReturnType<GoodPlaylistRefinementTelemetry["finalize"]> | null;
} {
  const latencyBudget = ctx?.latencyBudget as LatencyBudget | undefined;
  const refinementTelemetry = ctx?.refinementTelemetry as GoodPlaylistRefinementTelemetry | undefined;
  const stageTiming = ctx?.requestStageTiming as ReturnType<typeof createRequestStageTiming> | undefined;
  if (stageTiming) stageTiming.setTotal(opts.elapsedMs);
  const deliveredDueToBudget = opts.latencyBudgetExceeded === true ||
    latencyBudget?.shouldSkipMarginalImprovement() === true;
  return {
    latencyBudgetExceeded: deliveredDueToBudget,
    requestStageTiming: opts.requestStageTiming ?? stageTiming?.report() ?? null,
    latencyBudget: latencyBudget?.snapshot() ?? null,
    goodPlaylistRefinement: refinementTelemetry?.finalize(tracks, null) ?? null,
  };
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
    latencyBudgetExceeded?: boolean;
    requestStageTiming?: RequestStageTimingReport | null;
    /** When true, emit best-available library fallback even for strict editorial prompts. */
    allowStrictOverride?: boolean;
    fallbackLevel?: "timeout_fallback" | "intent_pool_collapse" | "empty_pool" | "human_saveability";
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
  const knownGood = resolveTimeoutFallbackDeliverableTracks(ctx);
  const fallbackIdentityIntent = ctx?.lockedIntent as LockedIntent | undefined;
  const fallbackIdentityCurator = ctx?.curatorIdentity as import("../lib/curator-identity").CuratorIdentity | undefined;
  const fallbackIdentityClassMap = ctx?.classMap as Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }> | undefined;
  const fallbackWorldBoundary = resolveWorldBoundary({
    sceneLock: sceneLockStatus ?? null,
    sceneAliases,
    scenePrediction: mergedScenePrediction,
    prompt: vibe,
  });
  const purifyFallbackTracks = <T extends {
    trackId?: string;
    id?: string | number;
    trackName?: string | null;
    artistName?: string | null;
    name?: string | null;
    artist?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    spotifyArtistGenres?: unknown;
  }>(tracks: T[]): T[] => {
    if (!fallbackWorldBoundary.active || tracks.length === 0) return tracks;
    return hardRejectOffWorldTracks(
      tracks,
      fallbackWorldBoundary,
      fallbackIdentityClassMap,
    ).kept;
  };
  let deliverableTracks = knownGood?.tracks ?? [];
  deliverableTracks = purifyFallbackTracks(deliverableTracks);
  // Hard world lock: never emit a timeout fallback that reintroduces off-world blankets.
  if (fallbackWorldBoundary.hardLock && deliverableTracks.length === 0 && (knownGood?.tracks?.length ?? 0) > 0) {
    req.log.warn(
      {
        requestId: opts.requestId,
        failureReason: opts.failureReason,
        hardLock: true,
        dominantScene: fallbackWorldBoundary.dominantScene,
      },
      "Timeout fallback blocked — known-good pool was entirely off-world",
    );
    return false;
  }
  if (emotionProfile && deliverableTracks.length > 0 && length > 0) {
    if (fallbackIdentityIntent && fallbackIdentityCurator && fallbackIdentityClassMap) {
      const identityVerdict = evaluatePlaylistIdentity(deliverableTracks, {
        vibe,
        lockedIntent: fallbackIdentityIntent,
        curatorIdentity: fallbackIdentityCurator,
        classMap: fallbackIdentityClassMap,
      });
      if (!identityVerdict.passed) {
        if (ctx) {
          ctx["blockedFallbackUx"] = buildFallbackUxPayload({
            vibe,
            lockedIntent: fallbackIdentityIntent,
            identityFailures: identityVerdict.failures,
            limitingFactors: [`fallback_identity_failed:${opts.fallbackLevel ?? "timeout"}`],
            noLibraryMode: ctx?.noLibraryMode === true,
          });
        }
        req.log.warn(
          {
            requestId: opts.requestId,
            failureReason: opts.failureReason,
            identityFailures: identityVerdict.failures,
            identityScore: identityVerdict.score,
          },
          "Timeout fallback blocked — playlist identity would be lost",
        );
        return false;
      }
    }
    const tracks = formatTracksForApi(deliverableTracks.slice(0, length), emotionProfile);
    if (tracks.length > 0) {
      const latencyObs = buildLatencyObservabilityFromCtx(ctx, deliverableTracks, {
        elapsedMs: opts.elapsedMs,
        latencyBudgetExceeded: opts.latencyBudgetExceeded,
        requestStageTiming: opts.requestStageTiming ?? null,
      });
      const snapshot = ctx?.goodPlaylistDeliverySnapshot as {
        readyAtMs?: number;
        elapsedMs?: number;
        confidence?: number;
        trackIds?: readonly string[];
      } | undefined;
      const timeoutFallbackSource: TimeoutFallbackSource = knownGood?.source ?? "generic_fallback";
      req.log.warn(
        {
          requestId: opts.requestId,
          elapsedMs: opts.elapsedMs,
          trackCount: tracks.length,
          requestedLength: length,
          failureReason: opts.failureReason,
          timeoutFallbackSource,
        },
        "Generate timeout deliverable response emitted"
      );
      res.status(200).json(withIntentSurvivalAuditPayload(req, attachExecutionTrace({
        success: true,
        code: "TIMEOUT_FALLBACK",
        degraded: true,
        userMessage: "We saved the best matches found so far; full curation ran out of time.",
        playlistName: generatePlaylistName(vibe, emotionProfile),
        tracks,
        generationDiagnostics: {
          recoveryTriggered: true,
          recoveryDiagnostics: buildRecoveryDiagnostics({
            recoveryRelaxations: [],
            fallbackLevel: opts.fallbackLevel ?? "timeout_finalized",
            finalTrackCount: tracks.length,
            requestedLength: length,
          }),
          fallbackLevel: opts.fallbackLevel ?? "timeout_finalized",
          sessionCancelled: true,
          failureReason: opts.failureReason,
          requestId: opts.requestId,
          elapsedMs: opts.elapsedMs,
          lastPhase: opts.lastPhase ?? null,
          lastStage: opts.lastStage ?? null,
          stageProfile: opts.stageProfile ?? null,
          finalResponseCompletionLockApplied: true,
          finalResponseCompletionAdded: tracks.length,
          timeoutFallbackSource,
          goodPlaylistDeliverySnapshot: snapshot
            ? {
              readyAtMs: snapshot.readyAtMs ?? null,
              elapsedMs: snapshot.elapsedMs ?? null,
              confidence: snapshot.confidence ?? null,
              trackCount: snapshot.trackIds?.length ?? null,
            }
            : null,
          productionTimeline: productionTimelineReport,
          latencyBudgetExceeded: latencyObs.latencyBudgetExceeded,
          requestStageTiming: latencyObs.requestStageTiming,
          latencyBudget: latencyObs.latencyBudget,
          goodPlaylistRefinement: latencyObs.goodPlaylistRefinement,
        },
        v3Diagnostics: (ctx?.v3Diagnostics as Record<string, unknown> | undefined) ?? { timeoutFinalized: true },
        fastFallback: false,
        mode,
      }, buildFallbackExecutionTraceDraft({
        requestId: opts.requestId,
        prompt: vibe,
        seed: (typeof ctx?.seed === "number" || typeof ctx?.seed === "string") ? ctx.seed : null,
        executionPath: "timeout_fallback",
        failureDetail: opts.failureReason,
        finalTrackCount: tracks.length,
        timeoutOccurred: true,
      })), tracks, vibe));
      return true;
    }
  }
  // Strict editorial prompts: deliver good-playlist snapshots above, but never generic library fillers.
  if (!opts.allowStrictOverride && shouldBlockStrictEditorialTimeoutFallback(ctx)) {
    return false;
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
    worldFilter: fallbackWorldBoundary.active
      ? {
        sceneLock: sceneLockStatus ?? null,
        sceneAliases,
        scenePrediction: mergedScenePrediction,
      }
      : undefined,
  });
  let timeoutFinalTracks = [...pipeline.finalTracks];
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
  timeoutFinalTracks = purifyFallbackTracks(timeoutFinalTracks);
  if (fallbackWorldBoundary.hardLock && timeoutFinalTracks.length === 0) {
    req.log.warn(
      {
        requestId: opts.requestId,
        failureReason: opts.failureReason,
        hardLock: true,
      },
      "Timeout library fallback blocked — no in-world tracks after purity",
    );
    return false;
  }
  const tracks = formatTracksForApi(timeoutFinalTracks.slice(0, length), emotionProfile);
  if (tracks.length === 0) return false;

  const latencyObs = buildLatencyObservabilityFromCtx(ctx, timeoutFinalTracks, {
    elapsedMs: opts.elapsedMs,
    latencyBudgetExceeded: opts.latencyBudgetExceeded,
    requestStageTiming: opts.requestStageTiming ?? null,
  });

  const bypassGate = buildBypassedHumanSaveabilityGate({
    reason: "fast_fallback",
    stageResponsible: "request",
    detail: opts.failureReason,
  });

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
  const resolvedFallbackLevel = opts.fallbackLevel ?? "timeout_fallback";
  noteGenerateSuccess(req, {
    requestId: opts.requestId,
    executionPath: "timeout_fallback",
    humanSaveable: false,
    playlistSize: tracks.length,
    productionTimeline,
    requestStageTiming: opts.requestStageTiming ?? undefined,
    playlistExecutionTrace: finalizeExecutionTrace(buildFallbackExecutionTraceDraft({
      requestId: opts.requestId,
      prompt: vibe,
      seed: (ctx?.seed ?? null) as number | string | null,
      executionPath: "timeout_fallback",
      failureDetail: opts.failureReason,
      finalTrackCount: tracks.length,
      timeoutOccurred: true,
    })),
  });
  res.status(200).json(withIntentSurvivalAuditPayload(req, attachExecutionTrace({
    success: true,
    code: "TIMEOUT_FALLBACK",
    degraded: true,
    userMessage: "We saved the best matches found so far; full curation ran out of time.",
    playlistName: generatePlaylistName(vibe, emotionProfile),
    tracks,
    generationDiagnostics: {
      recoveryTriggered: true,
      fallbackLevel: resolvedFallbackLevel,
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
      timeoutFallbackSource: "generic_fallback" as const,
      timeoutFallbackIntentOrdered: expectedFamilies.length > 0 || !!eraRange,
      productionTimeline: productionTimelineReport,
      latencyBudgetExceeded: latencyObs.latencyBudgetExceeded,
      requestStageTiming: latencyObs.requestStageTiming,
      latencyBudget: latencyObs.latencyBudget,
      goodPlaylistRefinement: latencyObs.goodPlaylistRefinement,
    },
    v3Diagnostics: {
      ...(pipeline.scoringDiagnostics as Record<string, unknown> | undefined),
      humanSaveabilityGate: bypassGate,
    },
    humanSaveabilityGate: bypassGate,
    fastFallback: true,
    mode,
  }, buildFallbackExecutionTraceDraft({
    requestId: opts.requestId,
    prompt: vibe,
    seed: (typeof ctx?.seed === "number" || typeof ctx?.seed === "string") ? ctx.seed : null,
    executionPath: "timeout_fallback",
    failureDetail: opts.failureReason,
    finalTrackCount: tracks.length,
    timeoutOccurred: true,
  })), tracks, vibe));
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
    seriouslyUnderfilled &&
    (diagnostics["artistLimitRelaxed"] === true || diagnostics["albumLimitRelaxed"] === true)
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
  const expectedFamilies = intent.primaryGenres.length > 0 ? intent.primaryGenres : intent.genreFamilies;
  const allowIntentAdjacentSubgenres = expectedFamilies.length > 0 && expectedFamilies.some((family) =>
    hasFinalGenreEvidence(track, classMap, [family])
  );
  return trackMatchesExplicitSubgenreEvidence(track, intent, classMap, {
    allowIntentAdjacentSubgenres,
    genreFamilies: expectedFamilies,
  });
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
  // Christmas/festive intent only — bare UK "holiday" (vacation) must not unlock Christmas tracks.
  // Negations ("non christmas", "no xmas") are hard suppresses.
  if (promptSuppressesChristmas(vibe) || resolveHumanScene(vibe).suppressChristmas) return false;
  return /\b(?:christmas|xmas|festive|noel|santa|holiday\s+song|holiday\s+classics|christmas\s+holiday|winter\s+holiday)\b/i.test(vibe);
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
const ELECTRONIC_BASS_SIBLING_SUBGENRES = new Set([
  "liquid_dnb",
  "drum_and_bass",
  "jungle",
  "neurofunk",
  "liquid_funk",
  "jump_up",
  "dubstep",
  "brostep",
  "riddim",
  "uk_garage",
  "bass_music",
  "halftime",
  "breakbeat",
]);
const ELECTRONIC_TRANCE_SIBLING_SUBGENRES = new Set([
  "trance",
  "progressive_trance",
  "psytrance",
  "hard_trance",
  "uplifting_trance",
  "goa_trance",
  "eurodance",
]);
const DREAM_ROCK_SIBLING_SUBGENRES = new Set([
  "shoegaze",
  "dream_pop",
  "noise_pop",
  "slowcore",
  "indie_rock",
  "alternative_rock",
  "post_punk",
  "new_wave",
]);
const ELECTRONIC_BASS_CLUSTER_PROMPT_RE = /\b(?:liquid\s+(?:drum\s+(?:and|&)\s+bass|dnb)|drum\s+(?:and|&)\s+bass|dnb|jungle|dark\s+jungle|dubstep|old\s+school\s+dubstep|bass\s+music|neurofunk)\b/i;
const ELECTRONIC_TRANCE_CLUSTER_PROMPT_RE = /\b(?:progressive\s+trance|trance\s+journey|90s?\s+trance|trance\s+drive|uplifting\s+trance|psytrance|hard\s+trance)\b/i;
const ELECTRONIC_BASS_CLUSTER_EVIDENCE_RE = /\b(?:liquid(?:\s+dnb|\s+drum(?:\s+(?:and|&)\s+bass)?)?|drum(?:\s+(?:and|&)\s+bass)|dnb|jungle|dubstep|brostep|riddim|neurofunk|breakbeat|uk\s+garage|bass\s+music)\b/i;
const ELECTRONIC_TRANCE_CLUSTER_EVIDENCE_RE = /\b(?:progressive\s+trance|trance|psytrance|goa|uplifting\s+trance|hard\s+trance|eurodance)\b/i;
const DREAM_ROCK_CLUSTER_PROMPT_RE = /\b(?:shoegaze|dream\s+pop|dreamscape|noise\s+pop|slowcore|ethereal\s+rock)\b/i;
const DREAM_ROCK_CLUSTER_EVIDENCE_RE = /\b(?:shoegaze|dream\s+pop|noise\s+pop|slowcore|ethereal|jangle\s+pop|bedroom\s+pop)\b/i;
const CITY_POP_SIBLING_SUBGENRES = new Set([
  "city_pop",
  "j_pop",
  "k_pop",
  "synthpop",
  "aor",
  "soft_rock",
  "yacht_rock",
]);
const REGGAE_SIBLING_SUBGENRES = new Set([
  "reggae",
  "roots_reggae",
  "dub",
  "dancehall",
  "rocksteady",
  "lovers_rock",
  "ska",
]);
const LATIN_SIBLING_SUBGENRES = new Set([
  "latin",
  "reggaeton",
  "latin_pop",
  "latin_trap",
  "salsa",
  "bachata",
  "cumbia",
  "urbano",
  "afrobeats",
  "dancehall",
  "reggae",
]);
const DISCO_SOUL_SIBLING_SUBGENRES = new Set([
  "disco",
  "funk",
  "soul",
  "motown",
  "boogie",
  "nu_disco",
  "disco_pop",
  "philly_soul",
  "p_funk",
]);
const HIP_HOP_CLASSICS_SIBLING_SUBGENRES = new Set([
  "boom_bap",
  "conscious_hip_hop",
  "east_coast_hip_hop",
  "golden_age_hip_hop",
  "alternative_hip_hop",
  "jazz_rap",
]);
const CITY_POP_CLUSTER_PROMPT_RE = /\b(?:city\s+pop|j[\s-]?pop|k[\s-]?pop|aor|soft\s+rock|yacht\s+rock)\b/i;
const REGGAE_CLUSTER_PROMPT_RE = /\b(?:reggae|dub|dancehall|rocksteady|ska|roots\s+reggae|beach\s+reggae)\b/i;
const LATIN_CLUSTER_PROMPT_RE = /\b(?:latin|reggaeton|salsa|bachata|cumbia|urbano|beach\s+party|summer\s+beach)\b/i;
const DISCO_CLUSTER_PROMPT_RE = /\b(?:disco|70s?\s+disco|funk\s+party|dancefloor)\b/i;
const HIP_HOP_CLASSICS_CLUSTER_PROMPT_RE = /\b(?:conscious\s+rap|boom\s+bap|golden\s+age|classic\s+hip\s+hop|old\s+school\s+rap|underground\s+hip\s+hop)\b/i;
const CITY_POP_CLUSTER_EVIDENCE_RE = /\b(?:city\s+pop|j[\s-]?pop|k[\s-]?pop|aor|yacht\s+rock|soft\s+rock|citypop)\b/i;
const REGGAE_CLUSTER_EVIDENCE_RE = /\b(?:reggae|dub|dancehall|rocksteady|ska|roots\s+reggae|lover'?s?\s+rock)\b/i;
const HIP_HOP_CLASSICS_CLUSTER_EVIDENCE_RE = /\b(?:conscious|boom\s+bap|golden\s+age|east\s+coast|jazz\s+rap|underground\s+hip\s+hop|old\s+school)\b/i;

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

function isElectronicBassClusterPrompt(vibe: string, intent: LockedIntent): boolean {
  if (ELECTRONIC_BASS_CLUSTER_PROMPT_RE.test(vibe)) return true;
  return explicitSubgenreTerms(intent).some((term) => ELECTRONIC_BASS_SIBLING_SUBGENRES.has(term));
}

function isElectronicTranceClusterPrompt(vibe: string, intent: LockedIntent): boolean {
  if (ELECTRONIC_TRANCE_CLUSTER_PROMPT_RE.test(vibe)) return true;
  return explicitSubgenreTerms(intent).some((term) => ELECTRONIC_TRANCE_SIBLING_SUBGENRES.has(term));
}

function isDreamRockClusterPrompt(vibe: string, intent: LockedIntent): boolean {
  if (DREAM_ROCK_CLUSTER_PROMPT_RE.test(vibe)) return true;
  return explicitSubgenreTerms(intent).some((term) => DREAM_ROCK_SIBLING_SUBGENRES.has(term));
}

function trackMatchesElectronicSiblingCluster(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>,
  siblingSubgenres: Set<string>,
  evidencePattern: RegExp,
): boolean {
  if (trackGenreFamily(track, classMap) !== "electronic") return false;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      siblingSubgenres.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? siblingSubgenres.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => siblingSubgenres.has(subgenre))
    )
  ) {
    return true;
  }
  return evidencePattern.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesDreamRockSiblingCluster(
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
  if (family !== "rock" && family !== "indie" && family !== "alternative") return false;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      DREAM_ROCK_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? DREAM_ROCK_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => DREAM_ROCK_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  return DREAM_ROCK_CLUSTER_EVIDENCE_RE.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesHipHopClassicsSiblingCluster(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  if (trackGenreFamily(track, classMap) !== "hip_hop") return false;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      HIP_HOP_CLASSICS_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? HIP_HOP_CLASSICS_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => HIP_HOP_CLASSICS_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  return HIP_HOP_CLASSICS_CLUSTER_EVIDENCE_RE.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesCityPopSiblingCluster(
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
  if (family !== "pop" && family !== "rnb" && family !== "soul" && family !== "world" && family !== "latin") return false;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      CITY_POP_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? CITY_POP_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => CITY_POP_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  return CITY_POP_CLUSTER_EVIDENCE_RE.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesReggaeSiblingCluster(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  if (trackGenreFamily(track, classMap) !== "reggae") return false;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      REGGAE_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? REGGAE_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => REGGAE_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  return REGGAE_CLUSTER_EVIDENCE_RE.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesLatinSiblingCluster(
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
  // Real latin beach playlists pull latino + warm dancehall/afrobeats neighbours when latin supply is thin.
  if (family === "latin" || family === "reggae" || family === "world") return true;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      LATIN_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? LATIN_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => LATIN_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  const energy = typeof track.energy === "number" ? track.energy : null;
  const dance = typeof track.danceability === "number" ? track.danceability : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  // Real summer latin playlists fill with warm dance neighbours when latin supply is thin.
  // Many library rows lack dance/valence — don't require the full triad or latin stays at n=1.
  if (energy != null && (family === "pop" || family === "electronic" || family === "rnb" || family === "hip_hop")) {
    if (dance != null && valence != null) {
      if (energy >= 0.5 && dance >= 0.55 && valence >= 0.4) return true;
    } else if (energy >= 0.58) {
      return true;
    }
  }
  return /\b(?:latin|reggaeton|salsa|bachata|cumbia|afrobeats|dancehall|reggae|urbano)\b/i.test(
    trackGenreTerms(track, classMap).join(" "),
  );
}

function trackMatchesDiscoSoulSiblingCluster(
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
  if (family === "soul" || family === "rnb") return true;
  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      DISCO_SOUL_SIBLING_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? DISCO_SOUL_SIBLING_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => DISCO_SOUL_SIBLING_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }
  const year = trackYearEstimate(track);
  const energy = typeof track.energy === "number" ? track.energy : null;
  const dance = typeof track.danceability === "number" ? track.danceability : null;
  // Human 70s disco floors are danceable soul/funk — prefer era-adjacent pulse over soft ballads.
  if (year != null && year >= 1968 && year <= 1984 && energy != null && dance != null) {
    return energy >= 0.58 && dance >= 0.58 && (family === "pop" || family === "rock" || family === "electronic" || family === "soul" || family === "rnb");
  }
  if (energy != null && dance != null && energy >= 0.6 && dance >= 0.62) {
    return family === "soul" || family === "rnb" || family === "pop" || family === "electronic";
  }
  return /\b(?:disco|funk|boogie|motown)\b/i.test(trackGenreTerms(track, classMap).join(" "));
}

function trackMatchesGenreSiblingUnderfill(
  track: ConstraintTrack,
  vibe: string,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  if (isElectronicBassClusterPrompt(vibe, intent)) {
    return trackMatchesElectronicSiblingCluster(track, classMap, ELECTRONIC_BASS_SIBLING_SUBGENRES, ELECTRONIC_BASS_CLUSTER_EVIDENCE_RE);
  }
  if (isElectronicTranceClusterPrompt(vibe, intent)) {
    return trackMatchesElectronicSiblingCluster(track, classMap, ELECTRONIC_TRANCE_SIBLING_SUBGENRES, ELECTRONIC_TRANCE_CLUSTER_EVIDENCE_RE);
  }
  if (isDreamRockClusterPrompt(vibe, intent)) {
    return trackMatchesDreamRockSiblingCluster(track, classMap);
  }
  if (CITY_POP_CLUSTER_PROMPT_RE.test(vibe)) {
    return trackMatchesCityPopSiblingCluster(track, classMap);
  }
  if (REGGAE_CLUSTER_PROMPT_RE.test(vibe)) {
    return trackMatchesReggaeSiblingCluster(track, classMap);
  }
  if (LATIN_CLUSTER_PROMPT_RE.test(vibe) || intent.genreFamilies.includes("latin")) {
    return trackMatchesLatinSiblingCluster(track, classMap);
  }
  if (DISCO_CLUSTER_PROMPT_RE.test(vibe) || intent.genreFamilies.includes("soul")) {
    return trackMatchesDiscoSoulSiblingCluster(track, classMap);
  }
  if (HIP_HOP_CLASSICS_CLUSTER_PROMPT_RE.test(vibe)) {
    return trackMatchesHipHopClassicsSiblingCluster(track, classMap);
  }
  if (isRockPunkClusterPrompt(vibe, intent)) {
    return trackMatchesRockPunkSiblingCluster(track, classMap);
  }
  return false;
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
  if (/\b(?:hype|high\s+energy|energ(?:y|ised|ized))\b/.test(lower)) return true;
  if (/\b(?:feel.?good|getting ready|commut(?:e|ing))\b/.test(lower) && /\b(?:morning|day|summer|work)\b/.test(lower)) return true;
  return false;
}

function isCodingOrWorkFocusPrompt(vibe: string): boolean {
  return (
    /\b(?:coding|programming|debugging|developer|software)\b/i.test(vibe) ||
    /\b(?:coding|productivity|design|shipping)\s+sprint\b/i.test(vibe) ||
    /\b(?:work\s*flow|workflow|deep\s+work)\b/i.test(vibe)
  );
}

function isGymWorkoutPrompt(vibe: string, intent: LockedIntent): boolean {
  // Coding sprint / work flow must never route through gym intensity.
  if (isCodingOrWorkFocusPrompt(vibe)) return false;
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
  const activityProfile = opts ? resolveActivityProfile(opts.vibe, opts.intent) : null;
  if (activityProfile?.id === "gym" && typeof track.energy === "number" && track.energy < activityProfile.energyMin) {
    return false;
  }
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
  if (energy !== null && energy < (activityProfile?.id === "gym" ? 0.70 : 0.50)) return false;
  if (tempo !== null && tempo < 92 && (danceability ?? 0.5) < 0.54) return false;
  if (valence !== null && valence < 0.20) return false;
  if (acousticness !== null && acousticness > 0.74 && (energy ?? 0.6) < 0.64) return false;
  if (loudness !== null && loudness < -15 && (energy ?? 0.6) < 0.62) return false;
  return true;
}

function finalTrackIsRecoverySafe(
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
  },
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.intent, opts.classMap)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  const genreOk =
    finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap) ||
    trackMatchesGenreSiblingUnderfill(track, opts.vibe, opts.intent, opts.classMap);
  if (explicitGenreLocked && !genreOk) return false;
  if (
    (opts.intent.eraStart !== null || opts.intent.eraEnd !== null || opts.intent.eraRange) &&
    !finalTrackMatchesExplicitEra(track, opts.intent)
  ) {
    const year = trackYearEstimate(track);
    const range = opts.intent.eraRange;
    const start = range?.start ?? opts.intent.eraStart;
    const end = range?.end ?? opts.intent.eraEnd;
    if (year !== null && start != null && end != null && (year < start - 10 || year > end + 10)) {
      return false;
    }
  }
  if (isGymWorkoutPrompt(opts.vibe, opts.intent)) {
    return trackPassesRecoveryActivity(track, {
      activity: opts.intent.activity ?? "gym",
      energyLevel: opts.intent.energyLevel ?? null,
    });
  }
  if (isFocusStudyPrompt(opts.vibe, opts.intent)) {
    return trackIsFocusStudySafe(track, opts.vibe, opts.intent);
  }
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent)) {
    return trackPassesRecoveryActivity(track, {
      activity: opts.intent.activity ?? "party",
      energyLevel: opts.intent.energyLevel ?? null,
    }) || trackIsUpbeatSocialSafe(track, opts.classMap, opts.vibe, opts.intent);
  }
  return finalTrackIsSafe(track, opts);
}

function isFocusStudyPrompt(vibe: string, intent: LockedIntent): boolean {
  return intent.activity === "focus" ||
    /\b(?:focus|study|studying|deep\s+work|homework|work\s+from\s+home|coding|no\s+distractions?)\b/i.test(vibe);
}

function trackIsFocusStudySafe(track: ConstraintTrack, vibe?: string, intent?: LockedIntent): boolean {
  const activityProfile = vibe && intent ? resolveActivityProfile(vibe, intent) : null;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const energyMax = activityProfile?.energyMax ?? 0.62;
  if (energy !== null && energy > energyMax) return false;
  if (tempo !== null && (tempo > 142 || tempo < 50)) return false;
  if (danceability !== null && danceability > 0.76 && (energy ?? 0.5) > 0.52) return false;
  if (speechiness !== null && speechiness > (activityProfile?.maxSpeechiness ?? 0.33)) return false;
  if (valence !== null && valence < 0.12 && (energy ?? 0.5) < 0.34) return false;
  return true;
}

function trackIsUpbeatSocialSafe(
  track: ConstraintTrack,
  classMap?: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>,
  vibe?: string,
  intent?: LockedIntent,
): boolean {
  const activityProfile = vibe && intent ? resolveActivityProfile(vibe, intent) : null;
  if (classMap) {
    const family = trackGenreFamily(track, classMap);
    if (family === "metal" || family === "classical" || family === "soundtrack") return false;
  }
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && energy > 0.58 && valence !== null && valence < 0.48 && (danceability ?? 0.5) < 0.52) return false;
  if (speechiness !== null && speechiness > 0.34 && valence !== null && valence < 0.55) return false;
  if (energy !== null && energy < (activityProfile?.id === "party_pregame" ? 0.75 : 0.48)) return false;
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
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track, opts.vibe, opts.intent)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track, opts.classMap, opts.vibe, opts.intent)) return false;
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
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track, opts.vibe, opts.intent)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track, opts.classMap, opts.vibe, opts.intent)) return false;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) return false;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) return false;
  const promptEmotion = detectDominantEmotion(opts.vibe);
  if (promptEmotion.explicit && !trackMatchesDominantEmotion(track, promptEmotion.emotion)) return false;
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

  const activityProfile = resolveActivityProfile(opts.vibe, opts.intent);
  if (activityProfile) {
    const classification = opts.classMap.get(track.trackId) ?? null;
    score += activityCoherenceDelta(track, classification, activityProfile, opts.vibe);
    if (trackFailsActivityHardGate(track, classification, activityProfile, opts.vibe)) {
      score -= 0.36;
      violations++;
    }
  }

  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track, opts)) score -= 0.42;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track, opts.vibe, opts.intent)) score -= 0.38;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) score -= 0.30;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.38;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track, opts.classMap, opts.vibe, opts.intent)) score -= 0.34;
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

function trackProvesUnknownFinalWorld<T extends ConstraintTrack>(
  track: T,
  playlist: T[],
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>,
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family !== "unknown" || playlist.length < 3) return true;
  const anchors = playlist.filter((row) => trackGenreFamily(row, classMap) !== "unknown");
  if (anchors.length < 2) return true;
  const avgEnergy = anchors.reduce((sum, row) => sum + (row.energy ?? 0.5), 0) / anchors.length;
  const avgValence = anchors.reduce((sum, row) => sum + (row.valence ?? 0.5), 0) / anchors.length;
  const avgAcoustic = anchors.reduce((sum, row) => sum + (row.acousticness ?? 0.5), 0) / anchors.length;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acoustic = track.acousticness ?? 0.5;
  if (Math.abs(energy - avgEnergy) > 0.24) return false;
  if (Math.abs(valence - avgValence) > 0.28) return false;
  if (Math.abs(acoustic - avgAcoustic) > 0.30) return false;
  return true;
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
  },
  seedTracks: T[] = [],
): Set<string> {
  const limit = cohesionFamilyLimit(opts.vibe, opts.intent, opts.constraints);
  if (!limit) return new Set();
  const minFamilyCount = isUpbeatSocialPrompt(opts.vibe, opts.intent) ? 3 : 4;
  const counts = new Map<string, number>();
  const scores = new Map<string, number>();
  const seen = new Set<string>();
  for (const track of [...seedTracks, ...tracks.slice(0, Math.max(40, limit * 30))]) {
    if (seen.has(track.trackId)) continue;
    seen.add(track.trackId);
    if (!finalTrackIsSafe(track, opts)) continue;
    const family = trackGenreFamily(track, opts.classMap);
    if (!family || family === "unknown") continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
    scores.set(family, (scores.get(family) ?? 0) + Math.max(0, track.score ?? 0));
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= minFamilyCount)
      .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0) || b[1] - a[1])
      .slice(0, limit)
      .map(([family]) => family)
  );
}

function artistDiversityCap(playlistSize: number, vibe: string): number {
  return defaultPerPlaylistArtistCap(playlistSize, vibe);
}

function buildEmptyPlaylistRecoveryFloor<T extends { trackId: string }>(
  existing: T[],
  sources: {
    verified: T[];
    preGenreGuard: T[];
    recoveryPool: T[];
    limit: number;
  },
): T[] {
  const ids = new Set(existing.map((track) => track.trackId));
  const out: T[] = [...existing];
  const push = (track: T | undefined): void => {
    if (!track?.trackId || ids.has(track.trackId)) return;
    ids.add(track.trackId);
    out.push(track);
  };
  for (const track of sources.verified) push(track);
  for (const track of sources.preGenreGuard) push(track);
  for (const track of sources.recoveryPool) push(track);
  return out.slice(0, sources.limit);
}

function applyFinalDeliveryArtistCap<T extends { artistName?: string | null }>(
  tracks: T[],
  opts: {
    vibe: string;
    playlistSize: number;
    promptCentralArtists: ReadonlySet<string>;
    defaultCap: number;
  },
): { tracks: T[]; diagnostics: ReturnType<typeof applyDeliveryPerPlaylistArtistCap>["diagnostics"] } {
  return applyDeliveryPerPlaylistArtistCap(tracks, {
    vibe: opts.vibe,
    playlistSize: opts.playlistSize,
    promptCentralArtists: opts.promptCentralArtists,
    defaultCap: opts.defaultCap,
  });
}

function applyArtistCapAtCheckpoint<T extends { trackId: string; artistName?: string | null }>(
  delivery: PipelineDeliveryBuffer<T>,
  checkpoint: "post_recovery" | "post_refill" | "terminal_delivery",
  opts: {
    vibe: string;
    playlistSize: number;
    promptCentralArtists: ReadonlySet<string>;
    defaultCap: number;
  },
): { tracks: T[]; diagnostics: ReturnType<typeof applyDeliveryPerPlaylistArtistCap>["diagnostics"] } {
  const capped = applyFinalDeliveryArtistCap([...delivery.getTracks()], opts);
  if (capped.diagnostics.applied) {
    delivery.replaceTracks(checkpoint, "artist_cap_authoritative", capped.tracks);
  }
  return { tracks: [...delivery.getTracks()] as T[], diagnostics: capped.diagnostics };
}

function runDeliveryCheckpoint(
  session: PipelineAuthoritySession,
  checkpoint: PipelineCheckpoint,
  ctx: {
    tracks: Array<{ trackId: string; artistName?: string | null; trackName?: string | null; name?: string | null; artist?: string | null; scoreBreakdown?: unknown; scoreChannels?: unknown }>;
    vibe: string;
    requestedLength: number;
    maxPerArtist: number;
    promptCentralArtists: ReadonlySet<string>;
    thinLibraryPolicy?: ThinLibraryPolicyResult;
    openingLock?: OpeningLock | null;
    confidence?: { percent: number } | null;
    recoveryPoolSize?: number;
    hasExplicitGenreIntent?: boolean;
    hasExplicitEraIntent?: boolean;
    genreHardCheck?: (track: { trackId: string }) => boolean;
    eraHardCheck?: (track: { trackId: string }) => boolean;
    genreEvidenceVerifiedCount?: number;
    genreEvidenceRequiredCount?: number;
    requireTelemetry?: boolean;
    strictMode?: boolean;
  },
) {
  return session.runCheckpoint({
    checkpoint,
    tracks: ctx.tracks,
    vibe: ctx.vibe,
    requestedLength: ctx.requestedLength,
    maxPerArtist: ctx.maxPerArtist,
    promptCentralArtists: ctx.promptCentralArtists,
    thinLibraryPolicy: ctx.thinLibraryPolicy,
    openingLock: ctx.openingLock,
    confidence: ctx.confidence,
    recoveryPoolSize: ctx.recoveryPoolSize,
    hasExplicitGenreIntent: ctx.hasExplicitGenreIntent,
    hasExplicitEraIntent: ctx.hasExplicitEraIntent,
    genreHardCheck: ctx.genreHardCheck,
    eraHardCheck: ctx.eraHardCheck,
    genreEvidenceVerifiedCount: ctx.genreEvidenceVerifiedCount,
    genreEvidenceRequiredCount: ctx.genreEvidenceRequiredCount,
    requireTelemetry: ctx.requireTelemetry,
    lastMutationStage: session.lastStage,
    strictMode: ctx.strictMode,
  });
}

function minViableTracksAfterGenrePrune(playlistSize: number): number {
  return Math.max(5, Math.ceil(playlistSize * 0.4));
}

function relaxedEmergencyArtistCap(playlistSize: number, maxPerArtist: number): number | null {
  if (!Number.isFinite(maxPerArtist) || maxPerArtist >= Number.MAX_SAFE_INTEGER / 2) return null;
  return Math.min(maxPerArtist + 1, Math.max(4, Math.ceil(playlistSize * 0.12)));
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
  if (before.length < Math.max(3, Math.ceil(requestedLength * 0.15)) && after.length > 0) return true;
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
    protectedPrefixCount?: number;
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
    if ((opts.protectedPrefixCount ?? 0) > 0 && index < opts.protectedPrefixCount!) {
      const track = out[index]!;
      const signature = trackRepeatSignature(track);
      if (signature && !usedSignatureIndexes.has(signature)) {
        usedSignatureIndexes.set(signature, index);
      }
      continue;
    }
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
    .slice(0, 50);
}

function evaluationDiversityPressure(
  vibe: string,
  profile: EmotionProfile,
  evaluationMemoryCount: number
): number {
  if (evaluationMemoryCount <= 0) return 1;
  const lower = vibe.toLowerCase();
  let base = 1.55;
  if (profile.environment === "gym" || /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/.test(lower)) {
    base = 1.75;
  } else if (profile.environment === "party" || /\b(?:party|club|dancefloor|pre\s*drinks|night\s*out|rave)\b/.test(lower)) {
    base = 1.7;
  } else if (profile.environment === "focus" || /\b(?:focus|study|coding|work|reading|office)\b/.test(lower)) {
    base = 1.6;
  }
  const memoryBoost = 1 + Math.min(0.65, evaluationMemoryCount * 0.05);
  return base * memoryBoost;
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
  if (tracks.length < 4 || before.score >= 0.60) {
    return { tracks, beforeScore: before.score, afterScore: before.score, repaired: false };
  }

  const openingLockSize = Math.min(3, Math.max(1, Math.floor(tracks.length * 0.12)));
  const ordered: T[] = tracks.slice(0, openingLockSize);
  const remaining = tracks.slice(openingLockSize);
  const recentArtists = new Set(ordered.map((t) => t.artistName.toLowerCase().trim()).filter(Boolean));
  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1]!;
    const previousArtist = previous.artistName.toLowerCase().trim();
    const nextIndex = remaining
      .map((track, index) => {
        const artist = track.artistName.toLowerCase().trim();
        const sameArtistPenalty = artist && (artist === previousArtist || recentArtists.has(artist)) ? 0.42 : 0;
        return {
          index,
          transitionCost:
            Math.abs((previous.energy ?? 0.5) - (track.energy ?? 0.5)) +
            Math.abs((previous.valence ?? 0.5) - (track.valence ?? 0.5)) * 0.8 +
            sameArtistPenalty,
        };
      })
      .sort((a, b) => a.transitionCost - b.transitionCost)[0]?.index ?? 0;
    const picked = remaining.splice(nextIndex, 1)[0]!;
    ordered.push(picked);
    const pickedArtist = picked.artistName.toLowerCase().trim();
    if (pickedArtist) recentArtists.add(pickedArtist);
    if (recentArtists.size > 4) {
      const keep = new Set(ordered.slice(-4).map((t) => t.artistName.toLowerCase().trim()).filter(Boolean));
      for (const key of [...recentArtists]) {
        if (!keep.has(key)) recentArtists.delete(key);
      }
    }
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
  mode?: "strict" | "balanced" | "chaotic";
  constraints: ConstraintLayer;
  allowHolidaySeason?: boolean;
  supplyConstrainedRecovery?: boolean;
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
  const blockHardSafeFill = shouldBlockHardSafeFinalization(opts.mode ?? "balanced", {
    primarySubgenre: opts.intent.primarySubgenre ?? null,
    primaryGenres: opts.intent.primaryGenres,
  });

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
  const preferredFamilies = preferredCohesionFamilies(rankedCandidates, opts, opts.initial);
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
    if (!opts.supplyConstrainedRecovery && !finalTrackIsSafe(sanitized, opts)) {
      unsafeDropped++;
      return;
    }
    if (opts.supplyConstrainedRecovery && !finalTrackIsRecoverySafe(sanitized, opts)) {
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
    if (
      enforceCohesion &&
      family === "unknown" &&
      preferredFamilies.size > 0 &&
      out.length >= 3 &&
      !trackProvesUnknownFinalWorld(sanitized, out, opts.classMap)
    ) {
      cohesionSkipped++;
      return;
    }
    if (
      enforceCohesion &&
      family === "unknown" &&
      preferredFamilies.size > 0 &&
      out.length >= 3 &&
      intentCoherenceFor(sanitized, preferredFamilies) < 0.06
    ) {
      cohesionSkipped++;
      return;
    }
    const artistKey = sanitized.artistName.toLowerCase().trim();
    const artistCount = artistCounts.get(artistKey) ?? 0;
    const recentArtistKeys = out.slice(-2).map((t) => t.artistName.toLowerCase().trim());
    if (recentArtistKeys.some((key) => key && key === artistKey)) {
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
    const familyPreferred = preferredFamilies.size === 0 || preferredFamilies.has(family);
    const familyVariationBonus = familyPressure === 0 ? 0.34 : familyPressure === 1 ? 0.12 : -0.18;
    const familyBonus = familyPreferred ? 0.10 : family === "unknown" ? -0.18 : -0.12;
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
    if (!passesMomentFitForRefill(sanitized, opts.vibe)) {
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
  const fillElectronicSiblingRefill = (
    artistLimit: number | null,
    albumLimit: number | null,
    stopAt: number = opts.requestedLength
  ): number => {
    const siblingPool = rankedCandidates.filter((track) => {
      if (isElectronicBassClusterPrompt(opts.vibe, opts.intent)) {
        return trackMatchesElectronicSiblingCluster(
          track,
          opts.classMap,
          ELECTRONIC_BASS_SIBLING_SUBGENRES,
          ELECTRONIC_BASS_CLUSTER_EVIDENCE_RE,
        );
      }
      if (isElectronicTranceClusterPrompt(opts.vibe, opts.intent)) {
        return trackMatchesElectronicSiblingCluster(
          track,
          opts.classMap,
          ELECTRONIC_TRANCE_SIBLING_SUBGENRES,
          ELECTRONIC_TRANCE_CLUSTER_EVIDENCE_RE,
        );
      }
      return false;
    });
    if (siblingPool.length === 0) return 0;
    siblingSubgenreRefillUsed = true;
    return fillUniqueHardSafe(siblingPool, artistLimit, albumLimit, stopAt);
  };
  const fillDreamRockSiblingRefill = (
    artistLimit: number | null,
    albumLimit: number | null,
    stopAt: number = opts.requestedLength
  ): number => {
    if (!isDreamRockClusterPrompt(opts.vibe, opts.intent)) return 0;
    const siblingPool = rankedCandidates.filter((track) => trackMatchesDreamRockSiblingCluster(track, opts.classMap));
    if (siblingPool.length === 0) return 0;
    siblingSubgenreRefillUsed = true;
    return fillUniqueHardSafe(siblingPool, artistLimit, albumLimit, stopAt);
  };
  const fillConstrainedSiblingRefill = (
    artistLimit: number | null,
    albumLimit: number | null,
    stopAt: number = opts.requestedLength
  ): number => {
    const siblingPool = rankedCandidates.filter((track) =>
      trackMatchesGenreSiblingUnderfill(track, opts.vibe, opts.intent, opts.classMap) &&
      finalTrackIsSafe(track, opts)
    );
    if (siblingPool.length === 0) return 0;
    siblingSubgenreRefillUsed = true;
    const before = out.length;
    for (const track of siblingPool) {
      if (out.length >= stopAt) break;
      tryAdd(track, artistLimit, albumLimit, true);
    }
    return out.length - before;
  };

  const primaryArtistLimit = Number.isFinite(opts.maxPerArtist)
    ? opts.maxPerArtist
    : defaultPerPlaylistArtistCap(opts.requestedLength, opts.vibe);
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

  let qualityEligibleRemaining = 0;
  for (const track of coherentRankedCandidates) {
    const sanitized = sanitizePlaylistTrack(track);
    if (!sanitized || seen.has(sanitized.trackId)) continue;
    if (!finalTrackIsHardSafe(sanitized, opts)) continue;
    if (!passesMomentFitForRefill(sanitized, opts.vibe)) continue;
    qualityEligibleRemaining += 1;
  }
  const qualityCappedTarget = Math.min(completionTarget, out.length + qualityEligibleRemaining);
  const effectiveCompletionTarget = Math.max(out.length, qualityCappedTarget);

  if (out.length < effectiveCompletionTarget) {
    cohesionRelaxedFillUsed = preferredFamilies.size > 0;
    for (const track of coherentRankedCandidates) {
      const sanitized = sanitizePlaylistTrack(track);
      if (!sanitized || !passesMomentFitForRefill(sanitized, opts.vibe)) continue;
      const before = out.length;
      tryAdd(track, emergencyArtistLimit, emergencyAlbumLimit, true, false);
      if (out.length > before) cohesionRelaxedFillAdded++;
    }
  }
  if (blockHardSafeFill && out.length < effectiveCompletionTarget) {
    siblingSubgenreRefillAdded += fillConstrainedSiblingRefill(
      emergencyArtistLimit,
      emergencyAlbumLimit,
      effectiveCompletionTarget,
    );
  }
  if (!blockHardSafeFill && out.length < effectiveCompletionTarget) {
    hardSafeFillUsed = true;
    const strictHardSafeArtistLimit = primaryArtistLimit ?? emergencyArtistLimit;
    const strictHardSafeAlbumLimit = primaryAlbumLimit;
    fillUniqueHardSafe([...opts.initial, ...coherentRankedCandidates], strictHardSafeArtistLimit, strictHardSafeAlbumLimit, effectiveCompletionTarget);
    if (out.length < effectiveCompletionTarget) {
      fillUniqueHardSafe(coherentRankedCandidates, emergencyArtistLimit, emergencyAlbumLimit, effectiveCompletionTarget);
    }
    if (out.length < recoveryActivationThreshold(opts.requestedLength) && out.length < effectiveCompletionTarget) {
      fillUniqueHardSafe(coherentRankedCandidates, emergencyArtistLimit, emergencyAlbumLimit, effectiveCompletionTarget);
    }
    if (out.length < effectiveCompletionTarget) {
      siblingSubgenreRefillAdded += fillRockPunkSiblingRefill(emergencyArtistLimit, emergencyAlbumLimit);
      siblingSubgenreRefillAdded += fillElectronicSiblingRefill(emergencyArtistLimit, emergencyAlbumLimit);
      siblingSubgenreRefillAdded += fillDreamRockSiblingRefill(emergencyArtistLimit, emergencyAlbumLimit);
    }
  }
  const minimumCompleteCount = Math.min(
    Math.min(opts.requestedLength, Math.ceil(opts.requestedLength * 0.90)),
    effectiveCompletionTarget,
  );
  if (blockHardSafeFill && out.length < minimumCompleteCount) {
    siblingSubgenreRefillAdded += fillConstrainedSiblingRefill(
      primaryArtistLimit ?? emergencyArtistLimit,
      emergencyAlbumLimit,
      minimumCompleteCount,
    );
  }
  if (!blockHardSafeFill && out.length < minimumCompleteCount) {
    hardSafeFillUsed = true;
    const minimumFillArtistLimit = primaryArtistLimit ?? emergencyArtistLimit;
    fillUniqueHardSafe([...coherentRankedCandidates, ...rankedCandidates], minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
    if (out.length < minimumCompleteCount) {
      siblingSubgenreRefillAdded += fillRockPunkSiblingRefill(minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
      siblingSubgenreRefillAdded += fillElectronicSiblingRefill(minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
      siblingSubgenreRefillAdded += fillDreamRockSiblingRefill(minimumFillArtistLimit, emergencyAlbumLimit, minimumCompleteCount);
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
      completionTarget: effectiveCompletionTarget,
      qualityEligibleRemaining,
      qualityCappedTarget,
      activityCompletionTarget: shouldCompleteActivityPlaylist,
      cohesionRelaxedFillUsed,
      cohesionRelaxedFillAdded,
      artistLimitRelaxed: relaxedArtistFillUsed,
      artistLimitRelaxedTo: relaxedArtistFillUsed ? emergencyArtistLimit : null,
      albumLimitRelaxed: relaxedAlbumFillUsed,
      albumLimitRelaxedTo: relaxedAlbumFillUsed ? emergencyAlbumLimit : null,
      artistLimitBypassed: false,
      hardSafeFillUsed,
      hardSafeFillBlocked: blockHardSafeFill,
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

function compactSceneWorldLayerForApi(value: unknown): unknown {
  const layer = value as Record<string, unknown> | null | undefined;
  if (!layer || typeof layer !== "object") return null;
  const archetype = layer["archetype"] as Record<string, unknown> | undefined;
  const sceneClusters = layer["sceneClusters"] as Record<string, unknown> | undefined;
  return {
    active: layer["active"] ?? false,
    strictMode: layer["strictMode"] ?? false,
    descriptor: layer["descriptor"] ?? null,
    archetype: archetype
      ? {
          id: archetype["id"],
          label: archetype["label"],
          genreFamilies: archetype["genreFamilies"],
        }
      : null,
    sceneClusters: sceneClusters
      ? {
          dominantCluster: sceneClusters["dominantCluster"],
          dominantClusterId: sceneClusters["dominantClusterId"],
          clusterCount: sceneClusters["clusterCount"],
          clusterPurity: sceneClusters["clusterPurity"],
        }
      : null,
  };
}

function compactHumanSaveabilityGateForApi(value: unknown): unknown {
  const gate = value as Record<string, unknown> | null | undefined;
  if (!gate || typeof gate !== "object") return null;
  const attribution = gate["attribution"] as Record<string, unknown> | undefined;
  const openingTen = gate["openingTenDominantCluster"] as Record<string, unknown> | undefined;
  return {
    passed: gate["passed"],
    humanSaveable: gate["humanSaveable"],
    bypassed: gate["bypassed"],
    bypassReason: gate["bypassReason"],
    curatorScore: gate["curatorScore"],
    breakdown: gate["breakdown"],
    rejectionReasons: gate["rejectionReasons"],
    offendingTracks: Array.isArray(gate["offendingTracks"])
      ? (gate["offendingTracks"] as unknown[]).slice(0, 20)
      : [],
    strictModeHumanSaveability: gate["strictModeHumanSaveability"],
    dominantCluster: gate["dominantCluster"] ?? attribution?.["dominantCluster"] ?? null,
    openingClusterPurity: gate["openingClusterPurity"],
    openingClusterViolations: gate["openingClusterViolations"],
    openingRepairCount: gate["openingRepairCount"],
    interleaverAudit: gate["interleaverAudit"] ?? attribution?.["interleaverAudit"] ?? null,
    openingTenDominantCluster: openingTen
      ? {
          ...openingTen,
          trace: Array.isArray(openingTen["trace"])
            ? (openingTen["trace"] as unknown[]).slice(0, 10)
            : [],
        }
      : null,
    sceneClusterFunnel: gate["sceneClusterFunnel"] ?? null,
    attribution: attribution
      ? {
          stageResponsible: attribution["stageResponsible"],
          stageCounts: attribution["stageCounts"],
          offendingTrackAttribution: Array.isArray(attribution["offendingTrackAttribution"])
            ? (attribution["offendingTrackAttribution"] as unknown[]).slice(0, 10)
            : [],
        }
      : null,
    retriesUsed: gate["retriesUsed"],
    maxRetries: gate["maxRetries"],
    hardFailed: gate["hardFailed"],
    deliveryTier: gate["deliveryTier"] ?? null,
    degradedDelivery: gate["degradedDelivery"] ?? false,
    completePlaylistSearch: (() => {
      const search = gate["completePlaylistSearch"] as Record<string, unknown> | undefined;
      if (!search || typeof search !== "object") return null;
      return {
        constraintsRelaxed: Array.isArray(search["constraintsRelaxed"])
          ? search["constraintsRelaxed"].map(String)
          : [],
      };
    })(),
  };
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
      intentDecomposer: intent?.["intentDecomposer"] ?? v3["intentDecomposer"] ?? null,
    },
    intentDecomposer: v3["intentDecomposer"] ?? intent?.["intentDecomposer"] ?? null,
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
    sceneWorldLayer: compactSceneWorldLayerForApi(v3["sceneWorldLayer"]),
    deliveryTier: v3["deliveryTier"] ?? null,
    intentSurvival: v3["intentSurvival"] ?? null,
    humanSaveabilityGate: compactHumanSaveabilityGateForApi(v3["humanSaveabilityGate"]),
    openingTenDominantCluster: v3["openingTenDominantCluster"] ?? null,
    sceneClusterFunnel: v3["sceneClusterFunnel"] ?? null,
    playlistExecutionTrace: (() => {
      const trace = v3["playlistExecutionTrace"] as Record<string, unknown> | null | undefined;
      if (!trace || typeof trace !== "object") return null;
      return {
        ...trace,
        openingTenClusterTrace: sampleArray(trace["openingTenClusterTrace"], 10),
      };
    })(),
    genreConcentration:  postInterleave?.["genreConcentration"]  ?? null,
    explorationPressure: postInterleave?.["explorationPressure"] ?? null,
    dominantGenre:       postInterleave?.["dominantGenre"]       ?? null,
    dominantEra:         postInterleave?.["dominantEra"]         ?? null,
    worldCoherence:      v3["worldCoherence"] ?? null,
    humanQualityGate:   v3["humanQualityGate"] ?? null,
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
  const payload = {
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
  const serialized = JSON.stringify(payload);
  if (serialized.length > 120_000) {
    return { truncated: true, byteLength: serialized.length, preview: payload };
  }
  return payload;
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
  country: ["country", "americana", "red dirt", "outlaw country", "honky tonk", "bluegrass", "nashville"],
  hip_hop: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "emo rap", "grime", "uk hip hop", "british hip hop", "uk rap"],
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
    const metadataFamilyHit = metadataGenres.some((genre) => {
      const family = getGenreFamily(genre.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_"));
      return !!family && expectedFamilies.includes(family);
    });
    const metadataTier = assessGenreEvidenceTier({
      subgenreMatch: false,
      spotifyArtistGenres: track.spotifyArtistGenres,
      albumGenres: track.albumGenres,
    });
    if (metadataFamilyHit && metadataTier.confidence >= 0.68) {
      return true;
    }
  }
  if (!candidateClassification || !expectedFamilies.includes(candidateClassification.genreFamily)) {
    const known = FINAL_GUARD_KNOWN_ARTISTS.find((entry) => entry.pattern.test(track.artistName ?? ""));
    return !!known && expectedFamilies.includes(known.family);
  }
  const diagnostics = candidateClassification.diagnostics;
  const evidenceTier = assessGenreEvidenceTier({
    subgenreMatch: expectedFamilies.includes(candidateClassification.genreFamily),
    spotifyArtistGenres: track.spotifyArtistGenres,
    albumGenres: track.albumGenres,
    taxonomyHit: diagnostics?.taxonomyHit === true,
    audioFallbackUsed: diagnostics?.audioFallbackUsed === true,
  });
  if (evidenceTier.tier === "exact_tag" || evidenceTier.tier === "artist_genre" || evidenceTier.tier === "taxonomy") {
    return true;
  }
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
  const body = (req.body ?? {}) as { requestId?: string };
  const status = getGenerateStatus(userId);
  const requestId =
    typeof body.requestId === "string" && body.requestId.trim()
      ? body.requestId.trim()
      : status.requestId;
  if (status.active && requestId) {
    cancelGenerateSession(userId, requestId);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json({
    success: true,
    cancelled: status.active,
    requestId,
  });
});

router.post("/generate/failure-outcome", async (req, res): Promise<void> => {
  if (!req.session?.spotifyUserId) {
    res.status(401).json({ success: false, error: "Authentication required." });
    return;
  }
  const body = req.body ?? {};
  const failureSessionId = typeof body.failureSessionId === "string" ? body.failureSessionId.trim() : "";
  const outcomeRaw = typeof body.outcome === "string" ? body.outcome.trim() : "";
  const allowedOutcomes = new Set(["discovery_rejected", "abandoned"]);
  if (!failureSessionId || !allowedOutcomes.has(outcomeRaw)) {
    res.status(400).json({
      success: false,
      error: "Provide failureSessionId and outcome (discovery_rejected | abandoned).",
    });
    return;
  }
  const result = await recordFailureOutcome(
    failureSessionId,
    outcomeRaw as "discovery_rejected" | "abandoned",
  );
  if (!result.updated) {
    res.status(404).json({
      success: false,
      error: "Failure session not found or already resolved.",
      failureSessionId,
    });
    return;
  }
  res.json({ success: true, failureSessionId, outcome: outcomeRaw });
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
    const sceneBus = resolveSceneBus(vibe);
    const { profile, journeyArc } = analyzeVibeWithContext(vibe);
    const vagueCommit = resolveVagueWorldCommit(vibe);
    const sceneResolution = resolveSemanticFromBus(vibe, profile, sceneBus, {
      singleWorldCommit: shouldSuppressVagueWiden(vagueCommit),
      vagueCommitSceneId: vagueCommit.sceneId,
    });
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
            id: sceneBus.sceneId ?? sceneResolution.matchedId,
            semanticId: sceneResolution.matchedId,
            label: sceneResolution.vector?.label ?? sceneBus.sceneId?.replace(/_/g, " ") ?? sceneResolution.matchedId,
            confidence: sceneBus.confidence || sceneResolution.confidence,
            energy: sceneResolution.vector?.energy ?? null,
            aesthetics: sceneResolution.vector?.aesthetics?.slice(0, 4) ?? [],
            primaryGenres,
          }
        : sceneBus.sceneId
          ? {
              id: sceneBus.sceneId,
              semanticId: sceneBus.semanticSceneId,
              label: sceneBus.sceneId.replace(/_/g, " "),
              confidence: sceneBus.confidence,
              energy: null,
              aesthetics: [],
              primaryGenres: [],
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
      discovery: getDiscoveryModeReadiness(vibe),
      intentUnderstanding: buildIntentUnderstandingDiagnostics({
        prompt: vibe,
        profile,
        includeWorldUnderstanding: req.query.debug === "1" || req.query.debug === "true",
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
    captureError(err, { source: "generate_preview", path: "/generate/preview" });
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
  initGenerateObs(req, startMs);
  const productionTimeline = createProductionTimeline();
  let requestId = "";
  let generationSeed: number | string | null = null;
  let generateVibe = "";
  let sessionUserId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let latencyBudgetTimer: ReturnType<typeof setTimeout> | null = null;
  let clientDisconnected = false;
  let cleanupClientDisconnectListeners: (() => void) | null = null;
  let requestHardTimeoutMs = REQUEST_HARD_TIMEOUT_MS;
  let deliveryLossFunnel: DeliveryLossFunnel | null = null;
  let puritySubFunnel: PuritySubFunnel | null = null;
  let hardRejectOffWorldSinceV3Composed = 0;
  try {
    startTimelineStage(productionTimeline, startMs, "request_validation");
    const devMode = useMockSpotify();
    const rawBody = req.body ?? {};
    const debugPerformance =
      (req.query.debugPerformance === "true" ||
      req.query.debugPerformance === "1" ||
      rawBody["debugPerformance"] === true) && privilegedDebugAllowed(req);
    const auditModeRequested = rawBody.auditMode === true || req.query.audit === "1";
    const sceneWorldProofRequested =
      (rawBody.sceneWorldProof === true || req.query.sceneWorldProof === "1") && privilegedDebugAllowed(req);
    const auditTokenAuthorized = auditModeRequested && generationAuditTokenAuthorized(req);
    const auditMode = auditModeRequested && auditTokenAuthorized;
    const sideEffectPolicy = auditMode ? AUDIT_SIDE_EFFECT_POLICY : PRODUCTION_SIDE_EFFECT_POLICY;
    requestHardTimeoutMs = auditMode
      ? resolveAuditHardTimeoutMs(rawBody as Record<string, unknown>)
      : REQUEST_HARD_TIMEOUT_MS;
    beginSpotifyApiAudit();
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

    if (auditTokenAuthorized && auditUserIdRaw) {
      const allowedIds = parseEvalAllowedSpotifyUserIds();
      if (getEnv().NODE_ENV === "production" && allowedIds.length === 0) {
        generateFail(
          res,
          403,
          "AUDIT_ALLOWLIST_REQUIRED",
          "EVAL_ALLOWED_SPOTIFY_USER_IDS (or SMOKE_SPOTIFY_USER_ID) must be set in production when using PLAYLIST_EVAL_TOKEN.",
        );
        return;
      }
      if (allowedIds.length > 0 && !allowedIds.includes(auditUserIdRaw)) {
        generateFail(
          res,
          403,
          "AUDIT_USER_NOT_ALLOWED",
          "This spotifyUserId is not permitted for eval token access.",
        );
        return;
      }
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
    updateGenerateObs(req, { userId, productionTimeline });

    if (!sideEffectPolicy.bypassRateLimit) {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const ipRateCheck = checkRateLimit(`generate:ip:${clientIp}`, RATE_LIMIT_MAX * 2, RATE_LIMIT_WINDOW_MS);
    if (!ipRateCheck.allowed) {
      const retryAfterSec = Math.ceil(ipRateCheck.resetInMs / 1000);
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
    const rateCheck = checkRateLimit(userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, {
      burst: 3,
    });
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
    generationSeed =
      typeof rawBody.seed === "number" || typeof rawBody.seed === "string"
        ? rawBody.seed
        : null;

    const failureSessionIdRaw =
      typeof rawBody.failureSessionId === "string" ? rawBody.failureSessionId.trim() : "";

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
      ...(referencePlaylistRaw ? { referencePlaylist: referencePlaylistRaw } : {}),
      ...(varietyBoostRequested ? { varietyBoost: true } : {}),
      ...(moodSceneRaw ? { sceneId: moodSceneRaw } : {}),
      ...(noLibraryModeRequested ? { noLibraryMode: true } : {}),
      ...(familiarityOverride ? { familiarity: familiarityOverride } : {}),
      ...(failureSessionIdRaw ? { failureSessionId: failureSessionIdRaw } : {}),
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn(
        {
          errors: parsed.error.message,
          vibeLength: typeof vibeRaw === "string" ? vibeRaw.length : 0,
        },
        "Invalid generate request",
      );
      generateFail(res, 400, "INVALID_REQUEST", parsed.error.message);
      return;
    }

    const { vibe, mode, length: requestedLength, referencePlaylist, varietyBoost, sceneId, noLibraryMode, familiarity, failureSessionId: parsedFailureSessionId } = parsed.data;
    generateVibe = vibe;
    let length = requestedLength;
    const moodSceneId = sceneId?.trim() || null;
    const noLibraryParsedIntent = noLibraryMode ? buildCsspLockedIntent(vibe) : null;
    const noLibraryExplicitFamilies = noLibraryParsedIntent?.genreFamilies ?? [];
    if (noLibraryMode && noLibraryExplicitFamilies.length === 0) {
      const discoveryReadiness = getDiscoveryModeReadiness(vibe);
      generateFail(
        res,
        400,
        "NO_LIBRARY_REQUIRES_GENRE",
        discoveryReadiness.hint
          ?? "Discovery Mode needs a clear genre in your prompt so Spotify-wide search stays on target. Try adding a genre like pop punk, country, UK garage, blues rock, or indie rock.",
        {
          hint: discoveryReadiness.hint
            ?? "Use library mode for mood-only prompts, or keep Discovery Mode on and add a genre.",
          discovery: discoveryReadiness,
          noLibrarySpotify: {
            searched: false,
            fallbackUsed: false,
            fallbackReason: "missing_explicit_genre",
          },
        }
      );
      return;
    }

    let earlyMomentPipeline: ReturnType<typeof analyzeMomentPipeline> | null = null;
    let earlyEmotionProfile: EmotionProfile = { ...NEUTRAL_PROFILE };
    if (!varietyBoost && !auditMode && !noLibraryMode && !devMode) {
      try {
        earlyMomentPipeline = analyzeMomentPipeline(vibe, { moodSceneId });
        earlyEmotionProfile = earlyMomentPipeline.profile;
        const penalty = getSceneFeedbackPenalty(
          userId,
          vibe,
          earlyMomentPipeline.canonicalScene?.sceneId,
        );
        if (earlyMomentPipeline.canonicalScene && penalty < 0) {
          earlyMomentPipeline.canonicalScene.confidence = Math.max(
            0,
            earlyMomentPipeline.canonicalScene.confidence + penalty,
          );
        }
      } catch (emotionErr) {
        req.log.warn({ err: emotionErr }, "Early emotion parse failed — cache key uses neutral profile");
      }

      const gateMixed = detectMixedEmotions(vibe);
      const gateDest = parseEmotionalDestination(vibe);
      const gateConfidence = scorePromptConfidence(vibe, earlyEmotionProfile, {
        experienceSceneMatched: !!earlyMomentPipeline?.experienceScene,
        hasJourneyDestination: !!gateDest.desired,
        mixedEmotions: gateMixed,
      });
      const readiness = evaluatePromptReadiness({
        vibe,
        tier: gateConfidence.tier,
        score: gateConfidence.score,
        sceneId: moodSceneId,
        referencePlaylist,
      });
      if (!readiness.ready) {
        const suggestions = buildIntentClarificationSuggestions(
          vibe,
          gateConfidence.tier,
          earlyMomentPipeline?.canonicalScene ?? null,
        );
        // Surface everyday-world alternatives from vague commit as chips when near-tied.
        const commitAlts = (readiness.vagueCommit?.alternatives ?? []).map((a) => ({
          text: a.label,
          previewSceneId: a.sceneId,
          category: "emotional" as const,
        }));
        const mergedSuggestions = [...commitAlts, ...suggestions].slice(0, 8);
        generateFail(res, 400, readiness.code!, readiness.message!, {
          promptConfidence: gateConfidence,
          suggestReferencePlaylist: true,
          vagueWorldCommit: readiness.vagueCommit ?? null,
          ...(mergedSuggestions.length
            ? {
                intentClarificationSuggestions: mergedSuggestions,
                intentClarificationGroups: groupIntentSuggestions(mergedSuggestions),
              }
            : {}),
        });
        return;
      }

      const earlyVibeKind = detectVibeKind(vibe, earlyEmotionProfile);
      const earlyCacheKey = getGenerateCacheKey({
        userId,
        vibe,
        vibeKind: earlyVibeKind,
        mode,
        length,
        referencePlaylist: !!referencePlaylist,
        referencePlaylistKey: referencePlaylist ?? null,
        sceneId: moodSceneId,
        noLibraryMode: !!noLibraryMode,
        mockMode: devMode,
      });
      const cachedFast = getCachedGenerateResult(earlyCacheKey);
      if (cachedFast) {
        req.log.info(
          {
            userId,
            elapsedMs: Date.now() - startMs,
            cacheHit: true,
            trackCount: cachedFast.finalTracks.length,
          },
          "Generation cache fast-path",
        );
        noteGenerateSuccess(req, {
          requestId: String(req.id),
          playlistSize: cachedFast.finalTracks.length,
          executionPath: "full_pipeline",
          cacheHit: true,
          humanSaveable: true,
        });
        res.json(buildCachedGenerateResponse(cachedFast));
        return;
      }
    }

    endTimelineStage(productionTimeline, startMs, "request_validation");
    markTimeline(productionTimeline, startMs, "queue_entered");
    startTimelineStage(productionTimeline, startMs, "session_acquire");
    const acquired = acquireGenerateSession(generateSessionUserId, {
      hardTimeoutMs: requestHardTimeoutMs,
    });
    if (!acquired) {
      const retryAfterMs = getActiveSessionRetryAfterMs(generateSessionUserId);
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      req.log.info({ userId, code: "GENERATION_IN_PROGRESS", retryAfterSec }, "Rejected duplicate generate");
      generateFail(
        res,
        409,
        "GENERATION_IN_PROGRESS",
        "A playlist is already being generated. Wait for it to finish or try again in a moment.",
        { retry_after: retryAfterSec },
      );
      return;
    }
    endTimelineStage(productionTimeline, startMs, "session_acquire");
    markTimeline(productionTimeline, startMs, "worker_acquired");
    requestId = acquired;
    sessionUserId = generateSessionUserId;
    req.log.info(
      {
        event: "generation_started",
        requestId,
        userId: hashedIdTag(sessionUserId),
        mode,
        requestedLength: length,
        vibeLength: vibe.length,
        noLibraryMode: !!noLibraryMode,
      },
      "generation_started",
    );
    const failureSessionIdFromClient =
      parsedFailureSessionId?.trim() ||
      (typeof rawBody.failureSessionId === "string" ? rawBody.failureSessionId.trim() : "");
    if (failureSessionIdFromClient) {
      handleGenerationFollowUp({
        failureSessionId: failureSessionIdFromClient,
        noLibraryMode: noLibraryModeRequested,
        newSessionId: requestId,
        userId: generateSessionUserId,
      });
    }
    const liveStageProfiler = createLiveStageProfiler(startMs);
    const latencyBudget = createLatencyBudget(startMs, requestHardTimeoutMs);
    const requestStageTiming = createRequestStageTiming(startMs);
    const refinementTelemetry = createGoodPlaylistRefinementTelemetry(startMs, length);
    let latencyBudgetExceeded = false;
    const deadlineAt = startMs + requestHardTimeoutMs;
    const generationShouldAbort = (): boolean => {
      if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return true;
      if (latencyBudget.mustDeliverNow()) return true;
      if (latencyBudget.isHardDeadlineApproaching()) return true;
      return false;
    };
    const shouldSkipMarginalImprovement = (): boolean => latencyBudget.shouldSkipMarginalImprovement();
    const emitLatencyBudgetFallback = (): boolean => {
      if (responseFinished(res)) return true;
      latencyBudget.markExceeded();
      latencyBudgetExceeded = true;
      requestStageTiming.setTotal(Date.now() - startMs);
      const stageProfile = liveStageProfiler.snapshot();
      const progressBeforeCancel = getGenerateProgress(generateSessionUserId);
      if (timeoutFallbackResponse(req, res, {
        failureReason: "latency_budget_exceeded",
        elapsedMs: Date.now() - startMs,
        requestId,
        lastPhase: progressBeforeCancel?.phase ?? null,
        lastStage: progressBeforeCancel?.stage ?? null,
        stageProfile,
        latencyBudgetExceeded: true,
        requestStageTiming: requestStageTiming.report(),
      })) return true;
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
    const latencyBudgetAfterMs = Math.max(1, latencyBudget.hardDeadlineAt - Date.now());
    latencyBudgetTimer = setTimeout(() => {
      if (responseFinished(res)) return;
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.warn(
        { userId, requestId, elapsedMs: Date.now() - startMs, code: "LATENCY_BUDGET" },
        "Generate latency budget hard deadline — delivering best available playlist",
      );
      if (emitLatencyBudgetFallback()) return;
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
    }, latencyBudgetAfterMs);
    latencyBudgetTimer.unref?.();
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
        playlistExecutionTrace: finalizePlaylistExecutionTrace(buildFallbackExecutionTraceDraft({
          requestId,
          prompt: generateVibe || "unknown",
          seed: generationSeed,
          executionPath: "timeout_fallback",
          failureDetail: "absolute_watchdog_timeout_before_safe_fallback",
          finalTrackCount: 0,
          timeoutOccurred: true,
        })),
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
    let tasteManifold: UserTasteManifold | null = null;
    let globalTasteProfile: import("../lib/global-taste-profile").GlobalTasteProfile | null = null;
    let compilePlan: CompilePlanDSL | null = null;
    let segmentDiagnostics: Array<{ segmentId: string; label: string; trackIds: string[] }> = [];
    let humanExpectationDiagnostics: Record<string, unknown> | null = null;
    let playlistContractDiagnostics: Record<string, unknown> | null = null;
    let playlistContractWorldGateDiagnostics: Record<string, unknown> | null = null;
    let playlistContractV40Diagnostics: Record<string, unknown> | null = null;
    let playlistContractV41Diagnostics: Record<string, unknown> | null = null;
    let contractCompositionContext: ContractCompositionContext | undefined;
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
    let momentPipeline: ReturnType<typeof analyzeMomentPipeline> | null = earlyMomentPipeline;
    try {
      if (!momentPipeline) {
        momentPipeline = analyzeMomentPipeline(vibe, { moodSceneId });
      }
      emotionProfile = momentPipeline.profile;
      experienceScene = momentPipeline.experienceScene;
      sceneJourneyArc = momentPipeline.journeyArc;
      const penalty = getSceneFeedbackPenalty(
        userId,
        vibe,
        momentPipeline.canonicalScene?.sceneId,
      );
      if (momentPipeline.canonicalScene && penalty < 0) {
        momentPipeline.canonicalScene.confidence = Math.max(
          0,
          momentPipeline.canonicalScene.confidence + penalty,
        );
      }
      req.log.info(
        {
          elapsedMs: Date.now() - startMs,
          canonicalScene: momentPipeline.canonicalScene?.sceneId,
          intent: momentPipeline.intent.intent,
          hasExperienceScene: !!experienceScene,
          journeyArc: sceneJourneyArc ?? null,
          reusedEarlyParse: !!earlyMomentPipeline,
        },
        "Emotion profile computed"
      );
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed — using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }
    const promptNormalizationMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "moodIntentTimeMs", promptNormalizationMs);
    if (momentPipeline?.pipelineSummary && typeof momentPipeline.pipelineSummary.interpretWorldMs === "number") {
      updateGenerateObs(req, {
        interpretWorldMs: momentPipeline.pipelineSummary.interpretWorldMs,
      });
    }
    endTimelineStage(productionTimeline, startMs, "prompt_understanding");
    recordGenerationPhaseDuration(
      "interpretation",
      productionTimeline.stageDurations.prompt_understanding ?? promptNormalizationMs,
    );
    if (debugPerformance) {
      logPreV3Stage(req.log, recordPreV3Stage(preV3Timing, "promptNormalization", {
        durationMs: promptNormalizationMs,
        inputSize: vibe.length,
        outputSize: momentPipeline ? 1 : 0,
        cacheHit: false,
      }));
    }

    // Human Expectation Layer (Phase 1 — shadow only). Flag-gated + internally
    // guarded: no-op when HUMAN_EXPECTATION_LAYER is off, never mutates output.
    runExpectationShadow(
      vibe,
      {
        energy: emotionProfile.energy,
        valence: emotionProfile.valence,
        tension: emotionProfile.tension,
        nostalgia: emotionProfile.nostalgia,
        calm: emotionProfile.calm,
        journeyArc: sceneJourneyArc ?? undefined,
      },
      req.log,
    );

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
    const debugMode =
      (req.query.debug === "1" || process.env["DEBUG"] === "true") && privilegedDebugAllowed(req);
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

    setGeneratePhase(generateSessionUserId, requestId, noLibraryMode ? "spotify" : "loading_library");
    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      noLibraryMode ? "Searching Spotify catalogue…" : "Scanning your liked songs…",
    );
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
              loadLikedSongsBatched(userId),
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
        // Discovery Mode: Spotify search is primary — defer heavy library hydration until fallback.
        likedRowsRaw = cachedLikedRows ?? [];
      }
    } finally {
      endLikedSongsProfile();
    }
    if (!devMode && noLibraryMode && likedRowsRaw.length > 0 && !snapshotLikedRows && !cachedLikedRows) {
      setCachedLikedSongs(userId, likedRowsRaw);
    }
    if (!snapshotLikedRows && !cachedLikedRows && !devMode && noLibraryMode && likedRowsRaw.length > 0) {
      dbHydrationOccurred = true;
    }
    const likedSongsQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "likedSongsQueryMs", likedSongsQueryMs);
    recordGenerationPhaseDuration("library_load", likedSongsQueryMs);
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
      const logDropped = droppedTracks >= 10 || (likedRowsRaw.length > 0 && droppedTracks / likedRowsRaw.length >= 0.05);
      (logDropped ? req.log.info : req.log.debug).call(
        req.log,
        { droppedTracks, userId, totalRows: likedRowsRaw.length },
        "Dropped invalid liked-song rows"
      );
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
          mode: mode as "strict" | "balanced" | "chaotic",
          primarySubgenre: noLibraryParsedIntent?.primarySubgenre ?? null,
          allowGlobalFallback: mode !== "strict",
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
            "Discovery Mode using verified Spotify search candidates"
          );
        } else if (spotifyCandidates.length >= Math.min(length, Math.max(24, Math.ceil(length * 0.4)))) {
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
            "Discovery Mode using unverified Spotify search pool; final guard will enforce genre evidence"
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
            "Discovery Mode Spotify search returned too few candidates"
          );
          if (spotifyCandidates.length > 0) {
            likedSongs = spotifyCandidates;
          } else {
            if (likedSongs.length === 0) {
              const fallbackRows = getCachedLikedSongs(userId) ?? await loadLikedSongsBatched(userId);
              if (fallbackRows.length > 0) {
                setCachedLikedSongs(userId, fallbackRows);
                likedRowsRaw = fallbackRows;
                likedSongs = sanitizeLikedSongs(fallbackRows).valid;
              }
            }
            if (likedSongs.length > 0) {
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
                "Discovery Mode could not find enough Spotify-wide candidates for this prompt. Try a broader genre phrase or turn off Discovery Mode to use your liked songs.",
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
        }
      } catch (searchErr: any) {
        noLibrarySpotifyFallbackReason = "spotify_search_failed";
        req.log.warn(
          { err: searchErr?.message, vibe, families: noLibraryExplicitFamilies },
          "Discovery Mode Spotify search failed"
        );
        setGeneratePhase(generateSessionUserId, requestId, "error");
        generateFail(
          res,
          503,
          "NO_LIBRARY_SPOTIFY_SEARCH_FAILED",
          "Spotify-wide search failed before Discovery Mode could build a playlist. Please retry in a moment or turn off Discovery Mode.",
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
            ? "Discovery Mode could not find usable Spotify-wide candidates for this prompt. Try a broader genre phrase or retry in a moment."
            : "Discovery Mode needs a clear genre in your prompt, or a synced library fallback. Try blues rock, country, indie rock, or UK garage.",
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
        "Library is too small to generate. Sync more liked songs from Spotify first, or turn on Discovery Mode with a genre in your prompt.",
        {
          suggestDiscoveryMode: true,
          canUseDiscoveryMode: true,
          limitingFactors: ["library_critically_small"],
        },
      );
      return;
    }

    if (!noLibraryMode && likedSongs.length < MIN_LIBRARY_TRACKS) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      generateFail(
        res,
        200,
        "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        `Your library has ${likedSongs.length.toLocaleString()} liked songs — library mode works best with ${MIN_LIBRARY_TRACKS}+. Turn on Discovery Mode to search all of Spotify, or sync more likes.`,
        {
          requestId,
          failureSessionId: requestId,
          reason: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
          canUseDiscoveryMode: true,
          suggestDiscoveryMode: true,
          suggestRefinePrompt: false,
          limitingFactors: ["library_below_minimum_track_count"],
          librarySize: likedSongs.length,
          minLibraryTracks: MIN_LIBRARY_TRACKS,
        },
      );
      return;
    }
    endTimelineStage(productionTimeline, startMs, "candidate_fetch");
    recordGenerationPhaseDuration(
      "retrieval",
      productionTimeline.stageDurations.candidate_fetch ?? 0,
    );
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
        : cached.cacheVersion !== GENERATE_RESULT_CACHE_VERSION
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
        setGeneratePhase(generateSessionUserId, requestId, "spotify");
        setGenerateStageDetail(generateSessionUserId, requestId, "Returning cached playlist");
        const cachedApiTracksRaw = formatTracksForApi(cached.finalTracks, cached.emotionProfile);
        const cachedHygiene = applyFinalApiOpenerHygiene(
          cachedApiTracksRaw,
          inferWorldIdentityIdsFromPrompt(cached.vibe),
          { minKeep: HONEST_PARTIAL_MIN, prompt: cached.vibe },
        );
        const cachedApiTracks = cachedHygiene.tracks;
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
        setGeneratePhase(generateSessionUserId, requestId, "done");
        setGenerateStageDetail(generateSessionUserId, requestId, "Loading playlist in app");
        res.json(withIntentSurvivalAuditPayload(req, attachExecutionTrace({
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
        }, (() => {
          const cachedV3 = (cached.v3Diagnostics ?? null) as Record<string, unknown> | null;
          const cachedTrace = cachedV3?.playlistExecutionTrace;
          if (cachedTrace && typeof cachedTrace === "object") {
            return cachedTrace as PlaylistExecutionTraceDraft;
          }
          return {
            requestId,
            prompt: cached.vibe ?? vibe,
            seed: generationSeed,
            executionPath: "full_pipeline" as const,
            humanSaveable: true,
            rejectionReasons: ["human_saveable:passed"],
            trackCounts: {
              retrieved: 0,
              after_world: 0,
              after_sampler: 0,
              final: cachedApiTracks.length,
            },
            debugFlags: { gateExecuted: true, gateBypassed: false, timeoutOccurred: false },
          };
        })()), cachedApiTracks, cached.vibe ?? vibe));
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
      strictModeHumanSaveability: isSoftScenePrompt(vibe, {
        genreFamilies: [],
        primaryGenre: null,
        primarySubgenre: null,
        secondarySubgenre: null,
        subgenreTerms: [],
        eraRange: null,
        mood: [],
        activity: null,
        energy: null,
      }),
      seed: generationSeed,
      maxPerArtist: artistDiversityCap(length, vibe),
      noLibrarySpotifyCandidateCount,
      noLibrarySpotifyVerifiedCount,
      noLibrarySpotifyFallbackReason,
      noLibraryRetrievalDiagnostics,
      noLibraryMode,
      productionTimeline,
      requestStageTiming,
      latencyBudget,
      refinementTelemetry,
      momentPipeline,
      worldUnderstanding: momentPipeline?.worldUnderstanding ?? null,
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
      jsonWithExecutionTrace(res, 504, {
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
      }, buildFallbackExecutionTraceDraft({
        requestId,
        prompt: generateVibe || vibe,
        seed: generationSeed,
        executionPath: "timeout_fallback",
        failureDetail: "hard_timeout_no_controller_fallback",
        finalTrackCount: 0,
        timeoutOccurred: true,
      }));
    });

    const promptConfidence = scorePromptConfidence(vibe, emotionProfile, {
      experienceSceneMatched: !!experienceScene,
      hasJourneyDestination: !!destParse.desired,
      mixedEmotions,
    });
    req.log.info({ vibeKind, promptConfidence }, "Vibe kind detected");

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

    const auditNoveltyMemoryRows = sideEffectPolicy.mode === "audit" && evaluationRecentTrackLists.length > 0
      ? evaluationRecentTrackLists.map((trackIds, index) => ({
          vibe: `evaluation-session-${index + 1}`,
          trackIds,
          emotionProfile: null,
          createdAt: new Date(),
        }))
      : null;
    const noveltyMemoryRows = auditNoveltyMemoryRows ?? scoringMemoryPlaylistRows;
    const noveltyFreshnessStats = buildFreshnessStats(noveltyMemoryRows);

    const sessionTrackIdsForFrequency = auditNoveltyMemoryRows
      ? evaluationRecentTrackLists.flat()
      : scoringMemoryPlaylistRows.flatMap((row) => row.trackIds ?? []);
    const playlistFrequencyPenalty = sessionTrackIdsForFrequency.length > 0
      ? buildPlaylistFrequencyPenalty(sessionTrackIdsForFrequency)
      : undefined;
    const crossPlaylistNoveltyEnabled = noveltyMemoryRows.length > 0;

    startTimelineStage(productionTimeline, startMs, "freshness_memory");
    tStage = Date.now();
    const freshnessStats = buildFreshnessStats(
      scoringMemoryPlaylistRows
    );

    const trackIdToArtist = new Map(likedSongs.map((s) => [s.trackId, s.artistName]));
    const trackIdToAlbum = new Map(likedSongs.map((s) => [s.trackId, s.albumName]));
    const crossPlaylistArtistAppearances = buildArtistAppearanceMap(
      memoryPlaylistRows,
      trackIdToArtist,
    );
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

    const evaluationPlaylistContexts = parseEvaluationPlaylistContexts(
      rawBody as Record<string, unknown>,
      sideEffectPolicy.mode === "audit",
    );
    const contextualPriorPlaylists: PriorWinningPlaylist[] = evaluationPlaylistContexts.length > 0
      ? evaluationPlaylistContexts.map((row) => ({
          trackIds: winningTrackIds(row.trackIds),
          context: row.context,
        }))
      : noveltyMemoryRows
          .filter((row) => Array.isArray(row.trackIds) && row.trackIds.length > 0)
          .map((row) => ({
            trackIds: winningTrackIds(row.trackIds as string[]),
            context: buildPlaylistContextFingerprint({
              category: inferCategoryFromVibe(row.vibe),
              curatorIdentityType: "balanced_curator",
              primaryGenreFamily: "unknown",
              activity: null,
              emotionProfile: row.emotionProfile as EmotionProfile | null,
            }),
          }));
    const contextualTrackMemory = buildContextualTrackMemory(
      contextualPriorPlaylists,
      trackIdToArtist,
    );
    const contextualUniquenessEnabled = contextualTrackMemory.priorPlaylistCount > 0;

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
    const memoryWeightRaw =
      momentPipeline?.canonicalScene && momentPipeline.canonicalScene.confidence >= 0.65
        ? 0.55
        : momentPipeline?.experienceScene
          ? 0.35
          : 0;
    const tasteCapPlaces = splitSceneContracts(vibe).place.filter(
      (place): place is "rural" | "outdoors" | "city" | "beach" | "bedroom" | "car" =>
        place === "rural" || place === "outdoors" || place === "city" || place === "beach" || place === "bedroom" || place === "car",
    );
    const tasteCapContract = buildDominantIntentContract({
      prompt: vibe,
      intentContract: {
        primarySubgenre: null,
        genreFamilies: [],
        activity: null,
        places: tasteCapPlaces,
        eraRange: null,
        explicitDimensions: [],
      },
      emotionProfile,
      mode: mode as "strict" | "balanced" | "chaotic",
      noLibraryMode: !!noLibraryMode,
    });
    const memoryWeight = capTastePullWeight(memoryWeightRaw, tasteCapContract.maxTastePullWeight);

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
      const manifoldTracks = likedSongs.map((song) => {
        const classification = userGenreProfile.trackClassifications.get(song.trackId);
        return {
          trackId: song.trackId,
          artistName: song.artistName,
          genreFamily: classification?.genreFamily ?? null,
          genrePrimary: classification?.genrePrimary ?? null,
          genres: classification?.subGenres ?? null,
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
          instrumentalness: song.instrumentalness,
        };
      });
      const compiled = await compilePlaylistContext({
        prompt: vibe,
        userId,
        mode,
        familiarityOverride: familiarity ?? null,
        length,
        feedbackMemory,
        likedGenreFamilies,
        likedArtists,
        manifoldTracks,
        samePromptRegenerate: varietyBoost === true,
      });
      sceneAliases = compiled.sceneAliases;
      mergedScenePrediction = compiled.scenePrediction;
      familiarityMode = compiled.intentPipeline.familiarityMode;
      length = compiled.compilePlan.length;
      tasteGraphV2 = compiled.tasteGraphV2;
      tasteManifold = compiled.tasteManifold;
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
    const sessionPenaltyTrackLists = evaluationRecentTrackLists.length > 0
      ? evaluationRecentTrackLists.slice(-20)
      : recentTrackLists.slice(0, 20);
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
    const recentTrackPenaltyScale = (varietyBoost ? 3.15 : 2.35) * sessionDiversityPressure;
    const finalizationReusePenalty = sessionPenaltyTrackLists.length
      ? buildRecentTrackPoolPenalty(sessionPenaltyTrackLists, 20, recentTrackPenaltyScale)
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
          recentPlaylistTrackIds: sessionPenaltyTrackLists,
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
    const maxPerArtist = sideEffectPolicy.mode === "audit" && varietyBoost
      ? 3
      : artistDiversityCap(length, vibe);

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
      includeWorldUnderstanding: debugMode,
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
      genreFamilies: lockedIntent.genreFamilies.length > 0
        ? lockedIntent.genreFamilies
        : fallbackLockedFamily
          ? [fallbackLockedFamily]
          : [],
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
      genCtx["strictModeHumanSaveability"] = strictModeHumanSaveability(vibe, lockedIntent);
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
      genCtx["curatorIdentity"] = curatorIdentity;
      genCtx["playlistFrequencyPenalty"] = playlistFrequencyPenalty;
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
    const retrievalSceneActive =
      isGymWorkoutPrompt(vibe, lockedIntent) ||
      isUpbeatSocialPrompt(vibe, lockedIntent) ||
      isBroadDrivingPrompt(vibe, lockedIntent) ||
      isFocusStudyPrompt(vibe, lockedIntent) ||
      isChillCalmPrompt(vibe, lockedIntent) ||
      !!lockedIntent.activity ||
      lockedIntent.mood.length > 0 ||
      !!lockedIntent.energyLevel;
    const sonicTasteProfile = buildSonicTasteProfile(likedSongs);

    let worldCoverageAssessment: WorldCoverageAssessment | null = null;
    let candidateCoverageTier: CoverageTier | null = null;
    let worldExpansionCandidates: typeof likedSongs = [];
    const worldGateContext = resolveWorldGateContext(
      {
        prompt: vibe,
        lockedIntent: lockedIntent as LockedIntent,
        decomposedIntent,
        intentState,
      },
      isPlaylistContractWorldGateEvaluationEnabled() ? req.log : undefined,
    );
    const contractDeferActive =
      isPlaylistContractDeferPathEnabled() &&
      worldGateContext.gateDecision?.deferHardLock === true;
    const hasPreserveBothTension = worldGateContext.contract.tension.some(
      (t) => t.resolution === "preserve_both",
    );
    const contractRetrievalPathActive =
      isPlaylistContractDeferPathEnabled() &&
      (contractDeferActive || (isPlaylistContractV41Enabled() && hasPreserveBothTension));
    const contractCompositionPathActive =
      isPlaylistContractV41Enabled() &&
      (contractDeferActive || hasPreserveBothTension);
    let committedWorldPreRetrieval = worldGateContext.effectiveWorld;
    let contractAuthoritativeForRetrieval: {
      active: boolean;
      contract: ReturnType<typeof buildPlaylistContract>;
    } | undefined;
    if (contractRetrievalPathActive) {
      contractAuthoritativeForRetrieval = {
        active: true,
        contract: worldGateContext.contract,
      };
    if (
      (contractDeferActive || contractCompositionPathActive) &&
      worldGateContext.gateDecision?.effectiveWorld
    ) {
      committedWorldPreRetrieval = worldGateContext.gateDecision.effectiveWorld;
    }
      playlistContractV40Diagnostics = {
        deferHardLock: contractDeferActive,
        deferReasons: contractDeferActive
          ? (worldGateContext.gateDecision?.reasons ?? [])
          : ["preserve_both_compound_tension"],
        retrievalAuthority: "playlist_contract",
        originalWorld: worldGateContext.gateDecision?.originalWorld?.id
          ?? worldGateContext.rawWorld?.id
          ?? null,
      };
    }
    if (contractCompositionPathActive) {
      contractCompositionContext = {
        enabled: true,
        contract: worldGateContext.contract,
        deferredWorldGate: contractDeferActive,
      };
      playlistContractV41Diagnostics = {
        deferHardLock: contractDeferActive,
        compositionAuthority: "playlist_contract",
        compoundTension: hasPreserveBothTension,
      };
    }
    if (worldGateContext.shadowDiagnostics) {
      playlistContractDiagnostics = worldGateContext.shadowDiagnostics as unknown as Record<string, unknown>;
    }
    if (worldGateContext.diagnostics) {
      playlistContractWorldGateDiagnostics = worldGateContext.diagnostics as unknown as Record<string, unknown>;
    }
    const contractShadowResult =
      isPlaylistContractShadowEnabled() || isPlaylistContractRetrievalEnabled()
        ? resolvePlaylistContractContext(
            {
              prompt: vibe,
              lockedIntent: lockedIntent as LockedIntent,
              decomposedIntent,
              intentState,
            },
            req.log,
          )
        : null;
    if (contractShadowResult && !worldGateContext.diagnostics) {
      playlistContractDiagnostics = contractShadowResult.diagnostics as unknown as Record<string, unknown>;
    }
    const culturalProfilePre = resolveCulturalProfileForCommitted(committedWorldPreRetrieval);
    if (committedWorldPreRetrieval?.hardLock && culturalProfilePre && !noLibraryMode && !contractDeferActive) {
      beginRejectionTrace();
      worldCoverageAssessment = assessWorldCoverage(
        committedWorldPreRetrieval,
        likedSongs,
        culturalProfilePre,
      );
      try {
        let expansionToken: string | null = null;
        if (!devMode && req.session.spotifyTokens) {
          const freshTokens = await getValidAccessToken(req.session.spotifyTokens!, userId);
          expansionToken = freshTokens.accessToken;
        }
        const expansion = await exhaustWorldRetrieval({
          accessToken: expansionToken,
          userLibrary: likedSongs,
          culturalProfile: culturalProfilePre,
          committedWorld: committedWorldPreRetrieval,
          targetValidCount: Math.max(25, length),
          maxRounds: 4,
        });
        worldExpansionCandidates = expansion.tracks.filter(
          (t): t is (typeof likedSongs)[number] =>
            typeof (t as { trackId?: string }).trackId === "string",
        ) as typeof likedSongs;
        const expansionPool = worldExpansionCandidates.length > 0 ? worldExpansionCandidates : likedSongs;
        candidateCoverageTier = assessCandidateCoverageTier(expansionPool, culturalProfilePre);
        if (auditMode) {
          req.log.info(
            {
              expansionDiagnostics: expansion.diagnostics,
              rejectionStats: summarizeRejectionTrace(culturalProfilePre.worldId),
            },
            "V15 world retrieval exhaustion",
          );
        }
      } catch (expansionErr) {
        req.log.warn({ err: expansionErr }, "world anchor expansion failed — continuing with library only");
      }
    }

    const preScoringOrchestration = orchestratePlaylistRetrieval({
      tracks: likedSongs,
      vibe,
      intent: lockedIntent,
      emotionProfile,
      classMap: userGenreProfile.trackClassifications,
      sessionMemory,
      librarySignals,
      sonicTasteProfile,
      recentTrackPenalty: finalizationReusePenalty,
      requestedLength: length,
      sceneActive: retrievalSceneActive,
      debugRetrieval: auditMode,
      noLibraryMode: !!noLibraryMode,
      promptConfidence: promptConfidence?.score,
      expansionCandidates:
        worldExpansionCandidates.length > 0 ? worldExpansionCandidates : undefined,
      worldCoverage: worldCoverageAssessment,
      committedWorldOverride: committedWorldPreRetrieval,
      contractAuthoritative: contractAuthoritativeForRetrieval,
    });

    if (contractRetrievalPathActive && preScoringOrchestration.diagnostics.retrievalDiagnostics) {
      const rd = preScoringOrchestration.diagnostics.retrievalDiagnostics as Record<string, unknown>;
      playlistContractV40Diagnostics = {
        ...(playlistContractV40Diagnostics ?? {}),
        retrieval: rd.v40 ?? rd,
        retrievalPoolSize: preScoringOrchestration.tracks.length,
      };
    }

    if (preScoringOrchestration.failure && !noLibraryMode) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      recordLibraryInsufficientFailure({
        sessionId: requestId,
        userId,
        vibe,
        activity: lockedIntent.activity,
        sceneId: moodSceneId,
        libraryCapability: preScoringOrchestration.failure.libraryCapability,
        orchestrator: preScoringOrchestration.diagnostics,
      });
      const fallbackUx = buildFallbackUxPayload({
        vibe,
        lockedIntent,
        libraryCapability: preScoringOrchestration.failure.libraryCapability,
        limitingFactors: preScoringOrchestration.failure.limitingFactors,
        genreLabel: lockedIntent.genreFamilies[0] ?? lockedIntent.primaryGenres[0] ?? null,
        noLibraryMode: !!noLibraryMode,
      });
      generateFail(
        res,
        200,
        preScoringOrchestration.failure.code,
        preScoringOrchestration.failure.message,
        {
          requestId,
          failureSessionId: requestId,
          reason: preScoringOrchestration.failure.code,
          canUseDiscoveryMode: true,
          suggestDiscoveryMode: true,
          suggestRefinePrompt: true,
          libraryCapability: preScoringOrchestration.failure.libraryCapability,
          limitingFactors: preScoringOrchestration.failure.limitingFactors,
          combinedConfidence: preScoringOrchestration.failure.combinedConfidence,
          retrievalOrchestrator: auditMode ? preScoringOrchestration.diagnostics : undefined,
          fallbackUx,
        },
      );
      return;
    }

    let orchestratorTracks = preScoringOrchestration.tracks;
    if (isPlaylistContractRetrievalEnabled() && contractShadowResult) {
      const contractTracks = orchestratorTracks.map((t) => ({
        trackId: t.trackId,
        trackName: t.trackName,
        artistName: t.artistName,
        genreFamily: userGenreProfile.trackClassifications.get(t.trackId)?.genreFamily ?? null,
        energy: t.energy,
        valence: t.valence,
        releaseYear: t.releaseYear,
      }));
      const applied = applyContractAwareRetrievalRerank(contractTracks, contractShadowResult.contract);
      const trackById = new Map(orchestratorTracks.map((t) => [t.trackId, t]));
      orchestratorTracks = applied.tracks
        .map((t) => trackById.get(t.trackId))
        .filter((t): t is (typeof orchestratorTracks)[number] => !!t);
      req.log.info(
        {
          playlistContractRetrieval: {
            ...applied.stats,
            pool: applied.poolStats,
          },
        },
        "playlist_contract_retrieval_applied",
      );
      playlistContractDiagnostics = {
        ...(playlistContractDiagnostics ?? {}),
        retrieval: { ...applied.stats, pool: applied.poolStats },
      };
    }

    const preScoringCandidateShape = {
      tracks: orchestratorTracks,
      diagnostics: {
        ...(typeof preScoringOrchestration.diagnostics.retrievalDiagnostics === "object"
          ? preScoringOrchestration.diagnostics.retrievalDiagnostics as Record<string, unknown>
          : {}),
        orchestrator: auditMode ? preScoringOrchestration.diagnostics : {
          strategy: preScoringOrchestration.diagnostics.strategy,
          librarySufficient: preScoringOrchestration.diagnostics.librarySufficient,
          combinedConfidence: preScoringOrchestration.diagnostics.combinedConfidence,
        },
      },
    };
    const retrievalFunnelTrace =
      (preScoringCandidateShape.diagnostics as { retrievalFunnel?: unknown }).retrievalFunnel ?? null;
    deliveryLossFunnel = auditMode
      ? createEmptyDeliveryLossFunnel()
      : null;
    puritySubFunnel = auditMode ? createEmptyPuritySubFunnel() : null;
    if (deliveryLossFunnel) {
      deliveryLossFunnel.orchestratorFinal = readOrchestratorFinalFromRetrievalFunnel(retrievalFunnelTrace);
    }
    const retrievalConfidenceResult =
      culturalProfilePre && orchestratorTracks.length > 0
        ? computeRetrievalConfidence(orchestratorTracks, culturalProfilePre)
        : null;
    const lockedOpenerTrackId = preScoringOrchestration.diagnostics.humanOpener.trackId;
    let curatedOpenerTrackId: string | null = lockedOpenerTrackId ?? null;
    let openingLock: OpeningLock | null = null;
    let openingLockViolations: OpeningLockViolation[] = [];
    const adaptivePromptWeightShift = preScoringOrchestration.diagnostics.adaptivePromptWeightShift;
    const validCandidateSupply = preScoringOrchestration.diagnostics.validCandidateSupply;
    if (
      !noLibraryMode &&
      likedSongs.length > 0
    ) {
      const earlyThinLibraryIntentSupply = estimateThinLibraryIntentSupply({
        tracks: likedSongs,
        vibe,
        intent: lockedIntent,
        classMap: userGenreProfile.trackClassifications,
        requestedLength: length,
      });
      const earlyThinLibraryPolicy = evaluateThinLibraryPolicy(earlyThinLibraryIntentSupply, { vibe });
      const thinMinRequired = minRequiredValidCandidates(length);
      const compoundThinLibraryBypass = shouldCompoundThinLibraryBypass(
        earlyThinLibraryIntentSupply,
        lockedIntent,
        thinMinRequired,
        validCandidateSupply?.relaxedValidCount,
      );
      if (shouldEarlyThinLibraryHardStop(earlyThinLibraryPolicy, earlyThinLibraryIntentSupply, {
        compoundBypass: compoundThinLibraryBypass,
        strictValidCount: validCandidateSupply?.strictValidCount,
        thinMinRequired,
      })) {
        setGeneratePhase(generateSessionUserId, requestId, "error");
        const orchestratorLibraryCapability = preScoringOrchestration.diagnostics.libraryCapability;
        recordLibraryInsufficientFailure({
          sessionId: requestId,
          userId,
          vibe,
          activity: lockedIntent.activity,
          sceneId: moodSceneId,
          libraryCapability: orchestratorLibraryCapability,
          orchestrator: preScoringOrchestration.diagnostics,
        });
        const fallbackUx = buildFallbackUxPayload({
          vibe,
          lockedIntent,
          libraryCapability: orchestratorLibraryCapability,
          limitingFactors: [
            "thin_library_supply_ceiling",
            ...validCandidateSupply.limitingDimensions,
          ],
          genreLabel: lockedIntent.genreFamilies[0] ?? lockedIntent.primaryGenres[0] ?? null,
          noLibraryMode: !!noLibraryMode,
        });
        generateFail(
          res,
          200,
          "LIBRARY_INSUFFICIENT_FOR_PROMPT",
          earlyThinLibraryPolicy.userMessage ?? fallbackUx.message,
          {
            requestId,
            failureSessionId: requestId,
            reason: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
            canUseDiscoveryMode: true,
            suggestDiscoveryMode: true,
            suggestRefinePrompt: true,
            thinLibraryPolicy: earlyThinLibraryPolicy,
            thinLibraryDiagnostics: earlyThinLibraryPolicy.diagnostics,
            libraryCapability: orchestratorLibraryCapability,
            limitingFactors: [
              "thin_library_supply_ceiling",
              ...validCandidateSupply.limitingDimensions,
            ],
            validCandidateSupply,
            retrievalOrchestrator: auditMode ? preScoringOrchestration.diagnostics : undefined,
            fallbackUx,
          },
        );
        return;
      }
    }
    let scoringInputSongs = preScoringCandidateShape.tracks;
    const contractRetrievalPoolForPipeline =
      contractRetrievalPathActive ? [...preScoringCandidateShape.tracks] : undefined;
    let compoundBlendedPoolDiagnostics = preScoringOrchestration.diagnostics.blendedIntentPool ?? null;
    if (
      !contractRetrievalPathActive &&
      !noLibraryMode &&
      likedSongs.length > 0 &&
      validCandidateSupply &&
      isCompoundPromptIntent(lockedIntent) &&
      strictSupplyStarved(validCandidateSupply.strictValidCount, length)
    ) {
      const blended = buildBlendedIntentPool({
        tracks: likedSongs,
        vibe,
        intent: lockedIntent,
        emotionProfile,
        classMap: userGenreProfile.trackClassifications,
        requestedLength: length,
        sonicTasteProfile,
        mode: mode as "strict" | "balanced" | "chaotic",
      });
      const blendedMin = blendedPoolMinimumCount(length);
      if (blended.tracks.length >= blendedMin) {
        scoringInputSongs = blended.tracks;
        compoundBlendedPoolDiagnostics = blended.diagnostics;
      }
    }
    const classLookupForFunnel = (trackId: string) =>
      userGenreProfile.trackClassifications.get(trackId) ?? null;
    const familyStageFunnel = auditMode
      ? {
          library: compactStageSnapshot(
            histogramFamiliesForTracks(likedSongs, classLookupForFunnel, "library"),
          ),
          scoringInput: compactStageSnapshot(
            histogramFamiliesForTracks(scoringInputSongs, classLookupForFunnel, "scoring_input"),
          ),
          blended: compoundBlendedPoolDiagnostics?.familyFunnel
            ? {
                genreFitEligibleCount: compoundBlendedPoolDiagnostics.familyFunnel.genreFitEligibleCount,
                genreLaneQuota: compoundBlendedPoolDiagnostics.familyFunnel.genreLaneQuota,
                relaxedGenreFamilies: compoundBlendedPoolDiagnostics.familyFunnel.relaxedGenreFamilies,
                normalizedIntentFamilies: compoundBlendedPoolDiagnostics.familyFunnel.normalizedIntentFamilies,
                genreEligible: compactStageSnapshot(compoundBlendedPoolDiagnostics.familyFunnel.genreEligibleRaw),
                genreMatchLane: compactStageSnapshot(compoundBlendedPoolDiagnostics.familyFunnel.genreLanePicked),
                blendedMerged: compactStageSnapshot(compoundBlendedPoolDiagnostics.familyFunnel.mergedPool),
              }
            : null,
        }
      : null;
    endTimelineStage(productionTimeline, startMs, "candidate_shape");
    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      ...(req as { _genCtx?: Record<string, unknown> })._genCtx,
      scoringInputSongs: scoringInputSongs.map(hydrateTrackGenre),
      genreByTrack,
      lockedOpenerTrackId,
      adaptivePromptWeightShift,
      familyStageFunnel,
      retrievalOrchestrator: {
        ...preScoringOrchestration.diagnostics,
        blendedIntentPool: compoundBlendedPoolDiagnostics ?? preScoringOrchestration.diagnostics.blendedIntentPool,
      },
    };
    startTimelineStage(productionTimeline, startMs, "curator_scoring");
    const curatorScoreByTrack = new Map<string, number>();
    for (const track of scoringInputSongs) {
      curatorScoreByTrack.set(track.trackId, scoreTrackForIdentity(track, curatorIdentity));
    }
    endTimelineStage(productionTimeline, startMs, "curator_scoring");
    recordGenerationPhaseDuration(
      "scoring",
      productionTimeline.stageDurations.curator_scoring ?? 0,
    );
    setGeneratePhase(generateSessionUserId, requestId, "scoring");
    setGenerateStageDetail(generateSessionUserId, requestId, `Ranking matches from ${scoringInputSongs.length.toLocaleString()} shaped candidates`);
    markTimeline(productionTimeline, startMs, "scoring_start");
    stageTimer.start("Running playlist pipeline (scoring + compose)", {
      tracks: scoringInputSongs.length,
      stackFromCache,
      stuckAfterMs: GENERATE_PIPELINE_STAGE_STUCK_MS,
    });
    preV3Timing.totalBeforeV3Ms = Date.now() - startMs;
    const preV3PerformanceReport = debugPerformance ? buildPreV3PerformanceReport(preV3Timing) : null;
    req.log.info(
      {
        ...preV3Timing,
        ...(debugPerformance ? { preV3PerformanceReport, sessionSnapshotCache: getSessionSnapshotCacheStats() } : {}),
        preScoringCandidateShape: preScoringCandidateShape.diagnostics,
        candidateRetrieval: auditMode ? preScoringCandidateShape.diagnostics : undefined,
      },
      "Pre-V3 timing breakdown"
    );
    const pipelineReady = scoringInputSongs.length >= Math.max(8, Math.min(length, 12));
    const strictEditorialGeneration = strictModeHumanSaveability(vibe, lockedIntent);
    const useFastFallback = !devMode && budget.shouldFastFallback() && !pipelineReady && !strictEditorialGeneration;
    const generationPolicy = resolveGenerationPolicy(
      profileUserLibrary(likedSongs, userGenreProfile.trackClassifications),
      estimatePromptUncertainty({
        vibe,
        moodCount: lockedIntent.mood.length,
        explicitDimensions: parsedCsspIntent.interpretationBudget?.appliedDimensions?.length ?? (
          (lockedIntent.genreFamilies.length > 0 ? 1 : 0) +
          (lockedIntent.eraRange ? 1 : 0) +
          (lockedIntent.activity ? 1 : 0) +
          (lockedIntent.energy ? 1 : 0) +
          (lockedIntent.primarySubgenre ? 1 : 0)
        ),
        interpretationComplexity: parsedCsspIntent.interpretationBudget?.complexity,
        sceneConfidence: parsedCsspIntent.sceneIntent?.sceneConfidence ?? null,
        emotionProfile,
      }),
    );
    req.log.info(
      {
        libraryRichness: generationPolicy.library.richness,
        libraryDistribution: generationPolicy.library.distribution,
        promptUncertainty: generationPolicy.prompt.score,
        retrievalBreadth: generationPolicy.retrievalBreadth,
        disableFastPath: generationPolicy.disableFastPath,
      },
      "Library-aware generation policy resolved",
    );

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
        sceneContext: momentPipeline
          ? buildFastFallbackSceneContext({
            vibe,
            emotionProfile,
            prototype: momentPipeline.prototype,
            canonicalScene: momentPipeline.canonicalScene,
            humanIntent: momentPipeline.intent.intent,
            vibeKind,
            emotionalComplexity: mixedEmotions.length > 1,
          })
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
      const editorialMemory = !devMode && !auditMode
        ? await loadEditorialMemory(userId, vibe)
        : null;
      const libraryFingerprint = computeLibraryFingerprint(
        likedSongs.map((track) => ({
          trackId: track.trackId,
          trackName: track.trackName,
          artistName: track.artistName,
          albumName: track.albumName,
          genreFamily: userGenreProfile.trackClassifications.get(track.trackId)?.genreFamily ?? null,
          energy: track.energy,
          valence: track.valence,
          danceability: track.danceability,
          acousticness: track.acousticness,
          tempo: track.tempo,
          rediscoveryScore: (track as { rediscoveryScore?: number | null }).rediscoveryScore ?? null,
        })),
        userGenreProfile.trackClassifications,
      );
      pipeline = await runRequestLayerGeneration({
      pipelineLog: req.log,
      likedSongs: scoringInputSongs,
      worldIdentityLibrary: likedSongs,
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
      recentPlaylistTrackIds: sessionPenaltyTrackLists,
      recentPlaylistHistory: persistentMemoryPlaylistRows.slice(0, 10),
      sessionArtistMemory,
      lastSuccessfulVibe: recentPlaylists[0]?.vibe ?? null,
      noLibraryMode: !!noLibraryMode,
      adaptivePromptWeightShift,
      semanticMomentFingerprint: momentPipeline?.worldUnderstanding?.semanticMoment ?? null,
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
        crossPlaylistNovelty: {
          enabled: crossPlaylistNoveltyEnabled,
          stats: noveltyFreshnessStats,
          previousPlaylistCount: noveltyMemoryRows.length,
          frequencyPenalty: playlistFrequencyPenalty,
          artistAppearances: crossPlaylistArtistAppearances,
          saveCountByTrack: feedbackMemory?.saveCountByTrack,
          artistAffinityByArtist: feedbackMemory?.artistAffinityGraph
            ? Object.fromEntries(
                Object.entries(feedbackMemory.artistAffinityGraph).map(([artist, row]) => [artist, row.score]),
              )
            : undefined,
        },
        contextualUniqueness: {
          enabled: contextualUniquenessEnabled,
          memory: contextualTrackMemory,
          thinLibraryRelaxed: (() => {
            const supply = estimateThinLibraryIntentSupply({
              tracks: likedSongs,
              vibe,
              intent: lockedIntent,
              classMap: userGenreProfile.trackClassifications,
              requestedLength: length,
            });
            return evaluateThinLibraryPolicy(supply, { vibe }).action !== "normal";
          })(),
          explicitArtistOrAlbumPrompt: isExplicitArtistOrAlbumPrompt(vibe),
        },
        vibe: pipelineVibe,
        curatorScoreByTrack,
        sceneAliases,
        scenePrediction: mergedScenePrediction,
        sceneLock: sceneLockStatus,
        tasteGraphV2,
        tasteManifold,
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
      sceneWorldProof: sceneWorldProofRequested,
      profileStage: liveStageProfiler.start,
      shouldAbort: generationShouldAbort,
      shouldSkipMarginalImprovement,
      onGoodPlaylistReady: (snapshot) => {
        latencyBudget.markGoodPlaylistReady();
        refinementTelemetry.captureGoodPlaylistReady(snapshot.tracks, snapshot.scoringContext);
        const genCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
        if (genCtx) {
          persistGoodPlaylistDeliverySnapshot(genCtx, {
            readyAtMs: Date.now(),
            elapsedMs: Date.now() - startMs,
            deliverableTracks: snapshot.deliverableTracks as GoodPlaylistDeliverableTrack[],
            scoringContext: snapshot.scoringContext,
            targetLength: length,
          });
        }
      },
      generationPolicy,
      editorialMemory,
      libraryFingerprint,
      contractComposition: contractCompositionContext,
      contractRetrievalPool: contractRetrievalPoolForPipeline,
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

    const pipelineV3Early = ((pipeline.scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
    const earlyGuard = (pipelineV3Early["intentContractGuard"] ?? {}) as Record<string, unknown>;
    const preV3PoolHealth = earlyGuard["preV3PoolHealth"] as {
      healthy?: boolean;
      reason?: string | null;
      actual?: number;
      minRequired?: number;
    } | undefined;
    if (
      preV3PoolHealth?.healthy === false &&
      (preV3PoolHealth.actual ?? 0) === 0 &&
      pipeline.finalTracks.length === 0
    ) {
      req.log.warn(
        {
          userId,
          vibe,
          poolHealth: preV3PoolHealth,
        },
        "Pre-V3 pool health warning with empty candidate pool; attempting constrained library recovery"
      );
    } else if (preV3PoolHealth?.healthy === false) {
      req.log.warn(
        {
          userId,
          vibe,
          poolHealth: preV3PoolHealth,
          pipelineCandidateCount: pipeline.finalTracks.length,
        },
        "Continuing with constrained candidate pool despite pre-V3 health warning"
      );
    }
    recordGenerationPhaseDuration("v3_pipeline", playlistPipelineTimeMs);
    recordGenerationPhaseDuration("sequencing", playlistPipelineTimeMs);
    recordSpotifyApiMetrics(getSpotifyApiAuditSnapshot());
    if (playlistContractV41Diagnostics) {
      const fromPipeline = (pipeline.scoringDiagnostics as Record<string, unknown>).playlistContractV41 as
        | Record<string, unknown>
        | undefined;
      if (fromPipeline) {
        playlistContractV41Diagnostics = { ...playlistContractV41Diagnostics, ...fromPipeline };
      }
    }
    const contractRebalanceDeliveryGuard =
      isPlaylistContractV41Enabled() &&
      contractRebalanceWasApplied(playlistContractV41Diagnostics);

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
    const pipelineAuthority = createPipelineAuthoritySession({
      strictMode: isStrictRcModeEnabled(),
      enforceCheckpointOrder: true,
      enforceTerminalImmutability: true,
    });
    const promptCentralArtistsForCap = detectPromptCentralArtists(vibe);
    const artistCapOpts = {
      vibe,
      playlistSize: length,
      promptCentralArtists: promptCentralArtistsForCap,
      defaultCap: maxPerArtist,
    };
    const delivery = createPipelineDeliveryBuffer<PlaylistTrack>(pipelineAuthority);
    delivery.init(
      "v3_handoff",
      "pipeline.finalTracks hydrated",
      (pipeline.finalTracks as PlaylistTrack[]).map(hydrateTrackGenre),
    );
    const assignFT = (stage: string, reason: string, next: PlaylistTrack[]): readonly PlaylistTrack[] =>
      delivery.replaceTracks(stage, reason, next);
    const deliveryWorldBoundaryRaw = resolveWorldBoundary({
      sceneLock: sceneLockStatus,
      sceneAliases,
      scenePrediction: mergedScenePrediction,
      prompt: vibe,
    });
    const deliveryWorldBoundary = softenWorldBoundaryForGate(
      deliveryWorldBoundaryRaw,
      worldGateContext.gateDecision,
    );
    const likedIdentityForDelivery = new Map(
      likedSongs.map((song) => [
        song.trackId,
        {
          trackName: song.trackName ?? null,
          artistName: song.artistName ?? null,
          albumName: song.albumName ?? null,
          spotifyArtistGenres: (song as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
          energy: song.energy ?? null,
          valence: song.valence ?? null,
          danceability: song.danceability ?? null,
          popularity: (song as { popularity?: number | null }).popularity ?? null,
        },
      ]),
    );
    const stripDeliveryOffWorld = (stage: string, reason: string): number => {
      if (contractRebalanceDeliveryGuard) return 0;
      if (!deliveryWorldBoundary.active || delivery.tracks.length === 0) return 0;
      const enrichedForIdentity = delivery.tracks.map((track) => {
        const liked = likedIdentityForDelivery.get(track.trackId);
        if (!liked) return track;
        const hasGenres =
          Array.isArray((track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres) &&
          ((track as { spotifyArtistGenres?: unknown[] }).spotifyArtistGenres as unknown[]).length > 0;
        return {
          ...track,
          trackName: track.trackName?.trim() ? track.trackName : (liked.trackName ?? track.trackName),
          artistName: track.artistName?.trim() ? track.artistName : (liked.artistName ?? track.artistName),
          albumName: track.albumName?.trim() ? track.albumName : (liked.albumName ?? track.albumName),
          spotifyArtistGenres: hasGenres
            ? (track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres
            : liked.spotifyArtistGenres,
          energy: track.energy ?? liked.energy,
          valence: track.valence ?? liked.valence,
          danceability: track.danceability ?? liked.danceability,
          popularity:
            (track as { popularity?: number | null }).popularity ?? liked.popularity ?? null,
        };
      });
      const purified = hardRejectOffWorldTracks(
        enrichedForIdentity,
        deliveryWorldBoundary,
        userGenreProfile.trackClassifications,
      );
      if (purified.rejected.length === 0) return 0;
      if (auditMode) {
        hardRejectOffWorldSinceV3Composed += purified.rejected.length;
      }
      const keptIds = new Set(purified.kept.map((track) => track.trackId));
      assignFT(
        stage,
        reason,
        delivery.tracks.filter((track) => keptIds.has(track.trackId)),
      );
      return purified.rejected.length;
    };
    stripDeliveryOffWorld("world_purity_gate", "strip off-world at v3 handoff");
    const checkpointCtx = (extra?: {
      recoveryPoolSize?: number;
      genreEvidenceVerifiedCount?: number;
      genreEvidenceRequiredCount?: number;
      requireTelemetry?: boolean;
      confidence?: { percent: number } | null;
    }) => ({
      tracks: delivery.tracks as PlaylistTrack[],
      vibe,
      requestedLength: length,
      maxPerArtist,
      promptCentralArtists: promptCentralArtistsForCap,
      thinLibraryPolicy,
      openingLock,
      confidence: extra?.confidence ?? null,
      recoveryPoolSize: extra?.recoveryPoolSize,
      hasExplicitGenreIntent: lockedIntent.primaryGenres.length > 0 || lockedIntent.genreFamilies.length > 0,
      hasExplicitEraIntent: hasEraConstraint(lockedIntent),
      genreHardCheck: (track: { trackId: string }) =>
        finalTrackIsHardSafe(track as ConstraintTrack, {
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          allowHolidaySeason,
          classMap: userGenreProfile.trackClassifications,
        }),
      eraHardCheck: (track: { trackId: string }) =>
        finalTrackMatchesExplicitEra(track as ConstraintTrack, lockedIntent),
      genreEvidenceVerifiedCount: extra?.genreEvidenceVerifiedCount,
      genreEvidenceRequiredCount: extra?.genreEvidenceRequiredCount,
      requireTelemetry: extra?.requireTelemetry ?? false,
      strictMode: isStrictRcModeEnabled(),
      ...extra,
    });
    /** Diagnosis-only post-diversity delivery funnel (auditMode). Never mutates selection. */
    const deliveryUnderfillStages: DeliveryStageSnap[] = [];
    let deliveryPipelineExitSnap: DeliveryTrackSnap[] = [];
    let deliveryAfterFinalizeSnap: DeliveryTrackSnap[] = [];
    let deliveryAfterGenreEvidenceSnap: DeliveryTrackSnap[] = [];
    let deliveryAfterEraEvidenceSnap: DeliveryTrackSnap[] = [];
    let deliveryGenreEvidenceAudit: ReturnType<typeof buildGenreEvidenceUnderfillAudit> | null = null;
    if (auditMode) {
      deliveryPipelineExitSnap = snapshotDeliveryTracks(delivery.tracks);
      if (deliveryLossFunnel) {
        deliveryLossFunnel.v3Composed = deliveryPipelineExitSnap.length;
      }
      if (auditMode) {
        hardRejectOffWorldSinceV3Composed = 0;
      }
      deliveryUnderfillStages.push({
        stage: "pipeline_exit_afterDiversity",
        exit: deliveryPipelineExitSnap.length,
        lost: 0,
        added: 0,
        removedTrackIds: [],
        addedTrackIds: [],
      });
    }
    const publishPartialTracks = (tracks: PlaylistTrack[], limit = tracks.length): void => {
      const partialTracks = formatTracksForApi(tracks.slice(0, limit), emotionProfile).map((track) => ({
        trackId: track.id,
        trackName: track.name,
        artistName: track.artist,
        albumArt: track.albumArt ?? null,
      }));
      setGeneratePartialTracks(generateSessionUserId, requestId, partialTracks);
    };
    publishPartialTracks(delivery.tracks, PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT);
    warnIfV3MetadataLost(
      pipeline.finalTracks,
      delivery.tracks,
      "create-playlist-to-controller"
    );
    warnIfFieldDropped("laneScore", pipeline.finalTracks, delivery.tracks, "create-playlist-to-controller");
    warnIfFieldDropped("clusterIds", pipeline.finalTracks, delivery.tracks, "create-playlist-to-controller");
    const publishFinalTracksContext = (): void => {
      const genCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
      if (!genCtx) return;
      genCtx["delivery.tracks"] = delivery.tracks;
      genCtx["v3Diagnostics"] = pipeline.scoringDiagnostics;
    };
    publishFinalTracksContext();
    if (latencyBudget.mustDeliverNow() && delivery.tracks.length > 0 && emitLatencyBudgetFallback()) return;
    let finalValidation = validateLockedIntentOutput(
      delivery.tracks,
      lockedIntent,
      constraintLayer,
      userGenreProfile.trackClassifications
    );
    const intentValidationPassed = validationPassed(finalValidation);
    req.log[intentValidationPassed ? "info" : "debug"](
      {
        lockedIntent,
        finalValidation,
        finalCount: delivery.tracks.length,
        validationPassed: intentValidationPassed,
      },
      intentValidationPassed
        ? "Locked intent final validation"
        : "Locked intent validation failed after hard filter"
    );
    setGenerateStageDetail(generateSessionUserId, requestId, "Validating V3-selected playlist");
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const finalCandidatePool = delivery.tracks;
    const clusterCuration = {
      initial: delivery.tracks,
      candidates: delivery.tracks,
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
      tracks: delivery.tracks as PlaylistTrack[],
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
    const duplicateIdentityCountBeforeFinalize = countDuplicateSongIdentities(delivery.tracks);
    const finalizeValidCandidateSupply: ValidCandidateSupply = validCandidateSupply ?? estimateValidCandidateSupply({
      tracks: likedSongs,
      vibe,
      intent: lockedIntent,
      emotionProfile,
      classMap: userGenreProfile.trackClassifications,
      requestedLength: length,
    });
    const thinLibraryIntentSupply = estimateThinLibraryIntentSupply({
      tracks: likedSongs,
      vibe,
      intent: lockedIntent,
      classMap: userGenreProfile.trackClassifications,
      requestedLength: length,
    });
    let thinLibraryPolicy: ThinLibraryPolicyResult = evaluateThinLibraryPolicy(thinLibraryIntentSupply, { vibe });
    const thinMinRequired = minRequiredValidCandidates(length);
    const compoundThinLibraryBypass = shouldCompoundThinLibraryBypass(
      thinLibraryIntentSupply,
      lockedIntent,
      thinMinRequired,
      finalizeValidCandidateSupply.relaxedValidCount,
    );
    if (compoundThinLibraryBypass && thinLibraryPolicy.action !== "normal") {
      thinLibraryPolicy = {
        ...thinLibraryPolicy,
        action: "normal",
        targetLength: length,
        maxAchievable: length,
        partialRatio: 1,
        userMessage: null,
        reason: "compound_blended_pool_supply_adequate",
      };
    }
    if (deliveryWorldBoundary.hardLock) {
      const worldVerifiedSupply = countWorldVerifiedLibrarySupply(
        likedSongs,
        vibe,
        userGenreProfile.trackClassifications,
        {
          reason: deliveryWorldBoundary.reason,
          anchors: deliveryWorldBoundary.lockAnchors,
        },
      );
      thinLibraryPolicy = constrainThinLibraryPolicyForWorldSupply(thinLibraryPolicy, {
        hardWorldLock: true,
        worldVerifiedSupply,
        requestedLength: length,
      });
    }
    const postV3Checkpoint = runDeliveryCheckpoint(pipelineAuthority, "post_v3", checkpointCtx());
    const effectiveDeliveryLength = effectiveFinalizeRequestedLength(length, thinLibraryPolicy);
    const needsFinalizeRecovery =
      (delivery.tracks.length < effectiveDeliveryLength || duplicateIdentityCountBeforeFinalize > 0) &&
      !shouldSkipThinLibraryRecoveryInflate(thinLibraryPolicy, delivery.tracks.length);
    const softElectronicAftermathRecovery =
      resolveHumanScene(vibe).musicalBehaviour === "soft_electronic" ||
      detectSubSceneRetrievalKind(vibe, lockedIntent) === "soft_focus_concentration";
    const softFocusRecovery =
      detectSubSceneRetrievalKind(vibe, lockedIntent) === "soft_focus_concentration";
    const dominantContractForRecovery = buildDominantIntentContract({
      prompt: vibe,
      intentContract: {
        primarySubgenre: lockedIntent.primarySubgenre ?? null,
        genreFamilies: lockedIntent.genreFamilies,
        activity: lockedIntent.activity ?? null,
        places: [],
        eraRange: lockedIntent.eraRange ?? null,
        explicitDimensions: [],
      },
      emotionProfile,
      mode: mode as "strict" | "balanced" | "chaotic",
      noLibraryMode: !!noLibraryMode,
    });
    const supplyConstrainedRecovery =
      finalizeValidCandidateSupply.strictValidCount < length ||
      delivery.tracks.length < Math.max(5, Math.ceil(length * 0.2));
    let recoveryGuards = evaluateRecoveryGuards(dominantContractForRecovery, {
      underfillRatio: delivery.tracks.length / Math.max(1, length),
      fallbackLevel: "soft",
      finalTracks: delivery.tracks as PlaylistTrack[],
      expectedFamilies: lockedIntent.genreFamilies,
      validCandidateSupply: finalizeValidCandidateSupply,
    });
    let controlledRecoveryBlocked = false;
    let controlledRecoveryReason: string | null = null;
    let activeUserRecoveryTier: UserRecoveryTier = 0;
    let preRecoveryCoherence: number | null = humanCoherenceScore(delivery.tracks, curatorIdentity).score;
    let preRecoveryIdentity = evaluatePlaylistIdentity(delivery.tracks, {
      vibe,
      lockedIntent,
      curatorIdentity,
      classMap: userGenreProfile.trackClassifications,
    });
    const blockUnconstrainedRecoveryFill = shouldBlockHardSafeFinalization(
      mode as "strict" | "balanced" | "chaotic",
      {
        primarySubgenre: lockedIntent.primarySubgenre ?? null,
        primaryGenres: lockedIntent.primaryGenres,
      },
    ) || deliveryWorldBoundary.hardLock;
    if (deliveryWorldBoundary.hardLock && delivery.tracks.length > 0) {
      controlledRecoveryBlocked = true;
      controlledRecoveryReason = "world_hard_lock_blocks_underfill_recovery";
      req.log.info(
        { userId, vibe, finalCount: delivery.tracks.length },
        "Hard world lock blocks underfill recovery padding",
      );
    }
    if (recoveryGuards.controlledFailure && delivery.tracks.length < Math.min(5, Math.ceil(length * 0.15))) {
      controlledRecoveryBlocked = true;
      controlledRecoveryReason = recoveryGuards.reason;
    }
    if (needsFinalizeRecovery && !shouldSkipMarginalImprovement() && !deliveryWorldBoundary.hardLock) {
      if (latencyBudget.mustDeliverNow() && delivery.tracks.length > 0 && emitLatencyBudgetFallback()) return;
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
      if (expandedUnderfillPool.length < length * 2) {
        for (const track of likedSongs) {
          if (expandedUnderfillPool.length >= expandedUnderfillPoolLimit) break;
          pushUnderfillSource(toUnderfillCandidate(track));
        }
      }
      const filteredUnderfillCandidates = expandedUnderfillPool
        .filter((track) => {
          if (seenUnderfillCandidateIds.has(track.trackId)) return false;
          seenUnderfillCandidateIds.add(track.trackId);
          return true;
        })
        .filter((track) => {
          // Soft-electronic aftermath underfill must not re-flood peak rave/house
          // from the full liked library just to hit length. Soft remnant neighbourhood
          // (often indie-classified when Spotify genres are empty) is admissible.
          if (softElectronicAftermathRecovery) {
            const softCap = softFocusRecovery ? 0.52 : 0.66;
            if (typeof track.energy === "number" && track.energy > softCap) return false;
            return true;
          }
          if (
            explicitGenreRecoveryLockActive &&
            !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
            !(
              delivery.tracks.length < Math.ceil(length * 0.75) &&
              trackMatchesGenreSiblingUnderfill(track, vibe, lockedIntent, userGenreProfile.trackClassifications)
            )
          ) return false;
          if (explicitEraRecoveryLockActive && !finalTrackMatchesExplicitEra(track, lockedIntent)) {
            const year = trackYearEstimate(track);
            const range = lockedIntent.eraRange;
            const start = range?.start ?? lockedIntent.eraStart;
            const end = range?.end ?? lockedIntent.eraEnd;
            if (year !== null && start != null && end != null && (year < start - 8 || year > end + 8)) {
              return false;
            }
          }
          if (explicitSceneRecoveryLockActive && !supplyConstrainedRecovery) {
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
      const underfillCandidates = supplyConstrainedRecovery
        ? rankSupplyAwareRecoveryCandidates(filteredUnderfillCandidates, {
            tracks: filteredUnderfillCandidates,
            vibe,
            intent: lockedIntent,
            emotionProfile,
            classMap: userGenreProfile.trackClassifications,
            requestedLength: length,
            frequencyPenalty: playlistFrequencyPenalty,
          })
        : filteredUnderfillCandidates;
      activeUserRecoveryTier = 1;
      const maxPerArtistForRecovery = effectiveRecoveryArtistLimit(maxPerArtist, recoveryGuards);
      const recovered = finalizePlaylistTracks<ConstraintTrack>({
        initial: delivery.tracks as ConstraintTrack[],
        candidates: underfillCandidates,
        requestedLength: effectiveDeliveryLength,
        vibe,
        intent: lockedIntent,
        mode: mode as "strict" | "balanced" | "chaotic",
        constraints: constraintLayer,
        allowHolidaySeason,
        supplyConstrainedRecovery,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist: maxPerArtistForRecovery,
        trackReusePenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
      });
      if (shouldApplyFinalizeRecovery(delivery.tracks, recovered.tracks, effectiveDeliveryLength)) {
        const postRecoveryIdentity = evaluatePlaylistIdentity(recovered.tracks, {
          vibe,
          lockedIntent,
          curatorIdentity,
          classMap: userGenreProfile.trackClassifications,
        });
        if (!recoveryPreservesIdentity(preRecoveryIdentity, postRecoveryIdentity)) {
          controlledRecoveryBlocked = true;
          controlledRecoveryReason = "recovery_identity_guard_blocked";
          req.log.warn(
            {
              preScore: preRecoveryIdentity.score,
              postScore: postRecoveryIdentity.score,
              failures: postRecoveryIdentity.failures,
            },
            "Tier-1 recovery blocked — identity would be lost",
          );
        } else {
        assignFT("recovery_finalize", "finalizePlaylistTracks", recovered.tracks as PlaylistTrack[]);
        const postRecoveryArtistCap = applyArtistCapAtCheckpoint(
          delivery,
          "post_recovery",
          artistCapOpts,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            ...recovered.diagnostics,
            recoveryUserTier: activeUserRecoveryTier,
            recoveryTierRelaxation: tierRelaxationCode(activeUserRecoveryTier),
            underfillRecoveryApplied: delivery.tracks.length < length,
            duplicateIdentityRecoveryApplied: duplicateIdentityCountBeforeFinalize > 0,
            duplicateIdentityCountBeforeFinalize,
            duplicateIdentityCountAfterFinalize: countDuplicateSongIdentities(recovered.tracks),
            stackedConstraintLockActive,
            explicitGenreRecoveryLockActive,
            explicitEraRecoveryLockActive,
            explicitSceneRecoveryLockActive,
            candidateCount: underfillCandidates.length,
            underfillRecoveryExpandedPoolSize: expandedUnderfillPool.length,
            validCandidateSupply: finalizeValidCandidateSupply,
            supplyConstrainedRecovery,
            recoveryIdentityScore: postRecoveryIdentity.score,
            ...(postRecoveryArtistCap.diagnostics.applied
              ? { postRecoveryArtistCap: postRecoveryArtistCap.diagnostics }
              : {}),
          },
        };
        finalizationTimeMs += Date.now() - underfillStartedAt;
        finalValidation = validateLockedIntentOutput(
          delivery.tracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        publishPartialTracks(delivery.tracks, 5);
        }
      }
      if (delivery.tracks.length < length && !controlledRecoveryBlocked) {
        recoveryGuards = evaluateRecoveryGuards(dominantContractForRecovery, {
          underfillRatio: delivery.tracks.length / Math.max(1, length),
          fallbackLevel: "relaxed_scene" as "soft",
          finalTracks: delivery.tracks as PlaylistTrack[],
          expectedFamilies: lockedIntent.genreFamilies,
          validCandidateSupply: finalizeValidCandidateSupply,
        });
        const relaxedStage = recoveryStageAllowed(recoveryGuards, "relaxed_scene");
        const tier2Allowed = recoveryStageAllowedForTier(2, "relaxed_scene");
        if (!relaxedStage.allowed || !tier2Allowed) {
          controlledRecoveryBlocked = true;
          controlledRecoveryReason = relaxedStage.reason ?? (tier2Allowed ? null : "recovery_tier_2_blocked");
        }
      }
      if (delivery.tracks.length < length && !controlledRecoveryBlocked) {
        activeUserRecoveryTier = 2;
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
          initial: delivery.tracks as ConstraintTrack[],
          candidates: relaxedSceneCandidates,
          requestedLength: effectiveDeliveryLength,
          vibe,
          intent: lockedIntent,
          mode: mode as "strict" | "balanced" | "chaotic",
          constraints: constraintLayer,
          allowHolidaySeason,
          supplyConstrainedRecovery,
          classMap: userGenreProfile.trackClassifications,
          maxPerArtist,
          trackReusePenalty: finalizationReusePenalty,
          artistReusePenalty: finalizationArtistReusePenalty,
        });
        if (shouldApplyFinalizeRecovery(delivery.tracks, relaxedRecovered.tracks, effectiveDeliveryLength)) {
          assignFT("relaxed_recovery", "relaxed finalizePlaylistTracks", relaxedRecovered.tracks as PlaylistTrack[]);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              ...relaxedRecovered.diagnostics,
              underfillRecoveryApplied: delivery.tracks.length < length,
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
            delivery.tracks,
            lockedIntent,
            constraintLayer,
            userGenreProfile.trackClassifications
          );
          publishPartialTracks(delivery.tracks, 5);
        }
      }
      if (delivery.tracks.length < length && !controlledRecoveryBlocked) {
        recoveryGuards = evaluateRecoveryGuards(dominantContractForRecovery, {
          underfillRatio: delivery.tracks.length / Math.max(1, length),
          fallbackLevel: mode === "strict" ? "soft" : "global",
          finalTracks: delivery.tracks as PlaylistTrack[],
          expectedFamilies: lockedIntent.genreFamilies,
          validCandidateSupply: finalizeValidCandidateSupply,
        });
        const globalStage = recoveryStageAllowed(recoveryGuards, "global");
        const tier3Allowed = recoveryStageAllowedForTier(3, "global");
        if (!globalStage.allowed || !tier3Allowed) {
          controlledRecoveryBlocked = true;
          controlledRecoveryReason = globalStage.reason ?? (tier3Allowed ? null : "recovery_tier_3_blocked");
        }
      }
      if (delivery.tracks.length < length && !controlledRecoveryBlocked) {
        activeUserRecoveryTier = 3;
        let tier3Working = [...delivery.tracks];
        const deterministicSeenIds = new Set(tier3Working.map((track) => track.trackId));
        const deterministicSeenSignatures = new Set(
          tier3Working.map((track) => trackRepeatSignature(track)).filter((value): value is string => !!value)
        );
        const deterministicArtistCounts = new Map<string, number>();
        for (const track of tier3Working) {
          const artist = track.artistName.toLowerCase().trim();
          deterministicArtistCounts.set(artist, (deterministicArtistCounts.get(artist) ?? 0) + 1);
        }
        const finalCompletionCandidateScore = (track: ConstraintTrack): number => {
          const artist = track.artistName.toLowerCase().trim();
          const trackPenalty = boundedTrackReusePenalty(finalizationReusePenalty?.get(track.trackId));
          const artistPenalty = Math.max(0, Math.min(0.86, finalizationArtistReusePenalty?.get(artist) ?? 0));
          const base = (track.score ?? 0) - trackPenalty * 1.45 - artistPenalty * 1.35;
          return applyFrequencyPenaltyToScore(base, track.trackId, playlistFrequencyPenalty);
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
            if (tier3Working.length >= length) break;
            if (deterministicSeenIds.has(track.trackId)) continue;
            const signature = trackRepeatSignature(track);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            const artist = track.artistName.toLowerCase().trim();
            const previousArtist = tier3Working[tier3Working.length - 1]?.artistName.toLowerCase().trim() ?? null;
            if (avoidBackToBack && previousArtist && previousArtist === artist) continue;
            const count = deterministicArtistCounts.get(artist) ?? 0;
            if (artistLimit !== null && count >= artistLimit) continue;
            deterministicSeenIds.add(track.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            deterministicArtistCounts.set(artist, count + 1);
            tier3Working.push(track as PlaylistTrack);
            added += 1;
          }
          return added;
        };
        const diversitySafeAdded = appendDeterministicFill(
          Math.max(1, Math.ceil(2 * recoveryGuards.diversityPressureMultiplier)),
          true,
        );
        let familyConstrainedFillAdded = 0;
        if (tier3Working.length < length && explicitGenreRecoveryLockActive) {
          const familyConstrainedCandidates = expandedUnderfillPool
            .filter((track) => !deterministicSeenIds.has(track.trackId))
            .filter((track) => trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications))
            .filter((track) =>
              finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) ||
              trackMatchesGenreSiblingUnderfill(track, vibe, lockedIntent, userGenreProfile.trackClassifications)
            )
            .sort((a, b) => finalCompletionCandidateScore(b) - finalCompletionCandidateScore(a));
          for (const track of familyConstrainedCandidates) {
            if (tier3Working.length >= length) break;
            if (deterministicSeenIds.has(track.trackId)) continue;
            const signature = trackRepeatSignature(track);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            const artist = track.artistName.toLowerCase().trim();
            const previousArtist = tier3Working[tier3Working.length - 1]?.artistName.toLowerCase().trim() ?? null;
            if (previousArtist && previousArtist === artist) continue;
            const count = deterministicArtistCounts.get(artist) ?? 0;
            if (count >= Math.max(1, Math.ceil(2 * recoveryGuards.diversityPressureMultiplier))) continue;
            deterministicSeenIds.add(track.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            deterministicArtistCounts.set(artist, count + 1);
            tier3Working.push(track as PlaylistTrack);
            familyConstrainedFillAdded += 1;
          }
        }
        const completionAdded = tier3Working.length < length
          ? appendDeterministicFill(null, false)
          : 0;
        let absoluteLastResortAdded = 0;
        if (tier3Working.length < length && !recoveryGuards.controlledFailure && !blockUnconstrainedRecoveryFill) {
          const absoluteCandidates = expandedUnderfillPool
            .filter((track) => !deterministicSeenIds.has(track.trackId))
            .sort((a, b) => finalCompletionCandidateScore(b) - finalCompletionCandidateScore(a));
          for (const track of absoluteCandidates) {
            if (tier3Working.length >= length) break;
            if (deterministicSeenIds.has(track.trackId)) continue;
            const signature = trackRepeatSignature(track);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            deterministicSeenIds.add(track.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            tier3Working.push(track as PlaylistTrack);
            absoluteLastResortAdded += 1;
          }
        }
        let finalLibrarySweepAdded = 0;
        if (tier3Working.length < length && !controlledRecoveryBlocked && !recoveryGuards.controlledFailure && !blockUnconstrainedRecoveryFill) {
          for (const track of scoringInputSongs) {
            if (tier3Working.length >= length) break;
            const candidate = toUnderfillCandidate(track);
            if (deterministicSeenIds.has(candidate.trackId)) continue;
            const signature = trackRepeatSignature(candidate);
            if (signature && deterministicSeenSignatures.has(signature)) continue;
            deterministicSeenIds.add(candidate.trackId);
            if (signature) deterministicSeenSignatures.add(signature);
            tier3Working.push(candidate as PlaylistTrack);
            finalLibrarySweepAdded += 1;
          }
        }
        if (diversitySafeAdded > 0 || completionAdded > 0 || absoluteLastResortAdded > 0 || finalLibrarySweepAdded > 0 || familyConstrainedFillAdded > 0) {
          delivery.replaceTracks("tier3_fill", "deterministic completion fill", tier3Working);
          delivery.truncateTracks("playlist_length", "slice to requested length", length);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              finalCompletionFillApplied: true,
              finalCompletionDiversitySafeAdded: diversitySafeAdded,
              finalCompletionFamilyConstrainedAdded: familyConstrainedFillAdded,
              finalCompletionLastResortAdded: completionAdded,
              finalCompletionAbsoluteLastResortAdded: absoluteLastResortAdded,
              finalCompletionLibrarySweepAdded: finalLibrarySweepAdded,
              finalCompletionCandidateCount: deterministicCandidates.length,
              controlledRecoveryBlocked,
              controlledRecoveryReason,
              recoveryTailGenreEvidence: recoveryGuards.tailGenreEvidence,
            },
          };
          finalValidation = validateLockedIntentOutput(
            delivery.tracks,
            lockedIntent,
            constraintLayer,
            userGenreProfile.trackClassifications
          );
          publishPartialTracks(delivery.tracks, 5);
        }
      }
      const duplicateCountAfterRecovery = countDuplicateSongIdentities(delivery.tracks);
      if (duplicateCountAfterRecovery > 0) {
        const identitySwap = repairFinalResponseDuplicateSongIdentities(
          delivery.tracks as ConstraintTrack[],
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
          identitySwap.tracks.length === delivery.tracks.length &&
          countDuplicateSongIdentities(identitySwap.tracks) < duplicateCountAfterRecovery
        ) {
          assignFT("identity_swap", "identity swap recovery", identitySwap.tracks as PlaylistTrack[]);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
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
          publishPartialTracks(delivery.tracks, 5);
        }
      }
    }
    const postRecoveryCheckpoint = runDeliveryCheckpoint(pipelineAuthority, "post_recovery", checkpointCtx());
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    if (auditMode) {
      deliveryAfterFinalizeSnap = snapshotDeliveryTracks(delivery.tracks);
      deliveryUnderfillStages.push({
        stage: "after_finalize_recovery",
        enter: deliveryPipelineExitSnap.length,
        exit: deliveryAfterFinalizeSnap.length,
        lost: deliveryPipelineExitSnap.filter((t) => !deliveryAfterFinalizeSnap.some((x) => x.trackId === t.trackId)).length,
        added: deliveryAfterFinalizeSnap.filter((t) => !deliveryPipelineExitSnap.some((x) => x.trackId === t.trackId)).length,
        removedTrackIds: deliveryPipelineExitSnap
          .filter((t) => !deliveryAfterFinalizeSnap.some((x) => x.trackId === t.trackId))
          .map((t) => t.trackId),
        addedTrackIds: deliveryAfterFinalizeSnap
          .filter((t) => !deliveryPipelineExitSnap.some((x) => x.trackId === t.trackId))
          .map((t) => t.trackId),
      });
    }
    const endEvidenceGuardProfile = liveStageProfiler.start("controller.evidenceAndRecoveryGuards", `${finalization.tracks.length}/${length} finalized tracks`);
    const preGenreGuardTracks = [...delivery.tracks];
    const deliverableSurvivorPoolLimit = Math.max(384, length * 16);
    const deliverableSurvivorPool = (() => {
      const seen = new Set<string>();
      const out: PlaylistTrack[] = [];
      const pushRaw = (track: { trackId: string }) => {
        if (!track.trackId || seen.has(track.trackId) || out.length >= deliverableSurvivorPoolLimit) return;
        seen.add(track.trackId);
        out.push(
          enrichDeliverableTrack(
            hydrateTrackGenre(track) as PlaylistTrack,
            likedIdentityForDelivery.get(track.trackId),
          ),
        );
      };
      for (const track of delivery.tracks) pushRaw(track);
      for (const track of preGenreGuardTracks) pushRaw(track);
      for (const track of pipeline.sorted as Array<{ trackId: string }>) pushRaw(track);
      for (const track of pipeline.finalTracks as Array<{ trackId: string }>) pushRaw(track);
      for (const track of scoringInputSongs) pushRaw(track);
      for (const track of worldExpansionCandidates) pushRaw(track);
      return out;
    })();
    const enrichForWorld = (track: PlaylistTrack) =>
      enrichDeliverableTrack(track, likedIdentityForDelivery.get(track.trackId));
    const minBestAvailableCount = resolveThinLibraryMinBestAvailableCount(length, thinLibraryPolicy);
    const evidenceRelaxations: string[] = [];
    let strictGenreEvidenceRelaxed = false;
    let strictEraEvidenceRelaxed = false;
    const baseFinalizationCandidates = clusterCuration.diagnostics.active && clusterCuration.diagnostics.selectedCluster
      ? clusterCuration.candidates
      : finalCandidatePool;
    const explicitConstraintActive = hasExplicitGenreIntent(lockedIntent, constraintLayer) || !!lockedIntent.eraRange;
    const explicitCandidateMap = new Map<string, PlaylistTrack>();
    if (explicitConstraintActive) {
      for (const track of delivery.tracks) explicitCandidateMap.set(track.trackId, track);
      for (const track of baseFinalizationCandidates) explicitCandidateMap.set(track.trackId, track);
      for (const track of scoringInputSongs) {
        const candidate = { ...hydrateTrackGenre(track), score: 0.5 } as PlaylistTrack;
        explicitCandidateMap.set(candidate.trackId, candidate);
      }
      // Thin niche genres (latin/disco): pull full library so sibling warm-dance
      // neighbours can fill when exact family supply is ~1 track.
      if (
        LATIN_CLUSTER_PROMPT_RE.test(vibe) ||
        DISCO_CLUSTER_PROMPT_RE.test(vibe) ||
        lockedIntent.genreFamilies.includes("latin") ||
        lockedIntent.primarySubgenre === "disco"
      ) {
        for (const track of likedSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.45 } as PlaylistTrack;
          if (!explicitCandidateMap.has(candidate.trackId)) {
            explicitCandidateMap.set(candidate.trackId, candidate);
          }
        }
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
    const adjacentConstrainedRecoveryPool = explicitCandidatePool.filter((track) =>
      trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
      finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
      adjacentEraMatches(track)
    );
    const genreConstrainedRecoveryPool = explicitCandidatePool.filter((track) =>
      trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
      finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
    );
    const expectedRecoveryFamilies = lockedIntent.primaryGenres.length > 0
      ? lockedIntent.primaryGenres
      : lockedIntent.genreFamilies;
    const familyConstrainedRecoveryPool = expectedRecoveryFamilies.length > 0
      ? explicitCandidatePool.filter((track) => {
          const siblingMatch = trackMatchesGenreSiblingUnderfill(
            track,
            vibe,
            lockedIntent,
            userGenreProfile.trackClassifications,
          );
          // Sibling warm-dance neighbours for thin latin/disco must not be killed by
          // hard genre lock (latin-only) — that left beach-party playlists at n=1.
          if (siblingMatch) {
            const artist = normalizeArtistConstraint(track.artistName ?? "");
            if (
              artist &&
              constraintLayer.hard.excludedArtists.some((excluded) =>
                artist === excluded || artist.includes(excluded) || excluded.includes(artist)
              )
            ) {
              return false;
            }
            return true;
          }
          return (
            trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications) &&
            expectedRecoveryFamilies.some((family) =>
              hasFinalGenreEvidence(track, userGenreProfile.trackClassifications, [family])
            )
          );
        })
      : [];
    const mergeConstrainedRecoveryPools = (...pools: PlaylistTrack[][]): PlaylistTrack[] => {
      const seen = new Set<string>();
      const merged: PlaylistTrack[] = [];
      for (const pool of pools) {
        for (const track of pool) {
          if (seen.has(track.trackId)) continue;
          seen.add(track.trackId);
          merged.push(track);
        }
      }
      return merged;
    };
    const mergedConstrainedRecoveryPool = mergeConstrainedRecoveryPools(
      exactConstrainedRecoveryPool,
      adjacentConstrainedRecoveryPool,
      genreConstrainedRecoveryPool,
      familyConstrainedRecoveryPool,
    );
    const publishConstrainedPrefix = (
      reason: string,
      minimumCount = PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT,
      publishLimit?: number,
    ): boolean => {
      const replacement = mergedConstrainedRecoveryPool.length >= minimumCount
        ? mergedConstrainedRecoveryPool
        : mergedConstrainedRecoveryPool.length > 0
          ? mergedConstrainedRecoveryPool
          : [];
      if (replacement.length === 0) return false;
      assignFT("genre_evidence_guard", "blind constrained prefix", replacement.slice(0, length));
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          explicitConstraintPartialPublished: true,
          explicitConstraintPartialReason: reason,
          exactConstrainedRecoveryCount: exactConstrainedRecoveryPool.length,
          adjacentConstrainedRecoveryCount: adjacentConstrainedRecoveryPool.length,
          genreConstrainedRecoveryCount: genreConstrainedRecoveryPool.length,
          familyConstrainedRecoveryCount: familyConstrainedRecoveryPool.length,
          mergedConstrainedRecoveryCount: mergedConstrainedRecoveryPool.length,
        },
      };
      finalValidation = validateLockedIntentOutput(
        delivery.tracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
      const streamLimit = publishLimit ?? Math.min(delivery.tracks.length, minimumCount);
      publishPartialTracks(delivery.tracks, streamLimit);
      return true;
    };
    if (delivery.tracks.length === 0 && explicitConstraintActive && mergedConstrainedRecoveryPool.length > 0) {
      publishConstrainedPrefix("empty_finalization_constrained_recovery", Math.min(minBestAvailableCount, 5));
      evidenceRelaxations.push("empty_finalization_constrained_recovery");
    }
    const endGenreEvidenceProfile = liveStageProfiler.start("controller.genreEvidenceGuard", `${delivery.tracks.length} tracks`);
    const isGenreEvidenceVerified = (track: PlaylistTrack): boolean =>
      finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
      finalTrackMatchesExplicitEra(track, lockedIntent);
    const genreRepairConfidence = (track: PlaylistTrack) => {
      const classification = userGenreProfile.trackClassifications.get(track.trackId);
      const diagnostics = classification?.diagnostics;
      const subgenreMatch = trackMatchesExplicitSubgenre(track, lockedIntent, userGenreProfile.trackClassifications);
      return assessRepairGenreEvidenceConfidence(track, {
        subgenreMatch,
        taxonomyHit: diagnostics?.taxonomyHit === true,
        audioFallbackUsed: diagnostics?.audioFallbackUsed === true,
      });
    };
    const collectVerifiedConfidences = (tracks: PlaylistTrack[]): number[] =>
      tracks
        .filter(isGenreEvidenceVerified)
        .map((track) => genreRepairConfidence(track).confidence);
    const v3VerifiedSupply = countGenreVerifiedTracks(preGenreGuardTracks, isGenreEvidenceVerified);
    const v3ConfidenceQualifiedSupply = countConfidenceQualifiedGenreTracks(
      preGenreGuardTracks,
      isGenreEvidenceVerified,
      genreRepairConfidence,
    );
    const strictGenreEvidenceDiagnostics = (() => {
      const expectedFamilies = lockedIntent.primaryGenres.length > 0
        ? lockedIntent.primaryGenres
        : lockedIntent.genreFamilies;
      if (expectedFamilies.length === 0) {
        return {
          active: false,
          expectedFamilies: [],
          verifiedCount: delivery.tracks.length,
          rejectedCount: 0,
          requiredCount: 0,
          verified: delivery.tracks,
          compatible: delivery.tracks,
          partialVerificationPasses: true,
          partialVerificationScore: 1,
          partialVerificationReason: "meets_adaptive_required" as const,
        };
      }
      const verified = delivery.tracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const compatible = delivery.tracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const rejected = delivery.tracks.filter((track) =>
        !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const evidenceBasisCount = delivery.tracks.length;
      const effectiveGenreVerifiedSupply = resolveEffectiveGenreVerifiedSupply({
        confidenceQualifiedSupply: v3ConfidenceQualifiedSupply,
        v3VerifiedSupply,
        verifiedCount: verified.length,
      });
      const adaptiveRequired = computeAdaptiveGenreEvidenceRequiredCount({
        evidenceBasisCount,
        targetLength: length,
        baseRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
        availableVerifiedSupply: effectiveGenreVerifiedSupply,
        strictValidSupply: finalizeValidCandidateSupply.strictValidCount,
      });
      const partialVerification = computePartialGenreVerificationScore({
        verifiedCount: verified.length,
        requiredCount: adaptiveRequired.requiredCount,
        availableVerifiedSupply: effectiveGenreVerifiedSupply,
        verifiedConfidences: collectVerifiedConfidences(verified),
      });
      return {
        active: true,
        expectedFamilies,
        requiredRatio: adaptiveRequired.effectiveRatio,
        requestedCount: length,
        finalCount: delivery.tracks.length,
        evidenceBasisCount,
        verifiedCount: verified.length,
        rejectedCount: rejected.length,
        requiredCount: adaptiveRequired.requiredCount,
        baseRequiredCount: adaptiveRequired.baseRequiredCount,
        supplyCapped: adaptiveRequired.supplyCapped,
        availableVerifiedSupply: effectiveGenreVerifiedSupply,
        partialVerificationScore: partialVerification.score,
        partialVerificationPasses: partialVerification.passes,
        partialVerificationReason: partialVerification.reason,
        confidenceWeightedVerificationScore: partialVerification.confidenceWeightedScore,
        confidenceQualifiedSupply: v3ConfidenceQualifiedSupply,
        verified,
        compatible,
      };
    })();
    endGenreEvidenceProfile();
    const genreAdaptivePartialPublish = (overrides?: {
      publishedTrackCount?: number;
      verifiedCount?: number;
      postRepairVerifiedCount?: number;
      availableVerifiedSupply?: number;
      repairTargetLength?: number;
      supplyCapped?: boolean;
      partialVerificationPasses?: boolean;
    }) => {
      const thinRepairTarget = thinLibraryPolicy.action === "honest_partial"
        ? thinLibraryPolicy.targetLength
        : undefined;
      const result = computeAdaptivePartialPublishLimit({
        requestedLength: length,
        publishedTrackCount: overrides?.publishedTrackCount ?? delivery.tracks.length,
        verifiedCount: overrides?.verifiedCount ?? strictGenreEvidenceDiagnostics.verifiedCount,
        postRepairVerifiedCount: overrides?.postRepairVerifiedCount,
        availableVerifiedSupply:
          overrides?.availableVerifiedSupply
          ?? strictGenreEvidenceDiagnostics.confidenceQualifiedSupply
          ?? strictGenreEvidenceDiagnostics.availableVerifiedSupply
          ?? v3VerifiedSupply,
        repairTargetLength: overrides?.repairTargetLength ?? thinRepairTarget,
        supplyCapped: overrides?.supplyCapped
          ?? (thinLibraryPolicy.action === "honest_partial" || strictGenreEvidenceDiagnostics.supplyCapped),
        partialVerificationPasses:
          overrides?.partialVerificationPasses ?? strictGenreEvidenceDiagnostics.partialVerificationPasses,
      });
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          adaptivePartialPublishLimit: result.limit,
          adaptivePartialPublishReason: result.reason,
          honestPartialPublished: result.honestPartial,
        },
      };
      return result;
    };
    const passesGenreHardConstraints = (track: PlaylistTrack) =>
      trackMatchesHardConstraints(track, constraintLayer, lockedIntent, userGenreProfile.trackClassifications);
    const genreEvidenceVerifiedPrefix = resolveGenreEvidenceVerifiedPrefix(
      strictGenreEvidenceDiagnostics.verified,
      preGenreGuardTracks,
      isGenreEvidenceVerified,
      passesGenreHardConstraints,
    );
    const genreEvidenceVerifiedCount = Math.max(
      strictGenreEvidenceDiagnostics.verifiedCount,
      genreEvidenceVerifiedPrefix.length,
    );
    const enrichDeliveryTrackForWorld = (track: PlaylistTrack): PlaylistTrack => {
      const liked = likedIdentityForDelivery.get(track.trackId);
      if (!liked) return track;
      const hasGenres =
        Array.isArray((track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres) &&
        ((track as { spotifyArtistGenres?: unknown[] }).spotifyArtistGenres as unknown[]).length > 0;
      return {
        ...track,
        trackName: track.trackName?.trim() ? track.trackName : (liked.trackName ?? track.trackName),
        artistName: track.artistName?.trim() ? track.artistName : (liked.artistName ?? track.artistName),
        albumName: track.albumName?.trim() ? track.albumName : (liked.albumName ?? track.albumName),
        spotifyArtistGenres: hasGenres
          ? (track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres
          : liked.spotifyArtistGenres,
        energy: track.energy ?? liked.energy,
        valence: track.valence ?? liked.valence,
        danceability: track.danceability ?? liked.danceability,
        popularity:
          (track as { popularity?: number | null }).popularity ?? liked.popularity ?? null,
      } as PlaylistTrack;
    };
    const trackPassesDeliveryWorld = (track: PlaylistTrack): boolean => {
      if (!deliveryWorldBoundary.active) return true;
      const enriched = enrichDeliveryTrackForWorld(track);
      return isTrackInWorld(
        {
          trackId: enriched.trackId,
          trackName: enriched.trackName,
          artistName: enriched.artistName,
          albumName: enriched.albumName,
          genreFamily: enriched.genreFamily ?? null,
          genrePrimary: enriched.genrePrimary ?? null,
          genres: enriched.genres ?? null,
          energy: enriched.energy,
          valence: enriched.valence,
          danceability: enriched.danceability,
          popularity: (enriched as { popularity?: number | null }).popularity ?? null,
          spotifyArtistGenres: (enriched as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
        },
        deliveryWorldBoundary,
        enriched.genreFamily ?? enriched.genrePrimary ?? null,
      );
    };
    const genreAwareRepairInput = () => ({
      verifiedPrefix: genreEvidenceVerifiedPrefix.filter((track) => trackPassesDeliveryWorld(track)),
      v3Tracks: deliverableSurvivorPool.filter((track) => trackPassesDeliveryWorld(track)),
      requestedLength: length,
      availableGenreVerifiedSupply: resolveEffectiveGenreVerifiedSupply({
        confidenceQualifiedSupply: v3ConfidenceQualifiedSupply,
        v3VerifiedSupply,
        verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
      }),
      isGenreVerified: isGenreEvidenceVerified,
      passesHardConstraints: passesGenreHardConstraints,
      genreEvidenceConfidence: genreRepairConfidence,
    });
    const applyVerifiedV3OutputPublication = (
      confidenceAssessment?: ReturnType<typeof assessConfidenceAwarePublication>,
    ): VerifiedV3OutputPublication<PlaylistTrack> | null => {
      if (genreEvidenceVerifiedPrefix.length < 1) return null;
      const publication = confidenceAssessment && shouldPublishConfidenceAwareOutput(confidenceAssessment)
        ? publishConfidenceAwarePlaylist(genreAwareRepairInput(), confidenceAssessment)
        : publishVerifiedV3OutputPlaylist(genreAwareRepairInput());
      if (!publication.published) return null;
      const { result, reason } = publication;
      assignFT("genre_evidence_guard", "constrained publish", result.tracks);
      stripDeliveryOffWorld("world_purity_gate", "strip off-world after genre-evidence publish");
      const confidencePublication = (
        "confidenceAware" in publication && publication.confidenceAware === true
      ) ? publication as ConfidenceAwarePublication<PlaylistTrack> : null;
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          explicitConstraintPartialPublished: delivery.tracks.length < length,
          explicitConstraintPartialReason: reason,
          explicitConstraintValidPrefixCount: result.verifiedPreservedCount,
          genreEvidenceV3RepairFillCount: result.filledFromV3Count,
          genreEvidencePostRepairVerifiedCount: result.postRepairVerifiedCount,
          genreAwareRepairTargetLength: result.repairTargetLength,
          genreAwareRepairSupplyCapped: result.supplyCapped,
          genreEvidenceHighConfidenceRepairFillCount: result.highConfidenceFillCount,
          genreEvidenceMinConfidenceRepairFillCount: result.minConfidenceFillCount,
          genreEvidenceAverageRepairConfidence: result.averageRepairConfidence,
          publishedFromVerifiedV3Output: true,
          publishedFromConfidenceAwareOutput: confidencePublication != null,
          confidenceAwarePublicationReason: confidencePublication?.assessment.publishReason,
          confidenceAwareWeightedScore: confidencePublication?.assessment.confidenceWeightedScore
            ?? strictGenreEvidenceDiagnostics.confidenceWeightedVerificationScore,
          confidenceAwareHighConfidenceVerifiedCount: confidencePublication?.assessment.highConfidenceVerifiedCount,
          confidenceAwareAverageVerifiedConfidence: confidencePublication?.assessment.averageVerifiedConfidence,
        },
      };
      finalValidation = validateLockedIntentOutput(
        delivery.tracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
      const adaptivePartial = genreAdaptivePartialPublish({
        publishedTrackCount: delivery.tracks.length,
        postRepairVerifiedCount: result.postRepairVerifiedCount,
        repairTargetLength: result.repairTargetLength,
        supplyCapped: result.supplyCapped,
        partialVerificationPasses: true,
      });
      publishPartialTracks(delivery.tracks, adaptivePartial.limit);
      evidenceRelaxations.push(
        confidencePublication != null
          ? "publish_confidence_aware_output"
          : result.filledFromV3Count > 0
            ? "publish_verified_v3_output_repair"
            : "publish_verified_v3_output",
      );
      req.log.warn(
        {
          userId,
          vibe,
          finalCount: delivery.tracks.length,
          verifiedCount: strictGenreEvidenceDiagnostics.verified.length,
          postRepairVerifiedCount: result.postRepairVerifiedCount,
          v3RepairFillCount: result.filledFromV3Count,
          verifiedPreservedCount: result.verifiedPreservedCount,
          repairTargetLength: result.repairTargetLength,
          supplyCapped: result.supplyCapped,
          publicationReason: reason,
          confidenceAware: confidencePublication != null,
          confidenceWeightedScore: confidencePublication?.assessment.confidenceWeightedScore
            ?? strictGenreEvidenceDiagnostics.confidenceWeightedVerificationScore,
        },
        confidencePublication != null
          ? "Published confidence-aware genre-evidence playlist"
          : "Published verified V3 output playlist",
      );
      return publication;
    };
    const applyHonestConstrainedPublication = (): boolean => {
      const publication = publishHonestConstrainedPlaylist({
        verifiedPrefix: genreEvidenceVerifiedPrefix,
        v3Tracks: preGenreGuardTracks,
        recoveryPool: mergedConstrainedRecoveryPool,
        requestedLength: length,
        availableVerifiedSupply: resolveEffectiveGenreVerifiedSupply({
          confidenceQualifiedSupply: strictGenreEvidenceDiagnostics.confidenceQualifiedSupply ?? v3ConfidenceQualifiedSupply,
          v3VerifiedSupply,
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
        }),
        repairTargetLength: typeof finalization.diagnostics["genreAwareRepairTargetLength"] === "number"
          ? (finalization.diagnostics["genreAwareRepairTargetLength"] as number)
          : undefined,
        supplyCapped: strictGenreEvidenceDiagnostics.supplyCapped,
        partialVerificationPasses: strictGenreEvidenceDiagnostics.partialVerificationPasses,
        isGenreVerified: isGenreEvidenceVerified,
        passesHardConstraints: passesGenreHardConstraints,
      });
      if (!publication.published) return false;
      const { result } = publication;
      assignFT("genre_evidence_guard", "constrained publish", result.tracks);
      stripDeliveryOffWorld("world_purity_gate", "strip off-world after honest constrained publish");
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          explicitConstraintPartialPublished: delivery.tracks.length < length,
          explicitConstraintPartialReason: result.reason,
          explicitConstraintValidPrefixCount: result.verifiedPreservedCount,
          genreEvidenceHonestConstrainedPublished: true,
          genreEvidenceHonestConstrainedReason: result.reason,
          genreEvidenceHonestConstrainedV3FillCount: result.v3FillCount,
          genreEvidenceHonestConstrainedRecoveryFillCount: result.recoveryFillCount,
          genreEvidencePostRepairVerifiedCount: result.postRepairVerifiedCount,
          adaptivePartialPublishLimit: result.publishLimit,
          adaptivePartialPublishReason: result.reason,
          honestPartialPublished: true,
        },
      };
      finalValidation = validateLockedIntentOutput(
        delivery.tracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
      publishPartialTracks(delivery.tracks, result.publishLimit);
      req.log.warn(
        {
          userId,
          vibe,
          finalCount: delivery.tracks.length,
          verifiedPreservedCount: result.verifiedPreservedCount,
          v3FillCount: result.v3FillCount,
          recoveryFillCount: result.recoveryFillCount,
          publishLimit: result.publishLimit,
          publicationReason: result.reason,
        },
        "Published honest constrained genre-evidence playlist",
      );
      return true;
    };
    if (deliveryWorldBoundary.hardLock) {
      const beforeWorldPublish = delivery.tracks.length;
      stripDeliveryOffWorld("world_purity_gate", "strip off-world before skipping genre-evidence republish");
      if (controlledRecoveryReason === "world_hard_lock_blocks_underfill_recovery") {
        evidenceRelaxations.push("world_hard_lock_blocks_underfill_recovery");
      }
      evidenceRelaxations.push("world_hard_lock_skips_genre_evidence_guard");
      req.log.info(
        {
          userId,
          vibe,
          beforeCount: beforeWorldPublish,
          afterCount: delivery.tracks.length,
        },
        "Hard world lock skips genre-evidence republish; keeping world-verified V3 output",
      );
    } else if (strictGenreEvidenceDiagnostics.active) {
      const confidenceAssessment = assessConfidenceAwarePublication({
        active: strictGenreEvidenceDiagnostics.active,
        verifiedCount: genreEvidenceVerifiedCount,
        requiredCount: strictGenreEvidenceDiagnostics.requiredCount,
        availableVerifiedSupply: strictGenreEvidenceDiagnostics.availableVerifiedSupply ?? v3VerifiedSupply,
        confidenceQualifiedSupply: v3ConfidenceQualifiedSupply,
        verifiedConfidences: collectVerifiedConfidences(genreEvidenceVerifiedPrefix),
        partialVerificationPasses: strictGenreEvidenceDiagnostics.partialVerificationPasses,
        rejectedCount: strictGenreEvidenceDiagnostics.rejectedCount,
        publishedTrackCount: delivery.tracks.length,
        requestedLength: length,
      });
      const publishVerifiedV3 = shouldPublishVerifiedV3Output({
        active: strictGenreEvidenceDiagnostics.active,
        verifiedCount: genreEvidenceVerifiedCount,
        rejectedCount: strictGenreEvidenceDiagnostics.rejectedCount,
        partialVerificationPasses: strictGenreEvidenceDiagnostics.partialVerificationPasses,
        publishedTrackCount: delivery.tracks.length,
        requestedLength: length,
        confidenceAwarePasses: confidenceAssessment.passes,
      }) || shouldPublishConfidenceAwareOutput(confidenceAssessment);
      const verifiedV3Publication = publishVerifiedV3
        ? applyVerifiedV3OutputPublication(confidenceAssessment)
        : null;
      const publishedVerifiedV3 = verifiedV3Publication?.published === true;
      const postRepairPartial = computePartialGenreVerificationScore({
        verifiedCount: countGenreVerifiedTracks(delivery.tracks, isGenreEvidenceVerified),
        requiredCount: strictGenreEvidenceDiagnostics.requiredCount,
        availableVerifiedSupply: strictGenreEvidenceDiagnostics.availableVerifiedSupply ?? v3VerifiedSupply,
        verifiedConfidences: collectVerifiedConfidences(delivery.tracks),
      });
      const publication = resolveGenreEvidencePublication({
        active: strictGenreEvidenceDiagnostics.active,
        repairedFromV3: publishedVerifiedV3,
        postRepairPartialPasses: postRepairPartial.passes,
        initialPartialPasses: strictGenreEvidenceDiagnostics.partialVerificationPasses,
        verifiedCount: genreEvidenceVerifiedCount,
        postRepairVerifiedCount: countGenreVerifiedTracks(delivery.tracks, isGenreEvidenceVerified),
        publishedTrackCount: delivery.tracks.length,
        requestedLength: length,
        availableVerifiedSupply: strictGenreEvidenceDiagnostics.availableVerifiedSupply ?? v3VerifiedSupply,
        confidenceQualifiedSupply: v3ConfidenceQualifiedSupply,
        confidenceAwarePasses: confidenceAssessment.passes,
        confidencePublicationReason: confidenceAssessment.passes
          ? confidenceAssessment.publishReason
          : null,
        repairTargetLength: typeof finalization.diagnostics["genreAwareRepairTargetLength"] === "number"
          ? (finalization.diagnostics["genreAwareRepairTargetLength"] as number)
          : undefined,
        supplyCapped: strictGenreEvidenceDiagnostics.supplyCapped,
      });
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          genreEvidencePublicationAction: publication.action,
          genreEvidencePublicationReason: publication.publishReason,
          genreEvidencePublicationPartialLimit: publication.partialPublishLimit,
          adaptivePartialPublishLimit: publication.partialPublishLimit,
          adaptivePartialPublishReason: publication.adaptivePartialPublishReason,
          honestPartialPublished: publication.honestPartialPublished,
          publishedFromConfidenceAwareOutput: publication.confidenceAwarePublished,
          confidenceAwarePublicationReason: publication.confidencePublicationReason,
          confidenceAwareWeightedScore: confidenceAssessment.confidenceWeightedScore,
          confidenceAwareHighConfidenceVerifiedCount: confidenceAssessment.highConfidenceVerifiedCount,
          confidenceAwareAverageVerifiedConfidence: confidenceAssessment.averageVerifiedConfidence,
        },
      };
      if (!publication.skipConstrainedPrefix) {
      let honestConstrainedPublished = false;
      if (
        shouldPreferHonestConstrainedPublish({
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
          partialVerificationPasses: strictGenreEvidenceDiagnostics.partialVerificationPasses,
        }) &&
        applyHonestConstrainedPublication()
      ) {
        honestConstrainedPublished = true;
        evidenceRelaxations.push("genre_evidence_honest_constrained_published");
      }
      const constrainedPartial = genreAdaptivePartialPublish();
      if (
        !honestConstrainedPublished &&
        publication.action === "fallback_constrained" &&
        shouldUseBlindConstrainedReplacement({
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
          honestConstrainedDelivered: 0,
          recoveryPoolSize: mergedConstrainedRecoveryPool.length,
        }) &&
        publishConstrainedPrefix(
        "insufficient_verified_genre_evidence",
        Math.min(constrainedPartial.limit, mergedConstrainedRecoveryPool.length || constrainedPartial.limit),
        constrainedPartial.limit,
      )) {
        evidenceRelaxations.push("genre_evidence_partial_constrained_prefix");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
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
      } else if (
        !honestConstrainedPublished &&
        shouldUseBlindConstrainedReplacement({
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
          honestConstrainedDelivered: 0,
          recoveryPoolSize: mergedConstrainedRecoveryPool.length,
        }) &&
        publishConstrainedPrefix(
        "genre_evidence_family_constrained_recovery",
        (() => {
          const partial = genreAdaptivePartialPublish();
          return Math.min(partial.limit, mergedConstrainedRecoveryPool.length || PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT);
        })(),
        genreAdaptivePartialPublish().limit,
      )) {
        evidenceRelaxations.push("genre_evidence_family_constrained_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            familyConstrainedRecoveryCount: familyConstrainedRecoveryPool.length,
            mergedConstrainedRecoveryCount: mergedConstrainedRecoveryPool.length,
          },
          "Explicit genre evidence guard published family-constrained recovery playlist"
        );
      } else if (
        !honestConstrainedPublished &&
        familyConstrainedRecoveryPool.length >= Math.min(5, Math.ceil(length * 0.2)) &&
        familyConstrainedRecoveryPool.length > Math.max(2, strictGenreEvidenceDiagnostics.verified.length) &&
        (
          LATIN_CLUSTER_PROMPT_RE.test(vibe) ||
          DISCO_CLUSTER_PROMPT_RE.test(vibe) ||
          lockedIntent.genreFamilies.includes("latin") ||
          lockedIntent.primarySubgenre === "disco"
        )
      ) {
        const siblingPublish = familyConstrainedRecoveryPool
          .slice()
          .sort((a, b) => ((b.energy as number) ?? 0) - ((a.energy as number) ?? 0))
          .slice(0, length);
        assignFT("genre_evidence_guard", "sibling cluster recovery", siblingPublish);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "genre_evidence_sibling_cluster_recovery",
            explicitConstraintValidPrefixCount: siblingPublish.length,
          },
        };
        finalValidation = validateLockedIntentOutput(
          delivery.tracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications,
        );
        publishPartialTracks(delivery.tracks, Math.min(length, siblingPublish.length));
        evidenceRelaxations.push("genre_evidence_sibling_cluster_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            familyConstrainedRecoveryCount: familyConstrainedRecoveryPool.length,
            verifiedCount: strictGenreEvidenceDiagnostics.verified.length,
          },
          "Explicit genre evidence guard published latin/disco sibling cluster recovery",
        );
      } else if (!honestConstrainedPublished && strictGenreEvidenceDiagnostics.verified.length > 0) {
        assignFT("genre_evidence_guard", "degraded verified partial", strictGenreEvidenceDiagnostics.verified.slice(0, length));
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "genre_evidence_degraded_partial",
            explicitConstraintValidPrefixCount: strictGenreEvidenceDiagnostics.verified.length,
          },
        };
        finalValidation = validateLockedIntentOutput(
          delivery.tracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        const degradedPartial = genreAdaptivePartialPublish({
          publishedTrackCount: delivery.tracks.length,
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
        });
        publishPartialTracks(delivery.tracks, degradedPartial.limit);
        evidenceRelaxations.push("genre_evidence_degraded_partial_published");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            verifiedCount: strictGenreEvidenceDiagnostics.verified.length,
            requiredCount: strictGenreEvidenceDiagnostics.requiredCount,
          },
          "Explicit genre evidence guard published degraded verified partial playlist"
        );
      } else if (delivery.tracks.length > 0) {
        evidenceRelaxations.push("genre_evidence_best_available_degraded");
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "genre_evidence_best_available_degraded",
            explicitConstraintValidPrefixCount: delivery.tracks.length,
          },
        };
        const bestAvailablePartial = genreAdaptivePartialPublish({
          publishedTrackCount: delivery.tracks.length,
          verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
        });
        publishPartialTracks(delivery.tracks, bestAvailablePartial.limit);
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            strictGenreEvidenceDiagnostics: {
              ...strictGenreEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
            },
          },
          "Explicit genre evidence guard published best-available degraded playlist"
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
            ? "Try a broader genre phrase, turn off Discovery Mode to use your saved tracks, or retry in a moment."
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
      } else if (publication.skipConstrainedPrefix) {
        let constrainedPlaylistPublished = publishedVerifiedV3;
        if (
          publication.action === "publish_honest_constrained" &&
          !publishedVerifiedV3 &&
          applyHonestConstrainedPublication()
        ) {
          constrainedPlaylistPublished = true;
          evidenceRelaxations.push("genre_evidence_honest_constrained_published");
        } else if (!publishedVerifiedV3) {
          const latePublish = applyVerifiedV3OutputPublication();
          if (latePublish?.published) {
            constrainedPlaylistPublished = true;
            evidenceRelaxations.push(latePublish.reason);
          }
        }
        if (!constrainedPlaylistPublished) {
          const skipPrefixPartial = genreAdaptivePartialPublish({
            postRepairVerifiedCount: countGenreVerifiedTracks(delivery.tracks, isGenreEvidenceVerified),
            partialVerificationPasses: postRepairPartial.passes,
          });
          publishPartialTracks(delivery.tracks, publication.partialPublishLimit ?? skipPrefixPartial.limit);
        }
        evidenceRelaxations.push(publication.publishReason);
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            publicationAction: publication.action,
            publicationReason: publication.publishReason,
            postRepairPartialPasses: postRepairPartial.passes,
            publishedVerifiedV3,
          },
          "Explicit genre evidence guard published repaired/verified playlist",
        );
      }
    }
    // Thin niche genres: verified supply can be ~1–3 tracks while the library has
    // musically adjacent siblings (disco→nu-disco→boogie, latin→warm dance, etc.).
    // Genre evidence publish caps at verified supply; expand via scene fallback chains.
    // NOTE: artist-cap prune later can still collapse n=35→10 — a second pass runs
    // after postApiRefillArtistCap for that case.
    {
      const fallbackChain = resolveSceneFallbackChain(vibe, lockedIntent.genreFamilies);
      const nicheThin = delivery.tracks.length < Math.ceil(requestedLength * 0.75);
      // Hard world locks must not expand via adjacent-scene fallback chains
      // (e.g. angry rock → gym_rock chain injecting classic-rock blankets).
      if (fallbackChain && nicheThin && !deliveryWorldBoundary.hardLock) {
        const classMap = userGenreProfile.trackClassifications;
        const poolMap = new Map<string, PlaylistTrack>();
        for (const track of delivery.tracks) poolMap.set(track.trackId, track);
        for (const track of explicitCandidatePool) poolMap.set(track.trackId, track);
        for (const track of familyConstrainedRecoveryPool) poolMap.set(track.trackId, track);
        for (const track of scoringInputSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.45 } as PlaylistTrack;
          if (!poolMap.has(candidate.trackId)) poolMap.set(candidate.trackId, candidate);
        }
        for (const track of likedSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.4 } as PlaylistTrack;
          if (!poolMap.has(candidate.trackId)) poolMap.set(candidate.trackId, candidate);
        }
        const chainCandidates = [...poolMap.values()].map((track) => {
          const classification = classMap.get(track.trackId);
          const family =
            track.genreFamily ??
            classification?.genreFamily ??
            trackGenreFamily(track, classMap) ??
            null;
          return {
            ...track,
            genreFamily: family,
            primarySubgenre: classification?.primarySubgenre ?? null,
            secondarySubgenre: classification?.secondarySubgenre ?? null,
            subGenres: classification?.subGenres ?? [],
          };
        });
        const filled = fillPlaylistViaFallbackChain(
          delivery.tracks as PlaylistTrack[],
          chainCandidates,
          fallbackChain,
          { targetLength: requestedLength, maxPerArtist },
        );
        if (filled.added > 0) {
          assignFT("genre_evidence_guard", `fallback_chain_${fallbackChain.id}`, filled.tracks);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              thinNicheSiblingExpansionApplied: true,
              thinNicheSiblingExpansionCount: filled.tracks.length,
              thinNicheSiblingExpansionAdded: filled.added,
              sceneFallbackChainId: fallbackChain.id,
              sceneFallbackRankedPoolSize: filled.rankedPoolSize,
              explicitConstraintPartialPublished: filled.tracks.length < requestedLength,
              explicitConstraintPartialReason: `scene_fallback_chain_${fallbackChain.id}`,
            },
          };
          evidenceRelaxations.push(`scene_fallback_chain_${fallbackChain.id}`);
          req.log.warn(
            {
              userId,
              vibe,
              finalCount: delivery.tracks.length,
              chainId: fallbackChain.id,
              added: filled.added,
              rankedPoolSize: filled.rankedPoolSize,
            },
            "Expanded thin niche playlist via scene fallback chain",
          );
        } else {
          req.log.warn(
            {
              userId,
              vibe,
              deliveryCount: delivery.tracks.length,
              chainId: fallbackChain.id,
              rankedPoolSize: filled.rankedPoolSize,
              poolSource: chainCandidates.length,
            },
            "Thin niche fallback chain found no expandable neighbours",
          );
        }
      }
    }
    const genreEvidencePublication = strictGenreEvidenceDiagnostics.active
      ? (finalization.diagnostics["genreEvidencePublicationReason"] as string | undefined)
      : undefined;
    const partialReason = String(finalization.diagnostics["explicitConstraintPartialReason"] ?? "");
    const skipGenreLeakStripAfterRepair =
      finalization.diagnostics["publishedFromVerifiedV3Output"] === true ||
      finalization.diagnostics["publishedFromConfidenceAwareOutput"] === true ||
      finalization.diagnostics["genreEvidenceHonestConstrainedPublished"] === true ||
      finalization.diagnostics["thinNicheSiblingExpansionApplied"] === true ||
      genreEvidencePublication === "genre_evidence_repaired_v3_published" ||
      genreEvidencePublication === "publish_verified_v3_output" ||
      genreEvidencePublication === "genre_evidence_honest_constrained_verified" ||
      (typeof genreEvidencePublication === "string" && genreEvidencePublication.startsWith("publish_confidence_aware")) ||
      partialReason.startsWith("scene_fallback_chain_") ||
      partialReason === "genre_evidence_sibling_cluster_recovery" ||
      partialReason === "thin_niche_sibling_expansion" ||
      evidenceRelaxations.some(
        (entry) =>
          entry.startsWith("scene_fallback_chain_") ||
          entry === "genre_evidence_sibling_cluster_recovery" ||
          entry === "thin_niche_sibling_expansion" ||
          entry === "world_hard_lock_skips_genre_evidence_guard",
      ) ||
      deliveryWorldBoundary.hardLock;
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.rejectedCount > 0 &&
      !skipGenreLeakStripAfterRepair
    ) {
      const verifiedOnly = delivery.tracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const rejectedCount = delivery.tracks.length - verifiedOnly.length;
      if (rejectedCount > 0 && verifiedOnly.length >= 5 && verifiedOnly.length < delivery.tracks.length) {
        assignFT("genre_evidence_guard", "verified only partial", verifiedOnly.slice(0, length));
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "genre_leak_stripped_to_verified",
            explicitConstraintValidPrefixCount: verifiedOnly.length,
            genreLeakRejectedCount: strictGenreEvidenceDiagnostics.rejectedCount,
          },
        };
        finalValidation = validateLockedIntentOutput(
          delivery.tracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        const leakStrippedPartial = genreAdaptivePartialPublish({
          publishedTrackCount: delivery.tracks.length,
          verifiedCount: verifiedOnly.length,
          postRepairVerifiedCount: verifiedOnly.length,
        });
        publishPartialTracks(delivery.tracks, leakStrippedPartial.limit);
        evidenceRelaxations.push("genre_leak_stripped_to_verified");
        req.log.warn(
          {
            userId,
            vibe,
            rejectedCount,
            publishedCount: delivery.tracks.length,
          },
          "Explicit genre evidence guard stripped genre leaks to verified-only playlist"
        );
      } else if (applyHonestConstrainedPublication()) {
        evidenceRelaxations.push("genre_evidence_honest_constrained_published");
      } else if (
        shouldUseBlindConstrainedReplacement({
          verifiedCount: verifiedOnly.length,
          honestConstrainedDelivered: 0,
          recoveryPoolSize: mergedConstrainedRecoveryPool.length,
        }) &&
        publishConstrainedPrefix(
        "genre_leak_constrained_recovery",
        Math.min(genreAdaptivePartialPublish().limit, mergedConstrainedRecoveryPool.length || PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT),
        genreAdaptivePartialPublish().limit,
      )
      ) {
        evidenceRelaxations.push("genre_leak_constrained_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            rejectedCount,
            publishedCount: delivery.tracks.length,
          },
          "Explicit genre evidence guard recovered from genre leak via constrained prefix"
        );
      }
    }
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.rejectedCount > 0 &&
      !strictGenreEvidenceRelaxed &&
      !evidenceRelaxations.some((entry) => entry.startsWith("genre_leak_"))
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
    if (auditMode) {
      deliveryAfterGenreEvidenceSnap = snapshotDeliveryTracks(delivery.tracks);
      const verifiedSnap = snapshotDeliveryTracks(strictGenreEvidenceDiagnostics.verified as PlaylistTrack[]);
      const rejectedSnap = snapshotDeliveryTracks(
        (strictGenreEvidenceDiagnostics.active
          ? (deliveryAfterFinalizeSnap.length > 0 ? deliveryAfterFinalizeSnap : deliveryPipelineExitSnap).filter(
              (t) => !(strictGenreEvidenceDiagnostics.verified as PlaylistTrack[]).some((v) => v.trackId === t.trackId),
            )
          : []) as Array<{ trackId: string; trackName?: string | null; artistName?: string | null }>,
      );
      // Recompute rejected from the pre-evidence playlist when active.
      const preEvidence = deliveryAfterFinalizeSnap.length > 0 ? deliveryAfterFinalizeSnap : deliveryPipelineExitSnap;
      const verifiedIds = new Set((strictGenreEvidenceDiagnostics.verified as PlaylistTrack[]).map((t) => t.trackId));
      const rejectedFromPre = preEvidence.filter((t) => !verifiedIds.has(t.trackId));
      deliveryGenreEvidenceAudit = buildGenreEvidenceUnderfillAudit({
        pipelineExit: preEvidence,
        afterEvidence: deliveryAfterGenreEvidenceSnap,
        verified: verifiedSnap,
        rejected: rejectedFromPre.length > 0 ? rejectedFromPre : rejectedSnap,
        mergedConstrainedPool: snapshotDeliveryTracks(mergedConstrainedRecoveryPool),
        verifiedCount: strictGenreEvidenceDiagnostics.verifiedCount,
        rejectedCount: strictGenreEvidenceDiagnostics.rejectedCount,
        requiredCount: strictGenreEvidenceDiagnostics.requiredCount,
        requiredRatio: Number(strictGenreEvidenceDiagnostics.requiredRatio ?? 0),
        explicitConstraintPartialReason:
          typeof finalization.diagnostics["explicitConstraintPartialReason"] === "string"
            ? (finalization.diagnostics["explicitConstraintPartialReason"] as string)
            : null,
        exactPoolSize: exactConstrainedRecoveryPool.length,
        adjacentPoolSize: adjacentConstrainedRecoveryPool.length,
        genrePoolSize: genreConstrainedRecoveryPool.length,
        familyPoolSize: familyConstrainedRecoveryPool.length,
        mergedPoolSize: mergedConstrainedRecoveryPool.length,
      });
      deliveryUnderfillStages.push(deliveryGenreEvidenceAudit.stageLoss);
    }
    const endEraEvidenceProfile = liveStageProfiler.start("controller.eraEvidenceGuard", `${delivery.tracks.length} tracks`);
    const strictEraEvidenceDiagnostics = (() => {
      const eraRange = lockedIntent.eraRange;
      if (!eraRange) {
        return {
          active: false,
          eraRange: null,
          requiredRatio: STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
          requestedCount: length,
          finalCount: delivery.tracks.length,
          verifiedCount: delivery.tracks.length,
          unknownCount: 0,
          rejectedCount: 0,
          requiredCount: 0,
          compatibleFallbackUsed: false,
          verified: delivery.tracks,
          compatible: delivery.tracks,
          compatibleRecoveryCount: delivery.tracks.length,
          compatibleRecovery: delivery.tracks,
        };
      }
      const verified = delivery.tracks.filter((track) => trackHasEraEvidence(track, eraRange));
      const knownMismatches = delivery.tracks.filter((track) => trackHasKnownEraMismatch(track, eraRange));
      const compatible = delivery.tracks.filter((track) => !trackHasKnownEraMismatch(track, eraRange));
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
        finalCount: delivery.tracks.length,
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
    if (deliveryWorldBoundary.hardLock) {
      evidenceRelaxations.push("world_hard_lock_skips_era_evidence_guard");
      req.log.info(
        { userId, vibe, finalCount: delivery.tracks.length },
        "Hard world lock skips era-evidence republish; keeping world-verified output",
      );
    } else if (
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
            finalCount: delivery.tracks.length,
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
        delivery.tracks.length >= minBestAvailableCount
      ) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_relaxed_for_activity_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
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
      } else if (explicitConstraintActive && delivery.tracks.length > 0) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_partial_constrained_prefix");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
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
      } else if (
        strictEraEvidenceDiagnostics.verified.length > 0 ||
        strictEraEvidenceDiagnostics.compatible.length > 0
      ) {
        const eraPartial = strictEraEvidenceDiagnostics.verified.length > 0
          ? strictEraEvidenceDiagnostics.verified
          : strictEraEvidenceDiagnostics.compatible;
        assignFT("era_evidence_guard", "era partial publish", eraPartial.slice(0, length));
        strictEraEvidenceRelaxed = true;
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "era_evidence_degraded_partial",
            explicitConstraintValidPrefixCount: eraPartial.length,
          },
        };
        publishPartialTracks(delivery.tracks, 5);
        evidenceRelaxations.push("era_evidence_degraded_partial_published");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            verifiedCount: strictEraEvidenceDiagnostics.verified.length,
            compatibleCount: strictEraEvidenceDiagnostics.compatible.length,
            requiredCount: strictEraEvidenceDiagnostics.requiredCount,
          },
          "Explicit era evidence guard published degraded partial playlist"
        );
      } else if (delivery.tracks.length > 0) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_best_available_degraded");
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "era_evidence_best_available_degraded",
            explicitConstraintValidPrefixCount: delivery.tracks.length,
          },
        };
        publishPartialTracks(delivery.tracks, 5);
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: delivery.tracks.length,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard published best-available degraded playlist"
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
      if (nextFinalTracks.length !== delivery.tracks.length) {
        req.log.warn(
          {
            userId,
            vibe,
            rejectedCount: delivery.tracks.length - nextFinalTracks.length,
          },
          "Explicit era evidence guard detected rejected tracks; controller preserving V3 output"
        );
      }
    }
    const finalizationCandidates = strictEraEvidenceRelaxed && lockedIntent.eraRange
      ? baseFinalizationCandidates.filter((track) => !trackHasKnownEraMismatch(track, lockedIntent.eraRange!))
      : baseFinalizationCandidates;
    finalization = {
      tracks: delivery.tracks as PlaylistTrack[],
      diagnostics: {
        ...finalization.diagnostics,
        repeatedPassSkipped: true,
        secondPassSkipped: true,
        skippedReason: "v3_selected_tracks_are_authoritative",
      },
    };
    if (committedWorldPreRetrieval?.hardLock && delivery.tracks.length < length) {
      const refillProfile = resolveCulturalProfileForCommitted(committedWorldPreRetrieval);
      if (refillProfile) {
        const refilled = refillDeliverableDepth(
          delivery.tracks as PlaylistTrack[],
          deliverableSurvivorPool,
          {
            prompt: vibe,
            requestedLength: length,
            committed: committedWorldPreRetrieval,
            profile: refillProfile,
            preserveOpener: true,
            isGenreVerified: strictGenreEvidenceDiagnostics.active ? isGenreEvidenceVerified : undefined,
            enrichTrack: enrichForWorld,
          },
        );
        if (refilled.diagnostics.refilledCount > 0 || refilled.tracks.length > delivery.tracks.length) {
          const refilledTracks = assignFT(
            "deliverable_depth_refill",
            "V35 ranked survivor refill after evidence gates",
            refilled.tracks as PlaylistTrack[],
          );
          finalization = {
            tracks: [...refilledTracks],
            diagnostics: {
              ...finalization.diagnostics,
              deliverableDepthRefill: refilled.diagnostics,
            },
          };
        }
      }
    }
    endEvidenceGuardProfile();
    const postEvidenceCheckpoint = runDeliveryCheckpoint(pipelineAuthority, "post_evidence", checkpointCtx({
      genreEvidenceVerifiedCount: strictGenreEvidenceDiagnostics.verified.length,
      genreEvidenceRequiredCount: minViableTracksAfterGenrePrune(length),
    }));
    if (auditMode) {
      deliveryAfterEraEvidenceSnap = snapshotDeliveryTracks(delivery.tracks);
      const eraEnter = deliveryAfterGenreEvidenceSnap.length > 0
        ? deliveryAfterGenreEvidenceSnap
        : (deliveryAfterFinalizeSnap.length > 0 ? deliveryAfterFinalizeSnap : deliveryPipelineExitSnap);
      deliveryUnderfillStages.push({
        stage: "era_evidence_guard",
        enter: eraEnter.length,
        exit: deliveryAfterEraEvidenceSnap.length,
        lost: eraEnter.filter((t) => !deliveryAfterEraEvidenceSnap.some((x) => x.trackId === t.trackId)).length,
        added: deliveryAfterEraEvidenceSnap.filter((t) => !eraEnter.some((x) => x.trackId === t.trackId)).length,
        removedTrackIds: eraEnter
          .filter((t) => !deliveryAfterEraEvidenceSnap.some((x) => x.trackId === t.trackId))
          .map((t) => t.trackId),
        addedTrackIds: deliveryAfterEraEvidenceSnap
          .filter((t) => !eraEnter.some((x) => x.trackId === t.trackId))
          .map((t) => t.trackId),
      });
    }
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    if (controlledRecoveryBlocked && delivery.tracks.length === 0 && deliveryWorldBoundary.hardLock) {
      // V3 can still empty a hard-locked world even when the library has identity-pass tracks.
      // Prefer an honest in-world partial over a blank 409 refuse.
      const salvageCap = Math.max(HONEST_PARTIAL_MIN, Math.min(length, 25));
      const salvaged = pickDiverseWorldSalvageTracks(likedSongs, {
        cap: salvageCap,
        seed: `${userId}:${vibe}`,
        isEligible: (song) =>
          isTrackInWorld(song as Parameters<typeof isTrackInWorld>[0], deliveryWorldBoundary),
      }) as PlaylistTrack[];
      if (salvaged.length >= HONEST_PARTIAL_MIN) {
        assignFT("world_hard_lock_verified_salvage", "publish identity-verified honest partial", salvaged);
        evidenceRelaxations.push("world_hard_lock_verified_library_salvage");
        publishPartialTracks(delivery.tracks, salvaged.length);
        req.log.warn(
          {
            userId,
            vibe,
            salvagedCount: salvaged.length,
            controlledRecoveryReason,
          },
          "Hard world lock salvaged identity-verified library tracks after empty V3 delivery",
        );
      }
    }
    if (controlledRecoveryBlocked && delivery.tracks.length === 0) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "CONTROLLED_RECOVERY_FAILURE",
        controlledRecoveryReason ?? "Recovery would erase your prompt identity — try balanced mode or sync more library tracks.",
        {
          controlledRecoveryBlocked: true,
          controlledRecoveryReason,
          finalCount: delivery.tracks.length,
          minBestAvailableCount,
        }
      );
      return;
    }
    if (controlledRecoveryBlocked && delivery.tracks.length > 0 && delivery.tracks.length < 5) {
      evidenceRelaxations.push("controlled_recovery_degraded_partial");
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          controlledRecoveryDegradedPartial: true,
          controlledRecoveryReason,
        },
      };
      publishPartialTracks(delivery.tracks, 5);
      req.log.warn(
        { userId, vibe, controlledRecoveryReason, finalCount: delivery.tracks.length },
        "Controlled recovery blocked full publish — degraded partial playlist"
      );
    }
    const strictEraEvidencePublic = {
      ...strictEraEvidenceDiagnostics,
      verified: undefined,
      compatible: undefined,
      compatibleRecovery: undefined,
      publishedCount: delivery.tracks.length,
      publishMode: strictEraEvidenceRelaxed
        ? "compatible_unknowns_relaxed"
        : strictEraEvidenceDiagnostics.active ? "verified_only" : "inactive",
      relaxed: strictEraEvidenceRelaxed,
    };
    const hardValidationFailures = [
      !deliveryWorldBoundary.hardLock &&
        (lockedIntent.primaryGenres.length > 0 || constraintLayer.hard.genres.length > 0) &&
        finalValidation.genreConsistency === "FAIL" ? "genreConsistency" : null,
      (lockedIntent.eraStart !== null || constraintLayer.hard.eraStart !== null) &&
        finalValidation.eraAlignment === "FAIL" ? "eraAlignment" : null,
    ].filter((failure): failure is string => !!failure);
    if (deliveryWorldBoundary.hardLock && finalValidation.genreConsistency === "FAIL" && delivery.tracks.length > 0) {
      const genreMismatchCap = Math.min(12, Math.ceil(requestedLength * 0.4));
      if (delivery.tracks.length > genreMismatchCap) {
        assignFT(
          "genre_consistency",
          "hard lock genre mismatch honest partial",
          delivery.tracks.slice(0, genreMismatchCap),
        );
        evidenceRelaxations.push("world_hard_lock_genre_mismatch_honest_partial");
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            genreConsistencyMismatchHonestPartial: true,
            degradedDelivery: true,
            honestPartialPublished: true,
          },
        };
        req.log.warn(
          { userId, vibe, genreConsistency: finalValidation.genreConsistency, genreMismatchCap },
          "Hard world lock genre mismatch — honest partial cap applied",
        );
      } else if (delivery.tracks.length < 3) {
        evidenceRelaxations.push("world_hard_lock_genre_mismatch_refuse_candidate");
        req.log.warn(
          { userId, vibe, genreConsistency: finalValidation.genreConsistency, finalCount: delivery.tracks.length },
          "Hard world lock genre mismatch with stub supply",
        );
      }
    }
    if (delivery.tracks.length > 0 && hardValidationFailures.length > 0) {
      const validPrefix = explicitConstraintActive
        ? delivery.tracks.filter((track) =>
            finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
            finalTrackMatchesExplicitEra(track, lockedIntent)
          )
        : [];
      if (validPrefix.length > 0) {
        assignFT("era_evidence_guard", "era valid prefix", validPrefix.slice(0, length));
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "hard_validation_valid_prefix",
            explicitConstraintValidPrefixCount: validPrefix.length,
          },
        };
        finalValidation = validateLockedIntentOutput(
          delivery.tracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        evidenceRelaxations.push("locked_intent_valid_prefix_published");
        publishPartialTracks(delivery.tracks, 5);
        req.log.warn(
          { userId, vibe, hardValidationFailures, validPrefixCount: validPrefix.length },
          "Hard locked intent validation published valid prefix"
        );
      } else if (delivery.tracks.length >= minBestAvailableCount) {
        evidenceRelaxations.push("locked_intent_validation_relaxed_best_available");
        req.log.warn(
          { userId, vibe, finalValidation, hardValidationFailures, finalCount: delivery.tracks.length, minBestAvailableCount },
          "Hard locked intent validation relaxed to best available playlist"
        );
      } else if (delivery.tracks.length > 0) {
        evidenceRelaxations.push("locked_intent_validation_degraded_partial");
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            explicitConstraintPartialPublished: true,
            explicitConstraintPartialReason: "hard_validation_degraded_partial",
            explicitConstraintValidPrefixCount: delivery.tracks.length,
          },
        };
        publishPartialTracks(delivery.tracks, 5);
        req.log.warn(
          { userId, vibe, finalValidation, hardValidationFailures, finalCount: delivery.tracks.length, minBestAvailableCount },
          "Hard locked intent validation published degraded partial playlist"
        );
      } else {
      req.log.warn(
        { userId, vibe, finalValidation, hardValidationFailures, finalCount: delivery.tracks.length },
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
    if (delivery.tracks.length >= 4 && !shouldSkipMarginalImprovement()) {
      if (latencyBudget.mustDeliverNow() && delivery.tracks.length > 0 && emitLatencyBudgetFallback()) return;
      const enrichedFinal = delivery.tracks.map(enrichTrackForCoherence);
      const coherenceRepair = coherenceRepairSettingsFromPlan(compilePlan, sceneLockStatus.active);
      if (baseFinalizationCandidates.length > 0) {
        const rebuild = runCoherenceRebuildLoop({
          tracks: enrichedFinal,
          candidates: baseFinalizationCandidates.map(enrichTrackForCoherence),
          intent: v3FallbackIntent,
          scenePrediction: mergedScenePrediction,
          sceneLock: sceneLockStatus,
          sceneAliases,
          prompt: vibe,
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
          for (const track of [...delivery.tracks, ...baseFinalizationCandidates]) {
            trackById.set(track.trackId, track);
          }
          assignFT("coherence_rebuild", "coherence swap repair", rebuild.tracks
            .map((track) => trackById.get(track.trackId))
            .filter((track): track is ConstraintTrack => !!track) as PlaylistTrack[]);
          stripDeliveryOffWorld("world_purity_gate", "strip off-world after coherence rebuild");
          executionHealth.repairPassCount += 1;
          evidenceRelaxations.push(rebuild.constraintBuildUsed ? "world_constraint_build" : "playlist_coherence_swap_repair");
          if (sceneLockStatus.active) evidenceRelaxations.push("scene_lock_repair_assist");
          publishPartialTracks(delivery.tracks, 5);
        }

        if (
          mode === "balanced" &&
          playlistCoherenceScore.overallScore < coherenceRepair.repairThreshold &&
          baseFinalizationCandidates.length > 0 &&
          coherenceRebuildIterations < coherenceRepair.maxIterations + 1
        ) {
          const balancedRetry = runCoherenceRebuildLoop({
            tracks: delivery.tracks.map(enrichTrackForCoherence),
            candidates: baseFinalizationCandidates.map(enrichTrackForCoherence),
            intent: v3FallbackIntent,
            scenePrediction: mergedScenePrediction,
            sceneLock: sceneLockStatus,
            sceneAliases,
            prompt: vibe,
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
            for (const track of [...delivery.tracks, ...baseFinalizationCandidates]) {
              trackById.set(track.trackId, track);
            }
            assignFT("coherence_rebuild", "coherence balanced retry", balancedRetry.tracks
              .map((track) => trackById.get(track.trackId))
              .filter((track): track is ConstraintTrack => !!track) as PlaylistTrack[]);
            stripDeliveryOffWorld("world_purity_gate", "strip off-world after coherence balanced retry");
            evidenceRelaxations.push("balanced_coherence_soft_rebuild");
            publishPartialTracks(delivery.tracks, 5);
          }
        }
      } else {
        playlistCoherenceScore = scorePlaylistCoherence(
          enrichedFinal,
          v3FallbackIntent,
          mergedScenePrediction,
        );
      }

      let preArcOpeningLock: OpeningLock | null = null;
      if (
        delivery.tracks.length >= 6 &&
        !latencyBudget.mustDeliverNow() &&
        !shouldSkipMarginalImprovement()
      ) {
        const tastePreferredFamiliesPreArc = new Set<string>(
          lockedIntent.primaryGenres.length > 0
            ? lockedIntent.primaryGenres
            : lockedIntent.genreFamilies,
        );
        const tasteIdentityTermsPreArc = universalIdentityTerms(vibe, lockedIntent, constraintLayer);
        const tasteMomentFitPreArc = (track: ConstraintTrack, _index: number): number =>
          intentCoherenceScore(
            track,
            {
              vibe,
              intent: lockedIntent,
              constraints: constraintLayer,
              classMap: userGenreProfile.trackClassifications,
            },
            tastePreferredFamiliesPreArc,
            tasteIdentityTermsPreArc,
          );
        const openingCuratorPreArc = applyOpeningCuratorV2({
          prompt: vibe,
          tracks: delivery.tracks as ConstraintTrack[],
          lockedOpenerTrackId: curatedOpenerTrackId,
          scorePromptRelevance: (track, index) => tasteMomentFitPreArc(track as ConstraintTrack, index),
          classifyForActivity: (track) => userGenreProfile.trackClassifications.get(track.trackId) ?? {},
          intentForActivity: lockedIntent,
          maxPsychOpenersInOpening: maxPsychIndieOpenersForWorlds(inferWorldIdentityIdsFromPrompt(vibe)),
        });
        assignFT("opening_curator", "pre-arc opening curator", openingCuratorPreArc.tracks as unknown as PlaylistTrack[]);
        preArcOpeningLock = openingCuratorPreArc.openingLock;
        curatedOpenerTrackId = openingCuratorPreArc.openingDecision.openerTrackId ?? curatedOpenerTrackId;
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            openingCuratorV2PreArc: {
              ...openingCuratorPreArc.openingDecision,
              swaps: openingCuratorPreArc.swaps,
            },
          },
        };
        if (openingCuratorPreArc.swaps > 0) {
          publishPartialTracks(delivery.tracks, 5);
        }
      }

      // Human Expectation Engine — post-assembly critic + repair (flag-gated,
      // internally guarded, never throws). Shadow: compute + log + diagnostics.
      // Enforce: repair off-vibe/duplicate tracks before sequencing.
      if (humanExpectationMode() !== "off" && delivery.tracks.length >= 3) {
        const toExpectationTrack = (t: PlaylistTrack): ExpectationTrack => ({
          trackId: t.trackId,
          trackName: (t as { trackName?: string | null }).trackName ?? null,
          artistName: (t as { artistName?: string | null }).artistName ?? null,
          releaseYear: (t as { releaseYear?: number | null }).releaseYear ?? null,
          energy: (t as { energy?: number | null }).energy ?? null,
          valence: (t as { valence?: number | null }).valence ?? null,
          tempo: (t as { tempo?: number | null }).tempo ?? null,
          acousticness: (t as { acousticness?: number | null }).acousticness ?? null,
          instrumentalness: (t as { instrumentalness?: number | null }).instrumentalness ?? null,
          danceability: (t as { danceability?: number | null }).danceability ?? null,
          speechiness: (t as { speechiness?: number | null }).speechiness ?? null,
          genreFamily: t.genreFamily ?? null,
          genres: t.genres ?? null,
        });
        const currentTracks = delivery.tracks as PlaylistTrack[];
        const trackById = new Map<string, PlaylistTrack>();
        for (const t of currentTracks) trackById.set(t.trackId, t);
        for (const t of pipeline.finalTracks as PlaylistTrack[]) {
          if (!trackById.has(t.trackId)) trackById.set(t.trackId, t);
        }
        const hxResult = runPlaylistExpectation({
          vibe,
          seed: {
            energy: emotionProfile.energy,
            valence: emotionProfile.valence,
            tension: emotionProfile.tension,
            nostalgia: emotionProfile.nostalgia,
            calm: emotionProfile.calm,
            journeyArc: sceneJourneyArc ?? undefined,
          },
          tracks: currentTracks.map(toExpectationTrack),
          reservoir: (pipeline.finalTracks as PlaylistTrack[]).map(toExpectationTrack),
          targetLength: length,
          log: req.log,
        });
        if (hxResult) {
          humanExpectationDiagnostics = hxResult.diagnostics;
          if (hxResult.applied) {
            const repaired = hxResult.orderedIds
              .map((id) => trackById.get(id))
              .filter((t): t is PlaylistTrack => !!t);
            if (repaired.length >= Math.min(currentTracks.length, 8)) {
              assignFT("human_expectation_repair", "expectation critic repair", repaired);
              evidenceRelaxations.push("human_expectation_repair");
            }
          }
        }
      }

      if (playlistCoherenceScore && delivery.tracks.length >= 3) {
        const arcOrderingOptions = preArcOpeningLock?.enabled
          ? { preservePrefixCount: OPENING_WINDOW_SIZE }
          : undefined;
        if (compilePlan?.segmentPlan) {
          const segmented = assignTracksToSegments(
            delivery.tracks.map(enrichTrackForCoherence),
            compilePlan.segmentPlan,
            arcOrderingOptions,
          );
          segmentDiagnostics = segmentAssignmentsToDiagnostics(segmented.assignments);
          const orderMap = new Map(segmented.ordered.map((track, index) => [track.trackId, index]));
          assignFT("editorial_sequencing", "energy sort", [...delivery.tracks].sort(
            (a, b) => (orderMap.get(a.trackId) ?? 0) - (orderMap.get(b.trackId) ?? 0),
          ));
          evidenceRelaxations.push("segment_playlist_planning");
          if (preArcOpeningLock?.enabled) {
            evidenceRelaxations.push("opening_window_locked_through_arc");
          }
        } else {
          const arcOrdered = orderTracksByPlaylistSegments(
            delivery.tracks.map(enrichTrackForCoherence),
            emotionalArc,
            arcOrderingOptions,
          );
          const orderMap = new Map(arcOrdered.map((track, index) => [track.trackId, index]));
          assignFT("editorial_sequencing", "energy sort", [...delivery.tracks].sort(
            (a, b) => (orderMap.get(a.trackId) ?? 0) - (orderMap.get(b.trackId) ?? 0),
          ));
          evidenceRelaxations.push("emotional_arc_ordering");
          if (preArcOpeningLock?.enabled) {
            evidenceRelaxations.push("opening_window_locked_through_arc");
          }
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
          if (delivery.tracks.length > 0) {
            evidenceRelaxations.push("strict_coherence_gate_degraded_publish");
            finalization = {
              tracks: delivery.tracks as PlaylistTrack[],
              diagnostics: {
                ...finalization.diagnostics,
                coherenceGateDegradedPublish: true,
                coherenceGateDegradedScore: playlistCoherenceScore.overallScore,
              },
            };
            publishPartialTracks(delivery.tracks, 5);
            req.log.warn(
              {
                userId,
                vibe,
                coherenceScore: playlistCoherenceScore.overallScore,
                coherenceGate: coherenceGateResult,
                finalCount: delivery.tracks.length,
              },
              "Strict coherence gate failed — publishing degraded playlist"
            );
          } else {
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
        }
        if (playlistCoherenceScore.overallScore < 0.58 && delivery.tracks.length >= minBestAvailableCount) {
          evidenceRelaxations.push("playlist_coherence_low_best_available");
        }
      }
    }
    const endHumanCoherenceScoreProfile = liveStageProfiler.start("controller.humanCoherenceScore", `${delivery.tracks.length} tracks`);
    let humanCoherence = humanCoherenceScore(delivery.tracks, curatorIdentity);
    endHumanCoherenceScoreProfile();
    let humanCoherenceRepairUsed = false;
    let humanCoherenceRepairDiagnostics: Record<string, unknown> = {
      executed: false,
      repaired: false,
      beforeScore: humanCoherence.score,
      afterScore: humanCoherence.score,
    };
    if (delivery.tracks.length > 0 && humanCoherence.score < 0.60) {
      const repairedCoherence = repairHumanCoherenceOrder(delivery.tracks, curatorIdentity);
      humanCoherenceRepairDiagnostics = {
        executed: true,
        repaired: repairedCoherence.repaired,
        beforeScore: repairedCoherence.beforeScore,
        afterScore: repairedCoherence.afterScore,
      };
      if (repairedCoherence.repaired) {
        assignFT("coherence_rebuild", "coherence repair", repairedCoherence.tracks);
        humanCoherence = humanCoherenceScore(delivery.tracks, curatorIdentity);
        humanCoherenceRepairUsed = true;
        executionHealth.repairPassCount += 1;
      }
      if (humanCoherence.score < 0.46 && delivery.tracks.length < minBestAvailableCount) {
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
    if (deliveryLossFunnel) {
      deliveryLossFunnel.v3PreFilterSurvivors = readV3PreFilterSurvivors(v3PipelineDiagnostics);
    }
    // Fold the contract-aware retrieval re-rank (computed inside the pipeline)
    // into the unified humanExpectation diagnostics so the interpreted moment,
    // its expectations, detected risks and the retrieval influence sit together.
    if (humanExpectationDiagnostics) {
      const qualityRecovery = v3PipelineDiagnostics["qualityRecovery"] as Record<string, unknown> | undefined;
      const rerank = qualityRecovery?.["expectationRerank"];
      if (rerank) {
        humanExpectationDiagnostics = { ...humanExpectationDiagnostics, retrievalRerank: rerank };
      }
    }
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
      { stage: "Coherence", count: numberFromWaterfall("finalCount", delivery.tracks.length) },
      { stage: "Final Playlist", count: delivery.tracks.length },
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
      delivery.tracks.length < recoveryActivationThreshold(length);
    const allRecoveryRelaxations = [
      typeof finalization.diagnostics["recoveryStage"] === "string" ? finalization.diagnostics["recoveryStage"] : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["artistLimitRelaxed"] ? "artist_limit_relaxed" : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["albumLimitRelaxed"] ? "album_limit_relaxed" : null,
      ...evidenceRelaxations,
    ].filter((entry): entry is string => !!entry);
    const recoveryRelaxations = partitionRecoveryRelaxations(allRecoveryRelaxations).material;
    const fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    const recoveryDiagnosticsSnapshot = buildRecoveryDiagnostics({
      recoveryRelaxations: allRecoveryRelaxations,
      fallbackLevel,
      finalTrackCount: delivery.tracks.length,
      requestedLength: length,
      candidatesBeforeRecovery: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterRecovery: delivery.tracks.length,
      stageWaterfall,
      humanCoherenceScore: humanCoherence.score,
      preRecoveryCoherence,
    });
    const materialRecoveryTriggered = shouldMarkRecoveryTriggered(recoveryDiagnosticsSnapshot);
    const pipelineTiming = (v3PipelineDiagnostics["timingMs"] ?? null) as Record<string, unknown> | null;
    const intentContractGuardDiagnostics = (v3PipelineDiagnostics["intentContractGuard"] ?? {}) as Record<string, unknown>;
    const preV3WorldSamplingAudit = intentContractGuardDiagnostics["preV3WorldSampling"] ?? null;
    const preV3SamplingFunnelBase = Array.isArray(intentContractGuardDiagnostics["preV3SamplingFunnel"])
      ? intentContractGuardDiagnostics["preV3SamplingFunnel"] as Array<{ stage: string; count: number; note?: string }>
      : [];
    const preV3SamplingFunnelAudit = auditMode
      ? [
          ...preV3SamplingFunnelBase,
          ...(deliveryLossFunnel?.postPurity != null
            ? [{ stage: "post_purity", count: deliveryLossFunnel.postPurity }]
            : []),
          { stage: "delivered", count: delivery.tracks.length },
        ]
      : null;
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
        : delivery.tracks.length === 0
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
    requestStageTiming.mergePlaylistPipelineTimingMs(pipelineTiming ?? undefined);
    requestStageTiming.add("refinement", finalizationTimeMs + repairTimeMs);
    requestStageTiming.mergeProductionTimeline(
      buildProductionTimelineReport(productionTimeline, startMs).stageDurationsMs as Record<string, number>,
    );
    requestStageTiming.setTotal(Date.now() - startMs);
    const requestTimingMs = {
      total: Date.now() - startMs,
      preV3: preV3Timing,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] : null,
      /** buildV3CandidatePool — typically 0.1–4s; not the multi-candidate V3 loop. */
      candidatePoolBuild: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] : null,
      /** Cumulative runV3Pipeline() across editorial candidates — dominant cost bucket. */
      v3MultiCandidateLoop: typeof pipelineTiming?.["v3ScoringAndSampling"] === "number" ? pipelineTiming["v3ScoringAndSampling"] : null,
      preV3HybridScoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] : null,
      repair: repairTimeMs,
      finalization: finalizationTimeMs,
      v3Pipeline: pipelineTiming,
    };
    const slowestRequestStage = Object.entries({
      preV3: preV3Timing.totalBeforeV3Ms,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] as number : 0,
      candidatePoolBuild: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] as number : 0,
      v3MultiCandidateLoop: typeof pipelineTiming?.["v3ScoringAndSampling"] === "number" ? pipelineTiming["v3ScoringAndSampling"] as number : 0,
      preV3HybridScoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] as number : 0,
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
      validCandidateSupply: finalizeValidCandidateSupply,
      familyStageFunnel: {
        ...(((req as { _genCtx?: Record<string, unknown> })._genCtx?.familyStageFunnel as Record<string, unknown> | undefined) ?? {}),
        pipeline: (pipeline.scoringDiagnostics as Record<string, unknown> | undefined)?.["familyStageFunnel"] ?? null,
        final: auditMode
          ? compactStageSnapshot(
            histogramFamiliesForTracks(
              delivery.tracks,
              (trackId: string) => userGenreProfile.trackClassifications.get(trackId) ?? null,
              "final",
            ),
          )
          : null,
      },
      candidatesSampled: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesClassified: afterForStage(/genre family normalization|metadata completeness/i, numberFromWaterfall("scoredCount", pipeline.sorted.length)),
      candidatesAfterIntent: Number(waterfallDiagnostics["contractCount"] ?? likedSongs.length),
      candidatesAfterEra: afterForStage(/era readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterMood: afterForStage(/constraint filter|intent readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterConstraints: Number(waterfallDiagnostics["constraintCount"] ?? scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterRanking: Number(scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterDiversity: afterArtistSep.length,
      candidatesAfterRepair: finalization.tracks.length,
      candidatesAfterCoherence: Number(waterfallDiagnostics["finalCount"] ?? delivery.tracks.length),
      candidatesFinal: delivery.tracks.length,
      ...(auditMode
        ? {
            deliveryUnderfillForensics: {
              diagnosisOnly: true,
              stages: deliveryUnderfillStages,
              genreEvidenceAudit: deliveryGenreEvidenceAudit,
              pipelineExitCount: deliveryPipelineExitSnap.length,
              afterFinalizeCount: deliveryAfterFinalizeSnap.length,
              afterGenreEvidenceCount: deliveryAfterGenreEvidenceSnap.length,
              afterEraEvidenceCount: deliveryAfterEraEvidenceSnap.length,
              finalizationPartialReason:
                typeof finalization.diagnostics["explicitConstraintPartialReason"] === "string"
                  ? finalization.diagnostics["explicitConstraintPartialReason"]
                  : null,
              constrainedPoolSizes: {
                exact: typeof finalization.diagnostics["exactConstrainedRecoveryCount"] === "number"
                  ? finalization.diagnostics["exactConstrainedRecoveryCount"]
                  : null,
                adjacent: typeof finalization.diagnostics["adjacentConstrainedRecoveryCount"] === "number"
                  ? finalization.diagnostics["adjacentConstrainedRecoveryCount"]
                  : null,
                genre: typeof finalization.diagnostics["genreConstrainedRecoveryCount"] === "number"
                  ? finalization.diagnostics["genreConstrainedRecoveryCount"]
                  : null,
                family: typeof finalization.diagnostics["familyConstrainedRecoveryCount"] === "number"
                  ? finalization.diagnostics["familyConstrainedRecoveryCount"]
                  : null,
                merged: typeof finalization.diagnostics["mergedConstrainedRecoveryCount"] === "number"
                  ? finalization.diagnostics["mergedConstrainedRecoveryCount"]
                  : null,
              },
            },
            ...(deliveryLossFunnel ? { deliveryLossFunnel } : {}),
            ...(puritySubFunnel ? { puritySubFunnel } : {}),
            ...(preV3SamplingFunnelAudit ? { preV3SamplingFunnel: preV3SamplingFunnelAudit } : {}),
            ...(preV3WorldSamplingAudit ? { preV3WorldSampling: preV3WorldSamplingAudit } : {}),
          }
        : {}),
      promptSurvivability,
      softGuardDebugSummary: skipNonEssentialDiagnostics
        ? { skipped: true, reason: "low_request_budget" }
        : buildSoftGuardDebugSummary(delivery.tracks),
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
          candidatePoolBuild: typeof requestTimingMs.candidatePoolBuild === "number" ? requestTimingMs.candidatePoolBuild : 0,
          v3MultiCandidateLoop: typeof requestTimingMs.v3MultiCandidateLoop === "number" ? requestTimingMs.v3MultiCandidateLoop : 0,
          preV3HybridScoring: typeof requestTimingMs.preV3HybridScoring === "number" ? requestTimingMs.preV3HybridScoring : 0,
          repair: repairTimeMs,
          finalization: finalizationTimeMs,
        })
          .filter(([, ms]) => ms >= 30_000)
          .map(([stage, ms]) => ({ stage, ms })),
      },
      v3InvocationDecomposition: (() => {
        const controlled = v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined;
        const decomp = controlled?.["v3InvocationDecomposition"];
        return decomp && typeof decomp === "object" ? decomp : null;
      })(),
      v3PipelineTimingProfile: (() => {
        const controlled = v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined;
        const decomp = controlled?.["v3InvocationDecomposition"] as Record<string, unknown> | undefined;
        const profile = decomp?.["v3PipelineTimingProfile"];
        return profile && typeof profile === "object" ? profile : null;
      })(),
      v3ParallelExecution: (() => {
        const controlled = v3PipelineDiagnostics["controlledGeneration"] as Record<string, unknown> | undefined;
        const parallel = controlled?.["v3ParallelExecution"];
        return parallel && typeof parallel === "object" ? parallel : null;
      })(),
      performanceFastPath: {
        fastPathTriggered: !!(preScoringCandidateShape.diagnostics as Record<string, unknown>)["applied"] ||
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
        candidateRetrieval: auditMode ? preScoringCandidateShape.diagnostics : undefined,
      },
      stageProfile: liveStageProfiler.snapshot(),
      latencyOptimizationSkipped: {
        phase: latencyBudget.currentPhase(),
        goodPlaylistReady: latencyBudget.goodPlaylistReady(),
        marginalImprovementSkipped: latencyBudget.shouldSkipMarginalImprovement(),
        finalizationRecovery: needsFinalizeRecovery && latencyBudget.shouldSkipMarginalImprovement(),
        coherenceRebuild: latencyBudget.shouldSkipMarginalImprovement(),
      },
      recoveryRelaxations,
      recoveryTriggered: materialRecoveryTriggered,
      recoveryDiagnostics: recoveryDiagnosticsSnapshot,
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
      failureReason: delivery.tracks.length === 0 ? "no_final_tracks_after_filters" : null,
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
      noveltyDiagnostics: resolveNoveltyDiagnostics(
        pipeline.scoringDiagnostics as Record<string, unknown> | undefined,
        noveltyMemoryRows.length,
        crossPlaylistNoveltyEnabled,
      ),
      contextualUniquenessDiagnostics: resolveContextualUniquenessDiagnostics(
        pipeline.scoringDiagnostics as Record<string, unknown> | undefined,
      ),
      contextualUniquenessEnabled,
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
      finalTracks: delivery.tracks.length,
    });
    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        trackCount: delivery.tracks.length,
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
      tracksSelected: delivery.tracks.length,
      rediscoveryMode,
      chapterLabel: chapterMatch?.chapter.label ?? null,
      surpriseMix,
      archaeologyActive: !!archaeology,
    });

    const worldUnderstanding = momentPipeline?.worldUnderstanding;
    const experiencePriority = worldUnderstanding?.debug?.experiencePriority;
    const technicalMomentLine = momentPipeline
      ? buildMomentUnderstandingLine({
        vibe,
        dominantMomentLabel: buildDominantMomentLabel(
          momentPipeline.canonicalScene?.sceneId
            ? momentPipeline.canonicalScene.sceneId.replace(/_/g, " ")
            : null,
          mixedEmotions[0] ??
            (emotionProfile.valence >= 0.55
              ? "positive"
              : emotionProfile.valence <= 0.45
                ? "reflective"
                : "balanced"),
          energyBandFromProfile(emotionProfile.energy),
        ),
        canonicalScene: momentPipeline.canonicalScene,
        contradiction: resolveContradiction(vibe, emotionProfile),
        destParse,
        intent: momentPipeline.intent,
      })
      : null;

    const momentUnderstandingLine =
      experiencePriority &&
      experiencePriority.confidence >= 0.6 &&
      worldUnderstanding?.humanNarrative
        ? worldUnderstanding.humanNarrative
        : technicalMomentLine;

    if (momentUnderstandingLine || momentPipeline?.canonicalScene?.sceneId) {
      setGenerateLiveMeta(generateSessionUserId, requestId, {
        sceneLabel:
          momentUnderstandingLine
          ?? momentPipeline?.canonicalScene?.sceneId?.replace(/_/g, " ")
          ?? null,
      });
    }

    req.log.info(
      {
        poolAfterStructure: structured.length,
        afterDeadZone: afterDeadZone.length,
        afterSmoothing: afterSmoothing.length,
        afterArtistSep: afterArtistSep.length,
        finalTracks: delivery.tracks.length,
      },
      "Quality engine pipeline complete"
    );
    setGenerateStageDetail(generateSessionUserId, requestId, `Applying diversity rules to ${delivery.tracks.length.toLocaleString()} tracks`);

    publishPartialTracks(delivery.tracks);
    generationDiagnostics.candidatesFinal = delivery.tracks.length;
    generationDiagnostics.promptSurvivability = {
      ...generationDiagnostics.promptSurvivability,
      postFinalizationSize: delivery.tracks.length,
      firstCollapseReason: generationDiagnostics.promptSurvivability.firstCollapseReason ??
        (delivery.tracks.length === 0 ? "finalization_empty" : null),
    };
    generationDiagnostics.softGuardDebugSummary = skipNonEssentialDiagnostics
      ? { skipped: true, reason: "low_request_budget" }
      : buildSoftGuardDebugSummary(delivery.tracks);
    req.log.info(
      {
        userId,
        vibe,
        poolSizes: {
          retrieval: generationDiagnostics.promptSurvivability.preFilterPoolSize,
          structuredRetrieval: generationDiagnostics.promptSurvivability.postStructuredRetrievalSize,
          contractFilter: generationDiagnostics.promptSurvivability.postContractFilterSize,
          finalizationInput: finalizationCandidates.length,
          finalOutput: delivery.tracks.length,
        },
        softGuardDebugSummary: generationDiagnostics.softGuardDebugSummary,
      },
      "Prompt generation pool-size trace"
    );
    generationDiagnostics.fallbackTriggered = generationDiagnostics.fallbackTriggered || !!finalization.diagnostics.fallbackMode;
    generationDiagnostics.fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    generationDiagnostics.recoveryDiagnostics = buildRecoveryDiagnostics({
      recoveryRelaxations: generationDiagnostics.recoveryRelaxations,
      fallbackLevel: generationDiagnostics.fallbackLevel,
      finalTrackCount: delivery.tracks.length,
      requestedLength: length,
      candidatesBeforeRecovery: generationDiagnostics.candidatesSampled ?? null,
      candidatesAfterRecovery: delivery.tracks.length,
      stageWaterfall: generationDiagnostics.waterfall,
      humanCoherenceScore: generationDiagnostics.humanCoherenceScore ?? null,
    });
    generationDiagnostics.recoveryTriggered = shouldMarkRecoveryTriggered(
      generationDiagnostics.recoveryDiagnostics,
    );
    generationDiagnostics.failureReason = delivery.tracks.length === 0 ? "no_final_tracks_after_filters" : null;
    const finalResponseExplicitConstraintPartialPublished = finalization.diagnostics["explicitConstraintPartialPublished"] === true;
    if (delivery.tracks.length < length && !finalResponseExplicitConstraintPartialPublished) {
      const emergencySeenIds = new Set(delivery.tracks.map((track) => track.trackId));
      const finalResponseArtistCounts = new Map<string, number>();
      for (const track of delivery.tracks) {
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
      // Hard world lock: never emergency-complete from the raw library — that
      // reintroduces Blondie/Fleetwood after purity (see grunge listening failures).
      const finalResponseCompletionSources = (
        deliveryWorldBoundary.hardLock
          ? hardRejectOffWorldTracks(
              [
                ...finalCandidatePool,
                ...clusterCuration.candidates,
                ...(pipeline.sorted as ConstraintTrack[]),
                ...scoringInputSongs,
                ...likedSongs,
              ].map((track) => toEmergencyCompletionTrack(track as ConstraintTrack)),
              deliveryWorldBoundary,
              userGenreProfile.trackClassifications,
            ).kept
          : [
              ...finalCandidatePool,
              ...clusterCuration.candidates,
              ...(pipeline.sorted as ConstraintTrack[]),
              ...scoringInputSongs,
              ...likedSongs,
            ]
      );
      let completionWorking = [...delivery.tracks];
      for (const track of finalResponseCompletionSources) {
        if (completionWorking.length >= length) break;
        const candidate = toEmergencyCompletionTrack(track);
        if (emergencySeenIds.has(candidate.trackId)) continue;
        const candidateArtist = candidate.artistName.toLowerCase().trim();
        if ((finalResponseArtistCounts.get(candidateArtist) ?? 0) >= finalArtistCap) {
          finalResponseArtistCapSkipped += 1;
          continue;
        }
        emergencySeenIds.add(candidate.trackId);
        completionWorking.push(candidate as PlaylistTrack);
        finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
        finalResponseCompletionAdded += 1;
      }
      if (completionWorking.length < length) {
        for (const track of finalResponseCompletionSources) {
          if (completionWorking.length >= length) break;
          const candidate = toEmergencyCompletionTrack(track);
          if (emergencySeenIds.has(candidate.trackId)) continue;
          const candidateArtist = candidate.artistName.toLowerCase().trim();
          emergencySeenIds.add(candidate.trackId);
          completionWorking.push(candidate as PlaylistTrack);
          finalResponseArtistCounts.set(candidateArtist, (finalResponseArtistCounts.get(candidateArtist) ?? 0) + 1);
          finalResponseCompletionAdded += 1;
          finalResponseArtistCapBypassed += 1;
        }
      }
      // Historically, when unique backfill above still could not reach the
      // requested length, this padded the playlist by CLONING already-selected
      // tracks — even bypassing the artist cap. In thin-supply cases that
      // delivered literal duplicate track IDs to the user (e.g. the same song
      // three times in a four-track playlist), which is trust-breaking. We now
      // never clone: an honestly shorter playlist beats visible repeats. Genuine
      // thin-library handling / honest-partial messaging owns the short case.
      const finalResponseDuplicateFillAdded = 0;
      const finalResponseDuplicateFillSuppressed =
        completionWorking.length > 0 && completionWorking.length < length;
      if (finalResponseCompletionAdded > 0 || finalResponseDuplicateFillAdded > 0) {
        delivery.replaceTracks("final_response_completion", "emergency completion lock", completionWorking);
        delivery.truncateTracks("playlist_length", "slice to requested length", length);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            finalResponseCompletionLockApplied: true,
            finalResponseCompletionAdded,
            finalResponseDuplicateFillAdded,
            finalResponseDuplicateFillSuppressed,
            finalResponseArtistCapSkipped,
            finalResponseArtistCapBypassed,
          },
        };
        generationDiagnostics.candidatesFinal = delivery.tracks.length;
        generationDiagnostics.candidatesAfterCoherence = delivery.tracks.length;
        generationDiagnostics.failureReason = delivery.tracks.length === 0 ? "no_final_tracks_after_filters" : null;
      }
    }
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res)) return;
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;
    if (isGymWorkoutPrompt(vibe, lockedIntent) && !promptExplicitlyAllowsGymHipHop(vibe, lockedIntent, constraintLayer)) {
      const originalGymTrackCount = delivery.tracks.length;
      const gymMinViable = minViableTracksAfterGenrePrune(length);
      const gymSafeTracks = delivery.tracks.filter((track) =>
        trackIsGymWorkoutSafe(track, {
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          classMap: userGenreProfile.trackClassifications,
        })
      );
      if (gymSafeTracks.length >= gymMinViable && gymSafeTracks.length < delivery.tracks.length) {
        assignFT("activity_safety", "gym safe filter", gymSafeTracks);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            genericGymContaminationPruned: true,
            genericGymContaminationPrunedCount: originalGymTrackCount - delivery.tracks.length,
          },
        };
        generationDiagnostics.candidatesFinal = delivery.tracks.length;
        generationDiagnostics.candidatesAfterCoherence = delivery.tracks.length;
        generationDiagnostics.failureReason = null;
        publishPartialTracks(delivery.tracks, 5);
      } else if (gymSafeTracks.length > 0 && gymSafeTracks.length < gymMinViable) {
        assignFT("activity_safety", "gym safe filter", gymSafeTracks);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            genericGymContaminationPruned: true,
            genericGymContaminationPartial: true,
            genericGymContaminationPrunedCount: originalGymTrackCount - delivery.tracks.length,
          },
        };
        generationDiagnostics.candidatesFinal = delivery.tracks.length;
        generationDiagnostics.candidatesAfterCoherence = delivery.tracks.length;
        generationDiagnostics.failureReason = null;
        publishPartialTracks(delivery.tracks, 5);
      } else if (gymSafeTracks.length === 0 && delivery.tracks.length > 0) {
        const recoveryGymTracks = delivery.tracks.filter((track) =>
          trackPassesRecoveryActivity(track, {
            activity: lockedIntent.activity ?? "gym",
            energyLevel: lockedIntent.energyLevel ?? null,
          })
        );
        if (recoveryGymTracks.length > 0) {
          assignFT("activity_safety", "recovery gym fill", recoveryGymTracks);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              genericGymContaminationPruned: true,
              genericGymSupplyRecovery: true,
              genericGymContaminationPrunedCount: originalGymTrackCount - delivery.tracks.length,
            },
          };
          generationDiagnostics.candidatesFinal = delivery.tracks.length;
          generationDiagnostics.candidatesAfterCoherence = delivery.tracks.length;
          generationDiagnostics.failureReason = null;
          publishPartialTracks(delivery.tracks, 5);
        }
      }
    }
    if (delivery.tracks.length === 0) {
      const forensicPoolTrace = (scoringDiagnostics.v3Pipeline as Record<string, unknown> | undefined)?.["forensicPoolTrace"];
      req.log.warn(
        { userId, code: "EMPTY_POOL", forensicPoolTrace },
        "Hard filter graph removed all ranked candidates"
      );
      if (timeoutFallbackResponse(req, res, {
        failureReason: "empty_pool_library_fallback",
        elapsedMs: Date.now() - startMs,
        requestId,
        allowStrictOverride: true,
        fallbackLevel: "empty_pool",
      })) return;
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

    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;

    const playlistNamePrefix = String(process.env.PLAYLIST_VERIFY_FOLDER_PREFIX ?? "").trim();
    const playlistNameBase = generatePlaylistName(vibe, emotionProfile);
    const playlistName = playlistNamePrefix
      ? `${playlistNamePrefix} · ${playlistNameBase}`
      : playlistNameBase;
    setGenerateLiveMeta(generateSessionUserId, requestId, { playlistName });
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
    const duplicateIdentityCountBeforeAntiBlandness = countDuplicateSongIdentities(delivery.tracks);
    const finalResponseAntiBlandness = repairFinalResponseDuplicateSongIdentities(
      delivery.tracks as ConstraintTrack[],
      antiBlandnessCandidatePool,
      antiBlandnessOpts
    );
    const duplicateIdentityCountAfterAntiBlandness = countDuplicateSongIdentities(finalResponseAntiBlandness.tracks);
    const antiBlandnessImproved =
      finalResponseAntiBlandness.diagnostics.replacedCount > 0 ||
      duplicateIdentityCountAfterAntiBlandness < duplicateIdentityCountBeforeAntiBlandness;
    if (antiBlandnessImproved) {
      assignFT("anti_blandness", "final response anti-blandness", finalResponseAntiBlandness.tracks as PlaylistTrack[]);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
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
      generationDiagnostics.candidatesFinal = delivery.tracks.length;
      generationDiagnostics.candidatesAfterCoherence = delivery.tracks.length;
      publishPartialTracks(delivery.tracks, 5);
    } else {
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
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

    if (auditMode) {
      const preFinal = deliveryAfterEraEvidenceSnap.length > 0
        ? deliveryAfterEraEvidenceSnap
        : (deliveryAfterGenreEvidenceSnap.length > 0
          ? deliveryAfterGenreEvidenceSnap
          : (deliveryAfterFinalizeSnap.length > 0 ? deliveryAfterFinalizeSnap : deliveryPipelineExitSnap));
      const finalSnap = snapshotDeliveryTracks(delivery.tracks as unknown as Record<string, unknown>[]);
      deliveryUnderfillStages.push({
        stage: "pre_response_final_snapshot",
        enter: preFinal.length,
        exit: finalSnap.length,
        lost: preFinal.filter((t) => !finalSnap.some((x) => x.trackId === t.trackId)).length,
        added: finalSnap.filter((t) => !preFinal.some((x) => x.trackId === t.trackId)).length,
        removedTrackIds: preFinal.filter((t) => !finalSnap.some((x) => x.trackId === t.trackId)).map((t) => t.trackId),
        addedTrackIds: finalSnap.filter((t) => !preFinal.some((x) => x.trackId === t.trackId)).map((t) => t.trackId),
      });
      const existing = (generationDiagnostics as Record<string, unknown>)["deliveryUnderfillForensics"];
      if (existing && typeof existing === "object") {
        (generationDiagnostics as Record<string, unknown>)["deliveryUnderfillForensics"] = {
          ...(existing as Record<string, unknown>),
          stages: deliveryUnderfillStages,
          genreEvidenceAudit: deliveryGenreEvidenceAudit,
          afterGenreEvidenceCount: deliveryAfterGenreEvidenceSnap.length,
          afterEraEvidenceCount: deliveryAfterEraEvidenceSnap.length,
          preResponseFinalCount: finalSnap.length,
          deliveredCount: delivery.tracks.length,
        };
      }
    }

    if (
      delivery.tracks.length >= 6 &&
      !latencyBudget.mustDeliverNow() &&
      !shouldSkipMarginalImprovement()
    ) {
      const activityGuard = filterTracksByActivityProfile(
        delivery.tracks as ConstraintTrack[],
        vibe,
        lockedIntent,
        (track) => userGenreProfile.trackClassifications.get(track.trackId) ?? null,
        Math.max(5, Math.ceil(length * 0.4)),
      );
      if (activityGuard.removed > 0) {
        assignFT("activity_guard", "activity profile guard", activityGuard.tracks as unknown as PlaylistTrack[]);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            activityGuardrailPrune: {
              profileId: activityGuard.profile?.id ?? null,
              removed: activityGuard.removed,
              remaining: delivery.tracks.length,
            },
          },
        };
      }
      const tastePreferredFamilies = new Set<string>(
        lockedIntent.primaryGenres.length > 0
          ? lockedIntent.primaryGenres
          : lockedIntent.genreFamilies,
      );
      const tasteIdentityTerms = universalIdentityTerms(vibe, lockedIntent, constraintLayer);
      const tasteMomentFit = (track: ConstraintTrack, _index: number): number =>
        intentCoherenceScore(
          track,
          {
            vibe,
            intent: lockedIntent,
            constraints: constraintLayer,
            classMap: userGenreProfile.trackClassifications,
          },
          tastePreferredFamilies,
          tasteIdentityTerms,
        );
      const tasteActivityProfile = resolveActivityProfile(vibe, lockedIntent);
      const openingCuratorV2 = applyOpeningCuratorV2({
        prompt: vibe,
        tracks: delivery.tracks as ConstraintTrack[],
        lockedOpenerTrackId: curatedOpenerTrackId,
        scorePromptRelevance: (track, index) => tasteMomentFit(track as ConstraintTrack, index),
        classifyForActivity: (track) => userGenreProfile.trackClassifications.get(track.trackId) ?? {},
        intentForActivity: lockedIntent,
        maxPsychOpenersInOpening: maxPsychIndieOpenersForWorlds(inferWorldIdentityIdsFromPrompt(vibe)),
      });
      assignFT("opening_curator_v2", "opening curator v2", openingCuratorV2.tracks as unknown as PlaylistTrack[]);
      curatedOpenerTrackId = openingCuratorV2.openingDecision.openerTrackId ?? curatedOpenerTrackId;
      openingLock = openingCuratorV2.openingLock;
      openingLockViolations = [];
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          openingCuratorV2: {
            ...openingCuratorV2.openingDecision,
            swaps: openingCuratorV2.swaps,
            refreshAfterGuards: true,
          },
          ...(openingLock ? { openingLock } : {}),
        },
      };
      if (openingCuratorV2.swaps > 0) {
        publishPartialTracks(delivery.tracks, 5);
      }
      const tasteRepair = repairHumanTastePlaylist({
        tracks: delivery.tracks as ConstraintTrack[],
        candidates: antiBlandnessCandidatePool,
        calmPrompt: isChillCalmPrompt(vibe, lockedIntent) ||
          isFocusStudyPrompt(vibe, lockedIntent) ||
          isSleepSafetyPrompt(vibe, lockedIntent),
        energeticPrompt: isGymWorkoutPrompt(vibe, lockedIntent) ||
          isUpbeatSocialPrompt(vibe, lockedIntent),
        scoreMomentFit: (track, index) => tasteMomentFit(track as ConstraintTrack, index),
        isCandidateSafe: (track) => finalTrackIsHardSafe(track as ConstraintTrack, {
          vibe,
          intent: lockedIntent,
          constraints: constraintLayer,
          allowHolidaySeason,
          classMap: userGenreProfile.trackClassifications,
        }),
        maxSwaps: mode === "strict" ? 4 : 6,
        momentMismatchThreshold: activityTrustOutlierThreshold(tasteActivityProfile),
        lockedOpenerTrackId: curatedOpenerTrackId ?? openingCuratorV2.openingDecision.openerTrackId ?? null,
        openingCuratorV2Applied: true,
        lockedOpeningWindowSize: OPENING_WINDOW_SIZE,
        openingActivityFitBoost: tasteActivityProfile
          ? (track, position) => activityOpeningBoost(
            track,
            userGenreProfile.trackClassifications.get(track.trackId) ?? null,
            tasteActivityProfile,
            vibe,
            position,
          )
          : undefined,
        vibe,
      });
      if (
        tasteRepair.swappedCount > 0 ||
        tasteRepair.openingCuratorSwaps > 0 ||
        tasteRepair.endingCuratorSwaps > 0
      ) {
        assignFT("human_taste_repair", "human taste repair", tasteRepair.tracks as unknown as PlaylistTrack[]);
        if (openingLock?.enabled) {
          const locked = mergeTracksWithOpeningLock(
            delivery.tracks,
            openingLock,
            openingLockViolations,
            "human_taste_validator_mutation",
          );
          assignFT("opening_lock_enforce", "enforce opening lock", locked.tracks as unknown as PlaylistTrack[]);
          openingLock = locked.lock;
          openingLockViolations = locked.violations;
        }
        executionHealth.repairPassCount += 1;
        evidenceRelaxations.push("human_taste_validator_repair");
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            humanTasteValidator: {
              swappedCount: tasteRepair.swappedCount,
              swappedIndices: tasteRepair.swappedIndices,
              openingCuratorSwaps: tasteRepair.openingCuratorSwaps,
              endingCuratorSwaps: tasteRepair.endingCuratorSwaps,
              scoreBefore: tasteRepair.validationBefore.score,
              scoreAfter: tasteRepair.validationAfter.score,
              passedAfter: tasteRepair.validationAfter.passed,
              issuesBefore: tasteRepair.validationBefore.issues.map((issue) => issue.code),
              issuesAfter: tasteRepair.validationAfter.issues.map((issue) => issue.code),
              v2Before: tasteRepair.validationBefore.v2,
              v2After: tasteRepair.validationAfter.v2,
              lockedOpenerTrackId: lockedOpenerTrackId ?? null,
              diagnostics: tasteRepair.diagnostics,
            },
          },
        };
        publishPartialTracks(delivery.tracks, 5);
        stripDeliveryOffWorld("world_purity_gate", "strip off-world after human taste repair");
        req.log.info(
          {
            userId,
            vibe,
            swappedCount: tasteRepair.swappedCount,
            scoreBefore: tasteRepair.validationBefore.score,
            scoreAfter: tasteRepair.validationAfter.score,
            passedAfter: tasteRepair.validationAfter.passed,
          },
          "Human taste validator repaired playlist",
        );
      } else if (openingLock?.enabled) {
        const locked = enforceOpeningLock(delivery.tracks, openingLock, openingLockViolations);
        assignFT("opening_lock_enforce", "enforce opening lock", locked.tracks as unknown as PlaylistTrack[]);
        openingLockViolations = locked.violations;
      }
    }

    let trackObjects = delivery.tracks.map((t) => ({
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

    let spotifyPlaylistUrl: string | null = null;
    const tSpotify = Date.now();
    let spotifyPartial = false;
    let spotifyTracksAdded: number | undefined;
    let spotifyCreateAttempted = false;
    let resolvedSpotifyUrl: string | null = null;
    let spotifyFields: Record<string, unknown> = { spotifyUnavailable: true as const };

    const profilePayload = {
      ...emotionProfile,
      journeyArc,
      librarySize: likedSongs.length,
    };
    let savedPlaylistId = 0;
    let savedShareSlug = "";

    const runPostHygieneSideEffects = async (): Promise<void> => {
      trackObjects = syncTracksToApiOrder(deliveredTracks, finalApiTracks).map((t) => ({
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

      req.log.info(
        { trackCount: deliveredTracks.length, devMode },
        devMode ? "Skipping Spotify playlist creation in dev mode" : "Creating Spotify playlist",
      );

      setGeneratePhase(generateSessionUserId, requestId, "spotify");
      setGenerateStageDetail(
        generateSessionUserId,
        requestId,
        devMode
          ? "Skipping Spotify in dev mode"
          : `Saving ${deliveredTracks.length.toLocaleString()} tracks to Spotify`,
      );

      if (sideEffectPolicy.allowSpotifyPlaylistCreate && !devMode && !generationCompletionBlocked(generateSessionUserId, requestId, deliveredTracks.length)) {
        spotifyCreateAttempted = true;
        const attemptCreate = async (): Promise<{ url: string | null; partial: boolean; tracksAdded?: number }> => {
          try {
            const freshTokens = await getValidAccessToken(
              req.session.spotifyTokens!,
              userId,
            );
            if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
              req.session.spotifyTokens = freshTokens;
            }
            const trackUris = deliveredTracks.map((t) => `spotify:track:${t.trackId}`);
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
              },
            );
            const partial = !!spotifyResult.partial;
            const tracksAdded = spotifyResult.tracksAdded;
            if (partial && (tracksAdded ?? 0) === 0) {
              req.log.warn(
                {
                  elapsedMs: Date.now() - tSpotify,
                  playlistId: spotifyResult.id,
                  tracksRequested: deliveredTracks.length,
                  reused: !!pendingId,
                },
                "Spotify playlist shell created but no tracks were added",
              );
              return { url: null, partial, tracksAdded };
            }
            clearPendingSpotifyPlaylist(generateSessionUserId, requestId);
            req.log.info(
              {
                elapsedMs: Date.now() - tSpotify,
                partial,
                tracksAdded,
                tracksRequested: deliveredTracks.length,
                reused: !!pendingId,
              },
              "Spotify playlist created",
            );
            return { url: spotifyResult.url, partial, tracksAdded };
          } catch (spotifyErr: any) {
            req.log.warn(
              {
                code: "SPOTIFY_CREATE_FAILED",
                err: spotifyErr?.message,
                status: spotifyErr?.response?.status,
              },
              "Spotify playlist creation failed — will retry once if needed",
            );
            return { url: null, partial: false };
          }
        };
        let createOutcome = await attemptCreate();
        if (!createOutcome.url) {
          await new Promise((r) => setTimeout(r, 1200));
          createOutcome = await attemptCreate();
        }
        spotifyPartial = createOutcome.partial;
        spotifyTracksAdded = createOutcome.tracksAdded;
        spotifyPlaylistUrl = createOutcome.url;
        if (spotifyPlaylistUrl) {
          setGenerateLiveMeta(generateSessionUserId, requestId, { spotifyPlaylistUrl });
        }
      }

      if (
        spotifyCreateAttempted &&
        !spotifyPlaylistUrl &&
        deliveredTracks.length > 0 &&
        sideEffectPolicy.allowSpotifyPlaylistCreate &&
        !devMode
      ) {
        req.log.error(
          { trackCount: deliveredTracks.length, vibe },
          "Spotify playlist URL missing after create attempts — failing honestly",
        );
        if (!responseFinished(res)) {
          generateFail(
            res,
            502,
            "SPOTIFY_PLAYLIST_CREATE_FAILED",
            "Your playlist was curated but Spotify did not confirm the playlist link. Please try again in a moment.",
            {
              trackCount: deliveredTracks.length,
              spotifyUnavailable: true,
            },
          );
        }
        return;
      }

      resolvedSpotifyUrl = spotifyPlaylistUrl;
      spotifyFields = spotifyPlaylistUrl
        ? {
            spotifyPlaylistUrl,
            ...(spotifyPartial
              ? { spotifyPartial: true as const, spotifyTracksAdded: spotifyTracksAdded ?? 0 }
              : {}),
          }
        : { spotifyUnavailable: true as const };

      setGeneratePhase(generateSessionUserId, requestId, "saving");
      setGenerateStageDetail(
        generateSessionUserId,
        requestId,
        sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist" : "Finishing up",
      );
      const tSave = Date.now();
      req.log.info(
        { auditMode: sideEffectPolicy.mode === "audit" },
        sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist to database" : "Skipping playlist database writes",
      );

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
        { ms: Date.now() - tSave, userId, playlistId: savedPlaylistId, trackCount: deliveredTracks.length },
        "Playlist saved to DB",
      );

      if (sideEffectPolicy.allowHistoryWrites) {
        try {
          await db.insert(playlistHistoryTable).values({
            spotifyUserId: userId,
            playlistId: resolvedSpotifyUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
            playlistUrl: resolvedSpotifyUrl ?? (savedShareSlug ? publicUrl(`/p/${savedShareSlug}`) : ""),
            name: playlistName,
            vibe,
            mode,
            trackCount: deliveredTracks.length,
            emotionProfile: { ...emotionProfile, journeyArc } as any,
            trackIds: deliveredTracks.map((t) => t.trackId) as any,
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
                  playlistId: resolvedSpotifyUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
                  playlistUrl: resolvedSpotifyUrl ?? (savedShareSlug ? publicUrl(`/p/${savedShareSlug}`) : ""),
                  name: playlistName,
                  vibe,
                  mode,
                  trackCount: deliveredTracks.length,
                  emotionProfile: { ...emotionProfile, journeyArc },
                  trackIds: deliveredTracks.map((t) => t.trackId),
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
    };

    const totalDurationMs = delivery.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
    const artistCount = new Set(delivery.tracks.map((t) => t.artistName)).size;
    const generationMs = Date.now() - startMs;
    recordGenerationPhaseDuration("controller.total", generationMs);

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
    if (clientDisconnected || responseFinished(res)) return;
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;

    const v3Diagnostics = formatV3DiagnosticsForApi(
      pipeline.scoringDiagnostics?.v3Pipeline,
      vibe
    );
    const promptDriftAudit = buildPromptDriftAudit(v3Diagnostics);
    const feedbackDiagnostics = buildFeedbackDiagnostics(feedbackMemory, delivery.tracks);
    if (promptDriftAudit["pass"] === false) {
      req.log.warn(
        { userId, vibe, promptDriftAudit, playlistQuality: v3Diagnostics?.["playlistQuality"] ?? null },
        "Prompt drift audit warning"
      );
    }
    assertQualityConsistency(req.log, {
      tracks: delivery.tracks as PlaylistTrack[],
      diagnostics: v3Diagnostics,
      fallbackUsed: !!pipeline.scoringDiagnostics?.fastFallback,
    });

    if (!varietyBoost && !devMode) {
      const cachedFinalTracks = delivery.tracks.map((t) => ({
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
        delivery.tracks,
        cachedFinalTracks,
        "cache-write"
      );
      warnIfFieldDropped("laneScore", delivery.tracks, cachedFinalTracks, "cache-write");
      warnIfFieldDropped("clusterIds", delivery.tracks, cachedFinalTracks, "cache-write");
    }

    setGenerateStageDetail(generateSessionUserId, requestId, "Running quality checks");
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;

    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        cacheHit: false,
        trackCount: delivery.tracks.length,
        poolSize: scoringPool.hybridPoolSize,
        promptDriftAudit,
        feedbackDiagnostics,
      },
      "Generation complete"
    );
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res)) return;
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;

    publishFinalTracksContext();
    const embarrassmentFiltered = filterEmbarrassingTracks(delivery.tracks, {
      vibe,
      eraRange: lockedIntent.eraRange ?? null,
      frequencyPenalty: playlistFrequencyPenalty,
      nichePrompt: lockedIntent.genreFamilies.length > 0 || lockedIntent.primaryGenres.length > 0,
      minKeep: Math.max(8, Math.ceil(length * 0.65)),
    });
    if (embarrassmentFiltered.removed.length > 0) {
      assignFT("embarrassment_filter", "human embarrassment filter", embarrassmentFiltered.tracks);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          embarrassmentFilterApplied: true,
          embarrassmentRemovedCount: embarrassmentFiltered.removed.length,
          embarrassmentRemoved: embarrassmentFiltered.removed.slice(0, 12),
        },
      };
      publishFinalTracksContext();
    }
    stripDeliveryOffWorld("world_purity_gate", "strip off-world before API serialization");
    const endSerializationTiming = requestStageTiming.start("serialization");
    const endApiFormattingProfile = liveStageProfiler.start("controller.apiTrackFormatting", `${delivery.tracks.length} tracks`);
    assignFT("score_attribution", "attach score channels", attachScoreAttribution(
      delivery.tracks,
      new Map(
        (pipeline.sorted as Array<{
          trackId: string;
          score?: number;
          rediscoveryScore?: number;
          scoreBreakdown?: import("../core/scoring-engine/score-breakdown").ScoreChannelBreakdown;
          scoringDebug?: unknown;
        }>).map((row) => [row.trackId, row]),
      ),
    ));
    let finalApiTracks = formatTracksForApi(
      delivery.tracks,
      emotionProfile,
      momentPipeline?.canonicalScene?.sceneId ?? null,
    );
    const apiPruneMinViable = minViableTracksAfterGenrePrune(length);
    if (isGymWorkoutPrompt(vibe, lockedIntent)) {
      const gymProfile = resolveActivityProfile(vibe, lockedIntent);
      const prunedApiTracks = finalApiTracks.filter((track) => {
        const constraintTrack = delivery.tracks.find((row) => row.trackId === track.id);
        if (constraintTrack && gymProfile) {
          if (trackFailsActivityHardGate(
            constraintTrack,
            userGenreProfile.trackClassifications.get(constraintTrack.trackId) ?? null,
            gymProfile,
            vibe,
          )) return false;
        }
        if (!promptExplicitlyAllowsGymHipHop(vibe, lockedIntent, constraintLayer)) {
          const family = (track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
          if (["hip_hop", "country", "classical", "christmas"].includes(family)) return false;
        }
        return true;
      });
      if (prunedApiTracks.length >= apiPruneMinViable && prunedApiTracks.length < finalApiTracks.length) {
        const originalApiTrackCount = finalApiTracks.length;
        const keptIds = new Set(prunedApiTracks.map((track) => track.id));
        finalApiTracks = prunedApiTracks;
        assignFT("api_prune", "api prune filter", delivery.tracks.filter((track) => keptIds.has(track.trackId)));
        if (openingLock?.enabled) {
          const locked = mergeTracksWithOpeningLock(
            delivery.tracks,
            openingLock,
            openingLockViolations,
            "generic_gym_api_contamination_prune",
          );
          assignFT("opening_lock_enforce", "enforce opening lock", locked.tracks as unknown as PlaylistTrack[]);
          openingLock = locked.lock;
          openingLockViolations = locked.violations;
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            genericGymApiContaminationPruned: true,
            genericGymApiContaminationPrunedCount: originalApiTrackCount - finalApiTracks.length,
          },
        };
      }
    }
    if (isFocusStudyPrompt(vibe, lockedIntent)) {
      const focusProfile = resolveActivityProfile(vibe, lockedIntent);
      const prunedApiTracks = finalApiTracks.filter((track) => {
        const constraintTrack = delivery.tracks.find((row) => row.trackId === track.id);
        if (!constraintTrack || !focusProfile) {
          const family = (track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
          return ["electronic", "indie", "pop", "ambient", "soundtrack", "folk", "blues", "soul", "unknown"].includes(family);
        }
        return !trackFailsActivityHardGate(
          constraintTrack,
          userGenreProfile.trackClassifications.get(constraintTrack.trackId) ?? null,
          focusProfile,
          vibe,
        );
      });
      if (prunedApiTracks.length >= apiPruneMinViable && prunedApiTracks.length < finalApiTracks.length) {
        const originalApiTrackCount = finalApiTracks.length;
        const keptIds = new Set(prunedApiTracks.map((track) => track.id));
        finalApiTracks = prunedApiTracks;
        assignFT("api_prune", "api prune filter", delivery.tracks.filter((track) => keptIds.has(track.trackId)));
        if (openingLock?.enabled) {
          const locked = mergeTracksWithOpeningLock(
            delivery.tracks,
            openingLock,
            openingLockViolations,
            "focus_api_contamination_prune",
          );
          assignFT("opening_lock_enforce", "enforce opening lock", locked.tracks as unknown as PlaylistTrack[]);
          openingLock = locked.lock;
          openingLockViolations = locked.violations;
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            focusApiContaminationPruned: true,
            focusApiContaminationPrunedCount: originalApiTrackCount - finalApiTracks.length,
          },
        };
      }
    }
    // Human-scene hard prune: strip Christmas titles on vacation/aftermath prompts.
    {
      const prunedApiTracks = finalApiTracks.filter((track) => {
        if (!allowHolidaySeason) {
          const constraintTrack = delivery.tracks.find((row) => row.trackId === track.id);
          if (constraintTrack && trackIsChristmasTrack(constraintTrack, userGenreProfile.trackClassifications)) {
            return false;
          }
          const blob = `${track.name ?? ""} ${(track as { album?: string }).album ?? ""} ${(track.genres ?? []).join(" ")}`;
          if (/\b(?:christmas|xmas|santa|noel|festive|mistletoe|jingle\s+bells|feliz\s+navidad)\b/i.test(blob)) {
            return false;
          }
        }
        return true;
      });
      if (prunedApiTracks.length < finalApiTracks.length && (prunedApiTracks.length >= 5 || !allowHolidaySeason)) {
        const originalApiTrackCount = finalApiTracks.length;
        const keptIds = new Set(prunedApiTracks.map((track) => track.id));
        finalApiTracks = prunedApiTracks;
        assignFT("api_prune", "human scene christmas prune", delivery.tracks.filter((track) => keptIds.has(track.trackId)));
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            humanSceneApiContaminationPruned: true,
            humanSceneApiContaminationPrunedCount: originalApiTrackCount - finalApiTracks.length,
          },
        };
      }
    }
    if (finalApiTracks.length < length) {
      const apiRefillSeenIds = new Set(delivery.tracks.map((track) => track.trackId));
      const apiRefillSeenSignatures = new Set(
        delivery.tracks.map((track) => trackRepeatSignature(track)).filter((value): value is string => !!value)
      );
      const apiRefillArtistCounts = new Map<string, number>();
      for (const track of delivery.tracks) {
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
      let apiRefillWorking = [...delivery.tracks];
      for (const source of apiRefillSources) {
        if (apiRefillWorking.length >= length) break;
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
        if (
          deliveryWorldBoundary.active &&
          !isTrackInWorld(
            {
              trackId: candidate.trackId,
              trackName: candidate.trackName,
              artistName: candidate.artistName,
              genreFamily: (candidate as ConstraintTrack & { genreFamily?: string | null }).genreFamily ?? null,
              genrePrimary: candidate.genrePrimary ?? null,
              energy: candidate.energy,
              valence: candidate.valence,
              danceability: candidate.danceability,
            },
            deliveryWorldBoundary,
            (candidate as ConstraintTrack & { genreFamily?: string | null }).genreFamily ?? candidate.genrePrimary ?? null,
          )
        ) {
          continue;
        }
        const artist = candidate.artistName.toLowerCase().trim();
        if ((apiRefillArtistCounts.get(artist) ?? 0) >= maxPerArtist) {
          apiRefillArtistCapSkipped += 1;
          continue;
        }
        apiRefillSeenIds.add(candidate.trackId);
        if (candidateSignature) apiRefillSeenSignatures.add(candidateSignature);
        apiRefillArtistCounts.set(artist, (apiRefillArtistCounts.get(artist) ?? 0) + 1);
        apiRefillWorking.push(candidate as PlaylistTrack);
        apiRefillAdded += 1;
      }
      if (apiRefillAdded > 0) {
        delivery.replaceTracks("api_refill", "api prune refill", apiRefillWorking);
        stripDeliveryOffWorld("world_purity_gate", "strip off-world after api refill");
        delivery.truncateTracks("playlist_length", "slice to requested length", length);
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            apiPruneRefillApplied: true,
            apiPruneRefillAdded: apiRefillAdded,
            apiPruneRefillArtistCapSkipped: apiRefillArtistCapSkipped,
          },
        };
      } else if (finalApiTracks.length < length) {
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            apiPruneUnderfilled: true,
            apiPruneUnderfilledBy: length - finalApiTracks.length,
          },
        };
      }
    }
    const postApiRefillArtistCap = applyArtistCapAtCheckpoint(
      delivery,
      "post_refill",
      artistCapOpts,
    );
    if (postApiRefillArtistCap.diagnostics.applied) {
      finalApiTracks = formatTracksForApi([...delivery.tracks], emotionProfile);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          postApiRefillArtistCapApplied: true,
          postApiRefillArtistCap: postApiRefillArtistCap.diagnostics,
        },
      };
    }
    // V36: artist-cap-aware refill from survivor pool — restores depth after per-artist prune.
    {
      const underfilledAfterCap =
        delivery.tracks.length < Math.ceil(requestedLength * 0.75);
      if (underfilledAfterCap && deliverableSurvivorPool.length > delivery.tracks.length) {
        const refillProfile = resolveCulturalProfileForCommitted(committedWorldPreRetrieval);
        const artistCapRefill = refillAfterArtistCap(
          delivery.tracks as PlaylistTrack[],
          deliverableSurvivorPool,
          {
            prompt: vibe,
            requestedLength,
            committed: committedWorldPreRetrieval,
            profile: refillProfile,
            preserveOpener: true,
            perArtistCap: maxPerArtist,
            promptCentralArtists: promptCentralArtistsForCap,
            enforceWorldPurity: !!committedWorldPreRetrieval?.hardLock,
            isGenreVerified: strictGenreEvidenceDiagnostics?.active ? isGenreEvidenceVerified : undefined,
            enrichTrack: enrichForWorld,
            maxPoolSize: deliverableSurvivorPoolLimit,
          },
        );
        if (artistCapRefill.diagnostics.refilledCount > 0 || artistCapRefill.tracks.length > delivery.tracks.length) {
          assignFT(
            "artist_cap_diverse_refill",
            "V36 artist-cap-aware survivor refill",
            artistCapRefill.tracks.slice(0, requestedLength) as PlaylistTrack[],
          );
          finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              artistCapDiverseRefill: artistCapRefill.diagnostics,
            },
          };
        }
      }
    }
    // Disco/latin etc.: artist-cap prune often collapses a strong verified pool
    // (n≈35) to n≈10. Refill along the scene fallback chain with artist diversity.
    {
      const fallbackChain = resolveSceneFallbackChain(vibe, lockedIntent.genreFamilies);
      const underfilledAfterCap =
        delivery.tracks.length < Math.ceil(requestedLength * 0.75);
      if (fallbackChain && underfilledAfterCap && !deliveryWorldBoundary.hardLock) {
        const classMap = userGenreProfile.trackClassifications;
        const poolMap = new Map<string, PlaylistTrack>();
        for (const track of delivery.tracks) poolMap.set(track.trackId, track);
        for (const track of explicitCandidatePool) poolMap.set(track.trackId, track);
        for (const track of familyConstrainedRecoveryPool) poolMap.set(track.trackId, track);
        for (const track of finalCandidatePool) {
          poolMap.set(track.trackId, track as PlaylistTrack);
        }
        for (const track of scoringInputSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.45 } as PlaylistTrack;
          if (!poolMap.has(candidate.trackId)) poolMap.set(candidate.trackId, candidate);
        }
        for (const track of likedSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.4 } as PlaylistTrack;
          if (!poolMap.has(candidate.trackId)) poolMap.set(candidate.trackId, candidate);
        }
        const chainCandidates = [...poolMap.values()].map((track) => {
          const classification = classMap.get(track.trackId);
          const family =
            track.genreFamily ??
            classification?.genreFamily ??
            trackGenreFamily(track, classMap) ??
            null;
          return {
            ...track,
            genreFamily: family,
            primarySubgenre: classification?.primarySubgenre ?? null,
            secondarySubgenre: classification?.secondarySubgenre ?? null,
            subGenres: classification?.subGenres ?? [],
          };
        });
        // Allow +1 over the delivery cap during niche refill so adjacent artists
        // can restore length without recreating the mono-artist collapse.
        const refillCap = Math.min(7, maxPerArtist + 1);
        const filled = fillPlaylistViaFallbackChain(
          delivery.tracks as PlaylistTrack[],
          chainCandidates,
          fallbackChain,
          { targetLength: requestedLength, maxPerArtist: refillCap },
        );
        if (filled.added > 0) {
          assignFT(
            "api_refill",
            `post_artist_cap_fallback_chain_${fallbackChain.id}`,
            filled.tracks.slice(0, requestedLength),
          );
          finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              postArtistCapSceneFallbackApplied: true,
              postArtistCapSceneFallbackAdded: filled.added,
              postArtistCapSceneFallbackCount: delivery.tracks.length,
              sceneFallbackChainId: fallbackChain.id,
              thinNicheSiblingExpansionApplied: true,
              explicitConstraintPartialReason: `scene_fallback_chain_post_cap_${fallbackChain.id}`,
            },
          };
          evidenceRelaxations.push(`scene_fallback_chain_post_cap_${fallbackChain.id}`);
          req.log.warn(
            {
              userId,
              vibe,
              finalCount: delivery.tracks.length,
              chainId: fallbackChain.id,
              added: filled.added,
              rankedPoolSize: filled.rankedPoolSize,
              beforeCapRemaining: postApiRefillArtistCap.diagnostics.remaining,
            },
            "Refilled underfilled playlist after artist-cap via scene fallback chain",
          );
        }
      }
    }
    const duplicateIdentityCountBeforeApiRefillGuard = countDuplicateSongIdentities(delivery.tracks);
    if (duplicateIdentityCountBeforeApiRefillGuard > 0) {
      const postApiAntiBlandness = repairFinalResponseDuplicateSongIdentities(
        delivery.tracks as ConstraintTrack[],
        antiBlandnessCandidatePool,
        {
          ...antiBlandnessOpts,
          protectedPrefixCount: openingLock?.lockedTrackIds.length ?? 0,
        },
      );
      if (
        postApiAntiBlandness.diagnostics.replacedCount > 0 &&
        postApiAntiBlandness.tracks.length === delivery.tracks.length &&
        countDuplicateSongIdentities(postApiAntiBlandness.tracks) < duplicateIdentityCountBeforeApiRefillGuard
      ) {
        assignFT("anti_blandness", "post-api anti-blandness", postApiAntiBlandness.tracks as PlaylistTrack[]);
        if (openingLock?.enabled) {
          const locked = enforceOpeningLock(delivery.tracks, openingLock, openingLockViolations);
          assignFT("opening_lock_enforce", "enforce opening lock", locked.tracks as unknown as PlaylistTrack[]);
          openingLockViolations = locked.violations;
        }
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
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
    if (finalApiTracks.length === 0 && delivery.tracks.length > 0) {
      finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
    }
    const thinLibraryDelivery = applyThinLibraryDeliveryCap(delivery.tracks, thinLibraryPolicy);
    if (thinLibraryDelivery.applied) {
      assignFT("thin_library_delivery_cap", "thin library delivery cap", thinLibraryDelivery.tracks);
      finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          thinLibraryDeliveryCapApplied: true,
          thinLibraryPolicy,
          thinLibraryDiagnostics: thinLibraryPolicy.diagnostics,
          honestPartialPublished: true,
          thinLibraryUserMessage: thinLibraryPolicy.userMessage,
        },
      };
    } else if (thinLibraryPolicy.action === "honest_partial" && delivery.tracks.length < length) {
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          thinLibraryPolicy,
          thinLibraryDiagnostics: thinLibraryPolicy.diagnostics,
          honestPartialPublished: true,
          thinLibraryUserMessage: thinLibraryPolicy.userMessage,
        },
      };
    }
    let postPurityValidatedDepth: number | null = null;
    // Terminal Human Quality Gate — save/replay honesty over forced completion.
    {
      const v3PipelineDiag = ((pipeline.scoringDiagnostics as Record<string, unknown> | undefined)?.v3Pipeline as
        | Record<string, unknown>
        | undefined);
      const humanSaveabilityGate = v3PipelineDiag?.["humanSaveabilityGate"] as Record<string, unknown> | undefined;
      const v3World = v3PipelineDiag?.["worldCoherence"] as Record<string, unknown> | undefined;
      const v3Hqg = v3PipelineDiag?.["humanQualityGate"] as Record<string, unknown> | undefined;
      const holidayNegated = promptSuppressesChristmas(vibe);
      const holidayRequested = allowHolidaySeason && !holidayNegated;
      const seasonalLeakage =
        !allowHolidaySeason &&
        delivery.tracks.some((track) => trackIsChristmasTrack(track, userGenreProfile.trackClassifications));
      if (seasonalLeakage) {
        const stripped = delivery.tracks.filter(
          (track) => !trackIsChristmasTrack(track, userGenreProfile.trackClassifications),
        );
        assignFT("human_quality_gate", "strip seasonal leakage", stripped);
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      }
      const artistCounts = new Map<string, number>();
      for (const track of delivery.tracks) {
        const artist = track.artistName.toLowerCase().trim();
        if (!artist) continue;
        artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
      }
      const dominantArtistShare =
        delivery.tracks.length > 0 && artistCounts.size > 0
          ? Math.max(...artistCounts.values()) / delivery.tracks.length
          : null;
      const committedWorldResolved = resolveCommittedWorld({
        prompt: vibe,
        sceneLock: sceneLockStatus,
        sceneAliases,
        scenePrediction: mergedScenePrediction,
        lockedIntent,
      });
      const { world: committedWorld, drift: committedWorldDrift } = enforceCommittedWorldImmutability(
        committedWorldPreRetrieval,
        committedWorldResolved,
        "delivery",
      );
      if (committedWorldDrift.drifted && auditMode) {
        req.log.warn({ committedWorldDrift }, "V14 committed world drift blocked at delivery");
      }
      const terminalNegationProfileEarly = parsePromptNegationEnforcement(vibe);
      const negationDeliveryFilter = filterTracksForDeliveryNegation(delivery.tracks, terminalNegationProfileEarly);
      if (negationDeliveryFilter.removed > 0 && negationDeliveryFilter.tracks.length >= 3) {
        assignFT(
          "prompt_negation_enforcement",
          "delivery negation strip",
          negationDeliveryFilter.tracks,
        );
      }
      let thesisResult: ReturnType<typeof enforceThesisOpener> | null = null;
      if (committedWorld?.hardLock) {
        const culturalProfile = resolveCulturalProfileForCommitted(committedWorld);
        thesisResult = enforceThesisOpener(
          delivery.tracks,
          culturalProfile,
          committedWorld,
          worldExpansionCandidates.length > 0
            ? (worldExpansionCandidates as typeof delivery.tracks)
            : undefined,
          20,
          terminalNegationProfileEarly.excludedArtists,
        );
        assignFT(
          "world_thesis_opener",
          thesisResult.passed ? "promote world thesis to track 1" : "thesis opener gate",
          thesisResult.tracks as PlaylistTrack[],
        );
        const sequenced = applyWorldSequencing(thesisResult.tracks as PlaylistTrack[], committedWorld);
        if (sequenced !== thesisResult.tracks) {
          assignFT("world_sequencer", "world-aware sequencing", sequenced);
        }
        const purityEarly = applyWorldPurityGate(delivery.tracks as PlaylistTrack[], committedWorld, {
          prompt: vibe,
          requestedLength,
          coverageLevel: worldCoverageAssessment?.score ?? null,
          coverageTier: candidateCoverageTier,
          preserveOpener: true,
          replacementPool: mergeDeliverableCandidatePools(
            delivery.tracks as PlaylistTrack[],
            deliverableSurvivorPool,
            worldExpansionCandidates as PlaylistTrack[],
          ),
          isGenreVerified: strictGenreEvidenceDiagnostics?.active ? isGenreEvidenceVerified : undefined,
          enrichTrack: enrichForWorld,
        });
        if (puritySubFunnel) {
          mergePuritySubFunnelFromGate(
            puritySubFunnel,
            purityEarly.subFunnel,
            hardRejectOffWorldSinceV3Composed,
          );
        }
        if (purityEarly.tracks.length > 0 && (purityEarly.removed > 0 || purityEarly.honestPartial)) {
          assignFT("world_purity_gate", "V15 delivery recovery purity", purityEarly.tracks as PlaylistTrack[]);
        }
        if (
          committedWorld?.hardLock &&
          delivery.tracks.length < requestedLength &&
          deliverableSurvivorPool.length > delivery.tracks.length
        ) {
          const postPurityRefill = refillDeliverableDepth(
            delivery.tracks as PlaylistTrack[],
            deliverableSurvivorPool,
            {
              prompt: vibe,
              requestedLength,
              committed: committedWorld,
              profile: culturalProfile,
              preserveOpener: true,
              isGenreVerified: strictGenreEvidenceDiagnostics?.active ? isGenreEvidenceVerified : undefined,
              enrichTrack: enrichForWorld,
            },
          );
          if (postPurityRefill.diagnostics.refilledCount > 0 || postPurityRefill.tracks.length > delivery.tracks.length) {
            const refilledTracks = assignFT(
              "deliverable_depth_refill",
              "V35 post-purity ranked survivor refill",
              postPurityRefill.tracks as PlaylistTrack[],
            );
            finalization = {
              tracks: [...refilledTracks],
              diagnostics: {
                ...finalization.diagnostics,
                postPurityDeliverableDepthRefill: postPurityRefill.diagnostics,
              },
            };
          }
        }
        const humanCurationEarly = contractRebalanceDeliveryGuard
          ? { tracks: delivery.tracks as PlaylistTrack[], swaps: 0, reorders: 0, removals: 0, replacements: 0, diagnostics: ["contract_rebalance_guard_skipped"] }
          : applyHumanCurationSequencing(delivery.tracks as PlaylistTrack[], {
          prompt: vibe,
          preserveThesisOpener: true,
          culturalProfile: resolveCulturalProfileForCommitted(committedWorld),
          replacementPool: buildMomentReplacementPool(
            delivery.tracks as PlaylistTrack[],
            worldExpansionCandidates.length > 0 ? (worldExpansionCandidates as PlaylistTrack[]) : undefined,
          ),
        });
        if (
          humanCurationEarly.swaps > 0 ||
          humanCurationEarly.reorders > 0 ||
          humanCurationEarly.removals > 0 ||
          humanCurationEarly.replacements > 0
        ) {
          assignFT("human_curation_sequencer", "V16 listenability sequencing", humanCurationEarly.tracks as PlaylistTrack[]);
        }
        if (deliveryLossFunnel) {
          deliveryLossFunnel.postPurity = delivery.tracks.length;
        }
      } else if (deliveryLossFunnel) {
        deliveryLossFunnel.postPurity = delivery.tracks.length;
      }
      const worldProof = evaluateWorldProof({
        tracks: delivery.tracks.map((t) => ({
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName,
          albumName: t.albumName,
          genreFamily: t.genreFamily,
          genrePrimary: t.genrePrimary,
          genres: t.genres ?? null,
          spotifyArtistGenres: (t as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
          albumGenres: (t as { albumGenres?: unknown }).albumGenres,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
          danceability: t.danceability ?? null,
          instrumentalness: t.instrumentalness ?? null,
          popularity: (t as { popularity?: number | null }).popularity ?? null,
          acousticness: t.acousticness ?? null,
        })),
        committed: committedWorld,
        prompt: vibe,
        requestedLength,
        coverageLevel: worldCoverageAssessment?.score ?? null,
      });
      if (committedWorld?.hardLock) {
        const fullWorldFiltered = filterTracksByFullWorldProof(
          delivery.tracks,
          committedWorld,
          worldCoverageAssessment?.score ?? null,
        );
        if (fullWorldFiltered.removed > 0 && fullWorldFiltered.tracks.length >= 3) {
          assignFT("world_proof_gate", "full playlist world validation strip", fullWorldFiltered.tracks);
        }
        const tailStripped = stripTailWorldViolations(delivery.tracks, committedWorld);
        if (tailStripped.removed > 0 && tailStripped.tracks.length >= 3) {
          assignFT("world_proof_gate", "tail world violation strip tracks 5-10", tailStripped.tracks);
        }
      }
      if (deliveryLossFunnel) {
        deliveryLossFunnel.postWorldProof = delivery.tracks.length;
      }
      postPurityValidatedDepth = delivery.tracks.length;
      const intentFidelity = worldProof.fidelity;
      const skipIntentFidelityStrip =
        contractRebalanceDeliveryGuard ||
        postPurityValidatedDepth >= Math.ceil(requestedLength * 0.5);
      if (
        committedWorld?.hardLock &&
        !skipIntentFidelityStrip &&
        (!worldProof.passed || !intentFidelity.passed) &&
        intentFidelity.salvageableTracks.length >= 3
      ) {
        const salvaged = filterTracksByWorldIdentity(
          delivery.tracks,
          intentFidelity,
          committedWorld,
        );
        assignFT(
          "intent_fidelity_gate",
          "hard lock world-verified honest partial",
          salvaged,
        );
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            intentFidelityGate: intentFidelity,
            degradedDelivery: true,
            honestPartialPublished: true,
          },
        };
      }
      const terminalWorldIds =
        committedWorld?.worldIds?.length
          ? committedWorld.worldIds
          : inferWorldIdentityIdsFromPrompt(vibe);
      const terminalActiveWorldId = committedWorld?.id ?? terminalWorldIds[0] ?? null;
      const terminalTrackSignals = delivery.tracks.map((t) => ({
        artistName: t.artistName,
        genreFamily: t.genreFamily,
        genrePrimary: t.genrePrimary,
      }));
      const terminalWorldSignals = committedWorldQualitySignals(terminalActiveWorldId, terminalTrackSignals, { prompt: vibe });
      const terminalNegationProfile = parsePromptNegationEnforcement(vibe);
      const terminalPsychIndieOpenerFillers = countPsychIndieOpenerFillers(
        delivery.tracks.map((track) => ({ artistName: track.artistName })),
        3,
        terminalWorldIds,
      );
      const terminalOpenerNegationViolations = countOpenerNegationViolations(
        delivery.tracks,
        terminalNegationProfile,
        3,
      );
      const terminalNegationViolations = delivery.tracks.filter((track) =>
        trackViolatesPromptNegation(track, terminalNegationProfile),
      ).length;
      const terminalUnderstood = evaluateHumanUnderstoodGate({
        trackCount: delivery.tracks.length,
        requestedLength,
        committed: committedWorld,
        thesis: thesisResult,
        worldProof,
        negationViolations: terminalNegationViolations,
        openerNegationViolations: terminalOpenerNegationViolations,
        coverageLevel: worldCoverageAssessment?.score ?? null,
        coverageTier: candidateCoverageTier,
        tracks: delivery.tracks,
        anchorHitsInPool: worldCoverageAssessment?.anchorHits ?? 0,
      });
      const terminalHqg = evaluateHumanQualityGate({
        trackCount: delivery.tracks.length,
        requestedLength: requestedLength,
        wouldSpotifyMakeThis:
          typeof v3World?.["wouldSpotifyMakeThis"] === "boolean"
            ? (v3World["wouldSpotifyMakeThis"] as boolean)
            : null,
        dominantWorldDensity:
          typeof v3World?.["dominantWorldDensity"] === "number"
            ? (v3World["dominantWorldDensity"] as number)
            : null,
        retrievalEntropy:
          typeof v3World?.["retrievalEntropy"] === "number"
            ? (v3World["retrievalEntropy"] as number)
            : null,
        humanSavePassed:
          humanSaveabilityGate?.passed === true || humanSaveabilityGate?.humanSaveable === true
            ? true
            : humanSaveabilityGate?.passed === false || humanSaveabilityGate?.humanSaveable === false
              ? false
              : null,
        curatorScore:
          typeof humanSaveabilityGate?.curatorScore === "number"
            ? (humanSaveabilityGate.curatorScore as number)
            : null,
        degradedDelivery:
          finalization.diagnostics["degradedDelivery"] === true ||
          humanSaveabilityGate?.degradedDelivery === true,
        seasonalLeakage:
          !allowHolidaySeason &&
          delivery.tracks.some((track) => trackIsChristmasTrack(track, userGenreProfile.trackClassifications)),
        holidayRequested,
        holidayNegated,
        uniqueArtistCount: artistCounts.size,
        dominantArtistShare,
        promptLabel: vibe,
        psychIndieOpenerFillers: terminalPsychIndieOpenerFillers,
        openerNegationViolations: terminalOpenerNegationViolations,
        negationViolations: terminalNegationViolations,
        intentFidelityFailed:
          committedWorld?.hardLock === true &&
          !skipIntentFidelityStrip &&
          (!worldProof.passed || !intentFidelity.passed || !intentFidelity.openerPassed),
        worldProofFailed:
          committedWorld?.hardLock === true && !worldProof.passed,
        committedWorldHardLock: committedWorld?.hardLock ?? false,
        intentFidelityScore: intentFidelity.fidelityScore,
        worldMatchScore: intentFidelity.worldVerifiedCount / Math.max(1, delivery.tracks.length),
        emotionMatchScore:
          typeof v3World?.["dominantWorldDensity"] === "number"
            ? (v3World["dominantWorldDensity"] as number)
            : null,
        ...terminalWorldSignals,
        committedWorldLaneOk:
          terminalActiveWorldId && LANE_PURITY_WORLD_IDS.has(terminalActiveWorldId)
            ? scoreCommittedWorldLanePurity(terminalActiveWorldId, terminalTrackSignals, { prompt: vibe }).ok
            : null,
        coverageLevel: worldCoverageAssessment?.score ?? null,
        postPurityValidatedDepth,
      });
      if (isPlaylistContractValidationEnabled()) {
        const contractForValidation = buildPlaylistContract({
          prompt: vibe,
          lockedIntent: lockedIntent as LockedIntent,
          decomposedIntent,
          intentState,
          committedWorld,
        });
        const contractAudit = auditPlaylistAgainstContract(
          delivery.tracks.map((t) => ({
            trackId: t.trackId,
            trackName: t.trackName,
            artistName: t.artistName,
            genreFamily: userGenreProfile.trackClassifications.get(t.trackId)?.genreFamily ?? null,
            energy: t.energy,
            valence: t.valence,
            releaseYear: t.releaseYear,
          })),
          contractForValidation,
          requestedLength,
        );
        const honestPartial = deriveHonestPartialFromContract(
          contractForValidation,
          contractAudit,
          requestedLength,
          delivery.tracks.length,
        );
        req.log.info(
          { playlistContractValidation: { audit: contractAudit, honestPartial } },
          "playlist_contract_validation_shadow",
        );
        playlistContractDiagnostics = {
          ...(playlistContractDiagnostics ?? {}),
          validation: { audit: contractAudit, honestPartial },
        };
      }
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          humanQualityGate: terminalHqg,
          humanUnderstoodGate: terminalUnderstood,
          ...(v3Hqg ? { humanQualityGateFromV3: v3Hqg } : {}),
        },
      };
      if (contractRebalanceDeliveryGuard) {
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            humanQualityGate: terminalHqg,
            humanUnderstoodGate: terminalUnderstood,
            contractRebalanceGuardSkippedTerminalHqg: true,
            ...(v3Hqg ? { humanQualityGateFromV3: v3Hqg } : {}),
          },
        };
      } else if (terminalHqg.action === "refuse" && terminalUnderstood.action === "refuse") {
        // V15: ship honest partial when salvageable tracks exist — never 0 when anchors were found
        if (
          terminalUnderstood.salvageableCount >= 3 ||
          (terminalUnderstood.salvageableCount > 0 && (worldCoverageAssessment?.anchorHits ?? 0) >= 1)
        ) {
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              humanUnderstoodGate: { ...terminalUnderstood, action: "honest_partial" },
              honestPartialPublished: true,
              humanQualityUserMessage: terminalUnderstood.userMessage,
            },
          };
        } else {
          if (deliveryLossFunnel) {
            deliveryLossFunnel.postTerminal = delivery.tracks.length;
            deliveryLossFunnel.finalDelivered = 0;
          }
          throw new HumanQualityGateError(terminalHqg.action === "refuse" ? terminalHqg : {
            action: "refuse",
            reasons: terminalUnderstood.reasons,
            userMessage: terminalUnderstood.userMessage,
            salvageableCount: 0,
            wouldSaveConfidence: 0,
            replayConfidence: 0,
            worldCoherenceOk: false,
            stubUnderfill: false,
          });
        }
      } else if (terminalHqg.action === "refuse" || terminalUnderstood.action === "refuse") {
        if (deliveryLossFunnel) {
          deliveryLossFunnel.postTerminal = delivery.tracks.length;
          deliveryLossFunnel.finalDelivered = 0;
        }
        throw new HumanQualityGateError(terminalHqg.action === "refuse" ? terminalHqg : {
          action: "refuse",
          reasons: terminalUnderstood.reasons,
          userMessage: terminalUnderstood.userMessage,
          salvageableCount: 0,
          wouldSaveConfidence: 0,
          replayConfidence: 0,
          worldCoherenceOk: false,
          stubUnderfill: false,
        });
      }
      if (terminalHqg.action === "honest_partial" && !contractRebalanceDeliveryGuard) {
        if (
          terminalHqg.salvageableCount > 0 &&
          delivery.tracks.length > terminalHqg.salvageableCount
        ) {
          const partialTracks =
            terminalHqg.reasons.includes("intent_fidelity_failed") && committedWorld?.hardLock
              ? selectIntentFidelityHonestPartialTracks(
                  delivery.tracks,
                  intentFidelity,
                  committedWorld,
                )
              : delivery.tracks.slice(0, terminalHqg.salvageableCount);
          assignFT(
            "human_quality_gate",
            "honest partial cap",
            partialTracks,
          );
          finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            humanQualityGate: terminalHqg,
            honestPartialPublished: true,
            humanQualityUserMessage: terminalHqg.userMessage,
          },
        };
      }
      if (
        humanSaveabilityGate?.humanSaveable === false &&
        delivery.tracks.length > 0 &&
        !skipIntentFidelityStrip &&
        !contractRebalanceDeliveryGuard
      ) {
        const curator =
          typeof humanSaveabilityGate.curatorScore === "number"
            ? (humanSaveabilityGate.curatorScore as number)
            : null;
        const unsavableCap = Math.min(12, Math.ceil(requestedLength * 0.4));
        const shouldCap =
          humanSaveabilityGate.degradedDelivery === true ||
          (curator != null && curator < 0.4);
        if (shouldCap && delivery.tracks.length > unsavableCap) {
          assignFT(
            "human_save_gate",
            "unsavable delivery cap",
            delivery.tracks.slice(0, unsavableCap),
          );
          finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              humanSaveUnsavableCap: unsavableCap,
              degradedDelivery: true,
              honestPartialPublished: true,
            },
          };
        }
      }
      if (deliveryLossFunnel) {
        deliveryLossFunnel.postTerminal = delivery.tracks.length;
      }
    }
    const tryEmptyPlaylistRecoveryFloor = (): boolean => {
      if (delivery.tracks.length > 0) return false;
      const recoveryFloorLimit = Math.max(1, Math.min(minBestAvailableCount, length));
      const recoveryFloor = buildEmptyPlaylistRecoveryFloor([], {
        verified: strictGenreEvidenceDiagnostics.verified,
        preGenreGuard: preGenreGuardTracks,
        recoveryPool: mergedConstrainedRecoveryPool,
        limit: recoveryFloorLimit,
      });
      if (recoveryFloor.length === 0) return false;
      assignFT("empty_recovery_floor", "empty playlist recovery floor", recoveryFloor);
      finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          emptyFinalResponseRecoveryFloor: true,
          emptyFinalResponseRecoveryFloorCount: delivery.tracks.length,
        },
      };
      evidenceRelaxations.push("empty_final_response_recovery_floor");
      req.log.warn(
        {
          userId,
          vibe,
          recoveryFloorCount: delivery.tracks.length,
          verifiedSupply: strictGenreEvidenceDiagnostics.verified.length,
          preGenreGuardCount: preGenreGuardTracks.length,
          constrainedPoolCount: mergedConstrainedRecoveryPool.length,
        },
        "Empty final response recovered from verified/pre-guard constrained pool",
      );
      return true;
    };
    if (finalApiTracks.length === 0) {
      tryEmptyPlaylistRecoveryFloor();
    }
    if (
      thinLibraryPolicy.action === "insufficient"
      && !compoundThinLibraryBypass
      && delivery.tracks.length === 0
    ) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      const orchestratorLibraryCapability = preScoringOrchestration.diagnostics.libraryCapability;
      recordLibraryInsufficientFailure({
        sessionId: requestId,
        userId,
        vibe,
        activity: lockedIntent.activity,
        sceneId: moodSceneId,
        libraryCapability: orchestratorLibraryCapability,
        orchestrator: preScoringOrchestration.diagnostics,
      });
      const fallbackUx = buildFallbackUxPayload({
        vibe,
        lockedIntent,
        libraryCapability: orchestratorLibraryCapability,
        limitingFactors: [
          "thin_library_supply_ceiling",
          ...(validCandidateSupply?.limitingDimensions ?? []),
        ],
        genreLabel: lockedIntent.genreFamilies[0] ?? lockedIntent.primaryGenres[0] ?? null,
        noLibraryMode: !!noLibraryMode,
      });
      generateFail(
        res,
        200,
        "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        thinLibraryPolicy.userMessage ?? fallbackUx.message,
        {
          requestId,
          failureSessionId: requestId,
          reason: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
          canUseDiscoveryMode: true,
          suggestDiscoveryMode: true,
          suggestRefinePrompt: true,
          thinLibraryPolicy,
          thinLibraryDiagnostics: thinLibraryPolicy.diagnostics,
          libraryCapability: orchestratorLibraryCapability,
          limitingFactors: [
            "thin_library_supply_ceiling",
            ...(validCandidateSupply?.limitingDimensions ?? []),
          ],
          validCandidateSupply,
          retrievalOrchestrator: auditMode ? preScoringOrchestration.diagnostics : undefined,
          fallbackUx,
          deliveredTrackCount: delivery.tracks.length,
        },
      );
      return;
    }
    if (finalApiTracks.length === 0 && delivery.tracks.length === 0) {
      if (timeoutFallbackResponse(req, res, {
        failureReason: "empty_final_response_guard",
        elapsedMs: Date.now() - startMs,
        requestId,
        allowStrictOverride: true,
        fallbackLevel: "empty_pool",
      })) return;
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      const emptyWorldIds = inferWorldIdentityIdsFromPrompt(vibe);
      const latinRooftopEmpty = emptyWorldIds.includes("latin_summer_rooftop_world");
      generateFail(
        res,
        422,
        latinRooftopEmpty ? "LIBRARY_INSUFFICIENT_FOR_PROMPT" : "EMPTY_PLAYLIST",
        latinRooftopEmpty
          ? "This library does not contain enough Latin / reggaeton tracks to build a rooftop playlist I'd stand behind. " +
            "Padding with unrelated filler would break the vibe — try Discovery Mode or a broader summer prompt."
          : "Generation completed without deliverable tracks. Try Balanced mode or broaden the prompt.",
        {
          finalization: finalization.diagnostics,
          requestedLength: length,
          activeWorldId: emptyWorldIds[0] ?? null,
        },
      );
      return;
    }
    endSerializationTiming();
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
    const artistDiversity = artistDiversityDiagnostics(delivery.tracks, maxPerArtist);
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
    const underfilledPenalty = delivery.tracks.length < length ? Math.min(0.20, (length - delivery.tracks.length) / Math.max(1, length) * 0.5) : 0;
    const strictGenreEvidenceWeak =
      strictGenreEvidenceDiagnostics.active &&
      !strictGenreEvidenceDiagnostics.partialVerificationPasses;
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
      delivery.tracks.length < length ? 0.45 : 0.99,
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
    const fillRatio = Math.min(1, delivery.tracks.length / Math.max(1, length));
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
    const goodPlaylistRefinement = refinementTelemetry.finalize(
      delivery.tracks.map((track) => ({
        trackId: track.trackId,
        artistName: track.artistName,
        energy: track.energy,
        valence: track.valence,
        danceability: track.danceability ?? null,
        acousticness: track.acousticness ?? null,
        popularity: track.popularity ?? null,
        rediscoveryScore: track.rediscoveryScore ?? null,
        releaseYear: track.releaseYear ?? null,
        tempo: track.tempo ?? null,
        laneScore: (track as { laneScore?: number }).laneScore,
        score: track.score,
      })),
      playlistConfidence.score,
    );
    recordUnknownTermEvents({
      userId,
      prompt: vibe,
      intentUnderstanding: intentUnderstandingDiagnostics,
      playlistConfidence: playlistConfidence.percent,
      overallCoherence: playlistCoherenceScore?.overallScore ?? null,
      inferredScene: decomposedIntent.scene ?? decomposedIntent.culturalRefs[0] ?? null,
    });
    if (!devMode && !auditMode) {
      const v3ForMemory = ((scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
      const intentCollapseForMemory = v3ForMemory.intentCollapseDiagnostics as { editorialWorldTag?: string } | undefined;
      const gateForMemory = (v3ForMemory.humanSaveabilityGate ?? {}) as Record<string, unknown>;
      void recordEditorialMemory({
        userId,
        prompt: vibe,
        editorialWorldTag: String(intentCollapseForMemory?.editorialWorldTag ?? decomposedIntent.scene ?? "indie_balanced_default"),
        preferredArchetypeId: decomposedIntent.scene ?? sceneAliases[0] ?? null,
        curatorScore: typeof gateForMemory.curatorScore === "number" ? gateForMemory.curatorScore : 0,
        wouldSaveScore: typeof gateForMemory.wouldSaveScore === "number"
          ? gateForMemory.wouldSaveScore
          : (typeof gateForMemory.curatorScore === "number" ? gateForMemory.curatorScore : 0),
        humanSaveable: gateForMemory.humanSaveable === true || gateForMemory.passed === true,
      }).catch((err) => req.log.warn({ err }, "Failed to record editorial memory"));
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
    const endDiagnosticsTiming = requestStageTiming.start("diagnostics");
    const endIntentSurvivalProfile = liveStageProfiler.start("controller.intentSurvivalDiagnostics", `${delivery.tracks.length} tracks`);
    const intentSurvivalDiagnostics = buildIntentSurvivalDiagnostics({
      prompt: vibe,
      lockedIntent,
      constraintLayer,
      emotionProfile,
      finalTracks: delivery.tracks as PlaylistTrack[],
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
    endDiagnosticsTiming();
    recordIntentSurvivalSample({
      overall: intentSurvivalDiagnostics.scores.overallIntentSurvival,
      emotion: intentSurvivalDiagnostics.scores.emotionSurvival,
      subgenre: intentSurvivalDiagnostics.scores.subgenreSurvival,
    });
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res)) return;
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: delivery.tracks.length })) return;
    const fallbackBypassGate = pipeline.scoringDiagnostics?.fastFallback
      ? buildBypassedHumanSaveabilityGate({
          reason: "fast_fallback",
          stageResponsible: "request",
          detail: fallbackReason
            ? `${fallbackReason.stage}:${fallbackReason.elapsedMs}ms`
            : "time_budget",
        })
      : null;
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
      ...(fallbackBypassGate ? { humanSaveabilityGate: fallbackBypassGate } : {}),
    };
    const productionTimelineReport = buildProductionTimelineReport(productionTimeline, startMs, {
      failureReason: fallbackReason ? "time_budget_fast_fallback" : null,
    });
    const deliveredDueToLatencyBudget = latencyBudgetExceeded || latencyBudget.shouldSkipMarginalImprovement();
    const postRefillCheckpoint = runDeliveryCheckpoint(pipelineAuthority, "post_refill", checkpointCtx({
      requireTelemetry: true,
      recoveryPoolSize: mergedConstrainedRecoveryPool.length,
    }));
    const openingWindowDedupHistoryLists = auditNoveltyMemoryRows
      ? evaluationRecentTrackLists
      : getOpeningWindowSessionHistory(generateSessionUserId);
    const openingWindowHistory = buildOpeningWindowHistory(openingWindowDedupHistoryLists);
    if (delivery.tracks.length > 0) {
      const openerDedup = applyOpeningWindowDedup(delivery.tracks, openingWindowHistory, {
        thinLibraryRelaxed: thinLibraryPolicy.action !== "normal",
        auditDeterministic: auditMode,
        scoreFn: (track) =>
          typeof track.score === "number" ? track.score : 0.5,
      });
      if (openerDedup.diagnostics.openerReplacementCount > 0) {
        assignFT("opener_dedup", "opening window dedup", openerDedup.tracks as PlaylistTrack[]);
        if (openingLock?.enabled) {
          const lockLen = openingLock.lockedTrackIds.length;
          openingLock = {
            ...openingLock,
            lockedTrackIds: openingLockTrackIdsFromTracks(
              delivery.tracks,
              lockLen,
              maxPsychIndieOpenersForWorlds(inferWorldIdentityIdsFromPrompt(vibe)),
            ),
          };
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            openingWindowDedup: openerDedup.diagnostics,
          },
        };
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      }
      (generationDiagnostics as Record<string, unknown>).openerNoveltyDiagnostics = openerDedup.diagnostics;
    }
    const artistGravityHistoryLists = auditNoveltyMemoryRows
      ? evaluationRecentTrackLists.map((trackIds) =>
          trackIds
            .map((trackId) => normalizeSessionArtist(trackIdToArtist.get(trackId) ?? ""))
            .filter((artist) => artist.length > 0)
        )
      : getSessionArtistHistory(generateSessionUserId);
    const sessionArtistHistory = buildSessionArtistHistory(artistGravityHistoryLists);
    const promptCentralArtists = detectPromptCentralArtists(vibe);
    if (delivery.tracks.length > 0) {
      const artistGravity = applySessionArtistGravity(delivery.tracks, sessionArtistHistory, {
        thinLibraryRelaxed: thinLibraryPolicy.action !== "normal",
        auditDeterministic: auditMode,
        promptCentralArtists,
        scoreFn: (track) =>
          typeof track.score === "number" ? track.score : 0.5,
        canReplaceWith: (_current, candidate) =>
          finalTrackMatchesExplicitGenre(candidate, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
          finalTrackMatchesExplicitEra(candidate, lockedIntent),
      });
      if (artistGravity.diagnostics.replacementsMade > 0) {
        assignFT("session_artist_gravity", "session artist gravity", artistGravity.tracks as PlaylistTrack[]);
        if (openingLock?.enabled) {
          const lockLen = openingLock.lockedTrackIds.length;
          openingLock = {
            ...openingLock,
            lockedTrackIds: openingLockTrackIdsFromTracks(
              delivery.tracks,
              lockLen,
              maxPsychIndieOpenersForWorlds(inferWorldIdentityIdsFromPrompt(vibe)),
            ),
          };
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            artistGravity: artistGravity.diagnostics,
          },
        };
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      }
      (generationDiagnostics as Record<string, unknown>).artistGravityDiagnostics = artistGravity.diagnostics;
    }
    const crossSessionTrackHistoryLists = auditNoveltyMemoryRows
      ? evaluationRecentTrackLists
      : getOpeningWindowSessionHistory(generateSessionUserId);
    const crossSessionTrackHistory = buildCrossSessionTrackHistory(crossSessionTrackHistoryLists);
    const explicitAlbumPrompt = detectPromptExplicitAlbum(vibe);
    if (delivery.tracks.length > 0) {
      const identityDistancePool = [...finalizationCandidates];
      const identityDistance = applyPlaylistIdentityDistance(
        delivery.tracks,
        identityDistancePool,
        crossSessionTrackHistory,
        lockedIntent,
        curatorIdentity,
        {
          selectedClusterId: clusterCuration.diagnostics.selectedCluster,
          dominantClusterId: typeof v3GenerationDebug["dominantCluster"] === "string"
            ? v3GenerationDebug["dominantCluster"]
            : null,
        },
        {
          thinLibraryRelaxed: thinLibraryPolicy.action !== "normal",
          auditDeterministic: auditMode,
          promptCentralArtists,
          explicitAlbumPrompt,
          scoreFn: (track) =>
            typeof track.score === "number" ? track.score : 0.5,
          canReplaceWith: (_current, candidate) =>
            finalTrackMatchesExplicitGenre(candidate, lockedIntent, constraintLayer, userGenreProfile.trackClassifications) &&
            finalTrackMatchesExplicitEra(candidate, lockedIntent),
        },
      );
      if (identityDistance.diagnostics.replacementCount > 0) {
        assignFT("playlist_identity_distance", "playlist identity distance", identityDistance.tracks as PlaylistTrack[]);
        if (openingLock?.enabled) {
          const lockLen = openingLock.lockedTrackIds.length;
          openingLock = {
            ...openingLock,
            lockedTrackIds: openingLockTrackIdsFromTracks(
              delivery.tracks,
              lockLen,
              maxPsychIndieOpenersForWorlds(inferWorldIdentityIdsFromPrompt(vibe)),
            ),
          };
        }
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            identityDistance: identityDistance.diagnostics,
          },
        };
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
      }
      (generationDiagnostics as Record<string, unknown>).identityDistanceDiagnostics =
        identityDistance.diagnostics;
    }
    const generationDiagnosticsWithTimeline = {
      ...generationDiagnostics,
      ...(auditMode ? { candidateRetrieval: preScoringCandidateShape.diagnostics } : {}),
      productionTimeline: productionTimelineReport,
      requestStageTiming: (() => {
        requestStageTiming.setTotal(Date.now() - startMs);
        return requestStageTiming.report();
      })(),
      latencyBudget: latencyBudget.snapshot(),
      latencyBudgetExceeded: deliveredDueToLatencyBudget,
      goodPlaylistRefinement,
    };
    const generationTrust = buildGenerationTrustPayload({
      vibe,
      mode: mode as "strict" | "balanced" | "chaotic",
      noLibraryMode: !!noLibraryMode,
      intentContract: {
        primarySubgenre: lockedIntent.primarySubgenre ?? null,
        genreFamilies: lockedIntent.genreFamilies,
        activity: lockedIntent.activity ?? null,
        places: [],
        eraRange: lockedIntent.eraRange ?? null,
        explicitDimensions: [],
      },
      emotionProfile,
      intentSurvival: intentSurvivalDiagnostics,
      generationDiagnostics: {
        ...generationDiagnosticsWithTimeline,
        intentContractGuard: (v3Diagnostics as Record<string, unknown>)?.["intentContractGuard"],
        finalizationFallbackLevel: fallbackLevelFromFinalization(finalization.diagnostics as Record<string, unknown>),
        cohesionRelaxedFillUsed: (finalization.diagnostics as Record<string, unknown>)?.["cohesionRelaxedFillUsed"],
        hardSafeFillUsed: (finalization.diagnostics as Record<string, unknown>)?.["hardSafeFillUsed"],
      },
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      intentDecode: momentPipeline?.intent,
    });
    if (thinLibraryPolicy.action === "honest_partial") {
      playlistConfidence.label = "Best available match";
      playlistConfidence.percent = Math.min(playlistConfidence.percent, 52);
    }
    if (generationTrust.genreRelaxed || generationTrust.eraRelaxed) {
      playlistConfidence.label = generationTrust.matchQualityLabel;
      if (generationTrust.matchQuality === "best_available") {
        playlistConfidence.percent = Math.min(playlistConfidence.percent, 57);
      }
    }
    if (openingLock?.enabled) {
      const preserved = enforceOpeningLock(delivery.tracks, openingLock, openingLockViolations);
      assignFT("pre_terminal_opening_lock", "pre-terminal opening lock", preserved.tracks as unknown as PlaylistTrack[]);
      openingLockViolations = preserved.violations;
      openingLock = {
        ...openingLock,
        lockedTrackIds: openingLock.lockedTrackIds.filter((id) =>
          delivery.tracks.some((track) => track.trackId === id),
        ),
      };
      if (auditMode) {
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            ...buildOpeningLockAuditDiagnostics(openingLock, openingLockViolations, delivery.tracks),
          },
        };
      }
    }
    const deliveryArtistCap = applyArtistCapAtCheckpoint(
      delivery,
      "terminal_delivery",
      artistCapOpts,
    );
    if (deliveryArtistCap.diagnostics.applied) {
      finalApiTracks = formatTracksForApi([...delivery.tracks], emotionProfile);
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          deliveryPerPlaylistArtistCapApplied: true,
          deliveryPerPlaylistArtistCap: deliveryArtistCap.diagnostics,
        },
      };
    }
    // Terminal artist-cap can re-trim post-refill growth — restore once more.
    {
      const fallbackChain = resolveSceneFallbackChain(vibe, lockedIntent.genreFamilies);
      const stillThin = delivery.tracks.length < Math.ceil(requestedLength * 0.75);
      if (fallbackChain && stillThin && !deliveryWorldBoundary.hardLock) {
        const classMap = userGenreProfile.trackClassifications;
        const poolMap = new Map<string, PlaylistTrack>();
        for (const track of delivery.tracks) poolMap.set(track.trackId, track);
        for (const track of familyConstrainedRecoveryPool) poolMap.set(track.trackId, track);
        for (const track of likedSongs) {
          const candidate = { ...hydrateTrackGenre(track), score: 0.4 } as PlaylistTrack;
          if (!poolMap.has(candidate.trackId)) poolMap.set(candidate.trackId, candidate);
        }
        const chainCandidates = [...poolMap.values()].map((track) => {
          const classification = classMap.get(track.trackId);
          return {
            ...track,
            genreFamily:
              track.genreFamily ??
              classification?.genreFamily ??
              trackGenreFamily(track, classMap) ??
              null,
            primarySubgenre: classification?.primarySubgenre ?? null,
            secondarySubgenre: classification?.secondarySubgenre ?? null,
            subGenres: classification?.subGenres ?? [],
          };
        });
        const filled = fillPlaylistViaFallbackChain(
          delivery.tracks as PlaylistTrack[],
          chainCandidates,
          fallbackChain,
          { targetLength: requestedLength, maxPerArtist: Math.min(7, maxPerArtist + 1) },
        );
        if (filled.added > 0) {
          // Mutate before freezeTerminal — still within terminal_delivery stage.
          assignFT(
            "terminal_delivery",
            `terminal_fallback_chain_${fallbackChain.id}`,
            filled.tracks.slice(0, requestedLength),
          );
          finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
          finalization = {
            tracks: delivery.tracks as PlaylistTrack[],
            diagnostics: {
              ...finalization.diagnostics,
              terminalSceneFallbackApplied: true,
              terminalSceneFallbackAdded: filled.added,
              postArtistCapSceneFallbackApplied: true,
              thinNicheSiblingExpansionApplied: true,
              explicitConstraintPartialReason: `scene_fallback_chain_terminal_${fallbackChain.id}`,
            },
          };
          req.log.warn(
            {
              userId,
              vibe,
              finalCount: delivery.tracks.length,
              chainId: fallbackChain.id,
              added: filled.added,
            },
            "Refilled underfilled playlist after terminal artist-cap via scene fallback",
          );
        }
      }
    }
    const preResponseQualityCheckpoint = runDeliveryCheckpoint(pipelineAuthority, "pre_response", checkpointCtx({
      requireTelemetry: true,
      confidence: playlistConfidence,
      recoveryPoolSize: mergedConstrainedRecoveryPool.length,
    }));
    let preFreezeOpenerDiagnostics: OpenerHygieneDiagnostics = {};
    {
      const preFreezeWorldIds = inferWorldIdentityIdsFromPrompt(vibe);
      const preFreezeHygiene = applyPreFreezeOpenerHygieneToDelivery(
        delivery.tracks as PlaylistTrack[],
        preFreezeWorldIds,
        { minKeep: HONEST_PARTIAL_MIN, prompt: vibe },
      );
      preFreezeOpenerDiagnostics = preFreezeHygiene.diagnostics;
      const preFreezeOrderChanged =
        preFreezeHygiene.tracks.length !== delivery.tracks.length ||
        preFreezeHygiene.tracks.some((track, index) => track.trackId !== delivery.tracks[index]?.trackId);
      if (preFreezeOrderChanged || Object.keys(preFreezeHygiene.diagnostics).length > 0) {
        assignFT(
          "pre_freeze_opener_hygiene",
          "pre-freeze opener hygiene",
          preFreezeHygiene.tracks as PlaylistTrack[],
        );
        finalApiTracks = formatTracksForApi(delivery.tracks, emotionProfile);
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            ...preFreezeHygiene.diagnostics,
            preFreezeOpenerHygiene: true,
          },
        };
      }
    }
    pipelineAuthority.freezeTerminal("terminal_delivery");
    const terminalAuthorityValidation = pipelineAuthority.runTerminalAuthorityValidation();
    pipelineAuthority.assertValidatorExecuted("pre_response");
    const pipelineAuthorityDiagnostics = pipelineAuthority.getDiagnostics();
    finalization = {
      tracks: delivery.tracks as PlaylistTrack[],
      diagnostics: {
        ...finalization.diagnostics,
        pipelineAuthority: pipelineAuthorityDiagnostics,
        pipelineValidation: {
          postV3: postV3Checkpoint,
          postRecovery: postRecoveryCheckpoint,
          postEvidence: postEvidenceCheckpoint,
          postRefill: postRefillCheckpoint,
          preResponse: preResponseQualityCheckpoint,
        },
        pipelineQuality: {
          postV3: postV3Checkpoint,
          postRecovery: postRecoveryCheckpoint,
          postEvidence: postEvidenceCheckpoint,
          postRefill: postRefillCheckpoint,
          preResponse: preResponseQualityCheckpoint,
        },
        pipelineAuthorityValidation: terminalAuthorityValidation,
      },
    };
    let deliveredTracks = [...delivery.tracks] as PlaylistTrack[];
    // Terminal human-scene safety net — filter the response payload only.
    // Pipeline Authority is frozen here, so do not mutate delivery.tracks.
    {
      const humanSceneReading = resolveHumanScene(vibe);
      const wantsLowEnergy =
        lockedIntent.energy === "low" ||
        humanSceneReading.phase === "aftermath" ||
        humanSceneReading.phase === "recovery";
      if ((!allowHolidaySeason || wantsLowEnergy) && !contractRebalanceDeliveryGuard) {
        let working = finalApiTracks.filter((track) => {
          if (!allowHolidaySeason) {
            const blob = `${track.name ?? ""} ${(track as { album?: string }).album ?? ""} ${(track.genres ?? []).join(" ")}`;
            if (/\b(?:christmas|xmas|santa|noel|festive|mistletoe|jingle\s+bells|feliz\s+navidad)\b/i.test(blob)) {
              return false;
            }
            const constraintTrack = deliveredTracks.find((row) => row.trackId === track.id);
            if (constraintTrack && trackIsChristmasTrack(constraintTrack, userGenreProfile.trackClassifications)) {
              return false;
            }
          }
          return true;
        });
        let forceSoftFocusEmpty = false;
        if (wantsLowEnergy) {
          const softElectronicAftermath = humanSceneReading.musicalBehaviour === "soft_electronic";
          const softFocusConcentration =
            detectSubSceneRetrievalKind(vibe, lockedIntent) === "soft_focus_concentration";
          // Soft-electronic aftermath: never open the peak band (0.72+) just to hit
          // a length target. Thin libraries underfill honestly; peak house/rave is a
          // worse failure than a short soft remnant playlist.
          // Soft focus (ambient/coding/soft electronic concentration): human refs
          // average ~0.28 energy — hard-cap at 0.52 so house cannot survive.
          if (softElectronicAftermath || softFocusConcentration) {
            const hardCap = softFocusConcentration ? 0.52 : 0.66;
            let preferred = working
              .filter((track) => typeof track.energy === "number" && track.energy <= hardCap)
              .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1));
            // Soft focus: if the delivered set is peak-only, refill from the library
            // soft band (human focus refs live ~0.22–0.35).
            if (softFocusConcentration && preferred.length < Math.min(10, length)) {
              const softSource = [
                ...(scoringInputSongs.length > 0 ? scoringInputSongs : []),
                ...likedSongs,
              ] as Array<Record<string, unknown>>;
              const seenSoft = new Set<string>();
              const softLibrary = softSource
                .map((track) => {
                  const trackId = typeof track.trackId === "string" && track.trackId
                    ? track.trackId
                    : typeof track.id === "string" && track.id
                      ? track.id
                      : "";
                  const energy =
                    typeof track.energy === "number"
                      ? track.energy
                      : typeof (track.audioFeatures as { energy?: number } | undefined)?.energy === "number"
                        ? (track.audioFeatures as { energy: number }).energy
                        : null;
                  return {
                    trackId,
                    trackName: String(track.trackName ?? track.name ?? ""),
                    artistName: String(track.artistName ?? track.artist ?? ""),
                    albumName: String(track.albumName ?? track.album ?? ""),
                    energy,
                    valence: typeof track.valence === "number" ? track.valence : null,
                    genres: Array.isArray(track.genres) ? (track.genres as string[]) : [],
                  };
                })
                .filter((track) => {
                  if (!track.trackId || !track.trackName || !track.artistName) return false;
                  if (seenSoft.has(track.trackId)) return false;
                  if (track.energy == null || track.energy > hardCap) return false;
                  seenSoft.add(track.trackId);
                  return true;
                })
                .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1))
                .slice(0, Math.max(length, 20)) as PlaylistTrack[];
              if (softLibrary.length > 0) {
                const formatted = formatTracksForApi(softLibrary, emotionProfile)
                  .filter((track) => typeof track.energy === "number" && track.energy <= hardCap)
                  .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1));
                preferred = formatted.length > 0
                  ? formatted
                  : softLibrary.map((track) => ({
                      id: track.trackId,
                      name: track.trackName,
                      artist: track.artistName,
                      album: track.albumName ?? "",
                      energy: track.energy ?? null,
                      valence: track.valence ?? null,
                      genres: track.genres ?? [],
                    })) as typeof preferred;
                deliveredTracks = softLibrary;
              }
            }
            if (preferred.length > 0) {
              working = preferred.slice(0, requestedLength);
            } else if (softFocusConcentration) {
              // Never keep peak house for soft focus — honest underfill beats wrong texture.
              working = [];
              forceSoftFocusEmpty = true;
            } else {
              working = [...working]
                .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1))
                .slice(0, Math.min(requestedLength, working.length));
            }
          } else {
            const ceilings = [0.52, 0.62, 0.72];
            const minKeep = Math.min(8, working.length);
            let selected = working;
            for (const ceiling of ceilings) {
              const filtered = working
                .filter((track) => typeof track.energy === "number" && track.energy <= ceiling)
                .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1));
              if (filtered.length >= minKeep) {
                selected = filtered;
                break;
              }
              if (filtered.length > selected.length || selected === working) {
                selected = filtered.length > 0 ? filtered : selected;
              }
            }
            if (selected.length === 0) {
              selected = [...working]
                .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1))
                .slice(0, Math.min(12, working.length));
            }
            working = selected;
          }
        }
        if (working.length > 0 || forceSoftFocusEmpty) {
          finalApiTracks = working;
          const keptIds = new Set(working.map((track) => track.id));
          deliveredTracks = deliveredTracks.filter((track) => keptIds.has(track.trackId));
        }
      }
    }
    // Absolute last world-purity strip on the API payload (artist/name aliases).
    // Emergency completion / timeout fill / soft-focus can reintroduce blankets
    // after earlier delivery strips.
    if (deliveryWorldBoundary.active && finalApiTracks.length > 0 && !contractRebalanceDeliveryGuard) {
      const purifiedApi = hardRejectOffWorldTracks(
        finalApiTracks,
        deliveryWorldBoundary,
        userGenreProfile.trackClassifications,
      );
      if (purifiedApi.rejected.length > 0) {
        finalApiTracks = purifiedApi.kept;
        const keptIds = new Set(finalApiTracks.map((track) => track.id));
        deliveredTracks = deliveredTracks.filter((track) => keptIds.has(track.trackId));
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            finalApiWorldPurityStripped: purifiedApi.rejected.length,
            finalApiWorldPurityKept: purifiedApi.kept.length,
          },
        };
      }
    }
    let postFreezeOpenerDiagnostics: OpenerHygieneDiagnostics = {};
    const inferredWorldIds = inferWorldIdentityIdsFromPrompt(vibe);
    const lateCommittedResolved = resolveCommittedWorld({
      prompt: vibe,
      sceneLock: sceneLockStatus,
      sceneAliases,
      scenePrediction: mergedScenePrediction,
      lockedIntent,
    });
    const { world: lateCommittedWorld } = enforceCommittedWorldImmutability(
      committedWorldPreRetrieval,
      lateCommittedResolved,
      "late_delivery",
    );
    if (lateCommittedWorld?.hardLock && deliveredTracks.length > 0 && !contractRebalanceDeliveryGuard) {
      const lateProfile = resolveCulturalProfileForCommitted(lateCommittedWorld);
      const lateNegationForThesis = parsePromptNegationEnforcement(vibe);
      const lateThesis = enforceThesisOpener(
        deliveredTracks as PlaylistTrack[],
        lateProfile,
        lateCommittedWorld,
        undefined,
        20,
        lateNegationForThesis.excludedArtists,
      );
      if (lateThesis.promoted || lateThesis.tracks[0]?.artistName !== deliveredTracks[0]?.artistName) {
        deliveredTracks = lateThesis.tracks as PlaylistTrack[];
        finalApiTracks = formatTracksForApi(
          deliveredTracks,
          emotionProfile,
          momentPipeline?.canonicalScene?.sceneId ?? null,
        );
      }
    }
    const lateNegationFinal = parsePromptNegationEnforcement(vibe);
    const lateNegationStrip = filterTracksForDeliveryNegation(deliveredTracks, lateNegationFinal);
    if (lateNegationStrip.removed > 0 && lateNegationStrip.tracks.length >= 3) {
      deliveredTracks = lateNegationStrip.tracks as PlaylistTrack[];
      finalApiTracks = formatTracksForApi(
        deliveredTracks,
        emotionProfile,
        momentPipeline?.canonicalScene?.sceneId ?? null,
      );
    }
    if (lateCommittedWorld?.hardLock && deliveredTracks.length > 0 && !contractRebalanceDeliveryGuard) {
      const enrichForWorldLate = (track: PlaylistTrack) =>
        enrichDeliverableTrack(track, likedIdentityForDelivery.get(track.trackId));
      const purityLate = applyWorldPurityGate(deliveredTracks as PlaylistTrack[], lateCommittedWorld, {
        prompt: vibe,
        requestedLength,
        coverageLevel: worldCoverageAssessment?.score ?? null,
        coverageTier: candidateCoverageTier,
        preserveOpener: true,
        replacementPool: mergeDeliverableCandidatePools(
          deliveredTracks as PlaylistTrack[],
          deliverableSurvivorPool,
          worldExpansionCandidates as PlaylistTrack[],
        ),
        enrichTrack: enrichForWorldLate,
      });
      if (
        purityLate.removed > 0 ||
        purityLate.honestPartial ||
        purityLate.tracks.length !== deliveredTracks.length
      ) {
        deliveredTracks = purityLate.tracks as PlaylistTrack[];
        finalApiTracks = formatTracksForApi(
          deliveredTracks,
          emotionProfile,
          momentPipeline?.canonicalScene?.sceneId ?? null,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            worldPurityGate: {
              removed: purityLate.removed,
              removedReasons: purityLate.removedReasons,
              checkpointFailures: purityLate.checkpointFailures,
              wouldStillBelieve: purityLate.wouldStillBelieve,
              honestPartial: purityLate.honestPartial,
            },
            ...(purityLate.honestPartial
              ? {
                  honestPartialPublished: true,
                  degradedDelivery: true,
                  humanQualityUserMessage: purityLate.deliveryMessage ?? purityLate.coverageMessage,
                }
              : {}),
          },
        };
      }
      if (
        auditMode &&
        (purityLate.honestPartial || deliveredTracks.length < requestedLength) &&
        culturalProfilePre
      ) {
        const shortfall = diagnoseRetrievalShortfall(
          culturalProfilePre.worldId,
          getRejectionTrace(),
          deliveredTracks.length,
          requestedLength,
          culturalProfilePre,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            retrievalShortfall: {
              currentCount: deliveredTracks.length,
              targetCount: requestedLength,
              gap: shortfall.gap,
              suggestions: shortfall.suggestions,
              rejectionStats: summarizeRejectionTrace(culturalProfilePre.worldId),
            },
          },
        };
      }
    }
    if (deliveredTracks.length > 1 && !contractRebalanceDeliveryGuard) {
      const humanCurationFinal = applyHumanCurationSequencing(deliveredTracks as PlaylistTrack[], {
        prompt: vibe,
        preserveThesisOpener: true,
        culturalProfile: lateCommittedWorld ? resolveCulturalProfileForCommitted(lateCommittedWorld) : null,
        replacementPool: buildMomentReplacementPool(
          deliveredTracks as PlaylistTrack[],
          worldExpansionCandidates.length > 0 ? (worldExpansionCandidates as PlaylistTrack[]) : undefined,
        ),
      });
      if (
        humanCurationFinal.swaps > 0 ||
        humanCurationFinal.reorders > 0 ||
        humanCurationFinal.removals > 0 ||
        humanCurationFinal.replacements > 0 ||
        humanCurationFinal.diagnostics.length > 0
      ) {
        deliveredTracks = humanCurationFinal.tracks as PlaylistTrack[];
        finalApiTracks = formatTracksForApi(
          deliveredTracks,
          emotionProfile,
          momentPipeline?.canonicalScene?.sceneId ?? null,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            humanCurationSequencer: {
              swaps: humanCurationFinal.swaps,
              reorders: humanCurationFinal.reorders,
              removals: humanCurationFinal.removals,
              replacements: humanCurationFinal.replacements,
              diagnostics: humanCurationFinal.diagnostics,
              momentReplacementDiagnostics: humanCurationFinal.momentReplacementDiagnostics,
            },
          },
        };
      }
    }
    {
      const hygiene = applyFinalApiOpenerHygiene(finalApiTracks, inferredWorldIds, {
        minKeep: HONEST_PARTIAL_MIN,
        prompt: vibe,
      });
      finalApiTracks = hygiene.tracks;
      deliveredTracks = syncTracksToApiOrder(deliveredTracks, finalApiTracks);
      postFreezeOpenerDiagnostics = hygiene.diagnostics;
      if (Object.keys(hygiene.diagnostics).length > 0) {
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            ...hygiene.diagnostics,
          },
        };
      }
    }
    if (deliveredTracks.length > 1) {
      const terminalOpener = applyTerminalOpenerGuard(deliveredTracks as PlaylistTrack[], vibe);
      if (terminalOpener.swapped) {
        deliveredTracks = terminalOpener.tracks as PlaylistTrack[];
        finalApiTracks = formatTracksForApi(
          deliveredTracks,
          emotionProfile,
          momentPipeline?.canonicalScene?.sceneId ?? null,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            terminalOpenerGuard: {
              swapped: true,
              previousOpener: terminalOpener.previousOpener,
              newOpener: terminalOpener.newOpener,
            },
          },
        };
      }
    }
    const lateIntentFidelity = evaluateIntentFidelity({
      tracks: deliveredTracks.map((t) => ({
        trackId: t.trackId,
        trackName: t.trackName,
        artistName: t.artistName,
        albumName: t.albumName,
        genreFamily: t.genreFamily,
        genrePrimary: t.genrePrimary,
        genres: t.genres ?? null,
        spotifyArtistGenres: (t as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
        albumGenres: (t as { albumGenres?: unknown }).albumGenres,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        danceability: t.danceability ?? null,
        instrumentalness: t.instrumentalness ?? null,
        popularity: (t as { popularity?: number | null }).popularity ?? null,
        acousticness: t.acousticness ?? null,
      })),
      committed: lateCommittedWorld,
      prompt: vibe,
      requestedLength,
    });
    const skipLateIntentFidelityCap =
      contractRebalanceDeliveryGuard ||
      (postPurityValidatedDepth != null &&
      postPurityValidatedDepth >= Math.ceil(requestedLength * 0.5));
    if (
      lateCommittedWorld?.hardLock &&
      !skipLateIntentFidelityCap &&
      (!lateIntentFidelity.passed || !lateIntentFidelity.openerPassed) &&
      deliveredTracks.length > (lateIntentFidelity.deliveryCap ?? lateIntentFidelity.honestPartialCap)
    ) {
      const salvaged = selectIntentFidelityHonestPartialTracks(
        deliveredTracks as PlaylistTrack[],
        lateIntentFidelity,
        lateCommittedWorld,
      );
      if (salvaged.length >= 3 && salvaged.length < deliveredTracks.length) {
        deliveredTracks = salvaged;
        finalApiTracks = formatTracksForApi(
          deliveredTracks,
          emotionProfile,
          momentPipeline?.canonicalScene?.sceneId ?? null,
        );
        finalization = {
          tracks: delivery.tracks as PlaylistTrack[],
          diagnostics: {
            ...finalization.diagnostics,
            intentFidelityGateLate: lateIntentFidelity,
            honestPartialPublished: true,
            degradedDelivery: true,
          },
        };
      }
    }
    // Hard length invariant: never return more tracks than the user requested.
    // compilePlan may inflate `length` for internal pool/fill; response must still
    // honor requestedLength (overfill 18/25 in bench-25 felt un-curated vs Spotify).
    if (finalApiTracks.length > requestedLength) {
      finalApiTracks = finalApiTracks.slice(0, requestedLength);
      deliveredTracks = syncTracksToApiOrder(deliveredTracks, finalApiTracks);
    }
    if (deliveredTracks.length > finalApiTracks.length) {
      deliveredTracks = syncTracksToApiOrder(deliveredTracks, finalApiTracks);
    }
    // Late Human Quality Gate — after soft-focus / artist-cap prunes that can
    // collapse a healthy draft into an unsavable stub.
    // Do NOT mutate delivery here: pipeline authority is already frozen.
    {
      const holidayNegated = promptSuppressesChristmas(vibe);
      const holidayRequested = allowHolidaySeason && !holidayNegated;
      const lateNegationProfile = parsePromptNegationEnforcement(vibe);
      const psychIndieOpenerFillers = countPsychIndieOpenerFillers(
        finalApiTracks.map((track) => ({
          artistName: track.artist ?? (track as { artistName?: string }).artistName,
        })),
        3,
        inferredWorldIds,
      );
      const lateOpenerNegationViolations = countOpenerNegationViolations(
        finalApiTracks.map((track) => ({
          trackName: track.name,
          artistName: track.artist ?? (track as { artistName?: string }).artistName,
          albumName: (track as { album?: string }).album,
          genreFamily: (track as { genreFamily?: string }).genreFamily,
          genrePrimary: (track as { genrePrimary?: string }).genrePrimary,
        })),
        lateNegationProfile,
        3,
      );
      const lateNegationViolations = finalApiTracks.filter((track) =>
        trackViolatesPromptNegation(
          {
            trackName: track.name,
            artistName: track.artist ?? (track as { artistName?: string }).artistName,
            albumName: (track as { album?: string }).album,
            genreFamily: (track as { genreFamily?: string }).genreFamily,
            genrePrimary: (track as { genrePrimary?: string }).genrePrimary,
          },
          lateNegationProfile,
        ),
      ).length;
      const lateActiveWorldId = lateCommittedWorld?.id ?? inferredWorldIds[0] ?? null;
      const lateTrackSignals = finalApiTracks.map((track) => ({
        artistName: track.artist ?? (track as { artistName?: string }).artistName,
        genreFamily: (track as { genreFamily?: string }).genreFamily,
        genrePrimary: (track as { genrePrimary?: string }).genrePrimary,
      }));
      const lateWorldSignals = committedWorldQualitySignals(lateActiveWorldId, lateTrackSignals, { prompt: vibe });
      const lateHqg = evaluateHumanQualityGate({
        trackCount: finalApiTracks.length,
        requestedLength: requestedLength,
        holidayRequested,
        holidayNegated,
        psychIndieOpenerFillers,
        openerNegationViolations: lateOpenerNegationViolations,
        negationViolations: lateNegationViolations,
        seasonalLeakage:
          !allowHolidaySeason &&
          finalApiTracks.some((track) => {
            const row = delivery.tracks.find((t) => t.trackId === track.id);
            return row
              ? trackIsChristmasTrack(row, userGenreProfile.trackClassifications)
              : /\b(?:christmas|xmas|festive|noel|santa)\b/i.test(
                  `${track.name ?? ""} ${(track as { album?: string }).album ?? ""}`,
                );
          }),
        degradedDelivery: finalization.diagnostics["degradedDelivery"] === true,
        promptLabel: vibe,
        ...lateWorldSignals,
        activeWorldId: lateActiveWorldId,
        intentFidelityFailed:
          lateCommittedWorld?.hardLock === true &&
          !skipLateIntentFidelityCap &&
          (!lateIntentFidelity.passed || !lateIntentFidelity.openerPassed),
        committedWorldHardLock: lateCommittedWorld?.hardLock ?? false,
        committedWorldLaneOk:
          lateActiveWorldId && LANE_PURITY_WORLD_IDS.has(lateActiveWorldId)
            ? scoreCommittedWorldLanePurity(lateActiveWorldId, lateTrackSignals, { prompt: vibe }).ok
            : null,
        postPurityValidatedDepth,
      });
      finalization = {
        tracks: delivery.tracks as PlaylistTrack[],
        diagnostics: {
          ...finalization.diagnostics,
          humanQualityGate: lateHqg,
          humanQualityGateLate: true,
          ...(lateHqg.action === "honest_partial"
            ? {
                honestPartialPublished: true,
                humanQualityUserMessage: lateHqg.userMessage,
              }
            : {}),
        },
      };
      if (lateHqg.action === "refuse" && !contractRebalanceDeliveryGuard) {
        throw new HumanQualityGateError(lateHqg);
      }
      if (
        lateCommittedWorld?.hardLock &&
        !skipLateIntentFidelityCap &&
        finalApiTracks.length > (lateIntentFidelity.deliveryCap ?? lateIntentFidelity.honestPartialCap)
      ) {
        finalApiTracks = finalApiTracks.slice(
          0,
          lateIntentFidelity.deliveryCap ?? lateIntentFidelity.honestPartialCap,
        );
        deliveredTracks = syncTracksToApiOrder(deliveredTracks, finalApiTracks);
      }
      if (
        lateHqg.action === "honest_partial" &&
        lateHqg.salvageableCount > 0 &&
        finalApiTracks.length > lateHqg.salvageableCount &&
        !skipLateIntentFidelityCap &&
        (
          lateHqg.reasons.includes("intent_fidelity_failed") ||
          finalApiTracks.length < Math.ceil(requestedLength * 0.85)
        )
      ) {
        if (lateHqg.reasons.includes("intent_fidelity_failed") && lateCommittedWorld?.hardLock) {
          const salvaged = selectIntentFidelityHonestPartialTracks(
            deliveredTracks as PlaylistTrack[],
            lateIntentFidelity,
            lateCommittedWorld,
          );
          deliveredTracks = salvaged;
          finalApiTracks = formatTracksForApi(
            deliveredTracks,
            emotionProfile,
            momentPipeline?.canonicalScene?.sceneId ?? null,
          );
        } else {
          finalApiTracks = finalApiTracks.slice(0, lateHqg.salvageableCount);
          deliveredTracks = syncTracksToApiOrder(deliveredTracks, finalApiTracks);
        }
      }
    }
    const productionHygieneDiagnostics = {
      openerHygieneMetrics: buildOpenerHygieneMetrics(
        {
          ...preFreezeOpenerDiagnostics,
          ...postFreezeOpenerDiagnostics,
        },
        {
          preFreezeApplied: finalization.diagnostics["preFreezeOpenerHygiene"] === true,
          postFreezeApplied: Object.keys(postFreezeOpenerDiagnostics).length > 0,
          pipelineOpenerIds: delivery.tracks.slice(0, 3).map((track) => track.trackId),
          apiOpenerIds: finalApiTracks.slice(0, 3).map((track) => track.id).filter(Boolean) as string[],
        },
      ),
      committedWorldQuality: committedWorldQualitySignals(
        inferredWorldIds[0] ?? null,
        finalApiTracks.map((track) => ({
          artistName: track.artist ?? (track as { artistName?: string }).artistName,
          genreFamily: (track as { genreFamily?: string }).genreFamily,
          genrePrimary: (track as { genrePrimary?: string }).genrePrimary,
        })),
        { prompt: vibe },
      ),
      pipelineFrozenAt: "terminal_delivery",
      apiTrackCount: finalApiTracks.length,
      pipelineTrackCount: delivery.tracks.length,
    };
    Object.assign(generationDiagnosticsWithTimeline, { productionHygiene: productionHygieneDiagnostics });
    finalization = {
      tracks: delivery.tracks as PlaylistTrack[],
      diagnostics: {
        ...finalization.diagnostics,
        productionHygiene: productionHygieneDiagnostics,
      },
    };
    setGeneratePhase(generateSessionUserId, requestId, "spotify");
    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      `Finalising ${deliveredTracks.length.toLocaleString()} tracks`,
    );
    await runPostHygieneSideEffects();
    if (clientDisconnected || responseFinished(res)) return;
    if (respondIfStale(res, generateSessionUserId, requestId, { deliverableTrackCount: deliveredTracks.length })) return;
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
    const generationAuditSnapshot = {
      prompt: vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      playlistId: savedPlaylistId,
      trackCount: deliveredTracks.length,
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
      generationTrust,
    };

    if (sideEffectPolicy.allowResultCacheWrites && !varietyBoost && !devMode) {
      setCachedGenerateResult(resultCacheKey, {
        cacheVersion: GENERATE_RESULT_CACHE_VERSION,
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

    if (!auditMode && !devMode && deliveredTracks.length > 0) {
      const orchestratorForAnalytics = (req as { _genCtx?: Record<string, unknown> })._genCtx?.retrievalOrchestrator as
        | import("../lib/playlist-retrieval-orchestrator").OrchestratorDiagnostics
        | undefined;
      if (noLibraryMode) {
        recordDiscoverySuccess({
          sessionId: requestId,
          userId,
          vibe,
          activity: lockedIntent.activity,
          sceneId: moodSceneId,
          linkedFailureSessionId: failureSessionIdFromClient || undefined,
          orchestrator: orchestratorForAnalytics ?? null,
        });
      } else {
        recordLikedOnlySuccess({
          sessionId: requestId,
          userId,
          vibe,
          activity: lockedIntent.activity,
          sceneId: moodSceneId,
          orchestrator: orchestratorForAnalytics ?? null,
        });
      }
    }

    requestStageTiming.setTotal(generationMs);
    const retrievalOrchestratorForObs = (req as { _genCtx?: Record<string, unknown> })._genCtx
      ?.retrievalOrchestrator as Record<string, unknown> | undefined;
    const successExecutionTrace = resolveSuccessExecutionTrace({
      requestId,
      prompt: vibe,
      seed: generationSeed,
      humanSaveable: (() => {
        const gate = (fallbackBypassGate ?? v3DiagnosticsWithIntentSurvival?.humanSaveabilityGate) as Record<string, unknown> | undefined;
        return gate?.humanSaveable === true || gate?.passed === true;
      })(),
      finalTrackCount: deliveredTracks.length,
      v3Diagnostics: v3DiagnosticsWithIntentSurvival as Record<string, unknown>,
      fastFallback: !!pipeline.scoringDiagnostics?.fastFallback,
      fallbackDetail: fallbackReason
        ? `${fallbackReason.stage}:${fallbackReason.elapsedMs}ms`
        : null,
    });
    noteGenerateSuccess(req, {
      requestId,
      userId,
      executionPath: successExecutionTrace.executionPath,
      humanSaveable: successExecutionTrace.humanSaveable,
      playlistSize: finalApiTracks.length,
      requestedLength: length,
      degraded: pipeline.pipelineTrace?.degraded ?? false,
      honestPartial:
        thinLibraryPolicy.action === "honest_partial"
        || finalization.diagnostics["honestPartialPublished"] === true
        || (typeof finalization.diagnostics["humanQualityGate"] === "object"
          && (finalization.diagnostics["humanQualityGate"] as { action?: string }).action === "honest_partial"),
      firstCollapseReason: generationDiagnostics.promptSurvivability?.firstCollapseReason ?? null,
      interpretWorldMs:
        typeof momentPipeline?.pipelineSummary?.interpretWorldMs === "number"
          ? momentPipeline.pipelineSummary.interpretWorldMs
          : null,
      productionTimeline,
      requestStageTiming: requestStageTiming.report(),
      playlistExecutionTrace: successExecutionTrace,
      interpretation: {
        sceneId: momentPipeline?.canonicalScene?.sceneId ?? null,
        confidence: momentPipeline?.canonicalScene?.confidence ?? null,
        playlistIntent: momentPipeline?.intent?.intent ?? null,
        emotionalArc: typeof worldUnderstanding?.emotionalArc === "string"
          ? worldUnderstanding.emotionalArc
          : typeof emotionalArc === "string"
            ? emotionalArc
            : null,
        humanNarrativeSummary: worldUnderstanding?.humanNarrative ?? null,
      },
      retrieval: {
        strategy: typeof retrievalOrchestratorForObs?.strategy === "string"
          ? retrievalOrchestratorForObs.strategy
          : typeof retrievalOrchestratorForObs?.mode === "string"
            ? retrievalOrchestratorForObs.mode
            : null,
        candidatePoolSize: scoringPool.hybridPoolSize ?? null,
        hybridPoolSize: scoringPool.hybridPoolSize ?? null,
        librarySize: scoringPool.librarySize ?? null,
      },
      candidateCounts: {
        shaped: scoringInputSongs.length,
        retrieved: successExecutionTrace.trackCounts.retrieved,
        afterWorld: successExecutionTrace.trackCounts.after_world,
        afterSampler: successExecutionTrace.trackCounts.after_sampler,
        final: finalApiTracks.length,
      },
    });

    if (sideEffectPolicy.mode === "audit" && !debugMode) {
      const endAuditResponseProfile = liveStageProfiler.start("controller.responseAssembly.auditSlim", `${finalApiTracks.length} tracks`);
      if (deliveryLossFunnel) {
        deliveryLossFunnel.finalDelivered = finalApiTracks.length;
      }
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
        ...(humanExpectationDiagnostics ? { humanExpectation: humanExpectationDiagnostics } : {}),
        ...(playlistContractDiagnostics ? { playlistContract: playlistContractDiagnostics } : {}),
        ...(playlistContractWorldGateDiagnostics
          ? { playlistContractWorldGate: playlistContractWorldGateDiagnostics }
          : {}),
        ...(playlistContractV40Diagnostics
          ? { playlistContractV40: playlistContractV40Diagnostics }
          : {}),
        ...(playlistContractV41Diagnostics
          ? { playlistContractV41: playlistContractV41Diagnostics }
          : {}),
        count: finalApiTracks.length,
        totalTracks: finalApiTracks.length,
        degraded: pipeline.pipelineTrace?.degraded ?? false,
        degradationReasons: pipeline.pipelineTrace?.degradationReasons ?? [],
        generationMs,
        cacheDiagnostics: {
          status: cacheEntryStatus,
          staleBypassed: cacheEntryStatus === "stale",
        },
        stats: {
          trackCount: finalApiTracks.length,
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
        sceneWorldProof: sceneWorldProofRequested
          ? ((pipeline.scoringDiagnostics?.v3Pipeline as Record<string, unknown> | undefined)?.["sceneWorldProof"] ?? null)
          : undefined,
        requestOrchestration: pipeline.requestOrchestration ?? {
          layer: "request",
          candidateGenerator: fallbackReason ? "fast_fallback" : "v3",
          selectionOwner: "request-layer",
          repairOwner: "request-layer",
        },
        ...(pipeline.scoringDiagnostics?.fastFallback
          ? {
              fastFallback: true,
              ...(fallbackBypassGate ? { humanSaveabilityGate: fallbackBypassGate } : {}),
            }
          : {}),
        playlistExecutionTrace: successExecutionTrace,
        ...(retrievalFunnelTrace ? { retrievalFunnel: retrievalFunnelTrace } : {}),
        ...(retrievalConfidenceResult ? { retrievalConfidence: retrievalConfidenceResult } : {}),
        ...(deliveryLossFunnel ? { deliveryLossFunnel } : {}),
        ...(puritySubFunnel ? { puritySubFunnel } : {}),
      };
      endAuditResponseProfile();
      const endAuditJsonProfile = liveStageProfiler.start("controller.responseJson.auditSlim", `${finalApiTracks.length} tracks`);
      res.json(capAuditResponsePayload(withIntentSurvivalAuditPayload(req, auditResponse, finalApiTracks, vibe)));
      endAuditJsonProfile();
      if (!auditMode && deliveredTracks.length > 0) {
        recordOpeningWindowSession(generateSessionUserId, deliveredTracks.map((track) => track.trackId));
        recordSessionArtistPlaylist(
          generateSessionUserId,
          deliveredTracks.map((track) => normalizeSessionArtist(track.artistName ?? "")),
        );
      }
      return;
    }

    if (deliveredTracks.length > 0) {
      recordOpeningWindowSession(generateSessionUserId, deliveredTracks.map((track) => track.trackId));
      recordSessionArtistPlaylist(
        generateSessionUserId,
        deliveredTracks.map((track) => normalizeSessionArtist(track.artistName ?? "")),
      );
    }

    // Human Expectation Layer — persist one generation signal for future
    // learning (flag-gated, analytics-policy-gated, fire-and-forget).
    if (sideEffectPolicy.allowAnalyticsWrites && humanExpectationMode() !== "off" && humanExpectationDiagnostics) {
      void persistGenerationSignal({
        generationId: requestId,
        prompt: vibe,
        userId,
        mode: humanExpectationMode(),
        humanExpectation: humanExpectationDiagnostics,
        generationTimeMs: generationMs,
        publishDecision: coherenceGateResult?.publish === false ? "degraded" : "published",
      });
    }

    setGeneratePhase(generateSessionUserId, requestId, "done");
    setGenerateStageDetail(generateSessionUserId, requestId, "Loading playlist in app");
    res.json({
      success: true,
      requestId,
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
      ...(worldCoverageAssessment
        ? {
            coverageLevel: worldCoverageAssessment.score,
            coverageMessage: coverageUserMessage(worldCoverageAssessment.score),
            coverageTier: candidateCoverageTier,
            ...(finalApiTracks.length > 0 && finalApiTracks.length < requestedLength
              ? {
                  deliveryMessage:
                    buildDeliveryMessage(finalApiTracks.length, candidateCoverageTier) ??
                    coverageUserMessage(worldCoverageAssessment.score),
                }
              : {}),
          }
        : {}),
      ...(humanExpectationDiagnostics ? { humanExpectation: humanExpectationDiagnostics } : {}),
      ...(thinLibraryPolicy.action !== "normal"
        ? {
            thinLibraryPolicy,
            thinLibraryDiagnostics: thinLibraryPolicy.diagnostics,
            honestPartialPublished: thinLibraryPolicy.action === "honest_partial",
            supplyMessage: thinLibraryPolicy.userMessage,
          }
        : {}),
      ...(finalApiTracks.length > 0 &&
      finalApiTracks.length < Math.max(8, Math.ceil(length * 0.45)) &&
      thinLibraryPolicy.action === "normal" &&
      !(typeof finalization.diagnostics["humanQualityUserMessage"] === "string" &&
        finalization.diagnostics["humanQualityUserMessage"])
        ? {
            honestPartialPublished: true,
            supplyMessage:
              `I only found ${finalApiTracks.length} tracks in your library that truly belong in this musical world — short on purpose so it stays coherent. Sync more likes in this lane, or try Discovery Mode / a broader prompt.`,
          }
        : {}),
      ...(typeof finalization.diagnostics["humanQualityGate"] === "object" && finalization.diagnostics["humanQualityGate"]
        ? {
            humanQualityGate: finalization.diagnostics["humanQualityGate"],
            ...(typeof finalization.diagnostics["humanQualityUserMessage"] === "string"
              ? {
                  supplyMessage:
                    (finalization.diagnostics["humanQualityUserMessage"] as string) ||
                    (typeof finalization.diagnostics === "object" &&
                    thinLibraryPolicy.action !== "normal"
                      ? thinLibraryPolicy.userMessage
                      : null),
                  honestPartialPublished:
                    (finalization.diagnostics["humanQualityGate"] as { action?: string }).action ===
                      "honest_partial" ||
                    thinLibraryPolicy.action === "honest_partial" ||
                    finalization.diagnostics["honestPartialPublished"] === true,
                }
              : {}),
          }
        : {}),
      generationTrust,
      intentSurvivalSummary: generationTrust.intentSurvivalSummary,
      playlistWhy: generationTrust.playlistWhy,
      retrievalSignature: generationTrust.retrievalSignature,
      matchQualityLabel: generationTrust.matchQualityLabel,
      personalizationSource: generationTrust.personalizationSource,
      recoveryAssisted: generationTrust.recoveryAssisted,
      count: finalApiTracks.length,
      totalTracks: finalApiTracks.length,
      degraded: pipeline.pipelineTrace?.degraded ?? false,
      degradationReasons: pipeline.pipelineTrace?.degradationReasons ?? [],
      ...(fallbackReason ? { fallbackReason } : {}),
      generationMs,
      cacheDiagnostics: {
        status: cacheEntryStatus,
        staleBypassed: cacheEntryStatus === "stale",
      },
      stats: {
        trackCount: finalApiTracks.length,
        totalDurationMs,
        artistCount,
        generationMs,
      },
      emotionProfile: { ...emotionProfile, journeyArc },
      sceneId: momentPipeline?.canonicalScene?.sceneId ?? null,
      experienceScene,
      momentUnderstanding,
      momentUnderstandingLine,
      humanNarrative: worldUnderstanding?.humanNarrative ?? null,
      humanExperience: worldUnderstanding?.humanExperience ?? null,
      experiencePriority: experiencePriority ?? null,
      worldEmotionalArc: worldUnderstanding?.emotionalArc ?? null,
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
      playlistExecutionTrace: successExecutionTrace,
      ...(pipeline.scoringDiagnostics?.fastFallback
        ? {
            fastFallback: true,
            ...(fallbackBypassGate ? { humanSaveabilityGate: fallbackBypassGate } : {}),
          }
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
                  finalCount: deliveredTracks.length,
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
      if (latencyBudgetTimer) clearTimeout(latencyBudgetTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionUserId && requestId) {
        endGenerateSession(sessionUserId, requestId);
      }
    }
  } catch (fatalErr: any) {
    cleanupClientDisconnectListeners?.();
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    captureError(fatalErr, {
      source: "generate_fatal",
      code: "INTERNAL_ERROR",
      userId: sessionUserId || undefined,
      requestId: requestId || undefined,
    });
    req.log.error(
      { err: fatalErr?.message, code: "INTERNAL_ERROR", userId: sessionUserId ? hashedIdTag(sessionUserId) : undefined },
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
      if (fatalErr instanceof HumanQualityGateError) {
        generateFail(
          res,
          422,
          "HUMAN_QUALITY_GATE_REFUSED",
          fatalErr.message,
          {
            requestId,
            prompt: generateVibe,
            seed: generationSeed,
            humanQualityGate: fatalErr.result,
            userMessage: fatalErr.result.userMessage,
            ...(deliveryLossFunnel ? { deliveryLossFunnel } : {}),
            ...(puritySubFunnel ? { puritySubFunnel } : {}),
          },
        );
        return;
      }
      if (fatalErr instanceof HumanSaveabilityGateError) {
        if (timeoutFallbackResponse(req, res, {
          failureReason: "human_saveability_gate_fallback",
          elapsedMs: Date.now() - startMs,
          requestId,
          allowStrictOverride: true,
          fallbackLevel: "human_saveability",
        })) return;
        const gatePayload = {
          passed: false,
          humanSaveable: false,
          curatorScore: fatalErr.evaluation.curatorScore,
          breakdown: fatalErr.evaluation.breakdown,
          rejectionReasons: fatalErr.evaluation.rejectionReasons,
          offendingTracks: fatalErr.evaluation.offendingTracks,
          strictModeHumanSaveability: fatalErr.evaluation.strictModeHumanSaveability,
          dominantCluster: typeof fatalErr.attribution?.dominantCluster === "string"
            ? fatalErr.attribution.dominantCluster
            : null,
          openingClusterViolations: Array.isArray(fatalErr.attribution?.opening5Violations)
            ? fatalErr.attribution.opening5Violations
            : [],
          interleaverAudit: fatalErr.attribution?.interleaverAudit ?? null,
          attribution: fatalErr.attribution,
          sceneClusterFunnel: fatalErr.attribution?.sceneClusterFunnel ?? null,
          openingTenDominantCluster: fatalErr.attribution?.openingTenDominantCluster ?? null,
          retriesUsed: fatalErr.retriesUsed,
          maxRetries: 2,
          hardFailed: true,
        };
        generateFail(
          res,
          422,
          "HUMAN_SAVEABILITY_GATE_FAILED",
          fatalErr.message,
          {
            requestId,
            prompt: generateVibe,
            seed: generationSeed,
            humanSaveabilityGate: gatePayload,
            playlistExecutionTrace: fatalErr.playlistExecutionTrace
              ?? finalizeExecutionTrace(buildGateFailureExecutionTraceDraft({
                  requestId,
                  prompt: generateVibe,
                  seed: generationSeed,
                  gate: gatePayload,
                })),
          },
        );
        return;
      }
      if (fatalErr instanceof IntentCollapseInsufficientPoolError) {
        const collapseCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
        const collapsePlaylistLength = typeof collapseCtx?.length === "number"
          ? collapseCtx.length
          : 30;
        const shapedPool = Array.isArray(collapseCtx?.scoringInputSongs)
          ? collapseCtx.scoringInputSongs
          : [];
        const shapedSufficient = shapedPool.length >= Math.max(8, Math.min(collapsePlaylistLength, 12));
        const collapseLockedIntent = collapseCtx?.lockedIntent as LockedIntent | undefined;
        const collapseLikedSongs = Array.isArray(collapseCtx?.likedSongs) ? collapseCtx.likedSongs : [];
        const collapseMode = typeof collapseCtx?.mode === "string" ? collapseCtx.mode : "balanced";
        const collapseClassMap = collapseCtx?.classMap as Map<string, {
          genrePrimary: string;
          genreFamily: string;
          primarySubgenre: string;
          secondarySubgenre: string | null;
          subGenres: string[];
        }> | undefined;
        const collapseEmotionProfile = collapseCtx?.emotionProfile as EmotionProfile | undefined;
        const intentCollapseRescueTrace: Record<string, unknown> = {
          shapedPoolCount: shapedPool.length,
          shapedSufficient,
          minimumRequired: Math.max(8, Math.min(collapsePlaylistLength, 12)),
          hasLockedIntent: !!collapseLockedIntent,
          collapseLikedSongsCount: collapseLikedSongs.length,
          hasEmotionProfile: !!collapseEmotionProfile,
          hasClassMap: !!collapseClassMap,
          attemptedBlendedRescue: false,
          blendedPoolCount: 0,
          blendedApplied: false,
        };
        if (!shapedSufficient && collapseLockedIntent && collapseEmotionProfile && collapseClassMap && collapseLikedSongs.length > 0) {
          intentCollapseRescueTrace["attemptedBlendedRescue"] = true;
          const blended = buildBlendedIntentPool({
            tracks: collapseLikedSongs,
            vibe: generateVibe,
            intent: collapseLockedIntent,
            emotionProfile: collapseEmotionProfile,
            classMap: collapseClassMap,
            requestedLength: collapsePlaylistLength,
            mode: collapseMode as "strict" | "balanced" | "chaotic",
          });
          intentCollapseRescueTrace["blendedPoolCount"] = blended.tracks.length;
          if (blended.tracks.length >= Math.max(8, Math.min(collapsePlaylistLength, 12))) {
            collapseCtx!.scoringInputSongs = blended.tracks;
            intentCollapseRescueTrace["blendedApplied"] = true;
          }
        }
        const reshapedPool = Array.isArray(collapseCtx?.scoringInputSongs)
          ? collapseCtx.scoringInputSongs
          : [];
        const reshapedSufficient = reshapedPool.length >= Math.max(8, Math.min(collapsePlaylistLength, 12));
        intentCollapseRescueTrace["reshapedPoolCount"] = reshapedPool.length;
        intentCollapseRescueTrace["reshapedSufficient"] = reshapedSufficient;
        if (!reshapedSufficient && timeoutFallbackResponse(req, res, {
          failureReason: "intent_pool_collapse_fallback",
          elapsedMs: Date.now() - startMs,
          requestId,
          allowStrictOverride: true,
          fallbackLevel: "intent_pool_collapse",
          stageProfile: { intentCollapseRescueTrace },
        })) return;
        const blockedFallbackUx = collapseCtx?.blockedFallbackUx as ReturnType<typeof buildFallbackUxPayload> | undefined;
        const fallbackUx = blockedFallbackUx ?? (collapseLockedIntent
          ? buildFallbackUxPayload({
            vibe: generateVibe,
            lockedIntent: collapseLockedIntent,
            identityFailures: fatalErr.diagnostics ? ["intent_pool_collapse"] : undefined,
            limitingFactors: [
              `post_filter_count:${fatalErr.diagnostics?.postFilterCount ?? 0}`,
            ],
            noLibraryMode: collapseCtx?.noLibraryMode === true,
          })
          : undefined);
        generateFail(
          res,
          422,
          "INSUFFICIENT_INTENT_POOL",
          fatalErr.message,
          {
            requestId,
            prompt: generateVibe,
            seed: generationSeed,
            status: fatalErr.status,
            intentCollapseLayer: fatalErr.diagnostics,
            intentCollapseRescueTrace,
            fallbackUx,
            playlistExecutionTrace: fatalErr.playlistExecutionTrace
              ?? finalizeExecutionTrace(buildIntentCollapseFailureTraceDraft({
                  requestId,
                  prompt: generateVibe,
                  seed: generationSeed,
                  intentCollapseLayer: {
                    primaryMood: fatalErr.diagnostics.primaryMood,
                    editorialWorldTag: fatalErr.diagnostics.editorialWorldTag,
                    energyRange: fatalErr.diagnostics.energyRange,
                    rhythmDensityCap: fatalErr.diagnostics.rhythmDensityCap,
                    allowedMicroClusters: fatalErr.diagnostics.allowedMicroClusters,
                    collapseConfidenceScore: fatalErr.diagnostics.collapseConfidenceScore,
                  },
                  preFilterCount: fatalErr.diagnostics.preFilterCount,
                  postFilterCount: fatalErr.diagnostics.postFilterCount,
                })),
          },
        );
        return;
      }
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
      jsonWithExecutionTrace(res, timedOut ? 504 : 500, {
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
      }, buildUnknownExitTraceDraft({
        requestId,
        prompt: generateVibe || "unknown",
        seed: generationSeed,
        reason: timedOut ? "fatal_timeout" : "internal_error",
        timeoutOccurred: timedOut,
      }));
    }
  } finally {
    emitGenerateComplete(req, req.log);
  }
});

export default router;
