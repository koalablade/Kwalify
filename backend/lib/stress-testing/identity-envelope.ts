/**
 * Identity envelope — measure pre/post scene drift and enforce taste boundaries.
 */

import type { IdentityDriftMetrics } from "./types";
import type { ManifoldTrackInput, UserTasteManifold } from "../user-taste-manifold";
import { genreSupportCheck } from "../user-taste-manifold";

export type TasteBaseline = {
  dominantGenres: string[];
  genreWeights: Record<string, number>;
  sonicCentroid: UserTasteManifold["sonicCentroid"];
  textureCentroid: UserTasteManifold["textureCentroid"];
};

export type PostSceneState = {
  projectedGenreWeights: Record<string, number>;
  anchoredAliases: string[];
  mergedGenres: string[];
};

const IDENTITY_THRESHOLDS = {
  maxGenreDelta: 0.42,
  maxTasteCentroidDrift: 0.38,
  maxEmotionalDrift: 0.35,
  maxTextureDrift: 0.45,
};

function l1CentroidDrift(
  a: Record<string, number>,
  b: Record<string, number>,
  keys: string[],
): number {
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    if (a[key] == null && b[key] == null) continue;
    sum += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function dominantFromWeights(weights: Record<string, number>, limit = 3): string[] {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}

function genreDeltaInLibrary(
  pre: Record<string, number>,
  post: Record<string, number>,
  libraryFamilies: string[],
): number {
  if (libraryFamilies.length === 0) return 0;
  const normalize = (weights: Record<string, number>): Record<string, number> => {
    let sum = 0;
    const out: Record<string, number> = {};
    for (const family of libraryFamilies) {
      out[family] = weights[family] ?? 0;
      sum += out[family];
    }
    if (sum <= 0) return out;
    for (const family of libraryFamilies) out[family] = out[family] / sum;
    return out;
  };
  const preNorm = normalize(pre);
  const postNorm = normalize(post);
  let delta = 0;
  for (const family of libraryFamilies) {
    delta += Math.abs(preNorm[family] - postNorm[family]);
  }
  return delta / libraryFamilies.length;
}

export function buildTasteBaseline(manifold: UserTasteManifold | null): TasteBaseline | null {
  if (!manifold || manifold.librarySize === 0) return null;
  return {
    dominantGenres: manifold.dominantClusters.map((c) => c.genreFamily),
    genreWeights: { ...manifold.genreSupport },
    sonicCentroid: { ...manifold.sonicCentroid },
    textureCentroid: { ...manifold.textureCentroid },
  };
}

export function buildPostSceneGenreWeights(
  baseline: TasteBaseline | null,
  post: PostSceneState,
): Record<string, number> {
  const weights = { ...(baseline?.genreWeights ?? {}) };
  const supported = new Set(Object.keys(baseline?.genreWeights ?? {}));
  for (const [genre, w] of Object.entries(post.projectedGenreWeights)) {
    if (supported.size > 0 && !supported.has(genre)) continue;
    weights[genre] = Math.round(((weights[genre] ?? 0) + w) * 1000) / 1000;
  }
  for (const alias of post.anchoredAliases) {
    if (supported.size > 0 && !supported.has(alias)) continue;
    weights[alias] = Math.round(((weights[alias] ?? 0) + 0.08) * 1000) / 1000;
  }
  for (const merged of post.mergedGenres) {
    if (supported.size > 0 && !supported.has(merged)) continue;
    weights[merged] = Math.round(((weights[merged] ?? 0) + 0.12) * 1000) / 1000;
  }
  return weights;
}

export function measureIdentityDrift(
  manifold: UserTasteManifold | null,
  baseline: TasteBaseline | null,
  post: PostSceneState,
  projectedTextureShift?: Partial<UserTasteManifold["textureCentroid"]>,
): IdentityDriftMetrics {
  const postWeights = buildPostSceneGenreWeights(baseline, post);
  const preDominantGenres = baseline?.dominantGenres ?? [];
  const postDominantGenres = dominantFromWeights(postWeights);

  const libraryFamilies = baseline
    ? Object.keys(baseline.genreWeights)
    : preDominantGenres;

  const foreignGenresInjected = [
    ...post.anchoredAliases,
    ...post.mergedGenres,
    ...Object.keys(post.projectedGenreWeights),
  ].filter((g) => manifold != null && !genreSupportCheck(manifold, g));

  const genreDeltaValue = baseline
    ? genreDeltaInLibrary(baseline.genreWeights, postWeights, libraryFamilies)
    : postDominantGenres.length > 0 ? 1 : 0;

  const dominantShifted =
    preDominantGenres.length > 0
    && postDominantGenres.length > 0
    && preDominantGenres[0] !== postDominantGenres[0];

  const textureKeys = ["energy", "valence", "grainScore", "warmthScore", "densityScore", "rhythmScore", "spatialWidth"];

  const tasteCentroidDrift = baseline && projectedTextureShift
    ? l1CentroidDrift(baseline.textureCentroid, projectedTextureShift as Record<string, number>, textureKeys)
    : 0;

  const emotionalDrift = baseline && projectedTextureShift
    ? l1CentroidDrift(
      { energy: baseline.sonicCentroid.energy, valence: baseline.sonicCentroid.valence },
      { energy: projectedTextureShift.energy ?? baseline.sonicCentroid.energy, valence: projectedTextureShift.valence ?? baseline.sonicCentroid.valence },
      ["energy", "valence"],
    )
    : 0;

  const sonicTextureDrift = tasteCentroidDrift;

  const withinEnvelope =
    foreignGenresInjected.length === 0
    && !dominantShifted
    && genreDeltaValue <= IDENTITY_THRESHOLDS.maxGenreDelta
    && tasteCentroidDrift <= IDENTITY_THRESHOLDS.maxTasteCentroidDrift
    && emotionalDrift <= IDENTITY_THRESHOLDS.maxEmotionalDrift
    && sonicTextureDrift <= IDENTITY_THRESHOLDS.maxTextureDrift;

  return {
    genreDelta: Math.round(genreDeltaValue * 1000) / 1000,
    tasteCentroidDrift: Math.round(tasteCentroidDrift * 1000) / 1000,
    emotionalDrift: Math.round(emotionalDrift * 1000) / 1000,
    sonicTextureDrift: Math.round(sonicTextureDrift * 1000) / 1000,
    preDominantGenres,
    postDominantGenres,
    foreignGenresInjected: [...new Set(foreignGenresInjected)],
    withinEnvelope,
  };
}

export function projectedTextureShiftFromScene(
  manifold: UserTasteManifold,
  projectedGenreWeights: Record<string, number>,
): Partial<UserTasteManifold["textureCentroid"]> {
  const base = manifold.textureCentroid;
  const weightSum = Object.values(projectedGenreWeights).reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return base;

  let energy = 0;
  let valence = 0;
  let count = 0;
  for (const cluster of manifold.dominantClusters) {
    const w = projectedGenreWeights[cluster.genreFamily] ?? cluster.weight;
    energy += cluster.sonicCentroid.energy * w;
    valence += cluster.sonicCentroid.valence * w;
    count += w;
  }
  if (count <= 0) return base;

  const blend = Math.min(0.35, weightSum * 0.2);
  return {
    energy: base.energy * (1 - blend) + (energy / count) * blend,
    valence: base.valence * (1 - blend) + (valence / count) * blend,
    grainScore: base.grainScore,
    warmthScore: base.warmthScore,
    densityScore: base.densityScore,
    rhythmScore: base.rhythmScore,
    spatialWidth: base.spatialWidth,
  };
}

export { IDENTITY_THRESHOLDS };
