/**
 * Semantic scene conflicts — e.g. sun/summer must not pull christmas/holiday tracks.
 */

import type { HumanIntent } from "../../lib/intent-decoder";
import { inferTrackSeasonTags } from "../../lib/seasonal-logic";
import type { VibeKind } from "../../lib/emotion";
import type { SceneFamily } from "../../lib/scene-validation";

export interface SceneConflictContext {
  vibe: string;
  vibeKind: VibeKind;
  sceneFamily: SceneFamily;
  intent: HumanIntent;
  suppressHoliday: boolean;
  suppressWinterHoliday: boolean;
  boostWarmBright: boolean;
}

const SUN_SCENE_RE =
  /\b(sun|sunny|summer|bright|golden hour|warm day|warm glow|feel(s)? like sun|sunshine|blue sky|windows down)\b/i;

const HOLIDAY_TRACK_RE =
  /\b(christmas|xmas|noel|santa|jingle|sleigh|holiday song|festive|yuletide|winter wonderland|silent night|all i want for christmas|last christmas|wonderful christmastime|mary's boy child|christmas eve|christmas album)\b/i;

const HOLIDAY_AUDIO_CUES_RE = /\b(sleigh bells|jingle bells|carol|carols|nutcracker)\b/i;

export function resolveSceneConflicts(opts: {
  vibe: string;
  vibeKind: VibeKind;
  sceneFamily: SceneFamily;
  intent: HumanIntent;
}): SceneConflictContext {
  const lower = opts.vibe.toLowerCase();
  const sunScene =
    opts.vibeKind === "sunny" ||
    opts.sceneFamily === "sun_day" ||
    SUN_SCENE_RE.test(lower);

  return {
    vibe: opts.vibe,
    vibeKind: opts.vibeKind,
    sceneFamily: opts.sceneFamily,
    intent: opts.intent,
    suppressHoliday: sunScene && opts.intent !== "nostalgia",
    suppressWinterHoliday: sunScene && !/\b(christmas|xmas|holiday|festive|winter holiday)\b/i.test(lower),
    boostWarmBright: sunScene,
  };
}

export function trackViolatesSceneConflict(
  track: { trackName: string; artistName: string; albumName: string },
  ctx: SceneConflictContext,
  holidayBound: boolean
): string | null {
  if (!ctx.suppressHoliday && !ctx.suppressWinterHoliday) return null;

  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const tags = inferTrackSeasonTags(track);

  if (ctx.suppressHoliday) {
    if (holidayBound) return "scene_conflict:holiday_bound_in_sun";
    if (tags.has("christmas")) return "scene_conflict:christmas_tag_in_sun";
    if (HOLIDAY_TRACK_RE.test(blob)) return "scene_conflict:christmas_text_in_sun";
    if (HOLIDAY_AUDIO_CUES_RE.test(blob)) return "scene_conflict:holiday_audio_cue_in_sun";
  }

  if (ctx.suppressWinterHoliday && tags.has("winter") && !tags.has("summer")) {
    return "scene_conflict:winter_in_sun";
  }

  return null;
}
