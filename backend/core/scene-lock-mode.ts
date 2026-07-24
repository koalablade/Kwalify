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
    allowedGenreFamilies: ["rock", "metal", "indie"],
    offSceneGenreFamilies: ["hip_hop", "electronic", "pop", "rnb"],
  },
  {
    anchors: [/\btony\s+hawk\b/i],
    id: "tony_hawk",
    allowedGenreFamilies: ["rock", "indie", "metal"],
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
    anchors: [
      /\brainy\s+night\s+driv/i,
      /\brain(?:y|ing)?\b.*\bnight\s+driv/i,
      /\brain(?:y|ing)?\b.*\b(?:highway|motorway|driv)/i,
      /\b(?:highway|motorway)\b.*\brain/i,
    ],
    id: "rainy_drive_world",
    allowedGenreFamilies: ["indie", "electronic", "rock", "rnb"],
    offSceneGenreFamilies: ["metal", "country", "folk", "hip_hop", "latin"],
  },
  {
    anchors: [
      /\b(?:cozy|chill|calm|soft)\b.*\brain(?:y|ing)?\b/i,
      /\brain(?:y|ing)?\b.*\b(?:cozy|chill|calm)\b/i,
      /\bcozy\s+rainy\b/i,
    ],
    id: "chill_rainy_world",
    allowedGenreFamilies: ["indie", "folk", "electronic", "soul"],
    offSceneGenreFamilies: ["metal", "hip_hop", "country", "latin", "reggae"],
  },
  {
    anchors: [
      /\b(?:70s?|seventies)\s+disco\b/i,
      /\bdisco\s+(?:party|dancefloor|night)\b/i,
      /\bdisco\b.*\b(?:party|dance)\b/i,
    ],
    id: "disco_party_world",
    allowedGenreFamilies: ["soul", "rnb", "pop", "electronic"],
    offSceneGenreFamilies: ["metal", "rock", "hip_hop", "country", "folk", "reggae"],
  },
  {
    anchors: [
      /\b(?:deep\s+)?focus\b/i,
      /\bno\s+distractions?\b/i,
      /\bstudy\s+session\b/i,
      /\bcoding\s+focus\b/i,
      /\bconcentration\b/i,
      /\bexam\s+revision\b/i,
    ],
    id: "focus_study_world",
    allowedGenreFamilies: ["electronic", "classical", "jazz", "indie", "soundtrack"],
    offSceneGenreFamilies: ["hip_hop", "metal", "rock", "pop", "reggae", "country", "latin", "rnb"],
  },
  // ── Genre / scene world locks (Human Curator Reality Audit ROI) ────────────
  {
    anchors: [
      /\bgoth\b/i,
      /\bgothic\b/i,
      /\bdarkwave\b/i,
      /\bpost[-\s]?punk\b/i,
      /\bindustrial\s+goth\b/i,
    ],
    id: "goth_world",
    allowedGenreFamilies: ["rock", "indie", "electronic", "metal"],
    offSceneGenreFamilies: ["reggae", "hip_hop", "country", "latin", "pop", "rnb", "soul", "blues"],
  },
  {
    anchors: [/\bgrunge\b/i, /\bseattle\s+(?:sound|grunge)\b/i],
    id: "grunge_world",
    allowedGenreFamilies: ["rock", "metal", "indie"],
    offSceneGenreFamilies: ["pop", "reggae", "hip_hop", "country", "electronic", "latin", "rnb", "soul"],
  },
  {
    anchors: [/\bpop[-\s]?punk\b/i, /\b2000s?\s+(?:pop\s*)?punk\b/i, /\bemo\s+pop\b/i],
    id: "pop_punk_world",
    allowedGenreFamilies: ["rock", "indie", "pop"],
    offSceneGenreFamilies: ["electronic", "hip_hop", "country", "latin", "reggae", "jazz", "classical", "soul"],
  },
  {
    anchors: [
      /\b(?:sleepy|tired|low[-\s]?energy)\s+(?:gym|workout)\b/i,
      /\b(?:gym|workout)\s+(?:sleepy|tired|chill)\b/i,
    ],
    id: "sleepy_gym_world",
    allowedGenreFamilies: ["indie", "electronic", "pop", "rnb"],
    offSceneGenreFamilies: ["metal", "country", "latin", "reggae", "classical"],
  },
  {
    anchors: [
      /\bangry\s+rock\b/i,
      /\bangry\b.*\b(?:rock|workout|gym)\b/i,
      /\b(?:rock|gym|workout)\b.*\bangry\b/i,
      /\baggressive\b.*\b(?:gym|workout|pump|lifting)\b/i,
      /\b(?:gym|workout|pump|lifting)\b.*\baggressive\b/i,
    ],
    id: "angry_rock_world",
    allowedGenreFamilies: ["rock", "metal", "indie"],
    offSceneGenreFamilies: ["pop", "electronic", "hip_hop", "country", "latin", "reggae", "rnb", "soul", "jazz"],
  },
  {
    anchors: [
      /\bgym\s+rock\b/i,
      /\b(?:gym|workout)\b.*\brock\b/i,
      /\brock\b.*\b(?:gym|workout)\b/i,
      /\bheavy\s+lifting\b/i,
      /\bgym\s+pump\b/i,
    ],
    id: "gym_rock_world",
    allowedGenreFamilies: ["rock", "metal", "indie"],
    offSceneGenreFamilies: ["electronic", "hip_hop", "country", "latin", "reggae", "rnb", "soul", "jazz", "classical"],
  },
  {
    anchors: [
      /\b(?:70s?|seventies)\s+rock\b/i,
      /\bclassic\s+rock\b/i,
    ],
    id: "classic_rock_world",
    allowedGenreFamilies: ["rock", "blues", "metal"],
    offSceneGenreFamilies: ["pop", "hip_hop", "electronic", "country", "latin", "reggae", "rnb"],
  },
  {
    anchors: [
      /\blo-?fi\b/i,
      /\blofi\b/i,
      /\bchillhop\b/i,
      /\bstudy\s+beats?\b/i,
      /\blo-?fi\s+but\b/i,
    ],
    id: "lofi_world",
    allowedGenreFamilies: ["indie", "electronic", "jazz", "hip_hop", "soul"],
    offSceneGenreFamilies: ["metal", "rock", "country", "reggae", "latin", "pop"],
  },
  {
    anchors: [
      /\bambient\b/i,
      /\bsoundscape\b/i,
      /\binstrumental\s+focus\b/i,
      /\bno\s+vocals?\b/i,
    ],
    id: "ambient_world",
    allowedGenreFamilies: ["electronic", "classical", "jazz", "soundtrack", "indie"],
    offSceneGenreFamilies: ["hip_hop", "metal", "rock", "pop", "reggae", "country", "latin", "rnb"],
  },
  {
    anchors: [/\bbritpop\b/i, /\bmadchester\b/i, /\bsunny\s+afternoon\b.*\b(?:indie|rock)\b/i],
    id: "britpop_world",
    allowedGenreFamilies: ["indie", "rock"],
    offSceneGenreFamilies: ["metal", "hip_hop", "country", "latin", "electronic", "soul", "rnb"],
  },
  {
    anchors: [
      /\bquiet\s+rage\b/i,
      /\bsimmer(?:ing)?\s+(?:rage|anger|fury)\b/i,
      /\brepressed\s+(?:rage|anger)\b/i,
    ],
    id: "quiet_rage",
    allowedGenreFamilies: ["rock", "indie", "metal", "electronic"],
    offSceneGenreFamilies: ["pop", "reggae", "country", "latin", "soul"],
  },
  {
    anchors: [
      /\b(?:rave|club)\s+comedown\b/i,
      /\bcomedown\b.*\b(?:rave|club|party|festival)\b/i,
      /\bpost[-\s]?rave\b/i,
      /\bafter\s+(?:the\s+|a\s+)?(?:rave|club night|warehouse)\b/i,
    ],
    id: "rave_comedown",
    allowedGenreFamilies: ["electronic", "indie", "soul", "jazz"],
    offSceneGenreFamilies: ["metal", "country", "latin", "reggae", "pop", "hip_hop"],
  },
  {
    anchors: [
      /\bneon\s+(?:drive|city|streets?|nights?|tek|techno|synth)\b/i,
      /\b90s?\s+neon\b/i,
      /\bsynthwave\b/i,
      /\bretrowave\b/i,
      /\bcyberpunk\b/i,
      /\btekk?\b/i,
      /\btekno\b/i,
      /\bhard\s+techno\b/i,
    ],
    id: "neon_tek_drive",
    allowedGenreFamilies: ["electronic", "indie", "rock"],
    offSceneGenreFamilies: ["country", "folk", "reggae", "classical", "blues", "latin", "hip_hop", "rnb"],
  },
  {
    anchors: [
      /\bsad\s+night\s+driv/i,
      /\bmelanchol\w*\s+(?:night\s+)?driv/i,
      /\bdriv\w*\s+.*\bsad\b/i,
      /\bsad\b.*\bdriv/i,
    ],
    id: "melancholy_drive",
    allowedGenreFamilies: ["indie", "electronic", "rock", "rnb", "soul"],
    offSceneGenreFamilies: ["metal", "country", "reggae", "latin"],
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

  const matchedRaw = CULTURAL_PROFILES.filter((profile) => {
    if (profile.id === "garage_workshop" && !physicalGaragePrompt(prompt)) return false;
    return profile.anchors.some((pattern) => pattern.test(prompt));
  });
  if (matchedRaw.length === 0) return inactive;

  // Conflicting workout worlds: keep the most specific lock only.
  const matchedIds = new Set(matchedRaw.map((p) => p.id));
  const matched = matchedRaw.filter((profile) => {
    if (profile.id === "gym_rock_world" && (matchedIds.has("angry_rock_world") || matchedIds.has("sleepy_gym_world"))) {
      return false;
    }
    if (profile.id === "angry_rock_world" && matchedIds.has("sleepy_gym_world")) {
      return false;
    }
    if (profile.id === "focus_study_world" && (matchedIds.has("ambient_world") || matchedIds.has("lofi_world"))) {
      return false;
    }
    if (profile.id === "chill_rainy_world" && matchedIds.has("rainy_drive_world")) {
      return false;
    }
    return true;
  });

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
