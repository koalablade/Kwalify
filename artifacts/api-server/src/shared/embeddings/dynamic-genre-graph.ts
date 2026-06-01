/**
 * User-adaptive genre graph — weights shift with library frequency and session exposure.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";
import { neighborsOf, type GenreNeighbor } from "./genre-similarity-graph";
import { useFrozenDynamicGraph } from "../../core/debug/stability-config";

export interface DynamicGraphEdge {
  from: RootGenre;
  to: RootGenre;
  weight: number;
}

export interface DynamicGenreGraph {
  edges: DynamicGraphEdge[];
  /** Asymmetric lookup: from → to */
  weight: (from: RootGenre, to: RootGenre) => number;
}

export function buildDynamicGenreGraph(opts: {
  userVector: Partial<Record<RootGenre, number>>;
  recentDominantGenres: RootGenre[];
  overusedGenres: RootGenre[];
}): DynamicGenreGraph {
  const edges: DynamicGraphEdge[] = [];
  const weightMap = new Map<string, number>();

  const setWeight = (from: RootGenre, to: RootGenre, w: number) => {
    const key = `${from}>${to}`;
    weightMap.set(key, Math.max(0.05, Math.min(0.98, w)));
    edges.push({ from, to, weight: w });
  };

  const allGenres = new Set<RootGenre>([
    ...Object.keys(opts.userVector),
    ...opts.recentDominantGenres,
  ] as RootGenre[]);

  const frozen = useFrozenDynamicGraph();

  for (const genre of allGenres) {
    const userShare = opts.userVector[genre] ?? 0;
    const isHeavy = userShare >= 0.12;
    const isOverused = opts.overusedGenres.includes(genre);

    for (const base of neighborsOf(genre)) {
      let w = base.weight;

      if (!frozen) {
        if (isHeavy && (base.genre === "pop" || base.genre === "folk")) {
          w *= 1.12;
        }
        if (isHeavy && genre === "country" && base.genre === "folk" && isOverused) {
          w *= 0.72;
        }
        if (isOverused) {
          w *= 0.78;
        }
        const neighborShare = opts.userVector[base.genre] ?? 0;
        if (neighborShare < 0.04) {
          w *= 1.15;
        }
      }

      if (frozen) {
        setWeight(genre, base.genre, base.weight);
        setWeight(base.genre, genre, base.weight);
      } else {
        setWeight(genre, base.genre, w);
        setWeight(
          base.genre,
          genre,
          w * (genre === "country" && base.genre === "folk" ? 0.65 : 0.88)
        );
      }
    }
  }

  return {
    edges,
    weight: (from, to) => weightMap.get(`${from}>${to}`) ?? 0,
  };
}

export function dynamicSimilarityBoost(
  trackGenre: RootGenre,
  targetGenres: RootGenre[],
  graph: DynamicGenreGraph
): number {
  let boost = 0;
  for (const target of targetGenres) {
    if (trackGenre === target) {
      boost += 0.16;
      continue;
    }
    const w = graph.weight(target, trackGenre) || graph.weight(trackGenre, target);
    if (w > 0) boost += w * 0.12;
  }
  return Math.min(0.24, boost);
}
