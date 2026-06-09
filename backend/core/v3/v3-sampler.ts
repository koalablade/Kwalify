/**
 * V3 sampler: the only place where V3 selection randomness is allowed.
 *
 * Input is already scored and constraint-filtered. This module only chooses a
 * diverse subset from that valid pool; it does not score, repair, or filter.
 */

import type { EraBucket } from "../../lib/intent-parser";
import type { ScorerTrack } from "./lane-scorer";
import type { ClusteredPool } from "./cluster-candidate-engine";
import { getGenreFamily } from "./global-diversity-controller";
import { withDecisionWeight, type TrackDecision } from "./track-decision";

export interface SampledLaneResult<T extends ScorerTrack> {
  laneId: string;
  tracks: Array<T & {
    sourceLane: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>;
}

export interface ClusterSelectionResult<T extends ScorerTrack> {
  tracks: SampledLaneResult<T>["tracks"];
  clusterSpread: {
    genreClusters: number;
    eraClusters: number;
    energyBands: number;
    moodQuadrants: number;
  };
  clusterSelectionRatios: Record<string, number>;
}

function seededUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

export function selectFromClusters<T extends ScorerTrack>(
  pool: ClusteredPool<T>,
  targetCount: number,
  laneId: string,
  seed = "v3-selection",
): ClusterSelectionResult<T> {
  const { scoredTracks, trackToClusterIds, clusters } = pool;

  if (scoredTracks.length === 0) {
    return {
      tracks: [],
      clusterSpread: { genreClusters: 0, eraClusters: 0, energyBands: 0, moodQuadrants: 0 },
      clusterSelectionRatios: {},
    };
  }

  const genreMax   = Math.max(1, Math.ceil(targetCount * 0.60));
  const eraMax     = Math.max(1, Math.ceil(targetCount * 0.60));
  const energyMax  = Math.max(1, Math.ceil(targetCount * 0.65));
  const familyMax  = Math.max(1, Math.ceil(targetCount * 0.75));

  const clusterPickCount = new Map<string, number>();
  const familyPickCount  = new Map<string, number>();
  const usedIds = new Set<string>();

  type OutTrack = ClusterSelectionResult<T>["tracks"][number];
  const selected: OutTrack[] = [];

  function clusterDiversityScore(decision: TrackDecision<T>): number {
    const contributions = (trackToClusterIds.get(decision.track.trackId) ?? [])
      .map((cid) => clusters.get(cid)?.diversityContributionScore ?? 0);
    return contributions.length > 0 ? Math.max(...contributions) : 0;
  }

  function samplerWeight(decision: TrackDecision<T>): number {
    return Math.max(0.05, clusterDiversityScore(decision));
  }

  function sharesSelectedCluster(decision: TrackDecision<T>): boolean {
    if (selected.length === 0) return true;
    const candidateClusters = new Set(trackToClusterIds.get(decision.track.trackId) ?? []);
    return selected.some((track) =>
      track.clusterIds.some((cluster) => candidateClusters.has(cluster))
    );
  }

  function candidateFitsClusterCaps(decision: TrackDecision<T>): boolean {
    const cids = trackToClusterIds.get(decision.track.trackId) ?? [];
    const genreCid  = cids.find((c) => c.startsWith("genre:"));
    const eraCid    = cids.find((c) => c.startsWith("era:"));
    const energyCid = cids.find((c) => c.startsWith("energy:"));

    const genreViolation  = genreCid  && (clusterPickCount.get(genreCid)  ?? 0) >= genreMax;
    const eraViolation    = eraCid    && (clusterPickCount.get(eraCid)    ?? 0) >= eraMax;
    const energyViolation = energyCid && (clusterPickCount.get(energyCid) ?? 0) >= energyMax;

    const genreFamily     = getGenreFamily(decision.genrePrimary ?? "unknown");
    const familyViolation = (familyPickCount.get(genreFamily) ?? 0) >= familyMax;

    return !(genreViolation || eraViolation || energyViolation || familyViolation);
  }

  function addSelected(decision: TrackDecision<T>): void {
    const weightedDecision = withDecisionWeight(decision, samplerWeight(decision));
    const cids = weightedDecision.clusterIds;
    selected.push({
      ...weightedDecision.track,
      sourceLane: laneId,
      laneScore: weightedDecision.score,
      genrePrimary: weightedDecision.genrePrimary,
      laneEra: weightedDecision.laneEra,
      clusterIds: cids,
    });
    usedIds.add(weightedDecision.track.trackId);
    for (const cid of cids) {
      clusterPickCount.set(cid, (clusterPickCount.get(cid) ?? 0) + 1);
    }
    const genreFamily = getGenreFamily(weightedDecision.genrePrimary ?? "unknown");
    familyPickCount.set(genreFamily, (familyPickCount.get(genreFamily) ?? 0) + 1);
  }

  function weightedPick(candidates: Array<TrackDecision<T>>, bucketName: string): TrackDecision<T> | null {
    const available = candidates.filter((item) =>
      !usedIds.has(item.track.trackId) &&
      candidateFitsClusterCaps(item)
    );
    if (available.length === 0) return null;

    const total = available.reduce((sum, item) => sum + samplerWeight(item), 0);
    let cursor = seededUnit(`${seed}:${laneId}:${bucketName}:${selected.length}`) * total;
    for (const item of available) {
      cursor -= samplerWeight(item);
      if (cursor <= 0) return item;
    }
    return available[available.length - 1] ?? null;
  }

  const rankedCandidates = [...scoredTracks].sort((a, b) => {
    return b.score - a.score;
  });

  const coreEnd = Math.max(1, Math.ceil(rankedCandidates.length * 0.35));
  const variationEnd = Math.max(coreEnd, Math.ceil(rankedCandidates.length * 0.75));
  const coreTarget = Math.ceil(targetCount * 0.70);
  const variationTarget = Math.floor(targetCount * 0.20);
  const explorationTarget = Math.max(0, targetCount - coreTarget - variationTarget);
  const selectionBuckets = [
    { name: "core", target: coreTarget, pool: rankedCandidates.slice(0, coreEnd) },
    { name: "variation", target: variationTarget, pool: rankedCandidates.slice(coreEnd, variationEnd) },
    { name: "exploration", target: explorationTarget, pool: rankedCandidates.slice(variationEnd) },
  ];

  for (const bucket of selectionBuckets) {
    if (selected.length >= targetCount) break;
    const start = selected.length;
    let attempts = 0;
    while (
      selected.length < targetCount &&
      selected.length - start < bucket.target &&
      attempts < bucket.pool.length * 3
    ) {
      const nearbyPool = bucket.name === "variation"
        ? bucket.pool.filter(sharesSelectedCluster)
        : bucket.pool;
      const pick = weightedPick(nearbyPool.length > 0 ? nearbyPool : bucket.pool, bucket.name);
      if (!pick) break;
      addSelected(pick);
      attempts++;
    }
  }

  if (selected.length < targetCount) {
    for (const item of rankedCandidates) {
      if (selected.length >= targetCount) break;
      if (usedIds.has(item.track.trackId)) continue;
      addSelected(item);
    }
  }

  const seenGenres  = new Set<string>();
  const seenEras    = new Set<string>();
  const seenEnergy  = new Set<string>();
  const seenMoods   = new Set<string>();

  for (const track of selected) {
    for (const cid of track.clusterIds) {
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
