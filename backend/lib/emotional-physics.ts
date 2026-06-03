/**
 * Emotional physics — vectors + forces → trajectory (not static mood weights).
 */

import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";

export interface EmotionVector {
  sadness: number;
  nostalgia: number;
  momentum: number;
  warmth: number;
  tension: number;
  hope: number;
}

export interface EmotionalForces {
  attraction: number;
  resistance: number;
  acceleration: number;
  inertia: number;
}

export interface EmotionalTrajectory {
  vector: EmotionVector;
  forces: EmotionalForces;
  emotionTrajectory: string;
  suggestedArc: JourneyArc;
  profileAdjust: { energy: number; valence: number; tension: number };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function profileToEmotionVector(profile: EmotionProfile): EmotionVector {
  return {
    sadness: clamp(Math.max(0, 0.55 - profile.valence)),
    nostalgia: profile.nostalgia,
    momentum: clamp(profile.energy - 0.5),
    warmth: clamp(profile.valence * 0.6 + profile.calm * 0.4),
    tension: profile.tension,
    hope: clamp(Math.max(0, profile.valence - 0.45) * (1 - profile.tension * 0.5)),
  };
}

export function computeEmotionalForces(profile: EmotionProfile, vec: EmotionVector): EmotionalForces {
  return {
    attraction: profile.calm * 0.5 + vec.warmth * 0.35,
    resistance: vec.tension * 0.45 + vec.sadness * 0.35,
    acceleration: profile.energy * 0.5 + Math.max(0, vec.momentum) * 0.4 + vec.hope * 0.2,
    inertia: vec.nostalgia * 0.7,
  };
}

function describeTrajectory(vec: EmotionVector, forces: EmotionalForces): string {
  const start =
    vec.sadness > 0.55 ? "sad" : vec.tension > 0.5 ? "tense" : vec.nostalgia > 0.5 ? "nostalgic" : "present";
  const mid =
    forces.resistance > forces.acceleration ? "reflective" : forces.inertia > 0.5 ? "deepening" : "lifting";
  const end =
    vec.hope > 0.45 ? "hopeful" : vec.warmth > 0.5 ? "warm" : forces.attraction > 0.5 ? "calm" : "steady";
  return `${start} → ${mid} → ${end}`;
}

export function computeTrajectory(
  profile: EmotionProfile,
  journeyArc: JourneyArc
): EmotionalTrajectory {
  const vector = profileToEmotionVector(profile);
  const forces = computeEmotionalForces(profile, vector);
  let suggestedArc = journeyArc;

  if (forces.resistance > 0.55 && forces.acceleration < 0.35) {
    suggestedArc = forces.attraction > 0.5 ? "recovery" : "slow_burn";
  } else if (forces.acceleration > 0.55 && forces.inertia < 0.4) {
    suggestedArc = "linear_rise";
  } else if (forces.inertia > 0.6 && forces.acceleration < 0.4) {
    suggestedArc = "slow_burn";
  }

  const profileAdjust = {
    energy: clamp(profile.energy + (forces.acceleration - forces.resistance) * 0.08),
    valence: clamp(profile.valence + (forces.attraction - forces.resistance) * 0.06),
    tension: clamp(profile.tension + forces.resistance * 0.05 - forces.attraction * 0.04),
  };

  return {
    vector,
    forces,
    emotionTrajectory: describeTrajectory(vector, forces),
    suggestedArc,
    profileAdjust,
  };
}

export function applyPhysicsToProfile(
  profile: EmotionProfile,
  trajectory: EmotionalTrajectory,
  blend = 0.25
): EmotionProfile {
  const w = blend;
  const a = trajectory.profileAdjust;
  return {
    ...profile,
    energy: clamp(profile.energy * (1 - w) + a.energy * w),
    valence: clamp(profile.valence * (1 - w) + a.valence * w),
    tension: clamp(profile.tension * (1 - w) + a.tension * w),
  };
}
