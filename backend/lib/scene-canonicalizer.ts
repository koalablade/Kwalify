/**
 * Scene canonicalization — many phrases → one stable scene identity.
 */

import { detectLayeredScene } from "./emotion-scene-layers";
import { getPrototype, profileFromPrototype, type ScenePrototype } from "./scene-prototypes";
import type { EmotionProfile } from "./emotion";

export interface CanonicalSceneResult {
  sceneId: string;
  prototypeId: string;
  confidence: number;
  matchedVariants: string[];
  matchedAlias: string;
  inferredLayers: {
    time: string | null;
    motion: string | null;
    place: string | null;
    emotionalTone: string | null;
  };
}

interface CanonicalEntry {
  id: string;
  prototypeId: string;
  emotionalTone: string;
  aliases: string[];
}

export const CANONICAL_SCENES: CanonicalEntry[] = [
  {
    id: "night_drive_alone_reflection",
    prototypeId: "DRIVE_REFLECTION",
    emotionalTone: "introspection",
    aliases: [
      "late night drive alone",
      "driving at 2am",
      "night motorway introspection",
      "driving nowhere at midnight",
      "solo night motorway",
      "night drive alone",
      "driving alone at night",
      "empty motorway at night",
      "aimless drive midnight",
      "late night drive",
      "night motorway alone",
    ],
  },
  {
    id: "late_summer_friends_drive",
    prototypeId: "DRIVE_SOCIAL_AFTERGLOW",
    emotionalTone: "nostalgic_warmth",
    aliases: [
      "late summer evening driving home from seeing old friends",
      "driving home from seeing friends",
      "driving home from seeing old friends",
      "after seeing friends drive",
      "late summer evening with friends",
    ],
  },
  {
    id: "petrol_2am_liminal",
    prototypeId: "PETROL_LIMINAL",
    emotionalTone: "liminal",
    aliases: [
      "2am petrol station",
      "2 am petrol station",
      "petrol station at 2am",
      "late petrol station",
      "petrol station 2am",
      "petrol station 2am empty forecourt",
    ],
  },
  {
    id: "petrol_10am_routine",
    prototypeId: "PETROL_10AM_ROUTINE",
    emotionalTone: "routine",
    aliases: ["10am petrol station", "10 am petrol station", "petrol station morning", "quick stop petrol morning"],
  },
  {
    id: "rainy_train_home_decompress",
    prototypeId: "TRANSIT_DECOMPRESS",
    emotionalTone: "decompression",
    aliases: [
      "rainy train home",
      "late train home",
      "train home after work",
      "train window rain going home",
    ],
  },
  {
    id: "airport_sunrise_transition",
    prototypeId: "AIRPORT_TRANSITION",
    emotionalTone: "anticipation",
    aliases: ["airport at sunrise", "airport dawn", "departure lounge morning", "early flight hope"],
  },
  {
    id: "rain_windscreen_night_drive",
    prototypeId: "DRIVE_REFLECTION",
    emotionalTone: "cinematic_melancholy",
    aliases: [
      "rain on windscreen",
      "rain on windshield",
      "rain on the windscreen",
      "rainy night drive",
      "rain on windscreen at night",
    ],
  },
  {
    id: "library_archaeology",
    prototypeId: "ARCHAEOLOGY_MEMORY",
    emotionalTone: "memory_discovery",
    aliases: [
      "music you forgot you loved",
      "hidden corners of your library",
      "songs from another life",
      "your old soundtrack",
    ],
  },
  {
    id: "urban_midnight_walk",
    prototypeId: "TRANSIT_DECOMPRESS",
    emotionalTone: "solitude",
    aliases: [
      "midnight city walk",
      "late london walk",
      "urban midnight walk",
      "walking alone at night in the city",
    ],
  },
  {
    id: "memory_road_nostalgia",
    prototypeId: "ARCHAEOLOGY_MEMORY",
    emotionalTone: "nostalgic_warmth",
    aliases: [
      "nostalgic country road",
      "old car project",
      "memory road",
      "country road memory",
    ],
  },
  {
    id: "summer_afternoon_drift",
    prototypeId: "SUN_DAY_DRIVE",
    emotionalTone: "warmth",
    aliases: [
      "summer afternoon drift",
      "end of summer drive",
      "warm haze drive",
      "afternoon drift warm haze",
    ],
  },
];

/** UI mood cards → canonical scene (Emotion Grid in pets-ui.js). */
export const MOOD_SCENE_ID_MAP: Record<string, string> = {
  petrol_station_2am: "petrol_2am_liminal",
  night_drive: "night_drive_alone_reflection",
  urban_midnight_walk: "urban_midnight_walk",
  memory_road: "memory_road_nostalgia",
  summer_afternoon_drift: "summer_afternoon_drift",
};

export function resolveMoodSceneById(moodSceneId: string): CanonicalSceneResult | null {
  const canonicalId = MOOD_SCENE_ID_MAP[moodSceneId.trim()];
  if (!canonicalId) return null;
  const entry = CANONICAL_SCENES.find((e) => e.id === canonicalId);
  if (!entry) return null;
  const layers = detectLayeredScene(entry.aliases[0] ?? "");
  return {
    sceneId: entry.id,
    prototypeId: entry.prototypeId,
    confidence: 1,
    matchedVariants: [moodSceneId],
    matchedAlias: moodSceneId,
    inferredLayers: {
      time: layers.timeOfDay,
      motion: layers.motionState,
      place: layers.environment,
      emotionalTone: entry.emotionalTone,
    },
  };
}

/** @deprecated use resolveCanonicalSceneFull */
export type CanonicalScene = CanonicalSceneResult;

export function resolveCanonicalSceneFull(text: string): CanonicalSceneResult | null {
  const lower = text.toLowerCase().trim();
  const layers = detectLayeredScene(text);
  let best: CanonicalSceneResult | null = null;

  for (const entry of CANONICAL_SCENES) {
    const matchedVariants: string[] = [];
    for (const alias of entry.aliases) {
      if (lower.includes(alias)) matchedVariants.push(alias);
    }
    if (matchedVariants.length === 0) continue;

    const longest = matchedVariants.reduce((a, b) => (a.length >= b.length ? a : b));
    const confidence = Math.min(1, 0.55 + longest.length / 80);

    if (!best || confidence > best.confidence) {
      best = {
        sceneId: entry.id,
        prototypeId: entry.prototypeId,
        confidence,
        matchedVariants,
        matchedAlias: longest,
        inferredLayers: {
          time: layers.timeOfDay,
          motion: layers.motionState,
          place: layers.environment,
          emotionalTone: entry.emotionalTone,
        },
      };
    }
  }

  return best;
}

export function resolveCanonicalScene(text: string): CanonicalSceneResult | null {
  return resolveCanonicalSceneFull(text);
}

export function canonicalToPrototype(canonical: CanonicalSceneResult | null): ScenePrototype | null {
  if (!canonical) return null;
  return getPrototype(canonical.prototypeId);
}

/** When confidence is high, build profile from prototype — avoids keyword soup. */
export function profileFromCanonical(
  canonical: CanonicalSceneResult | null,
  fallback: EmotionProfile
): EmotionProfile {
  if (!canonical || canonical.confidence < 0.62) return fallback;
  const proto = getPrototype(canonical.prototypeId);
  if (!proto) return fallback;
  const seed = profileFromPrototype(proto);
  const w = canonical.confidence * 0.72;
  const lerp = (a: number, b: number) => a * (1 - w) + b * w;
  return {
    energy: lerp(fallback.energy, seed.energy),
    valence: lerp(fallback.valence, seed.valence),
    tension: lerp(fallback.tension, seed.tension),
    nostalgia: lerp(fallback.nostalgia, seed.nostalgia),
    calm: lerp(fallback.calm, seed.calm),
    environment: seed.environment ?? fallback.environment,
    timeOfDay: seed.timeOfDay ?? fallback.timeOfDay,
    motionState: seed.motionState ?? fallback.motionState,
  };
}
