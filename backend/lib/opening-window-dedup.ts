/**
 * Session-scoped opening-window deduplication (positions 1–10).
 *
 * Reorder-only: fatigued opener tracks may move to the tail but are not removed.
 * Soft penalty first; hard swap only when reasonable alternatives exist.
 */

export const OPENING_DEDUP_WINDOW_SIZE = 10;

export type OpeningWindowHistory = {
  trackAppearanceCount: Map<string, number>;
  openingWindowHistorySize: number;
};

export type OpenerNoveltyDiagnostics = {
  previousOpeningAppearances: Record<string, number>;
  openerPenaltyApplied: Record<string, number>;
  openerReplacementCount: number;
  relaxedDueToSupply: boolean;
  openingWindowHistorySize: number;
};

export type OpeningWindowDedupOpts = {
  /** Thin-library or honest-partial — relax hard exclusions */
  thinLibraryRelaxed?: boolean;
  /** Tie-break alternatives by trackId for audit reproducibility */
  auditDeterministic?: boolean;
  scoreFn?: (track: { trackId: string; score?: number }) => number;
  /** Minimum tail candidates before hard exclusion */
  minAlternativesForHardExclude?: number;
};

function defaultScore(track: { trackId: string; score?: number }): number {
  return typeof track.score === "number" ? track.score : 0.5;
}

export function buildOpeningWindowHistory(priorPlaylistTrackLists: string[][]): OpeningWindowHistory {
  const trackAppearanceCount = new Map<string, number>();
  let openingWindowHistorySize = 0;

  for (const ids of priorPlaylistTrackLists) {
    const opening = ids.slice(0, OPENING_DEDUP_WINDOW_SIZE).filter((id) => id.trim().length > 0);
    if (opening.length === 0) continue;
    openingWindowHistorySize += 1;
    for (const id of opening) {
      trackAppearanceCount.set(id, (trackAppearanceCount.get(id) ?? 0) + 1);
    }
  }

  return { trackAppearanceCount, openingWindowHistorySize };
}

function openerPenaltyTier(priorAppearances: number): number {
  if (priorAppearances <= 0) return 0;
  if (priorAppearances === 1) return 0.12;
  if (priorAppearances === 2) return 0.22;
  return 0.35;
}

function maxQualityGap(priorAppearances: number, hardExclude: boolean): number {
  if (hardExclude) return priorAppearances >= 2 ? 0.22 : 0.10;
  if (priorAppearances === 1) return 0.05;
  return 0.08;
}

function compareAlternatives<T extends { trackId: string }>(
  a: { index: number; track: T; score: number },
  b: { index: number; track: T; score: number },
  deterministic: boolean,
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (deterministic) return a.track.trackId.localeCompare(b.track.trackId);
  return a.index - b.index;
}

export function applyOpeningWindowDedup<T extends { trackId: string; score?: number }>(
  tracks: T[],
  history: OpeningWindowHistory,
  opts?: OpeningWindowDedupOpts,
): { tracks: T[]; diagnostics: OpenerNoveltyDiagnostics } {
  const scoreFn = opts?.scoreFn ?? defaultScore;
  const deterministic = opts?.auditDeterministic === true;
  const minAlternatives = opts?.minAlternativesForHardExclude ?? 3;
  const thinRelaxed = opts?.thinLibraryRelaxed === true;

  const emptyDiagnostics: OpenerNoveltyDiagnostics = {
    previousOpeningAppearances: {},
    openerPenaltyApplied: {},
    openerReplacementCount: 0,
    relaxedDueToSupply: thinRelaxed,
    openingWindowHistorySize: history.openingWindowHistorySize,
  };

  if (tracks.length < 2 || history.openingWindowHistorySize === 0) {
    return { tracks: [...tracks], diagnostics: emptyDiagnostics };
  }

  const result = [...tracks];
  const windowEnd = Math.min(OPENING_DEDUP_WINDOW_SIZE, result.length);
  const tailStart = OPENING_DEDUP_WINDOW_SIZE;

  const tailCandidates = result
    .map((track, index) => ({ track, index, score: scoreFn(track) }))
    .filter((row) => row.index >= tailStart || row.index >= windowEnd);

  const freshTailCount = tailCandidates.filter(
    (row) => (history.trackAppearanceCount.get(row.track.trackId) ?? 0) === 0,
  ).length;

  const relaxedDueToSupply =
    thinRelaxed || result.length < OPENING_DEDUP_WINDOW_SIZE + 2 || freshTailCount < minAlternatives;

  const previousOpeningAppearances: Record<string, number> = {};
  const openerPenaltyApplied: Record<string, number> = {};
  let openerReplacementCount = 0;

  for (let i = 0; i < windowEnd; i += 1) {
    const current = result[i]!;
    const priorCount = history.trackAppearanceCount.get(current.trackId) ?? 0;
    if (priorCount <= 0) continue;

    previousOpeningAppearances[current.trackId] = priorCount;
    const penalty = openerPenaltyTier(priorCount);
    openerPenaltyApplied[current.trackId] = penalty;

    const currentScore = scoreFn(current);
    const hardExclude = !relaxedDueToSupply && freshTailCount >= minAlternatives && priorCount >= 1;
    const gap = maxQualityGap(priorCount, hardExclude);

    const alternatives: Array<{ index: number; track: T; score: number }> = [];

    for (let j = tailStart; j < result.length; j += 1) {
      const candidate = result[j]!;
      if ((history.trackAppearanceCount.get(candidate.trackId) ?? 0) > 0) continue;
      const score = scoreFn(candidate);
      if (score >= currentScore - gap) {
        alternatives.push({ index: j, track: candidate, score });
      }
    }

    for (let j = i + 1; j < windowEnd; j += 1) {
      const candidate = result[j]!;
      if ((history.trackAppearanceCount.get(candidate.trackId) ?? 0) > 0) continue;
      const score = scoreFn(candidate);
      if (score >= currentScore - gap) {
        alternatives.push({ index: j, track: candidate, score });
      }
    }

    if (alternatives.length === 0) continue;

    alternatives.sort((a, b) => compareAlternatives(a, b, deterministic));
    const best = alternatives[0]!;

    if (!hardExclude && priorCount === 1 && best.score < currentScore - 0.05) {
      continue;
    }

    const swapIndex = best.index;
    result[i] = best.track;
    result[swapIndex] = current;
    openerReplacementCount += 1;
  }

  return {
    tracks: result,
    diagnostics: {
      previousOpeningAppearances,
      openerPenaltyApplied,
      openerReplacementCount,
      relaxedDueToSupply,
      openingWindowHistorySize: history.openingWindowHistorySize,
    },
  };
}
