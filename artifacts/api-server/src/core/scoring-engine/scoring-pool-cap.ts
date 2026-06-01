/**
 * Cap hybrid scoring pool — full-library tri-score on 10k+ tracks is too slow for HTTP.
 */

import type { EmotionProfile, VibeKind } from "../../lib/emotion";
import { passesSunnyGate } from "../../lib/emotion";
import type { TrackGenreClassification, RootGenre } from "../../lib/genre-taxonomy";

export const DEFAULT_MAX_HYBRID_SCORING_TRACKS = 2400;
export const LARGE_LIBRARY_MAX_HYBRID_SCORING_TRACKS = 1000;
export const LARGE_LIBRARY_THRESHOLD = 5000;

function seededJitter(trackId: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) | 0;
  return (h & 0xffff) / 0xffff;
}

function quickEmotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return (
    1 -
    (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2
  );
}

export function capTracksForHybridScoring<T extends {
  trackId: string;
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
}>(
  tracks: T[],
  opts: {
    emotionProfile: EmotionProfile;
    vibeKind: VibeKind;
    classifications: Map<string, TrackGenreClassification>;
    maxTracks?: number;
    seedMs?: number;
  }
): {
  pool: T[];
  originalCount: number;
  poolCapped: boolean;
  candidateCount: number;
} {
  const originalCount = tracks.length;
  const max =
    opts.maxTracks ??
    (originalCount > LARGE_LIBRARY_THRESHOLD
      ? LARGE_LIBRARY_MAX_HYBRID_SCORING_TRACKS
      : DEFAULT_MAX_HYBRID_SCORING_TRACKS);
  if (originalCount <= max) {
    return { pool: tracks, originalCount, poolCapped: false, candidateCount: originalCount };
  }

  let candidates = tracks;
  if (opts.vibeKind === "sunny") {
    const sunny = tracks.filter((t) =>
      passesSunnyGate({
        valence: t.valence,
        energy: t.energy,
        acousticness: t.acousticness ?? null,
      })
    );
    if (sunny.length >= Math.min(max, Math.floor(originalCount * 0.25))) {
      candidates = sunny;
    }
  }

  const seed = opts.seedMs ?? 0;
  const ranked = candidates.map((t) => ({
    t,
    fit: quickEmotionFit(t, opts.emotionProfile) + seededJitter(t.trackId, seed) * 0.05,
  }));
  ranked.sort((a, b) => b.fit - a.fit);

  const head = ranked.slice(0, Math.min(ranked.length, max * 2));
  const byFamily = new Map<RootGenre, typeof ranked>();
  for (const item of head) {
    const fam =
      opts.classifications.get(item.t.trackId)?.genreFamily ?? ("unknown" as RootGenre);
    const list = byFamily.get(fam) ?? [];
    list.push(item);
    byFamily.set(fam, list);
  }

  const picked: T[] = [];
  const seen = new Set<string>();
  const families = [...byFamily.keys()].filter((f) => f !== "unknown");

  while (picked.length < max && families.some((f) => (byFamily.get(f)?.length ?? 0) > 0)) {
    for (const fam of families) {
      const list = byFamily.get(fam);
      if (!list?.length) continue;
      const next = list.shift()!;
      if (seen.has(next.t.trackId)) continue;
      seen.add(next.t.trackId);
      picked.push(next.t);
      if (picked.length >= max) break;
    }
  }

  if (picked.length < max) {
    for (const item of ranked) {
      if (picked.length >= max) break;
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
    }
  }

  return {
    pool: picked,
    originalCount,
    poolCapped: true,
    candidateCount: candidates.length,
  };
}
