export type SyncQualityLabel = "Excellent" | "Good" | "Partial";

export function syncQualityLabel(score: number): SyncQualityLabel {
  if (score >= 80) return "Excellent";
  if (score >= 55) return "Good";
  return "Partial";
}

/** 0–100 derived score; informational only — never gates generation. */
export function computeSyncQualityScore(opts: {
  featureCoverage: number;
  totalTracks: number;
  syncTotal: number | null | undefined;
  syncCompletedSuccessfully: boolean;
}): number {
  const featureScore = Math.max(0, Math.min(100, opts.featureCoverage));

  let trackCompleteness = 0;
  if (opts.syncTotal != null && opts.syncTotal > 0) {
    trackCompleteness = Math.min(
      100,
      Math.round((opts.totalTracks / opts.syncTotal) * 100)
    );
  } else if (opts.totalTracks > 0 && opts.syncCompletedSuccessfully) {
    trackCompleteness = 100;
  }

  const syncConsistency = opts.syncCompletedSuccessfully ? 100 : 0;

  const raw =
    featureScore * 0.7 + trackCompleteness * 0.2 + syncConsistency * 0.1;
  return Math.round(Math.max(0, Math.min(100, raw)));
}
