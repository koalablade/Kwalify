/** Shared types for offline stress-testing harnesses. */

export type AdversarialCategory =
  | "contradictory"
  | "multi_scene"
  | "genre_emotion_conflict"
  | "meme_slang"
  | "abstract"
  | "cultural_mashup";

export type CollapseType =
  | "intent_contradiction_unresolved"
  | "prompt_collapse"
  | "genre_hallucination"
  | "taste_boundary_violation"
  | "scene_dominance_failure"
  | "alias_collision"
  | "focus_collapse"
  | "generic_fallback"
  | "cold_start_degradation"
  | "multi_scene_blur"
  | "none";

export type PipelineStage =
  | "cultural_expansion"
  | "intent_decomposition"
  | "dominant_intent_contract"
  | "scene_profile"
  | "manifold_projection"
  | "alias_merge"
  | "retrieval_boost"
  | "unknown";

export type AdversarialPrompt = {
  id: string;
  prompt: string;
  category: AdversarialCategory;
  tags: string[];
};

export type IdentityDriftMetrics = {
  genreDelta: number;
  tasteCentroidDrift: number;
  emotionalDrift: number;
  sonicTextureDrift: number;
  preDominantGenres: string[];
  postDominantGenres: string[];
  foreignGenresInjected: string[];
  withinEnvelope: boolean;
};

export type StressEvaluation = {
  prompt: string;
  category?: AdversarialCategory;
  libraryId: string;
  passed: boolean;
  collapseType: CollapseType;
  failureMode: string;
  proposedFix: string;
  responsibleStage: PipelineStage;
  sceneId: string | null;
  atmospheres: string[];
  retrievalSignature: string;
  intentSignature: string;
  anchoredAliases: string[];
  blockedExternalGenres: string[];
  mergedGenresWithLibrary: string[];
  mergedGenresEmptyBase: string[];
  identityDrift?: IdentityDriftMetrics;
  severity: number;
};

export type SyntheticLibraryProfile = {
  id: string;
  label: string;
  tracks: import("../user-taste-manifold").ManifoldTrackInput[];
  coldStart?: boolean;
};
