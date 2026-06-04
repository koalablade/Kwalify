/**

 * Unified scoring engine — predictive genre balance → hybrid score → post → pool.

 */



export * from "./hybrid-core";

export * from "./types";

export { applyPostScoreModifiers, type PostScoreModifierInput } from "./post-score-modifiers";

export { applySunnyGateIfNeeded, sortByScore, applyGenrePoolBias } from "./pool-bias";



import {

  buildHybridScoringContext,

  scoreLibraryHybrid,

  buildScoringDiagnostics,

  type HybridScoringContext,

} from "./hybrid-core";

import { applyPostScoreModifiers, type PostScoreModifierInput } from "./post-score-modifiers";

import {

  applySunnyGateIfNeeded,

  sortByScore,

  applyGenrePoolBias,

} from "./pool-bias";

import type { EmotionProfile, VibeKind } from "../../lib/emotion";

import type { IntentDecodeResult } from "../../lib/intent-decoder";

import type { CanonicalSceneResult } from "../../lib/scene-canonicalizer";

import type { ScenePrototype } from "../../lib/scene-prototypes";

import type { SonicProfile } from "../../lib/scene-sonic-map";

import type { UserGenreProfile } from "../../lib/user-genre-profile";

import type { GenreIntelligenceStack } from "../../lib/genre-intelligence-stack";

import type { ScoredLibraryTrack } from "./types";

import { buildGenreForecastFromLibrary, type GenreForecast } from "../genre-intelligence/genre-forecast";

import { resolveSceneGenreRouting, buildRoutingFromVector } from "../scene-intelligence/scene-genre-routing";
import {
  mergeGenreRoutings,
  promptHasExplicitGenreConstraint,
  resolveVibeGenreBias,
} from "../../lib/vibe-genre-bias";

import { buildDynamicGenreGraph } from "../../shared/embeddings/dynamic-genre-graph";

import { buildGenreMemoryTrace } from "../genre-intelligence/genre-memory-trace";

import { initPreScoreContext } from "../genre-intelligence/pre-score-bias";

import { dominantGenresFromRecentPlaylists } from "../genre-intelligence/genre-session-decay";

import { SCORING_WEIGHTS, MAX_SCENE_SCORE_INFLUENCE } from "../genre-intelligence/genre-constraints";

import type { GenreCoverageState } from "../genre-intelligence/genre-coverage-engine";
import { resolveSceneContext } from "../../lib/scene-validation";
import { buildTruthAnchorStore } from "../genre-intelligence/genre-truth-anchor";
import { assemblePipelineTraces } from "../debug/trace-assembler";
import {
  buildStabilityDiagnostics,
  type StabilityDiagnostics,
} from "../debug/stability-metrics";
import { FORCE_DETERMINISTIC_MODE } from "../debug/stability-config";
import { resolveContradiction } from "../scene-intelligence/contradiction-handler";
import {
  computeExplorationModeScore,
  surpriseBudgetFromExploration,
  leapProbabilityFromExploration,
} from "./soft-exploration";
import {
  applyEmotionalLeapsToHybridResults,
  tagMagicMomentCandidates,
} from "./emotional-leap-engine";
import { resolveGravityWells } from "../genre-intelligence/gravity-wells";
import { buildTrackPersistenceMemory } from "../memory-rediscovery/track-persistence-memory";
import {
  buildGravityProfiles,
  applyEmotionalMassToScores,
  attachGravityFieldsToTracks,
  buildGravityDiagnostics,
  type TasteGravityContext,
} from "./taste-gravity";
import { applyGravityBiasedSurprise } from "./gravity-surprise";
import { capTracksForHybridScoring } from "./scoring-pool-cap";
import {
  resolveSemanticScene,
  ECOSYSTEM_HARD_GATE_CONFIDENCE,
} from "../../lib/semantic-scene-engine";
import { buildRecentTrackPoolPenalty } from "../../lib/playlist-freshness";
import type { Logger } from "pino";
import { logScoringStage } from "../../lib/generate-stage-timer";



export interface RunScoringPipelineOpts<T extends {

  trackId: string;

  artistName: string;

  albumName: string;

  energy: number | null;

  valence: number | null;

  tempo: number | null;

  danceability: number | null;

  acousticness: number | null;

}> {

  tracks: T[];

  vibe: string;

  mode: "strict" | "balanced" | "chaotic";

  emotionProfile: EmotionProfile;

  vibeKind: VibeKind;

  intent: IntentDecodeResult;

  canonical: CanonicalSceneResult | null;

  prototype: ScenePrototype | null;

  sonicProfile: SonicProfile | null;

  userGenreProfile: UserGenreProfile;

  genreStack: GenreIntelligenceStack;

  playlistLength: number;

  memoryByTrack: (trackId: string) => number;

  noveltyByTrack: (trackId: string) => number;

  recentPlaylistTrackIds?: string[][];

  varietyPenaltyScale?: number;

  referencePlaylist?: boolean;

  postScore: Omit<PostScoreModifierInput<T>, "hybridResults" | "mode">;

  /** Request logger — stage timing for production stall diagnosis */
  pipelineLog?: Logger;

  /**
   * No-library mode: zero out library affinity weight; redistribute to semantic.
   * Passed through to HybridScoringContext and combineTriScore.
   */
  noLibraryMode?: boolean;

}



export interface ScoringPipelineResult<T extends { trackId: string }> {

  scored: ScoredLibraryTrack<T>[];

  sorted: ScoredLibraryTrack<T>[];

  hybridCtx: HybridScoringContext;

  scoringDiagnostics: Record<string, unknown>;

  hybridExcludedCount: number;

  coverageState: GenreCoverageState;

  genreForecast: GenreForecast;

  sceneInfluenceRatio: number;

  stabilityDiagnostics: StabilityDiagnostics;

  trackDecisionTracesSample: import("../debug/decision-trace").TrackDecisionTrace[];

}



export function runScoringPipeline<T extends {

  trackId: string;

  trackName: string;

  artistName: string;

  albumName: string;

  energy: number | null;

  valence: number | null;

  tempo: number | null;

  danceability: number | null;

  acousticness: number | null;

  instrumentalness?: number | null;

  speechiness?: number | null;

} & { trackId: string }>(opts: RunScoringPipelineOpts<T>): ScoringPipelineResult<T> {

  const log = opts.pipelineLog;
  const isProd = process.env.NODE_ENV === "production";
  const classifications = opts.userGenreProfile.trackClassifications;
  const classMap = opts.userGenreProfile.trackClassifications;

  let t = Date.now();
  log?.info({ librarySize: opts.tracks.length }, "Scoring: capping candidate pool");

  // Resolve semantic scene early so Phase 3 pre-filter can use it
  const earlySemanticResolution = resolveSemanticScene(opts.vibe, opts.emotionProfile);

  const poolCap = capTracksForHybridScoring(opts.tracks, {
    emotionProfile: opts.emotionProfile,
    vibeKind: opts.vibeKind,
    classifications: classMap,
    librarySize: opts.tracks.length,
    referencePlaylist: opts.referencePlaylist,
    seedMs: opts.postScore.startMs,
    vibe: opts.vibe,
    promptWordCount: opts.vibe.trim().split(/\s+/).length,
    recentTrackPenalty: opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(
          opts.recentPlaylistTrackIds,
          5,
          opts.varietyPenaltyScale ?? 1
        )
      : undefined,
    ecosystemPreFilter: earlySemanticResolution.vector
      ? { vector: earlySemanticResolution.vector, sceneConfidence: earlySemanticResolution.confidence }
      : undefined,
  });

  logScoringStage(log, "Candidate pool capped", t, {
    librarySize: poolCap.originalCount,
    hybridPoolSize: poolCap.pool.length,
    poolCapped: poolCap.poolCapped,
    candidateCount: poolCap.candidateCount,
    preFilterRejected: poolCap.preFilterRejectedCount,
    adjacencyLevelUsed: poolCap.adjacencyLevelUsed,
  });

  t = Date.now();
  const truthAnchors = buildTruthAnchorStore(
    classifications,
    poolCap.pool.map((t) => t.trackId)
  );
  logScoringStage(log, "Truth anchors built", t, { anchorCount: truthAnchors.anchors.size });

  t = Date.now();
  const sceneCtx = resolveSceneContext(opts.vibe, opts.canonical, opts.emotionProfile, null);
  const sceneRoutingBase = resolveSceneGenreRouting({
    vibe: opts.vibe,
    vibeKind: opts.vibeKind,
    sceneFamily: sceneCtx.primary,
  });
  // When a semantic scene resolves with sufficient confidence, merge its
  // ecosystem-weight-derived routing on top of the regex-based routing.
  // This ensures the scoring engine's pool multipliers reflect the exact
  // scene ecosystem rather than generic keyword heuristics alone.
  const vectorRouting = earlySemanticResolution.vector && earlySemanticResolution.confidence >= 0.55
    ? buildRoutingFromVector(earlySemanticResolution.vector)
    : null;
  const sceneRoutingWithVector = vectorRouting
    ? mergeGenreRoutings(sceneRoutingBase, vectorRouting)
    : sceneRoutingBase;
  const vibeBias = promptHasExplicitGenreConstraint(opts.vibe)
    ? null
    : resolveVibeGenreBias({ vibe: opts.vibe, profile: opts.emotionProfile });
  const sceneRouting = vibeBias
    ? mergeGenreRoutings(sceneRoutingWithVector, vibeBias)
    : sceneRoutingWithVector;
  logScoringStage(log, "Scene routing resolved", t, {
    vibeBiasApplied: !!vibeBias,
  });

  t = Date.now();
  const genreForecast = buildGenreForecastFromLibrary({
    classifications,
    userVector: opts.userGenreProfile.vector,
    playlistLength: opts.playlistLength,
    sceneRouting,
  });
  logScoringStage(log, "Genre forecast complete", t);

  t = Date.now();
  const recentDominant = opts.recentPlaylistTrackIds?.length
    ? dominantGenresFromRecentPlaylists(opts.recentPlaylistTrackIds, classifications)
    : [];
  logScoringStage(log, "Recent dominant genres resolved", t, { count: recentDominant.length });

  t = Date.now();
  const dynamicGraph = buildDynamicGenreGraph({
    userVector: opts.userGenreProfile.vector,
    recentDominantGenres: recentDominant,
    overusedGenres: genreForecast.poolSkewGenres,
  });
  logScoringStage(log, "Dynamic genre graph built", t, { edges: dynamicGraph.edges.length });

  t = Date.now();
  const memoryTrace = buildGenreMemoryTrace({
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds ?? [],
    classifications,
    suppressedGenres: genreForecast.poolSkewGenres,
  });
  logScoringStage(log, "Genre memory trace built", t);



  const contradiction = resolveContradiction(opts.vibe, opts.emotionProfile);

  const explorationModeScore = computeExplorationModeScore({
    vibe: opts.vibe,
    emotionProfile: opts.emotionProfile,
    userVector: opts.userGenreProfile.vector,
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,
    trackClassifications: classifications,
    mode: opts.mode,
  });

  const surpriseBudget = surpriseBudgetFromExploration(explorationModeScore);
  const leapProbability = leapProbabilityFromExploration(explorationModeScore);

  const forecastDampen = 1 - explorationModeScore * 0.12;
  const forecastForPreScore =
    explorationModeScore > 0.35
      ? {
          ...genreForecast,
          preScoreAdjustments: genreForecast.preScoreAdjustments.map((adj) => ({
            ...adj,
            boost: adj.boost * forecastDampen,
          })),
        }
      : genreForecast;

  t = Date.now();
  const preScore = initPreScoreContext({
    forecast: forecastForPreScore,
    sceneRouting,
    dynamicGraph,
    memoryTrace,
  });
  logScoringStage(log, "Pre-score context ready", t);

  t = Date.now();
  const hybridCtx = buildHybridScoringContext({
    vibe: opts.vibe,
    profile: opts.emotionProfile,
    intent: opts.intent,
    canonical: opts.canonical,
    prototype: opts.prototype,
    sonicProfile: opts.sonicProfile,
    vibeKind: opts.vibeKind,
    userGenre: opts.userGenreProfile,
    preScore,
    truthAnchors,
    noLibraryMode: opts.noLibraryMode,
    cachedSemanticResolution: earlySemanticResolution,
  });
  logScoringStage(log, "Hybrid scoring context built", t);

  t = Date.now();
  log?.info({ hybridPoolSize: poolCap.pool.length }, "Scoring: hybrid tri-score");
  const { results: hybridResults, excluded: hybridExcluded } = scoreLibraryHybrid(
    poolCap.pool,
    hybridCtx,
    opts.mode,
    opts.memoryByTrack,
    opts.noveltyByTrack
  );
  logScoringStage(log, "Hybrid scoring complete", t, {
    scored: hybridResults.length,
    excluded: hybridExcluded.length,
  });

  // ── Ecosystem gate debug validation ───────────────────────────────────────
  const gateActive = !!(
    earlySemanticResolution.vector &&
    earlySemanticResolution.confidence >= ECOSYSTEM_HARD_GATE_CONFIDENCE
  );
  const gateRejected = hybridExcluded.filter((e) =>
    e.excludedBy?.startsWith("ecosystem_hard_gate:")
  );
  const gateRejectedByGenre: Record<string, number> = {};
  for (const e of gateRejected) {
    const g = e.excludedBy?.split(":")[1] ?? "unknown";
    gateRejectedByGenre[g] = (gateRejectedByGenre[g] ?? 0) + 1;
  }
  const finalCandidateGenres: Record<string, number> = {};
  for (const r of hybridResults) {
    const g = r.debug.genrePrimary;
    finalCandidateGenres[g] = (finalCandidateGenres[g] ?? 0) + 1;
  }
  log?.info(
    {
      "GENRE FILTER APPLIED BEFORE SCORING": gateActive ? "YES" : "NO",
      "REJECTED TRACKS BY GENRE": gateRejectedByGenre,
      "FINAL CANDIDATE GENRES": finalCandidateGenres,
    },
    "Ecosystem hard gate result"
  );

  const scoreBeforePost = new Map(
    hybridResults.map((r) => [r.track.trackId, r.score])
  );

  t = Date.now();
  const { results: leapedHybrid, leaps: emotionalLeaps } = applyEmotionalLeapsToHybridResults(
    hybridResults,
    {
      vibe: opts.vibe,
      emotionProfile: opts.emotionProfile,
      canonical: opts.canonical,
      sceneRouting,
      truthAnchors,
      classifications: classMap,
      contradiction,
      leapProbability,
      playlistLength: opts.playlistLength,
      seed: opts.postScore.startMs,
    }
  );
  logScoringStage(log, "Emotional leaps applied", t, { leaps: emotionalLeaps.length });

  t = Date.now();
  const scored = applyPostScoreModifiers({
    ...opts.postScore,
    hybridResults: leapedHybrid,
    mode: opts.mode,
  });
  logScoringStage(log, "Post-score modifiers applied", t, { tracks: scored.length });

  const gravityWells = resolveGravityWells({
    vibe: opts.vibe,
    sceneFamily: sceneCtx.primary,
    sceneRouting,
    emotionProfile: opts.emotionProfile,
  });

  const persistence = buildTrackPersistenceMemory({
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds ?? [],
    classifications,
  });

  const gravityCtx: TasteGravityContext = {
    emotionProfile: opts.emotionProfile,
    sceneCtx,
    userVector: opts.userGenreProfile.vector,
    librarySignals: opts.postScore.librarySignals,
    memoryTrace,
    classifications: classMap,
    gravityWells,
    persistence,
    memoryByTrack: opts.memoryByTrack,
    noveltyByTrack: opts.noveltyByTrack,
    dominantGenres: genreForecast.predictedDominantGenres,
  };

  t = Date.now();
  const gravityProfiles = buildGravityProfiles(scored, gravityCtx);
  const massBoosted = applyEmotionalMassToScores(scored, gravityProfiles);
  logScoringStage(log, "Taste gravity applied", t, { profiles: gravityProfiles.size });

  t = Date.now();
  const surpriseResult = applyGravityBiasedSurprise(massBoosted, {
    surpriseBudget,
    sceneRouting,
    profiles: gravityProfiles,
    classifications: classMap,
  });
  logScoringStage(log, "Gravity surprise applied", t);

  const gravityEnriched = attachGravityFieldsToTracks(
    surpriseResult.tracks,
    gravityProfiles
  );

  const gated = applySunnyGateIfNeeded(gravityEnriched, opts.vibeKind, opts.playlistLength);

  t = Date.now();
  const { pool: biased, coverageState } = applyGenrePoolBias(gated, {

    userGenreProfile: opts.userGenreProfile,

    emotionProfile: opts.emotionProfile,

    vibe: opts.vibe,

    playlistLength: opts.playlistLength,

    genreStack: opts.genreStack,

    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,

    genreForecast,

    sceneRouting,

    dynamicGraph,

    memoryTrace,

  });
  logScoringStage(log, "Genre coverage engine applied", t, {
    poolSize: biased.length,
    diversityScore: coverageState.diversityScore,
  });

  const rawSorted = sortByScore(biased);

  // Post-score invariant filter DISABLED — genre diversity must be preserved.
  // Scene shapes output via scoring weights; hard post-score removal destroys
  // cross-genre adjacency and produces single-genre collapse.
  // Tracks are ranked by score; the genre diversity enforcer handles balance.
  const postScoreFilteredCount = 0;
  const sorted = rawSorted;

  const gravityDiagnostics = buildGravityDiagnostics(
    gravityProfiles,
    surpriseResult.splitUsed,
    gravityWells,
    sorted.slice(0, opts.playlistLength * 2).map((t) => t.trackId)
  );

  const sceneInfluenceRatio = SCORING_WEIGHTS.scene;

  const finalTopIds = sorted.slice(0, opts.playlistLength).map((t) => t.trackId);
  const traceInput = {
    hybridResults,
    hybridExcluded,
    finalSorted: sorted,
    classifications: classMap,
    preScore,
    truthAnchors,
    sceneRouting,
    genreForecast,
    scoreBeforePost,
    traceSampleSize: Math.min(40, opts.playlistLength + 15),
  };
  const { traces, conflictReports, truthAnchorDriftScore } = isProd
    ? { traces: [], conflictReports: [], truthAnchorDriftScore: 0 }
    : assemblePipelineTraces(traceInput);

  const magicSample = sorted.slice(0, isProd ? 50 : sorted.length);
  const magicMoments = tagMagicMomentCandidates(magicSample, {
    sceneCtx,
    emotionProfile: opts.emotionProfile,
    librarySignals: opts.postScore.librarySignals,
    leapTrackIds: new Set(emotionalLeaps.map((l) => l.trackId)),
    classifications: classMap,
  });

  const stabilityDiagnostics: StabilityDiagnostics = isProd
    ? {
        playlistStabilityScore: 1,
        conflictReports: [],
        layerContributionSummary: {},
        truthAnchorDriftScore: 0,
        layerDominanceWarnings: 0,
        deterministicMode: FORCE_DETERMINISTIC_MODE,
      }
    : buildStabilityDiagnostics({
        traces,
        finalTrackIds: finalTopIds,
        classifications: classMap,
        conflictReports,
        truthAnchorDriftScore,
        sceneInfluenceRatio,
        deterministicMode: FORCE_DETERMINISTIC_MODE,
      });

  return {
    scored,
    sorted,
    hybridCtx,
    scoringDiagnostics: {
      ...buildScoringDiagnostics(hybridResults, hybridExcluded, hybridCtx, 15),
      genreForecast: {
        predictedDominantGenres: genreForecast.predictedDominantGenres,
        riskOfCollapse: genreForecast.riskOfCollapse,
        collapseRiskScore: genreForecast.collapseRiskScore,
        requiredBoostGenres: genreForecast.requiredBoostGenres,
      },
      predictedDistribution: genreForecast.predictedDistribution,
      coverageMap: coverageState.coverageMap,
      diversityScore: coverageState.diversityScore,
      collapseRiskScore: coverageState.collapseRiskScore,
      ecosystemBalance: coverageState.ecosystemBalance,
      sceneInfluenceRatio,
      sceneInfluenceCap: MAX_SCENE_SCORE_INFLUENCE,
      preScoreAdjustments: genreForecast.preScoreAdjustments,
      sceneRouting: {
        boosted: sceneRouting.boostedGenres,
        suppressed: sceneRouting.suppressedGenres,
      },
      stability: stabilityDiagnostics,
      trackTraceSample: traces.slice(0, 8),
      controlledChaos: {
        explorationModeScore,
        surpriseBudget,
        surpriseBudgetUsed: surpriseResult.budgetUsed,
        surpriseAllocations: surpriseResult.allocations.slice(0, 8),
        surpriseGravitySplit: surpriseResult.splitUsed,
        emotionalLeaps,
        contradiction: contradiction.active
          ? { label: contradiction.label, poolDiversityBoost: contradiction.poolDiversityBoost }
          : null,
        magicMomentCandidates: magicMoments
          .filter((m) => m.magicMomentCandidate)
          .slice(0, 12)
          .map((m) => ({
            trackId: m.trackId,
            resonance: m.resonance,
            magicMomentCandidate: true,
          })),
      },
      gravityDiagnostics,
      scoringPool: {
        librarySize: poolCap.originalCount,
        hybridPoolSize: poolCap.pool.length,
        poolCapped: poolCap.poolCapped,
        candidateCount: poolCap.candidateCount,
        preFilterRejected: poolCap.preFilterRejectedCount,
        adjacencyLevelUsed: poolCap.adjacencyLevelUsed,
        postScoreFiltered: postScoreFilteredCount,
        forbiddenRejectionCount: gateRejected.length,
      },
    },
    hybridExcludedCount: hybridExcluded.length,
    coverageState,
    genreForecast,
    sceneInfluenceRatio,
    stabilityDiagnostics,
    trackDecisionTracesSample: traces.slice(0, 15),
  };
}


