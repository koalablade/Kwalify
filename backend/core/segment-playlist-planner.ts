/**
 * Segment playlist planner (Q8) — per-segment retrieval targets + assignment.
 */

import {
  buildPlaylistSegments,
  buildEmotionalArc,
  type EmotionalArc,
  type PlaylistSegment,
} from "../core/emotional-arc-planner";
import type { DecomposedIntent } from "../core/intent-decomposer";

export type SegmentTarget = {
  segment: PlaylistSegment;
  trackCount: number;
  energyMin: number;
  energyMax: number;
  valenceMin: number;
  valenceMax: number;
  genreFamilies: string[];
};

export type SegmentAssignment<T extends { trackId: string; energy?: number | null; valence?: number | null; genreFamily?: string | null }> = {
  segmentId: PlaylistSegment["id"];
  label: string;
  tracks: T[];
};

export type SegmentPlaylistPlan = {
  arc: EmotionalArc;
  segments: SegmentTarget[];
  totalTracks: number;
};

const SEGMENT_ENERGY: Record<PlaylistSegment["id"], { min: number; max: number; valMin: number; valMax: number }> = {
  intro: { min: 0.25, max: 0.55, valMin: 0.3, valMax: 0.7 },
  build: { min: 0.4, max: 0.7, valMin: 0.35, valMax: 0.75 },
  peak: { min: 0.65, max: 1, valMin: 0.25, valMax: 0.9 },
  release: { min: 0.45, max: 0.75, valMin: 0.35, valMax: 0.8 },
  cooldown: { min: 0.15, max: 0.5, valMin: 0.3, valMax: 0.65 },
};

export function buildSegmentPlaylistPlan(
  intent: DecomposedIntent,
  trackCount: number,
  sceneAliases: string[],
): SegmentPlaylistPlan {
  const arc = buildEmotionalArc(intent);
  const segments = buildPlaylistSegments(arc);
  let remaining = trackCount;
  const targets: SegmentTarget[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const isLast = i === segments.length - 1;
    const count = isLast ? remaining : Math.max(1, Math.round(trackCount * segment.share));
    remaining -= count;
    const energy = SEGMENT_ENERGY[segment.id];
    targets.push({
      segment,
      trackCount: count,
      energyMin: energy.min,
      energyMax: energy.max,
      valenceMin: energy.valMin,
      valenceMax: energy.valMax,
      genreFamilies: sceneAliases.slice(0, 4),
    });
  }

  return { arc, segments: targets, totalTracks: trackCount };
}

function segmentFitScore<T extends { energy?: number | null; valence?: number | null; genreFamily?: string | null }>(
  track: T,
  target: SegmentTarget,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  let score = 0;
  if (energy >= target.energyMin && energy <= target.energyMax) score += 0.45;
  else score += Math.max(0, 0.45 - Math.abs(energy - (target.energyMin + target.energyMax) / 2));
  if (valence >= target.valenceMin && valence <= target.valenceMax) score += 0.35;
  else score += Math.max(0, 0.35 - Math.abs(valence - (target.valenceMin + target.valenceMax) / 2) * 0.5);
  if (track.genreFamily && target.genreFamilies.includes(track.genreFamily)) score += 0.2;
  return score;
}

export type SegmentAssignmentOptions = {
  /** Keep the first N tracks fixed; segment assignment applies only to the tail. */
  preservePrefixCount?: number;
};

function tailSegmentPlan(plan: SegmentPlaylistPlan, tailCount: number): SegmentPlaylistPlan {
  if (tailCount <= 0 || tailCount >= plan.totalTracks) return plan;
  let remaining = tailCount;
  const segments = plan.segments.map((target, index) => {
    const isLast = index === plan.segments.length - 1;
    const count = isLast
      ? remaining
      : Math.max(1, Math.round(tailCount * (target.trackCount / plan.totalTracks)));
    remaining -= count;
    return { ...target, trackCount: Math.max(0, count) };
  });
  return { ...plan, segments, totalTracks: tailCount };
}

export function assignTracksToSegments<T extends { trackId: string; energy?: number | null; valence?: number | null; genreFamily?: string | null }>(
  tracks: T[],
  plan: SegmentPlaylistPlan,
  options?: SegmentAssignmentOptions,
): { ordered: T[]; assignments: SegmentAssignment<T>[] } {
  const prefixCount = Math.max(0, Math.min(options?.preservePrefixCount ?? 0, tracks.length));
  if (prefixCount > 0 && tracks.length > prefixCount) {
    const prefix = tracks.slice(0, prefixCount);
    const tail = tracks.slice(prefixCount);
    const tailResult = assignTracksToSegments(tail, tailSegmentPlan(plan, tail.length));
    return {
      ordered: [...prefix, ...tailResult.ordered],
      assignments: [
        {
          segmentId: "intro",
          label: "curated_opening",
          tracks: prefix,
        },
        ...tailResult.assignments,
      ],
    };
  }

  const pool = [...tracks];
  const assignments: SegmentAssignment<T>[] = [];
  const ordered: T[] = [];

  for (const target of plan.segments) {
    const picked: T[] = [];
    for (let i = 0; i < target.trackCount && pool.length > 0; i++) {
      let bestIdx = 0;
      let bestScore = -1;
      for (let j = 0; j < pool.length; j++) {
        const score = segmentFitScore(pool[j]!, target);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }
      const [track] = pool.splice(bestIdx, 1);
      if (track) {
        picked.push(track);
        ordered.push(track);
      }
    }
    assignments.push({
      segmentId: target.segment.id,
      label: target.segment.label,
      tracks: picked,
    });
  }

  while (pool.length > 0) {
    ordered.push(pool.shift()!);
  }

  return { ordered: ordered.length === tracks.length ? ordered : tracks, assignments };
}

export function segmentRetrievalBoost<T extends { energy?: number | null; valence?: number | null; genreFamily?: string | null }>(
  track: T,
  activeSegment: SegmentTarget | null,
): number {
  if (!activeSegment) return 0;
  return segmentFitScore(track, activeSegment) * 0.25;
}
