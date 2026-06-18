/**
 * Track semantic profile — persisted enrichment beyond genre/audio features.
 */

export const SEMANTIC_ENRICHMENT_VERSION = "semantic-v1";

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
  totalBoost: number;
};

export function emptySceneProfile(): SceneDimensionProfile {
  return { places: [], times: [], activities: [], weather: [], atmospheres: [] };
}

export function signatureFromTags(tags: string[]): string {
  return tags.slice().sort().join("|");
}
