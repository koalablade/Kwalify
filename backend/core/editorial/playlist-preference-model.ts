/**
 * Playlist preference learning — learns from pairwise human choices
 * ("Which playlist would you save?") with heuristic cold-start fallback.
 *
 * Fit:
 *   npm run fit:preference-model
 *   npm run fit:preference-model -- --labels data/corpus/pairwise-human-labels.jsonl
 *
 * Override: PLAYLIST_PREFERENCE_MODEL_PATH
 */

import fs from "node:fs";
import readline from "node:readline";
import bundledModel from "../../data/playlist-preference-model.json";
import type { SceneWorldContext } from "../scene-world-layer";
import {
  computeHumanPlaylistFeatures,
  humanPlausibilityScore,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import { loadPlaylistGenome } from "./playlist-genome";
import type { WouldISaveEvaluation } from "./would-i-save-evaluator";

export type PairwiseDimension =
  | "human_saveable"
  | "opening_intention"
  | "full_playlist_shape"
  | "cringe_resistance"
  | "prompt_alignment"
  | "transition_flow"
  | "discovery_pacing"
  | "ending_satisfaction";

export const PAIRWISE_DIMENSIONS: PairwiseDimension[] = [
  "human_saveable",
  "opening_intention",
  "full_playlist_shape",
  "cringe_resistance",
  "prompt_alignment",
  "transition_flow",
  "discovery_pacing",
  "ending_satisfaction",
];

export type PairwisePlaylistCandidate = {
  label: string;
  tracks: PatternScoringTrack[];
  wouldISave: WouldISaveEvaluation;
  context: SceneWorldContext | null;
};

export type PairwiseComparisonResult = {
  winner: "a" | "b";
  confidence: number;
  reasons: string[];
  dimensions: Record<PairwiseDimension, "a" | "b" | "tie">;
  votesA: number;
  votesB: number;
  selectionMode: "learned_preference" | "heuristic_blend" | "heuristic";
  utilityA: number;
  utilityB: number;
};

export type PreferenceModelSource = "cold_start" | "bootstrap_corpus" | "human_labels";

export type PreferenceModelProfile = {
  version: 1;
  fittedAt: string;
  source: PreferenceModelSource;
  labelCount: number;
  pairCount: number;
  blendWeight: number;
  dimensionWeights: Record<PairwiseDimension, number>;
  utilityWeights: Record<PairwiseDimension, number>;
};

export type HumanPairwiseLabel = {
  prompt?: string;
  playlistA_id?: string;
  playlistB_id?: string;
  winner: "a" | "b" | "tie";
  rater_id?: string;
  questions?: string[];
  playlistA_tracks?: PatternScoringTrack[];
  playlistB_tracks?: PatternScoringTrack[];
};

export type PairwiseDimensionScores = Record<PairwiseDimension, number>;

const DEFAULT_DIMENSION_WEIGHTS: Record<PairwiseDimension, number> = {
  human_saveable: 1.35,
  opening_intention: 1.15,
  full_playlist_shape: 1.25,
  cringe_resistance: 1.05,
  prompt_alignment: 0.95,
  transition_flow: 1.2,
  discovery_pacing: 1.1,
  ending_satisfaction: 1.15,
};

const DEFAULT_UTILITY_WEIGHTS: Record<PairwiseDimension, number> = {
  human_saveable: 0.22,
  opening_intention: 0.12,
  full_playlist_shape: 0.18,
  cringe_resistance: 0.1,
  prompt_alignment: 0.12,
  transition_flow: 0.1,
  discovery_pacing: 0.08,
  ending_satisfaction: 0.08,
};

let cachedModel: PreferenceModelProfile | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeRecord(weights: Record<PairwiseDimension, number>): Record<PairwiseDimension, number> {
  const sum = PAIRWISE_DIMENSIONS.reduce((total, key) => total + Math.max(0, weights[key]), 0);
  if (sum <= 0) return { ...weights };
  const out = {} as Record<PairwiseDimension, number>;
  for (const key of PAIRWISE_DIMENSIONS) {
    out[key] = Math.max(0, weights[key]) / sum;
  }
  return out;
}

function isPreferenceModelProfile(value: unknown): value is PreferenceModelProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreferenceModelProfile>;
  return candidate.version === 1 && !!candidate.dimensionWeights && !!candidate.utilityWeights;
}

export function defaultPreferenceModel(): PreferenceModelProfile {
  return {
    version: 1,
    fittedAt: "cold_start",
    source: "cold_start",
    labelCount: 0,
    pairCount: 0,
    blendWeight: 0,
    dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS },
    utilityWeights: normalizeRecord({ ...DEFAULT_UTILITY_WEIGHTS }),
  };
}

export function loadPreferenceModel(): PreferenceModelProfile {
  if (cachedModel) return cachedModel;

  const envPath = process.env.PLAYLIST_PREFERENCE_MODEL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(envPath, "utf8")) as Partial<PreferenceModelProfile>;
      if (isPreferenceModelProfile(raw)) {
        cachedModel = raw;
        return cachedModel;
      }
    } catch {
      // fall through
    }
  }

  if (isPreferenceModelProfile(bundledModel)) {
    cachedModel = bundledModel;
    return cachedModel;
  }

  cachedModel = defaultPreferenceModel();
  return cachedModel;
}

export function dimensionVoteWeight(dimension: PairwiseDimension): number {
  return loadPreferenceModel().dimensionWeights[dimension] ?? 1;
}

function cringeScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length <= 1) return 1;
  const thresholds = loadPlaylistGenome().pairwiseThresholds;
  const features = computeHumanPlaylistFeatures(tracks);
  let penalty = 0;
  penalty += Math.max(0, features.maxArtistShare - thresholds.maxArtistShareCringe) * 3;
  penalty += Math.max(0, features.avgEnergyJump - thresholds.maxEnergyJumpCringe) * 2.5;
  if (features.smoothTransitionShare < thresholds.minSmoothTransitionShare) {
    penalty += (thresholds.minSmoothTransitionShare - features.smoothTransitionShare) * 1.5;
  }

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
    if (jump > thresholds.hardEnergyJump && textures[i] !== textures[i - 1]) hardJumps += 1;
  }
  penalty += hardJumps * 0.08;
  return clamp01(1 - penalty);
}

function openingShapeScore(tracks: PatternScoringTrack[]): number {
  const opening = tracks.slice(0, 5);
  if (opening.length === 0) return 0;
  return humanPlausibilityScore(opening);
}

function middleShapeScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length < 12) return scoreAgainstHumanPlaylistPatterns(tracks).score;
  const midStart = Math.floor(tracks.length * 0.35);
  const midEnd = Math.floor(tracks.length * 0.65);
  return scoreAgainstHumanPlaylistPatterns(tracks.slice(midStart, midEnd)).score;
}

function endingShapeScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length < 8) return humanPlausibilityScore(tracks);
  const tail = tracks.slice(-Math.min(8, Math.floor(tracks.length * 0.2)));
  return humanPlausibilityScore(tail);
}

function discoveryPacingScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length < 6) return 0.5;
  const thresholds = loadPlaylistGenome().pairwiseThresholds;
  const features = computeHumanPlaylistFeatures(tracks);
  const discoveryBand =
    features.discoveryRatio >= thresholds.discoveryRatioLow &&
    features.discoveryRatio <= thresholds.discoveryRatioHigh
      ? 1
      : 0.55;
  const spacing = features.artistSpacingMedian >= thresholds.artistSpacingGood ? 1 : 0.65;
  return clamp01(discoveryBand * 0.6 + spacing * 0.4);
}

function transitionFlowScore(tracks: PatternScoringTrack[]): number {
  return clamp01(cringeScore(tracks) * 0.55 + scoreAgainstHumanPlaylistPatterns(tracks).score * 0.45);
}

function playlistPromptAlignmentScore(candidate: PairwisePlaylistCandidate): number {
  return clamp01(
    humanPlausibilityScore(candidate.tracks) * 0.55 +
    candidate.wouldISave.combinedScore * 0.45,
  );
}

export function extractPairwiseDimensionScores(
  candidate: PairwisePlaylistCandidate,
): PairwiseDimensionScores {
  const tracks = candidate.tracks;
  const full = humanPlausibilityScore(tracks);
  const mid = middleShapeScore(tracks);
  return {
    human_saveable: candidate.wouldISave.combinedScore,
    opening_intention: openingShapeScore(tracks),
    full_playlist_shape: clamp01(full * 0.55 + mid * 0.45),
    cringe_resistance: cringeScore(tracks),
    prompt_alignment: playlistPromptAlignmentScore(candidate),
    transition_flow: transitionFlowScore(tracks),
    discovery_pacing: discoveryPacingScore(tracks),
    ending_satisfaction: endingShapeScore(tracks),
  };
}

export function playlistPreferenceUtility(
  candidate: PairwisePlaylistCandidate,
  model: PreferenceModelProfile = loadPreferenceModel(),
): number {
  const scores = extractPairwiseDimensionScores(candidate);
  let utility = 0;
  for (const dimension of PAIRWISE_DIMENSIONS) {
    utility += model.utilityWeights[dimension] * scores[dimension];
  }
  const gateBonus = candidate.wouldISave.humanSaveable ? 0.04 : 0;
  return clamp01(utility + gateBonus);
}

/** Whole-playlist human curation score — used by search, not track-level rank. */
export function scorePlaylistForCuration(tracks: PatternScoringTrack[]): number {
  if (tracks.length === 0) return 0;
  const patterns = scoreAgainstHumanPlaylistPatterns(tracks);
  const plausibility = humanPlausibilityScore(tracks);
  const combinedScore = clamp01(plausibility * 0.48 + patterns.score * 0.52);
  const utility = playlistPreferenceUtility({
    label: "curation",
    tracks,
    wouldISave: {
      wouldSaveScore: combinedScore,
      humanPatternScore: patterns.score,
      gateCuratorScore: plausibility,
      combinedScore,
      humanSaveable: combinedScore >= 0.58 && patterns.score >= 0.5,
      strictMode: false,
      humanPatternBreakdown: patterns.breakdown,
      gateRejectionReasons: [],
    },
    context: null,
  });
  const openingBonus = openingShapeScore(tracks);
  return clamp01(utility * 0.85 + openingBonus * 0.15);
}

function pickRelative(aScore: number, bScore: number, minDelta = 0.03): "a" | "b" | "tie" {
  if (Math.abs(aScore - bScore) < minDelta) return "tie";
  return aScore > bScore ? "a" : "b";
}

function compareHeuristicDimensions(
  a: PairwisePlaylistCandidate,
  b: PairwisePlaylistCandidate,
): Pick<PairwiseComparisonResult, "dimensions" | "votesA" | "votesB" | "reasons"> {
  const reasons: string[] = [];
  const dimensions: Record<PairwiseDimension, "a" | "b" | "tie"> = {
    human_saveable: "tie",
    opening_intention: "tie",
    full_playlist_shape: "tie",
    cringe_resistance: "tie",
    prompt_alignment: "tie",
    transition_flow: "tie",
    discovery_pacing: "tie",
    ending_satisfaction: "tie",
  };
  let votesA = 0;
  let votesB = 0;

  const vote = (dim: PairwiseDimension, pick: "a" | "b" | "tie", reason?: string): void => {
    dimensions[dim] = pick;
    const weight = dimensionVoteWeight(dim);
    if (pick === "a") votesA += weight;
    else if (pick === "b") votesB += weight;
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
    vote("human_saveable", pickRelative(a.wouldISave.combinedScore, b.wouldISave.combinedScore, 0.025));
  }

  vote("opening_intention", pickRelative(openingShapeScore(a.tracks), openingShapeScore(b.tracks), 0.04));
  if (dimensions.opening_intention !== "tie") {
    const winner = dimensions.opening_intention === "a" ? a.label : b.label;
    reasons.push(`${winner} has stronger opening-five editorial shape`);
  }

  const aScores = extractPairwiseDimensionScores(a);
  const bScores = extractPairwiseDimensionScores(b);
  vote("full_playlist_shape", pickRelative(aScores.full_playlist_shape, bScores.full_playlist_shape, 0.035));
  vote("cringe_resistance", pickRelative(aScores.cringe_resistance, bScores.cringe_resistance, 0.04));
  if (dimensions.cringe_resistance !== "tie") {
    const winner = dimensions.cringe_resistance === "a" ? a.label : b.label;
    reasons.push(`${winner} avoids cringe patterns (artist clumping, hard texture jumps)`);
  }
  vote("prompt_alignment", pickRelative(aScores.prompt_alignment, bScores.prompt_alignment, 0.04));
  vote("transition_flow", pickRelative(aScores.transition_flow, bScores.transition_flow, 0.035));
  vote("discovery_pacing", pickRelative(aScores.discovery_pacing, bScores.discovery_pacing, 0.035));
  vote("ending_satisfaction", pickRelative(aScores.ending_satisfaction, bScores.ending_satisfaction, 0.04));

  return { dimensions, votesA, votesB, reasons };
}

/**
 * Primary pairwise selector — blends learned utility with heuristic dimension voting.
 */
export function comparePlaylistsForSelection(
  a: PairwisePlaylistCandidate,
  b: PairwisePlaylistCandidate,
  model: PreferenceModelProfile = loadPreferenceModel(),
): PairwiseComparisonResult {
  const utilityA = playlistPreferenceUtility(a, model);
  const utilityB = playlistPreferenceUtility(b, model);
  const heuristic = compareHeuristicDimensions(a, b);

  if (model.blendWeight >= 0.999) {
    const winner = utilityA >= utilityB ? "a" : "b";
    const margin = Math.abs(utilityA - utilityB);
    return {
      winner,
      confidence: clamp01(0.58 + margin * 0.35),
      reasons: [
        ...heuristic.reasons,
        `learned preference utility ${winner === "a" ? utilityA.toFixed(3) : utilityB.toFixed(3)}`,
      ],
      dimensions: heuristic.dimensions,
      votesA: utilityA,
      votesB: utilityB,
      selectionMode: "learned_preference",
      utilityA,
      utilityB,
    };
  }

  if (model.blendWeight <= 0.001) {
    if (heuristic.votesA === heuristic.votesB) {
      const shapePick = utilityA >= utilityB ? "a" : "b";
      return {
        winner: shapePick,
        confidence: 0.52,
        reasons: [...heuristic.reasons, "pairwise tie — preference utility broke deadlock"],
        dimensions: heuristic.dimensions,
        votesA: heuristic.votesA,
        votesB: heuristic.votesB,
        selectionMode: "heuristic",
        utilityA,
        utilityB,
      };
    }
    const winner = heuristic.votesA > heuristic.votesB ? "a" : "b";
    const margin = Math.abs(heuristic.votesA - heuristic.votesB);
    const confidence = clamp01(
      0.55 + margin * 0.09 + (winner === "a" ? a.wouldISave.combinedScore : b.wouldISave.combinedScore) * 0.15,
    );
    return {
      winner,
      confidence,
      reasons: heuristic.reasons,
      dimensions: heuristic.dimensions,
      votesA: heuristic.votesA,
      votesB: heuristic.votesB,
      selectionMode: "heuristic",
      utilityA,
      utilityB,
    };
  }

  const blendedA = utilityA * model.blendWeight + heuristic.votesA * (1 - model.blendWeight);
  const blendedB = utilityB * model.blendWeight + heuristic.votesB * (1 - model.blendWeight);
  const winner = blendedA >= blendedB ? "a" : "b";
  const margin = Math.abs(blendedA - blendedB);
  return {
    winner,
    confidence: clamp01(0.55 + margin * 0.12),
    reasons: [
      ...heuristic.reasons,
      `blended preference score ${winner === "a" ? blendedA.toFixed(3) : blendedB.toFixed(3)}`,
    ],
    dimensions: heuristic.dimensions,
    votesA: blendedA,
    votesB: blendedB,
    selectionMode: "heuristic_blend",
    utilityA,
    utilityB,
  };
}

export function extractPairwiseDimensionScoresFromTracks(
  tracks: PatternScoringTrack[],
  wouldISave: WouldISaveEvaluation,
): PairwiseDimensionScores {
  return extractPairwiseDimensionScores({
    label: "tracks",
    tracks,
    wouldISave,
    context: null,
  });
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function scoreSorted(tracks: PatternScoringTrack[]): PatternScoringTrack[] {
  return tracks.slice().sort((a, b) => (b.popularity ?? 50) - (a.popularity ?? 50));
}

export function fitPreferenceModelFromBootstrap(
  playlists: Array<{ tracks: PatternScoringTrack[] }>,
): PreferenceModelProfile {
  const wins = Object.fromEntries(PAIRWISE_DIMENSIONS.map((d) => [d, 0])) as Record<PairwiseDimension, number>;
  const totals = { ...wins };
  let pairs = 0;

  for (let i = 0; i < playlists.length; i += 1) {
    const human = playlists[i]!.tracks;
    if (human.length < 10) continue;
    const variants = [
      scoreSorted(human),
      shuffle(human, i * 7919 + 1),
      shuffle(human, i * 9973 + 2),
    ];
    const humanWouldISave = {
      wouldSaveScore: 0.8,
      humanPatternScore: 0.8,
      gateCuratorScore: 0.8,
      combinedScore: 0.8,
      humanSaveable: true,
      strictMode: true,
      humanPatternBreakdown: {},
      gateRejectionReasons: [],
    };
    const humanScores = extractPairwiseDimensionScoresFromTracks(human, humanWouldISave);
    for (const variant of variants) {
      pairs += 1;
      const variantScores = extractPairwiseDimensionScoresFromTracks(variant, {
        ...humanWouldISave,
        combinedScore: 0.55,
        humanSaveable: false,
      });
      for (const dim of PAIRWISE_DIMENSIONS) {
        totals[dim] += 1;
        if (humanScores[dim] >= variantScores[dim] + 0.02) wins[dim] += 1;
      }
    }
  }

  const dimensionWeights = {} as Record<PairwiseDimension, number>;
  const utilityWeights = {} as Record<PairwiseDimension, number>;
  for (const dim of PAIRWISE_DIMENSIONS) {
    const rate = totals[dim] > 0 ? wins[dim]! / totals[dim]! : 0.5;
    dimensionWeights[dim] = Math.round((0.85 + rate * 0.7) * 100) / 100;
    utilityWeights[dim] = rate;
  }

  return {
    version: 1,
    fittedAt: new Date().toISOString(),
    source: "bootstrap_corpus",
    labelCount: 0,
    pairCount: pairs,
    blendWeight: Math.min(0.35, pairs / 300),
    dimensionWeights,
    utilityWeights: normalizeRecord(utilityWeights),
  };
}

export async function readHumanPairwiseLabels(filePath: string): Promise<HumanPairwiseLabel[]> {
  const labels: HumanPairwiseLabel[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      labels.push(JSON.parse(trimmed) as HumanPairwiseLabel);
    } catch {
      // skip malformed lines
    }
  }
  return labels;
}

export function resolveLabelTracks(
  label: HumanPairwiseLabel,
  corpusById: Map<string, PatternScoringTrack[]>,
): { tracksA: PatternScoringTrack[]; tracksB: PatternScoringTrack[] } | null {
  if (label.playlistA_tracks?.length && label.playlistB_tracks?.length) {
    return { tracksA: label.playlistA_tracks, tracksB: label.playlistB_tracks };
  }
  const tracksA = label.playlistA_id ? corpusById.get(label.playlistA_id) : undefined;
  const tracksB = label.playlistB_id ? corpusById.get(label.playlistB_id) : undefined;
  if (!tracksA?.length || !tracksB?.length) return null;
  return { tracksA, tracksB };
}

export function fitPreferenceModelFromHumanLabels(
  labels: HumanPairwiseLabel[],
  corpusById: Map<string, PatternScoringTrack[]>,
): PreferenceModelProfile | null {
  const resolved: Array<{
    winner: "a" | "b" | "tie";
    scoresA: PairwiseDimensionScores;
    scoresB: PairwiseDimensionScores;
  }> = [];

  for (const label of labels) {
    if (label.winner === "tie") continue;
    const tracks = resolveLabelTracks(label, corpusById);
    if (!tracks) continue;
    const baseEval = {
      wouldSaveScore: 0.7,
      humanPatternScore: 0.7,
      gateCuratorScore: 0.7,
      combinedScore: 0.7,
      humanSaveable: true,
      strictMode: false,
      humanPatternBreakdown: {},
      gateRejectionReasons: [] as string[],
    };
    resolved.push({
      winner: label.winner,
      scoresA: extractPairwiseDimensionScoresFromTracks(tracks.tracksA, baseEval),
      scoresB: extractPairwiseDimensionScoresFromTracks(tracks.tracksB, {
        ...baseEval,
        combinedScore: 0.55,
      }),
    });
  }

  if (resolved.length < 3) return null;

  let utilityWeights = normalizeRecord({ ...DEFAULT_UTILITY_WEIGHTS });
  const learningRate = 0.08;
  for (let epoch = 0; epoch < 24; epoch += 1) {
    for (const pair of resolved) {
      let utilityA = 0;
      let utilityB = 0;
      for (const dim of PAIRWISE_DIMENSIONS) {
        utilityA += utilityWeights[dim] * pair.scoresA[dim];
        utilityB += utilityWeights[dim] * pair.scoresB[dim];
      }
      const shouldPreferA = pair.winner === "a";
      const correct = shouldPreferA ? utilityA >= utilityB : utilityB >= utilityA;
      if (correct) continue;
      for (const dim of PAIRWISE_DIMENSIONS) {
        const delta = pair.scoresA[dim] - pair.scoresB[dim];
        utilityWeights[dim] += learningRate * delta * (shouldPreferA ? 1 : -1);
      }
      utilityWeights = normalizeRecord(utilityWeights);
    }
  }

  const dimensionWins = Object.fromEntries(PAIRWISE_DIMENSIONS.map((d) => [d, 0])) as Record<PairwiseDimension, number>;
  const dimensionTotals = { ...dimensionWins };
  for (const pair of resolved) {
    for (const dim of PAIRWISE_DIMENSIONS) {
      dimensionTotals[dim] += 1;
      const pick = pair.winner === "a"
        ? pair.scoresA[dim] >= pair.scoresB[dim] + 0.02
        : pair.scoresB[dim] >= pair.scoresA[dim] + 0.02;
      if (pick) dimensionWins[dim] += 1;
    }
  }

  const dimensionWeights = {} as Record<PairwiseDimension, number>;
  for (const dim of PAIRWISE_DIMENSIONS) {
    const rate = dimensionTotals[dim] > 0 ? dimensionWins[dim]! / dimensionTotals[dim]! : 0.5;
    dimensionWeights[dim] = Math.round((0.9 + rate * 0.8) * 100) / 100;
  }

  const blendWeight = clamp01(resolved.length / 40);

  return {
    version: 1,
    fittedAt: new Date().toISOString(),
    source: "human_labels",
    labelCount: labels.length,
    pairCount: resolved.length,
    blendWeight: Math.max(0.55, blendWeight),
    dimensionWeights,
    utilityWeights,
  };
}

export function mergePreferenceModels(
  bootstrap: PreferenceModelProfile,
  human: PreferenceModelProfile | null,
): PreferenceModelProfile {
  if (!human) return bootstrap;
  const humanShare = clamp01(human.pairCount / 40);
  const dimensionWeights = {} as Record<PairwiseDimension, number>;
  const utilityWeights = {} as Record<PairwiseDimension, number>;
  for (const dim of PAIRWISE_DIMENSIONS) {
    dimensionWeights[dim] =
      bootstrap.dimensionWeights[dim] * (1 - humanShare) +
      human.dimensionWeights[dim] * humanShare;
    utilityWeights[dim] =
      bootstrap.utilityWeights[dim] * (1 - humanShare) +
      human.utilityWeights[dim] * humanShare;
  }
  return {
    version: 1,
    fittedAt: new Date().toISOString(),
    source: human.pairCount >= 3 ? "human_labels" : bootstrap.source,
    labelCount: human.labelCount,
    pairCount: bootstrap.pairCount + human.pairCount,
    blendWeight: Math.max(bootstrap.blendWeight, human.blendWeight),
    dimensionWeights,
    utilityWeights: normalizeRecord(utilityWeights),
  };
}

export function buildCorpusIdIndex(
  playlists: Array<{ id?: string; tracks: PatternScoringTrack[] }>,
): Map<string, PatternScoringTrack[]> {
  const index = new Map<string, PatternScoringTrack[]>();
  for (const playlist of playlists) {
    if (playlist.id) index.set(playlist.id, playlist.tracks);
    index.set(`playlist:${index.size}`, playlist.tracks);
  }
  return index;
}
