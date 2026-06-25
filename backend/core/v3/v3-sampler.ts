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
import type { SceneWorldContext } from "../scene-world-layer";
import { computeWorldMembershipScore } from "../scene-world-layer";
import {
  computeSceneClusterMembershipScore,
  openingSceneClusterThreshold,
  shouldRejectForSceneCluster,
} from "../scene-cohesion-clusters";
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
    sceneWorld?: SceneWorldContext | null;
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

  const sceneWorldStrict = !!opts.sceneWorld?.strictMode;

  function trackWorldMembership(decision: TrackDecision<T>): number {
    if (!opts.sceneWorld?.active) return 1;
    return computeWorldMembershipScore(
      {
        trackId: decision.track.trackId,
        artistName: decision.track.artistName,
        genrePrimary: decision.genrePrimary,
        energy: decision.track.energy,
        valence: decision.track.valence,
        danceability: decision.track.danceability,
        acousticness: decision.track.acousticness,
        tempo: decision.track.tempo,
        speechiness: decision.track.speechiness,
      },
      opts.sceneWorld,
    );
  }

  function trackSceneClusterMembership(decision: TrackDecision<T>): number {
    if (!opts.sceneWorld?.active) return 1;
    return computeSceneClusterMembershipScore(
      {
        trackId: decision.track.trackId,
        artistName: decision.track.artistName,
        genrePrimary: decision.genrePrimary,
        energy: decision.track.energy,
        valence: decision.track.valence,
        danceability: decision.track.danceability,
        acousticness: decision.track.acousticness,
        tempo: decision.track.tempo,
        speechiness: decision.track.speechiness,
      },
      opts.sceneWorld,
    );
  }

  function candidateFitsDominantSceneCluster(decision: TrackDecision<T>): boolean {
    if (!sceneWorldStrict || !opts.sceneWorld?.sceneClusters || selected.length >= 10) return true;
    const dominantId = opts.sceneWorld.sceneClusters.dominantClusterId;
    const clusterId = opts.sceneWorld.sceneClusters.trackToClusterId.get(decision.track.trackId);
    return clusterId === dominantId;
  }

  function candidateFitsSceneCluster(decision: TrackDecision<T>): boolean {
    if (!opts.sceneWorld?.active || !opts.sceneWorld.sceneClusters) return true;
    const track = {
      trackId: decision.track.trackId,
      artistName: decision.track.artistName,
      genrePrimary: decision.genrePrimary,
      energy: decision.track.energy,
      valence: decision.track.valence,
      danceability: decision.track.danceability,
      acousticness: decision.track.acousticness,
      tempo: decision.track.tempo,
      speechiness: decision.track.speechiness,
    };
    if (shouldRejectForSceneCluster(track, opts.sceneWorld)) return false;
    const clusterMembership = trackSceneClusterMembership(decision);
    if (selected.length < 10) {
      return clusterMembership >= openingSceneClusterThreshold(selected.length);
    }
    return clusterMembership >= 0.58;
  }

  function candidateFitsSceneWorld(decision: TrackDecision<T>): boolean {
    if (!opts.sceneWorld?.active) return true;
    const membership = trackWorldMembership(decision);
    if (selected.length < 10) return membership >= (selected.length < 5 ? 0.62 : 0.56);
    return membership >= 0.52;
  }

  function candidateFitsOpeningAnchor(decision: TrackDecision<T>): boolean {
    if (!sceneWorldStrict || selected.length >= 5) return true;
    const membership = trackWorldMembership(decision);
    if (membership < 0.64) return false;
    if (selected.length === 0) {
      return opts.sceneWorld!.anchorTrackIds.has(decision.track.trackId) || membership >= 0.72;
    }
    return membership >= 0.62;
  }
  const softIntent = !opts.lockedIntent?.genreFamilies?.length && !opts.lockedIntent?.eraRange;
  const highEnergySoft = softIntent && opts.lockedIntent?.energy === "high";
  const calmSoftWorld = softIntent && !highEnergySoft;
  const genreMax   = opts.lockedIntent?.genreFamilies.length
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * (softIntent ? 0.48 : 0.60)));
  const eraMax     = opts.lockedIntent?.eraRange
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * (softIntent ? 0.50 : 0.60)));
  const energyMax  = Math.max(1, Math.ceil(targetCount * 0.65));
  const familyMax  = opts.lockedIntent?.genreFamilies.length
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(targetCount * (softIntent ? 0.40 : 0.75)));

  const clusterPickCount = new Map<string, number>();
  const familyPickCount  = new Map<string, number>();
  const usedIds = new Set<string>();
  const rejectionReasons: Record<string, number> = {};

  type OutTrack = ClusterSelectionResult<T>["tracks"][number];
  const selected: OutTrack[] = [];

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
    const recentTrackPenalty = opts.recentTrackPenalty?.get(decision.track.trackId) ?? decision.diversity?.recentTrackPenalty ?? 0;
    const trackReusePenalty = boundedTrackReusePenalty(recentTrackPenalty);

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
    const da = candidateDiversity(a);
    const db = candidateDiversity(b);
    return da.recentTrackPenalty - db.recentTrackPenalty ||
      da.artistGravity - db.artistGravity ||
      da.clusterSaturationPenalty - db.clusterSaturationPenalty ||
      da.familySaturationPenalty - db.familySaturationPenalty;
  }

  function sonicWorldFit(decision: TrackDecision<T>): number {
    if (!softIntent) return 1;
    const e = decision.track.energy ?? 0.5;
    const d = decision.track.danceability ?? 0.5;
    const a = decision.track.acousticness ?? 0.5;
    const targetEnergy = opts.lockedIntent?.energy === "high"
      ? 0.72
      : opts.lockedIntent?.energy === "low"
        ? 0.34
        : 0.48;
    const targetDance = opts.lockedIntent?.energy === "high" ? 0.68 : 0.40;
    const energyFit = 1 - Math.min(1, Math.abs(e - targetEnergy) * 1.8);
    const danceFit = 1 - Math.min(1, Math.max(0, d - targetDance - 0.10) * 2.4);
    const acousticFit = 1 - Math.min(1, Math.abs(a - (targetEnergy < 0.45 ? 0.56 : 0.42)) * 1.2);
    return clamp01(energyFit * 0.42 + danceFit * 0.38 + acousticFit * 0.20);
  }

  function isUnknownFamily(family: string): boolean {
    return !family || family === "unknown";
  }

  function averageSelectedFeature(key: "energy" | "valence" | "danceability" | "acousticness"): number {
    if (selected.length === 0) return 0.5;
    const values = selected.map((track) => track[key] ?? 0.5);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function candidateProvesUnknownWorld(decision: TrackDecision<T>): boolean {
    if (!softIntent || selected.length === 0) return true;
    const family = getGenreFamily(decision.genrePrimary ?? "unknown");
    if (!isUnknownFamily(family)) return true;

    const sonic = sonicWorldFit(decision);
    const minSonic = selected.length < 5 ? 0.56 : 0.52;
    if (sonic < minSonic) return false;

    const dominantTexture = dominantSelectedTexture();
    const candidateTexture = textureBucketForTrack(decision.track);
    if (dominantTexture && candidateTexture !== dominantTexture) {
      const textureDrift =
        Math.abs((decision.track.acousticness ?? 0.5) - averageSelectedFeature("acousticness")) +
        Math.abs((decision.track.danceability ?? 0.5) - averageSelectedFeature("danceability"));
      if (textureDrift > 0.34) return false;
    }

    const energyDrift = Math.abs((decision.track.energy ?? 0.5) - averageSelectedFeature("energy"));
    const valenceDrift = Math.abs((decision.track.valence ?? 0.5) - averageSelectedFeature("valence"));
    if (energyDrift > 0.24) return false;
    if (valenceDrift > 0.28) return false;

    const genreCluster = (trackToClusterIds.get(decision.track.trackId) ?? [])
      .find((cluster) => cluster.startsWith("genre:"));
    const dominantFamily = dominantSelectedGenreFamily();
    if (genreCluster && dominantFamily) {
      const clusterFamily = getGenreFamily(genreCluster.replace("genre:", ""));
      if (!isUnknownFamily(clusterFamily) && clusterFamily !== dominantFamily) return false;
    }

    return playlistCohesionMultiplier(decision) >= (selected.length < 5 ? 0.76 : 0.72);
  }

  function candidateFitsOpeningTexture(decision: TrackDecision<T>): boolean {
    if (!softIntent || selected.length === 0) return true;
    const dominantTexture = dominantSelectedTexture();
    if (!dominantTexture) return true;
    const candidateTexture = textureBucketForTrack(decision.track);
    if (candidateTexture === dominantTexture) return true;
    return sonicWorldFit(decision) >= 0.62 &&
      Math.abs((decision.track.acousticness ?? 0.5) - averageSelectedFeature("acousticness")) <= 0.22;
  }

  function candidateFitsOpeningWorld(decision: TrackDecision<T>): boolean {
    if (!softIntent || selected.length >= 5) return true;
    const e = decision.track.energy ?? 0.5;
    const d = decision.track.danceability ?? 0.5;
    const v = decision.track.valence ?? 0.5;
    const a = decision.track.acousticness ?? 0.5;
    if (calmSoftWorld) {
      if (d > 0.74 && e > 0.60) return false;
      const aggressiveRock = e > 0.56 && v < 0.48 && d < 0.52;
      const noveltySpike = e > 0.54 && v < 0.38 && a < 0.22;
      if (aggressiveRock || noveltySpike) return false;
    } else if (highEnergySoft) {
      if (v < 0.40) return false;
      const doomMetal = e > 0.58 && v < 0.46 && a < 0.28;
      const introspectiveSlow = e < 0.38 && v < 0.52;
      if (doomMetal || introspectiveSlow) return false;
    }
    const openingThreshold = selected.length === 0
      ? (highEnergySoft ? 0.54 : 0.50)
      : (highEnergySoft ? 0.48 : 0.42);
    if (sonicWorldFit(decision) < openingThreshold) return false;
    return candidateFitsOpeningTexture(decision);
  }

  function dominantSelectedGenreFamily(): string | null {
    if (selected.length === 0) return null;
    const counts = new Map<string, number>();
    for (const track of selected) {
      const family = getGenreFamily(track.genrePrimary ?? "unknown");
      if (isUnknownFamily(family)) continue;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  function textureBucketForTrack(track: { danceability?: number | null; acousticness?: number | null }): string {
    const acoustic = track.acousticness ?? 0.5;
    const dance = track.danceability ?? 0.5;
    if (acoustic >= 0.55) return "acoustic";
    if (dance >= 0.65) return "rhythmic";
    if (acoustic <= 0.25 && dance <= 0.45) return "dense";
    return "balanced";
  }

  function dominantSelectedTexture(): string | null {
    if (selected.length === 0) return null;
    const counts = new Map<string, number>();
    for (const track of selected) {
      const bucket = textureBucketForTrack(track);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  function playlistCohesionMultiplier(decision: TrackDecision<T>): number {
    if (selected.length === 0) return 1;
    const dominantFamily = dominantSelectedGenreFamily();
    const candidateFamily = getGenreFamily(decision.genrePrimary ?? "unknown");
    const familyAligned = dominantFamily
      ? candidateFamily === dominantFamily
      : !isUnknownFamily(candidateFamily);
    const clusterAligned = sharesSelectedCluster(decision);
    const unknownPenalty = isUnknownFamily(candidateFamily) && dominantFamily ? 0.62 : 1;
    const familyFit = familyAligned ? 1 : clusterAligned ? 0.82 : softIntent ? 0.40 : 0.72;

    const dominantTexture = dominantSelectedTexture();
    const candidateTexture = textureBucketForTrack(decision.track);
    const textureFit = dominantTexture ? (candidateTexture === dominantTexture ? 1 : 0.78) : 1;

    const moodCluster = clusterValue(decision, "mood:");
    const moodAligned = moodCluster
      ? selected.some((track) => track.clusterIds.some((cid) => cid === `mood:${moodCluster}`))
      : true;
    const moodFit = moodAligned ? 1 : softIntent ? 0.72 : 0.82;

    return clamp01((familyFit * 0.50 + textureFit * 0.28 + moodFit * 0.22) * unknownPenalty);
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
    const explorationLift = softIntent
      ? (bucketName === "exploration" ? 0.96 : bucketName === "variation" ? 1.02 : 1)
      : (bucketName === "exploration" ? 1.18 : bucketName === "variation" ? 1.08 : 1);
    const genreRotation = genreCid
      ? 1 / (1 + (clusterPickCount.get(genreCid) ?? 0) * (softIntent ? 0.34 : 0.18))
      : 1;
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
    const diversity = candidateDiversity(decision);
    const bucketBlend = bucketName === "exploration" ? 0.18 : bucketName === "variation" ? 0.14 : 0.10;
    const cohesion = selected.length > 0
      ? (softIntent ? playlistCohesionMultiplier(decision) : 0.88 + playlistCohesionMultiplier(decision) * 0.12)
      : 1;
    const sonic = softIntent ? sonicWorldFit(decision) : 1;
    return clamp01(
      (decision.finalScore * (1 - bucketBlend) + explorationAdjustment * bucketBlend) *
      diversity.finalMultiplier *
      cohesion *
      sonic,
    );
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

  function sharesSelectedGenreWorld(decision: TrackDecision<T>): boolean {
    if (selected.length === 0) return true;
    const candidateClusters = new Set(
      (trackToClusterIds.get(decision.track.trackId) ?? [])
        .filter((cluster) => cluster.startsWith("genre:") || cluster.startsWith("mood:")),
    );
    if (candidateClusters.size === 0) {
      const dominantFamily = dominantSelectedGenreFamily();
      if (!dominantFamily) return true;
      return getGenreFamily(decision.genrePrimary ?? "unknown") === dominantFamily;
    }
    return selected.some((track) =>
      track.clusterIds.some((cluster) => candidateClusters.has(cluster)),
    );
  }

  function dominantFamilyShare(): number {
    if (selected.length === 0) return 0;
    const dominantFamily = dominantSelectedGenreFamily();
    if (!dominantFamily) return 0;
    const dominantTexture = dominantSelectedTexture();
    const aligned = selected.filter((track) => {
      const family = getGenreFamily(track.genrePrimary ?? "unknown");
      if (family === dominantFamily) return true;
      if (isUnknownFamily(family) && dominantTexture) {
        return textureBucketForTrack(track) === dominantTexture;
      }
      return false;
    }).length;
    return aligned / selected.length;
  }

  function candidateFitsAnchoredWorld(decision: TrackDecision<T>): boolean {
    if (!softIntent || selected.length < 4) return true;
    if (!candidateProvesUnknownWorld(decision)) return false;
    if (dominantFamilyShare() < 0.45) return true;
    const dominantFamily = dominantSelectedGenreFamily();
    const candidateFamily = getGenreFamily(decision.genrePrimary ?? "unknown");
    if (!dominantFamily) return true;
    if (isUnknownFamily(candidateFamily)) {
      return playlistCohesionMultiplier(decision) >= 0.74;
    }
    if (candidateFamily === dominantFamily) return true;
    return sharesSelectedGenreWorld(decision) && playlistCohesionMultiplier(decision) >= 0.78;
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

  function candidateFitsPlaylistWorld(decision: TrackDecision<T>, _bucketName: string): boolean {
    if (!softIntent || selected.length === 0) return candidateFitsOpeningWorld(decision);
    const cohesion = playlistCohesionMultiplier(decision);
    const minCohesion = selected.length >= 6 ? 0.72 : 0.70;
    return cohesion >= minCohesion || sharesSelectedGenreWorld(decision);
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
      if (!candidateFitsOpeningWorld(item)) {
        recordRejection("sampler_opening_world_mismatch");
        continue;
      }
      if (!candidateFitsPlaylistWorld(item, bucketName)) {
        recordRejection("sampler_playlist_world_mismatch");
        continue;
      }
      if (!candidateFitsAnchoredWorld(item)) {
        recordRejection("sampler_anchored_world_mismatch");
        continue;
      }
      if (!candidateProvesUnknownWorld(item)) {
        recordRejection("sampler_unknown_world_mismatch");
        continue;
      }
      if (!candidateFitsSceneWorld(item)) {
        recordRejection("sampler_scene_world_mismatch");
        continue;
      }
      if (!candidateFitsSceneCluster(item)) {
        recordRejection("sampler_scene_cluster_mismatch");
        continue;
      }
      if (!candidateFitsDominantSceneCluster(item)) {
        recordRejection("sampler_dominant_scene_cluster_mismatch");
        continue;
      }
      if (!candidateFitsOpeningAnchor(item)) {
        recordRejection("sampler_opening_anchor_mismatch");
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
    return Math.abs(scoreDelta) > 0.005 ? scoreDelta : diversityTieBreak(a, b);
  });
  const genreClusterCounts = new Map<string, number>();
  for (const decision of rankedCandidates.slice(0, Math.max(targetCount * 4, 40))) {
    const genreCid = (trackToClusterIds.get(decision.track.trackId) ?? []).find((cid) => cid.startsWith("genre:"));
    if (genreCid) genreClusterCounts.set(genreCid, (genreClusterCounts.get(genreCid) ?? 0) + 1);
  }
  const dominantCluster = [...genreClusterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dominantShareInPool = dominantCluster
    ? (genreClusterCounts.get(dominantCluster) ?? 0) / Math.max(1, rankedCandidates.length)
    : 0;
  const dominantPenalty = dominantShareInPool > 0.40 ? 0.15 : dominantShareInPool > 0.30 ? 0.10 : 0;
  const clusterBalancedCandidates = dominantCluster && dominantPenalty > 0
    ? rankedCandidates.map((decision) => {
        const inDominant = (trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster);
        return inDominant
          ? { ...decision, finalScore: decision.finalScore * (1 - dominantPenalty) }
          : decision;
      }).sort((a, b) => b.finalScore - a.finalScore)
    : rankedCandidates;
  const topWindow = clusterBalancedCandidates.slice(0, Math.max(20, targetCount * 2));
  const topDominantCount = dominantCluster
    ? topWindow.filter((decision) => (trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster)).length
    : 0;
  const topDominantCap = Math.ceil(topWindow.length * 0.30);
  const clusterDisciplinedCandidates = sceneWorldStrict
    ? rankedCandidates
    : dominantCluster && topDominantCount > topDominantCap
      ? [
          ...topWindow.filter((decision) => !(trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster)),
          ...topWindow.filter((decision) => (trackToClusterIds.get(decision.track.trackId) ?? []).includes(dominantCluster)).slice(0, topDominantCap),
          ...clusterBalancedCandidates.slice(topWindow.length),
        ]
      : clusterBalancedCandidates;
  const secondaryClusterAllowed = true;
  const secondaryClusterReason = dominantShareInPool > 0.45
    ? "dominant_cluster_exceeded_45_percent_pool"
    : null;

  const coreEnd = Math.max(1, Math.ceil(clusterDisciplinedCandidates.length * 0.35));
  const variationEnd = Math.max(coreEnd, Math.ceil(clusterDisciplinedCandidates.length * 0.75));
  let coreTarget = Math.ceil(targetCount * (softIntent ? 0.64 : 0.52));
  let variationTarget = Math.floor(targetCount * (softIntent ? 0.28 : 0.20));
  let explorationTarget = Math.max(0, targetCount - coreTarget - variationTarget);
  if (softIntent) {
    explorationTarget = sceneWorldStrict ? 0 : Math.min(explorationTarget, Math.ceil(targetCount * 0.08));
    coreTarget = Math.max(coreTarget, targetCount - variationTarget - explorationTarget);
  }
  const selectionBuckets = [
    { name: "core", target: coreTarget, pool: clusterDisciplinedCandidates.slice(0, coreEnd) },
    { name: "variation", target: variationTarget, pool: clusterDisciplinedCandidates.slice(coreEnd, variationEnd) },
    { name: "exploration", target: explorationTarget, pool: clusterDisciplinedCandidates.slice(variationEnd) },
  ];

  const openingAnchorSlots = sceneWorldStrict
    ? Math.min(10, targetCount)
    : softIntent
      ? Math.min(5, targetCount)
      : 0;
  const openingPool = sceneWorldStrict && opts.sceneWorld?.sceneClusters
    ? clusterDisciplinedCandidates
      .filter((decision) => {
        const dominantId = opts.sceneWorld!.sceneClusters!.dominantClusterId;
        return opts.sceneWorld!.sceneClusters!.trackToClusterId.get(decision.track.trackId) === dominantId;
      })
      .slice(0, Math.max(20, targetCount * 3))
    : clusterDisciplinedCandidates.slice(0, Math.max(15, targetCount * 2));
  while (selected.length < openingAnchorSlots) {
    const pick = weightedPick(openingPool, "core");
    if (!pick) {
      recordRejection("sampler_opening_anchor_failed");
      break;
    }
    addSelected(pick, "core");
  }

  for (const bucket of selectionBuckets) {
    if (selected.length >= targetCount) break;
    if (softIntent && selected.length < openingAnchorSlots && bucket.name !== "core") continue;
    const start = selected.length;
    let attempts = 0;
    while (
      selected.length < targetCount &&
      selected.length - start < bucket.target &&
      attempts < bucket.pool.length * 3
    ) {
      const nearbyPool = bucket.name === "variation" || bucket.name === "exploration"
        ? bucket.pool.filter((item) =>
            sharesSelectedCluster(item) && candidateFitsPlaylistWorld(item, bucket.name))
        : bucket.pool;
      const pickPool = nearbyPool.length > 0
        ? nearbyPool
        : bucket.name === "exploration" && softIntent
          ? bucket.pool.filter((item) => candidateFitsPlaylistWorld(item, bucket.name))
          : bucket.pool;
      const pick = weightedPick(pickPool.length > 0 ? pickPool : bucket.pool, bucket.name);
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
    },
  };
}
