/**
 * Safe contradiction handling — widens emotional pool without flipping genre identity.
 */

import type { EmotionProfile } from "../../lib/emotion";

export interface ContradictionProfile {
  active: boolean;
  label: string | null;
  /** Widen scene/emotion fit windows (0–0.15) */
  poolDiversityBoost: number;
  /** Resolved dominant direction for final scoring */
  dominantDirection: { energy: number; valence: number; calm: number };
  /** Secondary axis for bridge tracks */
  secondaryDirection: { energy: number; valence: number } | null;
}

const CONTRADICTION_PATTERNS: {
  re: RegExp;
  label: string;
  primary: { energy: number; valence: number };
  secondary: { energy: number; valence: number };
}[] = [
  {
    re: /\b(nostalgic|nostalgia)\b.*\b(but|yet|and)\b.*\b(confident|bold|strong)\b/i,
    label: "nostalgic_but_confident",
    primary: { energy: 0.45, valence: 0.42 },
    secondary: { energy: 0.62, valence: 0.68 },
  },
  {
    re: /\b(sad|melanchol|heartbreak|lonely)\b.*\b(but|yet|and)\b.*\b(hopeful|hope|driving|forward)\b/i,
    label: "sad_but_hopeful",
    primary: { energy: 0.35, valence: 0.32 },
    secondary: { energy: 0.55, valence: 0.58 },
  },
  {
    re: /\b(sad|melanchol)\b.*\b(but|yet)\b.*\b(driving|night|road)\b/i,
    label: "sad_but_driving",
    primary: { energy: 0.38, valence: 0.3 },
    secondary: { energy: 0.58, valence: 0.45 },
  },
  {
    re: /\b(lonely|alone)\b.*\b(but|yet)\b.*\b(peaceful|calm|quiet)\b/i,
    label: "lonely_but_peaceful",
    primary: { energy: 0.32, valence: 0.38 },
    secondary: { energy: 0.28, valence: 0.55 },
  },
  {
    re: /\b(angry|tense|anxious)\b.*\b(but|yet)\b.*\b(calm|still|soft)\b/i,
    label: "tense_but_calm",
    primary: { energy: 0.55, valence: 0.35 },
    secondary: { energy: 0.35, valence: 0.52 },
  },
];

export function resolveContradiction(vibe: string, profile: EmotionProfile): ContradictionProfile {
  const lower = vibe.toLowerCase();
  for (const p of CONTRADICTION_PATTERNS) {
    if (p.re.test(lower)) {
      return {
        active: true,
        label: p.label,
        poolDiversityBoost: 0.12,
        dominantDirection: {
          energy: blend(profile.energy, p.primary.energy, 0.62),
          valence: blend(profile.valence, p.primary.valence, 0.62),
          calm: profile.calm,
        },
        secondaryDirection: p.secondary,
      };
    }
  }
  return {
    active: false,
    label: null,
    poolDiversityBoost: 0,
    dominantDirection: {
      energy: profile.energy,
      valence: profile.valence,
      calm: profile.calm,
    },
    secondaryDirection: null,
  };
}

/** Fit score for contradiction bridge candidates (secondary axis) */
export function contradictionBridgeFit(
  track: { energy: number | null; valence: number | null },
  contradiction: ContradictionProfile
): number {
  if (!contradiction.active || !contradiction.secondaryDirection) return 0;
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const s = contradiction.secondaryDirection;
  const de = Math.abs(e - s.energy);
  const dv = Math.abs(v - s.valence);
  return Math.max(0, 1 - (de + dv) * 0.9);
}

function blend(a: number, b: number, t: number): number {
  return Math.max(0, Math.min(1, a * (1 - t) + b * t));
}
