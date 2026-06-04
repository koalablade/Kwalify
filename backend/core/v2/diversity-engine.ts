/**
 * V2 Diversity Engine — greedy selection with streak-based score decay.
 *
 * Applied POST-ranking only (NOT during scoring, NOT as a filter).
 * Prevents genre collapse and ensures multi-era / multi-artist distribution.
 *
 * Absolute rules (V2 spec):
 *   - NEVER removes tracks
 *   - NEVER filters before scoring
 *   - All diversity logic is post-score only
 *
 * Streak penalties (V2 spec):
 *   genreStreak > 3: score × 0.70
 *   genreStreak > 5: score × 0.55
 *   eraStreak > 4:   score × 0.65
 *   artistRepeat > 1: score × 0.40
 */

import type { EraBucket } from "../../lib/intent-parser";

export interface DiversityCandidate {
  trackId: string;
  artistName: string;
  score: number;
  era: EraBucket;
  genrePrimary: string;
}

interface SelectionState {
  genreStreak: number;
  currentGenre: string;
  eraStreak: number;
  currentEra: EraBucket;
  artistCounts: Map<string, number>;
}

function computeStreakMultiplier(
  candidate: DiversityCandidate,
  state: SelectionState
): number {
  let multiplier = 1.0;

  // ── Genre streak ────────────────────────────────────────────────────────────
  if (candidate.genrePrimary === state.currentGenre) {
    const newStreak = state.genreStreak + 1;
    if (newStreak > 5) multiplier *= 0.55;
    else if (newStreak > 3) multiplier *= 0.70;
  }

  // ── Era streak ──────────────────────────────────────────────────────────────
  if (candidate.era === state.currentEra && candidate.era !== "any") {
    const newEraStreak = state.eraStreak + 1;
    if (newEraStreak > 4) multiplier *= 0.65;
  }

  // ── Artist repetition ───────────────────────────────────────────────────────
  const artistCount = state.artistCounts.get(candidate.artistName.toLowerCase()) ?? 0;
  if (artistCount >= 1) multiplier *= 0.40;

  return multiplier;
}

function updateState(state: SelectionState, picked: DiversityCandidate): void {
  // Genre streak
  if (picked.genrePrimary === state.currentGenre) {
    state.genreStreak += 1;
  } else {
    state.genreStreak = 1;
    state.currentGenre = picked.genrePrimary;
  }

  // Era streak
  if (picked.era === state.currentEra && picked.era !== "any") {
    state.eraStreak += 1;
  } else {
    state.eraStreak = 1;
    state.currentEra = picked.era;
  }

  // Artist count
  const key = picked.artistName.toLowerCase();
  state.artistCounts.set(key, (state.artistCounts.get(key) ?? 0) + 1);
}

/**
 * Greedy diversity selection.
 *
 * Selects `targetCount` tracks from the ranked pool while applying
 * streak penalties to discourage genre/era/artist clustering.
 *
 * Returns the selected set, in selection order.
 * Remaining pool members (not selected) are also returned for the discovery bucket.
 */
export function greedyDiversitySelection<T extends DiversityCandidate>(
  rankedPool: T[],
  targetCount: number
): { selected: T[]; remaining: T[] } {
  if (rankedPool.length === 0) return { selected: [], remaining: [] };

  const remaining = [...rankedPool];
  const selected: T[] = [];

  const state: SelectionState = {
    genreStreak: 0,
    currentGenre: "",
    eraStreak: 0,
    currentEra: "any",
    artistCounts: new Map(),
  };

  while (selected.length < targetCount && remaining.length > 0) {
    // Find track with highest diversity-adjusted score
    let bestIdx = 0;
    let bestAdjustedScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const multiplier = computeStreakMultiplier(candidate, state);
      const adjustedScore = candidate.score * multiplier;

      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIdx = i;
      }
    }

    const picked = remaining[bestIdx]!;
    selected.push(picked);
    remaining.splice(bestIdx, 1);
    updateState(state, picked);
  }

  return { selected, remaining };
}

/**
 * V2 Diversity Engine entry point.
 *
 * Applies greedy streak-based diversity selection to produce a balanced playlist.
 * Returns the selected tracks in diversity-optimized order.
 */
export function applyV2Diversity<T extends DiversityCandidate>(
  scoredTracks: T[],
  targetCount: number
): T[] {
  // Sort descending by raw score before applying streak penalties
  const sorted = [...scoredTracks].sort((a, b) => b.score - a.score);
  const { selected } = greedyDiversitySelection(sorted, targetCount);
  return selected;
}
