/**
 * Lightweight sonic taste profile — audio-feature traits, not genre labels.
 * Used for retrieval ranking and opener tie-breaks only (not scoring weights).
 */

import type { EmotionProfile } from "./emotion";
import type { ActivityProfile } from "./activity-profiles";

export type SonicProductionMood = "warm" | "atmospheric" | "raw" | "polished" | "balanced";
export type SonicEmotionalTone = "nostalgic" | "melancholic" | "uplifting" | "neutral";

export type SonicTasteProfile = {
  vocalPreference: number;
  acousticElectronicBalance: number;
  energyPreference: number;
  valencePreference: number;
  productionMood: SonicProductionMood;
  emotionalTone: SonicEmotionalTone;
  instrumentation: string[];
};

export type PromptSonicTarget = {
  energyMin: number;
  energyMax: number;
  valenceMin: number;
  valenceMax: number;
  maxSpeechiness: number;
  minInstrumentalness: number | null;
  acousticElectronicBalance: number;
  vocalPreference: number;
  productionMood: SonicProductionMood;
  emotionalTone: SonicEmotionalTone;
  avoidHighDrive: boolean;
  sceneTags: string[];
};

export type SonicTrackFeatures = {
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0.5;
}

function classifyProduction(acoustic: number, dance: number, energy: number): SonicProductionMood {
  if (acoustic >= 0.55 && energy <= 0.55) return "warm";
  if (acoustic <= 0.3 && dance >= 0.55) return "polished";
  if (energy >= 0.72 && acoustic <= 0.35) return "raw";
  if (acoustic <= 0.35 && energy <= 0.5) return "atmospheric";
  return "balanced";
}

function classifyEmotionalTone(valence: number, energy: number): SonicEmotionalTone {
  if (valence >= 0.58 && energy >= 0.45) return "uplifting";
  if (valence <= 0.42) return "melancholic";
  if (valence >= 0.48 && energy <= 0.48) return "nostalgic";
  return "neutral";
}

function inferInstrumentation(tracks: SonicTrackFeatures[]): string[] {
  const tags = new Set<string>();
  const acoustic = mean(tracks.map((t) => t.acousticness ?? 0.5));
  const dance = mean(tracks.map((t) => t.danceability ?? 0.5));
  const instrumental = mean(tracks.map((t) => t.instrumentalness ?? 0.2));
  const speech = mean(tracks.map((t) => t.speechiness ?? 0.1));
  if (acoustic >= 0.5) tags.add("guitars");
  if (acoustic >= 0.45 && dance <= 0.5) tags.add("piano");
  if (dance >= 0.6 && acoustic <= 0.4) tags.add("synth");
  if (instrumental >= 0.45) tags.add("instrumental");
  if (speech >= 0.08) tags.add("expressive_vocals");
  return [...tags];
}

export function buildSonicTasteProfile(tracks: SonicTrackFeatures[]): SonicTasteProfile | null {
  if (tracks.length < 8) return null;
  const sample = tracks.slice(0, Math.min(tracks.length, 400));
  const energies = sample.map((t) => t.energy ?? 0.5);
  const valences = sample.map((t) => t.valence ?? 0.5);
  const acoustics = sample.map((t) => t.acousticness ?? 0.5);
  const dances = sample.map((t) => t.danceability ?? 0.5);
  const instrumentals = sample.map((t) => t.instrumentalness ?? 0.2);
  const speeches = sample.map((t) => t.speechiness ?? 0.1);

  const energyPreference = mean(energies);
  const valencePreference = mean(valences);
  const acousticMean = mean(acoustics);
  const danceMean = mean(dances);
  const acousticElectronicBalance = clamp01((danceMean - acousticMean + 1) / 2) * 2 - 1;
  const vocalPreference = clamp01(mean(speeches) * 4 + (1 - mean(instrumentals)) * 0.35);

  return {
    vocalPreference,
    acousticElectronicBalance,
    energyPreference,
    valencePreference,
    productionMood: classifyProduction(acousticMean, danceMean, energyPreference),
    emotionalTone: classifyEmotionalTone(valencePreference, energyPreference),
    instrumentation: inferInstrumentation(sample),
  };
}

export function buildPromptSonicTarget(
  vibe: string,
  emotionProfile: EmotionProfile,
  activityProfile: ActivityProfile | null,
): PromptSonicTarget {
  const lower = vibe.toLowerCase();
  const sceneTags: string[] = [];
  if (/\b(?:garden|outdoor|sunlight|afternoon|picnic)\b/i.test(vibe)) sceneTags.push("outdoor", "warm", "relaxed");
  if (/\b(?:end of summer|late summer|summer ending)\b/i.test(vibe)) sceneTags.push("bittersweet", "nostalgic", "warm");
  if (/\b(?:late night|midnight|night)\b/i.test(vibe)) sceneTags.push("nocturnal", "atmospheric");
  if (/\b(?:drive|road|motorway)\b/i.test(vibe)) sceneTags.push("forward_motion");

  let target: PromptSonicTarget = {
    energyMin: Math.max(0.15, emotionProfile.energy - 0.18),
    energyMax: Math.min(0.95, emotionProfile.energy + 0.22),
    valenceMin: Math.max(0.1, emotionProfile.valence - 0.25),
    valenceMax: Math.min(0.95, emotionProfile.valence + 0.25),
    maxSpeechiness: 0.35,
    minInstrumentalness: null,
    acousticElectronicBalance: 0,
    vocalPreference: 0.55,
    productionMood: "balanced",
    emotionalTone: emotionProfile.valence >= 0.55 ? "uplifting" : emotionProfile.valence <= 0.4 ? "melancholic" : "neutral",
    avoidHighDrive: false,
    sceneTags,
  };

  if (activityProfile?.id === "gym") {
    target = {
      ...target,
      energyMin: 0.62,
      energyMax: 0.95,
      maxSpeechiness: 0.45,
      acousticElectronicBalance: 0.35,
      vocalPreference: 0.65,
      productionMood: "raw",
      emotionalTone: "uplifting",
      avoidHighDrive: false,
    };
  } else if (activityProfile?.id === "focus_coding" || activityProfile?.id === "study") {
    target = {
      ...target,
      energyMin: 0.15,
      energyMax: 0.48,
      maxSpeechiness: 0.12,
      minInstrumentalness: 0.35,
      acousticElectronicBalance: 0.15,
      vocalPreference: 0.25,
      productionMood: "atmospheric",
      emotionalTone: "neutral",
      avoidHighDrive: true,
    };
  } else if (activityProfile?.id === "party_pregame") {
    target = {
      ...target,
      energyMin: 0.58,
      energyMax: 0.92,
      maxSpeechiness: 0.4,
      acousticElectronicBalance: 0.45,
      vocalPreference: 0.7,
      productionMood: "polished",
      emotionalTone: "uplifting",
    };
  } else if (/\b(?:garden|afternoon in the garden|summer afternoon)\b/i.test(vibe)) {
    target = {
      ...target,
      energyMin: 0.28,
      energyMax: 0.58,
      valenceMin: 0.45,
      valenceMax: 0.78,
      maxSpeechiness: 0.28,
      acousticElectronicBalance: -0.15,
      vocalPreference: 0.5,
      productionMood: "warm",
      emotionalTone: "nostalgic",
      avoidHighDrive: true,
      sceneTags: [...sceneTags, "garden", "sunlight"],
    };
  } else if (/\b(?:end of summer|summer ending)\b/i.test(vibe)) {
    target = {
      ...target,
      energyMin: 0.32,
      energyMax: 0.62,
      valenceMin: 0.38,
      valenceMax: 0.68,
      acousticElectronicBalance: -0.05,
      productionMood: "warm",
      emotionalTone: "nostalgic",
      avoidHighDrive: true,
    };
  } else if (/\b(?:late night|midnight).*(?:drive|driving)\b/i.test(vibe) || lower.includes("late night relaxing drive")) {
    target = {
      ...target,
      energyMin: 0.35,
      energyMax: 0.62,
      valenceMin: 0.3,
      valenceMax: 0.65,
      acousticElectronicBalance: 0.05,
      productionMood: "atmospheric",
      emotionalTone: "nostalgic",
    };
  }

  return target;
}

export function scoreTrackSonicPromptFit(
  track: SonicTrackFeatures,
  target: PromptSonicTarget,
  userProfile: SonicTasteProfile | null,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const speech = track.speechiness ?? 0.1;
  const instrumental = track.instrumentalness ?? 0.2;
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  const trackBalance = clamp01((dance - acoustic + 1) / 2) * 2 - 1;

  let score = 0.55;

  if (energy >= target.energyMin && energy <= target.energyMax) score += 0.22;
  else score -= Math.min(0.35, Math.abs(energy - (target.energyMin + target.energyMax) / 2) * 0.8);

  if (valence >= target.valenceMin && valence <= target.valenceMax) score += 0.12;
  if (speech <= target.maxSpeechiness) score += 0.08;
  else score -= 0.18;

  if (target.minInstrumentalness != null) {
    score += instrumental >= target.minInstrumentalness ? 0.1 : -0.15;
  }

  if (target.avoidHighDrive && energy >= 0.68) score -= 0.22;

  score += (1 - Math.abs(trackBalance - target.acousticElectronicBalance) / 2) * 0.08;

  if (userProfile) {
    score += (1 - Math.abs(energy - userProfile.energyPreference)) * 0.06;
    score += (1 - Math.abs(valence - userProfile.valencePreference)) * 0.04;
  }

  return clamp01(score);
}

export function scoreUserSonicAffinity(
  track: SonicTrackFeatures,
  userProfile: SonicTasteProfile,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  const speech = track.speechiness ?? 0.1;
  const trackBalance = clamp01((dance - acoustic + 1) / 2) * 2 - 1;

  const energyFit = 1 - Math.abs(energy - userProfile.energyPreference);
  const valenceFit = 1 - Math.abs(valence - userProfile.valencePreference);
  const balanceFit = 1 - Math.abs(trackBalance - userProfile.acousticElectronicBalance) / 2;
  const vocalFit = 1 - Math.abs(speech * 4 - userProfile.vocalPreference);

  return clamp01(energyFit * 0.35 + valenceFit * 0.25 + balanceFit * 0.2 + vocalFit * 0.2);
}
