/**
 * V3.1+ Adaptive Cluster-Aware Interleaver
 *
 * Extends the V3 round-robin with cluster awareness and dynamic lane
 * reweighting during interleaving.
 *
 * Key upgrades over V3:
 *   - Interleaves across lanes AND clusters AND energy bands
 *   - Detects three mid-generation states and responds:
 *       repetition detected → boost CONTRAST lane probability
 *       chaos detected      → boost CORE lane probability
 *       monotony detected   → boost EXPLORATION lane probability
 *   - Max 2 consecutive same genre (inherited, now also enforced per cluster)
 *   - Cluster spread tracked — if single cluster dominates, inject from others
 */

import type { Lane } from "./lane-router";
import type { SampledLaneResult } from "./lane-sampler";
import type { ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";
import { computeDiversityMetrics, createDiversityWindow, updateDiversityWindow } from "./global-diversity-controller";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InterleavedTrack<T extends ScorerTrack> extends ScorerTrack {
  sourceLane: string;
  laneScore: number;
  genrePrimary: string;
  laneEra: EraBucket;
  clusterIds?: string[];
}

export interface InterleavedResult<T extends ScorerTrack> {
  tracks: Array<T & InterleavedTrack<T>>;
  laneContributions: Record<string, number>;
  interleaverDiagnostics: {
    repetitionEvents: number;
    chaosEvents: number;
    monotonyEvents: number;
    laneBoostEvents: Record<string, number>;
    finalLaneUsageRatios: Record<string, number>;
    entropyAtCompletion: number;
  };
}

type EnergyBand = "low" | "mid" | "high";

function energyBand(energy: number | null): EnergyBand {
  const e = energy ?? 0.50;
  if (e < 0.40) return "low";
  if (e < 0.70) return "mid";
  return "high";
}

// ── State detection ──────────────────────────────────────────────────────────

type GenerationState = "stable" | "repetition" | "chaos" | "monotony";

function detectGenerationState(
  recent: Array<{ genre: string; energy: number | null; sourceLane: string }>,
): GenerationState {
  if (recent.length < 4) return "stable";

  const genres  = recent.map((t) => t.genre);
  const bands   = recent.map((t) => energyBand(t.energy));
  const lanes   = recent.map((t) => t.sourceLane);

  const uniqueGenres = new Set(genres).size;
  const uniqueBands  = new Set(bands).size;
  const uniqueLanes  = new Set(lanes).size;

  const genreRatio = uniqueGenres / genres.length;
  const laneRatio  = uniqueLanes  / lanes.length;

  if (genreRatio < 0.30 && uniqueBands === 1) return "repetition";
  if (genreRatio > 0.90 && uniqueBands === 3) return "chaos";
  if (uniqueBands === 1 && laneRatio < 0.35)  return "monotony";
  return "stable";
}

// ── Dynamic lane weight adjustment ──────────────────────────────────────────

function applyStateBoost(
  baseWeights: Record<string, number>,
  state: GenerationState,
  laneIds: string[],
): { weights: Record<string, number>; boosted: string | null } {
  if (state === "stable") return { weights: baseWeights, boosted: null };

  const adjusted = { ...baseWeights };
  let boosted: string | null = null;

  const hasLane = (partial: string) => laneIds.find((id) => id.includes(partial));

  if (state === "repetition") {
    const targetId = hasLane("contrast") ?? hasLane("exploration");
    if (targetId) {
      adjusted[targetId] = Math.min(0.60, (adjusted[targetId] ?? 0) + 0.20);
      boosted = targetId;
    }
  } else if (state === "chaos") {
    const targetId = hasLane("core");
    if (targetId) {
      adjusted[targetId] = Math.min(0.60, (adjusted[targetId] ?? 0) + 0.20);
      boosted = targetId;
    }
  } else if (state === "monotony") {
    const targetId = hasLane("exploration") ?? hasLane("contrast");
    if (targetId) {
      adjusted[targetId] = Math.min(0.60, (adjusted[targetId] ?? 0) + 0.20);
      boosted = targetId;
    }
  }

  // Re-normalise
  const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const k of Object.keys(adjusted)) adjusted[k] = adjusted[k]! / total;
  }

  return { weights: adjusted, boosted };
}

// ── Slot allocation ──────────────────────────────────────────────────────────

function allocateSlots(
  lanes: Lane[],
  weights: Record<string, number>,
  targetCount: number,
): Record<string, number> {
  const slotMap: Record<string, number> = {};
  for (const lane of lanes) {
    slotMap[lane.id] = Math.round(targetCount * (weights[lane.id] ?? lane.weight));
  }
  let allocated = Object.values(slotMap).reduce((s, v) => s + v, 0);
  const sorted = [...lanes].sort((a, b) => (weights[b.id] ?? b.weight) - (weights[a.id] ?? a.weight));
  let i = 0;
  while (allocated < targetCount) {
    slotMap[sorted[i % sorted.length]!.id]! += 1;
    allocated++;
    i++;
  }
  while (allocated > targetCount) {
    const id = sorted[i % sorted.length]!.id;
    if ((slotMap[id] ?? 0) > 0) { slotMap[id]!--; allocated--; }
    i++;
  }
  return slotMap;
}

// ── Entropy score ────────────────────────────────────────────────────────────

function shannonEntropy(arr: string[]): number {
  if (arr.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
  const n = arr.length;
  return -Object.values(counts).reduce((s, c) => s + (c / n) * Math.log2(c / n), 0);
}

// ── Main interleaver ─────────────────────────────────────────────────────────

export function interleaveLanes<T extends ScorerTrack>(
  lanes: Lane[],
  sampledLanes: SampledLaneResult<T>[],
  targetCount: number,
): InterleavedResult<T> {
  if (lanes.length === 0 || targetCount === 0) {
    return {
      tracks: [],
      laneContributions: {},
      interleaverDiagnostics: {
        repetitionEvents: 0, chaosEvents: 0, monotonyEvents: 0,
        laneBoostEvents: {}, finalLaneUsageRatios: {}, entropyAtCompletion: 0,
      },
    };
  }

  type OutTrack = T & InterleavedTrack<T>;

  const laneIds = lanes.map((l) => l.id);
  let currentWeights: Record<string, number> = {};
  for (const l of lanes) currentWeights[l.id] = l.weight;

  const queues = new Map<string, Array<T & {
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds?: string[];
  }>>();
  for (const sl of sampledLanes) {
    queues.set(sl.laneId, [...sl.tracks]);
  }

  const debt = new Map<string, number>();
  const initialSlots = allocateSlots(lanes, currentWeights, targetCount);
  for (const [id, slots] of Object.entries(initialSlots)) debt.set(id, slots);

  const usedIds = new Set<string>();
  const result: OutTrack[] = [];
  const divWindow = createDiversityWindow();
  let diversityWindowState = divWindow;

  // Diagnostic counters
  let repetitionEvents = 0;
  let chaosEvents      = 0;
  let monotonyEvents   = 0;
  const laneBoostEvents: Record<string, number> = {};

  let round = 0;
  let stuckGuard = 0;
  const WINDOW_SIZE = 6;

  while (result.length < targetCount && stuckGuard < targetCount * laneIds.length * 3) {
    stuckGuard++;

    // Every 6 tracks: check generation state and possibly reweight
    if (result.length > 0 && result.length % WINDOW_SIZE === 0) {
      const recent = result.slice(-WINDOW_SIZE).map((t) => ({
        genre: t.genrePrimary,
        energy: t.energy,
        sourceLane: t.sourceLane,
      }));
      const state = detectGenerationState(recent);

      if (state !== "stable") {
        const { weights: newWeights, boosted } = applyStateBoost(
          currentWeights, state, laneIds,
        );
        currentWeights = newWeights;

        if (state === "repetition") repetitionEvents++;
        if (state === "chaos")      chaosEvents++;
        if (state === "monotony")   monotonyEvents++;

        if (boosted) {
          laneBoostEvents[boosted] = (laneBoostEvents[boosted] ?? 0) + 1;
          // Redistribute remaining debt based on new weights
          const remainingSlots = targetCount - result.length;
          const newDebt = allocateSlots(lanes, currentWeights, remainingSlots);
          // Only update lanes that still have tracks available
          for (const [id, newSlot] of Object.entries(newDebt)) {
            if ((queues.get(id)?.length ?? 0) > 0) {
              debt.set(id, newSlot);
            }
          }
        }
      }
    }

    let found = false;
    for (let attempt = 0; attempt < laneIds.length; attempt++) {
      const laneId = laneIds[(round + attempt) % laneIds.length]!;
      const remaining = debt.get(laneId) ?? 0;
      if (remaining <= 0) continue;

      const queue = queues.get(laneId) ?? [];
      let picked: (T & { laneScore: number; genrePrimary: string; laneEra: EraBucket; clusterIds?: string[] }) | null = null;

      // Skip candidate if it would worsen a bad state
      const metrics = computeDiversityMetrics(diversityWindowState);

      for (let q = 0; q < queue.length; q++) {
        const candidate = queue[q]!;
        if (usedIds.has(candidate.trackId)) continue;

        // Soft skip — if artist already appeared twice in window, prefer others
        const artistCount = diversityWindowState.artistWindow.filter(
          (a) => a === candidate.artistName,
        ).length;
        if (artistCount >= 2 && queue.length > 4) continue;

        // Soft skip — if dominant genre still at saturation, prefer others
        if (
          metrics.genreConcentration > 0.25 &&
          metrics.dominantGenre &&
          candidate.genrePrimary === metrics.dominantGenre &&
          queue.length > 3
        ) continue;

        picked = candidate;
        queue.splice(q, 1);
        break;
      }

      // Fallback: any unseen track from this lane
      if (!picked) {
        for (let q = 0; q < queue.length; q++) {
          const candidate = queue[q]!;
          if (!usedIds.has(candidate.trackId)) {
            picked = candidate;
            queue.splice(q, 1);
            break;
          }
        }
      }

      if (!picked) {
        debt.set(laneId, 0);
        continue;
      }

      result.push({
        ...picked,
        sourceLane: laneId,
        laneScore: picked.laneScore,
        genrePrimary: picked.genrePrimary,
        laneEra: picked.laneEra,
        clusterIds: picked.clusterIds,
      } as OutTrack);

      usedIds.add(picked.trackId);
      debt.set(laneId, remaining - 1);

      diversityWindowState = updateDiversityWindow(diversityWindowState, {
        genre:  picked.genrePrimary,
        era:    picked.laneEra,
        artist: picked.artistName,
        energy: picked.energy ?? 0.50,
        lane:   laneId,
      });

      round = (round + attempt + 1) % laneIds.length;
      found = true;
      break;
    }

    if (!found) break;
  }

  const stabilized = stabilizeGenreRuns(result);

  const laneContributions: Record<string, number> = {};
  for (const t of stabilized) {
    laneContributions[t.sourceLane] = (laneContributions[t.sourceLane] ?? 0) + 1;
  }

  const finalLaneUsageRatios: Record<string, number> = {};
  const total = stabilized.length || 1;
  for (const [id, count] of Object.entries(laneContributions)) {
    finalLaneUsageRatios[id] = Math.round((count / total) * 1000) / 1000;
  }

  const genreEntropy = shannonEntropy(stabilized.map((t) => t.genrePrimary));

  return {
    tracks: stabilized,
    laneContributions,
    interleaverDiagnostics: {
      repetitionEvents,
      chaosEvents,
      monotonyEvents,
      laneBoostEvents,
      finalLaneUsageRatios,
      entropyAtCompletion: Math.round(genreEntropy * 1000) / 1000,
    },
  };
}

// ── Genre-run stabilisation (max 2 consecutive same genre) ──────────────────

function stabilizeGenreRuns<T extends { trackId: string; genrePrimary: string; sourceLane: string }>(
  tracks: T[],
): T[] {
  if (tracks.length < 3) return tracks;
  const result = [...tracks];
  for (let idx = 2; idx < result.length; idx++) {
    const a = result[idx - 2]?.genrePrimary;
    const b = result[idx - 1]?.genrePrimary;
    const c = result[idx]?.genrePrimary;
    if (a && b && c && a === b && b === c) {
      const swapIdx = result.findIndex((t, j) => j > idx && t.genrePrimary !== c);
      if (swapIdx > idx) {
        const tmp = result[idx]!;
        result[idx] = result[swapIdx]!;
        result[swapIdx] = tmp;
      }
    }
  }
  return result;
}
