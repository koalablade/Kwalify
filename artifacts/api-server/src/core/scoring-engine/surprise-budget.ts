/**
 * Surprise budget — allocates score mass to discovery / graph bridges (post-score only).
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { DynamicGenreGraph } from "../../shared/embeddings/dynamic-genre-graph";
import { dynamicSimilarityBoost } from "../../shared/embeddings/dynamic-genre-graph";
import type { GenreForecast } from "../genre-intelligence/genre-forecast";
import type { LibrarySignals } from "../../lib/library-signals";
import { memoryTraceBoost } from "../genre-intelligence/genre-memory-trace";
import type { GenreMemoryTrace } from "../genre-intelligence/genre-memory-trace";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import { scenePoolMultiplier } from "../scene-intelligence/scene-genre-routing";

export interface SurpriseBudgetContext {
  surpriseBudget: number;
  forecast: GenreForecast;
  dynamicGraph: DynamicGenreGraph;
  memoryTrace: GenreMemoryTrace;
  sceneRouting: SceneGenreRouting;
  classifications: Map<string, TrackGenreClassification>;
  librarySignals: LibrarySignals;
  underrepresented: RootGenre[];
}

export interface SurpriseBudgetResult<T> {
  tracks: T[];
  budgetUsed: number;
  allocations: { trackId: string; amount: number; reason: string }[];
}

export function applySurpriseBudget<T extends {
  trackId: string;
  score: number;
  energy?: number | null;
  valence?: number | null;
}>(
  tracks: T[],
  ctx: SurpriseBudgetContext
): SurpriseBudgetResult<T> {
  const allocations: SurpriseBudgetResult<T>["allocations"] = [];
  let budgetUsed = 0;
  const maxPerTrack = ctx.surpriseBudget * 0.35;

  const boosted = tracks.map((t) => {
    const c = ctx.classifications.get(t.trackId);
    const fam = c?.genreFamily ?? "unknown";
    if (fam === "unknown") return t;

    let add = 0;
    let reason = "";

    const sceneMult = scenePoolMultiplier(fam, ctx.sceneRouting);
    if (sceneMult < 0.88) return t;

    if (ctx.underrepresented.includes(fam)) {
      add += ctx.surpriseBudget * 0.22;
      reason = "underused_genre";
    }

    const graphBoost = dynamicSimilarityBoost(fam, ctx.underrepresented, ctx.dynamicGraph);
    if (graphBoost > 0.04) {
      add += Math.min(maxPerTrack, graphBoost * 0.5);
      reason = reason || "graph_bridge";
    }

    const mem = memoryTraceBoost(fam, ctx.memoryTrace);
    if (mem > 0.04) {
      add += Math.min(maxPerTrack, mem * 0.8);
      reason = reason || "memory_rotation";
    }

    const signal = ctx.librarySignals.tracks.get(t.trackId);
    if (signal && signal.playlistAppearances <= 1 && signal.daysSinceSurfaced != null && signal.daysSinceSurfaced > 45) {
      add += ctx.surpriseBudget * 0.12;
      reason = reason || "forgotten_favourite";
    }

    add = Math.min(maxPerTrack, add);
    if (add > 0.002) {
      budgetUsed += add;
      allocations.push({ trackId: t.trackId, amount: add, reason });
      return { ...t, score: t.score + add };
    }
    return t;
  });

  return {
    tracks: boosted.sort((a, b) => b.score - a.score),
    budgetUsed: Math.round(budgetUsed * 1000) / 1000,
    allocations: allocations.slice(0, 20),
  };
}
