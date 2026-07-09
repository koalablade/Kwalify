/**
 * Playlist quality benchmark — shared types for evaluation infrastructure only.
 */

import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import type { PlaylistReplaySimulation } from "./replay-simulator/types";

export type HallOfFameCategory =
  | "easy_mood"
  | "functional"
  | "hard_activity"
  | "emotional_specific";

export type HallOfFameDifficulty = "easy" | "medium" | "hard";

export type HallOfFameEntry = {
  id: string;
  prompt: string;
  category: HallOfFameCategory;
  expectedIntent: string;
  difficulty: HallOfFameDifficulty;
  source: string;
  notes: string;
  qualityScore: number;
  referenceId?: string;
  libraryDependency?: LibraryDependency;
};

export type LibraryDependency = "low" | "medium" | "high";

export type PromptSuiteSplit = "training" | "validation" | "stress";

export type PromptSuiteEntry = HallOfFameEntry & {
  suite: PromptSuiteSplit;
  libraryDependency: LibraryDependency;
};

export type PromptSuiteManifest = {
  promptSuiteVersion: string;
  datasetVersion: string;
  splits: Record<
    PromptSuiteSplit,
    {
      file: string;
      purpose: string;
      tuningAllowed: boolean;
    }
  >;
  libraryDependency: Record<string, LibraryDependency>;
};

export type NegativeExampleCategory = "gym" | "focus" | "party";

export type NegativeExample = {
  id: string;
  category: NegativeExampleCategory;
  failureType: string;
  prompt: string;
  description: string;
  tracks: PatternScoringTrack[];
};

export type BlindPairside = "human" | "kwalify" | "tie";

export type BlindPairwiseDimensions = {
  openingQuality: BlindPairside;
  activityFit: BlindPairside;
  emotionalFit: BlindPairside;
  replayLikelihood: BlindPairside;
  saveLikelihood: BlindPairside;
};

export type BlindPairwiseResult = {
  winner: BlindPairside;
  confidence: number;
  reasons: string[];
  dimensions: BlindPairwiseDimensions;
  blindSeed: number;
  humanWouldSave: number;
  kwalifyWouldSave: number;
};

export type OpeningFiveEvaluation = {
  score: number;
  pass: boolean;
  identityImmediate: number;
  continueListening: number;
  firstTrackAppropriate: number;
  sceneEstablished: number;
  weightedScore: number;
  issues: string[];
  openerText: string;
};

export type NegativeDetectionResult = {
  detected: boolean;
  matchedExamples: string[];
  failureTypes: string[];
  similarityScore: number;
};

export type FirstAttemptOutcome = "saved" | "regenerated" | "abandoned" | "library_insufficient";

export type FirstAttemptRecord = {
  promptId: string;
  prompt: string;
  category: HallOfFameCategory;
  difficulty: HallOfFameDifficulty;
  outcome: FirstAttemptOutcome;
  attempts: number;
  firstGenerationSuccess: boolean;
};

export type PromptBenchmarkResult = {
  entryId: string;
  prompt: string;
  category: HallOfFameCategory;
  difficulty: HallOfFameDifficulty;
  suite: PromptSuiteSplit;
  libraryDependency: LibraryDependency;
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  trackCount: number;
  blindPairwise: BlindPairwiseResult | null;
  openingFive: OpeningFiveEvaluation | null;
  negativeDetection: NegativeDetectionResult;
  firstAttempt: FirstAttemptRecord;
  saveLikelihood: number | null;
  replaySimulation: PlaylistReplaySimulation | null;
};

export type CategoryMetrics = {
  count: number;
  humanPreferenceWinRate: number | null;
  openingPassRate: number | null;
  firstAttemptSuccessRate: number | null;
  avgSaveLikelihood: number | null;
  negativeFailureRate: number | null;
  avgReplayProxyScore: number | null;
  avgSkipRiskScore: number | null;
  avgSaveProxyScore: number | null;
};

export type QualityBenchmarkMetrics = {
  humanPreferenceWinRate: number | null;
  humanPreferenceTieRate: number | null;
  openingPassRate: number | null;
  activityAccuracy: number | null;
  avgSaveLikelihood: number | null;
  firstAttemptSuccessRate: number | null;
  regenerationRate: number | null;
  abandonmentRate: number | null;
  libraryInsufficientRate: number | null;
  negativeObviousFailureRate: number | null;
  goldenPromptsPassed: number;
  goldenPromptsFailed: number;
  hrpsAvgImprovement: number | null;
  avgReplayProxyScore: number | null;
  avgSkipRiskScore: number | null;
  avgSaveProxyScore: number | null;
  avgContinueListeningScore: number | null;
  byCategory: Record<HallOfFameCategory, CategoryMetrics>;
  byLibraryDependency: Record<LibraryDependency, CategoryMetrics>;
};

export type ExperimentRecommendation = "SHIP" | "HOLD" | "REJECT";

export type MetricDelta = {
  metric: keyof QualityBenchmarkMetrics | string;
  label: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  deltaPp: number | null;
  category?: HallOfFameCategory;
  direction: "improved" | "regressed" | "flat";
};

export type ExperimentComparison = {
  baselineDescription: string | null;
  baselineGeneratedAt: string | null;
  deltas: Partial<Record<keyof QualityBenchmarkMetrics, number | null>>;
  improvements: MetricDelta[];
  regressions: MetricDelta[];
  hardActivityRegressed: boolean;
  regressionPassed: boolean;
  regressionFlags: string[];
};

export type ExperimentMetadata = {
  id: string;
  name: string;
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
  appVersion: string | null;
  runAt: string;
  mode: "offline" | "live";
  configurationFlags: Record<string, string | boolean | number>;
  promptSuiteVersion: string;
  datasetVersion: string;
  suite: PromptSuiteSplit | "all";
};

export type SuiteExperimentResult = {
  suite: PromptSuiteSplit;
  tuningAllowed: boolean;
  metrics: QualityBenchmarkMetrics;
  comparison: ExperimentComparison;
  recommendation: ExperimentRecommendation;
  results: PromptBenchmarkResult[];
};

export type ExperimentRecord = {
  metadata: ExperimentMetadata;
  suites: SuiteExperimentResult[];
  overallRecommendation: ExperimentRecommendation;
  reportMarkdown: string;
};

export type QualityBenchmarkBaseline = {
  version: number;
  generatedAt: string;
  description: string;
  metrics: QualityBenchmarkMetrics;
};

export type RegressionGateResult = {
  passed: boolean;
  flags: string[];
  current: QualityBenchmarkMetrics;
  baseline: QualityBenchmarkMetrics | null;
  deltas: Partial<Record<keyof QualityBenchmarkMetrics, number | null>>;
};

export type QualityBenchmarkReport = {
  generatedAt: string;
  mode: "offline" | "live";
  results: PromptBenchmarkResult[];
  metrics: QualityBenchmarkMetrics;
  regression: RegressionGateResult;
};
