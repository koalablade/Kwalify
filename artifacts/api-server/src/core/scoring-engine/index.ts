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

import { resolveSceneGenreRouting } from "../scene-intelligence/scene-genre-routing";

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
import { buildRecentTrackPoolPenalty } from "../../lib/playlist-freshness";



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

  const classifications = opts.userGenreProfile.trackClassifications;
  const classMap = opts.userGenreProfile.trackClassifications;

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
  });

  const truthAnchors = buildTruthAnchorStore(
    classifications,
    poolCap.pool.map((t) => t.trackId)
  );

  const sceneCtx = resolveSceneContext(opts.vibe, opts.canonical, opts.emotionProfile, null);
  const sceneRouting = resolveSceneGenreRouting({
    vibe: opts.vibe,
    vibeKind: opts.vibeKind,
    sceneFamily: sceneCtx.primary,
  });



  const genreForecast = buildGenreForecastFromLibrary({

    classifications,

    userVector: opts.userGenreProfile.vector,

    playlistLength: opts.playlistLength,

    sceneRouting,

  });



  const recentDominant = opts.recentPlaylistTrackIds?.length

    ? dominantGenresFromRecentPlaylists(opts.recentPlaylistTrackIds, classifications)

    : [];



  const dynamicGraph = buildDynamicGenreGraph({

    userVector: opts.userGenreProfile.vector,

    recentDominantGenres: recentDominant,

    overusedGenres: genreForecast.poolSkewGenres,

  });



  const memoryTrace = buildGenreMemoryTrace({

    recentPlaylistTrackIds: opts.recentPlaylistTrackIds ?? [],

    classifications,

    suppressedGenres: genreForecast.poolSkewGenres,

  });



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

  const preScore = initPreScoreContext({

    forecast: forecastForPreScore,

    sceneRouting,

    dynamicGraph,

    memoryTrace,

  });



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
  });

  const { results: hybridResults, excluded: hybridExcluded } = scoreLibraryHybrid(
    poolCap.pool,
    hybridCtx,
    opts.mode,
    opts.memoryByTrack,
    opts.noveltyByTrack
  );

  const scoreBeforePost = new Map(
    hybridResults.map((r) => [r.track.trackId, r.score])
  );

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

  const scored = applyPostScoreModifiers({
    ...opts.postScore,
    hybridResults: leapedHybrid,
    mode: opts.mode,
  });

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

  const gravityProfiles = buildGravityProfiles(scored, gravityCtx);
  const massBoosted = applyEmotionalMassToScores(scored, gravityProfiles);

  const surpriseResult = applyGravityBiasedSurprise(massBoosted, {
    surpriseBudget,
    sceneRouting,
    profiles: gravityProfiles,
    classifications: classMap,
  });

  const gravityEnriched = attachGravityFieldsToTracks(
    surpriseResult.tracks,
    gravityProfiles
  );

  const gated = applySunnyGateIfNeeded(gravityEnriched, opts.vibeKind, opts.playlistLength);

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

  const sorted = sortByScore(biased);

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
  const { traces, conflictReports, truthAnchorDriftScore } =
    process.env.NODE_ENV === "production"
      ? { traces: [], conflictReports: [], truthAnchorDriftScore: 0 }
      : assemblePipelineTraces(traceInput);

  const magicMoments = tagMagicMomentCandidates(sorted, {
    sceneCtx,
    emotionProfile: opts.emotionProfile,
    librarySignals: opts.postScore.librarySignals,
    leapTrackIds: new Set(emotionalLeaps.map((l) => l.trackId)),
    classifications: classMap,
  });

  const stabilityDiagnostics = buildStabilityDiagnostics({
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


