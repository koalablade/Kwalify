/**
 * User taste manifold — library-native genre/sonic space for scene projection.
 * Scene reshapes EXISTING user taste; it must not inject external genre aesthetics.
 */

import { getGenreFamily } from "../core/v3/global-diversity-controller";
import type { EnrichmentTrackInput } from "./track-semantic-enrichment";
import { inferDeepMusicSemanticsFromAudio } from "./music-semantic-inference";
import type { EmotionalMovement, RhythmicComplexity, SpatialFeel } from "./music-semantic-types";

export const TASTE_MANIFOLD_VERSION = "manifold-v2";

export type SonicCentroid = {
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
};

export type SemanticTextureCentroid = {
  energy: number;
  valence: number;
  grainScore: number;
  warmthScore: number;
  densityScore: number;
  rhythmScore: number;
  spatialWidth: number;
};

export type SemanticCluster = {
  clusterId: string;
  weight: number;
  trackCount: number;
  textureCentroid: SemanticTextureCentroid;
  dominantMovement: EmotionalMovement;
  dominantRhythm: RhythmicComplexity;
  dominantSpatial: SpatialFeel;
  sceneAffinity: Record<string, number>;
  secondaryGenreHints: Record<string, number>;
};

export type GenreCluster = {
  genreFamily: string;
  weight: number;
  trackCount: number;
  sonicCentroid: SonicCentroid;
};

export type UserTasteManifold = {
  version: typeof TASTE_MANIFOLD_VERSION;
  librarySize: number;
  /** Primary retrieval/manifold space — audio/texture semantics, not genre. */
  semanticClusters: SemanticCluster[];
  /** Secondary genre labels for library anchoring only. */
  dominantClusters: GenreCluster[];
  secondaryClusters: GenreCluster[];
  excludedClusters: string[];
  genreSupport: Record<string, number>;
  sonicCentroid: SonicCentroid;
  textureCentroid: SemanticTextureCentroid;
  artistClusters: string[];
  supportThreshold: number;
  manifoldSignature: string;
  semanticSignature: string;
};

export type ManifoldTrackInput = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
};

export type SceneProjection = {
  projectedGenreWeights: Record<string, number>;
  inManifoldAtmospheres: string[];
  filteredExternalGenres: string[];
};

const DEFAULT_SUPPORT_THRESHOLD = 0.06;
const MIN_CLUSTER_TRACKS = 2;

function normalizeGenre(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

function resolveTrackFamily(track: ManifoldTrackInput): string | null {
  const candidates = [
    track.genreFamily,
    track.genrePrimary,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  for (const candidate of candidates) {
    const family = getGenreFamily(normalizeGenre(candidate));
    if (family && family !== "unknown") return family;
  }
  return null;
}

function asEnrichmentInput(track: ManifoldTrackInput): EnrichmentTrackInput {
  return {
    trackId: track.trackId,
    trackName: track.trackName ?? "",
    artistName: track.artistName ?? "",
    albumName: "",
    energy: track.energy,
    valence: track.valence,
    tempo: track.tempo,
    danceability: track.danceability,
    acousticness: track.acousticness,
    instrumentalness: track.instrumentalness,
    spotifyArtistGenres: track.genres ?? undefined,
  };
}

function deepFromManifoldTrack(track: ManifoldTrackInput) {
  return inferDeepMusicSemanticsFromAudio(asEnrichmentInput(track));
}

function safeNum(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sonicFromTracks(tracks: ManifoldTrackInput[]): SonicCentroid {
  if (tracks.length === 0) {
    return { energy: 0.5, valence: 0.5, tempo: 120, danceability: 0.5, acousticness: 0.3, instrumentalness: 0.2 };
  }
  const sum = tracks.reduce(
    (acc, t) => ({
      energy: acc.energy + safeNum(t.energy, 0.5),
      valence: acc.valence + safeNum(t.valence, 0.5),
      tempo: acc.tempo + safeNum(t.tempo, 120),
      danceability: acc.danceability + safeNum(t.danceability, 0.5),
      acousticness: acc.acousticness + safeNum(t.acousticness, 0.3),
      instrumentalness: acc.instrumentalness + safeNum(t.instrumentalness, 0.2),
    }),
    { energy: 0, valence: 0, tempo: 0, danceability: 0, acousticness: 0, instrumentalness: 0 },
  );
  const n = tracks.length;
  return {
    energy: Math.round((sum.energy / n) * 1000) / 1000,
    valence: Math.round((sum.valence / n) * 1000) / 1000,
    tempo: Math.round(sum.tempo / n),
    danceability: Math.round((sum.danceability / n) * 1000) / 1000,
    acousticness: Math.round((sum.acousticness / n) * 1000) / 1000,
    instrumentalness: Math.round((sum.instrumentalness / n) * 1000) / 1000,
  };
}

const TEXTURE_SCORE = {
  grain: { smooth: 0.15, grainy: 0.75, raw: 0.9, crisp: 0.55 },
  warmth: { cold: 0.2, neutral: 0.5, warm: 0.8 },
  density: { sparse: 0.2, medium: 0.5, dense: 0.85 },
  rhythm: { minimal: 0.1, straight: 0.45, syncopated: 0.65, broken: 0.78, polyrhythmic: 0.88 },
  spatial: { tight: 0.15, intimate: 0.25, immersive: 0.45, atmospheric: 0.72, wide: 0.9 },
};

function textureCentroidFromTracks(tracks: ManifoldTrackInput[]): SemanticTextureCentroid {
  if (tracks.length === 0) {
    return { energy: 0.5, valence: 0.5, grainScore: 0.5, warmthScore: 0.5, densityScore: 0.5, rhythmScore: 0.5, spatialWidth: 0.5 };
  }
  let energy = 0;
  let valence = 0;
  let grain = 0;
  let warmth = 0;
  let density = 0;
  let rhythm = 0;
  let spatial = 0;
  for (const track of tracks) {
    const deep = deepFromManifoldTrack(track);
    energy += safeNum(track.energy, 0.5);
    valence += safeNum(track.valence, 0.5);
    grain += TEXTURE_SCORE.grain[deep.sonicTexture.grain];
    warmth += TEXTURE_SCORE.warmth[deep.sonicTexture.warmth];
    density += TEXTURE_SCORE.density[deep.sonicTexture.density];
    rhythm += TEXTURE_SCORE.rhythm[deep.rhythmicComplexity];
    spatial += TEXTURE_SCORE.spatial[deep.spatialFeel[0] ?? "atmospheric"];
  }
  const n = tracks.length;
  return {
    energy: Math.round((energy / n) * 1000) / 1000,
    valence: Math.round((valence / n) * 1000) / 1000,
    grainScore: Math.round((grain / n) * 1000) / 1000,
    warmthScore: Math.round((warmth / n) * 1000) / 1000,
    densityScore: Math.round((density / n) * 1000) / 1000,
    rhythmScore: Math.round((rhythm / n) * 1000) / 1000,
    spatialWidth: Math.round((spatial / n) * 1000) / 1000,
  };
}

function rhythmClusterBucket(rhythm: RhythmicComplexity): string {
  if (rhythm === "minimal" || rhythm === "straight") return "low-motion-rhythm";
  return "rhythm-forward";
}

function densityClusterBucket(density: string): string {
  return density === "sparse" ? "sparse" : "filled";
}

function semanticClusterKey(track: ManifoldTrackInput): string {
  const deep = deepFromManifoldTrack(track);
  return [
    rhythmClusterBucket(deep.rhythmicComplexity),
    densityClusterBucket(deep.sonicTexture.density),
  ].join(":");
}

function buildSemanticClusters(tracks: ManifoldTrackInput[], librarySize: number): SemanticCluster[] {
  const byKey = new Map<string, ManifoldTrackInput[]>();
  for (const track of tracks) {
    const key = semanticClusterKey(track);
    const bucket = byKey.get(key) ?? [];
    bucket.push(track);
    byKey.set(key, bucket);
  }

  const clusters: SemanticCluster[] = [];
  for (const [clusterId, clusterTracks] of byKey.entries()) {
    if (clusterTracks.length < MIN_CLUSTER_TRACKS) continue;
    const weight = clusterTracks.length / Math.max(1, librarySize);
    const sample = deepFromManifoldTrack(clusterTracks[0]!);
    const genreHints: Record<string, number> = {};
    for (const t of clusterTracks) {
      const family = resolveTrackFamily(t);
      if (family) genreHints[family] = (genreHints[family] ?? 0) + 1 / clusterTracks.length;
    }
    clusters.push({
      clusterId,
      weight,
      trackCount: clusterTracks.length,
      textureCentroid: textureCentroidFromTracks(clusterTracks),
      dominantMovement: sample.emotionalMovement,
      dominantRhythm: sample.rhythmicComplexity,
      dominantSpatial: sample.spatialFeel[0] ?? "atmospheric",
      sceneAffinity: {},
      secondaryGenreHints: genreHints,
    });
  }
  return clusters.sort((a, b) => b.weight - a.weight).slice(0, 8);
}

/** Atmosphere → preferred texture shape (semantic projection, not genre). */
const ATMOSPHERE_TEXTURE_TARGET: Record<string, Partial<SemanticTextureCentroid>> = {
  mystery: { energy: 0.38, grainScore: 0.45, densityScore: 0.35, spatialWidth: 0.35, rhythmScore: 0.3 },
  nocturnal: { energy: 0.35, grainScore: 0.55, densityScore: 0.3, spatialWidth: 0.65, rhythmScore: 0.35 },
  epic: { energy: 0.58, spatialWidth: 0.85, densityScore: 0.55, rhythmScore: 0.45 },
  industrial: { energy: 0.58, grainScore: 0.75, densityScore: 0.7, spatialWidth: 0.25, rhythmScore: 0.65 },
  cozy: { energy: 0.35, warmthScore: 0.65, densityScore: 0.3, spatialWidth: 0.4, rhythmScore: 0.2 },
  futuristic: { energy: 0.48, grainScore: 0.55, spatialWidth: 0.75, rhythmScore: 0.45 },
};

function textureDistance(a: SemanticTextureCentroid, target: Partial<SemanticTextureCentroid>): number {
  const keys: Array<keyof SemanticTextureCentroid> = [
    "energy", "valence", "grainScore", "warmthScore", "densityScore", "rhythmScore", "spatialWidth",
  ];
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    if (target[key] == null) continue;
    sum += Math.abs(a[key] - (target[key] as number));
    count += 1;
  }
  return count > 0 ? sum / count : 0.5;
}

/** Legacy sonic targets — used as fallback for genre cluster projection. */
const ATMOSPHERE_SONIC_TARGET: Record<string, Partial<SonicCentroid>> = {
  mystery: { energy: 0.38, valence: 0.38, instrumentalness: 0.55, acousticness: 0.45 },
  suspense: { energy: 0.42, valence: 0.32, instrumentalness: 0.5 },
  vintage: { energy: 0.4, valence: 0.42, acousticness: 0.55 },
  detective: { energy: 0.38, valence: 0.4, instrumentalness: 0.48 },
  nocturnal: { energy: 0.35, valence: 0.35, instrumentalness: 0.45 },
  urban: { energy: 0.52, valence: 0.4, danceability: 0.58 },
  foreboding: { energy: 0.45, valence: 0.28, instrumentalness: 0.4 },
  epic: { energy: 0.62, valence: 0.55, instrumentalness: 0.5 },
  wonder: { energy: 0.48, valence: 0.58, instrumentalness: 0.45 },
  romantic: { energy: 0.38, valence: 0.48, acousticness: 0.5 },
  melancholy: { energy: 0.32, valence: 0.28, instrumentalness: 0.35 },
  cozy: { energy: 0.35, valence: 0.48, acousticness: 0.55, instrumentalness: 0.4 },
  futuristic: { energy: 0.48, valence: 0.38, instrumentalness: 0.55, danceability: 0.52 },
  industrial: { energy: 0.58, valence: 0.35, danceability: 0.55 },
  adventure: { energy: 0.55, valence: 0.52, tempo: 118 },
};

function sonicDistance(a: SonicCentroid, target: Partial<SonicCentroid>): number {
  const keys: Array<keyof SonicCentroid> = ["energy", "valence", "danceability", "acousticness", "instrumentalness"];
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    if (target[key] == null) continue;
    sum += Math.abs(a[key] - (target[key] as number));
    count += 1;
  }
  if (target.tempo != null) {
    sum += Math.min(1, Math.abs(a.tempo - target.tempo) / 80);
    count += 1;
  }
  return count > 0 ? sum / count : 0.5;
}

export function buildUserTasteManifold(tracks: ManifoldTrackInput[]): UserTasteManifold {
  const byFamily = new Map<string, ManifoldTrackInput[]>();
  const artistCounts = new Map<string, number>();

  for (const track of tracks) {
    const family = resolveTrackFamily(track);
    if (!family) continue;
    const bucket = byFamily.get(family) ?? [];
    bucket.push(track);
    byFamily.set(family, bucket);
    const artist = (track.artistName ?? "").trim();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  const librarySize = tracks.length;
  const threshold = librarySize <= 80 ? 0.04 : DEFAULT_SUPPORT_THRESHOLD;
  const genreSupport: Record<string, number> = {};
  const clusters: GenreCluster[] = [];

  for (const [family, familyTracks] of byFamily.entries()) {
    const weight = familyTracks.length / Math.max(1, librarySize);
    genreSupport[family] = Math.round(weight * 1000) / 1000;
    if (familyTracks.length >= MIN_CLUSTER_TRACKS) {
      clusters.push({
        genreFamily: family,
        weight,
        trackCount: familyTracks.length,
        sonicCentroid: sonicFromTracks(familyTracks),
      });
    }
  }

  clusters.sort((a, b) => b.weight - a.weight);
  const dominantClusters = clusters.filter((c) => c.weight >= threshold).slice(0, 4);
  const secondaryClusters = clusters.filter((c) => c.weight < threshold && c.weight >= threshold * 0.45).slice(0, 4);
  const excludedClusters = [...byFamily.keys()].filter((family) => (genreSupport[family] ?? 0) < threshold * 0.45);

  const artistClusters = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([name]) => name);

  const signature = dominantClusters.map((c) => `${c.genreFamily}:${c.weight.toFixed(2)}`).join("|");
  const semanticClusters = buildSemanticClusters(tracks, librarySize);
  const semanticSignature = semanticClusters.map((c) => `${c.clusterId}:${c.weight.toFixed(2)}`).join("|");

  return {
    version: TASTE_MANIFOLD_VERSION,
    librarySize,
    semanticClusters,
    dominantClusters,
    secondaryClusters,
    excludedClusters,
    genreSupport,
    sonicCentroid: sonicFromTracks(tracks),
    textureCentroid: textureCentroidFromTracks(tracks),
    artistClusters,
    supportThreshold: threshold,
    manifoldSignature: signature,
    semanticSignature,
  };
}

export function genreSupportCheck(manifold: UserTasteManifold, genre: string): boolean {
  const key = normalizeGenre(genre);
  const family = getGenreFamily(key) ?? key;
  return (manifold.genreSupport[family] ?? 0) >= manifold.supportThreshold;
}

export function filterSceneAliasesThroughManifold(
  aliases: string[],
  manifold: UserTasteManifold | null | undefined,
): string[] {
  if (!manifold || aliases.length === 0) return aliases;
  return aliases.filter((alias) => genreSupportCheck(manifold, alias));
}

export function filterGenreHintsThroughManifold(
  hints: string[],
  manifold: UserTasteManifold | null | undefined,
): { inManifold: string[]; blocked: string[] } {
  if (!manifold) return { inManifold: hints, blocked: [] };
  const inManifold: string[] = [];
  const blocked: string[] = [];
  for (const hint of hints) {
    if (genreSupportCheck(manifold, hint)) inManifold.push(hint);
    else blocked.push(hint);
  }
  return { inManifold, blocked };
}

export function filterScenePredictionThroughManifold(
  prediction: Record<string, number>,
  manifold: UserTasteManifold | null | undefined,
): Record<string, number> {
  if (!manifold) return prediction;
  const filtered: Record<string, number> = {};
  for (const [key, weight] of Object.entries(prediction)) {
    if (genreSupportCheck(manifold, key)) filtered[key] = weight;
  }
  return filtered;
}

export function trackManifoldCompatible(
  track: ManifoldTrackInput,
  manifold: UserTasteManifold | null | undefined,
): boolean {
  if (!manifold) return true;
  const family = resolveTrackFamily(track);
  if (!family) return true;
  return genreSupportCheck(manifold, family);
}

export function trackManifoldAffinity(
  track: ManifoldTrackInput,
  manifold: UserTasteManifold,
): number {
  const deep = deepFromManifoldTrack(track);
  const trackTexture: SemanticTextureCentroid = {
    energy: safeNum(track.energy, 0.5),
    valence: safeNum(track.valence, 0.5),
    grainScore: TEXTURE_SCORE.grain[deep.sonicTexture.grain],
    warmthScore: TEXTURE_SCORE.warmth[deep.sonicTexture.warmth],
    densityScore: TEXTURE_SCORE.density[deep.sonicTexture.density],
    rhythmScore: TEXTURE_SCORE.rhythm[deep.rhythmicComplexity],
    spatialWidth: TEXTURE_SCORE.spatial[deep.spatialFeel[0] ?? "atmospheric"],
  };

  let bestSemantic = 0;
  for (const cluster of manifold.semanticClusters) {
    const distance = textureDistance(trackTexture, cluster.textureCentroid);
    bestSemantic = Math.max(bestSemantic, cluster.weight * (1 - distance));
  }

  const family = resolveTrackFamily(track);
  const genreBase = family ? (manifold.genreSupport[family] ?? 0) * 0.08 : 0;

  return Math.min(0.2, bestSemantic * 0.16 + genreBase);
}

export function projectSceneOntoManifold(
  atmospheres: string[],
  culturalTags: string[],
  sceneId: string | null,
  manifold: UserTasteManifold,
): SceneProjection {
  const textureTargets: Partial<SemanticTextureCentroid>[] = [];
  for (const atmosphere of atmospheres) {
    const target = ATMOSPHERE_TEXTURE_TARGET[atmosphere];
    if (target) textureTargets.push(target);
  }
  if (culturalTags.some((t) => t.includes("noir") || t.includes("detective"))) {
    textureTargets.push(ATMOSPHERE_TEXTURE_TARGET.mystery!);
  }
  if (sceneId?.includes("tokyo") || sceneId?.includes("night")) {
    textureTargets.push(ATMOSPHERE_TEXTURE_TARGET.nocturnal!);
  }

  const mergedTexture: Partial<SemanticTextureCentroid> = {};
  if (textureTargets.length > 0) {
    const keys: Array<keyof SemanticTextureCentroid> = [
      "energy", "valence", "grainScore", "warmthScore", "densityScore", "rhythmScore", "spatialWidth",
    ];
    for (const key of keys) {
      const values = textureTargets.map((t) => t[key]).filter((v): v is number => typeof v === "number");
      if (values.length > 0) mergedTexture[key] = values.reduce((a, b) => a + b, 0) / values.length;
    }
  }

  const projectedGenreWeights: Record<string, number> = {};
  for (const cluster of manifold.semanticClusters) {
    const distance = textureDistance(cluster.textureCentroid, mergedTexture);
    const affinity = Math.max(0, 1 - distance);
    for (const [genre, hintWeight] of Object.entries(cluster.secondaryGenreHints)) {
      projectedGenreWeights[genre] = Math.round(
        ((projectedGenreWeights[genre] ?? 0) + cluster.weight * affinity * hintWeight * 0.55) * 1000,
      ) / 1000;
    }
  }

  if (Object.keys(projectedGenreWeights).length === 0) {
    const sonicTargets: Partial<SonicCentroid>[] = [];
    for (const atmosphere of atmospheres) {
      const target = ATMOSPHERE_SONIC_TARGET[atmosphere];
      if (target) sonicTargets.push(target);
    }
    const mergedSonic: Partial<SonicCentroid> = {};
    if (sonicTargets.length > 0) {
      const keys: Array<keyof SonicCentroid> = ["energy", "valence", "tempo", "danceability", "acousticness", "instrumentalness"];
      for (const key of keys) {
        const values = sonicTargets.map((t) => t[key]).filter((v): v is number => typeof v === "number");
        if (values.length > 0) mergedSonic[key] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }
    for (const cluster of [...manifold.dominantClusters, ...manifold.secondaryClusters]) {
      const distance = sonicDistance(cluster.sonicCentroid, mergedSonic);
      const affinity = Math.max(0, 1 - distance);
      projectedGenreWeights[cluster.genreFamily] = Math.round((cluster.weight * (0.55 + affinity * 0.45)) * 1000) / 1000;
    }
  }

  const externalHints = ["jazz", "classical", "orchestral", "soundtrack", "folk", "ambient"];
  const filteredExternalGenres = externalHints.filter((g) => !genreSupportCheck(manifold, g));

  for (const genre of Object.keys(projectedGenreWeights)) {
    if (!genreSupportCheck(manifold, genre)) {
      delete projectedGenreWeights[genre];
    }
  }

  return {
    projectedGenreWeights,
    inManifoldAtmospheres: atmospheres,
    filteredExternalGenres,
  };
}

export function mergeProjectedWeightsIntoPrediction(
  base: Record<string, number>,
  projection: SceneProjection,
): Record<string, number> {
  const merged = { ...base };
  for (const [genre, weight] of Object.entries(projection.projectedGenreWeights)) {
    merged[genre] = Math.round(((merged[genre] ?? 0) + weight * 0.35) * 100) / 100;
  }
  return merged;
}

export function manifoldRetrievalPenalty(
  track: ManifoldTrackInput,
  manifold: UserTasteManifold | null | undefined,
  sceneStrength: number,
): number {
  if (!manifold || sceneStrength < 0.35) return 0;
  if (trackManifoldCompatible(track, manifold)) return 0;
  return Math.min(0.14, 0.06 + sceneStrength * 0.08);
}
