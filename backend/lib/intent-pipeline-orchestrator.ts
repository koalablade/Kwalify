/**
 * Intent pipeline orchestrator — single entry that wires Q1–Q4 modules together.
 */

import { buildIntentState, type IntentState } from "../core/intent-state-engine";
import { decomposeIntent, type DecomposedIntent } from "../core/intent-decomposer";
import { resolveSceneLock, type SceneLockStatus } from "../core/scene-lock-mode";
import { buildEmotionalArc, type EmotionalArc } from "../core/emotional-arc-planner";
import { buildIntentLossReport, type IntentLossReport } from "./intent-loss-report";
import {
  resolveDecomposedSceneAliases,
  scenePredictionFromAliases,
} from "./scene-alias-graph";
import { familiarityModeForGenerateMode, type FamiliarityMode } from "./familiarity-controller";

export type IntentPipelineContext = {
  decomposedIntent: DecomposedIntent;
  intentState: IntentState;
  intentLossReport: IntentLossReport;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  sceneLockStatus: SceneLockStatus;
  emotionalArc: EmotionalArc;
  familiarityMode: FamiliarityMode;
};

export function buildIntentPipelineContext(
  prompt: string,
  generateMode: "strict" | "balanced" | "chaotic",
  familiarityOverride?: FamiliarityMode | null,
): IntentPipelineContext {
  const decomposedIntent = decomposeIntent(prompt);
  const intentState = buildIntentState(prompt);
  const sceneAliases = resolveDecomposedSceneAliases(decomposedIntent);
  const scenePrediction = scenePredictionFromAliases(sceneAliases, decomposedIntent.confidence);
  const sceneLockStatus = resolveSceneLock(intentState, prompt);
  const emotionalArc = buildEmotionalArc(decomposedIntent);
  const intentLossReport = buildIntentLossReport(intentState, {
    scenePrediction,
    assumptions: buildAssumptions(decomposedIntent, sceneAliases),
  });
  const familiarityMode = familiarityModeForGenerateMode(generateMode, familiarityOverride);

  return {
    decomposedIntent,
    intentState,
    intentLossReport,
    sceneAliases,
    scenePrediction,
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

/** Soft-merge scene alias families into genre intent — library-first, never inject cultural genres alone. */
export function mergeSceneAliasesIntoGenres(
  genreFamilies: string[],
  sceneAliases: string[],
  opts?: { libraryGenreFamilies?: string[] },
): string[] {
  if (sceneAliases.length === 0) return genreFamilies;
  const base = [...genreFamilies];
  if (base.length === 0) {
    return [];
  }
  const library = new Set(opts?.libraryGenreFamilies ?? []);
  const merged = [...base];
  for (const alias of sceneAliases) {
    if (library.size > 0 && !library.has(alias)) continue;
    if (!merged.includes(alias)) merged.push(alias);
  }
  return merged.slice(0, 6);
}
