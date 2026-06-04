/**
 * V3 Six-Signal Scoring — spec §4
 *
 * FINAL_SCORE =
 *   EmbeddingSimilarity × 0.25 +
 *   SceneAffinity        × 0.25 +
 *   EmotionMatch         × 0.20 +
 *   EraMatch             × 0.15 +
 *   ActivityMatch        × 0.10 +
 *   NoveltyBoost         × 0.05
 *
 * Key changes from V2 (R×0.45 + V×0.35 + C×0.20):
 *   - SceneAffinity is now a first-class 25% signal (was capped at ~2%)
 *   - EmbeddingSimilarity reduced from 45% → 25% (prevents embedding monoculture)
 *   - Genre is NOT a scoring factor — diversity enforced post-score only
 *   - NoveltyBoost added as dedicated 5% signal
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

// ─── Signal 1: Embedding Similarity (ES) ────────────────────────────────────

/**
 * ES = cosineSimilarity(track.embedding, intent.embedding)
 * Weight: 0.25 — reduced from 0.45 to prevent embedding monoculture.
 */
export function computeR(
  trackEmbedding: AudioVector,
  intentEmbedding: AudioVector
): number {
  return cosineSimilarity(trackEmbedding, intentEmbedding);
}

// ─── Signal 2: Scene Affinity (SA) ───────────────────────────────────────────

// SceneAffinity is computed OUTSIDE the scorer (in v2-pipeline) using
// computeMultiSceneEcosystemScore from semantic-scene-engine and the scene
// distribution from resolveSceneDistribution. It is passed in as a callback.
// Weight: 0.25 — the primary scene signal, replaces genre ecosystem gating.

// ─── Signal 3: Emotion Match (EM) ────────────────────────────────────────────

/**
 * EM = energyFit × 0.6 + valenceFit × 0.4
 * Measures how closely a track's emotional profile matches the user's intent.
 * Weight: 0.20
 */
export function computeEmotionMatch(
  track: { energy: number | null; valence: number | null },
  intent: UserIntent
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;

  const energyFit = Math.max(0, 1 - Math.abs(e - intent.energy) * 1.4);

  let valenceTarget = 0.5;
  if (intent.mood.includes("euphoric") || intent.mood.includes("hopeful")) valenceTarget = 0.75;
  if (intent.mood.includes("melancholic") || intent.mood.includes("dark")) valenceTarget = 0.28;
  if (intent.mood.includes("introspective")) valenceTarget = 0.32;
  if (intent.mood.includes("calm")) valenceTarget = 0.55;
  if (intent.mood.includes("romantic")) valenceTarget = 0.65;
  if (intent.mood.includes("nostalgic")) valenceTarget = 0.50;
  if (intent.mood.includes("energised")) valenceTarget = 0.72;

  const valenceFit = Math.max(0, 1 - Math.abs(v - valenceTarget) * 2.0);

  return energyFit * 0.6 + valenceFit * 0.4;
}

/**
 * Legacy V-signal kept for backward compat in diagnostics.
 * Not used in scoring — use computeEmotionMatch instead.
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
  return computeEmotionMatch(track, intent);
}

// ─── Signal 4: Era Match (Era) ────────────────────────────────────────────────

// computeEraMatch is imported from era-model. Weight: 0.15

// ─── Signal 5: Activity Match (Act) ──────────────────────────────────────────

// computeActivityMatch is imported from intent-parser. Weight: 0.10

// ─── Signal 6: Novelty Boost (Nov) ───────────────────────────────────────────

// NoveltyBoost is computed outside and passed in per track (0–1). Weight: 0.05

// ─── Final Score ──────────────────────────────────────────────────────────────

/**
 * Final V3 score — six-signal formula (spec §4).
 *
 * ES  = EmbeddingSimilarity  (0.25)
 * SA  = SceneAffinity        (0.25) — NO genre in scoring, scene only
 * EM  = EmotionMatch         (0.20)
 * Era = EraMatch             (0.15)
 * Act = ActivityMatch        (0.10)
 * Nov = NoveltyBoost         (0.05)
 */
export function computeV2FinalScore(
  ES: number,
  SA: number,
  EM: number,
  Era: number,
  Act: number,
  Nov: number
): number {
  return Math.max(0, Math.min(1.25,
    (0.25 * ES) + (0.25 * SA) + (0.20 * EM) + (0.15 * Era) + (0.10 * Act) + (0.05 * Nov)
  ));
}

/**
 * Legacy C-signal kept for backward compat in diagnostics.
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
  sceneSoftAffinity = 0.5
): number {
  const eraMatch = computeEraMatch(trackEra, intent.era);
  const activityMatch = computeActivityMatch(track, intent.activity);
  const cappedSceneAffinity = Math.min(0.10, sceneSoftAffinity) * 10;
  return (eraMatch * 0.5) + (activityMatch * 0.3) + (cappedSceneAffinity * 0.2);
}

// ─── Batch Scorer ─────────────────────────────────────────────────────────────

export interface V2ScoredTrack<T> {
  track: T;
  score: number;
  /** Signal 1: EmbeddingSimilarity */
  R: number;
  /** Signal 2: SceneAffinity */
  SA: number;
  /** Signal 3: EmotionMatch */
  EM: number;
  /** Signal 4: EraMatch */
  Era: number;
  /** Signal 5: ActivityMatch */
  Act: number;
  /** Signal 6: NoveltyBoost */
  Nov: number;
  /** Legacy compat — same as EM */
  V: number;
  /** Legacy compat — weighted C signal */
  C: number;
  trackEmbedding: AudioVector;
  era: EraBucket;
  genrePrimary?: string;
}

/**
 * Score all tracks using the V3 six-signal model (spec §4).
 *
 * ALL tracks with at least one audio feature enter scoring — NO pre-filtering.
 * Genre is NOT used in scoring. SceneAffinity replaces ecosystem gating.
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
  genreByTrack?: (trackId: string) => string,
  sceneAffinityByTrack?: (trackId: string) => number,
  noveltyByTrack?: (trackId: string) => number
): V2ScoredTrack<T>[] {
  return tracks
    .filter((t) => t.energy !== null || t.valence !== null)
    .map((track) => {
      const embedding = buildTrackEmbedding(track);
      const trackEra: EraBucket =
        track.releaseYear
          ? detectEraFromYear(track.releaseYear)
          : estimateEraFromAudio(track);

      const ES = computeR(embedding, intentEmbedding);
      const SA = sceneAffinityByTrack ? sceneAffinityByTrack(track.trackId) : 0.5;
      const EM = computeEmotionMatch(track, intent);
      const Era = computeEraMatch(trackEra, intent.era);
      const Act = computeActivityMatch(track, intent.activity);
      const Nov = noveltyByTrack ? noveltyByTrack(track.trackId) : 0.5;

      return {
        track,
        score: computeV2FinalScore(ES, SA, EM, Era, Act, Nov),
        R: ES,
        SA,
        EM,
        Era,
        Act,
        Nov,
        V: EM,
        C: Era * 0.5 + Act * 0.3 + SA * 0.2,
        trackEmbedding: embedding,
        era: trackEra,
        genrePrimary: genreByTrack ? genreByTrack(track.trackId) : undefined,
      };
    });
}
