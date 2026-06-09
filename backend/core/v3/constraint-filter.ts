import { eraRangeFromBucket, normalizeLockedGenreFamily, type LockedIntent, type SceneIntent, type SceneLatentVector } from "./intent";
import type { ScoredTrack } from "./v3-score";

export interface FilterContext {
  intent: LockedIntent;
}

export type ConstraintTrackLike = {
  genreFamily?: string | null;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  laneEra?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  activityTags?: string[];
  _featureQualityPenalty?: number;
  _lanePenalty?: number;
};

function candidateGenreFamily(track: ConstraintTrackLike): string | null {
  return normalizeLockedGenreFamily(track.genreFamily) ??
    normalizeLockedGenreFamily(track.genrePrimary);
}

function hasUsableGenreClassification(track: ConstraintTrackLike): boolean {
  return !!candidateGenreFamily(track);
}

function eraAllowed(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  if (!intent.eraRange) return true;
  if (track.releaseYear !== null && track.releaseYear !== undefined) {
    return track.releaseYear >= intent.eraRange.start && track.releaseYear <= intent.eraRange.end;
  }
  const bucketRange = eraRangeFromBucket(track.laneEra);
  if (!bucketRange) return false;
  return bucketRange.end >= intent.eraRange.start && bucketRange.start <= intent.eraRange.end;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function danceable(track: ConstraintTrackLike): boolean {
  return (track.danceability ?? 0.5) >= 0.55 || (track.tempo ?? 110) >= 115;
}

function hashUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function addVectorSignal(vector: number[], key: string, weight: number): void {
  for (let i = 0; i < vector.length; i++) {
    vector[i] += hashUnit(`${key}:${i}`) * weight;
  }
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function latentArray(vector: SceneLatentVector): number[] {
  return [
    vector.energy,
    vector.valence,
    vector.nostalgia,
    vector.tension,
    vector.motion,
    vector.introspection,
    vector.warmth,
    vector.darkness,
    vector.socialness,
    vector.clarity,
  ];
}

function trackMomentHints(track: ConstraintTrackLike): string[] {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const tempo = track.tempo ?? 110;
  const hints: string[] = [];
  if (energy >= 0.35 && tempo >= 80) hints.push("open_road_escape", "aimless_movement");
  if (energy <= 0.65 && valence <= 0.75) hints.push("aimless_night_drive", "private_processing");
  if (acousticness >= 0.35 && valence <= 0.65) hints.push("memory_revisit", "nostalgic_discovery");
  if (valence >= 0.55 && energy >= 0.35) hints.push("seasonal_renewal");
  if (energy <= 0.55 && acousticness >= 0.25) hints.push("quiet_reflection", "focused_flow");
  if (energy >= 0.65 || danceable(track)) hints.push("energy_release");
  return hints;
}

function projectTrackToVector(track: ConstraintTrackLike, scene: SceneIntent): number[] {
  const vector = new Array(scene.sceneEmbedding.length || 24).fill(0);
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempoNorm = Math.max(0, Math.min(1, ((track.tempo ?? 110) - 60) / 140));
  const instrumentalness = track.instrumentalness ?? 0.05;
  const speechiness = track.speechiness ?? 0.08;
  const laneEra = track.laneEra ?? "any";

  if (laneEra !== "any") addVectorSignal(vector, `era:${laneEra}`, 0.22);
  for (const hint of trackMomentHints(track)) {
    addVectorSignal(vector, `moment:${hint}`, 0.24);
  }
  if (track.activityTags) {
    for (const tag of track.activityTags.slice(0, 4)) {
      addVectorSignal(vector, `activity:${tag}`, 0.18);
    }
  }

  vector[0] += clamp01((laneEra !== "20s" ? 0.45 : 0.15) + acousticness * 0.35) * 0.70;
  vector[1] += clamp01(energy * 0.45 + (tempoNorm >= 0.45 ? 0.25 : 0.10) + (valence <= 0.45 ? 0.20 : 0)) * 0.70;
  vector[2] += clamp01(valence * 0.65 + danceability * 0.25) * 0.60;
  vector[3] += clamp01((1 - valence) * 0.45 + energy * 0.25 + (tempoNorm >= 0.55 ? 0.15 : 0)) * 0.65;
  vector[4] += clamp01((1 - energy) * 0.45 + acousticness * 0.35 + (tempoNorm <= 0.30 ? 0.15 : 0)) * 0.65;
  vector[5] += energy * 0.55;
  vector[6] += Math.max(energy, danceability) * 0.65;
  vector[7] += (energy * 0.5 + acousticness * 0.25 + valence * 0.25) * 0.55;
  vector[8] += Math.abs(energy - valence) * 0.35 + instrumentalness * 0.10 + speechiness * 0.08;

  return normalizeVector(vector);
}

function projectTrackToSceneVector(track: ConstraintTrackLike): SceneLatentVector {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempoNorm = Math.max(0, Math.min(1, ((track.tempo ?? 110) - 60) / 140));
  const instrumentalness = track.instrumentalness ?? 0.05;
  const speechiness = track.speechiness ?? 0.08;
  return {
    energy: clamp01(energy * 0.80 + tempoNorm * 0.20),
    valence: clamp01(valence),
    nostalgia: clamp01(acousticness * 0.35 + (track.laneEra && track.laneEra !== "20s" ? 0.28 : 0.08)),
    tension: clamp01((1 - valence) * 0.45 + energy * 0.20 + speechiness * 0.12),
    motion: clamp01(tempoNorm * 0.35 + danceability * 0.35 + energy * 0.20),
    introspection: clamp01(acousticness * 0.32 + instrumentalness * 0.18 + (1 - danceability) * 0.20 + (1 - valence) * 0.18),
    warmth: clamp01(acousticness * 0.30 + valence * 0.32 + (1 - speechiness) * 0.12),
    darkness: clamp01((1 - valence) * 0.42 + (1 - acousticness) * 0.16 + speechiness * 0.10),
    socialness: clamp01(danceability * 0.42 + energy * 0.26 + valence * 0.18),
    clarity: clamp01((1 - speechiness) * 0.28 + instrumentalness * 0.18 + (1 - Math.abs(energy - 0.48)) * 0.24),
  };
}

export function computeSceneSimilarity(track: ConstraintTrackLike, scene: SceneIntent): number {
  const latentScore = cosineSimilarity(latentArray(scene.sceneVector), latentArray(projectTrackToSceneVector(track)));
  const projectedScore = cosineSimilarity(scene.sceneEmbedding, projectTrackToVector(track, scene));
  return latentScore * 0.70 + projectedScore * 0.30;
}

export function computeSceneAlignmentScore(track: ConstraintTrackLike, scene: SceneIntent): number {
  const latentScore = cosineSimilarity(latentArray(scene.sceneVector), latentArray(projectTrackToSceneVector(track)));
  const projectedScore = cosineSimilarity(scene.sceneEmbedding, projectTrackToVector(track, scene));
  const projectionDivergence = Math.max(0, Math.abs(projectedScore - latentScore) - 0.18);
  const confidenceLift = scene.sceneConfidence >= 0.68 ? 0.04 : 0;
  const fallbackDampener = scene.fallbackMode === "balanced_latent_centroid" ? 0.06 : 0;
  return clamp01(latentScore - projectionDivergence * 0.35 + confidenceLift - fallbackDampener);
}

export function trackMatchesConstraints(track: ConstraintTrackLike, intent: LockedIntent): boolean {
  if (!hasUsableGenreClassification(track)) return false;
  if (!eraAllowed(track, intent)) {
    track._lanePenalty = (track._lanePenalty ?? 0) + 0.3;
    return true;
  }
  const hasEnergy = typeof track.energy === "number";
  const hasValence = typeof track.valence === "number";
  if (!hasEnergy || !hasValence) {
    track._featureQualityPenalty = 0.4;
    return true;
  }
  return true;
}

export function filterCandidates<TTrack extends ConstraintTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  ctx: FilterContext
): Array<ScoredTrack<TTrack>> {
  return tracks.filter(({ track }) => trackMatchesConstraints(track, ctx.intent));
}
