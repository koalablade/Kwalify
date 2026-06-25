/**
 * Editorial Consistency Stabiliser — deterministic post-polish pass only.
 *
 * Reorders existing tracks within scene-cluster boundaries to reduce identity
 * drift, repetition, and arc distortion. Does not touch gate, sampler,
 * interleaver, world layer, or clustering logic.
 */

import {
  buildTrackEmbedding,
  cosineSimilarity,
  type AudioVector,
} from "../../shared/embeddings/track-embeddings";
import {
  openingDominantClusterPurity,
  OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
} from "../scene-cohesion-clusters";
import type { SceneWorldContext } from "../scene-world-layer";
import type { EditorialPolishTrack } from "./human-saveability-polish-layer";

export type EditorialIdentitySignature = {
  dominantClusterId: string;
  avgEnergyBand: number;
  valenceMedian: number;
  topArtistDensity: number;
};

export type EditorialStabilityScores = {
  identityDriftScore: number;
  repetitionRiskScore: number;
  arcStabilityScore: number;
  openingIntegrityScore: number;
};

export type EditorialStabiliserDiagnostics = EditorialStabilityScores & {
  openingSwapsPerformed: number;
  arcSwapsPerformed: number;
  repetitionDemotions: number;
  embeddingStreakBreaks: number;
  applied: boolean;
};

export type EditorialStabiliserResult<T extends EditorialPolishTrack> = {
  tracks: T[];
  diagnostics: EditorialStabiliserDiagnostics;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feature(value: number | null | undefined, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
}

function intensityOf(track: EditorialPolishTrack): number {
  const energy = feature(track.energy);
  const danceability = feature(track.danceability);
  const tempo = Math.min(1, Math.max(0, (track.tempo ?? 115) / 200));
  return energy * 0.60 + danceability * 0.25 + tempo * 0.15;
}

function energyBand(track: EditorialPolishTrack): 0 | 1 | 2 {
  const intensity = intensityOf(track);
  if (intensity < 0.45) return 0;
  if (intensity < 0.68) return 1;
  return 2;
}

function microEnergyBucket(track: EditorialPolishTrack): number {
  return Math.min(4, Math.floor(intensityOf(track) * 5));
}

function acousticEnergyBucket(track: EditorialPolishTrack): string {
  const acoustic = feature(track.acousticness) >= 0.55 ? "ac" : "el";
  return `${acoustic}:${energyBand(track)}`;
}

function sceneClusterId(track: EditorialPolishTrack, context: SceneWorldContext): string | null {
  return context.sceneClusters?.trackToClusterId.get(track.trackId)
    ?? track.clusterId
    ?? track.clusterIds?.[0]
    ?? null;
}

function trackEmbedding(track: EditorialPolishTrack): AudioVector {
  return buildTrackEmbedding({
    energy: track.energy ?? null,
    valence: track.valence ?? null,
    danceability: track.danceability ?? null,
    acousticness: track.acousticness ?? null,
    instrumentalness: track.instrumentalness ?? null,
    speechiness: track.speechiness ?? null,
    tempo: track.tempo ?? null,
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function artistKey(track: EditorialPolishTrack): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

function countEnergyBandChanges(tracks: EditorialPolishTrack[]): number {
  if (tracks.length <= 1) return 0;
  let changes = 0;
  for (let i = 1; i < tracks.length; i++) {
    if (energyBand(tracks[i]!) !== energyBand(tracks[i - 1]!)) changes++;
  }
  return changes;
}

function countArtistInRange(tracks: EditorialPolishTrack[], artist: string, start: number, endExclusive: number): number {
  const needle = artist.toLowerCase();
  let count = 0;
  for (let i = start; i < Math.min(endExclusive, tracks.length); i++) {
    if (artistKey(tracks[i]!) === needle) count++;
  }
  return count;
}

function openingMembershipIntact<T extends EditorialPolishTrack>(before: T[], after: T[]): boolean {
  if (before.length < 10 || after.length < 10) return true;
  const beforeIds = before.slice(0, 10).map((t) => t.trackId).sort();
  const afterIds = after.slice(0, 10).map((t) => t.trackId).sort();
  return beforeIds.every((id, idx) => id === afterIds[idx]);
}

function clusterIntegrityIntact<T extends EditorialPolishTrack>(
  before: T[],
  after: T[],
  context: SceneWorldContext,
): boolean {
  if (before.length !== after.length) return false;
  const beforeSet = new Set(before.map((t) => t.trackId));
  const afterSet = new Set(after.map((t) => t.trackId));
  if (beforeSet.size !== afterSet.size) return false;
  for (const id of beforeSet) {
    if (!afterSet.has(id)) return false;
  }
  for (const track of before) {
    const afterTrack = after.find((row) => row.trackId === track.trackId);
    if (!afterTrack) return false;
    if (sceneClusterId(track, context) !== sceneClusterId(afterTrack, context)) return false;
  }
  return true;
}

function swapWithinOpeningSafe<T extends EditorialPolishTrack>(
  tracks: T[],
  i: number,
  j: number,
  context: SceneWorldContext,
): T[] | null {
  if (i === j || i < 0 || j < 0 || i >= 10 || j >= 10 || i >= tracks.length || j >= tracks.length) {
    return null;
  }
  const a = tracks[i]!;
  const b = tracks[j]!;
  if (sceneClusterId(a, context) !== sceneClusterId(b, context)) return null;
  const next = [...tracks];
  next[i] = b;
  next[j] = a;
  if (!openingMembershipIntact(tracks, next)) return null;
  return next;
}

function swapInRangeSafe<T extends EditorialPolishTrack>(
  tracks: T[],
  i: number,
  j: number,
  context: SceneWorldContext,
  minIndex: number,
): T[] | null {
  if (i === j || i < minIndex || j < minIndex || i >= tracks.length || j >= tracks.length) return null;
  const a = tracks[i]!;
  const b = tracks[j]!;
  if (sceneClusterId(a, context) !== sceneClusterId(b, context)) return null;
  const next = [...tracks];
  next[i] = b;
  next[j] = a;
  return next;
}

export function computeEditorialIdentitySignature(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext,
): EditorialIdentitySignature | null {
  const opening = tracks.slice(0, Math.min(5, tracks.length));
  if (opening.length === 0) return null;

  const clusterCounts = new Map<string, number>();
  const energyBands: number[] = [];
  const valences: number[] = [];
  const artistCounts = new Map<string, number>();

  for (const track of opening) {
    const cluster = sceneClusterId(track, context) ?? "unknown";
    clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
    energyBands.push(energyBand(track));
    valences.push(feature(track.valence));
    const artist = artistKey(track);
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  let dominantClusterId = "unknown";
  let maxCluster = 0;
  for (const [cluster, count] of clusterCounts) {
    if (count > maxCluster) {
      maxCluster = count;
      dominantClusterId = cluster;
    }
  }

  const topArtistCount = Math.max(0, ...artistCounts.values());
  return {
    dominantClusterId,
    avgEnergyBand: energyBands.reduce((sum, v) => sum + v, 0) / energyBands.length,
    valenceMedian: median(valences),
    topArtistDensity: topArtistCount / opening.length,
  };
}

export function identityDeviationPenalty(
  track: EditorialPolishTrack,
  signature: EditorialIdentitySignature,
  context: SceneWorldContext,
): number {
  const cluster = sceneClusterId(track, context) ?? "unknown";
  let penalty = 0;
  if (cluster !== signature.dominantClusterId) penalty += 0.35;
  penalty += Math.abs(energyBand(track) - signature.avgEnergyBand) * 0.18;
  penalty += Math.abs(feature(track.valence) - signature.valenceMedian) * 0.22;
  const artistDensity = signature.topArtistDensity;
  if (artistDensity < 0.4 && artistKey(track) !== "unknown") {
    penalty += 0.04;
  }
  return penalty;
}

function openingStabilityPenalty(
  tracks: EditorialPolishTrack[],
  signature: EditorialIdentitySignature,
  context: SceneWorldContext,
): number {
  const opening = tracks.slice(0, Math.min(10, tracks.length));
  let penalty = 0;

  penalty += Math.max(0, countEnergyBandChanges(opening) - 2) * 0.25;

  for (let i = 0; i < Math.min(8, opening.length); i++) {
    const artist = artistKey(opening[i]!);
    if (countArtistInRange(opening, artist, 0, i + 1) > 1) penalty += 0.2;
  }

  for (let i = 2; i < opening.length; i++) {
    const bucket = acousticEnergyBucket(opening[i]!);
    if (
      acousticEnergyBucket(opening[i - 1]!) === bucket &&
      acousticEnergyBucket(opening[i - 2]!) === bucket
    ) {
      penalty += 0.18;
    }
  }

  for (let i = 0; i < Math.min(12, tracks.length); i++) {
    penalty += identityDeviationPenalty(tracks[i]!, signature, context) * (i < 10 ? 0.12 : 0.06);
  }

  return penalty;
}

export function enforceEditorialIdentityLock<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
  signature: EditorialIdentitySignature;
}): { tracks: T[]; swapsPerformed: number } {
  let working = [...opts.tracks];
  let swapsPerformed = 0;
  const end = Math.min(12, working.length);

  for (let i = 0; i < end; i++) {
    const currentPenalty = identityDeviationPenalty(working[i]!, opts.signature, opts.context);
    if (currentPenalty < 0.12) continue;

    let bestJ = -1;
    let bestGain = 0.01;
    for (let j = i + 1; j < working.length; j++) {
      if (sceneClusterId(working[i]!, opts.context) !== sceneClusterId(working[j]!, opts.context)) continue;
      const swapped = [...working];
      swapped[i] = working[j]!;
      swapped[j] = working[i]!;
      if (i < 10 || j < 10) {
        if (!openingMembershipIntact(working, swapped)) continue;
      }
      const gain = currentPenalty - identityDeviationPenalty(swapped[i]!, opts.signature, opts.context);
      if (gain > bestGain) {
        bestGain = gain;
        bestJ = j;
      }
    }

    if (bestJ < 0) continue;
    const next = [...working];
    next[i] = working[bestJ]!;
    next[bestJ] = working[i]!;
    working = next;
    swapsPerformed++;
  }

  return { tracks: working, swapsPerformed };
}

export function opening10EditorialStabilityPass<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
  signature: EditorialIdentitySignature;
}): { tracks: T[]; swapsPerformed: number } {
  if (opts.tracks.length < 10) {
    return { tracks: [...opts.tracks], swapsPerformed: 0 };
  }

  let working = [...opts.tracks];
  let swapsPerformed = 0;
  const beforePenalty = openingStabilityPenalty(working, opts.signature, opts.context);

  for (let pass = 0; pass < 12; pass++) {
    let improved = false;
    const opening = working.slice(0, 10);

    for (let i = 0; i < 10; i++) {
      if (countArtistInRange(opening, artistKey(opening[i]!), 0, 8) > 1 && i < 8) {
        for (let j = i + 1; j < 10; j++) {
          const candidate = swapWithinOpeningSafe(working, i, j, opts.context);
          if (!candidate) continue;
          if (openingStabilityPenalty(candidate, opts.signature, opts.context) <
            openingStabilityPenalty(working, opts.signature, opts.context)) {
            working = candidate;
            swapsPerformed++;
            improved = true;
            break;
          }
        }
      }

      if (i >= 2) {
        const bucket = acousticEnergyBucket(working[i]!);
        if (
          acousticEnergyBucket(working[i - 1]!) === bucket &&
          acousticEnergyBucket(working[i - 2]!) === bucket
        ) {
          for (let j = 0; j < 10; j++) {
            if (j === i) continue;
            const candidate = swapWithinOpeningSafe(working, i, j, opts.context);
            if (!candidate) continue;
            if (openingStabilityPenalty(candidate, opts.signature, opts.context) <
              openingStabilityPenalty(working, opts.signature, opts.context)) {
              working = candidate;
              swapsPerformed++;
              improved = true;
              break;
            }
          }
        }
      }
    }

    if (countEnergyBandChanges(working.slice(0, 10)) > 2) {
      for (let i = 0; i < 9; i++) {
        for (let j = i + 1; j < 10; j++) {
          const candidate = swapWithinOpeningSafe(working, i, j, opts.context);
          if (!candidate) continue;
          if (countEnergyBandChanges(candidate.slice(0, 10)) < countEnergyBandChanges(working.slice(0, 10))) {
            working = candidate;
            swapsPerformed++;
            improved = true;
          }
        }
      }
    }

    if (!improved) break;
  }

  const afterPenalty = openingStabilityPenalty(working, opts.signature, opts.context);
  if (afterPenalty > beforePenalty + 0.001) {
    return { tracks: [...opts.tracks], swapsPerformed: 0 };
  }

  return { tracks: working, swapsPerformed };
}

function arcTargetAt(position: number, total: number, mode: "rise" | "fall"): number {
  const t = position / Math.max(1, total - 1);
  if (mode === "rise") {
    if (t < 0.35) return 0.38 + t * 0.35;
    if (t < 0.72) return 0.58;
    return 0.58 - (t - 0.72) * 0.45;
  }
  if (t < 0.30) return 0.62 - t * 0.25;
  if (t < 0.68) return 0.52;
  return 0.52 - (t - 0.68) * 0.35;
}

function detectArcMode(tracks: EditorialPolishTrack[]): "rise" | "fall" {
  const slice = tracks.slice(10, Math.min(40, tracks.length));
  if (slice.length < 4) return "rise";
  const start = intensityOf(slice[0]!);
  const end = intensityOf(slice[slice.length - 1]!);
  return end <= start ? "fall" : "rise";
}

function arcPenalty(tracks: EditorialPolishTrack[], mode: "rise" | "fall"): number {
  const start = 10;
  const end = Math.min(40, tracks.length);
  if (end - start < 2) return 0;
  let penalty = 0;
  for (let i = start + 1; i < end; i++) {
    const jump = Math.abs(microEnergyBucket(tracks[i]!) - microEnergyBucket(tracks[i - 1]!));
    if (jump > 2) penalty += (jump - 2) * 0.22;
    const target = arcTargetAt(i - start, end - start, mode);
    penalty += Math.abs(intensityOf(tracks[i]!) - target) * 0.08;
  }
  return penalty;
}

export function microArcSmoothPass<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
}): { tracks: T[]; swapsPerformed: number } {
  if (opts.tracks.length <= 10) {
    return { tracks: [...opts.tracks], swapsPerformed: 0 };
  }

  let working = [...opts.tracks];
  let swapsPerformed = 0;
  const mode = detectArcMode(working);
  const beforePenalty = arcPenalty(working, mode);
  const end = Math.min(40, working.length);

  for (let i = 10; i < end; i++) {
    const prev = working[i - 1]!;
    const jump = Math.abs(microEnergyBucket(working[i]!) - microEnergyBucket(prev));
    if (jump <= 2 && Math.abs(intensityOf(working[i]!) - arcTargetAt(i - 10, end - 10, mode)) < 0.18) {
      continue;
    }

    let bestJ = -1;
    let bestPenalty = arcPenalty(working, mode);
    for (let j = 10; j < working.length; j++) {
      if (j === i) continue;
      if (sceneClusterId(working[i]!, opts.context) !== sceneClusterId(working[j]!, opts.context)) continue;
      const candidate = swapInRangeSafe(working, i, j, opts.context, 10);
      if (!candidate) continue;
      const penalty = arcPenalty(candidate, mode);
      if (penalty < bestPenalty - 0.01) {
        bestPenalty = penalty;
        bestJ = j;
      }
    }

    if (bestJ >= 0) {
      const candidate = swapInRangeSafe(working, i, bestJ, opts.context, 10)!;
      working = candidate;
      swapsPerformed++;
    }
  }

  const afterPenalty = arcPenalty(working, mode);
  if (afterPenalty > beforePenalty + 0.001) {
    return { tracks: [...opts.tracks], swapsPerformed: 0 };
  }

  return { tracks: working, swapsPerformed };
}

function embeddingClusterKey(track: EditorialPolishTrack): string {
  const emb = trackEmbedding(track);
  return emb.map((v) => Math.round(v * 10)).join(":");
}

function embeddingSimilar(a: EditorialPolishTrack, b: EditorialPolishTrack): boolean {
  return cosineSimilarity(trackEmbedding(a), trackEmbedding(b)) >= 0.93;
}

function repetitionViolationsFirst15(tracks: EditorialPolishTrack[]): number {
  let violations = 0;
  const artistCounts = new Map<string, number>();
  for (let i = 0; i < Math.min(15, tracks.length); i++) {
    const artist = artistKey(tracks[i]!);
    const next = (artistCounts.get(artist) ?? 0) + 1;
    artistCounts.set(artist, next);
    if (next > 2) violations++;
  }
  return violations;
}

export function repetitionHardClamp<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
}): { tracks: T[]; repetitionDemotions: number; embeddingStreakBreaks: number } {
  let working = [...opts.tracks];
  let repetitionDemotions = 0;
  let embeddingStreakBreaks = 0;

  for (let i = 0; i < Math.min(15, working.length); i++) {
    const artist = artistKey(working[i]!);
    if (countArtistInRange(working, artist, 0, 15) <= 2) continue;

    for (let j = 15; j < working.length; j++) {
      if (artistKey(working[j]!) === artist) continue;
      if (sceneClusterId(working[i]!, opts.context) !== sceneClusterId(working[j]!, opts.context)) continue;
      const next = [...working];
      next[i] = working[j]!;
      next[j] = working[i]!;
      if (repetitionViolationsFirst15(next) < repetitionViolationsFirst15(working)) {
        working = next;
        repetitionDemotions++;
        break;
      }
    }
  }

  for (let i = 5; i < working.length; i++) {
    const window = working.slice(i - 5, i + 1);
    const keys = window.map(embeddingClusterKey);
    const streakKey = keys[keys.length - 1]!;
    const streakLen = keys.filter((k) => k === streakKey).length;
    if (streakLen < 4) continue;

    for (let j = i + 1; j < working.length; j++) {
      if (sceneClusterId(working[i]!, opts.context) !== sceneClusterId(working[j]!, opts.context)) continue;
      if (embeddingSimilar(working[i]!, working[j]!)) continue;
      const next = [...working];
      next[i] = working[j]!;
      next[j] = working[i]!;
      let streak = 0;
      for (let k = Math.max(0, i - 5); k <= i; k++) {
        if (embeddingClusterKey(next[k]!) === embeddingClusterKey(next[i]!)) streak++;
      }
      if (streak < 4) {
        working = next;
        embeddingStreakBreaks++;
        break;
      }
    }
  }

  return { tracks: working, repetitionDemotions, embeddingStreakBreaks };
}

function identityDriftOpening10(
  tracks: EditorialPolishTrack[],
  signature: EditorialIdentitySignature,
  context: SceneWorldContext,
): number {
  const opening = tracks.slice(0, Math.min(10, tracks.length));
  if (opening.length === 0) return 1;
  const penalties = opening.map((track) => identityDeviationPenalty(track, signature, context));
  const meanPenalty = penalties.reduce((sum, v) => sum + v, 0) / penalties.length;
  return clamp01(1 - meanPenalty / 0.55);
}

export function editorialStabilityScore(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext | null,
  signature: EditorialIdentitySignature | null,
): EditorialStabilityScores {
  if (tracks.length === 0 || !context?.sceneClusters || !signature) {
    return {
      identityDriftScore: 1,
      repetitionRiskScore: 1,
      arcStabilityScore: 1,
      openingIntegrityScore: 1,
    };
  }

  const identityDriftScore = identityDriftOpening10(tracks, signature, context);
  const repetitionRiskScore = clamp01(1 - repetitionViolationsFirst15(tracks) * 0.25);
  const mode = detectArcMode(tracks);
  const arcStabilityScore = clamp01(1 - arcPenalty(tracks, mode) / Math.max(1, tracks.length * 0.12));
  const purity = openingDominantClusterPurity(tracks, context, 10);
  const openingPenalty = openingStabilityPenalty(tracks, signature, context);
  const openingIntegrityScore = clamp01(
    purity * 0.55 + (1 - Math.min(1, openingPenalty / 1.4)) * 0.45,
  );

  return {
    identityDriftScore,
    repetitionRiskScore,
    arcStabilityScore,
    openingIntegrityScore,
  };
}

export function applyHumanSaveabilityStabiliser<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext | null;
}): EditorialStabiliserResult<T> {
  const neutralScores = editorialStabilityScore(opts.tracks, opts.context, null);
  const neutralDiagnostics: EditorialStabiliserDiagnostics = {
    ...neutralScores,
    openingSwapsPerformed: 0,
    arcSwapsPerformed: 0,
    repetitionDemotions: 0,
    embeddingStreakBreaks: 0,
    applied: false,
  };

  if (opts.tracks.length === 0 || !opts.context?.active || !opts.context.sceneClusters) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  const signature = computeEditorialIdentitySignature(opts.tracks, opts.context);
  if (!signature) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  const beforeScores = editorialStabilityScore(opts.tracks, opts.context, signature);
  const beforePurity = openingDominantClusterPurity(opts.tracks, opts.context, 10);
  const beforeRepetition = repetitionViolationsFirst15(opts.tracks);
  const beforeIdentity = identityDriftOpening10(opts.tracks, signature, opts.context);

  const openingPass = opening10EditorialStabilityPass({
    tracks: opts.tracks,
    context: opts.context,
    signature,
  });
  const identityLock = enforceEditorialIdentityLock({
    tracks: openingPass.tracks,
    context: opts.context,
    signature,
  });
  const arcPass = microArcSmoothPass({
    tracks: identityLock.tracks,
    context: opts.context,
  });
  const repetitionPass = repetitionHardClamp({
    tracks: arcPass.tracks,
    context: opts.context,
  });

  let candidate = repetitionPass.tracks;
  if (!clusterIntegrityIntact(opts.tracks, candidate, opts.context)) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }
  if (!openingMembershipIntact(opts.tracks, candidate)) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  const afterPurity = openingDominantClusterPurity(candidate, opts.context, 10);
  if (afterPurity + 0.0001 < beforePurity || afterPurity < OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  const afterIdentity = identityDriftOpening10(candidate, signature, opts.context);
  const afterRepetition = repetitionViolationsFirst15(candidate);
  if (afterIdentity + 0.0001 < beforeIdentity || afterRepetition > beforeRepetition) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  const afterScores = editorialStabilityScore(candidate, opts.context, signature);
  const improved =
    afterScores.openingIntegrityScore >= beforeScores.openingIntegrityScore - 0.001 &&
    afterScores.identityDriftScore >= beforeScores.identityDriftScore - 0.001 &&
    afterScores.repetitionRiskScore >= beforeScores.repetitionRiskScore - 0.001;

  if (!improved && openingPass.swapsPerformed === 0 && identityLock.swapsPerformed === 0 &&
    arcPass.swapsPerformed === 0 && repetitionPass.repetitionDemotions === 0 &&
    repetitionPass.embeddingStreakBreaks === 0) {
    return {
      tracks: [...opts.tracks],
      diagnostics: {
        ...beforeScores,
        openingSwapsPerformed: 0,
        arcSwapsPerformed: 0,
        repetitionDemotions: 0,
        embeddingStreakBreaks: 0,
        applied: false,
      },
    };
  }

  if (!improved) {
    return { tracks: [...opts.tracks], diagnostics: neutralDiagnostics };
  }

  return {
    tracks: candidate,
    diagnostics: {
      ...afterScores,
      openingSwapsPerformed: openingPass.swapsPerformed + identityLock.swapsPerformed,
      arcSwapsPerformed: arcPass.swapsPerformed,
      repetitionDemotions: repetitionPass.repetitionDemotions,
      embeddingStreakBreaks: repetitionPass.embeddingStreakBreaks,
      applied: true,
    },
  };
}
