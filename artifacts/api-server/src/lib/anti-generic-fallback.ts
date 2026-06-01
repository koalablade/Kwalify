/**
 * Anti-generic fallback — genre-consistent pool when scene match is thin.
 */

import type { EmotionProfile } from "./emotion";
import type { RootGenre } from "./genre-taxonomy";
import type { UserGenreProfile } from "./user-genre-profile";
import type { TrackGenreClassification } from "./genre-taxonomy";

export function shouldUseGenreFallback(poolSize: number, minNeeded: number): boolean {
  return poolSize < minNeeded;
}

export function pickFallbackGenres(
  userProfile: UserGenreProfile,
  profile: EmotionProfile,
  vibe: string
): RootGenre[] {
  const lower = vibe.toLowerCase();
  const fromUser = userProfile.dominant.slice(0, 3);

  if (/\b(country|highway|road trip|americana|small town)\b/i.test(lower)) {
    return ["country", "folk", ...fromUser.filter((g) => g !== "christmas")];
  }
  if (profile.nostalgia > 0.5) {
    return ["country", "folk", "rock", ...fromUser].filter(
      (g, i, a) => a.indexOf(g) === i
    ) as RootGenre[];
  }
  if (profile.energy > 0.6) {
    return ["rock", "pop", "hip_hop", ...fromUser] as RootGenre[];
  }

  return fromUser.length > 0 ? fromUser : ["pop", "rock", "indie"];
}

export function genreFallbackScore(
  classification: TrackGenreClassification,
  fallbackGenres: RootGenre[],
  profile: EmotionProfile
): number {
  let score = 0.2;
  if (fallbackGenres.includes(classification.genrePrimary)) score += 0.45;
  if (
    classification.genreSecondary &&
    fallbackGenres.includes(classification.genreSecondary)
  ) {
    score += 0.2;
  }

  const e = profile.energy;
  if (classification.genrePrimary === "country" || classification.genrePrimary === "folk") {
    if (e >= 0.35 && e <= 0.65) score += 0.12;
  }

  return Math.min(1, score);
}
