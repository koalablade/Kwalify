/**
 * Negative tag intelligence — what a moment is NOT.
 */

import type { ScenePrototype } from "./scene-prototypes";

const EXCLUSION_PENALTIES: Record<string, (song: SongSignals) => number> = {
  party_high_energy: (s) => {
    const e = s.energy ?? 0.5;
    const d = s.danceability ?? 0.5;
    if (e > 0.78 && d > 0.72) return -0.18;
    if (e > 0.7) return -0.1;
    return 0;
  },
  daytime_upbeat: (s) => {
    const v = s.valence ?? 0.5;
    const e = s.energy ?? 0.5;
    if (v > 0.75 && e > 0.65) return -0.14;
    return 0;
  },
  social_high_energy: (s) => {
    const e = s.energy ?? 0.5;
    const sp = s.speechiness ?? 0.3;
    if (e > 0.75 && sp > 0.4) return -0.12;
    return 0;
  },
  aggressive: (s) => {
    const e = s.energy ?? 0.5;
    const v = s.valence ?? 0.5;
    if (e > 0.82 && v < 0.4) return -0.15;
    return 0;
  },
  hype: (s) => ((s.energy ?? 0.5) > 0.8 ? -0.12 : 0),
  peak_energy: (s) => ((s.energy ?? 0.5) > 0.85 ? -0.14 : 0),
  club: (s) => {
    const d = s.danceability ?? 0.5;
    const e = s.energy ?? 0.5;
    if (d > 0.78 && e > 0.75) return -0.12;
    return 0;
  },
  deep_sad: (s) => ((s.valence ?? 0.5) < 0.22 ? -0.1 : 0),
  harsh: (s) => ((s.energy ?? 0.5) > 0.75 && (s.valence ?? 0.5) < 0.35 ? -0.1 : 0),
  isolated_cold: (s) => ((s.valence ?? 0.5) < 0.25 && (s.acousticness ?? 0.5) < 0.2 ? -0.08 : 0),
};

interface SongSignals {
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  speechiness: number | null;
  acousticness: number | null;
}

export function exclusionPenalty(
  song: SongSignals,
  prototype: ScenePrototype | null,
  canonicalExcludes?: string[]
): number {
  const tags = new Set<string>([
    ...(prototype?.excludes ?? []),
    ...(canonicalExcludes ?? []),
  ]);
  let penalty = 0;
  for (const tag of tags) {
    const fn = EXCLUSION_PENALTIES[tag];
    if (fn) penalty += fn(song);
  }
  return Math.max(-0.35, penalty);
}
