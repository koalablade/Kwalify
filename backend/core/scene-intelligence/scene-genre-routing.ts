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
  /** Per-genre pool multiplier (0.15–1.40) */
  genreMultipliers: Partial<Record<RootGenre, number>>;
}

const SUN_WARM_RE =
  /\b(sun|sunny|summer|bright|golden hour|warm|feel(s)? like sun|sunshine|blue sky)\b/i;

const NIGHT_DRIVE_RE =
  /\b(late night|2\s*am|3\s*am|midnight|night drive|motorway|highway|empty road at night)\b/i;

const COUNTRY_SCENE_RE =
  /\b(country|road trip|nashville|honky|americana|outlaw|heartland|southern rock|roots rock)\b/i;

const OUTLAW_COUNTRY_RE =
  /\b(outlaw country|outlaw.{0,10}music|tyler childers|zach bryan|jason isbell|chris stapleton|turnpike|sturgill|colter wall|western.{0,15}swing|honky.?tonk)\b/i;

const RURAL_SUNSET_RE =
  /\b(dirt road|country road|gravel road|dusty road|rural|countryside|farmland|open road|dog.{0,20}(road|field)|field.{0,20}(sunset|golden|dusk|warm)|sunset.{0,20}(road|drive|field|country|farm))\b/i;

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

const TRAIN_JOURNEY_RE =
  /\b(train journey|train ride|on a train|train window|rail journey|railway)\b/i;

const AIRPORT_RE =
  /\b(airport.{0,20}(wait|lounge|terminal|gate|departure)|waiting.{0,20}(flight|departure|gate)|departure lounge)\b/i;

const HEARTBREAK_RE =
  /\b(heartbreak|heartbroken|broken heart|just broke.{0,10}up|breakup|break up|split up|she left|he left)\b/i;

const NOSTALGIA_RE =
  /\b(nostalgia|nostalgic|reminiscing|throwback|old times|when i was (young|a kid)|back in the day)\b/i;

const RAVE_90S_RE =
  /\b(90s.{0,10}(rave|uk rave|acid house|drum.{0,5}bass|gabber)|uk rave|acid house|warehouse rave|old skool rave|breakbeat|jungle music)\b/i;

const JAPANESE_CITY_POP_RE =
  /\b(japanese city pop|city pop|j-?pop.{0,20}(80s|retro)|japanese.{0,20}(80s|retro|funk)|plastic love|tatsuro|mariya takeuchi)\b/i;

const NEON_STREETS_RE =
  /\b(neon streets|neon lights.{0,20}(night|city)|late.?night.{0,20}(city|urban|streets)|cyberpunk|synthwave.{0,20}city)\b/i;

const COMING_HOME_RE =
  /\b(coming home|driving home|heading home|on my way home|back home|homecoming)\b/i;

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
    if (mult < 0.85 && !suppressed.includes(g)) suppressed.push(g);
  };

  // ── Outlaw Country (strictest lock — genre-specific request) ──────────────
  if (OUTLAW_COUNTRY_RE.test(lower)) {
    apply("country", 1.40);
    apply("folk", 1.25);
    apply("blues", 1.20);
    apply("rock", 1.12);
    apply("indie", 0.55);
    apply("electronic", 0.15);
    apply("hip_hop", 0.12);
    apply("rnb", 0.15);
    apply("pop", 0.30);
    apply("latin", 0.12);
    apply("metal", 0.10);
    apply("reggae", 0.12);
    apply("classical", 0.20);
    suppressed.push("electronic", "hip_hop", "metal", "rnb", "latin");
  }

  // ── Rural / Dirt Road / Countryside ───────────────────────────────────────
  if (RURAL_SUNSET_RE.test(lower)) {
    apply("country", 1.35);
    apply("folk", 1.28);
    apply("blues", 1.12);
    apply("rock", 1.08);
    apply("indie", 1.05);
    apply("soul", 0.88);
    apply("electronic", 0.18);
    apply("hip_hop", 0.15);
    apply("rnb", 0.20);
    apply("latin", 0.15);
    apply("metal", 0.12);
    apply("reggae", 0.15);
    apply("classical", 0.28);
    apply("pop", 0.58);
    suppressed.push("electronic", "hip_hop", "metal", "rnb");
  }

  // ── Explicit Country Scene ─────────────────────────────────────────────────
  if (COUNTRY_SCENE_RE.test(lower)) {
    apply("country", 1.35);
    apply("folk", 1.18);
    apply("blues", 1.10);
    apply("rock", 1.06);
    apply("indie", 0.85);
    apply("electronic", 0.25);
    apply("hip_hop", 0.20);
    apply("metal", 0.18);
    apply("pop", 0.55);
    boosted.push("country");
    suppressed.push("electronic", "hip_hop");
  }

  // ── Coming Home ─────────────────────────────────────────────────────────────
  if (COMING_HOME_RE.test(lower)) {
    apply("country", 1.22);
    apply("folk", 1.22);
    apply("indie", 1.12);
    apply("rock", 1.08);
    apply("soul", 1.06);
    apply("pop", 0.85);
    apply("electronic", 0.45);
    apply("hip_hop", 0.40);
    apply("metal", 0.25);
    suppressed.push("metal");
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
    apply("electronic", 0.38);
    apply("hip_hop", 0.28);
    apply("metal", 0.12);
    suppressed.push("electronic", "metal");
  }

  // ── Night Drive / Motorway ─────────────────────────────────────────────────
  if (NIGHT_DRIVE_RE.test(lower) || opts.sceneFamily === "night_introspective") {
    apply("indie", 1.12);
    apply("electronic", 1.10);
    apply("rnb", 1.08);
    apply("jazz", 1.06);
    apply("rock", 1.05);
    apply("pop", 0.85);
    apply("country", 0.70);
    apply("folk", 0.65);
    apply("metal", 0.38);
    apply("christmas", 0.30);
    suppressed.push("christmas", "country", "folk");
  }

  // ── Motorway Night / Synthwave ─────────────────────────────────────────────
  if (MOTORWAY_NIGHT_RE.test(lower)) {
    apply("electronic", 1.32);
    apply("rock", 1.18);
    apply("indie", 1.15);
    apply("pop", 1.05);
    apply("country", 0.40);
    apply("folk", 0.35);
    apply("classical", 0.48);
    apply("christmas", 0.22);
    suppressed.push("country", "folk", "christmas");
  }

  // ── Rainy City / Jazz-hop / Neo Soul ──────────────────────────────────────
  if (RAINY_CITY_RE.test(lower)) {
    apply("jazz", 1.32);
    apply("soul", 1.28);
    apply("rnb", 1.22);
    apply("indie", 1.12);
    apply("electronic", 1.08);
    apply("pop", 1.00);
    apply("country", 0.28);
    apply("folk", 0.32);
    apply("metal", 0.12);
    apply("latin", 0.30);
    apply("reggae", 0.30);
    suppressed.push("country", "metal", "latin", "folk");
  }

  // ── City After Midnight ────────────────────────────────────────────────────
  if (CITY_MIDNIGHT_RE.test(lower)) {
    apply("electronic", 1.25);
    apply("jazz", 1.22);
    apply("rnb", 1.15);
    apply("soul", 1.12);
    apply("indie", 1.10);
    apply("country", 0.28);
    apply("folk", 0.30);
    apply("metal", 0.18);
    apply("classical", 0.48);
    suppressed.push("country", "folk", "metal");
  }

  // ── Neon Streets ──────────────────────────────────────────────────────────
  if (NEON_STREETS_RE.test(lower)) {
    apply("electronic", 1.28);
    apply("rnb", 1.18);
    apply("hip_hop", 1.12);
    apply("pop", 1.08);
    apply("indie", 1.05);
    apply("country", 0.25);
    apply("folk", 0.28);
    apply("classical", 0.35);
    suppressed.push("country", "folk", "classical");
  }

  // ── Festival Sunset / Indie Electronic ────────────────────────────────────
  if (FESTIVAL_SUNSET_RE.test(lower)) {
    apply("indie", 1.25);
    apply("electronic", 1.20);
    apply("pop", 1.12);
    apply("folk", 1.08);
    apply("country", 0.52);
    apply("metal", 0.18);
    apply("classical", 0.42);
    suppressed.push("metal", "classical");
  }

  // ── Train Journey ──────────────────────────────────────────────────────────
  if (TRAIN_JOURNEY_RE.test(lower)) {
    apply("indie", 1.20);
    apply("folk", 1.18);
    apply("rock", 1.12);
    apply("electronic", 1.05);
    apply("jazz", 1.08);
    apply("pop", 0.88);
    apply("metal", 0.22);
    apply("hip_hop", 0.45);
    apply("latin", 0.38);
    suppressed.push("metal");
  }

  // ── Airport Waiting ────────────────────────────────────────────────────────
  if (AIRPORT_RE.test(lower)) {
    apply("electronic", 1.22);
    apply("indie", 1.18);
    apply("pop", 1.10);
    apply("jazz", 1.12);
    apply("soul", 1.08);
    apply("folk", 0.82);
    apply("country", 0.40);
    apply("metal", 0.18);
    apply("hip_hop", 0.42);
    suppressed.push("metal", "country");
  }

  // ── Heartbreak ─────────────────────────────────────────────────────────────
  if (HEARTBREAK_RE.test(lower)) {
    apply("indie", 1.22);
    apply("soul", 1.18);
    apply("folk", 1.15);
    apply("pop", 1.10);
    apply("rnb", 1.12);
    apply("rock", 1.05);
    apply("country", 1.08);
    apply("metal", 0.30);
    apply("electronic", 0.42);
    apply("latin", 0.35);
    suppressed.push("metal", "latin");
  }

  // ── Nostalgia ──────────────────────────────────────────────────────────────
  if (NOSTALGIA_RE.test(lower)) {
    apply("rock", 1.18);
    apply("pop", 1.15);
    apply("indie", 1.12);
    apply("soul", 1.10);
    apply("folk", 1.08);
    apply("rnb", 1.06);
    apply("country", 1.05);
    apply("metal", 0.38);
    apply("christmas", 0.45);
    suppressed.push("metal");
  }

  // ── 90s UK Rave ────────────────────────────────────────────────────────────
  if (RAVE_90S_RE.test(lower)) {
    apply("electronic", 1.40);
    apply("pop", 0.30);
    apply("country", 0.08);
    apply("folk", 0.08);
    apply("classical", 0.08);
    apply("jazz", 0.10);
    apply("blues", 0.10);
    apply("metal", 0.15);
    apply("reggae", 0.12);
    apply("latin", 0.12);
    apply("hip_hop", 0.25);
    suppressed.push("country", "folk", "classical", "jazz", "blues");
  }

  // ── Japanese City Pop ──────────────────────────────────────────────────────
  if (JAPANESE_CITY_POP_RE.test(lower)) {
    apply("pop", 1.30);
    apply("soul", 1.25);
    apply("rnb", 1.22);
    apply("jazz", 1.18);
    apply("electronic", 1.10);
    apply("country", 0.15);
    apply("folk", 0.20);
    apply("metal", 0.10);
    apply("classical", 0.20);
    apply("reggae", 0.18);
    suppressed.push("country", "folk", "metal", "classical");
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
    apply("metal", 0.55);
    apply("electronic", 0.65);
    apply("country", 0.72);
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
