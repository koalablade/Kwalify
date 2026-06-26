/**
 * Pairwise comparative judgement — humans pick B over A without scalar scores.
 * Used to select the best of 2–5 generated candidates via relative dimensions,
 * not by taking the highest absolute wouldSaveScore alone.
 */

import type { SceneWorldContext } from "../scene-world-layer";
import {
  computeHumanPlaylistFeatures,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import type { WouldISaveEvaluation } from "./would-i-save-evaluator";

export type PairwisePlaylistCandidate = {
  label: string;
  tracks: PatternScoringTrack[];
  wouldISave: WouldISaveEvaluation;
  qualityOverall: number;
  context: SceneWorldContext | null;
  scalarTotal: number;
};

export type PairwiseDimension = "human_saveable" | "opening_intention" | "full_playlist_shape" | "cringe_resistance" | "prompt_alignment";

export type PairwiseComparisonResult = {
  winner: "a" | "b";
  confidence: number;
  reasons: string[];
  dimensions: Record<PairwiseDimension, "a" | "b" | "tie">;
  votesA: number;
  votesB: number;
};

export type PairwiseTournamentAudit = {
  selectionMethod: "pairwise_tournament";
  candidateCount: number;
  comparisons: Array<{
    a: string;
    b: string;
    winner: string;
    confidence: number;
    reasons: string[];
  }>;
  runnerUp: string | null;
  winner: string;
  winnerConfidence: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cringeScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length <= 1) return 1;
  const features = computeHumanPlaylistFeatures(tracks);
  let penalty = 0;
  penalty += Math.max(0, features.maxArtistShare - 0.14) * 3;
  penalty += Math.max(0, features.avgEnergyJump - 0.22) * 2.5;
  if (features.smoothTransitionShare < 0.55) penalty += (0.55 - features.smoothTransitionShare) * 1.5;

  const textures = tracks.map((t) => {
    const acoustic = t.acousticness ?? 0.5;
    const dance = t.danceability ?? 0.5;
    if (acoustic >= 0.55) return "acoustic";
    if (dance >= 0.65) return "rhythmic";
    if (acoustic <= 0.25 && dance <= 0.45) return "dense";
    return "balanced";
  });
  let hardJumps = 0;
  for (let i = 1; i < tracks.length; i++) {
    const jump = Math.abs((tracks[i]!.energy ?? 0.5) - (tracks[i - 1]!.energy ?? 0.5));
    if (jump > 0.28 && textures[i] !== textures[i - 1]) hardJumps += 1;
  }
  penalty += hardJumps * 0.08;
  return clamp01(1 - penalty);
}

function openingShapeScore(tracks: PatternScoringTrack[]): number {
  const opening = tracks.slice(0, 5);
  if (opening.length === 0) return 0;
  return scoreAgainstHumanPlaylistPatterns(opening).score;
}

function middleShapeScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length < 12) return scoreAgainstHumanPlaylistPatterns(tracks).score;
  const midStart = Math.floor(tracks.length * 0.35);
  const midEnd = Math.floor(tracks.length * 0.65);
  return scoreAgainstHumanPlaylistPatterns(tracks.slice(midStart, midEnd)).score;
}

function pickRelative(aScore: number, bScore: number, minDelta = 0.03): "a" | "b" | "tie" {
  if (Math.abs(aScore - bScore) < minDelta) return "tie";
  return aScore > bScore ? "a" : "b";
}

/**
 * Relative A vs B judgement — mimics "which would you save?" without absolute thresholds.
 */
export function comparePlaylistsPairwise(
  a: PairwisePlaylistCandidate,
  b: PairwisePlaylistCandidate,
): PairwiseComparisonResult {
  const reasons: string[] = [];
  const dimensions: Record<PairwiseDimension, "a" | "b" | "tie"> = {
    human_saveable: "tie",
    opening_intention: "tie",
    full_playlist_shape: "tie",
    cringe_resistance: "tie",
    prompt_alignment: "tie",
  };
  let votesA = 0;
  let votesB = 0;

  const vote = (dim: PairwiseDimension, pick: "a" | "b" | "tie", reason?: string): void => {
    dimensions[dim] = pick;
    if (pick === "a") votesA += 1;
    else if (pick === "b") votesB += 1;
    if (reason && pick !== "tie") reasons.push(reason);
  };

  if (a.wouldISave.humanSaveable !== b.wouldISave.humanSaveable) {
    vote(
      "human_saveable",
      a.wouldISave.humanSaveable ? "a" : "b",
      a.wouldISave.humanSaveable
        ? `${a.label} passes human-save gate, ${b.label} does not`
        : `${b.label} passes human-save gate, ${a.label} does not`,
    );
  } else {
    vote("human_saveable", "tie");
  }

  vote(
    "opening_intention",
    pickRelative(openingShapeScore(a.tracks), openingShapeScore(b.tracks), 0.04),
    undefined,
  );
  if (dimensions.opening_intention !== "tie") {
    const winner = dimensions.opening_intention === "a" ? a.label : b.label;
    reasons.push(`${winner} has stronger opening-five editorial shape`);
  }

  const aFull = scoreAgainstHumanPlaylistPatterns(a.tracks).score;
  const bFull = scoreAgainstHumanPlaylistPatterns(b.tracks).score;
  const aMid = middleShapeScore(a.tracks);
  const bMid = middleShapeScore(b.tracks);
  vote(
    "full_playlist_shape",
    pickRelative(aFull * 0.55 + aMid * 0.45, bFull * 0.55 + bMid * 0.45, 0.035),
  );

  vote(
    "cringe_resistance",
    pickRelative(cringeScore(a.tracks), cringeScore(b.tracks), 0.04),
  );
  if (dimensions.cringe_resistance !== "tie") {
    const winner = dimensions.cringe_resistance === "a" ? a.label : b.label;
    reasons.push(`${winner} avoids cringe patterns (artist clumping, hard texture jumps)`);
  }

  vote(
    "prompt_alignment",
    pickRelative(
      a.qualityOverall * 0.6 + a.wouldISave.humanPatternScore * 0.4,
      b.qualityOverall * 0.6 + b.wouldISave.humanPatternScore * 0.4,
      0.04,
    ),
  );

  if (votesA === votesB) {
    const scalarPick = a.scalarTotal >= b.scalarTotal ? "a" : "b";
    return {
      winner: scalarPick,
      confidence: 0.52,
      reasons: [...reasons, "pairwise tie — scalar pre-score broke deadlock"],
      dimensions,
      votesA,
      votesB,
    };
  }

  const winner = votesA > votesB ? "a" : "b";
  const margin = Math.abs(votesA - votesB);
  const confidence = clamp01(0.55 + margin * 0.09 + (winner === "a" ? a.wouldISave.combinedScore : b.wouldISave.combinedScore) * 0.15);

  return {
    winner,
    confidence,
    reasons,
    dimensions,
    votesA,
    votesB,
  };
}

export function selectBestCandidateByPairwiseTournament(
  candidates: PairwisePlaylistCandidate[],
): { winner: PairwisePlaylistCandidate; audit: PairwiseTournamentAudit } {
  if (candidates.length === 0) {
    throw new Error("pairwise tournament requires at least one candidate");
  }
  if (candidates.length === 1) {
    return {
      winner: candidates[0]!,
      audit: {
        selectionMethod: "pairwise_tournament",
        candidateCount: 1,
        comparisons: [],
        runnerUp: null,
        winner: candidates[0]!.label,
        winnerConfidence: 1,
      },
    };
  }

  const viable = candidates.filter((c) => c.tracks.length >= Math.max(8, Math.floor(c.tracks.length * 0.5)));
  const pool = (viable.length >= 2 ? viable : candidates)
    .slice()
    .sort((x, y) => y.scalarTotal - x.scalarTotal)
    .slice(0, 5);

  let champion = pool[0]!;
  const comparisons: PairwiseTournamentAudit["comparisons"] = [];
  let lastConfidence = 0.5;

  for (let i = 1; i < pool.length; i += 1) {
    const challenger = pool[i]!;
    const result = comparePlaylistsPairwise(champion, challenger);
    comparisons.push({
      a: champion.label,
      b: challenger.label,
      winner: result.winner === "a" ? champion.label : challenger.label,
      confidence: result.confidence,
      reasons: result.reasons,
    });
    if (result.winner === "b") champion = challenger;
    lastConfidence = result.confidence;
  }

  const runnerUp = pool.find((c) => c.label !== champion.label)?.label ?? null;

  return {
    winner: champion,
    audit: {
      selectionMethod: "pairwise_tournament",
      candidateCount: pool.length,
      comparisons,
      runnerUp,
      winner: champion.label,
      winnerConfidence: lastConfidence,
    },
  };
}

/** Build blind A/B payload for external human raters (reference vs generated). */
export function buildBlindPairwiseHumanBenchmarkPair(opts: {
  prompt: string;
  playlistA: { label: string; tracks: Array<{ trackName?: string | null; artistName?: string | null }> };
  playlistB: { label: string; tracks: Array<{ trackName?: string | null; artistName?: string | null }> };
  seed?: number;
}): {
  prompt: string;
  sideA: { sourceLabel: string; tracks: typeof opts.playlistA.tracks };
  sideB: { sourceLabel: string; tracks: typeof opts.playlistB.tracks };
  questions: string[];
  randomizationSeed: number;
} {
  const seed = opts.seed ?? 42;
  const swap = seed % 2 === 1;
  const left = swap ? opts.playlistB : opts.playlistA;
  const right = swap ? opts.playlistA : opts.playlistB;
  return {
    prompt: opts.prompt,
    sideA: { sourceLabel: left.label, tracks: left.tracks },
    sideB: { sourceLabel: right.label, tracks: right.tracks },
    questions: [
      "Which playlist feels more intentional?",
      "Which would you save?",
      "Which has the better opening?",
      "Which would you replay next week?",
      "Which feels like Spotify editorial?",
    ],
    randomizationSeed: seed,
  };
}
