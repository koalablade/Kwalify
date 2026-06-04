/**
 * V3 Pipeline Orchestrator — spec §4, §7, §8, §9
 *
 * Implements:
 *   §3  resolveSceneDistribution — weighted multi-scene vector
 *   §4  Six-signal scoring: ES×0.25 + SA×0.25 + EM×0.20 + Era×0.15 + Act×0.10 + Nov×0.05
 *   §5  Genre anti-collapse: 18% cap, rolling 12-track window, counter-genre injection
 *   §6  Full pool preservation — max 40% ANN pre-filter applied upstream
 *   §7  Stratified sampling: 40% emotion / 30% scene / 20% novelty / 10% exploration
 *   §8  Hybrid fallback: broaden scene, increase novelty, expand era, reduce embedding dominance
 *   §9  Full debug output on every run
 */

import type { EmotionProfile } from "../../lib/emotion";
import { parseUserIntent, buildIntentEmbedding } from "../../lib/intent-parser";
import { scoreAllTracks, type V2ScoredTrack } from "./triple-signal-scorer";
import { applyV2Diversity, type DiversityCandidate } from "./diversity-engine";
import { buildBucketedPlaylist, type BucketCandidate } from "./bucketed-selection";
import { sequenceTracks, computeSmoothnessScore } from "./sequencer";
import {
  resolveSemanticScene,
  computeMultiSceneEcosystemScore,
} from "../../lib/semantic-scene-engine";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";

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
  finalTracks: T[];
  scoredPool: Array<T & {
    v2Score: number;
    R: number; SA: number; EM: number; Era: number; Act: number; Nov: number;
    V: number; C: number;
  }>;
  diagnostics: Record<string, unknown>;
}

// ─── Fallback condition detection ────────────────────────────────────────────

interface FallbackSignals {
  useFallback: boolean;
  reason: string;
  /** Boosted novelty weight for fallback scoring pass */
  noveltyBoost: number;
  /** Reduced embedding weight emphasis */
  embeddingDominanceReduced: boolean;
}

function detectFallbackConditions(
  sceneConfidence: number,
  avgTopR: number,
  matchedSceneId: string | null
): FallbackSignals {
  const noSceneMatched = matchedSceneId === null;
  const lowConfidence = sceneConfidence < 0.35;
  const weakEmbedding = avgTopR < 0.40;

  if (noSceneMatched || lowConfidence || weakEmbedding) {
    return {
      useFallback: true,
      reason: noSceneMatched
        ? "no_scene_matched"
        : lowConfidence
        ? `low_scene_confidence_${Math.round(sceneConfidence * 100)}pct`
        : `weak_embedding_avg_r_${Math.round(avgTopR * 100)}pct`,
      noveltyBoost: 0.25,
      embeddingDominanceReduced: true,
    };
  }
  return { useFallback: false, reason: "nominal", noveltyBoost: 0, embeddingDominanceReduced: false };
}

// ─── Diversity entropy ────────────────────────────────────────────────────────

function computeDiversityEntropy(dist: Record<string, number>): number {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of Object.values(dist)) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

function computeGenreConcentration(dist: Record<string, number>): number {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  return Math.max(...Object.values(dist)) / total;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full V3 selection pipeline.
 *
 * @param tracks      All candidate tracks (full pool — max 40% pre-filter applied upstream)
 * @param vibe        Raw user vibe string
 * @param profile     Emotion profile (energy/valence targets)
 * @param targetCount Desired playlist length
 * @param opts.genreByTrack           Genre string lookup (e.g. "indie")
 * @param opts.classificationByTrack  Full genre classification for scene affinity computation
 * @param opts.sceneAffinityByTrack   Override: use pre-computed scene affinity (optional)
 * @param opts.noveltyByTrack         Novelty score per track (0–1)
 * @param opts.seed                   Deterministic seed for exploration bucket
 */
export function runV2Pipeline<T extends V2PipelineTrack>(
  tracks: T[],
  vibe: string,
  profile: EmotionProfile,
  targetCount: number,
  opts: {
    genreByTrack?: (trackId: string) => string;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
    sceneAffinityByTrack?: (trackId: string) => number;
    noveltyByTrack?: (trackId: string) => number;
    seed?: number;
  } = {}
): V2PipelineResult<T> {
  // ── Step 1: Parse UserIntent ─────────────────────────────────────────────
  const intent = parseUserIntent(vibe, profile);
  const intentEmbedding = buildIntentEmbedding(intent);

  // ── Step 2: Resolve multi-scene distribution (spec §3) ───────────────────
  const sceneResolution = resolveSemanticScene(vibe, profile);
  const sceneVector = sceneResolution.sceneVector;

  // Build per-track scene affinity function using multi-scene ecosystem scoring
  const sceneAffinityFn = opts.sceneAffinityByTrack ??
    ((trackId: string): number => {
      const cls = opts.classificationByTrack?.(trackId);
      if (!cls) return 0.5;
      return computeMultiSceneEcosystemScore(cls, sceneVector);
    });

  // ── Step 3: Score ALL tracks with six-signal model (spec §4) ─────────────
  const v2Scored: V2ScoredTrack<T>[] = scoreAllTracks(
    tracks,
    intent,
    intentEmbedding,
    opts.genreByTrack,
    sceneAffinityFn,
    opts.noveltyByTrack
  );

  // ── Step 4: Sort by score, compute fallback conditions ───────────────────
  const sorted = [...v2Scored].sort((a, b) => b.score - a.score);
  const avgTopR =
    sorted.slice(0, Math.min(20, sorted.length)).reduce((s, t) => s + t.R, 0) /
    Math.min(20, sorted.length);

  const fallback = detectFallbackConditions(
    sceneResolution.confidence,
    avgTopR,
    sceneResolution.matchedId
  );

  // ── Step 5 (fallback): Re-score with broadened parameters (spec §8) ──────
  let finalSorted = sorted;
  if (fallback.useFallback) {
    // Hybrid fallback: increase novelty weight, reduce embedding dominance,
    // expand era distribution by treating all eras as matching.
    const fallbackNoveltyFn = (trackId: string): number => {
      const base = opts.noveltyByTrack?.(trackId) ?? 0.5;
      return Math.min(1, base + fallback.noveltyBoost);
    };
    const broadenedSceneAffinity = (_trackId: string) => 0.5; // neutral scene affinity

    const fallbackScored: V2ScoredTrack<T>[] = scoreAllTracks(
      tracks,
      { ...intent, era: "any" }, // expand era distribution
      intentEmbedding,
      opts.genreByTrack,
      broadenedSceneAffinity,
      fallbackNoveltyFn
    );
    finalSorted = [...fallbackScored].sort((a, b) => b.score - a.score);
  }

  // ── Step 6: Greedy diversity selection (streak penalties) ─────────────────
  const diversityCandidates: Array<T & DiversityCandidate> = finalSorted.map((s) => ({
    ...s.track,
    trackId: s.track.trackId,
    artistName: s.track.artistName,
    score: s.score,
    era: s.era,
    genrePrimary: s.genrePrimary ?? opts.genreByTrack?.(s.track.trackId) ?? "unknown",
  }));

  // Select 2× target for stratified sampling headroom
  const diversityPool = applyV2Diversity(
    diversityCandidates,
    Math.min(targetCount * 2, finalSorted.length)
  );

  // ── Step 7: Stratified sampling — 40/30/20/10 (spec §7) ──────────────────
  const scoreLookup = new Map(finalSorted.map((s) => [s.track.trackId, s]));

  const bucketedCandidates: Array<T & BucketCandidate> = diversityPool.map((d) => {
    const signals = scoreLookup.get(d.trackId);
    return {
      ...d,
      score: d.score,
      era: d.era,
      genrePrimary: d.genrePrimary,
      emotionMatch: signals?.EM,
      sceneAffinity: signals?.SA,
      noveltyScore: signals?.Nov,
    };
  });

  const bucketedTracks = buildBucketedPlaylist(
    bucketedCandidates,
    targetCount,
    intent.era,
    opts.seed ?? Date.now()
  );

  // ── Step 8: Sequence for smooth listening experience ─────────────────────
  const sequenced = sequenceTracks(bucketedTracks);

  // ── Step 9: Build full debug output (spec §9) ─────────────────────────────
  const smoothness = computeSmoothnessScore(sequenced);

  const genreDist: Record<string, number> = {};
  const eraDist: Record<string, number> = {};
  let emotionSum = 0;
  let sceneAffinitySum = 0;

  for (const t of sequenced) {
    const g = opts.genreByTrack?.(t.trackId) ?? "unknown";
    const signals = scoreLookup.get(t.trackId);
    const era = signals?.era ?? "any";
    genreDist[g] = (genreDist[g] ?? 0) + 1;
    eraDist[era] = (eraDist[era] ?? 0) + 1;
    emotionSum += signals?.EM ?? 0;
    sceneAffinitySum += signals?.SA ?? 0;
  }

  const seqLen = sequenced.length || 1;
  const diversityEntropy = computeDiversityEntropy(genreDist);
  const genreConcentration = computeGenreConcentration(genreDist);

  const diagnostics: Record<string, unknown> = {
    scoringModel: "v3_ES0.25_SA0.25_EM0.20_Era0.15_Act0.10_Nov0.05",
    // §9: scene distribution
    sceneDistribution: sceneVector.map(({ id, weight }) => ({
      sceneId: id,
      weight: Math.round(weight * 1000) / 1000,
    })),
    sceneConfidence: Math.round(sceneResolution.confidence * 100) / 100,
    // §9: emotion vector
    emotionVector: {
      energy: Math.round(intent.energy * 100) / 100,
      mood: intent.mood,
      avgEmotionMatchInPlaylist: Math.round((emotionSum / seqLen) * 100) / 100,
      avgSceneAffinityInPlaylist: Math.round((sceneAffinitySum / seqLen) * 100) / 100,
    },
    // §9: activity vector
    activityVector: {
      detected: intent.activity,
      vibeTags: intent.vibeTags.slice(0, 10),
    },
    // §9: era vector
    eraVector: {
      intentEra: intent.era,
      distribution: eraDist,
    },
    // §9: diversity entropy score
    diversityEntropyScore: Math.round(diversityEntropy * 1000) / 1000,
    // §9: genre concentration score
    genreConcentrationScore: Math.round(genreConcentration * 1000) / 1000,
    genreDistribution: genreDist,
    // §9: sampling breakdown
    samplingBreakdown: {
      buckets: {
        emotionalMatch_40pct: Math.floor(targetCount * 0.40),
        sceneMatch_30pct: Math.floor(targetCount * 0.30),
        noveltyDiversity_20pct: Math.floor(targetCount * 0.20),
        randomExploration_10pct:
          targetCount - Math.floor(targetCount * 0.40) - Math.floor(targetCount * 0.30) - Math.floor(targetCount * 0.20),
      },
    },
    // Fallback info
    fallback: {
      triggered: fallback.useFallback,
      reason: fallback.reason,
    },
    // Pool stats
    poolSize: tracks.length,
    scoredCount: v2Scored.length,
    selectedCount: sequenced.length,
    topR: Math.round((sorted[0]?.R ?? 0) * 1000) / 1000,
    avgTopR: Math.round(avgTopR * 1000) / 1000,
    smoothnessScore: Math.round(smoothness * 1000) / 1000,
    sceneInfluence: "primary_signal_0.25",
    genreAntiCollapse: "18pct_cap_rolling_12_window_counter_genre_every_5",
  };

  // Scored pool for diagnostics and fallback
  const scoredPool = finalSorted.map((s) => ({
    ...s.track,
    v2Score: s.score,
    R: s.R,
    SA: s.SA,
    EM: s.EM,
    Era: s.Era,
    Act: s.Act,
    Nov: s.Nov,
    V: s.V,
    C: s.C,
  }));

  return { finalTracks: sequenced, scoredPool, diagnostics };
}
