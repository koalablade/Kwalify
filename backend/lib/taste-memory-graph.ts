/**
 * Taste memory graph v1 (Q6) — genre/artist/scene affinity from feedback + library.
 */

import type { FeedbackMemory } from "./feedback-memory";
import type { SceneAliasBoostTrack } from "./scene-alias-retrieval-boost";

export type TasteMemoryGraph = {
  genreAffinity: Record<string, number>;
  artistAffinity: Record<string, number>;
  sceneAffinity: Record<string, number>;
  promptSceneKeys: string[];
};

export function buildTasteMemoryGraph(opts: {
  feedbackMemory?: FeedbackMemory | null;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  likedGenreFamilies?: string[];
}): TasteMemoryGraph {
  const genreAffinity: Record<string, number> = {};
  const artistAffinity: Record<string, number> = {};
  const sceneAffinity: Record<string, number> = {};

  const feedback = opts.feedbackMemory;
  if (feedback) {
    for (const [artist, node] of Object.entries(feedback.artistAffinityGraph)) {
      artistAffinity[artist] = Math.max(artistAffinity[artist] ?? 0, node.score);
    }
    for (const embedding of feedback.sceneEmbeddings) {
      if (embedding.genreCluster) {
        genreAffinity[embedding.genreCluster] = (genreAffinity[embedding.genreCluster] ?? 0) + 0.35;
      }
      if (embedding.moodCluster) {
        sceneAffinity[embedding.moodCluster] = (sceneAffinity[embedding.moodCluster] ?? 0) + 0.25;
      }
    }
    for (const genre of feedback.badGenres) {
      genreAffinity[genre] = Math.min(genreAffinity[genre] ?? 0, -1.5);
    }
  }

  for (const family of opts.likedGenreFamilies ?? []) {
    genreAffinity[family] = (genreAffinity[family] ?? 0) + 0.12;
  }

  for (const alias of opts.sceneAliases ?? []) {
    sceneAffinity[alias] = (sceneAffinity[alias] ?? 0) + (opts.scenePrediction?.[alias] ?? 0.2);
  }

  return {
    genreAffinity,
    artistAffinity,
    sceneAffinity,
    promptSceneKeys: opts.sceneAliases ?? [],
  };
}

export function tasteGraphRetrievalBoost(
  track: SceneAliasBoostTrack & { artistName?: string | null },
  graph: TasteMemoryGraph,
): number {
  let boost = 0;
  const families = [
    track.genreFamily,
    track.genrePrimary,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter((value): value is string => typeof value === "string");

  for (const family of families) {
    const normalized = family.toLowerCase().replace(/[\s-]+/g, "_");
    const affinity = graph.genreAffinity[normalized] ?? graph.sceneAffinity[normalized];
    if (typeof affinity === "number" && affinity > 0) {
      boost += Math.min(0.18, affinity * 0.04);
    }
    if (typeof affinity === "number" && affinity < 0) {
      boost += Math.max(-0.25, affinity * 0.08);
    }
  }

  if (track.artistName) {
    const artistScore = graph.artistAffinity[track.artistName] ?? 0;
    if (artistScore > 0) boost += Math.min(0.12, artistScore * 0.02);
    if (artistScore < 0) boost += Math.max(-0.2, artistScore * 0.04);
  }

  return Math.round(boost * 1000) / 1000;
}
