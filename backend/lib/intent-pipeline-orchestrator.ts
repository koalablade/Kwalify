/**
 * Intent pipeline orchestrator — single entry that wires Q1–Q4 modules together.
 */

import { buildIntentState, type IntentState } from "../core/intent-state-engine";
import { buildAuthoritativeIntentContract, type AuthoritativeIntentContract } from "../core/authoritative-intent-contract";
import type { DecomposedIntent } from "../core/intent-decomposer";
import { resolveSceneLock, type SceneLockStatus } from "../core/scene-lock-mode";
import { buildEmotionalArc, type EmotionalArc } from "../core/emotional-arc-planner";
import { buildIntentLossReport, type IntentLossReport } from "./intent-loss-report";
import {
  resolveDecomposedSceneAliases,
  scenePredictionFromAliases,
} from "./scene-alias-graph";
import { familiarityModeForGenerateMode, type FamiliarityMode } from "./familiarity-controller";
import {
  filterSceneAliasesThroughManifold,
  filterScenePredictionThroughManifold,
  mergeProjectedWeightsIntoPrediction,
  type SceneProjection,
  type UserTasteManifold,
} from "./user-taste-manifold";
import { expandCulturalReferences } from "./cultural-reference-expansion";
import { buildSceneModifier, type SceneModifier } from "./scene-modifier";

export type IntentPipelineContext = {
  authoritativeIntent: AuthoritativeIntentContract;
  decomposedIntent: DecomposedIntent;
  intentState: IntentState;
  intentLossReport: IntentLossReport;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  sceneModifier: SceneModifier;
  sceneLockStatus: SceneLockStatus;
  emotionalArc: EmotionalArc;
  familiarityMode: FamiliarityMode;
};

export function buildIntentPipelineContext(
  prompt: string,
  generateMode: "strict" | "balanced" | "chaotic",
  familiarityOverride?: FamiliarityMode | null,
): IntentPipelineContext {
  const authoritativeIntent = buildAuthoritativeIntentContract({
    prompt,
    mode: generateMode,
  });
  const decomposedIntent = authoritativeIntent.decomposedIntent;
  const intentState = authoritativeIntent.intentState;
  const sceneAliases = resolveDecomposedSceneAliases(decomposedIntent);
  const scenePrediction = scenePredictionFromAliases(sceneAliases, decomposedIntent.confidence);
  const expansion = expandCulturalReferences(prompt);
  const sceneModifier = buildSceneModifier({
    prompt,
    expansion,
    scenePrediction,
  });
  const sceneLockStatus = resolveSceneLock(intentState, prompt);
  const emotionalArc = buildEmotionalArc(decomposedIntent);
  const intentLossReport = buildIntentLossReport(intentState, {
    scenePrediction,
    assumptions: buildAssumptions(decomposedIntent, sceneAliases),
  });
  const familiarityMode = familiarityModeForGenerateMode(generateMode, familiarityOverride);

  return {
    authoritativeIntent,
    decomposedIntent,
    intentState,
    intentLossReport,
    sceneAliases,
    scenePrediction: sceneModifier.weights,
    sceneModifier,
    sceneLockStatus,
    emotionalArc,
    familiarityMode,
  };
}

function buildAssumptions(intent: DecomposedIntent, sceneAliases: string[]): string[] {
  const assumptions: string[] = [];
  if (intent.scene && sceneAliases.length > 0) {
    assumptions.push(`${intent.scene} -> ${sceneAliases.slice(0, 3).join(" + ")}`);
  }
  if (intent.culturalRefs.length > 0) {
    assumptions.push(`cultural refs -> ${intent.culturalRefs.join(", ")}`);
  }
  if (intent.unknownTokens.length > 0 && intent.confidence < 0.65) {
    assumptions.push(`unknown tokens retained for harvest: ${intent.unknownTokens.slice(0, 3).join(", ")}`);
  }
  return assumptions.slice(0, 8);
}

/** @deprecated Scene never merges genres — returns base unchanged. */
export function mergeSceneAliasesIntoGenres(
  genreFamilies: string[],
  _sceneAliases: string[],
  _opts?: { libraryGenreFamilies?: string[] },
): string[] {
  return [...genreFamilies];
}

export function anchorSceneContextToManifold(
  sceneAliases: string[],
  scenePrediction: Record<string, number>,
  manifold: UserTasteManifold | null,
  sceneProjection?: SceneProjection | null,
): { sceneAliases: string[]; scenePrediction: Record<string, number> } {
  const anchoredAliases = filterSceneAliasesThroughManifold(sceneAliases, manifold);
  let anchoredPrediction = filterScenePredictionThroughManifold(scenePrediction, manifold);
  if (sceneProjection && manifold) {
    anchoredPrediction = mergeProjectedWeightsIntoPrediction(anchoredPrediction, sceneProjection);
  }
  return { sceneAliases: anchoredAliases, scenePrediction: anchoredPrediction };
}
