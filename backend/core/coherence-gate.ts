/**
 * Coherence publish gate — enforces playlist-level world consistency before ship.
 */

import type { PlaylistCoherenceScore } from "./playlist-coherence-audit";

export const COHERENCE_PUBLISH_THRESHOLD = 0.58;
export const COHERENCE_STRICT_THRESHOLD = 0.68;
export const COHERENCE_HARD_SCENE_MIN = 0.6;
export const COHERENCE_HARD_ATMOSPHERE_MIN = 0.55;
export const COHERENCE_HARD_OVERALL_MIN = 0.62;

export type CoherenceGateResult = {
  publish: boolean;
  reason: string | null;
  hardGatePassed: boolean;
  mode: "strict" | "balanced" | "chaotic";
  thresholds: {
    overall: number;
    scene: number;
    atmosphere: number;
  };
};

export function hardCoherenceGate(score: PlaylistCoherenceScore): boolean {
  if (score.sceneScore < COHERENCE_HARD_SCENE_MIN) return false;
  if (score.atmosphereScore < COHERENCE_HARD_ATMOSPHERE_MIN) return false;
  if (score.overallScore < COHERENCE_HARD_OVERALL_MIN) return false;
  return true;
}

export function strictModeGuard(
  score: PlaylistCoherenceScore,
  mode: string,
): boolean {
  if (mode !== "strict") return true;
  return score.overallScore >= COHERENCE_STRICT_THRESHOLD && hardCoherenceGate(score);
}

export function shouldPublishPlaylist(
  score: PlaylistCoherenceScore,
  mode: "strict" | "balanced" | "chaotic",
  opts?: { librarySize?: number },
): CoherenceGateResult {
  const thinLibrary = (opts?.librarySize ?? 1000) < 200;
  const strictOverall = thinLibrary
    ? Math.max(0.52, COHERENCE_STRICT_THRESHOLD - 0.08)
    : COHERENCE_STRICT_THRESHOLD;
  const hardSceneMin = thinLibrary
    ? Math.max(0.48, COHERENCE_HARD_SCENE_MIN - 0.1)
    : COHERENCE_HARD_SCENE_MIN;
  const hardAtmosphereMin = thinLibrary
    ? Math.max(0.45, COHERENCE_HARD_ATMOSPHERE_MIN - 0.08)
    : COHERENCE_HARD_ATMOSPHERE_MIN;

  const thresholds = {
    overall: mode === "strict"
      ? strictOverall
      : mode === "chaotic"
        ? COHERENCE_PUBLISH_THRESHOLD - 0.06
        : COHERENCE_PUBLISH_THRESHOLD,
    scene: mode === "strict" ? hardSceneMin : COHERENCE_HARD_SCENE_MIN - 0.08,
    atmosphere: mode === "strict" ? hardAtmosphereMin : COHERENCE_HARD_ATMOSPHERE_MIN - 0.06,
  };

  const hardGatePassed = score.sceneScore >= hardSceneMin &&
    score.atmosphereScore >= hardAtmosphereMin &&
    score.overallScore >= (thinLibrary ? COHERENCE_HARD_OVERALL_MIN - 0.06 : COHERENCE_HARD_OVERALL_MIN);
  const overallPass = score.overallScore >= thresholds.overall;
  const scenePass = score.sceneScore >= thresholds.scene;
  const atmospherePass = score.atmosphereScore >= thresholds.atmosphere;

  if (mode === "strict") {
    if (!overallPass) {
      return { publish: false, reason: "strict_overall_below_threshold", hardGatePassed, mode, thresholds };
    }
    if (!hardGatePassed) {
      return { publish: false, reason: "strict_hard_coherence_gate_failed", hardGatePassed, mode, thresholds };
    }
    return { publish: true, reason: null, hardGatePassed, mode, thresholds };
  }

  if (!overallPass) {
    return { publish: true, reason: "soft_coherence_below_threshold", hardGatePassed, mode, thresholds };
  }
  if (!scenePass || !atmospherePass) {
    return { publish: true, reason: "soft_scene_or_atmosphere_weak", hardGatePassed, mode, thresholds };
  }

  return { publish: true, reason: null, hardGatePassed, mode, thresholds };
}
