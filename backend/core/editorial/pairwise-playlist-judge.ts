/**
 * Pairwise comparative judgement — tournament selection over playlist candidates.
 * Preference learning lives in playlist-preference-model.ts.
 */

import {
  comparePlaylistsForSelection,
  playlistPreferenceUtility,
  type PairwiseComparisonResult,
  type PairwisePlaylistCandidate,
} from "./playlist-preference-model";

export type {
  PairwiseComparisonResult,
  PairwiseDimension,
  PairwisePlaylistCandidate,
} from "./playlist-preference-model";

export type PairwiseTournamentAudit = {
  selectionMethod: "pairwise_tournament";
  candidateCount: number;
  preferenceMode: PairwiseComparisonResult["selectionMode"];
  comparisons: Array<{
    a: string;
    b: string;
    winner: string;
    confidence: number;
    reasons: string[];
    selectionMode: PairwiseComparisonResult["selectionMode"];
  }>;
  runnerUp: string | null;
  winner: string;
  winnerConfidence: number;
};

/** Relative A vs B — uses learned preference model when human labels exist. */
export function comparePlaylistsPairwise(
  a: PairwisePlaylistCandidate,
  b: PairwisePlaylistCandidate,
): PairwiseComparisonResult {
  return comparePlaylistsForSelection(a, b);
}

function interpretationBaseLabel(label: string): string {
  return label.replace(/_v\d+$/, "").replace(/_s\d+$/, "").replace(/_safety$/, "");
}

function playlistShapeSeedScore(candidate: PairwisePlaylistCandidate): number {
  return playlistPreferenceUtility(candidate);
}

/** Collapse many seed variants to one champion per editorial interpretation + wildcards. */
function selectDiverseTournamentPool(
  candidates: PairwisePlaylistCandidate[],
  maxPool = 8,
): PairwisePlaylistCandidate[] {
  if (candidates.length <= maxPool) return candidates;

  const byInterpretation = new Map<string, PairwisePlaylistCandidate>();
  for (const candidate of candidates) {
    const base = interpretationBaseLabel(candidate.label);
    const existing = byInterpretation.get(base);
    const score = playlistShapeSeedScore(candidate);
    if (!existing || score > playlistShapeSeedScore(existing)) {
      byInterpretation.set(base, candidate);
    }
  }

  const interpretationWinners = [...byInterpretation.values()];
  const winnerLabels = new Set(interpretationWinners.map((c) => c.label));
  const wildcards = candidates
    .filter((c) => !winnerLabels.has(c.label))
    .sort((a, b) => playlistShapeSeedScore(b) - playlistShapeSeedScore(a))
    .slice(0, Math.max(0, maxPool - interpretationWinners.length));

  return [...interpretationWinners, ...wildcards].slice(0, maxPool);
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
        preferenceMode: "heuristic",
        comparisons: [],
        runnerUp: null,
        winner: candidates[0]!.label,
        winnerConfidence: 1,
      },
    };
  }

  const viable = candidates.filter((c) => c.tracks.length >= Math.max(8, Math.floor(c.tracks.length * 0.5)));
  const source = viable.length >= 2 ? viable : candidates;
  const pool = selectDiverseTournamentPool(source, Math.min(8, source.length))
    .sort((x, y) => playlistShapeSeedScore(y) - playlistShapeSeedScore(x));

  let champion = pool[0]!;
  const comparisons: PairwiseTournamentAudit["comparisons"] = [];
  let lastConfidence = 0.5;
  let lastMode: PairwiseComparisonResult["selectionMode"] = "heuristic";

  for (let i = 1; i < pool.length; i += 1) {
    const challenger = pool[i]!;
    const result = comparePlaylistsPairwise(champion, challenger);
    comparisons.push({
      a: champion.label,
      b: challenger.label,
      winner: result.winner === "a" ? champion.label : challenger.label,
      confidence: result.confidence,
      reasons: result.reasons,
      selectionMode: result.selectionMode,
    });
    if (result.winner === "b") champion = challenger;
    lastConfidence = result.confidence;
    lastMode = result.selectionMode;
  }

  const runnerUp = pool.find((c) => c.label !== champion.label)?.label ?? null;

  return {
    winner: champion,
    audit: {
      selectionMethod: "pairwise_tournament",
      candidateCount: pool.length,
      preferenceMode: lastMode,
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

export { playlistPreferenceUtility };
