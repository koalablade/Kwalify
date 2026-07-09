/**
 * Opening Curator v2 human-retention benchmark — evaluation types only.
 */

import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import type { BlindPairwiseResult, OpeningFiveEvaluation } from "../playlist-quality-benchmark/types";
import type { PlaylistReplaySimulation } from "../playlist-quality-benchmark/replay-simulator/types";

export type OpeningCuratorV2BenchmarkCategory =
  | "easy_mood"
  | "emotional_specific"
  | "functional"
  | "library_gravity"
  | "human_curator"
  | "adversarial";

export type ExpectedBand = "pass" | "mixed" | "hard" | "very_hard" | "fail";

export type FailureCause =
  | "retrieval"
  | "scoring"
  | "sequencing"
  | "library"
  | "prompt_understanding"
  | "generation_failure"
  | "none";

export type OpeningCuratorV2Prompt = {
  id: string;
  prompt: string;
  category: OpeningCuratorV2BenchmarkCategory;
  expectedBand: ExpectedBand;
  difficulty: "easy" | "medium" | "hard";
  referenceId?: string | null;
  offlineSimulatedPlaylist?: string;
  libraryProfile?: {
    dominantGenres: string[];
    notes: string;
  };
  expectedIntent: string;
};

export type OpeningCuratorDiagnostics = {
  openerTrackId?: string | null;
  openingReason?: string | null;
  identityStrength?: number | null;
  continuityScore?: number | null;
  swaps?: number | null;
  rejectedOpeningCandidates?: string[];
  openingLockApplied?: boolean;
  openingFinalOrderPreserved?: boolean;
  openingLockViolations?: Array<{ trackId: string; reason: string; action: string }>;
};

export type RetrievalDiagnostics = {
  strategy?: string | null;
  librarySufficient?: boolean | null;
  combinedConfidence?: number | null;
  libraryCapability?: string | null;
  suggestDiscoveryMode?: boolean;
};

export type OpeningTrackSummary = {
  position: number;
  trackId: string;
  artistName: string;
  trackName: string;
  energy: number | null;
  genreFamily: string | null;
};

export type OpeningCuratorV2PromptAnalysis = {
  whySummary: string;
  strengths: string[];
  weaknesses: string[];
  openingIssues: string[];
  failureCause: FailureCause;
  failureCauseDetail: string;
};

export type OpeningCuratorV2PromptResult = {
  id: string;
  prompt: string;
  category: OpeningCuratorV2BenchmarkCategory;
  expectedBand: ExpectedBand;
  difficulty: "easy" | "medium" | "hard";
  mode: "live" | "offline_reference" | "offline_negative_sim";
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  firstFive: OpeningTrackSummary[];
  openingPass: boolean;
  feelsHumanFirstFive: boolean;
  openingFive: OpeningFiveEvaluation | null;
  replaySimulation: PlaylistReplaySimulation | null;
  blindPairwise: BlindPairwiseResult | null;
  humanPreferenceProxy: "human" | "kwalify" | "tie" | null;
  openingCurator: OpeningCuratorDiagnostics | null;
  retrieval: RetrievalDiagnostics | null;
  analysis: OpeningCuratorV2PromptAnalysis;
};

export type CategoryRollup = {
  count: number;
  feelsHumanRate: number | null;
  openingPassRate: number | null;
  avgReplayProxy: number | null;
  avgSkipRisk: number | null;
  avgSaveProxy: number | null;
  humanPreferenceWinRate: number | null;
  topFailureCauses: FailureCause[];
};

export type OpeningCuratorV2BenchmarkReport = {
  generatedAt: string;
  mode: "live" | "offline";
  promptCount: number;
  feelsHumanFirstFiveRate: number | null;
  openingPassRate: number | null;
  avgReplayProxyScore: number | null;
  avgSkipRiskScore: number | null;
  avgSaveProxyScore: number | null;
  humanPreferenceWinRate: number | null;
  byCategory: Record<OpeningCuratorV2BenchmarkCategory, CategoryRollup>;
  failureCauseCounts: Record<FailureCause, number>;
  rankedWeaknesses: string[];
  topRoiFixes: string[];
  results: OpeningCuratorV2PromptResult[];
  markdown: string;
};

export type LiveGenerationPayload = {
  entryId: string;
  success: boolean;
  libraryInsufficient: boolean;
  tracks: PatternScoringTrack[];
  audit?: Record<string, unknown>;
};
