/**
 * Adaptive playlist engine v1 (Q9) — nudges length and familiarity from prior sessions.
 */

import type { FamiliarityMode } from "./familiarity-controller";
import type { PromptSceneMemory } from "./cross-session-memory";

export type AdaptivePlaylistProfile = {
  length: number;
  familiarityMode: FamiliarityMode;
  energyNudge: "lower" | "neutral" | "higher";
  reasons: string[];
};

export function buildAdaptivePlaylistProfile(opts: {
  requestedLength: number;
  familiarityMode: FamiliarityMode;
  crossSession?: PromptSceneMemory | null;
  priorCoherence?: number | null;
  mode: "strict" | "balanced" | "chaotic";
}): AdaptivePlaylistProfile {
  const reasons: string[] = [];
  let length = opts.requestedLength;
  let familiarityMode = opts.familiarityMode;
  let energyNudge: AdaptivePlaylistProfile["energyNudge"] = "neutral";

  if (opts.crossSession && opts.crossSession.generationCount >= 2) {
    if ((opts.crossSession.coherenceScore ?? 1) < 0.55) {
      length = Math.max(20, Math.min(60, length - 5));
      familiarityMode = familiarityMode === "discovery" ? "balanced" : familiarityMode;
      reasons.push("cross_session_low_coherence_shorter_safer");
    } else if ((opts.crossSession.coherenceScore ?? 0) >= 0.75 && opts.mode !== "strict") {
      length = Math.min(60, length + 5);
      reasons.push("cross_session_high_coherence_expand");
    }
  }

  if (typeof opts.priorCoherence === "number" && opts.priorCoherence < 0.5) {
    energyNudge = "lower";
    reasons.push("prior_coherence_energy_down");
  }

  if (opts.mode === "chaotic" && (opts.crossSession?.generationCount ?? 0) >= 3) {
    familiarityMode = "discovery";
    reasons.push("chaotic_repeat_discovery");
  }

  return { length, familiarityMode, energyNudge, reasons };
}
