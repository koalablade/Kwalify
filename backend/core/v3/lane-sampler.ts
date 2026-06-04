/**
 * V3 Lane Sampler — spec §7 (structural diversity)
 *
 * Selects tracks from a lane's scored pool while enforcing hard per-lane caps:
 *   ≤ 35% same genre
 *   ≤ 50% same energy band  (low < 0.40, mid 0.40–0.70, high ≥ 0.70)
 *   ≤ 60% same era
 *
 * This makes diversity STRUCTURAL — collapse is mathematically impossible
 * within any lane regardless of scoring.
 */

import type { LaneScoredTrack } from "./lane-scorer";
import type { ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SampledLaneResult<T extends ScorerTrack> {
  laneId: string;
  tracks: Array<T & { laneScore: number; genrePrimary: string; laneEra: EraBucket }>;
}

type EnergyBand = "low" | "mid" | "high";

function energyBand(energy: number | null): EnergyBand {
  const e = energy ?? 0.50;
  if (e < 0.40) return "low";
  if (e < 0.70) return "mid";
  return "high";
}

// ── Sampler ────────────────────────────────────────────────────────────────

export function sampleLane<T extends ScorerTrack>(
  scored: LaneScoredTrack<T>[],
  laneId: string,
  targetCount: number
): SampledLaneResult<T> {
  if (scored.length === 0) return { laneId, tracks: [] };

  const genreMax  = Math.max(1, Math.ceil(targetCount * 0.35));
  const energyMax = Math.max(1, Math.ceil(targetCount * 0.50));
  const eraMax    = Math.max(1, Math.ceil(targetCount * 0.60));

  const genreCount:  Record<string, number>     = {};
  const energyCount: Record<EnergyBand, number> = { low: 0, mid: 0, high: 0 };
  const eraCount:    Record<string, number>      = {};
  const usedIds = new Set<string>();

  type SelectedTrack = T & { laneScore: number; genrePrimary: string; laneEra: EraBucket };
  const selected: SelectedTrack[] = [];

  // ── Pass 1: strict hard constraints ──────────────────────────────────────
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    if (usedIds.has(item.track.trackId)) continue;

    const genre = item.genrePrimary;
    const band  = energyBand(item.track.energy);
    const era   = item.era;

    const genreViolation  = genre !== "unknown" && (genreCount[genre] ?? 0) >= genreMax;
    const energyViolation = energyCount[band] >= energyMax;
    const eraViolation    = (eraCount[era] ?? 0) >= eraMax;

    if (genreViolation || energyViolation || eraViolation) continue;

    selected.push({ ...item.track, laneScore: item.laneScore, genrePrimary: genre, laneEra: era });
    usedIds.add(item.track.trackId);
    genreCount[genre]  = (genreCount[genre]  ?? 0) + 1;
    energyCount[band] += 1;
    eraCount[era]      = (eraCount[era]      ?? 0) + 1;
  }

  // ── Pass 2: backfill — relax constraints if still short ──────────────────
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      if (usedIds.has(item.track.trackId)) continue;
      selected.push({
        ...item.track,
        laneScore: item.laneScore,
        genrePrimary: item.genrePrimary,
        laneEra: item.era,
      });
      usedIds.add(item.track.trackId);
    }
  }

  return { laneId, tracks: selected };
}
