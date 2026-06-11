/**
 * Degraded but valid playlist when the main pipeline exceeds time budget.
 */

import type { EmotionProfile } from "./emotion";
import { sampleTracksForProfile } from "./library-sample";

const FAST_SCAN_MAX = 600;

function emotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2;
}

export function buildFastFallbackPlaylist<
  T extends {
    trackId: string;
    energy: number | null;
    valence: number | null;
    artistName: string;
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist?: number;
}): T[] {
  const pool =
    opts.tracks.length > FAST_SCAN_MAX
      ? sampleTracksForProfile(opts.tracks, FAST_SCAN_MAX, Date.now())
      : opts.tracks;

  const ranked = pool
    .map((t) => ({ t, fit: emotionFit(t, opts.emotionProfile) }))
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

  return out;
}
