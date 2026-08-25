/**
 * Observational hybrid-cap forensics.
 * Never mutates pools, scores, ranks, or selection.
 */

export const HYBRID_CAP_FORENSICS_VERSION = 1 as const;

export type HybridCapDropReason =
  | "NOT_IN_HYBRID_INPUT"
  | "DROPPED_BY_HYBRID_CAP"
  | "DROPPED_BY_HYBRID_SCORE"
  | "DROPPED_BY_METADATA_REQUIREMENT"
  | "DROPPED_BY_SOURCE_QUOTA"
  | "DROPPED_BY_ARTIST_QUOTA"
  | "DROPPED_BY_DEDUPLICATION"
  | "DROPPED_BY_OTHER"
  | "UNKNOWN"
  | "SURVIVED_HYBRID_CAP";

export type HybridCapReserveLane =
  | "techno_identity"
  | "explicit_family"
  | "explicit_era"
  | "stratified"
  | "fill"
  | "uncapped_passthrough"
  | "not_in_input"
  | "unknown";

export type HybridCapFitComponents = {
  emotionFit: number;
  jitter: number;
  reuseDampener: number;
  explicitBoost: number;
  technoIdentityBoost: number;
  eraBoost: number;
  antiGenrePenalty: number;
  matchesExplicitFamily: boolean;
  matchesExplicitEra: boolean;
  genreFamily: string | null;
  releaseYear: number | null;
  artistName: string | null;
  trackName: string | null;
};

export type HybridCapTrackForensic = {
  trackId: string;
  inInput: boolean;
  fit: number | null;
  preCapRank: number | null;
  survived: boolean;
  reserveLane: HybridCapReserveLane;
  dropReason: HybridCapDropReason;
  components: HybridCapFitComponents | null;
};

export type HybridCapForensicsSummary = {
  version: typeof HYBRID_CAP_FORENSICS_VERSION;
  observational: true;
  path: "preserve_contract" | "uncapped" | "fast_large_library" | "small_library_era_balanced" | "empty";
  originalCount: number;
  candidateCount: number;
  max: number;
  outputCount: number;
  poolCapped: boolean;
  compoundPrompt: boolean;
  explicitFamilies: string[];
  explicitEra: { start: number; end: number } | null;
  watchIdsRequested: number;
  watchInInput: number;
  watchSurvived: number;
  dropReasonCounts: Partial<Record<HybridCapDropReason, number>>;
  tracks: HybridCapTrackForensic[];
};

export type NumericDistribution = {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
};

export function classifyHybridCapDrop(input: {
  inInput: boolean;
  survived: boolean;
}): HybridCapDropReason {
  if (!input.inInput) return "NOT_IN_HYBRID_INPUT";
  if (input.survived) return "SURVIVED_HYBRID_CAP";
  return "DROPPED_BY_HYBRID_CAP";
}

export function countByDropReason(
  tracks: ReadonlyArray<Pick<HybridCapTrackForensic, "dropReason">>,
): Partial<Record<HybridCapDropReason, number>> {
  const counts: Partial<Record<HybridCapDropReason, number>> = {};
  for (const track of tracks) {
    counts[track.dropReason] = (counts[track.dropReason] ?? 0) + 1;
  }
  return counts;
}

export function numericDistribution(values: readonly number[]): NumericDistribution {
  if (values.length === 0) {
    return { n: 0, min: null, max: null, mean: null, median: null, p25: null, p75: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const at = (p: number): number => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)));
    return sorted[idx]!;
  };
  return {
    n,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean: sum / n,
    median: n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2,
    p25: at(0.25),
    p75: at(0.75),
  };
}

export function intersectIds(
  left: ReadonlySet<string> | readonly string[],
  right: ReadonlySet<string> | readonly string[],
): string[] {
  const rightSet = right instanceof Set ? right : new Set(right);
  const out: string[] = [];
  for (const id of left) {
    if (rightSet.has(id)) out.push(id);
  }
  return out;
}

export function setDiff(
  left: ReadonlySet<string> | readonly string[],
  right: ReadonlySet<string> | readonly string[],
): string[] {
  const rightSet = right instanceof Set ? right : new Set(right);
  const out: string[] = [];
  for (const id of left) {
    if (!rightSet.has(id)) out.push(id);
  }
  return out;
}
