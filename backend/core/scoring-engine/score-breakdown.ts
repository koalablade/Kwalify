/** Per-stage score attribution for eval telemetry and forensics. */
export type ScoreChannelBreakdown = {
  hybridBase: number;
  hybridEmbedding: number;
  hybridUserTaste: number;
  hybridNovelty: number;
  hybridEmotion: number;
  hybridScene: number;
  rediscoveryBoost: number;
  refineAdjust: number;
  freshnessMultiplier: number;
  noveltyPenalty: number;
  contextualPenalty: number;
  finalScore: number;
  /** primary = full hybrid path; recovery = filler/underfill; fallback = fast-fallback */
  attributionSource?: "primary" | "recovery" | "fallback";
};

/** Flat per-channel view for eval payloads and investigation. */
export type ScoreChannelSummary = {
  embedding: number;
  userTaste: number;
  emotion: number;
  scene: number;
  rediscovery: number;
  refine: number;
  /** Negative when freshness multiplier is below 1. */
  freshness: number;
  /** Negative subtractive penalty. */
  novelty: number;
  contextual: number;
  final: number;
  attributionSource?: "primary" | "recovery" | "fallback";
};

export function roundBreakdown(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function summarizeScoreChannels(b: ScoreChannelBreakdown): ScoreChannelSummary {
  const freshness =
    b.freshnessMultiplier < 1
      ? roundBreakdown((b.freshnessMultiplier - 1) * Math.max(b.hybridBase, 0.01))
      : 0;
  return {
    embedding: b.hybridEmbedding,
    userTaste: b.hybridUserTaste,
    emotion: b.hybridEmotion,
    scene: b.hybridScene,
    rediscovery: b.rediscoveryBoost,
    refine: b.refineAdjust,
    freshness,
    novelty: b.noveltyPenalty > 0 ? -b.noveltyPenalty : 0,
    contextual: b.contextualPenalty > 0 ? -b.contextualPenalty : 0,
    final: b.finalScore,
    ...(b.attributionSource ? { attributionSource: b.attributionSource } : {}),
  };
}

/** Telemetry stub for recovery/fallback tracks that bypass hybrid scoring. */
export function buildRecoveryScoreBreakdown(
  score: number,
  source: "recovery" | "fallback" = "recovery",
): ScoreChannelBreakdown {
  const base = roundBreakdown(score);
  return {
    hybridBase: base,
    hybridEmbedding: 0,
    hybridUserTaste: 0,
    hybridNovelty: 0,
    hybridEmotion: 0,
    hybridScene: 0,
    rediscoveryBoost: 0,
    refineAdjust: 0,
    freshnessMultiplier: 1,
    noveltyPenalty: 0,
    contextualPenalty: 0,
    finalScore: base,
    attributionSource: source,
  };
}

/** Ensure every API track has score attribution after controller recovery/repair mutations. */
export function attachScoreAttribution<
  U extends { trackId: string; score?: number; rediscoveryScore?: number; scoreBreakdown?: ScoreChannelBreakdown },
  S extends {
    trackId: string;
    score?: number;
    rediscoveryScore?: number;
    scoreBreakdown?: ScoreChannelBreakdown;
    scoringDebug?: unknown;
  },
>(
  tracks: U[],
  scoredById: Map<string, S>,
  fallbackSource: "recovery" | "fallback" = "recovery",
): U[] {
  return tracks.map((track) => {
    const scored = scoredById.get(track.trackId);
    if (scored) {
      const breakdown = scored.scoreBreakdown
        ? {
            ...scored.scoreBreakdown,
            attributionSource: scored.scoreBreakdown.attributionSource ?? ("primary" as const),
          }
        : undefined;
      return {
        ...track,
        ...(typeof scored.score === "number" ? { score: scored.score } : {}),
        ...(typeof scored.rediscoveryScore === "number" ? { rediscoveryScore: scored.rediscoveryScore } : {}),
        ...(breakdown ? { scoreBreakdown: breakdown } : {}),
        ...(scored.scoringDebug ? { scoringDebug: scored.scoringDebug } : {}),
      };
    }
    if (track.scoreBreakdown?.attributionSource) return track;
    const fallbackScore = typeof track.score === "number" ? track.score : 0.7;
    return {
      ...track,
      scoreBreakdown:
        track.scoreBreakdown ?? buildRecoveryScoreBreakdown(fallbackScore, fallbackSource),
    };
  });
}

export function resolveTrackScoreBreakdown(track: {
  score?: number;
  scoreBreakdown?: ScoreChannelBreakdown;
}): ScoreChannelBreakdown {
  if (track.scoreBreakdown) {
    if (track.scoreBreakdown.attributionSource) return track.scoreBreakdown;
    const isPrimary =
      track.scoreBreakdown.hybridEmbedding > 0
      || track.scoreBreakdown.hybridEmotion > 0
      || track.scoreBreakdown.hybridUserTaste > 0;
    return {
      ...track.scoreBreakdown,
      attributionSource: isPrimary ? "primary" : "recovery",
    };
  }
  return buildRecoveryScoreBreakdown(track.score ?? 0.7, "recovery");
}
