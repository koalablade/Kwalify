/**
 * V3.1+ Global Diversity Controller
 *
 * Tracks a rolling window of the last 30 selected tracks and applies
 * soft score penalties when diversity thresholds are exceeded.
 *
 * This is SOFT enforcement only — tracks are never removed from the pool.
 * When thresholds are breached a penalty multiplier (0.55–0.85) is applied
 * to the laneScore of similar candidates, making diverse choices more likely.
 *
 * Tracked dimensions:
 *   genreWindow    — genre of last 30 tracks
 *   eraWindow      — era bucket of last 30 tracks
 *   artistWindow   — artist name (for repeat detection in last 12)
 *   energyWindow   — energy value (for curve slope calculation)
 *   laneWindow     — source lane (for lane saturation detection)
 *
 * Thresholds (soft):
 *   genre  > 20% of window → penalty 0.65
 *   era    > 35% of window → penalty 0.75
 *   artist ≥ 2 in last 12  → penalty 0.55
 *   lane   > 55% of window → penalty 0.80 (adjusted lane weight suggestion)
 */

import type { LaneScoredTrack, ScorerTrack } from "./lane-scorer";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiversityWindow {
  genreWindow:  string[];
  eraWindow:    string[];
  artistWindow: string[];
  energyWindow: number[];
  laneWindow:   string[];
}

export interface DiversityMetrics {
  genreConcentration:   number;
  eraConcentration:     number;
  artistRepeatIndex:    number;
  energyCurveSlope:     number;
  laneSaturation:       number;
  dominantGenre:        string | null;
  dominantEra:          string | null;
  dominantLane:         string | null;
  clusterCollapseIndex: number;
  explorationPressure:  number;
  driftState:           "stable" | "genre_drift" | "era_drift" | "lane_drift" | "artist_collapse" | "multi_drift";
  suggestedLaneBoosts:  Partial<Record<string, number>>;
}

export interface DiversityPenaltyResult<T extends ScorerTrack> {
  scoredTracks: LaneScoredTrack<T>[];
  penaltiesApplied: number;
  penaltyReasons: string[];
}

const WINDOW_SIZE        = 30;
const ARTIST_WINDOW_SIZE = 12;

// ── State creation ───────────────────────────────────────────────────────────

export function createDiversityWindow(): DiversityWindow {
  return {
    genreWindow:  [],
    eraWindow:    [],
    artistWindow: [],
    energyWindow: [],
    laneWindow:   [],
  };
}

// ── Window update ────────────────────────────────────────────────────────────

export function updateDiversityWindow(
  window: DiversityWindow,
  track: {
    genre:  string;
    era:    string;
    artist: string;
    energy: number;
    lane:   string;
  },
): DiversityWindow {
  const push = <T>(arr: T[], val: T, max: number): T[] =>
    [...arr, val].slice(-max);

  return {
    genreWindow:  push(window.genreWindow,  track.genre,  WINDOW_SIZE),
    eraWindow:    push(window.eraWindow,    track.era,    WINDOW_SIZE),
    artistWindow: push(window.artistWindow, track.artist, ARTIST_WINDOW_SIZE),
    energyWindow: push(window.energyWindow, track.energy, WINDOW_SIZE),
    laneWindow:   push(window.laneWindow,   track.lane,   WINDOW_SIZE),
  };
}

// ── Metrics computation ──────────────────────────────────────────────────────

function dominantEntry(arr: string[]): { value: string | null; ratio: number } {
  if (arr.length === 0) return { value: null, ratio: 0 };
  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
  const [value, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return { value, ratio: count / arr.length };
}

function energyCurveSlope(energyWindow: number[]): number {
  if (energyWindow.length < 3) return 0;
  const n = energyWindow.length;
  const last = energyWindow.slice(-Math.min(8, n));
  const first = last.slice(0, Math.floor(last.length / 2));
  const second = last.slice(Math.floor(last.length / 2));
  const avgFirst  = first.reduce((s, v) => s + v, 0)  / first.length;
  const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
  return avgSecond - avgFirst;
}

function artistRepeatIndex(artistWindow: string[]): number {
  if (artistWindow.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const a of artistWindow) counts[a] = (counts[a] ?? 0) + 1;
  const repeats = Object.values(counts).filter((c) => c >= 2).length;
  return repeats / Math.max(1, Object.keys(counts).length);
}

function clusterCollapseIndex(
  genreRatio: number,
  eraRatio: number,
  laneRatio: number,
): number {
  return Math.max(genreRatio * 0.40 + eraRatio * 0.35 + laneRatio * 0.25, 0);
}

function explorationPressure(metrics: {
  genreConcentration: number;
  eraConcentration: number;
  artistRepeatIndex: number;
  clusterCollapseIndex: number;
}): number {
  return Math.min(1,
    metrics.genreConcentration * 0.35 +
    metrics.eraConcentration   * 0.25 +
    metrics.artistRepeatIndex  * 0.20 +
    metrics.clusterCollapseIndex * 0.20,
  );
}

export function computeDiversityMetrics(window: DiversityWindow): DiversityMetrics {
  const genreInfo  = dominantEntry(window.genreWindow);
  const eraInfo    = dominantEntry(window.eraWindow);
  const laneInfo   = dominantEntry(window.laneWindow);
  const slope      = energyCurveSlope(window.energyWindow);
  const artistIdx  = artistRepeatIndex(window.artistWindow);

  const collapseIdx = clusterCollapseIndex(
    genreInfo.ratio,
    eraInfo.ratio,
    laneInfo.ratio,
  );

  const explorationP = explorationPressure({
    genreConcentration: genreInfo.ratio,
    eraConcentration: eraInfo.ratio,
    artistRepeatIndex: artistIdx,
    clusterCollapseIndex: collapseIdx,
  });

  const driftFlags = [
    genreInfo.ratio > 0.20 ? "genre_drift"       : null,
    eraInfo.ratio   > 0.35 ? "era_drift"          : null,
    laneInfo.ratio  > 0.55 ? "lane_drift"         : null,
    artistIdx       > 0.30 ? "artist_collapse"    : null,
  ].filter(Boolean) as string[];

  let driftState: DiversityMetrics["driftState"] = "stable";
  if (driftFlags.length >= 2)         driftState = "multi_drift";
  else if (driftFlags[0])             driftState = driftFlags[0] as DiversityMetrics["driftState"];

  // Build lane boost suggestions when drift detected
  const suggestedLaneBoosts: Partial<Record<string, number>> = {};

  if (genreInfo.ratio > 0.20 || laneInfo.ratio > 0.55) {
    suggestedLaneBoosts["lane_contrast"]    = 0.25;
    suggestedLaneBoosts["lane_exploration"] = 0.20;
  }
  if (artistIdx > 0.30) {
    suggestedLaneBoosts["lane_exploration"] = (suggestedLaneBoosts["lane_exploration"] ?? 0) + 0.15;
  }
  if (Math.abs(slope) > 0.15) {
    if (slope > 0) {
      suggestedLaneBoosts["lane_ambient_fallback"] = 0.20;
    } else {
      suggestedLaneBoosts["lane_motion_high"] = 0.20;
    }
  }

  return {
    genreConcentration:   Math.round(genreInfo.ratio  * 1000) / 1000,
    eraConcentration:     Math.round(eraInfo.ratio    * 1000) / 1000,
    artistRepeatIndex:    Math.round(artistIdx        * 1000) / 1000,
    energyCurveSlope:     Math.round(slope            * 1000) / 1000,
    laneSaturation:       Math.round(laneInfo.ratio   * 1000) / 1000,
    dominantGenre:        genreInfo.value,
    dominantEra:          eraInfo.value,
    dominantLane:         laneInfo.value,
    clusterCollapseIndex: Math.round(collapseIdx      * 1000) / 1000,
    explorationPressure:  Math.round(explorationP     * 1000) / 1000,
    driftState,
    suggestedLaneBoosts,
  };
}

// ── Penalty application ──────────────────────────────────────────────────────

/**
 * Apply soft score penalties to candidates that would worsen diversity.
 * NEVER removes tracks — only multiplies scores downward.
 */
export function applyDiversityPenalties<T extends ScorerTrack>(
  scored: LaneScoredTrack<T>[],
  window: DiversityWindow,
  genreByTrack: (trackId: string) => string,
): DiversityPenaltyResult<T> {
  const metrics = computeDiversityMetrics(window);
  let penaltiesApplied = 0;
  const penaltyReasons: string[] = [];

  const adjusted = scored.map((item) => {
    const genre  = genreByTrack(item.track.trackId);
    const artist = item.track.artistName;
    let multiplier = 1.0;

    if (
      metrics.dominantGenre &&
      genre === metrics.dominantGenre &&
      metrics.genreConcentration > 0.20
    ) {
      multiplier = Math.min(multiplier, 0.65);
      penaltiesApplied++;
      if (!penaltyReasons.includes("genre_concentration")) {
        penaltyReasons.push("genre_concentration");
      }
    }

    if (
      metrics.dominantEra &&
      item.era === metrics.dominantEra &&
      metrics.eraConcentration > 0.35
    ) {
      multiplier = Math.min(multiplier, 0.75);
      penaltiesApplied++;
      if (!penaltyReasons.includes("era_concentration")) {
        penaltyReasons.push("era_concentration");
      }
    }

    const artistCountInWindow = window.artistWindow.filter((a) => a === artist).length;
    if (artistCountInWindow >= 2) {
      multiplier = Math.min(multiplier, 0.55);
      penaltiesApplied++;
      if (!penaltyReasons.includes("artist_repeat")) {
        penaltyReasons.push("artist_repeat");
      }
    }

    if (multiplier < 1.0) {
      return { ...item, laneScore: Math.max(0, item.laneScore * multiplier) };
    }
    return item;
  });

  return { scoredTracks: adjusted, penaltiesApplied, penaltyReasons };
}

// ── Lane weight correction ────────────────────────────────────────────────────

/**
 * Returns adjusted lane weights based on current diversity state.
 * This is the "dynamic reweighting" the spec requires.
 * Never reduces any lane below 5% — always returns normalised weights.
 */
export function computeAdjustedLaneWeights(
  laneWeights: Record<string, number>,
  metrics: DiversityMetrics,
): Record<string, number> {
  if (metrics.driftState === "stable") return laneWeights;

  const adjusted = { ...laneWeights };

  for (const [laneId, boost] of Object.entries(metrics.suggestedLaneBoosts)) {
    if (adjusted[laneId] !== undefined && boost !== undefined) {
      adjusted[laneId] = Math.min(0.60, adjusted[laneId]! + boost);
    }
  }

  const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const key of Object.keys(adjusted)) {
      adjusted[key] = Math.max(0.05, adjusted[key]! / total);
    }
    const newTotal = Object.values(adjusted).reduce((s, v) => s + v, 0);
    for (const key of Object.keys(adjusted)) {
      adjusted[key] = adjusted[key]! / newTotal;
    }
  }

  return adjusted;
}
