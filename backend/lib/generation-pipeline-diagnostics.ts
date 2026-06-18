/**
 * Unified end-to-end pipeline diagnostics bundle.
 */

import type { IntentState } from "../core/intent-state-engine";
import type { DecomposedIntent } from "../core/intent-decomposer";
import type { SceneLockStatus } from "../core/scene-lock-mode";
import type { PlaylistCoherenceScore, CoherenceSwapRecord } from "../core/playlist-coherence-audit";
import type { IntentLossReport } from "./intent-loss-report";
import type { CoherenceGateResult } from "../core/coherence-gate";
import type { EmotionalArc } from "../core/emotional-arc-planner";

export type GenerationPipelineDiagnostics = {
  intentState: IntentState;
  decomposedIntent: DecomposedIntent;
  intentLossReport: IntentLossReport;
  coherenceScore: PlaylistCoherenceScore | null;
  coherenceGate: CoherenceGateResult | null;
  swapRepairActions: CoherenceSwapRecord[];
  sceneLockStatus: SceneLockStatus;
  sceneAliases: string[];
  emotionalArc: EmotionalArc | null;
  unknownTokens: string[];
  rebuildIterations: number;
};

export function buildGenerationPipelineDiagnostics(opts: {
  intentState: IntentState;
  decomposedIntent: DecomposedIntent;
  intentLossReport: IntentLossReport;
  coherenceScore: PlaylistCoherenceScore | null;
  coherenceGate: CoherenceGateResult | null;
  swapRepairActions: CoherenceSwapRecord[];
  sceneLockStatus: SceneLockStatus;
  sceneAliases: string[];
  emotionalArc: EmotionalArc | null;
  rebuildIterations: number;
}): GenerationPipelineDiagnostics {
  return {
    intentState: opts.intentState,
    decomposedIntent: opts.decomposedIntent,
    intentLossReport: opts.intentLossReport,
    coherenceScore: opts.coherenceScore,
    coherenceGate: opts.coherenceGate,
    swapRepairActions: opts.swapRepairActions,
    sceneLockStatus: opts.sceneLockStatus,
    sceneAliases: opts.sceneAliases,
    emotionalArc: opts.emotionalArc,
    unknownTokens: opts.decomposedIntent.unknownTokens ?? opts.intentState.unknownTokens ?? [],
    rebuildIterations: opts.rebuildIterations,
  };
}
