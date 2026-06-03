/**
 * Scene prototypes — structural behaviour templates scenes inherit.
 */

import type { JourneyArc } from "./emotion-destination";
import type { EmotionProfile } from "./emotion";
import type { RootGenre } from "./genre-taxonomy";
import type { GenreSignature } from "./genre-signature";

export interface SceneBlueprintEnvironment {
  place?: string;
  timeOfDay?: string;
  weather?: string;
  motion?: string;
}

export interface ScenePrototype {
  id: string;
  motion?: string;
  timeBias?: string;
  environment?: string;
  emotionFlow: [string, string, string];
  energyCurve: string;
  /** Numeric energy arc for sequencing */
  energyCurvePoints?: number[];
  sonicProfileTags: string[];
  transitionsTo: string[];
  journeyArc?: JourneyArc;
  excludes: string[];
  profileSeed?: Partial<EmotionProfile>;
  /** Structured scene blueprint */
  blueprint?: {
    environment: SceneBlueprintEnvironment;
    emotionalArc: { start: string; end: string };
    genreAffinity: Partial<Record<RootGenre, number>>;
    instrumentationBias: Partial<GenreSignature>;
    memoryType: string[];
    season?: "winter_holiday" | "summer" | "neutral";
  };
}

export const SCENE_PROTOTYPES: Record<string, ScenePrototype> = {
  drive_reflection: {
    id: "drive_reflection",
    motion: "driving",
    timeBias: "late_night",
    emotionFlow: ["introspection", "melancholy", "clarity"],
    energyCurve: "low → medium → low",
    sonicProfileTags: ["ambient", "indie", "downtempo"],
    transitionsTo: ["arrival_calm", "post_drive_release"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "daytime_upbeat", "social_high_energy", "christmas_holiday"],
    profileSeed: { energy: 0.28, valence: 0.4, tension: 0.3, nostalgia: 0.55, calm: 0.35 },
    blueprint: {
      environment: { motion: "driving", timeOfDay: "late_night" },
      emotionalArc: { start: "introspection", end: "clarity" },
      genreAffinity: { country: 0.55, folk: 0.7, indie: 0.65, electronic: 0.35 },
      instrumentationBias: { acoustic: 0.65, storytelling: 0.6, synth: 0.2, twang: 0.4 },
      memoryType: ["reflection", "nostalgia"],
      season: "neutral",
    },
  },
  DRIVE_REFLECTION: {
    id: "drive_reflection",
    motion: "driving",
    timeBias: "late_night",
    emotionFlow: ["introspection", "melancholy", "clarity"],
    energyCurve: "low → medium → low",
    sonicProfileTags: ["ambient", "indie", "downtempo"],
    transitionsTo: ["arrival_calm", "post_drive_release"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "daytime_upbeat", "social_high_energy"],
    profileSeed: { energy: 0.28, valence: 0.4, tension: 0.3, nostalgia: 0.55, calm: 0.35 },
  },
  DRIVE_SOCIAL_AFTERGLOW: {
    id: "drive_social_afterglow",
    motion: "driving",
    timeBias: "evening",
    emotionFlow: ["warmth", "nostalgia", "calm"],
    energyCurve: "medium → low",
    sonicProfileTags: ["indie", "pop", "warm"],
    transitionsTo: ["home_arrival"],
    journeyArc: "linear_fall",
    excludes: ["aggressive", "harsh", "isolated_cold"],
    profileSeed: { energy: 0.42, valence: 0.55, nostalgia: 0.65, calm: 0.3 },
    blueprint: {
      environment: { motion: "driving", timeOfDay: "evening" },
      emotionalArc: { start: "warmth", end: "calm" },
      genreAffinity: { country: 0.75, folk: 0.6, pop: 0.5, indie: 0.55 },
      instrumentationBias: { acoustic: 0.6, storytelling: 0.55, warmth: 0.75, twang: 0.45 },
      memoryType: ["nostalgia", "friendship"],
      season: "summer",
    },
  },
  PETROL_10AM_ROUTINE: {
    id: "petrol_10am_routine",
    motion: "driving",
    timeBias: "morning",
    environment: "urban",
    emotionFlow: ["routine", "movement", "practical"],
    energyCurve: "medium steady",
    sonicProfileTags: ["pop", "indie", "mid-tempo"],
    transitionsTo: ["day_progress"],
    journeyArc: "linear_rise",
    excludes: ["late_night_liminal", "party_high_energy", "deep_melancholy"],
    profileSeed: { energy: 0.48, valence: 0.52, tension: 0.28, nostalgia: 0.22, calm: 0.38 },
    blueprint: {
      environment: { place: "petrol", timeOfDay: "morning", motion: "driving" },
      emotionalArc: { start: "routine", end: "practical" },
      genreAffinity: { pop: 0.65, indie: 0.55, rock: 0.45 },
      instrumentationBias: { rhythm: 0.5, brightness: 0.55, synth: 0.25 },
      memoryType: ["movement"],
      season: "neutral",
    },
  },
  PETROL_LIMINAL: {
    id: "petrol_liminal",
    motion: "driving",
    timeBias: "late_night",
    environment: "urban",
    emotionFlow: ["liminality", "isolation", "introspection"],
    energyCurve: "low steady",
    sonicProfileTags: ["ambient", "electronic", "sparse"],
    transitionsTo: ["drive_reflection", "morning_routine"],
    journeyArc: "slow_burn",
    excludes: ["daytime_energy", "upbeat_party", "social_high_energy"],
    profileSeed: { energy: 0.22, valence: 0.32, tension: 0.55, nostalgia: 0.75, calm: 0.4 },
    blueprint: {
      environment: { place: "petrol", timeOfDay: "late_night", motion: "driving" },
      emotionalArc: { start: "liminality", end: "introspection" },
      genreAffinity: { electronic: 0.7, indie: 0.55, pop: 0.25 },
      instrumentationBias: { synth: 0.55, acoustic: 0.3, brightness: 0.25 },
      memoryType: ["isolation"],
      season: "neutral",
    },
  },
  SUN_DAY_DRIVE: {
    id: "sun_day_drive",
    motion: "driving",
    timeBias: "afternoon",
    emotionFlow: ["warmth", "freedom", "ease"],
    energyCurve: "medium steady",
    energyCurvePoints: [0.45, 0.55, 0.6, 0.5],
    sonicProfileTags: ["pop", "rock", "country", "indie"],
    transitionsTo: ["evening_calm"],
    journeyArc: "flat",
    excludes: ["christmas_holiday", "deep_sad", "party_high_energy"],
    profileSeed: { energy: 0.55, valence: 0.68, tension: 0.2, nostalgia: 0.35, calm: 0.4 },
    blueprint: {
      environment: { motion: "driving", weather: "clear", timeOfDay: "afternoon" },
      emotionalArc: { start: "warmth", end: "ease" },
      genreAffinity: { country: 0.8, folk: 0.65, pop: 0.55, rock: 0.5, electronic: 0.2 },
      instrumentationBias: { acoustic: 0.55, warmth: 0.8, brightness: 0.7, twang: 0.5, synth: 0.15 },
      memoryType: ["freedom", "nostalgia"],
      season: "summer",
    },
  },
  TRANSIT_DECOMPRESS: {
    id: "transit_decompress",
    motion: "transit",
    timeBias: "late_night",
    emotionFlow: ["fatigue", "decompression", "quiet"],
    energyCurve: "low → lower",
    sonicProfileTags: ["lo-fi", "ambient", "piano"],
    transitionsTo: ["home_calm"],
    journeyArc: "recovery",
    excludes: ["hype", "peak_energy", "club"],
    profileSeed: { energy: 0.18, valence: 0.42, tension: 0.28, nostalgia: 0.6, calm: 0.38 },
  },
  AIRPORT_TRANSITION: {
    id: "airport_transition",
    motion: "transit",
    timeBias: "morning",
    emotionFlow: ["anticipation", "hope", "motion"],
    energyCurve: "low → rising",
    sonicProfileTags: ["indie", "electronic", "uplift"],
    transitionsTo: ["travel_peak"],
    journeyArc: "linear_rise",
    excludes: ["heavy_metal", "aggressive", "deep_sad"],
    profileSeed: { energy: 0.42, valence: 0.55, tension: 0.35, nostalgia: 0.25, calm: 0.3 },
  },
  ARCHAEOLOGY_MEMORY: {
    id: "archaeology_memory",
    emotionFlow: ["discovery", "nostalgia", "surprise"],
    energyCurve: "wave",
    sonicProfileTags: ["varied", "memory", "acoustic"],
    transitionsTo: ["comfort", "reflection"],
    journeyArc: "wave",
    excludes: ["generic_chill_only"],
    profileSeed: { energy: 0.38, valence: 0.5, nostalgia: 0.85, calm: 0.28 },
  },
  DIRT_ROAD_SUNSET: {
    id: "dirt_road_sunset",
    motion: "driving",
    timeBias: "evening",
    environment: "rural",
    emotionFlow: ["nostalgic", "peaceful", "free"],
    energyCurve: "low → medium",
    energyCurvePoints: [0.30, 0.42, 0.48, 0.38],
    sonicProfileTags: ["acoustic", "country", "folk", "americana"],
    transitionsTo: ["evening_calm", "home_arrival"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "daytime_upbeat", "club", "aggressive"],
    profileSeed: { energy: 0.40, valence: 0.52, tension: 0.22, nostalgia: 0.72, calm: 0.48 },
    blueprint: {
      environment: { place: "rural road", timeOfDay: "evening", weather: "clear", motion: "driving" },
      emotionalArc: { start: "nostalgic", end: "peaceful" },
      genreAffinity: { country: 0.95, folk: 0.85, blues: 0.65, rock: 0.55, indie: 0.45 },
      instrumentationBias: { acoustic: 0.85, twang: 0.75, warmth: 0.80, storytelling: 0.70, synth: 0.05 },
      memoryType: ["nostalgia", "freedom", "heartland"],
      season: "neutral",
    },
  },
  PETROL_STATION_2AM: {
    id: "petrol_station_2am",
    motion: "driving",
    timeBias: "late_night",
    environment: "urban",
    emotionFlow: ["liminal", "isolated", "introspective"],
    energyCurve: "low steady",
    energyCurvePoints: [0.18, 0.22, 0.28, 0.20],
    sonicProfileTags: ["electronic", "ambient", "indie", "sparse"],
    transitionsTo: ["drive_reflection", "morning_routine"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "social_high_energy", "daytime_energy", "aggressive"],
    profileSeed: { energy: 0.22, valence: 0.30, tension: 0.55, nostalgia: 0.78, calm: 0.42 },
    blueprint: {
      environment: { place: "petrol station", timeOfDay: "late_night" },
      emotionalArc: { start: "liminal", end: "introspective" },
      genreAffinity: { electronic: 0.85, indie: 0.75, pop: 0.45, soul: 0.40, rnb: 0.35 },
      instrumentationBias: { synth: 0.65, acoustic: 0.25, brightness: 0.20, warmth: 0.30 },
      memoryType: ["isolation", "nostalgia"],
      season: "neutral",
    },
  },
  MOTORWAY_NIGHT: {
    id: "motorway_night",
    motion: "driving",
    timeBias: "late_night",
    emotionFlow: ["focused", "introspective", "free"],
    energyCurve: "medium steady",
    energyCurvePoints: [0.40, 0.52, 0.58, 0.48],
    sonicProfileTags: ["electronic", "rock", "indie", "synthwave"],
    transitionsTo: ["arrival_calm", "drive_reflection"],
    journeyArc: "flat",
    excludes: ["christmas_holiday", "party_high_energy", "acoustic_campfire"],
    profileSeed: { energy: 0.50, valence: 0.42, tension: 0.42, nostalgia: 0.45, calm: 0.35 },
    blueprint: {
      environment: { timeOfDay: "late_night", motion: "driving" },
      emotionalArc: { start: "focused", end: "introspective" },
      genreAffinity: { electronic: 0.90, rock: 0.75, indie: 0.70, pop: 0.45 },
      instrumentationBias: { synth: 0.70, rhythm: 0.60, brightness: 0.45, acoustic: 0.20 },
      memoryType: ["motion", "introspection"],
      season: "neutral",
    },
  },
  RAINY_CITY_LIGHTS: {
    id: "rainy_city_lights",
    timeBias: "evening",
    environment: "urban",
    emotionFlow: ["melancholic", "reflective", "cinematic"],
    energyCurve: "low → medium → low",
    energyCurvePoints: [0.25, 0.35, 0.38, 0.28],
    sonicProfileTags: ["jazz", "neo-soul", "electronic", "rnb"],
    transitionsTo: ["night_introspective", "memory_nostalgia"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "aggressive", "daytime_upbeat", "christmas_holiday"],
    profileSeed: { energy: 0.32, valence: 0.38, tension: 0.42, nostalgia: 0.60, calm: 0.40 },
    blueprint: {
      environment: { place: "city", timeOfDay: "evening", weather: "rain" },
      emotionalArc: { start: "melancholic", end: "reflective" },
      genreAffinity: { jazz: 0.90, soul: 0.85, rnb: 0.80, indie: 0.65, electronic: 0.55 },
      instrumentationBias: { acoustic: 0.45, warmth: 0.55, synth: 0.40, storytelling: 0.50 },
      memoryType: ["reflection", "urban", "cinematic"],
      season: "neutral",
    },
  },
  SUMMER_EVENING_COUNTRYSIDE: {
    id: "summer_evening_countryside",
    timeBias: "evening",
    environment: "rural",
    emotionFlow: ["peaceful", "warm", "nostalgic"],
    energyCurve: "medium → low",
    energyCurvePoints: [0.48, 0.42, 0.35, 0.30],
    sonicProfileTags: ["folk", "indie", "acoustic", "pastoral"],
    transitionsTo: ["evening_calm", "home_arrival"],
    journeyArc: "linear_fall",
    excludes: ["party_high_energy", "aggressive", "club", "christmas_holiday"],
    profileSeed: { energy: 0.42, valence: 0.58, tension: 0.18, nostalgia: 0.62, calm: 0.52 },
    blueprint: {
      environment: { place: "countryside", timeOfDay: "evening", weather: "clear" },
      emotionalArc: { start: "peaceful", end: "nostalgic" },
      genreAffinity: { folk: 0.90, indie: 0.80, country: 0.70, pop: 0.55, rock: 0.40 },
      instrumentationBias: { acoustic: 0.80, warmth: 0.82, storytelling: 0.60, synth: 0.10 },
      memoryType: ["freedom", "nostalgia", "pastoral"],
      season: "summer",
    },
  },
  DRIVING_HOME_BREAKUP: {
    id: "driving_home_breakup",
    motion: "driving",
    timeBias: "evening",
    emotionFlow: ["sad", "reflective", "numb"],
    energyCurve: "low steady",
    energyCurvePoints: [0.28, 0.32, 0.30, 0.25],
    sonicProfileTags: ["indie", "folk", "rnb", "acoustic"],
    transitionsTo: ["home_calm", "arrival_calm"],
    journeyArc: "slow_burn",
    excludes: ["party_high_energy", "upbeat", "social_high_energy"],
    profileSeed: { energy: 0.30, valence: 0.28, tension: 0.52, nostalgia: 0.68, calm: 0.30 },
    blueprint: {
      environment: { motion: "driving", timeOfDay: "evening" },
      emotionalArc: { start: "sad", end: "reflective" },
      genreAffinity: { indie: 0.80, folk: 0.75, rnb: 0.65, country: 0.60, soul: 0.55 },
      instrumentationBias: { acoustic: 0.70, storytelling: 0.75, warmth: 0.55, synth: 0.20 },
      memoryType: ["heartbreak", "reflection"],
      season: "neutral",
    },
  },
};

export function getPrototype(id: string | undefined): ScenePrototype | null {
  if (!id) return null;
  return SCENE_PROTOTYPES[id] ?? null;
}

export function profileFromPrototype(proto: ScenePrototype): EmotionProfile {
  const s = proto.profileSeed ?? {};
  return {
    energy: s.energy ?? 0.45,
    valence: s.valence ?? 0.5,
    tension: s.tension ?? 0.3,
    nostalgia: s.nostalgia ?? 0.25,
    calm: s.calm ?? 0.45,
    environment: proto.environment ?? null,
    timeOfDay: proto.timeBias ?? null,
    motionState: proto.motion ?? null,
  };
}
