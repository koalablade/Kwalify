/**
 * Scene family resolution — one primary world, optional secondary context.
 */

import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { EmotionProfile } from "./emotion";

export type SceneFamily =
  | "sun_day"
  | "night_introspective"
  | "travel_driving"
  | "social_friends"
  | "memory_nostalgia"
  | "rural_countryside"
  | "urban_late_night"
  | "neutral";

export interface SceneContext {
  primary: SceneFamily;
  secondary: SceneFamily | null;
  primaryWeight: number;
  sceneId: string | null;
}

const CANONICAL_FAMILY: Record<string, SceneFamily> = {
  petrol_2am_liminal: "night_introspective",
  night_drive_alone_reflection: "night_introspective",
  rain_windscreen_night_drive: "urban_late_night",
  rainy_train_home_decompress: "night_introspective",
  petrol_10am_routine: "travel_driving",
  late_summer_friends_drive: "social_friends",
  airport_sunrise_transition: "travel_driving",
  library_archaeology: "memory_nostalgia",
  dirt_road_sunset: "rural_countryside",
  summer_field_golden_hour: "rural_countryside",
  rainy_city_lights: "urban_late_night",
  city_after_midnight: "urban_late_night",
};

const FAMILY_PATTERNS: { family: SceneFamily; re: RegExp; weight: number }[] = [
  { family: "sun_day", re: /\b(sun|sunny|summer day|warm day|beach|golden hour|windows down)\b/i, weight: 0.85 },
  { family: "night_introspective", re: /\b(2am|late night|midnight|petrol station at night|neon|introspect|liminal)\b/i, weight: 0.88 },
  { family: "travel_driving", re: /\b(driving|motorway|highway|road trip|train|commute|airport|transit)\b/i, weight: 0.80 },
  { family: "social_friends", re: /\b(friends|party with friends|after seeing friends|reunion|gathering)\b/i, weight: 0.82 },
  { family: "memory_nostalgia", re: /\b(nostalg|forgot you loved|archaeology|take me back|childhood|memory)\b/i, weight: 0.84 },
  { family: "rural_countryside", re: /\b(dirt road|country road|gravel road|dusty road|rural|countryside|farmland|open landscape|heartland|pastoral|field at (sunset|golden|dusk))\b/i, weight: 0.92 },
  { family: "urban_late_night", re: /\b(rainy city|city at night|city after midnight|wet streets|urban night|empty city streets|walking.{0,20}city.{0,20}(night|midnight))\b/i, weight: 0.90 },
];

export function resolveSceneContext(
  vibe: string,
  canonical: CanonicalSceneResult | null,
  profile: EmotionProfile,
  experienceSeason?: string | null
): SceneContext {
  const lower = vibe.toLowerCase();
  const scores: { family: SceneFamily; score: number }[] = [];

  if (canonical?.sceneId && CANONICAL_FAMILY[canonical.sceneId]) {
    scores.push({
      family: CANONICAL_FAMILY[canonical.sceneId],
      score: 0.7 + canonical.confidence * 0.3,
    });
  }

  for (const { family, re, weight } of FAMILY_PATTERNS) {
    if (re.test(lower)) scores.push({ family, score: weight });
  }

  if (profile.timeOfDay === "late_night" && profile.energy < 0.5) {
    scores.push({ family: "night_introspective", score: 0.75 });
  }
  if (profile.motionState === "driving") {
    scores.push({ family: "travel_driving", score: 0.72 });
  }
  if (profile.nostalgia > 0.55) {
    scores.push({ family: "memory_nostalgia", score: 0.68 });
  }
  if (experienceSeason === "summer" || /\bsun|summer\b/i.test(lower)) {
    scores.push({ family: "sun_day", score: 0.8 });
  }

  if (scores.length === 0) {
    return { primary: "neutral", secondary: null, primaryWeight: 0.5, sceneId: canonical?.sceneId ?? null };
  }

  scores.sort((a, b) => b.score - a.score);
  const primary = scores[0]!.family;
  const secondary = scores[1] && scores[1].family !== primary ? scores[1].family : null;

  return {
    primary,
    secondary,
    primaryWeight: scores[0]!.score,
    sceneId: canonical?.sceneId ?? null,
  };
}

export type SceneAudioTrack = {
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
};

export function toSceneAudioTrack(track: {
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
  danceability?: number | null;
}): SceneAudioTrack {
  return {
    energy: track.energy,
    valence: track.valence,
    acousticness: track.acousticness ?? null,
    danceability: track.danceability ?? null,
  };
}

export function sceneMatchScore(
  scene: SceneContext,
  profile: EmotionProfile,
  track: SceneAudioTrack
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const a = track.acousticness ?? 0.5;

  switch (scene.primary) {
    case "sun_day":
      return clamp01(1 - Math.abs(v - Math.max(0.55, profile.valence)) * 1.2 - Math.abs(e - Math.max(0.5, profile.energy)) * 0.8);
    case "night_introspective":
      return clamp01(1 - Math.abs(e - Math.min(0.45, profile.energy)) * 1.1 - (v > 0.75 && e > 0.7 ? 0.35 : 0));
    case "travel_driving":
      return clamp01(
        0.55 +
          (profile.nostalgia > 0.4 ? a * 0.25 : 0) +
          (1 - Math.abs(e - profile.energy) * 0.9) * 0.35
      );
    case "social_friends":
      return clamp01(1 - Math.abs(v - 0.55) * 0.9 - Math.abs(e - 0.52) * 0.7);
    case "memory_nostalgia":
      return clamp01(0.4 + profile.nostalgia * 0.35 + a * 0.25 - (e > 0.85 ? 0.2 : 0));
    case "rural_countryside":
      // Low-medium energy, warm acousticness, nostalgic valence
      return clamp01(
        0.5 +
          a * 0.28 +
          (1 - Math.abs(e - 0.42) * 1.4) * 0.22 +
          (v > 0.35 && v < 0.72 ? 0.12 : -0.08)
      );
    case "urban_late_night":
      // Low energy, moody valence, city-compatible (electronic/jazz friendly)
      return clamp01(
        0.55 +
          (1 - Math.abs(e - 0.33) * 1.2) * 0.28 +
          (v < 0.55 ? 0.12 : -0.08) +
          (1 - a) * 0.10
      );
    default:
      return 0.55;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
