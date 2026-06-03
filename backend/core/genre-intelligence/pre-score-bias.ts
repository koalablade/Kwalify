/**
 * Pre-scoring adjustments — applied before hybrid tri-score runs.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { GenreForecast } from "./genre-forecast";
import { preScoreBoostForTrack as forecastBoost } from "./genre-forecast";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import { scenePoolMultiplier } from "../scene-intelligence/scene-genre-routing";
import type { DynamicGenreGraph } from "../../shared/embeddings/dynamic-genre-graph";
import { dynamicSimilarityBoost } from "../../shared/embeddings/dynamic-genre-graph";
import type { GenreMemoryTrace } from "./genre-memory-trace";
import { memoryTraceBoost } from "./genre-memory-trace";
import { dominancePenaltyMultiplier } from "./soft-penalty";

export interface PreScoreContext {
  forecast: GenreForecast;
  sceneRouting: SceneGenreRouting;
  dynamicGraph: DynamicGenreGraph;
  memoryTrace: GenreMemoryTrace;
  /** Running pool genre counts for soft penalty simulation */
  poolGenreShares: Partial<Record<RootGenre, number>>;
}

export function initPreScoreContext(opts: {
  forecast: GenreForecast;
  sceneRouting: SceneGenreRouting;
  dynamicGraph: DynamicGenreGraph;
  memoryTrace: GenreMemoryTrace;
}): PreScoreContext {
  return {
    forecast: opts.forecast,
    sceneRouting: opts.sceneRouting,
    dynamicGraph: opts.dynamicGraph,
    memoryTrace: opts.memoryTrace,
    poolGenreShares: { ...opts.forecast.predictedDistribution },
  };
}

export interface PreScoreBiasBreakdown {
  forecastComponent: number;
  graphComponent: number;
  memoryComponent: number;
  sceneRoutingMultiplier: number;
  softPenaltyComponent: number;
  total: number;
}

export function computePreScoreBiasBreakdown(
  classification: TrackGenreClassification,
  ctx: PreScoreContext
): PreScoreBiasBreakdown {
  const fam = classification.genreFamily;
  if (fam === "unknown") {
    return {
      forecastComponent: 0,
      graphComponent: 0,
      memoryComponent: -0.08,
      sceneRoutingMultiplier: 1,
      softPenaltyComponent: 0,
      total: -0.08,
    };
  }

  const forecastComponent = forecastBoost(fam, ctx.forecast);
  const graphComponent = dynamicSimilarityBoost(
    fam,
    ctx.forecast.requiredBoostGenres,
    ctx.dynamicGraph
  );
  const memoryComponent = memoryTraceBoost(fam, ctx.memoryTrace);
  const sceneRoutingMultiplier = scenePoolMultiplier(fam, ctx.sceneRouting);

  let subtotal = forecastComponent + graphComponent + memoryComponent;
  subtotal *= sceneRoutingMultiplier;

  const share = ctx.poolGenreShares[fam] ?? 0;
  const softMult = dominancePenaltyMultiplier(share);
  const softPenaltyComponent = (softMult - 1) * 0.15;

  const total = Math.max(-0.12, Math.min(0.28, subtotal + softPenaltyComponent));

  return {
    forecastComponent,
    graphComponent,
    memoryComponent,
    sceneRoutingMultiplier,
    softPenaltyComponent,
    total,
  };
}

export function computePreScoreBias(
  classification: TrackGenreClassification,
  ctx: PreScoreContext
): number {
  return computePreScoreBiasBreakdown(classification, ctx).total;
}
