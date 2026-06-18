/**
 * Emotional Arc Planner V1 — journey structure for playlist ordering (Q4 foundation).
 */

import type { DecomposedIntent } from "./intent-decomposer";

export type EmotionalArc = {
  start: string;
  peak: string;
  resolution: string;
};

export type PlaylistSegment = {
  id: "intro" | "build" | "peak" | "release" | "cooldown";
  label: string;
  share: number;
};

export function buildPlaylistSegments(arc: EmotionalArc): PlaylistSegment[] {
  return [
    { id: "intro", label: arc.start, share: 0.14 },
    { id: "build", label: "build", share: 0.22 },
    { id: "peak", label: arc.peak, share: 0.30 },
    { id: "release", label: "release", share: 0.20 },
    { id: "cooldown", label: arc.resolution, share: 0.14 },
  ];
}

export function buildEmotionalArc(intent: DecomposedIntent): EmotionalArc {
  const emotion = intent.emotion ?? "neutral";

  if (emotion === "sad" || emotion === "solitary") {
    return { start: "sad", peak: "reflective", resolution: "hopeful" };
  }
  if (emotion === "aggressive" || emotion === "motivated") {
    return { start: "calm", peak: "aggressive", resolution: "controlled-power" };
  }
  if (emotion === "nostalgic") {
    return { start: "nostalgic", peak: "warm", resolution: "bittersweet" };
  }
  if (emotion === "calm") {
    return { start: "calm", peak: "reflective", resolution: "peaceful" };
  }
  if (intent.energy === "high") {
    return { start: "warmup", peak: "energetic", resolution: "cooldown" };
  }
  if (intent.energy === "low") {
    return { start: "soft", peak: "reflective", resolution: "still" };
  }

  return { start: "neutral", peak: "energetic", resolution: "stable" };
}

export type ArcAwareTrack = {
  trackId: string;
  energy?: number | null;
  valence?: number | null;
};

function emotionBucket(track: ArcAwareTrack): string {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  if (energy >= 0.66 && valence < 0.45) return "aggressive";
  if (energy >= 0.66) return "energetic";
  if (energy < 0.4 && valence < 0.45) return "sad";
  if (energy < 0.4) return "calm";
  if (valence >= 0.55) return "hopeful";
  return "reflective";
}

const ARC_AFFINITY: Record<string, Record<string, number>> = {
  sad: { sad: 1, reflective: 0.8, hopeful: 0.4, calm: 0.5 },
  reflective: { reflective: 1, sad: 0.7, hopeful: 0.6, calm: 0.7 },
  hopeful: { hopeful: 1, reflective: 0.7, calm: 0.6 },
  aggressive: { aggressive: 1, energetic: 0.8, "controlled-power": 0.7 },
  energetic: { energetic: 1, aggressive: 0.7, warmup: 0.6, cooldown: 0.5 },
  calm: { calm: 1, reflective: 0.7, soft: 0.8, peaceful: 0.9 },
  neutral: { neutral: 1, reflective: 0.6, energetic: 0.5, stable: 0.7 },
  warmup: { warmup: 1, calm: 0.6, energetic: 0.5 },
  "controlled-power": { "controlled-power": 1, aggressive: 0.6, energetic: 0.5 },
  stable: { stable: 1, calm: 0.6, reflective: 0.5 },
  soft: { soft: 1, calm: 0.8, reflective: 0.6 },
  peaceful: { peaceful: 1, calm: 0.9, hopeful: 0.5 },
  bittersweet: { bittersweet: 1, nostalgic: 0.8, reflective: 0.6 },
  nostalgic: { nostalgic: 1, bittersweet: 0.7, warm: 0.6 },
  warm: { warm: 1, hopeful: 0.6, nostalgic: 0.5 },
  cooldown: { cooldown: 1, calm: 0.7, stable: 0.6 },
};

function arcAffinity(track: ArcAwareTrack, phase: string): number {
  const bucket = emotionBucket(track);
  return ARC_AFFINITY[phase]?.[bucket] ?? ARC_AFFINITY[phase]?.[bucket.replace(/-/g, " ")] ?? 0.35;
}

/** Greedy arc-aware reorder — does not swap tracks out, only sequences. */
export function orderTracksByEmotionalArc<T extends ArcAwareTrack>(
  tracks: T[],
  arc: EmotionalArc,
): T[] {
  if (tracks.length <= 3) return tracks;

  const phases = [arc.start, arc.peak, arc.resolution];
  const segmentSize = Math.max(1, Math.floor(tracks.length / phases.length));
  const remaining = [...tracks];
  const ordered: T[] = [];

  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
    const phase = phases[phaseIndex]!;
    const take = phaseIndex === phases.length - 1
      ? remaining.length
      : Math.min(segmentSize, remaining.length);
    for (let i = 0; i < take && remaining.length > 0; i++) {
      let bestIdx = 0;
      let bestScore = -1;
      for (let j = 0; j < remaining.length; j++) {
        const score = arcAffinity(remaining[j]!, phase);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }
      ordered.push(remaining.splice(bestIdx, 1)[0]!);
    }
  }

  return ordered.length === tracks.length ? ordered : tracks;
}

/** Five-segment journey ordering (Q8 foundation). */
export function orderTracksByPlaylistSegments<T extends ArcAwareTrack>(
  tracks: T[],
  arc: EmotionalArc,
): T[] {
  if (tracks.length <= 5) return orderTracksByEmotionalArc(tracks, arc);
  const segments = buildPlaylistSegments(arc);
  const remaining = [...tracks];
  const ordered: T[] = [];

  for (const segment of segments) {
    const phase = segment.id === "build"
      ? arc.start
      : segment.id === "release"
        ? arc.peak
        : segment.id === "intro"
          ? arc.start
          : segment.id === "peak"
            ? arc.peak
            : arc.resolution;
    const take = segment.id === "cooldown"
      ? remaining.length
      : Math.max(1, Math.round(tracks.length * segment.share));
    for (let i = 0; i < take && remaining.length > 0; i++) {
      let bestIdx = 0;
      let bestScore = -1;
      for (let j = 0; j < remaining.length; j++) {
        const score = arcAffinity(remaining[j]!, phase);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }
      ordered.push(remaining.splice(bestIdx, 1)[0]!);
    }
  }

  while (remaining.length > 0) {
    ordered.push(remaining.shift()!);
  }
  return ordered.length === tracks.length ? ordered : tracks;
}
