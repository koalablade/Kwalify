/**
 * Final editorial human curation layer — post-interleaver, pre-gate polish only.
 *
 * Reorders within scene-cluster boundaries to improve playlist feel without
 * touching sampler, interleaver, world layer, clustering, or gate thresholds.
 */

import {
  buildTrackEmbedding,
  cosineSimilarity,
  type AudioVector,
} from "../../shared/embeddings/track-embeddings";
import {
  computeSceneClusterMembershipScore,
  openingDominantClusterPurity,
  OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
  trackInDominantSceneCluster,
} from "../scene-cohesion-clusters";
import type { SceneWorldContext, SceneWorldTrack } from "../scene-world-layer";

export type EditorialPolishTrack = SceneWorldTrack & {
  trackName?: string | null;
  clusterId?: string | null;
  clusterIds?: string[];
  sourceLane?: string;
  instrumentalness?: number | null;
};

export type EditorialLayerDiagnostics = {
  repetitionScore: number;
  arcScore: number;
  textureVarianceScore: number;
  flowScore: number;
  playlistEditorialScore: number;
  swapsPerformed: number;
  monotonyFixesApplied: number;
  reorderPassesApplied: number;
};

export type EditorialPolishResult<T extends EditorialPolishTrack> = {
  tracks: T[];
  diagnostics: EditorialLayerDiagnostics;
};

type ArcSection = "intro" | "build" | "plateau" | "resolution";

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

function sameOrAdjacentEnergyBand(a: EditorialPolishTrack, b: EditorialPolishTrack): boolean {
  const bandA = energyBand(a);
  const bandB = energyBand(b);
  return Math.abs(bandA - bandB) <= 1;
}

type TextureProfile = "acoustic" | "electronic" | "indie" | "rock" | "rhythmic" | "balanced";

function textureProfile(track: EditorialPolishTrack): TextureProfile {
  const acoustic = feature(track.acousticness);
  const energy = feature(track.energy);
  const dance = feature(track.danceability);
  const family = (track.genreFamily ?? track.genrePrimary ?? "").toLowerCase();
  if (acoustic >= 0.6) return "acoustic";
  if (energy >= 0.72 && dance >= 0.65) return "electronic";
  if (family.includes("rock") || family.includes("metal")) return "rock";
  if (family.includes("indie") || family.includes("alternative")) return "indie";
  if (dance >= 0.6) return "rhythmic";
  return "balanced";
}

function featureBucket(track: EditorialPolishTrack): string {
  return `${textureProfile(track)}:${energyBand(track)}`;
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

function arcSectionAt(position: number, total: number): ArcSection {
  if (total <= 3) return position === total - 1 ? "resolution" : "build";
  const t = position / Math.max(1, total - 1);
  if (t < 0.22) return "intro";
  if (t < 0.52) return "build";
  if (t < 0.78) return "plateau";
  return "resolution";
}

function targetEnergyAt(position: number, total: number): number {
  if (total <= 1) return 0.5;
  const t = position / (total - 1);
  if (t < 0.22) return 0.36 + (t / 0.22) * 0.12;
  if (t < 0.52) return 0.48 + ((t - 0.22) / 0.30) * 0.18;
  if (t < 0.78) return 0.66 + ((t - 0.52) / 0.26) * 0.12;
  return 0.70 - ((t - 0.78) / 0.22) * 0.22;
}

function transitionSimilarity(a: EditorialPolishTrack, b: EditorialPolishTrack): number {
  return cosineSimilarity(trackEmbedding(a), trackEmbedding(b));
}

function clusterPurityScore(tracks: EditorialPolishTrack[], context: SceneWorldContext | null): number {
  if (!context?.sceneClusters || tracks.length === 0) return 1;
  const dominantId = context.sceneClusters.dominantClusterId;
  const dominant = tracks.filter((track) => sceneClusterId(track, context) === dominantId).length;
  return dominant / tracks.length;
}

function countArtistInWindow(tracks: EditorialPolishTrack[], artist: string, endExclusive: number): number {
  const needle = artist.toLowerCase();
  let count = 0;
  for (let i = 0; i < Math.min(endExclusive, tracks.length); i++) {
    if ((tracks[i]?.artistName ?? "").toLowerCase() === needle) count++;
  }
  return count;
}

function openingTenIntact<T extends EditorialPolishTrack>(
  before: T[],
  after: T[],
  context: SceneWorldContext,
): boolean {
  if (before.length < 10 || after.length < 10) return true;
  const beforePurity = openingDominantClusterPurity(before, context, 10);
  const afterPurity = openingDominantClusterPurity(after, context, 10);
  if (afterPurity < OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY) return false;
  if (afterPurity < beforePurity - 0.001) return false;
  const beforeIds = new Set(before.slice(0, 10).map((t) => t.trackId));
  const afterIds = new Set(after.slice(0, 10).map((t) => t.trackId));
  if (beforeIds.size !== afterIds.size) return false;
  for (const id of beforeIds) {
    if (!afterIds.has(id)) return false;
  }
  return true;
}

function swapSafe<T extends EditorialPolishTrack>(
  tracks: T[],
  i: number,
  j: number,
  context: SceneWorldContext,
): boolean {
  if (i === j || i < 0 || j < 0 || i >= tracks.length || j >= tracks.length) return false;
  const touchesOpening = i < 10 || j < 10;
  if (touchesOpening && (i >= 10 || j >= 10)) return false;

  const a = tracks[i]!;
  const b = tracks[j]!;
  const clusterA = sceneClusterId(a, context);
  const clusterB = sceneClusterId(b, context);
  if (!clusterA || clusterA !== clusterB) return false;
  if (!sameOrAdjacentEnergyBand(a, b)) return false;

  const next = [...tracks];
  next[i] = b;
  next[j] = a;

  if (touchesOpening && !openingTenIntact(tracks, next, context)) return false;
  return true;
}

export function computeRepetitionScore(tracks: EditorialPolishTrack[]): number {
  if (tracks.length === 0) return 1;
  const opening = tracks.slice(0, Math.min(12, tracks.length));
  const artistCounts = new Map<string, number>();
  for (const track of opening) {
    const key = (track.artistName ?? "unknown").toLowerCase();
    artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
  }
  let artistPenalty = 0;
  for (const count of artistCounts.values()) {
    if (count > 2) artistPenalty += (count - 2) * 0.12;
  }

  let texturePenalty = 0;
  for (let i = 1; i < opening.length; i++) {
    if (textureProfile(opening[i]!) === textureProfile(opening[i - 1]!)) {
      texturePenalty += 0.04;
    }
  }

  let embeddingPenalty = 0;
  for (let i = 1; i < opening.length; i++) {
    const sim = transitionSimilarity(opening[i - 1]!, opening[i]!);
    if (sim >= 0.95) embeddingPenalty += 0.08;
  }

  return clamp01(1 - artistPenalty - texturePenalty - embeddingPenalty);
}

export function computeArcScore(tracks: EditorialPolishTrack[]): number {
  if (tracks.length <= 1) return 1;
  let alignment = 0;
  for (let i = 0; i < tracks.length; i++) {
    const target = targetEnergyAt(i, tracks.length);
    const actual = intensityOf(tracks[i]!);
    alignment += 1 - Math.min(1, Math.abs(target - actual) / 0.35);
  }
  return clamp01(alignment / tracks.length);
}

export function computeTextureVarianceScore(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext | null,
): number {
  if (!context?.sceneClusters || tracks.length === 0) return 1;
  const byCluster = new Map<string, TextureProfile[]>();
  for (const track of tracks) {
    const cluster = sceneClusterId(track, context);
    if (!cluster) continue;
    const list = byCluster.get(cluster) ?? [];
    list.push(textureProfile(track));
    byCluster.set(cluster, list);
  }
  if (byCluster.size === 0) return 1;

  let varianceSum = 0;
  for (const profiles of byCluster.values()) {
    if (profiles.length <= 1) {
      varianceSum += 1;
      continue;
    }
    const unique = new Set(profiles).size;
    varianceSum += clamp01(unique / Math.min(4, profiles.length));
  }
  return clamp01(varianceSum / byCluster.size);
}

export function computeEnergyVarianceScore(tracks: EditorialPolishTrack[]): number {
  if (tracks.length <= 3) return 1;
  let flatStreak = 0;
  let penalty = 0;
  for (let i = 1; i < tracks.length; i++) {
    const jump = Math.abs(intensityOf(tracks[i]!) - intensityOf(tracks[i - 1]!));
    if (jump < 0.04) {
      flatStreak++;
      if (flatStreak > 3) penalty += 0.06;
    } else {
      flatStreak = 0;
    }
  }
  return clamp01(1 - penalty);
}

export function computeTransitionSmoothnessScore(tracks: EditorialPolishTrack[]): number {
  if (tracks.length <= 1) return 1;
  let score = 0;
  for (let i = 1; i < tracks.length; i++) {
    const sim = transitionSimilarity(tracks[i - 1]!, tracks[i]!);
    if (sim >= 0.55 && sim <= 0.92) score += 1;
    else if (sim < 0.55) score += clamp01(sim / 0.55) * 0.6;
    else score += clamp01((1 - sim) / 0.08) * 0.5;
  }
  return clamp01(score / (tracks.length - 1));
}

export function computeNoveltyWithinClusterScore(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext | null,
): number {
  if (!context?.sceneClusters || tracks.length === 0) return 1;
  const byCluster = new Map<string, Set<string>>();
  for (const track of tracks) {
    const cluster = sceneClusterId(track, context);
    if (!cluster) continue;
    const artists = byCluster.get(cluster) ?? new Set<string>();
    artists.add((track.artistName ?? "unknown").toLowerCase());
    byCluster.set(cluster, artists);
  }
  if (byCluster.size === 0) return 1;
  let novelty = 0;
  for (const [cluster, artists] of byCluster) {
    const clusterTracks = tracks.filter((t) => sceneClusterId(t, context) === cluster);
    novelty += clamp01(artists.size / Math.max(2, clusterTracks.length * 0.55));
  }
  return clamp01(novelty / byCluster.size);
}

export function computeEditorialFlowScore(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext | null,
): number {
  const purity = clusterPurityScore(tracks, context);
  const repetition = computeRepetitionScore(tracks);
  const transitions = computeTransitionSmoothnessScore(tracks);
  const energyVariance = computeEnergyVarianceScore(tracks);
  const novelty = computeNoveltyWithinClusterScore(tracks, context);
  return clamp01(
    purity * 0.22 +
    repetition * 0.22 +
    transitions * 0.22 +
    energyVariance * 0.17 +
    novelty * 0.17,
  );
}

export function computePlaylistEditorialScore(
  tracks: EditorialPolishTrack[],
  context: SceneWorldContext | null,
): {
  repetitionScore: number;
  arcScore: number;
  textureVarianceScore: number;
  flowScore: number;
  playlistEditorialScore: number;
} {
  const repetitionScore = computeRepetitionScore(tracks);
  const arcScore = computeArcScore(tracks);
  const textureVarianceScore = computeTextureVarianceScore(tracks, context);
  const flowScore = computeEditorialFlowScore(tracks, context);
  const playlistEditorialScore = clamp01(
    repetitionScore * 0.28 +
    arcScore * 0.22 +
    textureVarianceScore * 0.20 +
    flowScore * 0.30,
  );
  return { repetitionScore, arcScore, textureVarianceScore, flowScore, playlistEditorialScore };
}

type SwapTrigger =
  | { kind: "repetition_artist"; position: number }
  | { kind: "repetition_embedding"; position: number }
  | { kind: "monotony_bucket"; position: number }
  | { kind: "weak_transition"; position: number }
  | { kind: "artist_cap"; position: number }
  | { kind: "contrast_needed"; position: number };

function detectSwapTriggers(tracks: EditorialPolishTrack[]): SwapTrigger[] {
  const triggers: SwapTrigger[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const artist = (track.artistName ?? "unknown").toLowerCase();

    if (i < 12 && countArtistInWindow(tracks, artist, i + 1) > 2) {
      triggers.push({ kind: "artist_cap", position: i });
    }
    if (i < 12 && countArtistInWindow(tracks, artist, 12) > 2) {
      triggers.push({ kind: "repetition_artist", position: i });
    }

    if (i > 0) {
      const sim = transitionSimilarity(tracks[i - 1]!, track);
      if (sim >= 0.95) triggers.push({ kind: "repetition_embedding", position: i });
      if (sim < 0.55 || sim > 0.97) triggers.push({ kind: "weak_transition", position: i });
    }

    if (i >= 3) {
      const bucket = featureBucket(track);
      const streak = [i - 3, i - 2, i - 1, i].every((idx) => featureBucket(tracks[idx]!) === bucket);
      if (streak) triggers.push({ kind: "monotony_bucket", position: i });
    }

    if (i >= 2) {
      const sims = [
        transitionSimilarity(tracks[i - 2]!, tracks[i - 1]!),
        transitionSimilarity(tracks[i - 1]!, track),
      ];
      if (sims.every((s) => s >= 0.93)) {
        triggers.push({ kind: "monotony_bucket", position: i });
      }
    }

    if (i > 0 && i % 7 === 0) {
      const window = tracks.slice(Math.max(0, i - 6), i + 1);
      const textures = new Set(window.map(textureProfile));
      if (textures.size < 2) triggers.push({ kind: "contrast_needed", position: i });
    }
  }
  return triggers;
}

function swapImprovementScore(
  tracks: EditorialPolishTrack[],
  i: number,
  j: number,
  context: SceneWorldContext,
): number {
  const before = computeEditorialFlowScore(tracks, context);
  const next = [...tracks];
  next[i] = tracks[j]!;
  next[j] = tracks[i]!;
  const after = computeEditorialFlowScore(next, context);
  return after - before;
}

export function editorialSwapPass<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
  maxSwaps?: number;
}): { tracks: T[]; swapsPerformed: number; monotonyFixesApplied: number } {
  const maxSwaps = opts.maxSwaps ?? Math.max(6, Math.ceil(opts.tracks.length * 0.18));
  let working = [...opts.tracks];
  let swapsPerformed = 0;
  let monotonyFixesApplied = 0;

  const triggers = detectSwapTriggers(working);
  for (const trigger of triggers) {
    if (swapsPerformed >= maxSwaps) break;
    const position = trigger.position;
    const current = working[position];
    if (!current) continue;
    const cluster = sceneClusterId(current, opts.context);
    if (!cluster) continue;

    let bestIdx = -1;
    let bestGain = 0.001;

    for (let j = 0; j < working.length; j++) {
      if (j === position) continue;
      if (position < 10 && j >= 10) continue;
      if (!swapSafe(working, position, j, opts.context)) continue;
      const candidate = working[j]!;
      if (sceneClusterId(candidate, opts.context) !== cluster) continue;

      if (trigger.kind === "repetition_artist") {
        const artist = (current.artistName ?? "").toLowerCase();
        if ((candidate.artistName ?? "").toLowerCase() === artist) continue;
      }
      if (trigger.kind === "repetition_embedding" || trigger.kind === "monotony_bucket") {
        const prev = working[position - 1];
        if (prev && transitionSimilarity(prev, candidate) >= 0.94) continue;
      }
      if (trigger.kind === "contrast_needed") {
        if (textureProfile(candidate) === textureProfile(current)) continue;
      }

      const gain = swapImprovementScore(working, position, j, opts.context);
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = j;
      }
    }

    if (bestIdx < 0) continue;
    const swapped = [...working];
    swapped[position] = working[bestIdx]!;
    swapped[bestIdx] = working[position]!;
    working = swapped;
    swapsPerformed++;
    if (trigger.kind === "monotony_bucket") monotonyFixesApplied++;
  }

  return { tracks: working, swapsPerformed, monotonyFixesApplied };
}

function flowPositionScore(
  track: EditorialPolishTrack,
  position: number,
  total: number,
  context: SceneWorldContext,
): number {
  const targetEnergy = targetEnergyAt(position, total);
  const energyFit = 1 - Math.min(1, Math.abs(intensityOf(track) - targetEnergy) / 0.35);
  const section = arcSectionAt(position, total);
  const texture = textureProfile(track);
  let sectionBonus = 0;
  if (section === "intro" && (texture === "acoustic" || texture === "balanced")) sectionBonus = 0.06;
  if (section === "build" && (texture === "rhythmic" || texture === "electronic")) sectionBonus = 0.06;
  if (section === "plateau" && texture !== "acoustic") sectionBonus = 0.04;
  if (section === "resolution" && (texture === "acoustic" || texture === "indie")) sectionBonus = 0.05;
  const membership = computeSceneClusterMembershipScore(track, context);
  return energyFit * 0.55 + sectionBonus + membership * 0.25;
}

export function applyEditorialFlowOrdering<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext;
}): { tracks: T[]; reorderPassesApplied: number } {
  if (opts.tracks.length <= 10) {
    return { tracks: [...opts.tracks], reorderPassesApplied: 0 };
  }

  const opening = opts.tracks.slice(0, 10);
  const tail = [...opts.tracks.slice(10)];
  const segments: Array<{ clusterId: string; tracks: T[]; startIndex: number }> = [];

  let cursor = 10;
  for (const track of tail) {
    const cluster = sceneClusterId(track, opts.context) ?? "unknown";
    const last = segments[segments.length - 1];
    if (last && last.clusterId === cluster) {
      last.tracks.push(track);
    } else {
      segments.push({ clusterId: cluster, tracks: [track], startIndex: cursor });
    }
    cursor++;
  }

  const reorderedTail: T[] = [];
  let reorderPassesApplied = 0;
  for (const segment of segments) {
    if (segment.tracks.length <= 1) {
      reorderedTail.push(...segment.tracks);
      continue;
    }
    reorderPassesApplied++;
    const sorted = [...segment.tracks].sort((a, b) => {
      const posA = reorderedTail.length;
      const posB = reorderedTail.length + 1;
      return flowPositionScore(b, posB, opts.tracks.length, opts.context) -
        flowPositionScore(a, posA, opts.tracks.length, opts.context);
    });
    reorderedTail.push(...sorted);
  }

  const merged = [...opening, ...reorderedTail];
  if (!openingTenIntact(opts.tracks, merged, opts.context)) {
    return { tracks: [...opts.tracks], reorderPassesApplied: 0 };
  }
  return { tracks: merged, reorderPassesApplied };
}

export function applyHumanSaveabilityPolishLayer<T extends EditorialPolishTrack>(opts: {
  tracks: T[];
  context: SceneWorldContext | null;
}): EditorialPolishResult<T> {
  if (opts.tracks.length === 0 || !opts.context?.active || !opts.context.sceneClusters) {
    const neutral = computePlaylistEditorialScore(opts.tracks, opts.context);
    return {
      tracks: [...opts.tracks],
      diagnostics: {
        ...neutral,
        swapsPerformed: 0,
        monotonyFixesApplied: 0,
        reorderPassesApplied: 0,
      },
    };
  }

  const swapResult = editorialSwapPass({
    tracks: opts.tracks,
    context: opts.context,
  });
  const flowResult = applyEditorialFlowOrdering({
    tracks: swapResult.tracks,
    context: opts.context,
  });

  const scores = computePlaylistEditorialScore(flowResult.tracks, opts.context);
  return {
    tracks: flowResult.tracks,
    diagnostics: {
      ...scores,
      swapsPerformed: swapResult.swapsPerformed,
      monotonyFixesApplied: swapResult.monotonyFixesApplied,
      reorderPassesApplied: flowResult.reorderPassesApplied,
    },
  };
}
