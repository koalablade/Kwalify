import type { EmotionProfile } from "./emotion";

export type CuratorIdentityType =
  | "gym_beast"
  | "focus_minimalist"
  | "party_social"
  | "drive_nostalgic"
  | "chill_warm"
  | "balanced_curator";

export type CuratorIdentity = {
  type: CuratorIdentityType;
  summary: string;
  energyBias: number;
  familiarityBias: number;
  repetitionTolerance: number;
  repetitionPenalty: number;
  eraDrift: number;
  chaosAllowance: number;
  forbiddenPatterns: string[];
};

export type IdentityIntentLike = {
  activity?: string | null;
  mood?: string[];
  energy?: "low" | "medium" | "high" | null;
  energyLevel?: "low" | "medium" | "high" | null;
  eraRange?: { start: number; end: number } | null;
};

export type IdentityTrackLike = {
  trackId: string;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
  popularity?: number | null;
  score?: number;
};

export type IdentitySessionMemory = {
  usedArtists: Set<string>;
  usedTracks: Set<string>;
  artistFrequencyMap: Record<string, number>;
};

const IDENTITIES: Record<CuratorIdentityType, CuratorIdentity> = {
  gym_beast: {
    type: "gym_beast",
    summary: "High-energy workout curator: physical, direct, and intolerant of sleepy acoustic dips.",
    energyBias: 0.85,
    familiarityBias: 0.25,
    repetitionTolerance: 0.18,
    repetitionPenalty: 0.18,
    eraDrift: 0.35,
    chaosAllowance: 0.06,
    forbiddenPatterns: ["slow-acoustic-in-gym", "low-energy-workout", "sleepy-tempo-drop"],
  },
  focus_minimalist: {
    type: "focus_minimalist",
    summary: "Low-distraction curator: stable energy, low chaos, and smooth emotional continuity.",
    energyBias: -0.45,
    familiarityBias: -0.05,
    repetitionTolerance: 0.12,
    repetitionPenalty: 0.16,
    eraDrift: 0.60,
    chaosAllowance: 0.04,
    forbiddenPatterns: ["speechy-focus", "sharp-energy-jump", "chaotic-genre-switch"],
  },
  party_social: {
    type: "party_social",
    summary: "Social curator: familiar, rhythmic, upbeat, and allergic to mood-killing slow turns.",
    energyBias: 0.62,
    familiarityBias: 0.55,
    repetitionTolerance: 0.22,
    repetitionPenalty: 0.15,
    eraDrift: 0.55,
    chaosAllowance: 0.08,
    forbiddenPatterns: ["sad-party-dip", "slow-acoustic-party", "low-danceability-party"],
  },
  drive_nostalgic: {
    type: "drive_nostalgic",
    summary: "Flow-first driving curator: nostalgic enough to feel cinematic, steady enough to keep moving.",
    energyBias: 0.24,
    familiarityBias: 0.32,
    repetitionTolerance: 0.18,
    repetitionPenalty: 0.14,
    eraDrift: 0.35,
    chaosAllowance: 0.10,
    forbiddenPatterns: ["jarring-drive-switch", "dead-stop-energy-drop"],
  },
  chill_warm: {
    type: "chill_warm",
    summary: "Warm chill curator: relaxed, emotionally stable, and resistant to harsh tonal changes.",
    energyBias: -0.35,
    familiarityBias: 0.05,
    repetitionTolerance: 0.16,
    repetitionPenalty: 0.14,
    eraDrift: 0.70,
    chaosAllowance: 0.08,
    forbiddenPatterns: ["harsh-chill-spike", "cold-emotional-switch"],
  },
  balanced_curator: {
    type: "balanced_curator",
    summary: "General curator: prefers one clear playlist identity and avoids overused fallback favourites.",
    energyBias: 0.05,
    familiarityBias: 0.0,
    repetitionTolerance: 0.16,
    repetitionPenalty: 0.16,
    eraDrift: 0.62,
    chaosAllowance: 0.10,
    forbiddenPatterns: ["fallback-recycling", "identity-whiplash"],
  },
};

function cloneIdentity(type: CuratorIdentityType): CuratorIdentity {
  return { ...IDENTITIES[type], forbiddenPatterns: [...IDENTITIES[type].forbiddenPatterns] };
}

export function buildCuratorIdentity(input: {
  prompt: string;
  intent: IdentityIntentLike;
  emotionProfile: EmotionProfile;
}): CuratorIdentity {
  const lower = input.prompt.toLowerCase();
  const activity = input.intent.activity;
  let type: CuratorIdentityType =
    activity === "gym" || /\b(?:gym|workout|lifting|pump|cardio|run|running)\b/.test(lower)
      ? "gym_beast"
      : activity === "focus" || /\b(?:focus|study|deep work|homework|coding|no distractions?)\b/.test(lower)
        ? "focus_minimalist"
        : activity === "party" || /\b(?:party|house party|club|drinks?|mates?|friends?|gathering)\b/.test(lower)
          ? "party_social"
          : activity === "driving" || /\b(?:drive|driving|road|backroads?|motorway|car)\b/.test(lower)
            ? "drive_nostalgic"
            : /\b(?:chill|relax|evening|cozy|cosy|calm|unwind)\b/.test(lower)
              ? "chill_warm"
              : "balanced_curator";

  if (/\b(?:night|late|neon|2am|3am)\b/.test(lower) && type === "balanced_curator") {
    type = "drive_nostalgic";
  }

  const identity = cloneIdentity(type);
  if (input.intent.energy === "high" || input.intent.energyLevel === "high") {
    identity.energyBias = Math.max(identity.energyBias, 0.35);
  }
  if (input.intent.energy === "low" || input.intent.energyLevel === "low") {
    identity.energyBias = Math.min(identity.energyBias, -0.25);
  }
  if (input.intent.eraRange) {
    identity.eraDrift = Math.min(identity.eraDrift, 0.38);
  }
  if ((input.emotionProfile.nostalgia ?? 0) > 0.62) {
    identity.familiarityBias = Math.max(identity.familiarityBias, 0.22);
    identity.eraDrift = Math.min(identity.eraDrift, 0.48);
  }
  if (input.intent.mood?.includes("melancholic") && (identity.type === "gym_beast" || identity.type === "party_social")) {
    identity.forbiddenPatterns.push("melancholy-conflicts-with-social-energy");
  }
  return identity;
}

function knownNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function energyMatchForIdentity(track: IdentityTrackLike, identity: CuratorIdentity): number {
  const energy = knownNumber(track.energy, 0.5);
  if (identity.energyBias > 0) return energy;
  if (identity.energyBias < 0) return 1 - energy;
  return 1 - Math.abs(energy - 0.55);
}

export function familiarityForIdentity(track: IdentityTrackLike): number {
  const popularity = knownNumber(track.popularity, 50) / 100;
  return Math.max(0, Math.min(1, popularity));
}

export function scoreTrackForIdentity(track: IdentityTrackLike, identity: CuratorIdentity): number {
  const energyMatch = energyMatchForIdentity(track, identity);
  const familiarity = familiarityForIdentity(track);
  const energyShift = identity.energyBias * energyMatch * 0.18;
  const familiarityShift = identity.familiarityBias * (familiarity - 0.5) * 0.14;
  return Math.max(0, Math.min(1, 0.5 + energyShift + familiarityShift));
}

export function buildIdentityDebugView(identity: CuratorIdentity): {
  summary: string;
  biases: {
    energyBias: number;
    familiarityBias: number;
    repetitionTolerance: number;
    eraDrift: number;
    chaosAllowance: number;
  };
  forbiddenPatterns: string[];
} {
  return {
    summary: identity.summary,
    biases: {
      energyBias: identity.energyBias,
      familiarityBias: identity.familiarityBias,
      repetitionTolerance: identity.repetitionTolerance,
      eraDrift: identity.eraDrift,
      chaosAllowance: identity.chaosAllowance,
    },
    forbiddenPatterns: identity.forbiddenPatterns,
  };
}

