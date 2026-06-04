/**
 * V3 Interleaving Engine — spec §6
 *
 * Cross-lane round-robin mixing followed by a final stabilization pass.
 *
 * Interleave order: core → emotional → motion → contrast → core → …
 * Weights: core 40%, emotional 25%, motion 20%, contrast 15%
 *
 * Final stabilization (spec §10):
 *   - No duplicate tracks
 *   - Max 2 consecutive same genre
 */

import type { Lane } from "./lane-router";
import type { SampledLaneResult } from "./lane-sampler";
import type { ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InterleavedTrack<T extends ScorerTrack> extends ScorerTrack {
  sourceLane: string;
  laneScore: number;
  genrePrimary: string;
  laneEra: EraBucket;
}

export interface InterleavedResult<T extends ScorerTrack> {
  tracks: Array<T & InterleavedTrack<T>>;
  laneContributions: Record<string, number>;
}

// ── Interleaver ────────────────────────────────────────────────────────────

export function interleaveLanes<T extends ScorerTrack>(
  lanes: Lane[],
  sampledLanes: SampledLaneResult<T>[],
  targetCount: number
): InterleavedResult<T> {
  if (lanes.length === 0 || targetCount === 0) {
    return { tracks: [], laneContributions: {} };
  }

  // Build per-lane slot allocations — round weight × target
  const slotMap: Record<string, number> = {};
  for (const lane of lanes) {
    slotMap[lane.id] = Math.round(targetCount * lane.weight);
  }

  // Correct rounding drift so total === targetCount
  let allocated = Object.values(slotMap).reduce((s, v) => s + v, 0);
  const sortedByWeight = [...lanes].sort((a, b) => b.weight - a.weight);
  let i = 0;
  while (allocated < targetCount) {
    slotMap[sortedByWeight[i % sortedByWeight.length]!.id]! += 1;
    allocated++;
    i++;
  }
  while (allocated > targetCount) {
    const laneId = sortedByWeight[i % sortedByWeight.length]!.id;
    if ((slotMap[laneId] ?? 0) > 0) {
      slotMap[laneId]! -= 1;
      allocated--;
    }
    i++;
  }

  // Track queues per lane
  const queues = new Map<
    string,
    Array<T & { laneScore: number; genrePrimary: string; laneEra: EraBucket }>
  >();
  for (const sl of sampledLanes) {
    queues.set(sl.laneId, [...sl.tracks]);
  }

  // Remaining slot debt per lane
  const debt = new Map<string, number>();
  for (const [laneId, slots] of Object.entries(slotMap)) {
    debt.set(laneId, slots);
  }

  const usedIds = new Set<string>();

  type OutTrack = T & InterleavedTrack<T>;
  const result: OutTrack[] = [];
  const laneOrder = lanes.map((l) => l.id);
  let round = 0;
  let stuckGuard = 0;

  while (result.length < targetCount && stuckGuard < targetCount * laneOrder.length * 2) {
    stuckGuard++;

    // Find a lane that still has debt + tracks
    let found = false;
    for (let attempt = 0; attempt < laneOrder.length; attempt++) {
      const laneId = laneOrder[(round + attempt) % laneOrder.length]!;
      const remaining = debt.get(laneId) ?? 0;
      if (remaining <= 0) continue;

      const queue = queues.get(laneId) ?? [];
      let picked: (T & { laneScore: number; genrePrimary: string; laneEra: EraBucket }) | null = null;

      for (let q = 0; q < queue.length; q++) {
        const candidate = queue[q]!;
        if (!usedIds.has(candidate.trackId)) {
          picked = candidate;
          queue.splice(q, 1);
          break;
        }
      }

      if (!picked) {
        // Lane exhausted — zero its debt and skip
        debt.set(laneId, 0);
        continue;
      }

      result.push({
        ...picked,
        sourceLane: laneId,
        laneScore: picked.laneScore,
        genrePrimary: picked.genrePrimary,
        laneEra: picked.laneEra,
      } as OutTrack);
      usedIds.add(picked.trackId);
      debt.set(laneId, remaining - 1);
      round = (round + attempt + 1) % laneOrder.length;
      found = true;
      break;
    }

    if (!found) {
      // All lanes exhausted — stop
      break;
    }
  }

  // ── Final stabilization: max 2 consecutive same genre ────────────────────
  const stabilized = stabilizeGenreRuns(result);

  // ── Lane contribution counts ──────────────────────────────────────────────
  const laneContributions: Record<string, number> = {};
  for (const t of stabilized) {
    laneContributions[t.sourceLane] = (laneContributions[t.sourceLane] ?? 0) + 1;
  }

  return { tracks: stabilized, laneContributions };
}

// ── Stabilization ─────────────────────────────────────────────────────────

function stabilizeGenreRuns<T extends { trackId: string; genrePrimary: string; sourceLane: string }>(
  tracks: T[]
): T[] {
  if (tracks.length < 3) return tracks;

  const result = [...tracks];

  for (let idx = 2; idx < result.length; idx++) {
    const a = result[idx - 2]?.genrePrimary;
    const b = result[idx - 1]?.genrePrimary;
    const c = result[idx]?.genrePrimary;

    if (a && b && c && a === b && b === c) {
      // Scan forward for the nearest track with a different genre
      const swapIdx = result.findIndex(
        (t, j) => j > idx && t.genrePrimary !== c
      );
      if (swapIdx > idx) {
        const tmp = result[idx]!;
        result[idx] = result[swapIdx]!;
        result[swapIdx] = tmp;
      }
    }
  }

  return result;
}
