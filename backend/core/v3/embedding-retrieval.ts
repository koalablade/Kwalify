import type { LockedIntent, SceneLatentVector } from "./intent";
import type { UnifiedIntent } from "../unified-intent";

export interface SessionEmbeddingState {
  tasteVector: number[];
  moodVector: number[];
  sceneVector: number[];
  energyVector: number[];
  driftVector: number[];
}

export interface UserTasteState {
  longTermTasteVector: number[];
  shortTermSessionVector: number[];
  moodTrajectoryVector: number[];
  scenePreferenceVector: number[];
}

export interface PlaylistEmbedding {
  centroidVector: number[];
  energyCurveVector: number[];
  diversitySpreadVector: number[];
  emotionalArcVector: number[];
}

export interface UserMemoryGraph {
  listenedTracksEmbeddingGraph: number[][];
  sessionTransitions: number[][];
  skippedClusters: Record<string, number>;
  replayedClusters: Record<string, number>;
}

export interface RetrievalClusterEmbedding {
  id: string;
  centroidVector: number[];
  size: number;
  averageAffinity: number;
}

export interface RetrievalTrackLike {
  trackId: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}

export interface RetrievedCandidate<T extends RetrievalTrackLike> {
  track: T;
  embeddingAffinity: number;
  retrievalNeighborhood: string;
  componentAffinities: {
    scene: number;
    taste: number;
    mood: number;
    energy: number;
    drift: number;
  };
}

export interface RetrievalCloud<T extends RetrievalTrackLike> {
  tracks: Array<RetrievedCandidate<T>>;
  sessionState: SessionEmbeddingState;
  userTasteState: UserTasteState;
  playlistEmbedding: PlaylistEmbedding;
  memoryGraph: UserMemoryGraph;
  clusterEmbeddings: RetrievalClusterEmbedding[];
  neighborhoodCounts: Record<string, number>;
}

const VECTOR_DIMS = 10;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return new Array(VECTOR_DIMS).fill(0);
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

function blendVectors(parts: Array<{ vector: number[]; weight: number }>): number[] {
  const out = new Array(VECTOR_DIMS).fill(0);
  let totalWeight = 0;
  for (const part of parts) {
    totalWeight += part.weight;
    for (let i = 0; i < VECTOR_DIMS; i++) {
      out[i] += (part.vector[i] ?? 0) * part.weight;
    }
  }
  if (totalWeight > 0) {
    for (let i = 0; i < VECTOR_DIMS; i++) out[i] /= totalWeight;
  }
  return normalizeVector(out);
}

function sceneLatentToVector(scene?: SceneLatentVector | null): number[] {
  if (!scene) return normalizeVector([0.45, 0.48, 0.18, 0.20, 0.20, 0.35, 0.35, 0.18, 0.22, 0.50]);
  return normalizeVector([
    scene.energy,
    scene.valence,
    scene.nostalgia,
    scene.tension,
    scene.motion,
    scene.introspection,
    scene.warmth,
    scene.darkness,
    scene.socialness,
    scene.clarity,
  ]);
}

function trackToEmbedding(track: RetrievalTrackLike): number[] {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const instrumentalness = track.instrumentalness ?? 0.05;
  const speechiness = track.speechiness ?? 0.08;
  const tempoNorm = clamp01(((track.tempo ?? 110) - 60) / 140);
  const olderEra = track.releaseYear ? clamp01((2029 - track.releaseYear) / 70) : 0.35;

  return normalizeVector([
    energy * 0.8 + tempoNorm * 0.2,
    valence,
    acousticness * 0.35 + olderEra * 0.25,
    (1 - valence) * 0.45 + energy * 0.2 + speechiness * 0.1,
    tempoNorm * 0.35 + danceability * 0.35 + energy * 0.2,
    acousticness * 0.32 + instrumentalness * 0.18 + (1 - danceability) * 0.2 + (1 - valence) * 0.18,
    acousticness * 0.3 + valence * 0.32 + (1 - speechiness) * 0.12,
    (1 - valence) * 0.42 + (1 - acousticness) * 0.16 + speechiness * 0.1,
    danceability * 0.42 + energy * 0.26 + valence * 0.18,
    (1 - speechiness) * 0.28 + instrumentalness * 0.18 + (1 - Math.abs(energy - 0.48)) * 0.24,
  ]);
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return normalizeVector(new Array(VECTOR_DIMS).fill(0.5));
  const out = new Array(VECTOR_DIMS).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < VECTOR_DIMS; i++) out[i] += vector[i] ?? 0;
  }
  for (let i = 0; i < VECTOR_DIMS; i++) out[i] /= vectors.length;
  return normalizeVector(out);
}

function moodVector(intent: LockedIntent): number[] {
  const vector = new Array(VECTOR_DIMS).fill(0.35);
  if (intent.mood.includes("melancholic")) {
    vector[1] -= 0.22;
    vector[3] += 0.26;
    vector[5] += 0.20;
    vector[7] += 0.18;
  }
  if (intent.mood.includes("nostalgic")) {
    vector[2] += 0.38;
    vector[5] += 0.16;
    vector[6] += 0.12;
  }
  if (intent.mood.includes("warm")) {
    vector[1] += 0.16;
    vector[6] += 0.34;
  }
  if (intent.mood.includes("calm")) {
    vector[0] -= 0.18;
    vector[3] -= 0.12;
    vector[9] += 0.16;
  }
  if (intent.mood.includes("energised")) {
    vector[0] += 0.24;
    vector[4] += 0.20;
    vector[8] += 0.12;
  }
  return normalizeVector(vector.map(clamp01));
}

function energyVector(intent: LockedIntent): number[] {
  const energy =
    intent.energy === "high" ? 0.78 :
    intent.energy === "low" ? 0.28 :
    0.50;
  return normalizeVector([
    energy,
    0.50,
    0.25,
    0.25 + energy * 0.15,
    energy * 0.75,
    1 - energy * 0.45,
    0.42,
    0.22,
    energy * 0.55,
    0.58,
  ]);
}

function movingAverage(previous: number[], current: number[], alpha = 0.35): number[] {
  return blendVectors([
    { vector: previous, weight: 1 - alpha },
    { vector: current, weight: alpha },
  ]);
}

function spreadVector(vectors: number[][], center: number[]): number[] {
  if (vectors.length === 0) return new Array(VECTOR_DIMS).fill(0);
  const spread = new Array(VECTOR_DIMS).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < VECTOR_DIMS; i++) {
      spread[i] += Math.abs((vector[i] ?? 0) - (center[i] ?? 0));
    }
  }
  for (let i = 0; i < VECTOR_DIMS; i++) spread[i] /= vectors.length;
  return normalizeVector(spread);
}

function buildEnergyCurveVector<T extends RetrievalTrackLike>(tracks: T[]): number[] {
  if (tracks.length === 0) return normalizeVector(new Array(VECTOR_DIMS).fill(0.5));
  const ordered = [...tracks].sort((a, b) => (a.trackId > b.trackId ? 1 : -1));
  const buckets = new Array(VECTOR_DIMS).fill(0);
  const counts = new Array(VECTOR_DIMS).fill(0);
  ordered.forEach((track, index) => {
    const bucket = Math.min(VECTOR_DIMS - 1, Math.floor((index / Math.max(1, ordered.length)) * VECTOR_DIMS));
    buckets[bucket] += track.energy ?? 0.5;
    counts[bucket] += 1;
  });
  return normalizeVector(buckets.map((value, index) => value / Math.max(1, counts[index] ?? 0)));
}

function buildEmotionalArcVector<T extends RetrievalTrackLike>(tracks: T[]): number[] {
  if (tracks.length === 0) return normalizeVector(new Array(VECTOR_DIMS).fill(0.5));
  const ordered = [...tracks].sort((a, b) => (a.trackId > b.trackId ? 1 : -1));
  const buckets = new Array(VECTOR_DIMS).fill(0);
  const counts = new Array(VECTOR_DIMS).fill(0);
  ordered.forEach((track, index) => {
    const bucket = Math.min(VECTOR_DIMS - 1, Math.floor((index / Math.max(1, ordered.length)) * VECTOR_DIMS));
    const energy = track.energy ?? 0.5;
    const valence = track.valence ?? 0.5;
    buckets[bucket] += valence * 0.6 + energy * 0.4;
    counts[bucket] += 1;
  });
  return normalizeVector(buckets.map((value, index) => value / Math.max(1, counts[index] ?? 0)));
}

export function buildPlaylistEmbedding<T extends RetrievalTrackLike>(tracks: T[]): PlaylistEmbedding {
  const embeddings = tracks.map(trackToEmbedding);
  const centroidVector = centroid(embeddings);
  return {
    centroidVector,
    energyCurveVector: buildEnergyCurveVector(tracks),
    diversitySpreadVector: spreadVector(embeddings, centroidVector),
    emotionalArcVector: buildEmotionalArcVector(tracks),
  };
}

export function buildUserTasteState(
  sessionState: SessionEmbeddingState,
  playlistEmbedding: PlaylistEmbedding,
): UserTasteState {
  return {
    longTermTasteVector: blendVectors([
      { vector: sessionState.tasteVector, weight: 0.70 },
      { vector: playlistEmbedding.centroidVector, weight: 0.30 },
    ]),
    shortTermSessionVector: sessionState.sceneVector,
    moodTrajectoryVector: blendVectors([
      { vector: sessionState.moodVector, weight: 0.60 },
      { vector: playlistEmbedding.emotionalArcVector, weight: 0.40 },
    ]),
    scenePreferenceVector: blendVectors([
      { vector: sessionState.sceneVector, weight: 0.70 },
      { vector: playlistEmbedding.centroidVector, weight: 0.30 },
    ]),
  };
}

export function buildUserMemoryGraph<T extends RetrievalTrackLike>(
  tracks: T[],
  sessionState: SessionEmbeddingState,
): UserMemoryGraph {
  const listenedTracksEmbeddingGraph = tracks.slice(0, 50).map(trackToEmbedding);
  return {
    listenedTracksEmbeddingGraph,
    sessionTransitions: [
      sessionState.tasteVector,
      sessionState.sceneVector,
      sessionState.moodVector,
      sessionState.energyVector,
      sessionState.driftVector,
    ],
    skippedClusters: {},
    replayedClusters: {},
  };
}

export function buildSessionEmbeddingState<T extends RetrievalTrackLike>(
  tracks: T[],
  intent: LockedIntent,
  unifiedIntent?: UnifiedIntent,
): SessionEmbeddingState {
  const trackCentroid = centroid(tracks.map(trackToEmbedding));
  const sceneVector = unifiedIntent?.sceneVector ??
    sceneLatentToVector(intent.sceneIntent?.stableVibeVector ?? intent.sceneIntent?.sceneVector ?? null);
  const tasteVector = blendVectors([
    { vector: trackCentroid, weight: 0.65 },
    { vector: sceneVector, weight: 0.35 },
  ]);
  const mood = unifiedIntent?.emotionVector ?? moodVector(intent);
  const energy = unifiedIntent?.energyVector ?? energyVector(intent);
  const driftSeed = blendVectors([
    { vector: sceneVector, weight: 0.50 },
    { vector: trackCentroid, weight: 0.50 },
  ]);
  const driftVector = movingAverage(trackCentroid, driftSeed, 0.35);

  return {
    tasteVector,
    moodVector: mood,
    sceneVector,
    energyVector: energy,
    driftVector,
  };
}

function neighborhoodOf(componentAffinities: RetrievedCandidate<RetrievalTrackLike>["componentAffinities"]): string {
  const entries = [
    ["scene", componentAffinities.scene],
    ["taste", componentAffinities.taste],
    ["mood", componentAffinities.mood],
    ["energy", componentAffinities.energy],
  ] as const;
  return [...entries].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "scene";
}

export function retrieveCandidatesByEmbedding<T extends RetrievalTrackLike>(
  tracks: T[],
  intent: LockedIntent,
  unifiedIntent?: UnifiedIntent,
): RetrievalCloud<T> {
  const sessionState = buildSessionEmbeddingState(tracks, intent, unifiedIntent);
  const playlistEmbedding = buildPlaylistEmbedding(tracks);
  const userTasteState = buildUserTasteState(sessionState, playlistEmbedding);
  const memoryGraph = buildUserMemoryGraph(tracks, sessionState);
  const retrieved = tracks.map((track) => {
    const trackVector = trackToEmbedding(track);
    const scene = clamp01((cosineSimilarity(userTasteState.scenePreferenceVector, trackVector) + 1) / 2);
    const taste = clamp01((cosineSimilarity(userTasteState.longTermTasteVector, trackVector) + 1) / 2);
    const mood = clamp01((cosineSimilarity(userTasteState.moodTrajectoryVector, trackVector) + 1) / 2);
    const energy = clamp01((cosineSimilarity(sessionState.energyVector, trackVector) + 1) / 2);
    const driftSimilarity = clamp01((cosineSimilarity(sessionState.driftVector, trackVector) + 1) / 2);
    const drift = clamp01(1 - Math.max(0, driftSimilarity - 0.72));
    const componentAffinities = { scene, taste, mood, energy, drift };
    return {
      track,
      embeddingAffinity: clamp01(scene * 0.46 + taste * 0.22 + mood * 0.16 + energy * 0.10 + drift * 0.06),
      retrievalNeighborhood: neighborhoodOf(componentAffinities),
      componentAffinities,
    };
  });

  const neighborhoodCounts: Record<string, number> = {};
  for (const candidate of retrieved) {
    neighborhoodCounts[candidate.retrievalNeighborhood] = (neighborhoodCounts[candidate.retrievalNeighborhood] ?? 0) + 1;
  }
  const clusterEmbeddings = Object.keys(neighborhoodCounts).map((id) => {
    const clusterTracks = retrieved
      .filter((candidate) => candidate.retrievalNeighborhood === id);
    return {
      id,
      centroidVector: centroid(clusterTracks.map((candidate) => trackToEmbedding(candidate.track))),
      size: clusterTracks.length,
      averageAffinity: clusterTracks.reduce((sum, candidate) => sum + candidate.embeddingAffinity, 0) / Math.max(1, clusterTracks.length),
    };
  });

  return {
    tracks: retrieved.sort((a, b) => b.embeddingAffinity - a.embeddingAffinity),
    sessionState,
    userTasteState,
    playlistEmbedding,
    memoryGraph,
    clusterEmbeddings,
    neighborhoodCounts,
  };
}
