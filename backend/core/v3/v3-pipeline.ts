/**
 * V3 Pipeline Orchestrator
 *
 * Full replacement for the V2 single-ranking pipeline.
 *
 * Spec §1 — NEW high-level pipeline:
 *   input
 *     → intent decomposition   (multi-axis)
 *     → ROUTER                 (2–5 lanes)
 *     → lane-specific scoring  (independent per lane)
 *     → diversity-constrained sampling per lane
 *     → cross-lane interleaving
 *     → final stabilization
 *
 * Spec §9 — Scene Influence Map replaces resolveSemanticScene.
 * Spec §8 — Fallback is a multi-lane ensemble, never a generic mood.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { decomposeIntent, isUnclearIntent } from "./intent-decomposer";
import { buildLanes } from "./lane-router";
import { scoreLane } from "./lane-scorer";
import { sampleLane } from "./lane-sampler";
import { interleaveLanes } from "./interleaver";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";

// ── Types ──────────────────────────────────────────────────────────────────

export interface V3PipelineTrack {
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

export interface V3PipelineResult<T extends V3PipelineTrack> {
  finalTracks: T[];
  diagnostics: Record<string, unknown>;
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export function runV3Pipeline<T extends V3PipelineTrack>(
  tracks: T[],
  vibe: string,
  profile: EmotionProfile,
  targetCount: number,
  opts: {
    genreByTrack?: (trackId: string) => string;
    noveltyByTrack?: (trackId: string) => number;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
    seed?: number;
  } = {}
): V3PipelineResult<T> {

  // ── Step 1: Multi-axis intent decomposition ──────────────────────────────
  const decomposed = decomposeIntent(vibe, profile);
  const fallbackTriggered = isUnclearIntent(decomposed);

  // ── Step 2: Build lanes via the router ───────────────────────────────────
  const lanes = buildLanes(decomposed);

  // ── Step 3: Per-lane scoring + diversity-constrained sampling ────────────
  const laneDetails: Array<{
    laneId: string;
    type: string;
    label: string;
    weight: number;
    scoredCount: number;
    selectedCount: number;
  }> = [];

  const sampledResults = lanes.map((lane) => {
    // Score every track for this lane independently
    const scored = scoreLane(tracks, lane, decomposed, {
      genreByTrack: opts.genreByTrack,
      noveltyByTrack: opts.noveltyByTrack,
    });

    // Headroom: each lane picks 2× its share so interleaving has choices
    const laneTarget = Math.max(
      Math.ceil(targetCount * lane.weight * 2),
      Math.ceil(targetCount * lane.weight) + 4
    );

    const sampled = sampleLane(scored, lane.id, laneTarget);

    laneDetails.push({
      laneId: lane.id,
      type: lane.type,
      label: lane.label,
      weight: lane.weight,
      scoredCount: scored.length,
      selectedCount: sampled.tracks.length,
    });

    return sampled;
  });

  // ── Step 4: Cross-lane interleaving + stabilization ──────────────────────
  const interleaved = interleaveLanes(lanes, sampledResults, targetCount);

  // ── Step 5: Map back to original track references ─────────────────────────
  const trackById = new Map(tracks.map((t) => [t.trackId, t]));
  const finalTracks = interleaved.tracks
    .map((t) => trackById.get(t.trackId))
    .filter((t): t is T => t !== undefined);

  // ── Step 6: Diagnostics ───────────────────────────────────────────────────
  const genreDist: Record<string, number> = {};
  const eraDist: Record<string, number> = {};
  for (const t of finalTracks) {
    const g = opts.genreByTrack?.(t.trackId) ?? "unknown";
    genreDist[g] = (genreDist[g] ?? 0) + 1;
  }
  for (const t of interleaved.tracks) {
    eraDist[t.laneEra] = (eraDist[t.laneEra] ?? 0) + 1;
  }

  const genreValues = Object.values(genreDist);
  const totalGenre = genreValues.reduce((s, v) => s + v, 0) || 1;
  const genreConcentration = Math.max(...genreValues, 0) / totalGenre;

  const diagnostics: Record<string, unknown> = {
    pipelineVersion: "v3_multi_lane",
    intentDecomposition: {
      primary: decomposed.primary,
      secondaryIntents: decomposed.secondaryIntents,
      contextAnchors: decomposed.contextAnchors,
      sceneInfluenceMap: Object.fromEntries(
        Object.entries(decomposed.sceneInfluenceMap).sort((a, b) => b[1] - a[1])
      ),
    },
    lanes: laneDetails,
    laneContributions: interleaved.laneContributions,
    fallback: {
      triggered: fallbackTriggered,
      reason: fallbackTriggered ? "unclear_intent_multi_lane_ensemble" : "nominal",
    },
    poolSize: tracks.length,
    selectedCount: finalTracks.length,
    genreDistribution: genreDist,
    eraDistribution: eraDist,
    genreConcentrationScore: Math.round(genreConcentration * 1000) / 1000,
    diversityStrategy: "structural_per_lane_35pct_genre_50pct_energy_60pct_era",
  };

  return { finalTracks, diagnostics };
}
