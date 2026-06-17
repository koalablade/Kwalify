/**
 * Degraded but valid playlist when the main pipeline exceeds time budget.
 */

import type { EmotionProfile } from "./emotion";
import { sampleTracksForProfile } from "./library-sample";

export const FAST_SCAN_MAX = 1200;

function emotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2;
}

function fallbackTransitionCost(
  a: { energy: number | null; valence: number | null },
  b: { energy: number | null; valence: number | null }
): number {
  return Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)) * 0.65 +
    Math.abs((a.valence ?? 0.5) - (b.valence ?? 0.5)) * 0.35;
}

function orderFallbackCoherently<T extends { energy: number | null; valence: number | null }>(tracks: T[]): T[] {
  if (tracks.length <= 2) return tracks;
  const remaining = [...tracks];
  const first = remaining.shift()!;
  const ordered = [first];
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const cost = fallbackTransitionCost(current, remaining[index]) + index * 0.006;
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

export function buildFastFallbackPlaylist<
  T extends {
    trackId: string;
    energy: number | null;
    valence: number | null;
    artistName: string;
    score?: number;
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist?: number;
  recentTrackPenalty?: Map<string, number>;
  artistReusePenalty?: Map<string, number>;
  intentFitByTrack?: Map<string, number>;
}): T[] {
  const pool =
    opts.tracks.length > FAST_SCAN_MAX
      ? sampleTracksForProfile(opts.tracks, FAST_SCAN_MAX)
      : opts.tracks;

  const ranked = pool
    .map((t, index) => ({
      t,
      fit:
        emotionFit(t, opts.emotionProfile) * 0.72 +
        Math.max(0, Math.min(1, t.score ?? 0.5)) * 0.20 +
        Math.max(-0.6, Math.min(0.6, opts.intentFitByTrack?.get(t.trackId) ?? 0)) * 0.55 +
        (1 - index / Math.max(1, pool.length)) * 0.08 -
        Math.max(0, Math.min(0.32, opts.recentTrackPenalty?.get(t.trackId) ?? 0)) * 0.42 -
        Math.max(0, Math.min(0.94, opts.artistReusePenalty?.get(t.artistName.toLowerCase().trim()) ?? 0)) * 0.30,
    }))
    .sort((a, b) => b.fit - a.fit);

  const maxPerArtist = opts.maxPerArtist ?? 4;
  const artistCount = new Map<string, number>();
  const usedTrackIds = new Set<string>();
  const out: T[] = [];

  const tryAdd = (t: T, artistLimit: number | null): boolean => {
    if (out.length >= opts.playlistLength) return false;
    if (usedTrackIds.has(t.trackId)) return false;
    const key = t.artistName.toLowerCase().trim();
    const n = artistCount.get(key) ?? 0;
    if (artistLimit !== null && n >= artistLimit) return false;
    artistCount.set(key, n + 1);
    usedTrackIds.add(t.trackId);
    out.push(t);
    return true;
  };

  for (const { t } of ranked) {
    if (out.length >= opts.playlistLength) break;
    tryAdd(t, maxPerArtist);
  }

  if (out.length < opts.playlistLength) {
    const relaxedMaxPerArtist = Number.isFinite(maxPerArtist) ? maxPerArtist + 1 : maxPerArtist;
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      tryAdd(t, relaxedMaxPerArtist);
    }
  }

  if (out.length < opts.playlistLength) {
    const emergencyMaxPerArtist = Number.isFinite(maxPerArtist)
      ? maxPerArtist + Math.max(1, Math.ceil(opts.playlistLength * 0.05))
      : maxPerArtist;
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      tryAdd(t, emergencyMaxPerArtist);
    }
  }

  return orderFallbackCoherently(out);
}
