import type { EmotionProfile } from "./emotion";
import { detectTimeOfDay, detectEnvironment, detectMotionState } from "./emotion-scene-layers";

export type PromptConfidenceTier = "low" | "medium" | "high";

export interface PromptConfidence {
  score: number;
  tier: PromptConfidenceTier;
  hints: string[];
  /** Multiplier applied to refined scores when tier is high (reward detail). */
  qualityBoost: number;
}

export function scorePromptConfidence(
  vibe: string,
  profile: EmotionProfile,
  opts?: {
    experienceSceneMatched?: boolean;
    hasJourneyDestination?: boolean;
    mixedEmotions?: string[];
  }
): PromptConfidence {
  const text = vibe.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  let score = 0.2;
  const hints: string[] = [];

  if (words.length >= 4) score += 0.12;
  if (words.length >= 8) score += 0.15;
  if (words.length >= 14) score += 0.1;
  else if (words.length <= 2) {
    score -= 0.15;
    hints.push("Add when, where, or what you're doing for a stronger playlist.");
  }

  if (detectTimeOfDay(lower)) score += 0.1;
  if (detectEnvironment(lower)) score += 0.08;
  if (detectMotionState(lower)) score += 0.06;

  if (profile.timeOfDay) score += 0.05;
  if (profile.environment) score += 0.05;
  if (profile.motionState) score += 0.04;

  if (opts?.experienceSceneMatched) {
    score += 0.18;
    hints.push("Matched a life-moment scene.");
  }

  if (opts?.hasJourneyDestination) {
    score += 0.12;
    hints.push("Emotional journey detected (current → desired).");
  }

  if (opts?.mixedEmotions && opts.mixedEmotions.length >= 2) {
    score += 0.08;
    hints.push("Mixed feelings preserved.");
  }

  if (/,\s*|\band\b|\bbut\b|\bafter\b/i.test(text)) score += 0.06;

  score = Math.max(0, Math.min(1, score));

  let tier: PromptConfidenceTier = "low";
  if (score >= 0.62) tier = "high";
  else if (score >= 0.38) tier = "medium";

  const qualityBoost = tier === "high" ? 1.06 : tier === "medium" ? 1.02 : 1;

  if (tier === "low" && hints.length === 0) {
    hints.push('Try a moment: "rainy train home after work, want calm not sad".');
  }

  return { score: Math.round(score * 100) / 100, tier, hints, qualityBoost };
}
