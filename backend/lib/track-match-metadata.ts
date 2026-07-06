import type { TrackScoringDebug } from "./hybrid-scoring";

export type TrackMatchReason = "scene" | "emotion" | "energy" | "fallback";

export function buildTrackMatchMetadata(opts: {
  score?: number;
  scoringDebug?: TrackScoringDebug | null;
  fastFallback?: boolean;
  narrativeRole?: string;
}): { matchStrength: number; reason: TrackMatchReason } {
  if (opts.fastFallback) {
    return {
      matchStrength: Math.round((opts.score ?? 0.72) * 100) / 100,
      reason: "fallback",
    };
  }

  const debug = opts.scoringDebug;
  const strength = Math.max(
    0,
    Math.min(1, debug?.finalScore ?? opts.score ?? 0.7)
  );

  if (!debug) {
    const role = opts.narrativeRole;
    if (role === "intro" || role === "cooldown") {
      return { matchStrength: Math.round(strength * 100) / 100, reason: "energy" };
    }
    return { matchStrength: Math.round(strength * 100) / 100, reason: "emotion" };
  }

  let reason: TrackMatchReason = "emotion";
  if (debug.sceneMatch >= 0.62 && debug.sceneMatch >= debug.emotionMatch) {
    reason = "scene";
  } else if (debug.emotionMatch >= debug.sceneMatch) {
    reason = "emotion";
  } else {
    reason = "energy";
  }

  return {
    matchStrength: Math.round(strength * 100) / 100,
    reason,
  };
}

export function trackMatchReasonLabel(reason: TrackMatchReason): string {
  if (reason === "scene") return "Scene fit";
  if (reason === "emotion") return "Emotional fit";
  if (reason === "energy") return "Energy arc fit";
  return "Library fallback match";
}
