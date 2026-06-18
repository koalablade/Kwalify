/**
 * Adaptive playlist morphing (Q9) — real-time adjustments on regenerate / partial morph.
 */

import type { FamiliarityMode } from "./familiarity-controller";
import type { SegmentPlaylistPlan } from "../core/segment-playlist-planner";
import type { PromptSceneMemory } from "./cross-session-memory";
import type { GlobalTasteProfile } from "./global-taste-profile";

export type MorphDirective = {
  lengthDelta: number;
  familiarityShift: FamiliarityMode | null;
  segmentEnergyNudge: number;
  swapAggression: number;
  reasons: string[];
};

export type AdaptiveMorphPlan = {
  morph: MorphDirective;
  varietyBoost: boolean;
  retryCoherence: boolean;
};

export function buildAdaptiveMorphPlan(opts: {
  samePromptRegenerate: boolean;
  priorCoherence?: number | null;
  crossSession?: PromptSceneMemory | null;
  globalTaste?: GlobalTasteProfile | null;
  segmentPlan?: SegmentPlaylistPlan | null;
  mode: "strict" | "balanced" | "chaotic";
  familiarityMode: FamiliarityMode;
}): AdaptiveMorphPlan {
  const reasons: string[] = [];
  let lengthDelta = 0;
  let familiarityShift: FamiliarityMode | null = null;
  let segmentEnergyNudge = 0;
  let swapAggression = 0.5;
  let varietyBoost = false;
  let retryCoherence = false;

  if (opts.samePromptRegenerate) {
    varietyBoost = true;
    swapAggression = 0.72;
    reasons.push("same_prompt_regenerate_variety");
  }

  const coherence = opts.priorCoherence ?? opts.crossSession?.coherenceScore ?? opts.globalTaste?.avgCoherence ?? null;
  if (typeof coherence === "number" && coherence < 0.55) {
    lengthDelta = -5;
    familiarityShift = opts.familiarityMode === "discovery" ? "balanced" : "safe";
    swapAggression = 0.85;
    retryCoherence = true;
    segmentEnergyNudge = -0.05;
    reasons.push("low_coherence_morph_safer");
  } else if (typeof coherence === "number" && coherence >= 0.78 && opts.mode !== "strict") {
    lengthDelta = 5;
    if (opts.familiarityMode === "safe") familiarityShift = "balanced";
    segmentEnergyNudge = 0.04;
    reasons.push("high_coherence_morph_expand");
  }

  if ((opts.crossSession?.generationCount ?? 0) >= 3 && opts.mode === "chaotic") {
    familiarityShift = "discovery";
    swapAggression = 0.8;
    reasons.push("chaotic_session_discovery_morph");
  }

  return {
    morph: {
      lengthDelta,
      familiarityShift,
      segmentEnergyNudge,
      swapAggression,
      reasons,
    },
    varietyBoost,
    retryCoherence,
  };
}

export function applyMorphToSegmentPlan(
  plan: SegmentPlaylistPlan,
  morph: MorphDirective,
): SegmentPlaylistPlan {
  if (morph.segmentEnergyNudge === 0) return plan;
  return {
    ...plan,
    segments: plan.segments.map((segment) => ({
      ...segment,
      energyMin: Math.max(0, Math.min(1, segment.energyMin + morph.segmentEnergyNudge)),
      energyMax: Math.max(0, Math.min(1, segment.energyMax + morph.segmentEnergyNudge)),
    })),
  };
}
