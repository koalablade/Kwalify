/**
 * Scene prototypes — structural behaviour templates scenes inherit.
 */

import type { JourneyArc } from "./emotion-destination";
import type { EmotionProfile } from "./emotion";

export interface ScenePrototype {
  id: string;
  motion?: string;
  timeBias?: string;
  environment?: string;
  emotionFlow: [string, string, string];
  energyCurve: string;
  sonicProfileTags: string[];
  transitionsTo: string[];
  journeyArc?: JourneyArc;
  excludes: string[];
  /** Seed profile when canonical match is strong */
  profileSeed?: Partial<EmotionProfile>;
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
    excludes: ["party_high_energy", "daytime_upbeat", "social_high_energy"],
    profileSeed: { energy: 0.28, valence: 0.4, tension: 0.3, nostalgia: 0.55, calm: 0.35 },
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
