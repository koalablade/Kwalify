/**
 * Seasonal alignment — prevents christmas-in-summer leakage.
 */

import type { HumanIntent } from "./intent-decoder";

export type SeasonTag = "sun" | "summer" | "christmas" | "winter" | "rain" | "neutral";

export interface SceneSeasonContext {
  active: SeasonTag[];
  allowContrast: boolean;
  nostalgiaOverride: boolean;
}

const CHRISTMAS_TRACK_RE =
  /\b(christmas|xmas|noel|santa|jingle|winter wonderland|silent night|holiday song|festive|yuletide|deck the halls|last christmas|all i want for christmas|wonderful christmastime|fairytale of new york|mary's boy child|do they know it's christmas|christmas eve|christmas day|christmas album|christmas single)\b/i;

const WINTER_TRACK_RE =
  /\b(winter|snow|frost|december cold|january blues|icy|blizzard)\b/i;

const SUMMER_SUN_TRACK_RE =
  /\b(summer|sunshine|sunny|beach|tropical|heatwave|pool party|bbq|barbecue)\b/i;

const SUN_SCENE_RE =
  /\b(sun|sunny|summer|warm day|spring day|windows down|blue sky|beach|golden hour afternoon|first warm day)\b/i;

const CHRISTMAS_SCENE_RE =
  /\b(christmas|xmas|holiday lights|festive|winter holiday|december night)\b/i;

const WINTER_SCENE_RE = /\b(winter|snow|first snow|cold night|frost)\b/i;

const RAIN_SCENE_RE = /\b(rain|rainy|downpour|storm|windscreen|windshield|wet road)\b/i;

export function buildSceneSeasonContext(
  vibe: string,
  season?: string | null
): SceneSeasonContext {
  const lower = vibe.toLowerCase();
  const active = new Set<SeasonTag>();

  if (SUN_SCENE_RE.test(lower) || season === "summer" || season === "spring") {
    active.add("sun");
    active.add("summer");
  }
  if (CHRISTMAS_SCENE_RE.test(lower) || season === "winter") {
    active.add("christmas");
    active.add("winter");
  }
  if (WINTER_SCENE_RE.test(lower)) active.add("winter");
  if (RAIN_SCENE_RE.test(lower)) active.add("rain");

  if (active.size === 0) active.add("neutral");

  const nostalgiaOverride = /\bnostalg|take me back|forgot you loved|childhood|memory\b/i.test(lower);

  return {
    active: [...active],
    allowContrast: /\bcontrast|surprise|wildcard|chaotic\b/i.test(lower),
    nostalgiaOverride,
  };
}

export function inferTrackSeasonTags(track: {
  trackName: string;
  artistName: string;
  albumName: string;
}): Set<SeasonTag> {
  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const tags = new Set<SeasonTag>();

  if (CHRISTMAS_TRACK_RE.test(blob)) {
    tags.add("christmas");
    tags.add("winter");
  } else if (WINTER_TRACK_RE.test(blob)) {
    tags.add("winter");
  }

  if (SUMMER_SUN_TRACK_RE.test(blob)) tags.add("summer");

  if (tags.size === 0) tags.add("neutral");
  return tags;
}

/** 0–1 alignment with active scene seasons */
export function seasonalMatchScore(ctx: SceneSeasonContext, trackTags: Set<SeasonTag>): number {
  if (ctx.active.includes("neutral") || trackTags.has("neutral")) return 0.65;

  for (const t of trackTags) {
    if (ctx.active.includes(t)) return 1;
  }

  if (ctx.active.includes("sun") || ctx.active.includes("summer")) {
    if (trackTags.has("christmas") || trackTags.has("winter")) return 0;
    return 0.45;
  }

  if (ctx.active.includes("christmas") || ctx.active.includes("winter")) {
    if (trackTags.has("summer") || trackTags.has("sun")) return 0.25;
    return 0.55;
  }

  if (ctx.active.includes("rain")) return 0.7;

  return 0.5;
}

/** Hard exclude reason or null */
export function seasonalHardExclude(
  ctx: SceneSeasonContext,
  trackTags: Set<SeasonTag>,
  intent: HumanIntent
): string | null {
  const nostalgiaOk = ctx.nostalgiaOverride || intent === "nostalgia";

  const sceneIsSun = ctx.active.includes("sun") || ctx.active.includes("summer");
  if (sceneIsSun && trackTags.has("christmas") && !nostalgiaOk && !ctx.allowContrast) {
    return "seasonal_mismatch:christmas_in_sun_scene";
  }

  if (
    sceneIsSun &&
    trackTags.has("winter") &&
    !trackTags.has("summer") &&
    !nostalgiaOk &&
    !ctx.allowContrast
  ) {
    return "seasonal_mismatch:winter_in_sun_scene";
  }

  return null;
}
