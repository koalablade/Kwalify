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
import { withDecisionFinalScore, withDecisionWeight, type TrackDecision } from "./track-decision";

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
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

  function clusterValue(decision: TrackDecision<T>, prefix: string): string | null {
    const cid = (trackToClusterIds.get(decision.track.trackId) ?? [])
      .find((cluster) => cluster.startsWith(prefix));
    return cid ? cid.slice(prefix.length) : null;
  }

  function targetEnergyBandAt(position: number): string {
    const ratio = targetCount <= 1 ? 0 : position / Math.max(1, targetCount - 1);
    if (ratio < 0.18) return "low";
    if (ratio < 0.55) return "mid";
    if (ratio < 0.78) return "high";
    return "mid";
  }

  function clusterDiversityScore(decision: TrackDecision<T>): number {
    const contributions = (trackToClusterIds.get(decision.track.trackId) ?? [])
      .map((cid) => clusters.get(cid)?.diversityContributionScore ?? 0);
    return contributions.length > 0 ? Math.max(...contributions) : 0;
  }

  function behavioralModifier(decision: TrackDecision<T>, bucketName = "core"): number {
    const cids = trackToClusterIds.get(decision.track.trackId) ?? [];
    const energyBand = clusterValue(decision, "energy:");
    const moodCluster = clusterValue(decision, "mood:");
    const genreCid = cids.find((cid) => cid.startsWith("genre:"));
    const targetEnergyBand = targetEnergyBandAt(selected.length);
    const repeatedClusterPressure = cids.reduce(
      (pressure, cid) => pressure + (clusterPickCount.get(cid) ?? 0),
      0
    );
    const energyFit = energyBand && energyBand === targetEnergyBand ? 1.18 : 0.92;
    const explorationLift = bucketName === "exploration" ? 1.18 : bucketName === "variation" ? 1.08 : 1;
    const genreRotation = genreCid ? 1 / (1 + (clusterPickCount.get(genreCid) ?? 0) * 0.18) : 1;
    const moodRotation = moodCluster ? 1 / (1 + (clusterPickCount.get(`mood:${moodCluster}`) ?? 0) * 0.12) : 1;
    const repetitionDampener = 1 / (1 + repeatedClusterPressure * 0.08);
    const diversityLift = 0.35 + clusterDiversityScore(decision);
    const structuralControl = clamp01(
      (energyFit *
        explorationLift *
        genreRotation *
        moodRotation *
        repetitionDampener *
        diversityLift) / 1.65
    );
    return clamp01(structuralControl * 0.75 + decision.freshnessAffinity * 0.25);
  }

  function alignedTasteSignal(decision: TrackDecision<T>): number {
    const sceneScore = decision.sceneAffinity;
    const tasteScore = decision.tasteAffinity;
    const conflict = Math.abs(sceneScore - tasteScore);
    if (sceneScore >= 0.66 && conflict >= 0.28) {
      return clamp01(sceneScore * 0.75 + tasteScore * 0.25);
    }
    if (tasteScore > sceneScore && conflict >= 0.24) {
      return clamp01(sceneScore * 0.80 + tasteScore * 0.20);
    }
    return tasteScore;
  }

  function stabilisedDistributionScore(finalScore: number): number {
    const stabilityFactor = 0.15;
    return clamp01(finalScore * (1 - stabilityFactor) + smoothstep(finalScore) * stabilityFactor);
  }

  function hierarchicalFinalScore(decision: TrackDecision<T>, bucketName = "core"): number {
    const rawScore = clamp01(
      decision.embeddingAffinity * 0.70 +
      alignedTasteSignal(decision) * 0.20 +
      behavioralModifier(decision, bucketName) * 0.10
    );
    return stabilisedDistributionScore(rawScore);
  }

  function scoredDecision(decision: TrackDecision<T>, bucketName = "core"): TrackDecision<T> {
    return withDecisionFinalScore(decision, hierarchicalFinalScore(decision, bucketName));
  }

  function softmaxWeight(decision: TrackDecision<T>, bucketName: string, maxScore: number): number {
    const temperature = 8;
    const finalScore = hierarchicalFinalScore(decision, bucketName);
    return Math.exp((finalScore - maxScore) * temperature);
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

  function candidateFitsSequence(decision: TrackDecision<T>): boolean {
    const previous = selected[selected.length - 1];
    if (previous && previous.artistName === decision.track.artistName) return false;

    const candidateClusters = trackToClusterIds.get(decision.track.trackId) ?? [];
    const recent = selected.slice(-2);
    for (const cid of candidateClusters) {
      if (recent.length === 2 && recent.every((track) => track.clusterIds.includes(cid))) {
        return false;
      }
    }

    const energyBand = clusterValue(decision, "energy:");
    if (energyBand && recent.length === 2) {
      const recentEnergy = recent.map((track) =>
        track.clusterIds.find((cid) => cid.startsWith("energy:"))?.replace("energy:", "")
      );
      if (recentEnergy[0] === energyBand && recentEnergy[1] === energyBand) return false;
    }

    return true;
  }

  function addSelected(decision: TrackDecision<T>, bucketName = "core"): void {
    const finalDecision = scoredDecision(decision, bucketName);
    const weightedDecision = withDecisionWeight(finalDecision, finalDecision.finalScore);
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

    const sequenceSafe = available.filter(candidateFitsSequence);
    const pickable = sequenceSafe.length > 0 ? sequenceSafe : available;
    const neighborhoodEntries = Array.from(
      pickable.reduce((groups, item) => {
        const key = item.retrievalNeighborhood || "scene";
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
        return groups;
      }, new Map<string, Array<TrackDecision<T>>>())
    ).map(([name, group]) => ({
      name,
      group,
      score: group.reduce((sum, item) => sum + item.embeddingAffinity, 0) / Math.max(1, group.length),
    }));
    const maxNeighborhoodScore = Math.max(...neighborhoodEntries.map((entry) => entry.score));
    const weightedNeighborhoods = neighborhoodEntries.map((entry) => ({
      ...entry,
      weight: Math.exp((entry.score - maxNeighborhoodScore) * 7),
    }));
    const neighborhoodTotal = weightedNeighborhoods.reduce((sum, entry) => sum + entry.weight, 0);
    let neighborhoodCursor = seededUnit(`${seed}:${laneId}:${bucketName}:neighborhood:${selected.length}`) * neighborhoodTotal;
    const selectedNeighborhood = weightedNeighborhoods.find((entry) => {
      neighborhoodCursor -= entry.weight;
      return neighborhoodCursor <= 0;
    }) ?? weightedNeighborhoods[weightedNeighborhoods.length - 1];
    const neighborhoodPickable = selectedNeighborhood?.group ?? pickable;
    const maxScore = Math.max(...neighborhoodPickable.map((item) => hierarchicalFinalScore(item, bucketName)));
    const weightedPickables = neighborhoodPickable.map((item) => ({
      item,
      weight: softmaxWeight(item, bucketName, maxScore),
    }));
    const total = weightedPickables.reduce((sum, item) => sum + item.weight, 0);
    let cursor = seededUnit(`${seed}:${laneId}:${bucketName}:${selected.length}`) * total;
    for (const { item, weight } of weightedPickables) {
      cursor -= weight;
      if (cursor <= 0) return item;
    }
    return pickable[pickable.length - 1] ?? null;
  }

  const rankedCandidates = [...scoredTracks].sort((a, b) => {
    return b.embeddingAffinity - a.embeddingAffinity;
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
      addSelected(pick, bucket.name);
      attempts++;
    }
  }

  if (selected.length < targetCount) {
    let attempts = 0;
    while (selected.length < targetCount && attempts < rankedCandidates.length * 3) {
      const pick = weightedPick(rankedCandidates, "fallback");
      if (!pick) break;
      addSelected(pick, "fallback");
      attempts++;
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
