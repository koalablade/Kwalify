/**
 * Blind pairwise evaluator — human reference vs Kwalify without label leakage.
 */

import { comparePlaylistsPairwise } from "../../core/editorial/pairwise-playlist-judge";
import type { PairwisePlaylistCandidate } from "../../core/editorial/pairwise-playlist-judge";
import { evaluateWouldISave } from "../../core/editorial/would-i-save-evaluator";
import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import type { LockedIntent } from "../../core/v3/intent";
import type { BlindPairside, BlindPairwiseDimensions, BlindPairwiseResult } from "./types";

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

function buildCandidate(label: string, tracks: PatternScoringTrack[], prompt: string): PairwisePlaylistCandidate {
  const wouldISave = evaluateWouldISave({
    prompt,
    tracks,
    context: null,
    lockedIntent: LOCKED_INTENT_STUB,
  });
  return {
    label,
    tracks,
    wouldISave,
    context: null,
  };
}

function mapSide(
  winner: "a" | "b" | "tie",
  humanWasA: boolean,
): BlindPairside {
  if (winner === "tie") return "tie";
  const humanWon = (winner === "a" && humanWasA) || (winner === "b" && !humanWasA);
  return humanWon ? "human" : "kwalify";
}

function mapDimensions(
  dimensions: Record<string, "a" | "b" | "tie">,
  humanWasA: boolean,
): BlindPairwiseDimensions {
  return {
    openingQuality: mapSide(dimensions.opening_intention ?? "tie", humanWasA),
    activityFit: mapSide(dimensions.prompt_alignment ?? "tie", humanWasA),
    emotionalFit: mapSide(dimensions.full_playlist_shape ?? "tie", humanWasA),
    replayLikelihood: mapSide(dimensions.discovery_pacing ?? dimensions.ending_satisfaction ?? "tie", humanWasA),
    saveLikelihood: mapSide(dimensions.human_saveable ?? "tie", humanWasA),
  };
}

export function evaluateBlindPairwise(opts: {
  prompt: string;
  humanTracks: PatternScoringTrack[];
  kwalifyTracks: PatternScoringTrack[];
  seed?: number;
}): BlindPairwiseResult | null {
  if (opts.humanTracks.length < 5 || opts.kwalifyTracks.length < 5) return null;

  const seed = opts.seed ?? 42;
  const humanWasA = seed % 2 === 0;
  const human = buildCandidate("human_reference", opts.humanTracks, opts.prompt);
  const kwalify = buildCandidate("kwalify_generated", opts.kwalifyTracks, opts.prompt);
  const a = humanWasA ? human : kwalify;
  const b = humanWasA ? kwalify : human;

  const cmp = comparePlaylistsPairwise(a, b);
  const overall = mapSide(cmp.winner, humanWasA);
  const dimensions = mapDimensions(cmp.dimensions as Record<string, "a" | "b" | "tie">, humanWasA);

  return {
    winner: overall,
    confidence: cmp.confidence,
    reasons: cmp.reasons,
    dimensions,
    blindSeed: seed,
    humanWouldSave: human.wouldISave.combinedScore,
    kwalifyWouldSave: kwalify.wouldISave.combinedScore,
  };
}
