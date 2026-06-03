/**
 * Scene → genre routing — shapes eligible pool before/during scoring (not just score seasoning).
 *
 * Scene-first: when the prompt describes a place or situation, the scene's genre
 * ecosystem must dominate the pool. At least 70% of tracks should come from
 * the dominant ecosystem. Negative matching prevents anti-genre tracks from
 * sneaking through even on generic mood tags.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";
import type { VibeKind } from "../../lib/emotion";
import type { SceneFamily } from "../../lib/scene-validation";

export interface SceneGenreRouting {
  boostedGenres: RootGenre[];
  suppressedGenres: RootGenre[];
  /** Per-genre pool multiplier (0.20–1.35) */
  genreMultipliers: Partial<Record<RootGenre, number>>;
}

const SUN_WARM_RE =
  /\b(sun|sunny|summer|bright|golden hour|warm|feel(s)? like sun|sunshine|blue sky)\b/i;

const NIGHT_DRIVE_RE =
  /\b(late night|2\s*am|3\s*am|midnight|night drive|motorway|highway|empty road at night)\b/i;

const COUNTRY_SCENE_RE =
  /\b(country|road trip|nashville|honky|americana|outlaw|heartland|southern rock|roots rock)\b/i;

const RURAL_SUNSET_RE =
  /\b(dirt road|country road|gravel road|dusty road|rural|countryside|farmland|open road|field.{0,20}(sunset|golden|dusk|warm)|sunset.{0,20}(road|drive|field|country|farm))\b/i;

const RAINY_CITY_RE =
  /\b(rainy city|rain.{0,15}city|city.{0,15}rain|jazzhop|neo soul|wet streets|rain.{0,20}(lights|window|glass|street)|city lights)\b/i;

const MOTORWAY_NIGHT_RE =
  /\b(empty motorway|motorway at night|highway at night|night drive|synthwave|driving home alone)\b/i;

const CITY_MIDNIGHT_RE =
  /\b(city after midnight|empty city|quiet city|walking.{0,20}city.{0,20}(night|midnight)|after midnight.{0,20}(city|street))\b/i;

const FESTIVAL_SUNSET_RE =
  /\b(festival sunset|festival field|summer festival|indie electronic|outdoor festival|sunset.{0,20}festival)\b/i;

const SUMMER_FIELD_RE =
  /\b(summer.{0,20}(field|meadow|countryside|evening)|golden hour.{0,20}(summer|field)|pastoral|open field)\b/i;

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
    genreMultipliers[g] = Math.max(genreMultipliers[g] ?? 0, mult);
    if (mult > 1.02 && !boosted.includes(g)) boosted.push(g);
    if (mult < 0.88 && !suppressed.includes(g)) suppressed.push(g);
  };

  // ── Rural / Dirt Road / Countryside ───────────────────────────────────────
  if (RURAL_SUNSET_RE.test(lower)) {
    apply("country", 1.35);
    apply("folk", 1.25);
    apply("blues", 1.12);
    apply("rock", 1.08);
    apply("indie", 1.05);
    apply("soul", 0.90);
    apply("electronic", 0.22);
    apply("hip_hop", 0.20);
    apply("rnb", 0.25);
    apply("latin", 0.20);
    apply("metal", 0.15);
    apply("reggae", 0.20);
    apply("classical", 0.30);
    apply("pop", 0.65);
    suppressed.push("electronic", "hip_hop", "metal");
  }

  // ── Explicit Country Scene ─────────────────────────────────────────────────
  if (COUNTRY_SCENE_RE.test(lower)) {
    apply("country", 1.35);
    apply("folk", 1.18);
    apply("blues", 1.10);
    apply("rock", 1.06);
    apply("indie", 0.88);
    apply("electronic", 0.30);
    apply("hip_hop", 0.25);
    apply("metal", 0.20);
    boosted.push("country");
    suppressed.push("electronic", "hip_hop");
  }

  // ── Sun / Warm Day ─────────────────────────────────────────────────────────
  if (SUN_WARM_RE.test(lower) || opts.vibeKind === "sunny" || opts.sceneFamily === "sun_day") {
    apply("pop", 1.12);
    apply("soul", 1.10);
    apply("rnb", 1.08);
    apply("indie", 1.06);
    apply("folk", 1.04);
    apply("christmas", 0.40);
    apply("metal", 0.35);
    apply("classical", 0.50);
    suppressed.push("christmas", "metal");
  }

  // ── Summer Field / Golden Hour ─────────────────────────────────────────────
  if (SUMMER_FIELD_RE.test(lower)) {
    apply("folk", 1.28);
    apply("indie", 1.20);
    apply("country", 1.15);
    apply("pop", 1.08);
    apply("rock", 1.05);
    apply("electronic", 0.40);
    apply("hip_hop", 0.30);
    apply("metal", 0.15);
    suppressed.push("electronic", "metal");
  }

  // ── Night Drive / Motorway ─────────────────────────────────────────────────
  if (NIGHT_DRIVE_RE.test(lower) || opts.sceneFamily === "night_introspective") {
    apply("indie", 1.12);
    apply("electronic", 1.10);
    apply("rnb", 1.08);
    apply("jazz", 1.06);
    apply("rock", 1.05);
    apply("pop", 0.88);
    apply("country", 0.75);
    apply("folk", 0.70);
    apply("metal", 0.40);
    apply("christmas", 0.35);
    suppressed.push("christmas", "country", "folk");
  }

  // ── Motorway Night / Synthwave ─────────────────────────────────────────────
  if (MOTORWAY_NIGHT_RE.test(lower)) {
    apply("electronic", 1.30);
    apply("rock", 1.18);
    apply("indie", 1.15);
    apply("pop", 1.05);
    apply("country", 0.45);
    apply("folk", 0.40);
    apply("classical", 0.50);
    apply("christmas", 0.25);
    suppressed.push("country", "folk", "christmas");
  }

  // ── Rainy City / Jazz-hop / Neo Soul ──────────────────────────────────────
  if (RAINY_CITY_RE.test(lower)) {
    apply("jazz", 1.30);
    apply("soul", 1.25);
    apply("rnb", 1.22);
    apply("indie", 1.12);
    apply("electronic", 1.08);
    apply("pop", 1.00);
    apply("country", 0.35);
    apply("folk", 0.40);
    apply("metal", 0.15);
    apply("latin", 0.35);
    apply("reggae", 0.35);
    suppressed.push("country", "metal", "latin");
  }

  // ── City After Midnight ────────────────────────────────────────────────────
  if (CITY_MIDNIGHT_RE.test(lower)) {
    apply("electronic", 1.25);
    apply("jazz", 1.20);
    apply("rnb", 1.15);
    apply("soul", 1.12);
    apply("indie", 1.10);
    apply("country", 0.30);
    apply("folk", 0.35);
    apply("metal", 0.20);
    apply("classical", 0.50);
    suppressed.push("country", "metal");
  }

  // ── Festival Sunset / Indie Electronic ────────────────────────────────────
  if (FESTIVAL_SUNSET_RE.test(lower)) {
    apply("indie", 1.25);
    apply("electronic", 1.20);
    apply("pop", 1.12);
    apply("folk", 1.08);
    apply("country", 0.55);
    apply("metal", 0.20);
    apply("classical", 0.45);
    suppressed.push("metal", "classical");
  }

  // ── Afrobeats / World ──────────────────────────────────────────────────────
  if (/\b(afrobeat|afrobeats|amapiano|dancehall)\b/i.test(lower)) {
    apply("world", 1.15);
    apply("latin", 1.12);
    apply("reggae", 1.08);
  }

  // ── Jazz / Blues / Soul / Smoky ────────────────────────────────────────────
  if (/\b(jazz|blues|soul|smoky)\b/i.test(lower)) {
    apply("jazz", 1.18);
    apply("blues", 1.14);
    apply("soul", 1.12);
    apply("rnb", 1.06);
    apply("metal", 0.60);
    apply("electronic", 0.70);
    apply("country", 0.75);
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
