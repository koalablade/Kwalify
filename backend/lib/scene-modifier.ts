/**
 * Scene = filter, not generator.
 * Scenes output weights / filters / boosts / constraints only — never genre families.
 */

import type { ExpandedCulturalContext } from "./cultural-reference-expansion";
import { buildMusicSemanticConstraintsFromSceneProfile } from "./scene-music-alignment";
import { buildPromptSceneProfile } from "./scene-semantic-retrieval";
import {
  filterGenreHintsThroughManifold,
  filterScenePredictionThroughManifold,
  projectSceneOntoManifold,
  type SceneProjection,
  type UserTasteManifold,
} from "./user-taste-manifold";
import type { MusicSemanticConstraints } from "./music-semantic-types";
import { applySceneDifferentiation, type SceneDifferentiation } from "./scene-collision-resolver";

export const SCENE_MODIFIER_VERSION = "scene-filter-v1";

export type SceneModifierBoosts = {
  semantic: number;
  texture: number;
  culture: number;
  manifold: number;
};

export type SceneModifier = {
  version: typeof SCENE_MODIFIER_VERSION;
  sceneId: string | null;
  /** Library-supported taste weights only (from manifold projection). */
  weights: Record<string, number>;
  /** Unsupported external genre hints — block at retrieval, never inject. */
  filters: string[];
  boosts: SceneModifierBoosts;
  constraints: MusicSemanticConstraints;
  retrievalSignature: string;
  emotionalVector: Record<string, number>;
  differentiation: SceneDifferentiation | null;
};

function emotionalVectorFromExpansion(expansion: ExpandedCulturalContext): Record<string, number> {
  const vector: Record<string, number> = {};
  if (expansion.dominantEmotion) {
    vector[expansion.dominantEmotion] = Math.min(1, expansion.culturalDominance + 0.35);
  }
  for (const atmosphere of expansion.atmospheres.slice(0, 4)) {
    vector[atmosphere] = Math.round((0.25 + expansion.culturalDominance * 0.4) * 100) / 100;
  }
  return vector;
}

export function buildSceneModifier(opts: {
  prompt: string;
  expansion: ExpandedCulturalContext;
  manifold?: UserTasteManifold | null;
  scenePrediction?: Record<string, number>;
}): SceneModifier {
  const profile = buildPromptSceneProfile(opts.prompt);
  const differentiated = applySceneDifferentiation(opts.prompt, profile, opts.expansion);

  const projection: SceneProjection | null = opts.manifold
    ? projectSceneOntoManifold(
      [...opts.expansion.atmospheres, ...opts.expansion.scene.atmospheres],
      opts.expansion.culturalTags,
      opts.expansion.sceneId,
      opts.manifold,
    )
    : null;

  const rawWeights = projection?.projectedGenreWeights ?? {};
  const weights = opts.manifold
    ? filterScenePredictionThroughManifold(rawWeights, opts.manifold)
    : {};

  const legacyHints = opts.expansion.genreFamilies ?? [];
  const { blocked: filters } = filterGenreHintsThroughManifold(legacyHints, opts.manifold ?? null);
  const externalBlocked = projection?.filteredExternalGenres ?? [];
  const allFilters = [...new Set([...filters, ...externalBlocked])];

  const sceneAffinity: Record<string, number> = {};
  if (opts.expansion.sceneId) sceneAffinity[opts.expansion.sceneId] = 0.55;
  if (differentiated.axis) sceneAffinity[differentiated.axis] = 0.45;

  const constraints = buildMusicSemanticConstraintsFromSceneProfile(
    {
      places: profile.places,
      times: profile.times,
      activities: profile.activities,
      weather: profile.weather,
      atmospheres: profile.atmospheres,
      culturalTags: profile.culturalTags,
      themes: profile.themes,
      sceneConcepts: profile.sceneConcepts,
      retrievalSignature: differentiated.retrievalSignature,
    },
    opts.expansion.sceneId,
  );

  const culturalDominance = opts.expansion.culturalDominance;
  const boosts: SceneModifierBoosts = {
    semantic: Math.round(Math.min(0.22, 0.06 + culturalDominance * 0.18) * 1000) / 1000,
    texture: Math.round(Math.min(0.18, Object.keys(weights).length * 0.04) * 1000) / 1000,
    culture: Math.round(Math.min(0.14, culturalDominance * 0.12) * 1000) / 1000,
    manifold: Math.round(Math.min(0.2, Object.values(weights).reduce((a, b) => a + b, 0) * 0.15) * 1000) / 1000,
  };

  return {
    version: SCENE_MODIFIER_VERSION,
    sceneId: opts.expansion.sceneId,
    weights,
    filters: allFilters,
    boosts,
    constraints,
    retrievalSignature: differentiated.retrievalSignature,
    emotionalVector: emotionalVectorFromExpansion(opts.expansion),
    differentiation: differentiated,
  };
}

/** @deprecated Scene never merges into genre intent — returns base unchanged. */
export function applySceneToGenreFamilies(
  genreFamilies: string[],
  _sceneModifier?: SceneModifier | null,
): string[] {
  return [...genreFamilies];
}
