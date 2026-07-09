/**
 * Save likelihood proxy — replay usefulness without feeding generation.
 */

import { evaluateWouldISave } from "../../../core/editorial/would-i-save-evaluator";
import { humanPlausibilityScore } from "../../../core/editorial/human-playlist-patterns";
import type { PatternScoringTrack } from "../../../core/editorial/human-playlist-patterns";
import type { LockedIntent } from "../../../core/v3/intent";
import type { SaveProxyResult } from "./types";

const LOCKED_INTENT_STUB: LockedIntent = {
  genreFamilies: [],
  primaryGenre: null,
  primarySubgenre: null,
  secondarySubgenre: null,
  subgenreTerms: [],
  eraRange: null,
  mood: [],
  activity: null,
  energy: null,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function scoreEmotionalMemorability(tracks: PatternScoringTrack[]): number {
  const valences = tracks.map((t) => t.valence).filter((v): v is number => typeof v === "number");
  if (valences.length < 3) return 0.5;
  const spread = Math.max(...valences) - Math.min(...valences);
  const mean = valences.reduce((a, b) => a + b, 0) / valences.length;
  const arc = Math.abs(valences[valences.length - 1]! - valences[0]!);
  return clamp01(spread * 0.45 + arc * 0.35 + (1 - Math.abs(mean - 0.5)) * 0.2);
}

export function evaluateSaveProxy(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
  continueListeningScore: number;
  openingIdentity: number;
}): SaveProxyResult {
  if (opts.tracks.length < 5) {
    return {
      score: 0,
      intentMatch: 0,
      replayUsefulness: 0,
      playlistIdentity: 0,
      emotionalMemorability: 0,
    };
  }

  const wouldSave = evaluateWouldISave({
    prompt: opts.prompt,
    tracks: opts.tracks,
    context: null,
    lockedIntent: LOCKED_INTENT_STUB,
  });

  const intentMatch = wouldSave.combinedScore;
  const replayUsefulness = clamp01(opts.continueListeningScore * 0.65 + wouldSave.humanPatternScore * 0.35);
  const playlistIdentity = clamp01(
    opts.openingIdentity * 0.55 + humanPlausibilityScore(opts.tracks) * 0.45,
  );
  const emotionalMemorability = scoreEmotionalMemorability(opts.tracks);

  const score = clamp01(
    intentMatch * 0.3 +
    replayUsefulness * 0.25 +
    playlistIdentity * 0.25 +
    emotionalMemorability * 0.2,
  );

  return {
    score: Math.round(score * 1000) / 1000,
    intentMatch: Math.round(intentMatch * 1000) / 1000,
    replayUsefulness: Math.round(replayUsefulness * 1000) / 1000,
    playlistIdentity: Math.round(playlistIdentity * 1000) / 1000,
    emotionalMemorability: Math.round(emotionalMemorability * 1000) / 1000,
  };
}
