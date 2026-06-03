/**
 * Scene → sonic profile bridge (AI DJ layer, not just emotion weights).
 */

import type { EmotionProfile } from "./emotion";

export interface SonicProfile {
  tempoBias: number;
  energyTarget: number;
  valenceTarget: number;
  acousticBias: number;
  instrumentalBias: number;
  danceabilityCap: number;
  speechinessCap: number;
  /** Short descriptors for API/debug */
  traits: string[];
}

export const SONIC_BY_CANONICAL: Record<string, SonicProfile> = {
  petrol_2am_liminal: {
    tempoBias: 0.35,
    energyTarget: 0.22,
    valenceTarget: 0.32,
    acousticBias: 0.45,
    instrumentalBias: 0.35,
    danceabilityCap: 0.55,
    speechinessCap: 0.4,
    traits: ["low tempo", "reverb-friendly", "sparse", "warm soft bass"],
  },
  airport_sunrise_transition: {
    tempoBias: 0.55,
    energyTarget: 0.42,
    valenceTarget: 0.55,
    acousticBias: 0.35,
    instrumentalBias: 0.25,
    danceabilityCap: 0.65,
    speechinessCap: 0.45,
    traits: ["rising dynamics", "major lean", "gradual layering", "ambient texture"],
  },
  rainy_train_home_decompress: {
    tempoBias: 0.4,
    energyTarget: 0.18,
    valenceTarget: 0.42,
    acousticBias: 0.55,
    instrumentalBias: 0.4,
    danceabilityCap: 0.5,
    speechinessCap: 0.35,
    traits: ["downtempo", "piano-lofi", "muffled highs", "soft percussion"],
  },
  night_drive_alone_reflection: {
    tempoBias: 0.48,
    energyTarget: 0.28,
    valenceTarget: 0.4,
    acousticBias: 0.4,
    instrumentalBias: 0.3,
    danceabilityCap: 0.6,
    speechinessCap: 0.42,
    traits: ["mid-slow tempo", "cinematic", "steady pulse"],
  },
  late_summer_friends_drive: {
    tempoBias: 0.58,
    energyTarget: 0.45,
    valenceTarget: 0.58,
    acousticBias: 0.35,
    instrumentalBias: 0.2,
    danceabilityCap: 0.72,
    speechinessCap: 0.5,
    traits: ["warm mids", "open road", "nostalgic brightness"],
  },
  rain_windscreen_night_drive: {
    tempoBias: 0.42,
    energyTarget: 0.25,
    valenceTarget: 0.38,
    acousticBias: 0.42,
    instrumentalBias: 0.35,
    danceabilityCap: 0.55,
    speechinessCap: 0.38,
    traits: ["rain texture", "intimate mix", "low-end warmth"],
  },
  petrol_10am_routine: {
    tempoBias: 0.52,
    energyTarget: 0.48,
    valenceTarget: 0.52,
    acousticBias: 0.3,
    instrumentalBias: 0.15,
    danceabilityCap: 0.72,
    speechinessCap: 0.5,
    traits: ["mid tempo", "practical", "daytime brightness"],
  },
  library_archaeology: {
    tempoBias: 0.5,
    energyTarget: 0.38,
    valenceTarget: 0.5,
    acousticBias: 0.4,
    instrumentalBias: 0.25,
    danceabilityCap: 0.7,
    speechinessCap: 0.55,
    traits: ["memory-forward", "varied era", "familiar surprise"],
  },
};

export function getSonicProfile(canonicalSceneId: string | null): SonicProfile | null {
  if (!canonicalSceneId) return null;
  return SONIC_BY_CANONICAL[canonicalSceneId] ?? null;
}

export function applySonicProfileToEmotion(
  profile: EmotionProfile,
  sonic: SonicProfile | null,
  blend = 0.45
): EmotionProfile {
  if (!sonic) return profile;
  const w = blend;
  const lerp = (a: number, b: number) => a + (b - a) * w;
  return {
    ...profile,
    energy: Math.max(0, Math.min(1, lerp(profile.energy, sonic.energyTarget))),
    valence: Math.max(0, Math.min(1, lerp(profile.valence, sonic.valenceTarget))),
  };
}

export function sonicFitBonus(
  song: {
    energy: number | null;
    valence: number | null;
    tempo: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    danceability: number | null;
    speechiness: number | null;
  },
  sonic: SonicProfile | null
): number {
  if (!sonic) return 0;
  const e = song.energy ?? 0.5;
  const v = song.valence ?? 0.5;
  const normTempo = song.tempo != null ? Math.max(0, Math.min(1, (song.tempo - 60) / 140)) : 0.5;
  const a = song.acousticness ?? 0.5;
  const inst = song.instrumentalness ?? 0;
  const d = song.danceability ?? 0.5;
  const sp = song.speechiness ?? 0.3;

  let bonus = 0;
  bonus += Math.max(0, 0.12 - Math.abs(e - sonic.energyTarget) * 0.2);
  bonus += Math.max(0, 0.1 - Math.abs(v - sonic.valenceTarget) * 0.18);
  bonus += Math.max(0, 0.08 - Math.abs(normTempo - sonic.tempoBias) * 0.15);
  bonus += Math.max(0, 0.06 - Math.abs(a - sonic.acousticBias) * 0.12);
  if (inst >= sonic.instrumentalBias * 0.5) bonus += 0.04;
  if (d <= sonic.danceabilityCap) bonus += 0.03;
  if (sp <= sonic.speechinessCap) bonus += 0.02;
  return Math.min(0.22, bonus);
}
