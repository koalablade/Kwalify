/**
 * Scene → genre routing — shapes eligible pool before/during scoring (not just score seasoning).
 */

import type { RootGenre } from "../../lib/genre-taxonomy";
import type { VibeKind } from "../../lib/emotion";
import type { SceneFamily } from "../../lib/scene-validation";

export interface SceneGenreRouting {
  boostedGenres: RootGenre[];
  suppressedGenres: RootGenre[];
  /** Per-genre pool multiplier (0.45–1.18) */
  genreMultipliers: Partial<Record<RootGenre, number>>;
}

const SUN_WARM_RE =
  /\b(sun|sunny|summer|bright|golden hour|warm|feel(s)? like sun|sunshine|blue sky)\b/i;

const NIGHT_DRIVE_RE = /\b(late night|2\s*am|3\s*am|midnight|night drive|motorway|highway)\b/i;

const COUNTRY_SCENE_RE = /\b(country|road trip|nashville|honky|americana|outlaw)\b/i;

export function resolveSceneGenreRouting(opts: {
  vibe: string;
  vibeKind: VibeKind;
  sceneFamily: SceneFamily;
}): SceneGenreRouting {
  const lower = opts.vibe.toLowerCase();
  const boosted: RootGenre[] = [];
  const suppressed: RootGenre[] = [];
  const genreMultipliers: Partial<Record<RootGenre, number>> = {};

  const apply = (g: RootGenre, mult: number) => {
    genreMultipliers[g] = mult;
    if (mult > 1.02) boosted.push(g);
    if (mult < 0.88) suppressed.push(g);
  };

  if (SUN_WARM_RE.test(lower) || opts.vibeKind === "sunny" || opts.sceneFamily === "sun_day") {
    apply("pop", 1.12);
    apply("soul", 1.1);
    apply("rnb", 1.08);
    apply("indie", 1.06);
    for (const g of ["christmas", "metal", "classical"] as RootGenre[]) {
      apply(g, 0.42);
      suppressed.push(g);
    }
  }

  if (NIGHT_DRIVE_RE.test(lower) || opts.sceneFamily === "night_introspective") {
    apply("indie", 1.08);
    apply("electronic", 1.06);
    apply("rnb", 1.05);
    apply("jazz", 1.04);
    apply("pop", 0.92);
    apply("christmas", 0.5);
    suppressed.push("christmas");
  }

  if (COUNTRY_SCENE_RE.test(lower)) {
    apply("country", 1.22);
    apply("folk", 0.88);
    apply("indie", 0.9);
    boosted.push("country");
  }

  if (/\b(afrobeat|afrobeats|amapiano|dancehall)\b/i.test(lower)) {
    apply("world", 1.15);
    apply("latin", 1.12);
    apply("reggae", 1.08);
  }

  if (/\b(jazz|blues|soul|smoky)\b/i.test(lower)) {
    apply("jazz", 1.14);
    apply("blues", 1.1);
    apply("soul", 1.1);
    apply("metal", 0.75);
  }

  return {
    boostedGenres: [...new Set(boosted)],
    suppressedGenres: [...new Set(suppressed)],
    genreMultipliers,
  };
}

export function scenePoolMultiplier(
  genre: RootGenre,
  routing: SceneGenreRouting
): number {
  return routing.genreMultipliers[genre] ?? 1;
}
