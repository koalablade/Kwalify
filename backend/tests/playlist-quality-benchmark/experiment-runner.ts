/**
 * Experiment runner — benchmark + compare + persist each improvement as an experiment.
 */

import { aggregateBenchmarkMetrics } from "./metrics-aggregator";
import {
  compareExperimentMetrics,
  decideExperimentRecommendation,
  decideOverallRecommendation,
} from "./experiment-comparator";
import { buildExperimentMetadata, parseConfigurationFlags } from "./experiment-metadata";
import { formatExperimentMarkdown } from "./experiment-report";
import { saveExperimentRecord } from "./experiment-tracker";
import {
  isTuningAllowed,
  listPromptSuiteSplits,
  loadPromptSuiteEntries,
} from "./prompt-suite-loader";
import { loadQualityBaseline } from "./regression-gate";
import type {
  ExperimentRecord,
  PromptSuiteSplit,
  SuiteExperimentResult,
} from "./types";
import {
  evaluateSuiteOffline,
  mergeLiveGenerationsForSuite,
  runQualityBenchmarkReport,
  type LiveGenerationResult,
} from "./quality-benchmark-runner";
import { runGoldenPromptTests } from "../golden-prompts.test";

export type RunExperimentOptions = {
  name: string;
  mode?: "offline" | "live";
  suites?: PromptSuiteSplit[] | "all";
  liveResultsBySuite?: Partial<Record<PromptSuiteSplit, LiveGenerationResult[]>>;
  configurationFlags?: Record<string, string | boolean | number>;
  hrpsAvgImprovement?: number | null;
  argv?: string[];
  persist?: boolean;
};

function resolveSuites(suites?: PromptSuiteSplit[] | "all"): PromptSuiteSplit[] {
  if (!suites || suites === "all") return listPromptSuiteSplits();
  return suites;
}

export function runSuiteExperiment(opts: {
  suite: PromptSuiteSplit;
  mode: "offline" | "live";
  liveResults?: LiveGenerationResult[];
  hrpsAvgImprovement?: number | null;
}): SuiteExperimentResult {
  const golden = runGoldenPromptTests();
  const results = opts.mode === "live" && opts.liveResults
    ? mergeLiveGenerationsForSuite(opts.suite, opts.liveResults)
    : evaluateSuiteOffline(opts.suite);

  const metrics = aggregateBenchmarkMetrics(
    results,
    { passed: golden.passed, failed: golden.failed },
    opts.hrpsAvgImprovement ?? null,
  );

  const baseline = loadQualityBaseline();
  const comparison = compareExperimentMetrics(metrics, baseline);
  const recommendation = decideExperimentRecommendation(comparison);

  return {
    suite: opts.suite,
    tuningAllowed: isTuningAllowed(opts.suite),
    metrics,
    comparison,
    recommendation,
    results,
  };
}

export function runPlaylistQualityExperiment(opts: RunExperimentOptions): ExperimentRecord {
  const mode = opts.mode ?? "offline";
  const suites = resolveSuites(opts.suites);
  const configurationFlags = opts.configurationFlags ?? parseConfigurationFlags(opts.argv ?? []);

  const metadata = buildExperimentMetadata({
    name: opts.name,
    mode,
    suite: suites.length === listPromptSuiteSplits().length ? "all" : suites[0]!,
    configurationFlags,
  });

  const suiteResults = suites.map((suite) =>
    runSuiteExperiment({
      suite,
      mode,
      liveResults: opts.liveResultsBySuite?.[suite],
      hrpsAvgImprovement: opts.hrpsAvgImprovement ?? null,
    }),
  );

  const overallRecommendation = decideOverallRecommendation(
    suiteResults.map((row) => ({
      suite: row.suite,
      recommendation: row.recommendation,
      tuningAllowed: row.tuningAllowed,
    })),
  );

  const record: ExperimentRecord = {
    metadata: {
      ...metadata,
      suite: suites.length === listPromptSuiteSplits().length ? "all" : suites[0]!,
    },
    suites: suiteResults,
    overallRecommendation,
    reportMarkdown: "",
  };

  record.reportMarkdown = formatExperimentMarkdown(record);

  if (opts.persist !== false) {
    saveExperimentRecord(record);
  }

  return record;
}

/** Backward-compatible single-suite benchmark report (training default). */
export function runTrainingQualityBenchmarkReport(
  opts?: Parameters<typeof runQualityBenchmarkReport>[0],
) {
  return runQualityBenchmarkReport(opts);
}

export function loadPromptSuiteForLive(suite: PromptSuiteSplit = "training") {
  return loadPromptSuiteEntries(suite);
}
