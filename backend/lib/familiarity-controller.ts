/**
 * Familiarity vs discovery control (Q5 foundation).
 * Maps generate mode to internal familiarity posture.
 */

import type { RediscoveryMode } from "./forgotten-favourites";

export type FamiliarityMode = "safe" | "balanced" | "discovery";

export function familiarityModeForGenerateMode(
  mode: "strict" | "balanced" | "chaotic",
  override?: FamiliarityMode | null,
): FamiliarityMode {
  if (override && ["safe", "balanced", "discovery"].includes(override)) return override;
  if (mode === "strict") return "safe";
  if (mode === "chaotic") return "discovery";
  return "balanced";
}

export function rediscoveryModeForFamiliarity(
  familiarity: FamiliarityMode,
  detected: RediscoveryMode,
): RediscoveryMode {
  if (familiarity === "safe") {
    return detected === "deep_cuts" ? "balanced" : detected;
  }
  if (familiarity === "discovery") {
    return detected === "balanced" ? "deep_cuts" : detected;
  }
  return detected;
}

export function familiarityDiscoveryRatio(familiarity: FamiliarityMode): number {
  if (familiarity === "safe") return 0.12;
  if (familiarity === "discovery") return 0.38;
  return 0.22;
}
