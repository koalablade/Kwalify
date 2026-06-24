/**
 * V3.1+ Cluster-Aware Interleaver
 *
 * Merges already-sampled lanes into a listening order. It does not rescore,
 * filter, boost, or replace tracks selected by the sampler.
 */

import type { Lane } from "./lane-router";
import type { ScorerTrack } from "./lane-scorer";
import type { EraBucket } from "../../lib/intent-parser";
import { getGenreFamily } from "./global-diversity-controller";

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

// ── Lightweight emotional arc ordering ──────────────────────────────────────

type ArcSection = "intro" | "build" | "peak" | "release";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sectionAt(position: number, total: number): ArcSection {
  if (total <= 3) return position === total - 1 ? "release" : "build";
  const t = position / Math.max(1, total - 1);
  if (t < 0.22) return "intro";
  if (t < 0.58) return "build";
  if (t < 0.80) return "peak";
  return "release";
}

function targetEnergyAt(position: number, total: number): number {
  if (total <= 1) return 0.5;
  const t = position / (total - 1);

  // Four-part emotional arc: settle, rise, peak, resolve.
  if (t < 0.22) return 0.36 + (t / 0.22) * 0.12;
  if (t < 0.58) return 0.48 + ((t - 0.22) / 0.36) * 0.20;
  if (t < 0.80) return 0.68 + ((t - 0.58) / 0.22) * 0.17;
  return 0.70 - ((t - 0.80) / 0.20) * 0.22;
}

function intensityOf(track: ScorerTrack): number {
  const energy = track.energy ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempo = Math.min(1, Math.max(0, (track.tempo ?? 115) / 200));
  return energy * 0.60 + danceability * 0.25 + tempo * 0.15;
}

function complexityOf(track: ScorerTrack): number {
  const danceability = track.danceability ?? 0.5;
  const tempo = Math.min(1, Math.max(0, (track.tempo ?? 115) / 200));
  const acousticness = track.acousticness ?? 0.5;
  return clamp01(danceability * 0.35 + tempo * 0.35 + (1 - acousticness) * 0.30);
}

function energyLevel(track: ScorerTrack): number {
  const intensity = intensityOf(track);
  if (intensity < 0.45) return 0;
  if (intensity < 0.68) return 1;
  return 2;
}

function clusterFamilies(track: InterleavedTrack<ScorerTrack>): Set<string> {
  return new Set(
    track.clusterIds
      .filter((id) => id.startsWith("genre:"))
      .map((id) => getGenreFamily(id.replace("genre:", "")))
  );
}

function primaryFamily(track: InterleavedTrack<ScorerTrack>): string {
  return getGenreFamily(track.genrePrimary);
}

function clusterValue(track: InterleavedTrack<ScorerTrack>, prefix: string): string | null {
  const cluster = track.clusterIds.find((id) => id.startsWith(prefix));
  return cluster ? cluster.slice(prefix.length) : null;
}

function stableUnitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function subclusterOf(track: InterleavedTrack<ScorerTrack>): string {
  return clusterValue(track, "genre:") ??
    clusterValue(track, "mood:") ??
    primaryFamily(track);
}

function hasSharedClusterFamily(
  a: InterleavedTrack<ScorerTrack>,
  b: InterleavedTrack<ScorerTrack>,
): boolean {
  const aFamilies = clusterFamilies(a);
  if (aFamilies.size === 0) return primaryFamily(a) === primaryFamily(b);
  for (const family of clusterFamilies(b)) {
    if (aFamilies.has(family)) return true;
  }
  return primaryFamily(a) === primaryFamily(b);
}

function tracksAreNearIdentical(
  a: InterleavedTrack<ScorerTrack>,
  b: InterleavedTrack<ScorerTrack>,
): boolean {
  return Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)) < 0.08 &&
    Math.abs(intensityOf(a) - intensityOf(b)) < 0.08 &&
    subclusterOf(a) === subclusterOf(b);
}

function recentWindowIsFlat(recentTracks: ReadonlyArray<InterleavedTrack<ScorerTrack>>): boolean {
  if (recentTracks.length < 3) return false;
  const energies = recentTracks.map((track) => track.energy ?? 0.5);
  const intensity = recentTracks.map(intensityOf);
  const sameFamily = new Set(recentTracks.map(primaryFamily)).size === 1;
  return sameFamily &&
    Math.max(...energies) - Math.min(...energies) < 0.12 &&
    Math.max(...intensity) - Math.min(...intensity) < 0.12;
}

function openingIntentFitness(track: InterleavedTrack<ScorerTrack>): number {
  const laneConfidence = clamp01(track.laneScore);
  const laneAffinity =
    /^(?:core|motion|emotional|scene|intent)/i.test(track.sourceLane) ? 0.14 :
    /fallback|recovery|relax/i.test(track.sourceLane) ? -0.18 :
    /contrast|discovery/i.test(track.sourceLane) ? -0.08 :
    0;
  const intensity = intensityOf(track);
  const immediateEnergy = intensity >= 0.42 && intensity <= 0.78 ? 0.10 : 0;
  const lowConfidencePenalty = laneConfidence < 0.62 ? 0.14 : 0;
  return laneConfidence * 0.72 + laneAffinity + immediateEnergy - lowConfidencePenalty;
}

function earlyFallbackArtifactPenalty(
  candidate: InterleavedTrack<ScorerTrack>,
  position: number,
): number {
  if (position >= 5) return 0;
  if (/fallback|recovery|relax/i.test(candidate.sourceLane)) return 0.34;
  if (/discovery|contrast/i.test(candidate.sourceLane) && clamp01(candidate.laneScore) < 0.68) return 0.14;
  return 0;
}

function earlySonicClonePenalty(
  candidate: InterleavedTrack<ScorerTrack>,
  recentTracks: ReadonlyArray<InterleavedTrack<ScorerTrack>>,
  position: number,
): number {
  if (position >= 5 || recentTracks.length === 0) return 0;
  let penalty = 0;
  for (const recent of recentTracks.slice(-3)) {
    if (tracksAreNearIdentical(candidate, recent)) penalty += 0.26;
    if (subclusterOf(candidate) === subclusterOf(recent)) penalty += 0.08;
    if (Math.abs(intensityOf(candidate) - intensityOf(recent)) < 0.05) penalty += 0.06;
  }
  return penalty;
}

function earlyUniformCurvePenalty(
  candidate: InterleavedTrack<ScorerTrack>,
  recentTracks: ReadonlyArray<InterleavedTrack<ScorerTrack>>,
  position: number,
): number {
  if (position < 3 || position >= 8 || recentTracks.length < 2) return 0;
  const previous = recentTracks[recentTracks.length - 1]!;
  const beforePrevious = recentTracks[recentTracks.length - 2]!;
  const lastStep = intensityOf(previous) - intensityOf(beforePrevious);
  const nextStep = intensityOf(candidate) - intensityOf(previous);
  const tooLinear = Math.abs(nextStep - lastStep) < 0.035;
  const tooFlat = Math.abs(nextStep) < 0.035 && Math.abs(lastStep) < 0.035;
  return tooLinear || tooFlat ? 0.08 : 0;
}

function djIntentBoost(
  candidate: InterleavedTrack<ScorerTrack>,
  previous: InterleavedTrack<ScorerTrack> | null,
  recentTracks: ReadonlyArray<InterleavedTrack<ScorerTrack>>,
  position: number,
  total: number,
): number {
  const section = sectionAt(position, total);
  const intensity = intensityOf(candidate);
  let boost = 1.0;

  if (section === "intro" && intensity >= 0.30 && intensity <= 0.58) boost += 0.08;
  if (section === "intro" && position < 5) boost += openingIntentFitness(candidate) * 0.10;
  if (section === "build" && intensity >= 0.44 && intensity <= 0.72) boost += 0.06;
  if (section === "peak" && intensity >= 0.68) boost += 0.10;
  if (section === "release" && intensity >= 0.34 && intensity <= 0.62) boost += 0.08;

  if (previous) {
    const energyJump = Math.abs((candidate.energy ?? 0.5) - (previous.energy ?? 0.5));
    const intensityJump = Math.abs(intensity - intensityOf(previous));
    const nearbyFamily = hasSharedClusterFamily(candidate, previous);
    const nearIdentical = tracksAreNearIdentical(candidate, previous);
    if (nearbyFamily && energyJump >= 0.08 && energyJump <= 0.28) boost += 0.06;
    if (nearbyFamily && intensityJump >= 0.06 && intensityJump <= 0.24) boost += 0.04;
    if (nearIdentical) boost -= 0.12;
    if (!nearbyFamily && energyJump > 0.38) boost -= 0.12;
  }

  if (recentWindowIsFlat(recentTracks) && previous && hasSharedClusterFamily(candidate, previous) && !tracksAreNearIdentical(candidate, previous)) {
    boost += 0.09;
  }

  return Math.max(0.78, Math.min(1.14, boost));
}

function intentionalArtistRepeat(
  candidate: InterleavedTrack<ScorerTrack>,
  previous: InterleavedTrack<ScorerTrack> | null,
): boolean {
  if (!previous || candidate.artistName !== previous.artistName) return false;
  const energyJump = Math.abs((candidate.energy ?? 0.5) - (previous.energy ?? 0.5));
  return candidate.laneScore >= 0.82 &&
    previous.laneScore >= 0.78 &&
    hasSharedClusterFamily(candidate, previous) &&
    energyJump <= 0.22;
}

function transitionCost(
  candidate: InterleavedTrack<ScorerTrack>,
  previous: InterleavedTrack<ScorerTrack> | null,
  recentTracks: ReadonlyArray<InterleavedTrack<ScorerTrack>>,
  recentlyUsedArtists: ReadonlySet<string>,
  recentFamilies: ReadonlySet<string>,
  sectionSubclusters: ReadonlySet<string>,
  remainingSubclusters: ReadonlySet<string>,
  position: number,
  total: number,
  originalOffset: number,
): number {
  const candidateEnergy = candidate.energy ?? 0.5;
  const candidateFamily = primaryFamily(candidate);
  const section = sectionAt(position, total);
  const candidateIntensity = intensityOf(candidate);
  let cost = Math.abs(candidateEnergy - targetEnergyAt(position, total)) * 0.9;
  cost += Math.abs(candidateIntensity - targetEnergyAt(position, total)) * 0.45;

  if (section === "intro") {
    cost += complexityOf(candidate) * 0.35;
    cost -= openingIntentFitness(candidate) * 0.52;
    cost += earlySonicClonePenalty(candidate, recentTracks, position);
    cost += earlyUniformCurvePenalty(candidate, recentTracks, position);
    cost += earlyFallbackArtifactPenalty(candidate, position);
  }
  if (section === "peak") {
    cost -= candidateIntensity * 0.22;
  }
  if (section === "release") {
    cost += Math.max(0, candidateIntensity - 0.62) * 0.65;
    cost -= (candidate.valence ?? 0.5) >= 0.45 ? 0.04 : 0;
    cost -= clusterValue(candidate, "mood:") === "nostalgic" ? 0.06 : 0;
  }

  if (previous) {
    const energyJump = Math.abs(candidateEnergy - (previous.energy ?? 0.5));
    const intensityJump = Math.abs(intensityOf(candidate) - intensityOf(previous));
    const sameArtist = candidate.artistName === previous.artistName;
    const intentionalRepeat = intentionalArtistRepeat(candidate, previous);
    const nearbyFamily = hasSharedClusterFamily(candidate, previous);
    const sameEnergyBand =
      clusterValue(candidate, "energy:") !== null &&
      clusterValue(candidate, "energy:") === clusterValue(previous, "energy:");
    const sameMoodCluster =
      clusterValue(candidate, "mood:") !== null &&
      clusterValue(candidate, "mood:") === clusterValue(previous, "mood:");
    const harshGenreCollision = !nearbyFamily && energyJump > 0.38;

    cost += Math.max(0, energyJump - 0.18) * 1.8;
    cost += energyJump > 0.48 ? 1.2 : 0;
    cost += energyLevel(candidate) - energyLevel(previous) > 1 ? 2.0 : 0;
    cost += Math.max(0, intensityJump - 0.22) * 1.0;
    cost += harshGenreCollision ? 0.95 : nearbyFamily ? -0.03 : 0.28;
    cost += !nearbyFamily && position < 10 ? 0.38 : 0;
  cost += sameEnergyBand ? -0.015 : 0;
  cost += sameMoodCluster ? -0.015 : 0;
  cost += tracksAreNearIdentical(candidate, previous) ? 0.34 : 0;
  cost += sameArtist ? (intentionalRepeat ? 0.85 : 4.0) : 0;
  }

  if (recentlyUsedArtists.has(candidate.artistName)) {
    cost += 0.35;
  }
  if (recentFamilies.has(candidateFamily)) {
    cost += 0.08;
  }
  if (
    sectionSubclusters.has(subclusterOf(candidate)) &&
    remainingSubclusters.size > sectionSubclusters.size
  ) {
    cost += 0.18;
  }
  if (position < 5 && recentlyUsedArtists.has(candidate.artistName)) {
    cost += 0.72;
  }
  if (position >= 2 && position < 7) {
    const naturalVariation = stableUnitHash(`${candidate.trackId}:${position}`) - 0.5;
    cost += naturalVariation * 0.018;
  }
  if (position >= 4 && position < Math.min(total, 12) && recentlyUsedArtists.size > 0) {
    if (!recentFamilies.has(candidateFamily) && position < 8) {
      cost += 0.48;
    }
  }

  // Keep the sampler/interleaver character visible; ordering should shape, not dominate.
  return ((cost + originalOffset * 0.026) / djIntentBoost(candidate, previous, recentTracks, position, total));
}

function anchorPositions(total: number): Partial<Record<ArcSection, number>> {
  if (total <= 2) return {};
  const releasePosition = total > 10 ? Math.max(0, total - 2) : total - 1;
  return {
    intro: 0,
    build: Math.min(total - 1, Math.max(1, Math.floor(total * 0.38))),
    peak: Math.min(total - 1, Math.max(2, Math.floor(total * 0.68))),
    release: releasePosition,
  };
}

function anchorFitness(track: InterleavedTrack<ScorerTrack>, section: ArcSection): number {
  const intensity = intensityOf(track);
  if (section === "intro") {
    return openingIntentFitness(track) * 0.58 +
      (1 - Math.abs(intensity - 0.52)) * 0.30 +
      (1 - complexityOf(track)) * 0.12;
  }
  if (section === "build") {
    return (1 - Math.abs(intensity - 0.58)) * 0.78 + (track.danceability ?? 0.5) * 0.22;
  }
  if (section === "peak") {
    return intensity * 0.78 + (track.danceability ?? 0.5) * 0.22;
  }
  return (1 - Math.abs(intensity - 0.48)) * 0.58 +
    ((track.valence ?? 0.5) >= 0.45 ? 0.20 : 0) +
    (clusterValue(track, "mood:") === "nostalgic" ? 0.22 : 0);
}

function chooseArcAnchors<T extends ScorerTrack>(
  tracks: Array<T & InterleavedTrack<T>>,
): Map<number, string> {
  const positions = anchorPositions(tracks.length);
  const usedIds = new Set<string>();
  const anchors = new Map<number, string>();
  const orderedSections: ArcSection[] = ["peak", "intro", "build", "release"];
  const peakArtist = tracks
    .filter((track) => !usedIds.has(track.trackId))
    .sort((a, b) => anchorFitness(b, "peak") - anchorFitness(a, "peak"))[0]?.artistName;

  for (const section of orderedSections) {
    const position = positions[section];
    if (position === undefined) continue;
    const candidates = tracks
      .filter((track) => !usedIds.has(track.trackId))
      .filter((track) => section !== "intro" || tracks.length <= 4 || track.artistName !== peakArtist);
    const pool = candidates.length > 0 ? candidates : tracks.filter((track) => !usedIds.has(track.trackId));
    const anchor = pool.sort((a, b) => anchorFitness(b, section) - anchorFitness(a, section))[0];
    if (!anchor) continue;
    usedIds.add(anchor.trackId);
    anchors.set(position, anchor.trackId);
  }
  return anchors;
}

function positionIsPeakEarned(
  candidate: InterleavedTrack<ScorerTrack>,
  ordered: Array<InterleavedTrack<ScorerTrack>>,
  position: number,
  total: number,
): boolean {
  if (sectionAt(position, total) !== "peak" || energyLevel(candidate) < 2 || ordered.length < 2) {
    return true;
  }
  const previousTwo = ordered.slice(-2);
  return previousTwo.every((track, idx) => energyLevel(track) >= idx);
}

function hasUsableAlternative<T extends ScorerTrack>(
  remaining: Array<T & InterleavedTrack<T>>,
  rejectedTrackId: string,
  predicate: (track: T & InterleavedTrack<T>) => boolean,
): boolean {
  return remaining.some((track) => track.trackId !== rejectedTrackId && predicate(track));
}

export function orderTracksForEmotionalFlow<T extends ScorerTrack>(
  selectedTracks: Array<T & InterleavedTrack<T>>,
): Array<T & InterleavedTrack<T>> {
  type OutTrack = T & InterleavedTrack<T>;
  if (selectedTracks.length <= 2) return [...selectedTracks];

  const remaining = [...selectedTracks];
  const ordered: OutTrack[] = [];
  const recentArtists: string[] = [];
  const preferredAnchors = chooseArcAnchors(selectedTracks);
  const sectionSubclusters = new Map<ArcSection, Set<string>>();

  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1] ?? null;
    const recentlyUsedArtists = new Set(recentArtists.slice(-3));
    const recentFamilies = new Set(
      ordered.slice(-4).map((track) => primaryFamily(track))
    );
    const position = ordered.length;
    const section = sectionAt(position, selectedTracks.length);
    const usedSubclusters = sectionSubclusters.get(section) ?? new Set<string>();
    const remainingSubclusters = new Set(remaining.map((track) => subclusterOf(track)));
    const preferredAnchorId = preferredAnchors.get(position);
    let bestIndex = 0;
    let lowestCost = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      if (!positionIsPeakEarned(candidate, ordered, position, selectedTracks.length)) {
        continue;
      }
      if (
        previous?.artistName === candidate.artistName &&
        !intentionalArtistRepeat(candidate, previous) &&
        hasUsableAlternative(remaining, candidate.trackId, (track) => track.artistName !== previous.artistName)
      ) {
        continue;
      }
      if (
        previous &&
        energyLevel(candidate) - energyLevel(previous) > 1 &&
        hasUsableAlternative(remaining, candidate.trackId, (track) => energyLevel(track) - energyLevel(previous) <= 1)
      ) {
        continue;
      }
      const cost = transitionCost(
        candidate,
        previous,
        ordered.slice(-4),
        recentlyUsedArtists,
        recentFamilies,
        usedSubclusters,
        remainingSubclusters,
        position,
        selectedTracks.length,
        i,
      ) - (candidate.trackId === preferredAnchorId ? 0.35 : 0);
      if (cost < lowestCost) {
        lowestCost = cost;
        bestIndex = i;
      }
    }

    if (!Number.isFinite(lowestCost)) {
      bestIndex = 0;
    }

    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    ordered.push(next);
    recentArtists.push(next.artistName);
    const updatedSubclusters = sectionSubclusters.get(section) ?? new Set<string>();
    updatedSubclusters.add(subclusterOf(next));
    sectionSubclusters.set(section, updatedSubclusters);
  }

  return ordered;
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

  const orderedTracks = orderTracksForEmotionalFlow(result);
  const genreEntropy = shannonEntropy(orderedTracks.map((t) => t.genrePrimary));

  return {
    tracks: orderedTracks,
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
