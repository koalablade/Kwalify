/**
 * V2 Triple Signal Scoring — R × 0.45 + V × 0.35 + C × 0.20
 *
 * A. Semantic Relevance (R): cosine similarity between track and intent embeddings
 * B. Vibe Match (V):         energy + mood + audio feature alignment
 * C. Context Match (C):      era + activity + soft scene affinity (max 10%)
 *
 * NO genre filtering. NO scene gating. ALL signals are continuous [0, 1].
 * Diversity is applied POST-scoring in the diversity engine.
 */

import {
  buildTrackEmbedding,
  cosineSimilarity,
  type AudioVector,
} from "../../shared/embeddings/track-embeddings";
import type { UserIntent, ActivityType } from "../../lib/intent-parser";
import { computeActivityMatch } from "../../lib/intent-parser";
import { computeEraMatch, detectEraFromYear, estimateEraFromAudio } from "./era-model";
import type { EraBucket } from "../../lib/intent-parser";

// ─── Signal A: Semantic Relevance (R) ────────────────────────────────────────

/**
 * R = cosineSimilarity(track.embedding, intent.embedding)
 *
 * This is the primary ranking signal at 45% weight.
 * Replaces all rule-based ecosystem/genre scoring.
 */
export function computeR(
  trackEmbedding: AudioVector,
  intentEmbedding: AudioVector
): number {
  return cosineSimilarity(trackEmbedding, intentEmbedding);
}

// ─── Signal B: Vibe Match (V) ─────────────────────────────────────────────────

/**
 * V = (energyMatch × 0.4) + (moodAlignment × 0.3) + (audioFeatureSimilarity × 0.3)
 */
export function computeV(
  track: {
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    tempo: number | null;
    acousticness: number | null;
  },
  intent: UserIntent
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempo = track.tempo ?? 120;

  // Energy match: 1 - |trackEnergy - intentEnergy|, scaled
  const energyMatch = Math.max(0, 1 - Math.abs(energy - intent.energy) * 1.4);

  // Mood alignment: valence-based match to mood tags
  let moodTarget = 0.5;
  if (intent.mood.includes("euphoric") || intent.mood.includes("energised")) moodTarget = 0.75;
  if (intent.mood.includes("melancholic") || intent.mood.includes("dark")) moodTarget = 0.28;
  if (intent.mood.includes("calm")) moodTarget = 0.55;
  if (intent.mood.includes("romantic")) moodTarget = 0.65;
  if (intent.mood.includes("nostalgic")) moodTarget = 0.50;

  const moodAlignment = Math.max(0, 1 - Math.abs(valence - moodTarget) * 2.0);

  // Audio feature similarity: combined danceability + tempo match
  const targetDance = intent.activity === "party" ? 0.80 : intent.activity === "chill" ? 0.30 : 0.50;
  const danceMatch = Math.max(0, 1 - Math.abs(danceability - targetDance) * 1.5);

  const targetTempo = 80 + intent.energy * 80; // 80–160 BPM range based on intent energy
  const tempoMatch = Math.max(0, 1 - Math.abs(tempo - targetTempo) / 80);

  const audioFeatureSimilarity = danceMatch * 0.6 + tempoMatch * 0.4;

  return (energyMatch * 0.4) + (moodAlignment * 0.3) + (audioFeatureSimilarity * 0.3);
}

// ─── Signal C: Context Match (C) ─────────────────────────────────────────────

/**
 * C = (eraMatch × 0.5) + (activityMatch × 0.3) + (sceneSoftAffinity × 0.2)
 *
 * Scene soft affinity is capped at 0.10 contribution to the final score
 * (i.e., the scene can contribute at most 0.10 × 0.20 = 0.02 to the final score).
 * This is the V2 spec's "sceneWeight <= 0.10" constraint.
 */
export function computeC(
  track: {
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    tempo: number | null;
    acousticness: number | null;
  },
  intent: UserIntent,
  trackEra: EraBucket,
  /** Optional soft scene affinity from the existing scene engine (0–1), capped at 0.10 */
  sceneSoftAffinity = 0.5
): number {
  const eraMatch = computeEraMatch(trackEra, intent.era);
  const activityMatch = computeActivityMatch(track, intent.activity);

  // V2 spec: scene max influence = 0.10
  const cappedSceneAffinity = Math.min(0.10, sceneSoftAffinity) * 10; // scale [0,0.1] → [0,1]

  return (eraMatch * 0.5) + (activityMatch * 0.3) + (cappedSceneAffinity * 0.2);
}

// ─── Final score ──────────────────────────────────────────────────────────────

/**
 * Final V2 score: 0.45 × R + 0.35 × V + 0.20 × C
 *
 * This is the ONLY scoring formula. No other scoring systems exist.
 */
export function computeV2FinalScore(R: number, V: number, C: number): number {
  return Math.max(0, Math.min(1.25, (0.45 * R) + (0.35 * V) + (0.20 * C)));
}

// ─── Batch scorer ────────────────────────────────────────────────────────────

export interface V2ScoredTrack<T> {
  track: T;
  score: number;
  R: number;
  V: number;
  C: number;
  trackEmbedding: AudioVector;
  era: EraBucket;
  genrePrimary?: string;
}

/**
 * Score all tracks using the V2 triple-signal model.
 *
 * V2 rule: ALL tracks with valid audio features enter scoring — NO pre-filtering.
 */
export function scoreAllTracks<T extends {
  trackId: string;
  artistName: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  tracks: T[],
  intent: UserIntent,
  intentEmbedding: AudioVector,
  /** Pre-computed genre primary per track (from existing classification) */
  genreByTrack?: (trackId: string) => string,
  /** Pre-computed scene affinity per track (soft signal only, 0–1) */
  sceneAffinityByTrack?: (trackId: string) => number
): V2ScoredTrack<T>[] {
  return tracks
    .filter((t) => t.energy !== null || t.valence !== null) // only require at least one audio feature
    .map((track) => {
      const embedding = buildTrackEmbedding(track);
      const trackEra: EraBucket =
        track.releaseYear
          ? detectEraFromYear(track.releaseYear)
          : estimateEraFromAudio(track);

      const R = computeR(embedding, intentEmbedding);
      const V = computeV(track, intent);
      const C = computeC(
        track,
        intent,
        trackEra,
        sceneAffinityByTrack ? sceneAffinityByTrack(track.trackId) : 0.5
      );

      return {
        track,
        score: computeV2FinalScore(R, V, C),
        R,
        V,
        C,
        trackEmbedding: embedding,
        era: trackEra,
        genrePrimary: genreByTrack ? genreByTrack(track.trackId) : undefined,
      };
    });
}
