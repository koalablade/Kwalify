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
  const out: T[] = [];

  for (const { t } of ranked) {
    if (out.length >= opts.playlistLength) break;
    const key = t.artistName.toLowerCase().trim();
    const n = artistCount.get(key) ?? 0;
    if (n >= maxPerArtist) continue;
    artistCount.set(key, n + 1);
    out.push(t);
  }

  if (out.length < opts.playlistLength) {
    for (const { t } of ranked) {
      if (out.length >= opts.playlistLength) break;
      if (out.includes(t)) continue;
      out.push(t);
    }
  }

  return out;
}
