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
