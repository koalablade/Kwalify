/**
 * Emotional peak placement — arc peak by resonance, not raw score alone.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { resolveSceneContext, sceneMatchScore, type SceneContext } from "../../lib/scene-validation";
import type { CanonicalSceneResult } from "../../lib/scene-canonicalizer";

export interface PeakPlacementResult<T> {
  tracks: T[];
  peakTrackId: string | null;
  peakIndex: number | null;
  peakResonance: number;
}

export function emotionalResonance(
  track: { energy: number | null; valence: number | null },
  sceneCtx: SceneContext,
  profile: EmotionProfile
): number {
  const sceneFit = sceneMatchScore(sceneCtx, profile, track);
  const emotionFit =
    1 -
    (Math.abs((track.energy ?? 0.5) - profile.energy) +
      Math.abs((track.valence ?? 0.5) - profile.valence)) /
      2;
  return sceneFit * 0.55 + emotionFit * 0.45;
}

export function placeEmotionalPeak<T extends {
  trackId: string;
  score: number;
  energy: number | null;
  valence: number | null;
  artistName?: string;
}>(
  tracks: T[],
  pool: T[],
  opts: {
    vibe: string;
    emotionProfile: EmotionProfile;
    canonical: CanonicalSceneResult | null;
    playlistLength: number;
  }
): PeakPlacementResult<T> {
  if (tracks.length < 6) {
    return { tracks, peakTrackId: null, peakIndex: null, peakResonance: 0 };
  }

  const sceneCtx = resolveSceneContext(opts.vibe, opts.canonical, opts.emotionProfile, null);
  const used = new Set(tracks.map((t) => t.trackId));

  let best: { track: T; resonance: number } | null = null;
  for (const t of [...tracks, ...pool]) {
    if (!used.has(t.trackId) && !tracks.some((x) => x.trackId === t.trackId)) {
      const r = emotionalResonance(t, sceneCtx, opts.emotionProfile);
      if (!best || r > best.resonance) best = { track: t, resonance: r };
    }
  }
  for (const t of tracks) {
    const r = emotionalResonance(t, sceneCtx, opts.emotionProfile);
    if (!best || r > best.resonance) best = { track: t, resonance: r };
  }

  if (!best || best.resonance < 0.48) {
    return { tracks, peakTrackId: null, peakIndex: null, peakResonance: best?.resonance ?? 0 };
  }

  const targetIdx = Math.min(
    tracks.length - 2,
    Math.max(1, Math.floor(opts.playlistLength * (0.7 + 0.15 * 0.5)))
  );
  const targetIdxClamped = Math.min(targetIdx, tracks.length - 1);

  const result = [...tracks];
  const currentIdx = result.findIndex((t) => t.trackId === best.track.trackId);

  if (currentIdx < 0) {
    const swapOut = Math.min(result.length - 1, targetIdxClamped);
    result[swapOut] = best.track;
    return {
      tracks: result,
      peakTrackId: best.track.trackId,
      peakIndex: swapOut,
      peakResonance: Math.round(best.resonance * 1000) / 1000,
    };
  }

  if (currentIdx === targetIdxClamped) {
    return {
      tracks: result,
      peakTrackId: best.track.trackId,
      peakIndex: currentIdx,
      peakResonance: Math.round(best.resonance * 1000) / 1000,
    };
  }

  const [peakTrack] = result.splice(currentIdx, 1);
  if (!peakTrack) {
    return { tracks: result, peakTrackId: null, peakIndex: null, peakResonance: 0 };
  }

  result.splice(targetIdxClamped, 0, peakTrack);

  return {
    tracks: result,
    peakTrackId: peakTrack.trackId,
    peakIndex: targetIdxClamped,
    peakResonance: Math.round(best.resonance * 1000) / 1000,
  };
}
