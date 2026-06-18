/**
 * Scene Lock Mode — soft cultural-scene constraint for strong prompts (Kerrang, Volvo garage, etc.)
 */

import type { IntentState } from "./intent-state-engine";
import { detectUkHipHopScene, ukHipHopSceneLockProfile } from "../lib/uk-hip-hop-scene";

export type SceneLockStatus = {
  active: boolean;
  anchors: string[];
  allowedGenreFamilies: string[];
  offSceneGenreFamilies: string[];
  boostWeight: number;
  penalizeWeight: number;
  reason: string | null;
};

type CulturalSceneProfile = {
  anchors: RegExp[];
  id: string;
  allowedGenreFamilies: string[];
  offSceneGenreFamilies: string[];
};

const CULTURAL_PROFILES: CulturalSceneProfile[] = [
  {
    anchors: [/\bkerrang\b/i],
    id: "kerrang",
    allowedGenreFamilies: ["rock", "metal", "indie", "punk"],
    offSceneGenreFamilies: ["hip_hop", "electronic", "pop", "rnb"],
  },
  {
    anchors: [/\btony\s+hawk\b/i],
    id: "tony_hawk",
    allowedGenreFamilies: ["rock", "punk", "indie", "metal"],
    offSceneGenreFamilies: ["hip_hop", "electronic", "classical", "jazz"],
  },
  {
    anchors: [/\bneed\s+for\s+speed\b|\bnfs\b/i],
    id: "need_for_speed",
    allowedGenreFamilies: ["rock", "electronic", "hip_hop", "metal"],
    offSceneGenreFamilies: ["folk", "jazz", "classical", "country"],
  },
  {
    anchors: [/\bforza\s+horizon\b|\bforza\b/i],
    id: "forza",
    allowedGenreFamilies: ["electronic", "rock", "hip_hop", "pop"],
    offSceneGenreFamilies: ["folk", "jazz", "classical", "blues"],
  },
  {
    anchors: [/\b(?:fix(?:ing)?|repair(?:ing)?|working\s+on)\s+(?:a\s+|my\s+)?(?:car|cars|volvo|saab|bmw|mx-?5)\b/i, /\bproject\s+car\b/i],
    id: "garage_repair",
    allowedGenreFamilies: ["blues", "indie", "rock", "folk", "country"],
    offSceneGenreFamilies: ["electronic", "hip_hop", "pop", "metal"],
  },
  {
    anchors: [/\b(?:garage|workshop)\b/i],
    id: "garage_workshop",
    allowedGenreFamilies: ["blues", "indie", "rock", "folk"],
    offSceneGenreFamilies: ["electronic", "hip_hop", "pop"],
  },
  {
    anchors: [/\brainy\s+night\s+driv/i, /\bnight\s+driv/i],
    id: "rainy_night_drive",
    allowedGenreFamilies: ["indie", "electronic", "rock", "rnb"],
    offSceneGenreFamilies: ["metal", "country", "folk"],
  },
];

function ukGarageOrGrimePrompt(prompt: string): boolean {
  return /\b(?:ukg|uk\s+garage)\b/i.test(prompt) || /\bgrime\b/i.test(prompt) || /\buk\s+rap\b/i.test(prompt);
}

function physicalGaragePrompt(prompt: string): boolean {
  if (ukGarageOrGrimePrompt(prompt)) return false;
  return /\b(?:garage|workshop)\b/i.test(prompt);
}

export function resolveSceneLock(intentState: IntentState, prompt: string): SceneLockStatus {
  const inactive: SceneLockStatus = {
    active: false,
    anchors: [],
    allowedGenreFamilies: [],
    offSceneGenreFamilies: [],
    boostWeight: 0,
    penalizeWeight: 0,
    reason: null,
  };

  const ukScene = detectUkHipHopScene(prompt);
  if (ukScene?.active) {
    const profile = ukHipHopSceneLockProfile(ukScene);
    return {
      active: true,
      anchors: [ukScene.id],
      allowedGenreFamilies: profile.allowedGenreFamilies,
      offSceneGenreFamilies: profile.offSceneGenreFamilies,
      boostWeight: 0.22,
      penalizeWeight: 0.48,
      reason: `uk_hip_hop_scene_lock:${ukScene.id}`,
    };
  }

  const matched = CULTURAL_PROFILES.filter((profile) => {
    if (profile.id === "garage_workshop" && !physicalGaragePrompt(prompt)) return false;
    return profile.anchors.some((pattern) => pattern.test(prompt));
  });
  if (matched.length === 0) return inactive;

  const primary = matched[0]!;
  const allowed = [...new Set(matched.flatMap((p) => p.allowedGenreFamilies))];
  const offScene = [...new Set(matched.flatMap((p) => p.offSceneGenreFamilies))];

  return {
    active: true,
    anchors: matched.map((p) => p.id),
    allowedGenreFamilies: allowed,
    offSceneGenreFamilies: offScene.filter((f) => !allowed.includes(f)),
    boostWeight: 0.18,
    penalizeWeight: 0.42,
    reason: `cultural_scene_lock:${primary.id}`,
  };
}

export function sceneLockTrackAdjustment(
  track: { genreFamily?: string | null; genrePrimary?: string | null },
  lock: SceneLockStatus,
): number {
  if (!lock.active) return 0;
  const family = (track.genreFamily ?? track.genrePrimary ?? "").toLowerCase();
  if (!family || family === "unknown") return 0;
  if (lock.allowedGenreFamilies.includes(family)) return lock.boostWeight;
  if (lock.offSceneGenreFamilies.includes(family)) return -lock.penalizeWeight;
  return 0;
}
