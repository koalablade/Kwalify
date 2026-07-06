export type EmotionalConsistencyLabel = "Cohesive" | "Mixed flow" | "Experimental mix";

export interface EmotionalConsistencyResult {
  score: number;
  label: EmotionalConsistencyLabel;
}

export interface EmotionalConsistencyBreakdown {
  score: number;
  label: EmotionalConsistencyLabel;
  arcFit: number;
  oscillationHealth: number;
  matchAvg: number;
  matchDistribution: number;
  sceneCoherence: number;
}

type ScoredTrack = {
  energy?: number | null;
  score?: number;
  matchStrength?: number;
};

function energyOf(t: ScoredTrack): number {
  return t.energy ?? 0.5;
}

function consistencyLabel(score: number): EmotionalConsistencyLabel {
  if (score >= 72) return "Cohesive";
  if (score >= 48) return "Mixed flow";
  return "Experimental mix";
}

/** 0–100 informational score — never gates generation. */
export function computeEmotionalConsistencyBreakdown(opts: {
  tracks: ScoredTrack[];
  sceneConfidence: number | null;
  hasCanonicalScene: boolean;
}): EmotionalConsistencyBreakdown {
  const tracks = opts.tracks;
  if (tracks.length < 2) {
    return {
      score: 70,
      label: "Mixed flow",
      arcFit: 0.5,
      oscillationHealth: 0.7,
      matchAvg: 0.7,
      matchDistribution: 0.7,
      sceneCoherence: 0.45,
    };
  }

  const n = tracks.length;
  const energies = tracks.map(energyOf);
  const introEnd = Math.max(1, Math.round(n * 0.2));
  const peakStart = Math.max(introEnd + 1, Math.round(n * 0.45));
  const peakEnd = Math.min(n - 1, Math.round(n * 0.75));

  const introAvg =
    energies.slice(0, introEnd).reduce((a, b) => a + b, 0) / introEnd;
  const peakAvg =
    energies.slice(peakStart, peakEnd + 1).reduce((a, b) => a + b, 0) /
    Math.max(1, peakEnd - peakStart + 1);
  const outroAvg =
    energies.slice(-Math.max(1, Math.round(n * 0.2))).reduce((a, b) => a + b, 0) /
    Math.max(1, Math.round(n * 0.2));

  let arcFit = 0.5;
  if (peakAvg > introAvg + 0.04) arcFit += 0.25;
  if (peakAvg > outroAvg + 0.03) arcFit += 0.15;
  if (outroAvg < peakAvg) arcFit += 0.1;
  arcFit = Math.min(1, arcFit);

  let streakPenalty = 0;
  let streak = 1;
  for (let i = 1; i < energies.length; i++) {
    if (Math.abs(energies[i]! - energies[i - 1]!) < 0.06) {
      streak++;
      if (streak >= 4) streakPenalty += 0.08;
    } else {
      streak = 1;
    }
  }
  const oscillationHealth = Math.max(0, 1 - streakPenalty);

  const strengths = tracks.map((t) => t.matchStrength ?? t.score ?? 0.7);
  const matchAvg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  const matchVar =
    strengths.reduce((s, v) => s + (v - matchAvg) ** 2, 0) / strengths.length;
  const matchDistribution = Math.max(0, 1 - Math.sqrt(matchVar) * 2);

  const sceneCoherence = opts.hasCanonicalScene
    ? Math.max(0.4, opts.sceneConfidence ?? 0.55)
    : 0.45;

  const raw =
    arcFit * 35 +
    oscillationHealth * 25 +
    matchAvg * matchDistribution * 25 +
    sceneCoherence * 15;

  const score = Math.round(Math.max(0, Math.min(100, raw)));
  return {
    score,
    label: consistencyLabel(score),
    arcFit: Math.round(arcFit * 1000) / 1000,
    oscillationHealth: Math.round(oscillationHealth * 1000) / 1000,
    matchAvg: Math.round(matchAvg * 1000) / 1000,
    matchDistribution: Math.round(matchDistribution * 1000) / 1000,
    sceneCoherence: Math.round(sceneCoherence * 1000) / 1000,
  };
}

export function computeEmotionalConsistencyScore(opts: {
  tracks: ScoredTrack[];
  sceneConfidence: number | null;
  hasCanonicalScene: boolean;
}): EmotionalConsistencyResult {
  const b = computeEmotionalConsistencyBreakdown(opts);
  return { score: b.score, label: b.label };
}
