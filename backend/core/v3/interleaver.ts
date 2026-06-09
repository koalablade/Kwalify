/**
 * V3.1+ Cluster-Aware Interleaver
 *
 * Merges already-sampled lanes into a listening order. It does not rescore,
 * filter, boost, or replace tracks selected by the sampler.
 */

import type { Lane } from "./lane-router";
import type { ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InterleavedTrack<T extends ScorerTrack> extends ScorerTrack {
  sourceLane: string;
  laneScore: number;
  genrePrimary: string;
  laneEra: EraBucket;
  clusterIds: string[];
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

export interface InterleavableLaneResult<T extends ScorerTrack> {
  laneId: string;
  tracks: Array<T & {
    sourceLane: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>;
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
  sampledLanes: InterleavableLaneResult<T>[],
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
  const laneWeights: Record<string, number> = {};
  for (const l of lanes) laneWeights[l.id] = l.weight;

  const queues = new Map<string, Array<T & {
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>>();
  for (const sl of sampledLanes) {
    queues.set(sl.laneId, [...sl.tracks]);
  }

  const debt = new Map<string, number>();
  const initialSlots = allocateSlots(lanes, laneWeights, targetCount);
  for (const [id, slots] of Object.entries(initialSlots)) debt.set(id, slots);

  const usedIds = new Set<string>();
  const result: OutTrack[] = [];

  let round = 0;
  let stuckGuard = 0;

  while (result.length < targetCount && stuckGuard < targetCount * laneIds.length * 3) {
    stuckGuard++;

    let found = false;
    for (let attempt = 0; attempt < laneIds.length; attempt++) {
      const laneId = laneIds[(round + attempt) % laneIds.length]!;
      const remaining = debt.get(laneId) ?? 0;
      if (remaining <= 0) continue;

      const queue = queues.get(laneId) ?? [];
      let picked: (T & { laneScore: number; genrePrimary: string; laneEra: EraBucket; clusterIds: string[] }) | null = null;

      for (let q = 0; q < queue.length; q++) {
        const candidate = queue[q]!;
        if (usedIds.has(candidate.trackId)) continue;

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
      round = (round + attempt + 1) % laneIds.length;
      found = true;
      break;
    }

    if (!found) break;
  }

  const laneContributions: Record<string, number> = {};
  for (const t of result) {
    laneContributions[t.sourceLane] = (laneContributions[t.sourceLane] ?? 0) + 1;
  }

  const finalLaneUsageRatios: Record<string, number> = {};
  const total = result.length || 1;
  for (const [id, count] of Object.entries(laneContributions)) {
    finalLaneUsageRatios[id] = Math.round((count / total) * 1000) / 1000;
  }

  const genreEntropy = shannonEntropy(result.map((t) => t.genrePrimary));

  return {
    tracks: result,
    laneContributions,
    interleaverDiagnostics: {
      repetitionEvents: 0,
      chaosEvents: 0,
      monotonyEvents: 0,
      laneBoostEvents: {},
      finalLaneUsageRatios,
      entropyAtCompletion: Math.round(genreEntropy * 1000) / 1000,
    },
  };
}
