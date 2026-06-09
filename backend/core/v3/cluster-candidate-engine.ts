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
 * Entropy constraints are consumed by the V3 sampler:
 *   ≥ 3 distinct genre clusters represented
 *   ≥ 2 distinct era clusters represented
 *   ≥ 2 distinct energy bands represented
 *   ≤ 55–75% from dominant musical clusters
 */

import type { ScorerTrack } from "./lane-scorer";
import { withDecisionClusters, type TrackDecision } from "./track-decision";

// ── Types ───────────────────────────────────────────────────────────────────

export type EnergyBand = "low" | "mid" | "high";
export type MoodQuadrant = "high_energy_positive" | "high_energy_negative" | "low_energy_positive" | "low_energy_negative";

export interface TrackCluster {
  clusterId: string;
  dimension: "genre" | "era" | "energy" | "mood";
  value: string;
  trackIds: Set<string>;
  diversityContributionScore: number;
  size: number;
}

export interface ClusteredPool<T extends ScorerTrack> {
  clusters: Map<string, TrackCluster>;
  trackToClusterIds: Map<string, string[]>;
  scoredTracks: Array<TrackDecision<T>>;
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
): number {
  const representationRatio = clusterSize / Math.max(1, totalTracks);
  const rarityBonus = Math.max(0, 1 - representationRatio * 3);
  return Math.min(1, rarityBonus);
}

// ── Build clusters ────────────────────────────────────────────────────────────

export function buildClusters<T extends ScorerTrack>(
  scored: Array<TrackDecision<T>>,
): ClusteredPool<T> {
  const total = scored.length;
  const clusterMap = new Map<string, TrackCluster>();
  const trackToClusterIds = new Map<string, string[]>();

  for (const item of scored) {
    const t = item.track;
    const genre  = item.genrePrimary ?? "unknown";
    const era    = item.laneEra;
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
          diversityContributionScore: 0,
          size: 0,
        });
      }

      const cluster = clusterMap.get(cid)!;
      cluster.trackIds.add(t.trackId);
    }

    trackToClusterIds.set(t.trackId, trackClusters);
  }

  for (const [cid, cluster] of clusterMap) {
    cluster.size  = cluster.trackIds.size;
    cluster.diversityContributionScore = computeDiversityContribution(
      cluster.size,
      total,
    );
  }

  return {
    clusters: clusterMap,
    trackToClusterIds,
    scoredTracks: scored.map((decision) =>
      withDecisionClusters(decision, trackToClusterIds.get(decision.track.trackId) ?? [])
    ),
  };
}
