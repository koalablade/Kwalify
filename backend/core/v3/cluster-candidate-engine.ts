/**
 * V3.1+ Cluster Candidate Engine
 *
 * Groups scored tracks into multi-dimensional clusters BEFORE selection.
 * Selection then happens across clusters (not raw ranking), preventing
 * the "hidden collapse" that occurs when top-ranked tracks share a genre/era.
 *
 * Cluster dimensions:
 *   genre   — primary genre label
 *   era     — decade bucket
 *   energy  — three-band (low/mid/high)
 *   mood    — derived from valence + energy quadrant
 *
 * Entropy constraints enforced by selectFromClusters():
 *   ≥ 3 distinct genre clusters represented
 *   ≥ 2 distinct era clusters represented
 *   ≥ 2 distinct energy bands represented
 *   ≤ 30–40% from any single cluster
 */

import type { LaneScoredTrack, ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";
import { getGenreFamily } from "./global-diversity-controller";

// ── Types ───────────────────────────────────────────────────────────────────

export type EnergyBand = "low" | "mid" | "high";
export type MoodQuadrant = "high_energy_positive" | "high_energy_negative" | "low_energy_positive" | "low_energy_negative";

export interface TrackCluster {
  clusterId: string;
  dimension: "genre" | "era" | "energy" | "mood";
  value: string;
  trackIds: Set<string>;
  avgScore: number;
  diversityContributionScore: number;
  size: number;
}

export interface ClusteredPool<T extends ScorerTrack> {
  clusters: Map<string, TrackCluster>;
  trackToClusterIds: Map<string, string[]>;
  scoredTracks: LaneScoredTrack<T>[];
}

export interface ClusterSelectionResult<T extends ScorerTrack> {
  tracks: Array<T & {
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>;
  clusterSpread: {
    genreClusters: number;
    eraClusters: number;
    energyBands: number;
    moodQuadrants: number;
  };
  clusterSelectionRatios: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function energyBand(energy: number | null): EnergyBand {
  const e = energy ?? 0.50;
  if (e < 0.40) return "low";
  if (e < 0.70) return "mid";
  return "high";
}

function moodQuadrant(energy: number | null, valence: number | null): MoodQuadrant {
  const e = energy ?? 0.50;
  const v = valence ?? 0.50;
  if (e >= 0.50 && v >= 0.50) return "high_energy_positive";
  if (e >= 0.50 && v <  0.50) return "high_energy_negative";
  if (e <  0.50 && v >= 0.50) return "low_energy_positive";
  return "low_energy_negative";
}

function clusterId(dimension: string, value: string): string {
  return `${dimension}:${value}`;
}

// ── Diversity contribution score ─────────────────────────────────────────────

/**
 * How much a cluster contributes to global diversity.
 * Smaller clusters with distinctive profiles score higher.
 * This biases selection toward under-represented groups.
 */
function computeDiversityContribution(
  clusterSize: number,
  totalTracks: number,
  avgScore: number,
): number {
  const representationRatio = clusterSize / Math.max(1, totalTracks);
  const rarityBonus = Math.max(0, 1 - representationRatio * 3);
  return Math.min(1, avgScore * 0.60 + rarityBonus * 0.40);
}

// ── Build clusters ────────────────────────────────────────────────────────────

export function buildClusters<T extends ScorerTrack>(
  scored: LaneScoredTrack<T>[],
): ClusteredPool<T> {
  const total = scored.length;
  const clusterMap = new Map<string, TrackCluster>();
  const trackToClusterIds = new Map<string, string[]>();

  for (const item of scored) {
    const t = item.track;
    const genre  = item.genrePrimary ?? "unknown";
    const era    = item.era;
    const band   = energyBand(t.energy);
    const mood   = moodQuadrant(t.energy, t.valence);

    const dims: Array<{ dimension: "genre" | "era" | "energy" | "mood"; value: string }> = [
      { dimension: "genre",  value: genre },
      { dimension: "era",    value: era },
      { dimension: "energy", value: band },
      { dimension: "mood",   value: mood },
    ];

    const trackClusters: string[] = [];

    for (const { dimension, value } of dims) {
      const cid = clusterId(dimension, value);
      trackClusters.push(cid);

      if (!clusterMap.has(cid)) {
        clusterMap.set(cid, {
          clusterId: cid,
          dimension,
          value,
          trackIds: new Set(),
          avgScore: 0,
          diversityContributionScore: 0,
          size: 0,
        });
      }

      const cluster = clusterMap.get(cid)!;
      cluster.trackIds.add(t.trackId);
    }

    trackToClusterIds.set(t.trackId, trackClusters);
  }

  // Compute avgScore per cluster (using laneScore)
  const scoreAccum = new Map<string, { sum: number; count: number }>();
  for (const item of scored) {
    for (const cid of trackToClusterIds.get(item.track.trackId) ?? []) {
      const acc = scoreAccum.get(cid) ?? { sum: 0, count: 0 };
      acc.sum   += item.laneScore;
      acc.count += 1;
      scoreAccum.set(cid, acc);
    }
  }

  for (const [cid, cluster] of clusterMap) {
    const acc = scoreAccum.get(cid) ?? { sum: 0, count: 0 };
    cluster.size  = cluster.trackIds.size;
    cluster.avgScore = acc.count > 0 ? acc.sum / acc.count : 0;
    cluster.diversityContributionScore = computeDiversityContribution(
      cluster.size,
      total,
      cluster.avgScore,
    );
  }

  return { clusters: clusterMap, trackToClusterIds, scoredTracks: scored };
}

// ── Entropy-constrained selection ────────────────────────────────────────────

/**
 * Selects tracks from the clustered pool enforcing minimum cluster spread.
 *
 * Hard rules (soft enforcement — penalty, not removal):
 *   ≥ 3 distinct genre clusters if pool has ≥ 3
 *   ≥ 2 distinct era clusters if pool has ≥ 2
 *   ≥ 2 distinct energy bands if pool has ≥ 2
 *   ≤ 35% from any single genre cluster
 *   ≤ 40% from any single era cluster
 *   ≤ 50% from any single energy band
 */
export function selectFromClusters<T extends ScorerTrack>(
  pool: ClusteredPool<T>,
  targetCount: number,
  laneId: string,
): ClusterSelectionResult<T> {
  const { scoredTracks, trackToClusterIds, clusters } = pool;

  if (scoredTracks.length === 0) {
    return {
      tracks: [],
      clusterSpread: { genreClusters: 0, eraClusters: 0, energyBands: 0, moodQuadrants: 0 },
      clusterSelectionRatios: {},
    };
  }

  // Max selection per cluster
  const genreMax   = Math.max(1, Math.ceil(targetCount * 0.35));
  const eraMax     = Math.max(1, Math.ceil(targetCount * 0.40));
  const energyMax  = Math.max(1, Math.ceil(targetCount * 0.50));
  // Family-level cap: no genre family (e.g. all country subgenres combined)
  // may exceed 40% of the selected tracks. Prevents "hidden collapse" where
  // country, americana, outlaw_country each pass the per-cluster cap.
  const familyMax  = Math.max(1, Math.ceil(targetCount * 0.40));

  const clusterPickCount = new Map<string, number>();
  const familyPickCount  = new Map<string, number>();
  const usedIds = new Set<string>();

  type OutTrack = T & {
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  };

  const selected: OutTrack[] = [];

  // Compute cluster diversity pressure — smaller clusters selected first
  const sortedByDiversityPressure = [...scoredTracks].sort((a, b) => {
    const aContrib = Math.max(
      ...(trackToClusterIds.get(a.track.trackId) ?? [])
        .map((cid) => clusters.get(cid)?.diversityContributionScore ?? 0)
    );
    const bContrib = Math.max(
      ...(trackToClusterIds.get(b.track.trackId) ?? [])
        .map((cid) => clusters.get(cid)?.diversityContributionScore ?? 0)
    );
    // Blend: 60% lane score + 40% diversity pressure
    const aBlend = a.laneScore * 0.60 + aContrib * 0.40;
    const bBlend = b.laneScore * 0.60 + bContrib * 0.40;
    return bBlend - aBlend;
  });

  // ── Pass 1: strict cluster constraints ──────────────────────────────────
  for (const item of sortedByDiversityPressure) {
    if (selected.length >= targetCount) break;
    if (usedIds.has(item.track.trackId)) continue;

    const cids = trackToClusterIds.get(item.track.trackId) ?? [];
    const genreCid  = cids.find((c) => c.startsWith("genre:"));
    const eraCid    = cids.find((c) => c.startsWith("era:"));
    const energyCid = cids.find((c) => c.startsWith("energy:"));

    const genreViolation  = genreCid  && (clusterPickCount.get(genreCid)  ?? 0) >= genreMax;
    const eraViolation    = eraCid    && (clusterPickCount.get(eraCid)    ?? 0) >= eraMax;
    const energyViolation = energyCid && (clusterPickCount.get(energyCid) ?? 0) >= energyMax;

    // Family-level cap: e.g. country + americana + outlaw_country share one budget
    const genreFamily     = getGenreFamily(item.genrePrimary ?? "unknown");
    const familyViolation = (familyPickCount.get(genreFamily) ?? 0) >= familyMax;

    if (genreViolation || eraViolation || energyViolation || familyViolation) continue;

    selected.push({
      ...item.track,
      laneScore: item.laneScore,
      genrePrimary: item.genrePrimary,
      laneEra: item.era,
      clusterIds: cids,
    });
    usedIds.add(item.track.trackId);
    for (const cid of cids) {
      clusterPickCount.set(cid, (clusterPickCount.get(cid) ?? 0) + 1);
    }
    familyPickCount.set(genreFamily, (familyPickCount.get(genreFamily) ?? 0) + 1);
  }

  // ── Pass 2: backfill — relax constraints if short ───────────────────────
  if (selected.length < targetCount) {
    for (const item of scoredTracks) {
      if (selected.length >= targetCount) break;
      if (usedIds.has(item.track.trackId)) continue;
      const cids = trackToClusterIds.get(item.track.trackId) ?? [];
      selected.push({
        ...item.track,
        laneScore: item.laneScore,
        genrePrimary: item.genrePrimary,
        laneEra: item.era,
        clusterIds: cids,
      });
      usedIds.add(item.track.trackId);
    }
  }

  // ── Compute cluster spread stats ─────────────────────────────────────────
  const seenGenres  = new Set<string>();
  const seenEras    = new Set<string>();
  const seenEnergy  = new Set<string>();
  const seenMoods   = new Set<string>();

  for (const t of selected) {
    for (const cid of t.clusterIds) {
      if (cid.startsWith("genre:"))  seenGenres.add(cid);
      if (cid.startsWith("era:"))    seenEras.add(cid);
      if (cid.startsWith("energy:")) seenEnergy.add(cid);
      if (cid.startsWith("mood:"))   seenMoods.add(cid);
    }
  }

  const clusterSelectionRatios: Record<string, number> = {};
  for (const [cid, count] of clusterPickCount) {
    clusterSelectionRatios[cid] = Math.round((count / selected.length) * 1000) / 1000;
  }

  return {
    tracks: selected,
    clusterSpread: {
      genreClusters:  seenGenres.size,
      eraClusters:    seenEras.size,
      energyBands:    seenEnergy.size,
      moodQuadrants:  seenMoods.size,
    },
    clusterSelectionRatios,
  };
}
