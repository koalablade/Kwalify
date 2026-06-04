/**
 * V2 Pipeline Orchestrator — post-scoring V2 replacement layer.
 *
 * Takes the raw scored pool produced by the existing infrastructure
 * (which provides genre classification, audio features, etc.) and:
 *
 *   1. Re-scores every track with the V2 triple-signal formula
 *   2. Applies V2 greedy diversity selection (streak-based penalties)
 *   3. Applies V2 bucketed selection (25% × 4 anti-collapse buckets)
 *   4. Applies V2 sequencer (flow-optimized ordering)
 *
 * V2 absolute rules:
 *   - NO track removed due to genre, scene, or confidence
 *   - ALL signals are continuous (never binary)
 *   - Diversity is post-score only
 *   - Scene contributes at most 10% to C signal (max 2% of final score)
 */

import type { EmotionProfile } from "../../lib/emotion";
import { parseUserIntent, buildIntentEmbedding } from "../../lib/intent-parser";
import { scoreAllTracks, type V2ScoredTrack } from "./triple-signal-scorer";
import { applyV2Diversity, type DiversityCandidate } from "./diversity-engine";
import { buildBucketedPlaylist, type BucketCandidate } from "./bucketed-selection";
import { sequenceTracks, computeSmoothnessScore } from "./sequencer";

export interface V2PipelineTrack {
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
}

export interface V2PipelineResult<T extends V2PipelineTrack> {
  /** Final playlist tracks in sequenced order */
  finalTracks: T[];
  /** Full re-scored pool sorted by V2 score (for diagnostics / fallback) */
  scoredPool: Array<T & { v2Score: number; R: number; V: number; C: number }>;
  /** V2 diagnostics for debug panel */
  diagnostics: Record<string, unknown>;
}

/**
 * Run the full V2 selection pipeline on a scored track pool.
 *
 * @param tracks      All candidate tracks (NO pre-filtering applied)
 * @param vibe        Raw user vibe string
 * @param profile     Emotion profile (energy/valence targets from existing pipeline)
 * @param targetCount Desired playlist length
 * @param opts.genreByTrack   Genre lookup (from existing classification)
 * @param opts.sceneAffinityByTrack  Soft scene affinity (0–1, max 10% used)
 * @param opts.seed   Deterministic seed for discovery bucket
 */
export function runV2Pipeline<T extends V2PipelineTrack>(
  tracks: T[],
  vibe: string,
  profile: EmotionProfile,
  targetCount: number,
  opts: {
    genreByTrack?: (trackId: string) => string;
    sceneAffinityByTrack?: (trackId: string) => number;
    seed?: number;
  } = {}
): V2PipelineResult<T> {
  // ── Step 1: Parse UserIntent ─────────────────────────────────────────────
  const intent = parseUserIntent(vibe, profile);
  const intentEmbedding = buildIntentEmbedding(intent);

  // ── Step 2: Score ALL tracks with V2 triple-signal model ─────────────────
  // V2 rule: ALL tracks with at least one audio feature enter scoring.
  // No genre filtering, no scene gating, no pre-score caps.
  const v2Scored: V2ScoredTrack<T>[] = scoreAllTracks(
    tracks,
    intent,
    intentEmbedding,
    opts.genreByTrack,
    opts.sceneAffinityByTrack
  );

  // ── Step 3: Sort by V2 score (descending) ────────────────────────────────
  const sorted = [...v2Scored].sort((a, b) => b.score - a.score);

  // ── Step 4: Greedy diversity selection (streak penalties) ─────────────────
  // After ranking, apply streak penalties to prevent genre/era/artist collapse.
  const diversityCandidates: Array<T & DiversityCandidate> = sorted.map((s) => ({
    ...s.track,
    trackId: s.track.trackId,
    artistName: s.track.artistName,
    score: s.score,
    era: s.era,
    genrePrimary: s.genrePrimary ?? opts.genreByTrack?.(s.track.trackId) ?? "unknown",
  }));

  // Select 2× target to have enough candidates for bucketed selection
  const diversityPool = applyV2Diversity(diversityCandidates, Math.min(targetCount * 2, sorted.length));

  // ── Step 5: Bucketed selection (4 × 25% anti-collapse) ───────────────────
  const bucketedCandidates: Array<T & BucketCandidate> = diversityPool.map((d) => ({
    ...d,
    score: d.score,
    era: d.era,
    genrePrimary: d.genrePrimary,
  }));

  const bucketedTracks = buildBucketedPlaylist(
    bucketedCandidates,
    targetCount,
    intent.era,
    opts.seed ?? Date.now()
  );

  // ── Step 6: Sequence for smooth listening experience ─────────────────────
  const sequenced = sequenceTracks(bucketedTracks);

  // ── Build diagnostics ────────────────────────────────────────────────────
  const smoothness = computeSmoothnessScore(sequenced);

  const genreDist: Record<string, number> = {};
  const eraDist: Record<string, number> = {};
  for (const t of sequenced) {
    const g = opts.genreByTrack?.(t.trackId) ?? "unknown";
    const e = v2Scored.find((s) => s.track.trackId === t.trackId)?.era ?? "any";
    genreDist[g] = (genreDist[g] ?? 0) + 1;
    eraDist[e] = (eraDist[e] ?? 0) + 1;
  }

  const topR = sorted[0]?.R ?? 0;
  const avgR = sorted.slice(0, 20).reduce((s, t) => s + t.R, 0) / Math.min(20, sorted.length);

  const diagnostics: Record<string, unknown> = {
    scoringModel: "v2_R0.45_V0.35_C0.20",
    intent: {
      era: intent.era,
      energy: intent.energy,
      mood: intent.mood,
      activity: intent.activity,
      vibeTags: intent.vibeTags.slice(0, 8),
    },
    poolSize: tracks.length,
    scoredCount: v2Scored.length,
    excludedCount: tracks.length - v2Scored.length,
    selectedCount: sequenced.length,
    topR: Math.round(topR * 1000) / 1000,
    avgTopR: Math.round(avgR * 1000) / 1000,
    smoothnessScore: Math.round(smoothness * 1000) / 1000,
    genreDistribution: genreDist,
    eraDistribution: eraDist,
    buckets: {
      genre1: Math.floor(targetCount * 0.25),
      genre2: Math.floor(targetCount * 0.25),
      era: Math.floor(targetCount * 0.25),
      discovery: targetCount - Math.floor(targetCount * 0.75),
    },
    diversityEngine: "streak_penalties_post_ranking",
    sceneInfluence: "soft_context_only_max_0.10",
  };

  // Scored pool for diagnostics and fallback
  const scoredPool = sorted.map((s) => ({
    ...s.track,
    v2Score: s.score,
    R: s.R,
    V: s.V,
    C: s.C,
  }));

  return { finalTracks: sequenced, scoredPool, diagnostics };
}
