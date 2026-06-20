/**
 * Track semantic profile — persisted enrichment beyond genre/audio features.
 */

import type { MusicSemanticProfile } from "./music-semantic-types";

export const SEMANTIC_ENRICHMENT_VERSION = "semantic-v3";

export type SceneDimensionProfile = {
  places: string[];
  times: string[];
  activities: string[];
  weather: string[];
  atmospheres: string[];
};

export type TrackSemanticProfile = {
  version: typeof SEMANTIC_ENRICHMENT_VERSION;
  culturalTags: string[];
  scene: SceneDimensionProfile;
  themes: string[];
  sceneConcepts: string[];
  eras: string[];
  /** Narrative/cinematic/cultural music feel — above genre + audio features. */
  musicSemantic: MusicSemanticProfile;
  retrievalSignature: string;
  enrichedAt: string;
};

export type PromptSceneProfile = SceneDimensionProfile & {
  culturalTags: string[];
  themes: string[];
  sceneConcepts: string[];
  retrievalSignature: string;
};

export type SemanticMatchDiagnostics = {
  sceneOverlap: number;
  culturalOverlap: number;
  themeOverlap: number;
  conceptOverlap: number;
  ecosystemBoost: number;
  musicSemanticBoost: number;
  narrativeAlignment: number;
  cinematicAlignment: number;
  totalBoost: number;
};

export function emptySceneProfile(): SceneDimensionProfile {
  return { places: [], times: [], activities: [], weather: [], atmospheres: [] };
}

export function signatureFromTags(tags: string[]): string {
  return tags.slice().sort().join("|");
}
