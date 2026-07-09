/**
 * V11 Track Embedding Engine — audio-feature pseudo-embeddings.
 *
 * Replaces keyword/rule-based scene matching with vector similarity as the
 * PRIMARY scoring signal (60% weight). No external ML required — uses the
 * Spotify audio features already stored on every track.
 *
 * Embedding space (7 dimensions):
 *   [energy, valence, danceability, acousticness_inv, instrumentalness, speechiness_inv, tempo_norm]
 *
 * Design notes:
 *   - acousticness is inverted so electronic/loud tracks score alongside high-energy
 *   - speechiness is inverted so sung tracks (low speechiness) score the same dimension high
 *   - tempo is normalized to [0, 1] by dividing by 200 BPM
 *   - cosine similarity is used everywhere — magnitude-invariant, range-stable
 *
 * V11 spec references:
 *   - STAGE 1: Embedding layer (replaces scene/genre keyword logic)
 *   - STAGE 2: Candidate retrieval by similarity
 *   - STAGE 3: Soft reranking (embeddingSim × 0.60 dominant)
 *   - STAGE 4: Novelty / taste memory
 */

import type { EmotionProfile } from "../../lib/emotion";
import type { SemanticSceneVector } from "../../lib/semantic-scene-engine";

export type AudioVector = [number, number, number, number, number, number, number];

/**
 * Build a 7D audio feature embedding for a single track.
 * Null features fall back to perceptually neutral defaults.
 */
export function buildTrackEmbedding(track: {
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo: number | null;
}): AudioVector {
  return [
    track.energy ?? 0.5,
    track.valence ?? 0.5,
    track.danceability ?? 0.5,
    1 - (track.acousticness ?? 0.5),
    track.instrumentalness ?? 0.05,
    1 - Math.min(1, track.speechiness ?? 0.05),
    Math.min(1, (track.tempo ?? 120) / 200),
  ];
}

/**
 * Build a query embedding from the emotion profile.
 *
 * Maps the emotion profile's energy/valence targets into the full 7D space.
 * All dimensions are derived analytically — no ML inference needed.
 *
 * Override hints (from scene vector energy target, sonic profile, etc.) are
 * accepted via `opts` so the scoring engine can pass scene-level targets
 * directly into the query vector for tighter precision on explicit scenes.
 */
export function buildQueryEmbedding(
  profile: EmotionProfile,
  opts: {
    energyTarget?: number;
    danceabilityHint?: number;
    acousticnessHint?: number;
    instrumentalnessHint?: number;
    tempoHint?: number;
  } = {}
): AudioVector {
  const energy = opts.energyTarget ?? profile.energy;
  const valence = profile.valence;

  // Danceability correlates with energy + positive valence
  const danceability =
    opts.danceabilityHint ??
    Math.min(1, Math.max(0, energy * 0.55 + valence * 0.30 + 0.15));

  // Low-energy prompts tend to be acoustic; high-energy are electric
  const acousticness =
    opts.acousticnessHint ??
    Math.max(0, 0.75 - energy * 0.85);
  const acousticnessInv = 1 - acousticness;

  const instrumentalness = opts.instrumentalnessHint ?? 0.05;

  // Tempo roughly tracks energy
  const tempoNorm =
    opts.tempoHint != null
      ? Math.min(1, opts.tempoHint / 200)
      : Math.min(1, 0.38 + energy * 0.52);

  return [
    energy,
    valence,
    danceability,
    acousticnessInv,
    instrumentalness,
    0.95, // speechiness_inv: almost all playlist tracks are sung
    tempoNorm,
  ];
}

/** Scene-primary query blend — reduces cross-prompt embedding collapse from raw emotion alone. */
const SCENE_QUERY_BLEND = 0.65;
const EMOTION_QUERY_BLEND = 1 - SCENE_QUERY_BLEND;

function sceneValenceHint(sceneVector: SemanticSceneVector): number {
  const aesthetics = sceneVector.aesthetics.join(" ").toLowerCase();
  if (aesthetics.includes("melanchol") || aesthetics.includes("dark")) return 0.32;
  if (aesthetics.includes("uplift") || aesthetics.includes("bright")) return 0.68;
  if (sceneVector.energy.target < 0.4) return 0.42;
  if (sceneVector.energy.target > 0.72) return 0.58;
  return 0.5;
}

/**
 * Intent/scene-conditioned query embedding — scene targets dominate; emotion profile is a minority blend.
 */
export function buildIntentConditionedQueryEmbedding(
  profile: EmotionProfile,
  sceneVector: SemanticSceneVector | null | undefined,
  opts: {
    energyTarget?: number;
    danceabilityHint?: number;
    acousticnessHint?: number;
    instrumentalnessHint?: number;
    tempoHint?: number;
  } = {},
): AudioVector {
  if (!sceneVector) {
    return buildQueryEmbedding(profile, opts);
  }

  const sceneEnergy = opts.energyTarget ?? sceneVector.energy.target;
  const sceneValence = sceneValenceHint(sceneVector);
  const blendedProfile: EmotionProfile = {
    ...profile,
    energy: profile.energy * EMOTION_QUERY_BLEND + sceneEnergy * SCENE_QUERY_BLEND,
    valence: profile.valence * EMOTION_QUERY_BLEND + sceneValence * SCENE_QUERY_BLEND,
  };

  const acousticGenres = ["country", "folk", "blues", "classical", "jazz"];
  const electronicGenres = ["electronic"];
  const topGenre = sceneVector.genreEcosystem[0]?.genre ?? "";
  const acousticnessHint =
    opts.acousticnessHint ??
    (acousticGenres.includes(topGenre)
      ? 0.7
      : electronicGenres.includes(topGenre)
        ? 0.1
        : sceneEnergy < 0.42
          ? 0.62
          : undefined);

  const instrumentalnessHint =
    opts.instrumentalnessHint ??
    (sceneVector.aesthetics.some((a) => a.includes("instrumental") || a.includes("ambient"))
      ? 0.6
      : undefined);

  return buildQueryEmbedding(blendedProfile, {
    energyTarget: sceneEnergy,
    danceabilityHint: opts.danceabilityHint,
    acousticnessHint,
    instrumentalnessHint,
    tempoHint: opts.tempoHint,
  });
}

/**
 * Cosine similarity between two audio vectors.
 * Always returns a value in [0, 1].
 */
export function cosineSimilarity(a: AudioVector, b: AudioVector): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < 7; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) * (a[i] ?? 0);
    magB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Build the user's taste centroid — average audio feature vector across their library.
 *
 * V11 "userTasteVector": persists across sessions to enable personalization.
 * In this implementation it is computed fresh per-request from the liked-songs library.
 * Future: decay and persist this in the DB (V11 spec §USER TASTE MEMORY).
 */
export function buildUserTasteVector(
  tracks: {
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    acousticness: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
    tempo: number | null;
  }[]
): AudioVector {
  if (tracks.length === 0) return [0.5, 0.5, 0.5, 0.5, 0.05, 0.95, 0.60];

  const sum: AudioVector = [0, 0, 0, 0, 0, 0, 0];
  let count = 0;
  for (const t of tracks) {
    // Only include tracks with at least one non-null audio feature
    if (t.energy === null && t.valence === null) continue;
    const v = buildTrackEmbedding(t);
    for (let i = 0; i < 7; i++) sum[i] += v[i] ?? 0;
    count++;
  }

  if (count === 0) return [0.5, 0.5, 0.5, 0.5, 0.05, 0.95, 0.60];
  return sum.map((s) => s / count) as AudioVector;
}

/**
 * Novelty score: how surprising/different a track is from the user's taste centroid.
 *
 * V11 spec: noveltyScore = distance(trackEmbedding, userTasteVector)
 * Returns 0–1 where 1 = maximally novel.
 *
 * A small base (0.08) ensures no track gets zero novelty — even very familiar-sounding
 * tracks retain some discovery potential.
 *
 * Used at 10% weight in the V11 scoring formula to ensure playlists contain
 * discoveries without abandoning the user's core aesthetic.
 */
export function computeNoveltyScore(
  trackEmbedding: AudioVector,
  userTasteVector: AudioVector
): number {
  const similarity = cosineSimilarity(trackEmbedding, userTasteVector);
  return Math.min(1, (1 - similarity) * 0.92 + 0.08);
}

/**
 * Session mood vector — starts as the query embedding, could evolve as tracks are selected.
 *
 * V11 spec: sessionMoodVector evolves during playlist generation toward selected tracks.
 * Current implementation: static query embedding (state-free, deterministic).
 * Future: blend queryEmbedding with centroid of already-selected tracks.
 */
export function buildSessionMoodVector(
  queryEmbedding: AudioVector,
  selectedTrackEmbeddings: AudioVector[] = []
): AudioVector {
  if (selectedTrackEmbeddings.length === 0) return queryEmbedding;

  // Blend 70% query + 30% selected centroid for gentle drift
  const centroid: AudioVector = [0, 0, 0, 0, 0, 0, 0];
  for (const emb of selectedTrackEmbeddings) {
    for (let i = 0; i < 7; i++) centroid[i] += (emb[i] ?? 0) / selectedTrackEmbeddings.length;
  }

  return queryEmbedding.map((q, i) => q * 0.7 + (centroid[i] ?? 0) * 0.3) as AudioVector;
}

/**
 * Era cluster — maps a track's "add date" or stylistic era to a cluster label.
 * Used for the diversity engine's era cap (max 40% same era cluster).
 */
export type EraCluster = "pre80s" | "80s" | "90s" | "00s" | "10s" | "modern" | "unknown";

export function detectEraCluster(addedAt: Date | null, releaseYear?: number | null): EraCluster {
  const year = releaseYear ?? null;
  if (!year) return "unknown";
  if (year < 1980) return "pre80s";
  if (year < 1990) return "80s";
  if (year < 2000) return "90s";
  if (year < 2010) return "00s";
  if (year < 2020) return "10s";
  return "modern";
}

/**
 * Energy band classification for diversity engine.
 * Used for era/energy cap (max 40% same energy band).
 */
export type EnergyBand = "low" | "mid" | "high";

export function detectEnergyBand(energy: number | null): EnergyBand {
  if (energy === null) return "mid";
  if (energy < 0.38) return "low";
  if (energy < 0.68) return "mid";
  return "high";
}

/**
 * V11 Diversity multiplier — applied POST-ranking to shape selection probability.
 *
 * Spec:
 *   probability = normalizedScore × diversityBoost × antiRepetitionPenalty
 *
 * Soft caps:
 *   - genre:       max 35% same genre
 *   - era cluster: max 40% same era
 *   - energy band: max 40% same energy band
 *
 * Never removes tracks. Returns a multiplier in (0, 1].
 */
export function computeDiversityMultiplier(opts: {
  genrePrimary: string;
  eraCluster: EraCluster;
  energyBand: EnergyBand;
  genreCountSoFar: Record<string, number>;
  eraCountSoFar: Record<string, number>;
  energyCountSoFar: Record<string, number>;
  totalSoFar: number;
}): number {
  const { genrePrimary, eraCluster, energyBand, totalSoFar } = opts;

  let multiplier = 1.0;

  if (totalSoFar > 0) {
    const genreShare = (opts.genreCountSoFar[genrePrimary] ?? 0) / totalSoFar;
    const eraShare = (opts.eraCountSoFar[eraCluster] ?? 0) / totalSoFar;
    const energyShare = (opts.energyCountSoFar[energyBand] ?? 0) / totalSoFar;

    // Genre cap: above 35% → soft penalty, not removal
    if (genreShare > 0.35) multiplier *= Math.max(0.30, 1 - (genreShare - 0.35) * 2.5);

    // Era cap: above 40% → soft penalty
    if (eraShare > 0.40) multiplier *= Math.max(0.40, 1 - (eraShare - 0.40) * 2.0);

    // Energy band cap: above 40% → soft penalty
    if (energyShare > 0.40) multiplier *= Math.max(0.45, 1 - (energyShare - 0.40) * 1.5);
  }

  return multiplier;
}
