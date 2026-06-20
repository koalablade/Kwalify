/**
 * Collapse type classifier and fix proposer for stress test failures.
 */

import type { CollapseType, PipelineStage, StressEvaluation } from "./types";

export type RawStressSignals = {
  prompt: string;
  libraryId: string;
  coldStart: boolean;
  sceneId: string | null;
  atmospheres: string[];
  retrievalSignature: string;
  intentSignature: string;
  anchoredAliases: string[];
  blockedExternalGenres: string[];
  filteredExternalGenres: string[];
  mergedGenresWithLibrary: string[];
  mergedGenresEmptyBase: string[];
  expansionGenreHints: string[];
  hasContradiction: boolean;
  multiSceneDetected: boolean;
  signatureCollision: boolean;
  foreignGenresInjected: string[];
  identityWithinEnvelope: boolean;
  sceneAtmosphereDetected: boolean;
  genericFallbackRisk: boolean;
  focusCollapseRisk: boolean;
  identityDriftSeverity: number;
};

const FIX_BY_COLLAPSE: Record<CollapseType, string> = {
  none: "No action required.",
  intent_contradiction_unresolved: "Add explicit contradiction resolver in authoritative-intent-contract with priority winner (never average conflicting emotions/energy).",
  prompt_collapse: "Differentiate retrieval signatures in scene-music-alignment and dominant-intent-contract for near-duplicate adversarial prompts.",
  genre_hallucination: "Strengthen filterSceneAliasesThroughManifold and partitionExpansionGenreHints; block unsupported genres at alias_merge stage.",
  taste_boundary_violation: "Tighten identity envelope in projectSceneOntoManifold; cap projectedGenreWeights to library-supported families only.",
  scene_dominance_failure: "Expand cultural-reference-expansion and scene-knowledge entries for slang/abstract prompts; add fallback atmosphere inference.",
  alias_collision: "Extend semantic-collision-guards homonym map; reject bare genre terms as scene aliases when library lacks support.",
  focus_collapse: "Reduce focusCollapsePenalty when deep semantic tags present; require narrative/cinematic tags only for reading/focus scenes.",
  generic_fallback: "Disable empty-base genre injection in mergeSceneAliasesIntoGenres; require library intersection for cold-start.",
  cold_start_degradation: "Use no-library retrieval ladder with scene texture constraints instead of generic genre defaults.",
  multi_scene_blur: "Pick dominant scene by culturalDominance score; store secondary scenes as soft boosts only, not merged atmospheres.",
};

const STAGE_BY_COLLAPSE: Record<CollapseType, PipelineStage> = {
  none: "unknown",
  intent_contradiction_unresolved: "dominant_intent_contract",
  prompt_collapse: "scene_profile",
  genre_hallucination: "alias_merge",
  taste_boundary_violation: "manifold_projection",
  scene_dominance_failure: "cultural_expansion",
  alias_collision: "alias_merge",
  focus_collapse: "retrieval_boost",
  generic_fallback: "alias_merge",
  cold_start_degradation: "cultural_expansion",
  multi_scene_blur: "cultural_expansion",
};

export function classifyCollapse(signals: RawStressSignals): CollapseType {
  if (signals.coldStart && signals.genericFallbackRisk) return "cold_start_degradation";
  if (signals.foreignGenresInjected.length > 0) return "genre_hallucination";
  if (!signals.identityWithinEnvelope) return "taste_boundary_violation";
  if (signals.hasContradiction && signals.identityDriftSeverity > 0.5) return "intent_contradiction_unresolved";
  if (signals.multiSceneDetected && !signals.sceneAtmosphereDetected) return "multi_scene_blur";
  if (!signals.sceneAtmosphereDetected) return "scene_dominance_failure";
  if (signals.signatureCollision) return "prompt_collapse";
  if (signals.genericFallbackRisk) return "generic_fallback";
  if (signals.focusCollapseRisk) return "focus_collapse";
  if (signals.blockedExternalGenres.length > 0 && signals.mergedGenresEmptyBase.length > 2) return "alias_collision";
  return "none";
}

export function failureModeDescription(collapse: CollapseType, signals: RawStressSignals): string {
  switch (collapse) {
    case "genre_hallucination":
      return `Injected unsupported genres: ${signals.foreignGenresInjected.join(", ")}`;
    case "taste_boundary_violation":
      return `Identity envelope exceeded (drift severity ${signals.identityDriftSeverity})`;
    case "intent_contradiction_unresolved":
      return "Contradictory prompt produced unstable intent without explicit resolution";
    case "prompt_collapse":
      return `Retrieval signature collision: ${signals.retrievalSignature.slice(0, 80)}`;
    case "scene_dominance_failure":
      return "No scene atmosphere detected from prompt";
    case "multi_scene_blur":
      return "Multiple scenes merged without dominant scene selection";
    case "generic_fallback":
      return `Generic genre injection: empty-base merge ${signals.mergedGenresEmptyBase.join(", ")}`;
    case "cold_start_degradation":
      return "Cold-start library fell back to generic genre defaults";
    case "alias_collision":
      return `Alias collision with blocked externals: ${signals.blockedExternalGenres.join(", ")}`;
    case "focus_collapse":
      return "Focus-adjacent collapse under rich semantic prompt";
    default:
      return "OK";
  }
}

export function severityScore(collapse: CollapseType, signals: RawStressSignals): number {
  if (collapse === "none") return 0;
  const base: Record<CollapseType, number> = {
    none: 0,
    genre_hallucination: 0.95,
    taste_boundary_violation: 0.9,
    intent_contradiction_unresolved: 0.75,
    cold_start_degradation: 0.7,
    generic_fallback: 0.65,
    multi_scene_blur: 0.6,
    scene_dominance_failure: 0.55,
    prompt_collapse: 0.5,
    alias_collision: 0.45,
    focus_collapse: 0.35,
  };
  return Math.min(1, base[collapse] + signals.identityDriftSeverity * 0.1);
}

export function buildStressEvaluation(
  signals: RawStressSignals,
  extra: Partial<StressEvaluation> = {},
): StressEvaluation {
  const collapseType = classifyCollapse(signals);
  const severity = severityScore(collapseType, signals);
  return {
    prompt: signals.prompt,
    libraryId: signals.libraryId,
    passed: collapseType === "none",
    collapseType,
    failureMode: failureModeDescription(collapseType, signals),
    proposedFix: FIX_BY_COLLAPSE[collapseType],
    responsibleStage: STAGE_BY_COLLAPSE[collapseType],
    sceneId: signals.sceneId,
    atmospheres: signals.atmospheres,
    retrievalSignature: signals.retrievalSignature,
    intentSignature: signals.intentSignature,
    anchoredAliases: signals.anchoredAliases,
    blockedExternalGenres: signals.blockedExternalGenres,
    mergedGenresWithLibrary: signals.mergedGenresWithLibrary,
    mergedGenresEmptyBase: signals.mergedGenresEmptyBase,
    severity,
    ...extra,
  };
}

export function proposedFixFor(collapse: CollapseType): string {
  return FIX_BY_COLLAPSE[collapse];
}
