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
import type { LockedIntent } from "./intent";
import { withDecisionWeight, type TrackDecision } from "./track-decision";
import { artistExceedsSessionCap, type SessionArtistMemory } from "./constraint-relaxation";
import {
  boundedClusterSaturationPenalty,
  boundedFamilySaturationPenalty,
  boundedTrackReusePenalty,
  buildDiversityTraceComponents,
  type DiversityTraceComponents,
} from "./diversity-pressure";

export interface SampledLaneResult<T extends ScorerTrack> {
  laneId: string;
  tracks: Array<T & {
    sourceLane: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
    diversity: DiversityTraceComponents | null;
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
  samplerDiagnostics: {
    inputCount: number;
    outputCount: number;
    rejectionReasons: Record<string, number>;
    topRejectionReasons: Array<{ reason: string; count: number }>;
    dominantCluster?: string | null;
    clusterPurity?: number;
    secondaryClusterAllowed?: boolean;
    secondaryClusterReason?: string | null;
    trackReusePenaltyApplied?: number;
    artistReusePenaltyApplied?: number;
    clusterPenaltyApplied?: number;
    familyPenaltyApplied?: number;
  };
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

export function selectFromClusters<T extends ScorerTrack>(
  pool: ClusteredPool<T>,
  targetCount: number,
  laneId: string,
  seed = "v3-selection",
  opts: {
    lockedIntent?: LockedIntent;
    sessionArtistMemory?: SessionArtistMemory;
    recentTrackPenalty?: Map<string, number>;
  } = {},
): ClusterSelectionResult<T> {
  const { scoredTracks, trackToClusterIds, clusters } = pool;

  if (scoredTracks.length === 0) {
    return {
      tracks: [],
      clusterSpread: { genreClusters: 0, eraClusters: 0, energyBands: 0, moodQuadrants: 0 },
      clusterSelectionRatios: {},
      samplerDiagnostics: {
        inputCount: 0,
        outputCount: 0,
        rejectionReasons: { empty_sampler_input: 1 },
        topRejectionReasons: [{ reason: "empty_sampler_input", count: 1 }],
      },
    };
  }

  const genreMax   = opts.lockedIntent?.genreFamilies.length
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * 0.60));
  const eraMax     = opts.lockedIntent?.eraRange
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * 0.60));
  const energyMax  = Math.max(1, Math.ceil(targetCount * 0.65));
  const familyMax  = opts.lockedIntent?.genreFamilies.length
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * 0.75));

  const clusterPickCount = new Map<string, number>();
  const familyPickCount  = new Map<string, number>();
  const usedIds = new Set<string>();
  const rejectionReasons: Record<string, number> = {};

  type OutTrack = ClusterSelectionResult<T>["tracks"][number];
  const selected: OutTrack[] = [];
  const recentTrackPenaltyById = new Map<string, number>();
  const trackReusePenaltyById = new Map<string, number>();
  for (const decision of scoredTracks) {
    const recentTrackPenalty = opts.recentTrackPenalty?.get(decision.track.trackId) ?? decision.diversity?.recentTrackPenalty ?? 0;
    recentTrackPenaltyById.set(decision.track.trackId, recentTrackPenalty);
    trackReusePenaltyById.set(decision.track.trackId, boundedTrackReusePenalty(recentTrackPenalty));
  }

  function recordRejection(reason: string, count = 1): void {
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
  }

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

  function candidateDiversity(decision: TrackDecision<T>): DiversityTraceComponents {
    const cids = trackToClusterIds.get(decision.track.trackId) ?? [];
    const clusterSaturationPenalty = boundedClusterSaturationPenalty(
      cids.reduce((sum, cid) => sum + (clusterPickCount.get(cid) ?? 0), 0)
    );
    const family = getGenreFamily(decision.genrePrimary ?? "unknown");
    const familySaturationPenalty = boundedFamilySaturationPenalty(familyPickCount.get(family) ?? 0);
    const recentTrackPenalty = recentTrackPenaltyById.get(decision.track.trackId) ?? 0;
    const trackReusePenalty = trackReusePenaltyById.get(decision.track.trackId) ?? 0;

    return buildDiversityTraceComponents({
      artistMemoryMultiplier: 1 - (decision.diversity?.artistMemoryPenalty ?? 0),
      recentTrackPenalty,
      trackReusePenalty,
      clusterSaturationPenalty,
      familySaturationPenalty,
      artistGravity: decision.diversity?.artistGravity ?? 0,
    });
  }

  function diversityTieBreak(a: TrackDecision<T>, b: TrackDecision<T>): number {
    const recentDelta = (recentTrackPenaltyById.get(a.track.trackId) ?? 0) - (recentTrackPenaltyById.get(b.track.trackId) ?? 0);
    if (recentDelta !== 0) return recentDelta;
    const artistGravityDelta = (a.diversity?.artistGravity ?? 0) - (b.diversity?.artistGravity ?? 0);
    if (artistGravityDelta !== 0) return artistGravityDelta;
    const da = candidateDiversity(a);
    const db = candidateDiversity(b);
    return da.clusterSaturationPenalty - db.clusterSaturationPenalty ||
      da.familySaturationPenalty - db.familySaturationPenalty;
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

  function distributionScore(decision: TrackDecision<T>, bucketName = "core"): number {
    const explorationAdjustment = behavioralModifier(decision, bucketName);
    const trackReusePenalty = trackReusePenaltyById.get(decision.track.trackId) ?? 0;
    return clamp01((decision.finalScore * 0.94 + explorationAdjustment * 0.06) * (1 - trackReusePenalty));
  }

  function scoredDecision(decision: TrackDecision<T>, bucketName = "core"): TrackDecision<T> {
    const diversity = candidateDiversity(decision);
    return {
      ...decision,
      finalScore: distributionScore(decision, bucketName),
      relevanceScore: decision.finalScore,
      affinityScore: decision.finalScore,
      diversity,
    };
  }

  function softmaxWeight(decision: TrackDecision<T>, bucketName: string, maxScore: number): number {
    const temperature = 8;
    const finalScore = distributionScore(decision, bucketName);
    return Math.exp((finalScore - maxScore) * temperature);
  }

  function sharesSelectedCluster(decision: TrackDecision<T>): boolean {
    if (selected.length === 0) return true;
    const candidateClusters = new Set(trackToClusterIds.get(decision.track.trackId) ?? []);
    return selected.some((track) =>
      track.clusterIds.some((cluster) => candidateClusters.has(cluster))
    );
  }

  function clusterCapRejectionReason(decision: TrackDecision<T>): string | null {
    const cids = trackToClusterIds.get(decision.track.trackId) ?? [];
    const genreCid  = cids.find((c) => c.startsWith("genre:"));
    const eraCid    = cids.find((c) => c.startsWith("era:"));
    const energyCid = cids.find((c) => c.startsWith("energy:"));

    const genreViolation  = genreCid  && (clusterPickCount.get(genreCid)  ?? 0) >= genreMax;
    const eraViolation    = eraCid    && (clusterPickCount.get(eraCid)    ?? 0) >= eraMax;
    const energyViolation = energyCid && (clusterPickCount.get(energyCid) ?? 0) >= energyMax;

    const genreFamily     = getGenreFamily(decision.genrePrimary ?? "unknown");
    const familyViolation = (familyPickCount.get(genreFamily) ?? 0) >= familyMax;

    if (genreViolation) return "sampler_genre_cap";
    if (eraViolation) return "sampler_era_cap";
    if (energyViolation) return "sampler_energy_cap";
    if (familyViolation) return "sampler_family_cap";
    return null;
  }

  function candidateFitsClusterCaps(decision: TrackDecision<T>): boolean {
    return clusterCapRejectionReason(decision) === null;
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
      diversity: weightedDecision.diversity,
    });
    usedIds.add(weightedDecision.track.trackId);
    for (const cid of cids) {
      clusterPickCount.set(cid, (clusterPickCount.get(cid) ?? 0) + 1);
    }
    const genreFamily = getGenreFamily(weightedDecision.genrePrimary ?? "unknown");
    familyPickCount.set(genreFamily, (familyPickCount.get(genreFamily) ?? 0) + 1);
  }

  function weightedPick(candidates: Array<TrackDecision<T>>, bucketName: string): TrackDecision<T> | null {
    const available: Array<TrackDecision<T>> = [];
    for (const item of candidates) {
      if (usedIds.has(item.track.trackId)) {
        recordRejection("sampler_duplicate_track");
        continue;
      }
      const capReason = clusterCapRejectionReason(item);
      if (capReason) {
        recordRejection(capReason);
        continue;
      }
      if (
        artistExceedsSessionCap(opts.sessionArtistMemory, item.track.artistName) &&
        candidates.length - available.length > Math.max(3, targetCount - selected.length)
      ) {
        recordRejection("sampler_session_artist_cap");
        continue;
      }
      available.push(item);
    }
    if (available.length === 0) {
      recordRejection("sampler_no_available_candidates");
      return null;
    }

    const sequenceSafe = available.filter(candidateFitsSequence);
    if (sequenceSafe.length < available.length) {
      recordRejection("sampler_sequence_rule", available.length - sequenceSafe.length);
    }
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
    const neighborhoodPickable = [...(selectedNeighborhood?.group ?? pickable)].sort((a, b) => {
      const scoreDelta = distributionScore(b, bucketName) - distributionScore(a, bucketName);
      return Math.abs(scoreDelta) > 0.005 ? scoreDelta : diversityTieBreak(a, b);
    });
    const maxScore = Math.max(...neighborhoodPickable.map((item) => distributionScore(item, bucketName)));
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
    const scoreDelta = b.finalScore - a.finalScore;
    return Math.abs(scoreDelta) > 0.005
      ? scoreDelta
      : diversityTieBreak(a, b);
  });
  const genreClusterCounts = new Map<string, number>();
  for (const decision of rankedCandidates.slice(0, Math.max(targetCount * 4, 40))) {
    const genreCid = (trackToClusterIds.get(decision.track.trackId) ?? []).find((cid) => cid.startsWith("genre:"));
    if (genreCid) genreClusterCounts.set(genreCid, (genreClusterCounts.get(genreCid) ?? 0) + 1);
  }
  const dominantCluster = [...genreClusterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const primaryCoverage = dominantCluster
    ? rankedCandidates.filter((decision) => (trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster)).length
    : 0;
  const requiredPrimaryCoverage = Math.ceil(targetCount * 0.70);
  const secondaryClusterAllowed = primaryCoverage < requiredPrimaryCoverage;
  const secondaryClusterReason = secondaryClusterAllowed
    ? "primary_cluster_below_70_percent_target"
    : null;
  const clusterDisciplinedCandidates = dominantCluster && !secondaryClusterAllowed
    ? rankedCandidates.filter((decision) => (trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster))
    : rankedCandidates;
  if (dominantCluster && clusterDisciplinedCandidates.length < rankedCandidates.length) {
    recordRejection("sampler_non_dominant_cluster_held", rankedCandidates.length - clusterDisciplinedCandidates.length);
  }

  const coreEnd = Math.max(1, Math.ceil(clusterDisciplinedCandidates.length * 0.35));
  const variationEnd = Math.max(coreEnd, Math.ceil(clusterDisciplinedCandidates.length * 0.75));
  const coreTarget = Math.ceil(targetCount * 0.70);
  const variationTarget = Math.floor(targetCount * 0.20);
  const explorationTarget = Math.max(0, targetCount - coreTarget - variationTarget);
  const selectionBuckets = [
    { name: "core", target: coreTarget, pool: clusterDisciplinedCandidates.slice(0, coreEnd) },
    { name: "variation", target: variationTarget, pool: clusterDisciplinedCandidates.slice(coreEnd, variationEnd) },
    { name: "exploration", target: explorationTarget, pool: clusterDisciplinedCandidates.slice(variationEnd) },
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
      if (!pick) {
        recordRejection(`sampler_${bucket.name}_pick_failed`);
        break;
      }
      addSelected(pick, bucket.name);
      attempts++;
    }
  }

  if (selected.length < targetCount) {
    let attempts = 0;
    while (selected.length < targetCount && attempts < rankedCandidates.length * 3) {
      const pick = weightedPick(secondaryClusterAllowed ? rankedCandidates : clusterDisciplinedCandidates, "fallback");
      if (!pick) {
        recordRejection("sampler_fallback_pick_failed");
        break;
      }
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
  const dominantSelectedCount = dominantCluster
    ? selected.filter((track) => track.clusterIds.includes(dominantCluster)).length
    : 0;
  const clusterPurity = selected.length > 0
    ? Math.round((dominantSelectedCount / selected.length) * 1000) / 1000
    : 0;
  const selectedDiversity = selected.map((track) => track.diversity).filter((diversity): diversity is DiversityTraceComponents => !!diversity);

  return {
    tracks: selected,
    clusterSpread: {
      genreClusters:  seenGenres.size,
      eraClusters:    seenEras.size,
      energyBands:    seenEnergy.size,
      moodQuadrants:  seenMoods.size,
    },
    clusterSelectionRatios,
    samplerDiagnostics: {
      inputCount: scoredTracks.length,
      outputCount: selected.length,
      rejectionReasons,
      topRejectionReasons: Object.entries(rejectionReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reason, count]) => ({ reason, count })),
      dominantCluster,
      clusterPurity,
      secondaryClusterAllowed,
      secondaryClusterReason,
      trackReusePenaltyApplied: selectedDiversity.filter((diversity) => diversity.trackReusePenalty > 0).length,
      artistReusePenaltyApplied: selectedDiversity.filter((diversity) => diversity.artistMemoryPenalty > 0 || diversity.artistGravity > 0).length,
      clusterPenaltyApplied: selectedDiversity.filter((diversity) => diversity.clusterSaturationPenalty > 0).length,
      familyPenaltyApplied: selectedDiversity.filter((diversity) => diversity.familySaturationPenalty > 0).length,
    },
  };
}
