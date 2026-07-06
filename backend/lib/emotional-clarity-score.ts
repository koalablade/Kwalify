import type { PrimaryNarrative } from "./primary-narrative";

export type EmotionalClarityLabel =
  | "Very clear emotional arc"
  | "Moderately expressive"
  | "Experimental flow";

export interface EmotionalClarityResult {
  score: number;
  label: EmotionalClarityLabel;
}

function narrativeConsistency(narrative: PrimaryNarrative): number {
  let score = 0;
  if (narrative.momentLabel.trim().length > 2) score += 0.4;
  if (narrative.summary.trim().length > 10) score += 0.35;
  if (narrative.arcSummary.trim().length > 10) score += 0.25;
  return Math.min(1, score);
}

function clarityLabel(score: number): EmotionalClarityLabel {
  if (score >= 72) return "Very clear emotional arc";
  if (score >= 48) return "Moderately expressive";
  return "Experimental flow";
}

/** Display-only — never affects generation or selection. */
export function computeEmotionalClarityScore(opts: {
  primaryNarrative: PrimaryNarrative;
  emotionalConsistencyScore: number;
  signatureStable: boolean;
}): EmotionalClarityResult {
  const narrative = narrativeConsistency(opts.primaryNarrative);
  const consistency = Math.max(0, Math.min(1, opts.emotionalConsistencyScore / 100));
  const stability = opts.signatureStable ? 1 : 0.55;

  const raw = narrative * 40 + consistency * 40 + stability * 20;
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  return { score, label: clarityLabel(score) };
}
