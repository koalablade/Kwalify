/**
 * User-visible delivery quality ladder — internal failures map to a tier, not HTTP 422.
 */

export type GenerationDeliveryTier =
  | "ideal"
  | "very_good"
  | "good"
  | "safe"
  | "emergency";

/** Smallest playlist we still return rather than failing the request. */
export function minimumReturnableTrackCount(targetCount: number): number {
  return Math.max(3, Math.min(8, Math.ceil(targetCount * 0.25)));
}

export function resolveGenerationDeliveryTier(opts: {
  targetCount: number;
  finalTrackCount: number;
  gatePassed: boolean;
  degradationReasons: string[];
  preferredIntentPoolMet?: boolean;
}): GenerationDeliveryTier {
  const fillRatio = opts.finalTrackCount / Math.max(1, opts.targetCount);
  const reasons = opts.degradationReasons;
  const emergency = reasons.some((reason) =>
    reason.includes("emergency")
    || reason.includes("safe_playlist")
    || reason.includes("minimal_output")
    || reason.includes("library_emergency"),
  );
  const degraded = reasons.some((reason) =>
    reason.includes("degraded")
    || reason.includes("below_preferred")
    || reason.includes("relaxed")
    || reason.includes("fallback"),
  );

  if (opts.finalTrackCount <= 0) return "emergency";
  if (emergency && fillRatio < 0.4) return "emergency";
  if (emergency || fillRatio < 0.5) return "safe";
  if (!opts.gatePassed || degraded) {
    if (fillRatio >= 0.72) return "very_good";
    if (fillRatio >= 0.5) return "good";
    return "safe";
  }
  if (opts.preferredIntentPoolMet !== false && fillRatio >= 0.95) return "ideal";
  if (fillRatio >= 0.72) return "very_good";
  return "good";
}
