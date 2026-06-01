/**
 * Hard filters — absolute exclusions before scoring.
 */

import type { HumanIntent } from "./intent-decoder";
import type { ScenePrototype } from "./scene-prototypes";
import type { SceneSeasonContext } from "./seasonal-logic";
import { seasonalHardExclude, inferTrackSeasonTags } from "./seasonal-logic";
import { classifyTrack } from "./genre-taxonomy";
import type { SceneFamily } from "./scene-validation";

export interface HardFilterContext {
  vibe: string;
  intent: HumanIntent;
  sceneFamily: SceneFamily;
  season: SceneSeasonContext;
  prototype: ScenePrototype | null;
  allowContrast: boolean;
  allowEnergyMismatch: number;
  emotionalComplexity: boolean;
  vibeKind: "sunny" | "late_night" | "neutral";
}

export interface HardFilterResult {
  pass: boolean;
  excludedBy: string | null;
}

interface TrackRow {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
}

export function applyHardFilters(track: TrackRow, ctx: HardFilterContext): HardFilterResult {
  const seasonTags = inferTrackSeasonTags(track);
  const seasonal = seasonalHardExclude(ctx.season, seasonTags, ctx.intent);
  if (seasonal) return { pass: false, excludedBy: seasonal };

  const classification = classifyTrack({
    ...track,
    acousticness: track.acousticness,
    energy: track.energy,
  });

  if (
    classification.holidayBound &&
    ctx.intent !== "nostalgia" &&
    !ctx.season.nostalgiaOverride &&
    !ctx.allowContrast &&
    (ctx.sceneFamily === "sun_day" || ctx.vibeKind === "sunny")
  ) {
    return { pass: false, excludedBy: "genre_exclusion:christmas_in_sun" };
  }

  if (
    ctx.prototype?.excludes.includes("christmas_holiday") &&
    classification.holidayBound &&
    !ctx.season.nostalgiaOverride
  ) {
    return { pass: false, excludedBy: "prototype_exclude:christmas_holiday" };
  }

  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const d = track.danceability ?? 0.5;

  if (ctx.prototype?.excludes.includes("party_high_energy") && e > 0.82 && d > 0.78 && !ctx.allowContrast) {
    return { pass: false, excludedBy: "prototype_exclude:party_high_energy" };
  }
  if (ctx.prototype?.excludes.includes("daytime_upbeat") && v > 0.8 && e > 0.72 && ctx.sceneFamily === "night_introspective") {
    return { pass: false, excludedBy: "prototype_exclude:daytime_upbeat" };
  }
  if (ctx.prototype?.excludes.includes("deep_sad") && v < 0.18 && ctx.sceneFamily === "sun_day" && !ctx.emotionalComplexity) {
    return { pass: false, excludedBy: "prototype_exclude:deep_sad_in_sun" };
  }

  const energyWindow = 0.35 + ctx.allowEnergyMismatch;
  if (ctx.sceneFamily === "night_introspective" && e > 0.88 && d > 0.8 && !ctx.allowContrast) {
    return { pass: false, excludedBy: "energy_mismatch:gym_peak_in_night_scene" };
  }
  if (ctx.vibeKind === "sunny" && v < 0.25 && e < 0.25 && !ctx.emotionalComplexity && !ctx.allowContrast) {
    return { pass: false, excludedBy: "energy_mismatch:lullaby_in_sun" };
  }
  if (Math.abs(e - 0.5) > energyWindow + 0.45 && !ctx.allowContrast && ctx.intent !== "energise") {
    if (e > 0.9 && ctx.sceneFamily === "memory_nostalgia" && ctx.intent === "reflect") {
      return { pass: false, excludedBy: "energy_mismatch:extreme_high" };
    }
  }

  if (
    ctx.sceneFamily === "sun_day" &&
    v < 0.28 &&
    e < 0.35 &&
    (track.acousticness ?? 0) > 0.5 &&
    !ctx.emotionalComplexity &&
    !/\b(rain|melancholy|sad|heartbreak)\b/i.test(ctx.vibe)
  ) {
    return { pass: false, excludedBy: "invalid_pairing:heavy_melancholy_in_sun" };
  }

  return { pass: true, excludedBy: null };
}
