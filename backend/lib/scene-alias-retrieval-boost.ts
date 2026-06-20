/**

 * Scene retrieval boosts — manifold weights and semantic constraints only (no genre alias injection).

 */



import type { SceneModifier } from "./scene-modifier";

import {
  filterScenePredictionThroughManifold,
  genreSupportCheck,
  type UserTasteManifold,
} from "./user-taste-manifold";

import { scoreMusicSemanticCompatibility } from "./music-semantic-retrieval";

import type { MusicSemanticProfile } from "./music-semantic-types";



export type SceneAliasBoostTrack = {

  genreFamily?: string | null;

  genrePrimary?: string | null;

  genres?: string[] | null;

};



function normalizeGenre(value: string): string {

  return value.toLowerCase().replace(/&/g, "and").replace(/[\s-]+/g, "_");

}



function trackGenreFamilies(track: SceneAliasBoostTrack): string[] {

  const families = new Set<string>();

  if (track.genreFamily) families.add(normalizeGenre(track.genreFamily));

  if (track.genrePrimary) families.add(normalizeGenre(track.genrePrimary));

  if (Array.isArray(track.genres)) {

    for (const genre of track.genres) {

      if (typeof genre === "string" && genre.trim()) families.add(normalizeGenre(genre));

    }

  }

  return [...families];

}



export function computeSceneModifierRetrievalBoost(

  track: SceneAliasBoostTrack,

  modifier: SceneModifier,

  opts?: { tasteManifold?: UserTasteManifold | null; musicSemantic?: MusicSemanticProfile | null },

): number {

  const manifold = opts?.tasteManifold ?? null;

  const families = trackGenreFamilies(track);

  if (families.length === 0) return 0;



  if (families.some((family) => modifier.filters.some((f) => normalizeGenre(f) === family))) {

    return 0;

  }



  if (manifold && families.every((family) => !genreSupportCheck(manifold, family))) {
    return 0;
  }

  const weights = filterScenePredictionThroughManifold(modifier.weights, manifold);
  let boost = 0;
  for (const [genre, weight] of Object.entries(weights)) {
    const normalized = normalizeGenre(genre);
    if (families.some((family) => family === normalized || family.includes(normalized) || normalized.includes(family))) {
      boost += weight * modifier.boosts.manifold;
    }
  }

  if (opts?.musicSemantic && boost > 0) {
    boost += scoreMusicSemanticCompatibility(modifier.constraints, opts.musicSemantic).boost * modifier.boosts.semantic;
  }

  if (boost === 0) return 0;
  return Math.min(0.28, Math.round(boost * 1000) / 1000);
}



/** @deprecated Use computeSceneModifierRetrievalBoost — scene aliases no longer carry genres. */

export function computeSceneAliasRetrievalBoost(

  track: SceneAliasBoostTrack,

  sceneAliases: string[],

  scenePrediction: Record<string, number>,

  opts?: { tasteManifold?: UserTasteManifold | null; sceneModifier?: SceneModifier | null },

): number {

  if (opts?.sceneModifier) {

    return computeSceneModifierRetrievalBoost(track, opts.sceneModifier, { tasteManifold: opts.tasteManifold });

  }



  const manifold = opts?.tasteManifold ?? null;

  const prediction = filterScenePredictionThroughManifold(scenePrediction, manifold);

  if (Object.keys(prediction).length === 0 || sceneAliases.length === 0) return 0;



  const families = trackGenreFamilies(track);

  if (families.length === 0) return 0;



  let boost = 0;

  for (const [genre, weight] of Object.entries(prediction)) {

    const normalized = normalizeGenre(genre);

    if (families.some((family) => family === normalized || family.includes(normalized) || normalized.includes(family))) {

      boost += weight * 0.22;

    }

  }

  return Math.min(0.28, Math.round(boost * 1000) / 1000);

}


