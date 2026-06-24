/**
 * Compile-to-publish DSL (Q12 full).
 */

import type { AdaptivePlaylistProfile } from "../lib/adaptive-playlist-engine";
import type { AdaptiveMorphPlan } from "../lib/adaptive-playlist-morph";
import type { SegmentPlaylistPlan, SegmentAssignment } from "../core/segment-playlist-planner";
import type { MultiObjectPlan } from "../lib/multi-object-planner";
import type { TasteGraphV2 } from "../lib/taste-graph-v2";
import type { GlobalTasteProfile } from "../lib/global-taste-profile";
import type { CoherenceGateResult } from "../core/coherence-gate";

export type CompilePhase = {
  id: string;
  stage: "understand" | "retrieve" | "draft" | "coherence" | "repair" | "morph" | "publish";
  status: "pending" | "active" | "done" | "skipped";
  detail?: string;
};

export type PublishGateSpec = {
  minCoherence: number;
  strictBlock: boolean;
  maxRepairIterations: number;
  morphSwapAggression: number;
};

export type CompilePlanDSL = {
  version: 2;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  familiarityMode: string;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  phases: CompilePhase[];
  segmentPlan: SegmentPlaylistPlan | null;
  multiObjectPlan: MultiObjectPlan | null;
  adaptiveProfile: AdaptivePlaylistProfile;
  morphPlan: AdaptiveMorphPlan | null;
  publishGate: PublishGateSpec;
  tasteGraphV2: TasteGraphV2 | null;
  globalTaste: GlobalTasteProfile | null;
  cultureMatches: string[];
  liveTrends: string[];
};

export function buildCompilePlanDSL(opts: {
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  familiarityMode: string;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  segmentPlan: SegmentPlaylistPlan | null;
  multiObjectPlan: MultiObjectPlan | null;
  adaptiveProfile: AdaptivePlaylistProfile;
  morphPlan: AdaptiveMorphPlan | null;
  tasteGraphV2: TasteGraphV2 | null;
  globalTaste: GlobalTasteProfile | null;
  cultureMatches: string[];
  liveTrends: string[];
}): CompilePlanDSL {
  const morphAggression = opts.morphPlan?.morph.swapAggression ?? 0.5;
  return {
    version: 2,
    prompt: opts.prompt,
    mode: opts.mode,
    length: opts.length,
    familiarityMode: opts.familiarityMode,
    sceneAliases: opts.sceneAliases,
    scenePrediction: opts.scenePrediction,
    phases: [
      { id: "understand", stage: "understand", status: "done", detail: "intent+culture+global taste" },
      { id: "retrieve", stage: "retrieve", status: "pending", detail: "alias+taste+trend+segment boosts" },
      { id: "draft", stage: "draft", status: "pending" },
      { id: "coherence", stage: "coherence", status: "pending" },
      { id: "repair", stage: "repair", status: "pending" },
      { id: "morph", stage: "morph", status: opts.morphPlan ? "pending" : "skipped" },
      { id: "publish", stage: "publish", status: "pending" },
    ],
    segmentPlan: opts.segmentPlan,
    multiObjectPlan: opts.multiObjectPlan,
    adaptiveProfile: opts.adaptiveProfile,
    morphPlan: opts.morphPlan,
    publishGate: {
      minCoherence: opts.mode === "strict" ? 0.68 : 0.58,
      strictBlock: opts.mode === "strict",
      maxRepairIterations: opts.morphPlan?.retryCoherence ? 3 : 2,
      morphSwapAggression: morphAggression,
    },
    tasteGraphV2: opts.tasteGraphV2,
    globalTaste: opts.globalTaste,
    cultureMatches: opts.cultureMatches,
    liveTrends: opts.liveTrends,
  };
}

export function markCompilePhase(
  plan: CompilePlanDSL,
  stage: CompilePhase["stage"],
  status: CompilePhase["status"],
  detail?: string,
): CompilePlanDSL {
  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.stage === stage ? { ...phase, status, detail: detail ?? phase.detail } : phase,
    ),
  };
}

export function segmentAssignmentsToDiagnostics<T extends { trackId: string }>(
  assignments: SegmentAssignment<T>[],
): Array<{ segmentId: string; label: string; trackIds: string[] }> {
  return assignments.map((row) => ({
    segmentId: row.segmentId,
    label: row.label,
    trackIds: row.tracks.map((track) => track.trackId),
  }));
}

export function coherenceGateFromPlan(
  plan: CompilePlanDSL,
  gate: CoherenceGateResult | null,
): CompilePlanDSL {
  let updated = markCompilePhase(plan, "coherence", gate ? "done" : "active");
  if (gate && !gate.publish && plan.publishGate.strictBlock) {
    updated = markCompilePhase(updated, "publish", "skipped", gate.reason ?? "blocked");
  }
  return updated;
}

export function coherenceRepairSettingsFromPlan(
  plan: CompilePlanDSL | null,
  sceneLockActive = false,
): { maxIterations: number; repairThreshold: number } {
  return {
    maxIterations: plan?.publishGate.maxRepairIterations ?? (sceneLockActive ? 2 : 3),
    repairThreshold: plan?.publishGate.minCoherence ?? (sceneLockActive ? 0.75 : 0.70),
  };
}
