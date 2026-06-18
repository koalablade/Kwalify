import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Severity = "critical" | "high" | "medium" | "low";
type CiStatus = "PASS" | "FAIL";

type BenchmarkPromptRow = {
  input: {
    id: string;
    group: string;
    prompt: string;
    requestedLength: number;
  };
  ok: boolean;
  generation: {
    finalTrackCount: number;
  };
  intent: {
    overallSurvivalPercent: number;
  };
  quality: {
    majorGenreLeak: boolean;
    majorEraLeak: boolean;
    confidenceScore: number;
  };
  success: boolean;
  promptReliabilityScore: number;
  failureReasons: string[];
  blockingFailureReasons?: string[];
  advisoryFailureReasons?: string[];
};

type BenchmarkReport = {
  generatedAt: string;
  commit: string;
  run: {
    promptCount: number;
    baseUrl: string;
  };
  summary: {
    promptReliabilityScore: number;
    failureCount?: number;
    blockingFailureCount?: number;
    advisoryFailureCount?: number;
    averageSurvivalPercent?: number;
    averageConfidenceScore?: number;
  };
  prompts: BenchmarkPromptRow[];
};

type RegressionFailure = {
  prompt: string;
  promptId: string;
  metric: string;
  expected: number | string | boolean;
  actual: number | string | boolean | null;
  severity: Severity;
  likelyCollapseStage: string;
};

type PromptRegressionResult = {
  prompt: string;
  promptId: string;
  group: string;
  passed: boolean;
  score: number;
  completion: number;
  confidence: number;
  survival: number;
  subgenreSurvival?: number;
  leaks: number;
  convergenceRisk: string | null;
  recoveryCount: number;
  collapseStage: string;
  failures: RegressionFailure[];
};

type RegressionReport = {
  generatedAt: string;
  currentRun: {
    reportPath: string;
    generatedAt: string;
    commit: string;
    baseUrl: string;
    promptCount: number;
  };
  summary: {
    promptReliabilityRegressionScore: number;
    failedPrompts: number;
    criticalFailures: number;
  };
  topRegressions: PromptRegressionResult[];
  mostUnstablePrompts: PromptRegressionResult[];
  prompts: PromptRegressionResult[];
  failures: RegressionFailure[];
};

type BaselinePrompt = {
  promptId: string;
  prompt: string;
  completion: number;
  survival: number;
  confidence: number;
};

type AcceptedGoodRun = {
  acceptedAt: string;
  commit: string;
  benchmarkReportPath: string;
  regressionReportPath: string;
  promptReliabilityScore: number;
  regressionScore: number;
  prompts: BaselinePrompt[];
};

type BaselineFile = {
  schemaVersion: number;
  acceptedGoodRun: AcceptedGoodRun | null;
};

type Config = {
  benchmarkPath: string;
  regressionPath: string;
  baselinePath: string;
  outDir: string;
  localFixture: boolean;
};

type DriftItem = {
  metric: "completion" | "survival" | "confidence";
  current: number;
  baseline: number;
  delta: number;
  warning: boolean;
};

type PromptDriftItem = {
  promptId: string;
  prompt: string;
  metric: "completion" | "survival" | "confidence";
  current: number;
  baseline: number;
  delta: number;
};

type CiGateReport = {
  generatedAt: string;
  status: CiStatus;
  passed: boolean;
  inputs: {
    benchmarkReportPath: string;
    regressionReportPath: string;
    baselinePath: string;
  };
  thresholds: {
    minPromptReliabilityScore: number;
    minRegressionScore: number;
    maxBenchmarkFailureRate: number;
    maxAllowedMajorGenreLeaks: number;
    maxAllowedMajorEraLeaks: number;
    maxAllowedCriticalRegressions: number;
    softDriftWarningThreshold: number;
  };
  current: {
    commit: string;
    promptReliabilityScore: number;
    regressionScore: number;
    benchmarkPromptCount: number;
    benchmarkFailedPrompts: number;
    benchmarkBlockingFailedPrompts: number;
    benchmarkAdvisoryPromptWarnings: number;
    benchmarkFailureRate: number;
    benchmarkBlockingFailureRate: number;
    majorGenreLeakCount: number;
    majorEraLeakCount: number;
    criticalRegressionCount: number;
    completion: number;
    survival: number;
    confidence: number;
  };
  baseline: {
    configured: boolean;
    acceptedAt: string | null;
    commit: string | null;
    promptReliabilityScore: number | null;
    regressionScore: number | null;
    completion: number | null;
    survival: number | null;
    confidence: number | null;
  };
  blockingReasons: string[];
  softRegressionWarnings: string[];
  driftSummary: {
    baselineDriftAcceptable: boolean;
    global: DriftItem[];
    promptLevel: PromptDriftItem[];
  };
  worstPromptRegressions: PromptRegressionResult[];
  topUnstablePrompts: PromptRegressionResult[];
};

const DEFAULT_BENCHMARK = "reports/prompt-reliability/latest/prompt-reliability-report.json";
const DEFAULT_REGRESSION = "reports/prompt-reliability/regression-latest/regression-report.json";
const DEFAULT_BASELINE = "backend/lib/playlist-evaluation/prompt-reliability-baseline.json";
const DEFAULT_OUT = "reports/prompt-reliability/ci-gate-latest";

const MIN_PROMPT_RELIABILITY_SCORE = 70;
const MIN_PROMPT_RELIABILITY_SCORE_LOCAL = 62;
const MIN_OVERALL_INTENT_SURVIVAL = 55;
const MIN_EMOTION_SURVIVAL = 50;
const MIN_SUBGENRE_SURVIVAL = 45;
const MIN_REGRESSION_SCORE = 80;
const MIN_REGRESSION_SCORE_LOCAL = 62;
const MAX_BENCHMARK_FAILURE_RATE = 20;
const MAX_BENCHMARK_FAILURE_RATE_LOCAL = 45;
const SOFT_DRIFT_WARNING_THRESHOLD = -5;

function usage(): never {
  console.error([
    "Usage:",
    "  npm run ci:prompt-reliability -- --benchmark reports/prompt-reliability/latest/prompt-reliability-report.json --regression reports/prompt-reliability/regression-latest/regression-report.json",
    "",
    "Options:",
    "  --benchmark FILE   Prompt reliability benchmark JSON report",
    "  --regression FILE  Prompt reliability regression JSON report",
    "  --baseline FILE    Accepted-good baseline JSON file",
    "  --out DIR          Output directory for CI gate reports",
  ].join("\n"));
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function parseConfig(args: string[]): Config {
  if (args.includes("--help") || args.includes("-h")) usage();
  return {
    benchmarkPath: argValue(args, "--benchmark") ?? process.env["PROMPT_RELIABILITY_BENCHMARK"] ?? DEFAULT_BENCHMARK,
    regressionPath: argValue(args, "--regression") ?? process.env["PROMPT_RELIABILITY_REGRESSION"] ?? DEFAULT_REGRESSION,
    baselinePath: argValue(args, "--baseline") ?? process.env["PROMPT_RELIABILITY_BASELINE"] ?? DEFAULT_BASELINE,
    outDir: argValue(args, "--out") ?? process.env["PROMPT_RELIABILITY_CI_OUT"] ?? DEFAULT_OUT,
    localFixture: args.includes("--local-fixture") || process.env["PROMPT_RELIABILITY_LOCAL"] === "1",
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function benchmarkCompletion(row: BenchmarkPromptRow): number {
  return row.input.requestedLength > 0
    ? round((row.generation.finalTrackCount / row.input.requestedLength) * 100)
    : 0;
}

function currentCompletion(benchmark: BenchmarkReport, regression: RegressionReport): number {
  if (regression.prompts.length > 0) {
    return average(regression.prompts.map((prompt) => prompt.completion));
  }
  return average(benchmark.prompts.map(benchmarkCompletion));
}

function currentSurvival(benchmark: BenchmarkReport, regression: RegressionReport): number {
  if (regression.prompts.length > 0) {
    return average(regression.prompts.map((prompt) => prompt.survival));
  }
  return round(benchmark.summary.averageSurvivalPercent ?? average(benchmark.prompts.map((prompt) => prompt.intent.overallSurvivalPercent)));
}

function currentConfidence(benchmark: BenchmarkReport, regression: RegressionReport): number {
  if (regression.prompts.length > 0) {
    return average(regression.prompts.map((prompt) => prompt.confidence));
  }
  return round(benchmark.summary.averageConfidenceScore ?? average(benchmark.prompts.map((prompt) => prompt.quality.confidenceScore)));
}

function baselineAverage(baseline: AcceptedGoodRun, metric: keyof Pick<BaselinePrompt, "completion" | "survival" | "confidence">): number {
  return average(baseline.prompts.map((prompt) => prompt[metric]));
}

function buildGlobalDrift(
  baseline: AcceptedGoodRun,
  completion: number,
  survival: number,
  confidence: number,
): DriftItem[] {
  const rows: DriftItem[] = [
    { metric: "completion", current: completion, baseline: baselineAverage(baseline, "completion"), delta: 0, warning: false },
    { metric: "survival", current: survival, baseline: baselineAverage(baseline, "survival"), delta: 0, warning: false },
    { metric: "confidence", current: confidence, baseline: baselineAverage(baseline, "confidence"), delta: 0, warning: false },
  ];

  return rows.map((row) => {
    const delta = round(row.current - row.baseline);
    return {
      ...row,
      delta,
      warning: delta < SOFT_DRIFT_WARNING_THRESHOLD,
    };
  });
}

function buildPromptDrift(baseline: AcceptedGoodRun, regression: RegressionReport): PromptDriftItem[] {
  const currentById = new Map(regression.prompts.map((prompt) => [prompt.promptId, prompt]));
  const rows: PromptDriftItem[] = [];

  for (const prompt of baseline.prompts) {
    const current = currentById.get(prompt.promptId);
    if (!current) continue;

    const metrics: Array<"completion" | "survival" | "confidence"> = ["completion", "survival", "confidence"];
    for (const metric of metrics) {
      const delta = round(current[metric] - prompt[metric]);
      if (delta < SOFT_DRIFT_WARNING_THRESHOLD) {
        rows.push({
          promptId: prompt.promptId,
          prompt: prompt.prompt,
          metric,
          current: current[metric],
          baseline: prompt[metric],
          delta,
        });
      }
    }
  }

  return rows.sort((a, b) => a.delta - b.delta).slice(0, 10);
}

function severityWeight(failure: RegressionFailure): number {
  switch (failure.severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function worstPromptRegressions(regression: RegressionReport): PromptRegressionResult[] {
  const source = regression.topRegressions.length > 0
    ? regression.topRegressions
    : [...regression.prompts].sort((a, b) => {
      const bSeverity = b.failures.reduce((sum, failure) => sum + severityWeight(failure), 0);
      const aSeverity = a.failures.reduce((sum, failure) => sum + severityWeight(failure), 0);
      return bSeverity - aSeverity || a.score - b.score;
    });

  return source.slice(0, 10);
}

function unstablePrompts(regression: RegressionReport): PromptRegressionResult[] {
  const source = regression.mostUnstablePrompts.length > 0
    ? regression.mostUnstablePrompts
    : [...regression.prompts].sort((a, b) => {
      const aInstability = (a.passed ? 0 : 20) + (100 - a.score) + a.leaks * 5;
      const bInstability = (b.passed ? 0 : 20) + (100 - b.score) + b.leaks * 5;
      return bInstability - aInstability;
    });

  return source.slice(0, 10);
}

function summarizePrompt(prompt: PromptRegressionResult): string {
  const failureSummary = prompt.failures
    .slice(0, 2)
    .map((failure) => `${failure.metric} ${failure.actual} < ${failure.expected}`)
    .join("; ");
  return `${prompt.prompt} (${prompt.score})${failureSummary ? ` - ${failureSummary}` : ""}`;
}

function buildReport(
  config: Config,
  benchmark: BenchmarkReport,
  regression: RegressionReport,
  baselineFile: BaselineFile,
): CiGateReport {
  const local = config.localFixture;
  const minReliability = local ? MIN_PROMPT_RELIABILITY_SCORE_LOCAL : MIN_PROMPT_RELIABILITY_SCORE;
  const minRegression = local ? MIN_REGRESSION_SCORE_LOCAL : MIN_REGRESSION_SCORE;
  const maxFailureRate = local ? MAX_BENCHMARK_FAILURE_RATE_LOCAL : MAX_BENCHMARK_FAILURE_RATE;
  const promptReliabilityScore = round(benchmark.summary.promptReliabilityScore);
  const regressionScore = round(regression.summary.promptReliabilityRegressionScore);
  const benchmarkPromptCount = benchmark.run.promptCount || benchmark.prompts.length;
  const benchmarkFailedPrompts = benchmark.summary.failureCount ?? benchmark.prompts.filter((prompt) => !prompt.success).length;
  const benchmarkBlockingFailedPrompts = benchmark.summary.blockingFailureCount ??
    benchmark.prompts.filter((prompt) => (prompt.blockingFailureReasons ?? prompt.failureReasons).length > 0).length;
  const benchmarkAdvisoryPromptWarnings = benchmark.summary.advisoryFailureCount ??
    benchmark.prompts.filter((prompt) => (prompt.advisoryFailureReasons ?? []).length > 0).length;
  const benchmarkFailureRate = benchmarkPromptCount > 0 ? round((benchmarkFailedPrompts / benchmarkPromptCount) * 100) : 100;
  const benchmarkBlockingFailureRate = benchmarkPromptCount > 0 ? round((benchmarkBlockingFailedPrompts / benchmarkPromptCount) * 100) : 100;
  const majorGenreLeakCount = benchmark.prompts.filter((prompt) => prompt.quality.majorGenreLeak).length;
  const majorEraLeakCount = benchmark.prompts.filter((prompt) => prompt.quality.majorEraLeak).length;
  const criticalRegressionCount = Math.max(
    regression.summary.criticalFailures,
    regression.failures.filter((failure) => failure.severity === "critical").length,
  );
  const completion = currentCompletion(benchmark, regression);
  const survival = currentSurvival(benchmark, regression);
  const confidence = currentConfidence(benchmark, regression);
  const baseline = baselineFile.acceptedGoodRun;
  const blockingReasons: string[] = [];

  if (promptReliabilityScore < minReliability) {
    blockingReasons.push(`Prompt Reliability Score ${promptReliabilityScore} is below ${minReliability}.`);
  }
  if (regressionScore < minRegression) {
    blockingReasons.push(`Regression Score ${regressionScore} is below ${minRegression}.`);
  }
  if (majorGenreLeakCount > 0) {
    blockingReasons.push(`${majorGenreLeakCount} prompt(s) have a major genre leak.`);
  }
  if (majorEraLeakCount > 0) {
    blockingReasons.push(`${majorEraLeakCount} prompt(s) have a major era leak.`);
  }
  if (benchmarkBlockingFailureRate > maxFailureRate) {
    blockingReasons.push(`Benchmark blocking failure rate ${benchmarkBlockingFailureRate}% is above ${maxFailureRate}%.`);
  }
  if (criticalRegressionCount > 0) {
    blockingReasons.push(`${criticalRegressionCount} critical regression(s) detected.`);
  }
  if (!baseline && !local) {
    blockingReasons.push("Accepted-good prompt reliability baseline is not configured.");
  }
  if (survival < MIN_OVERALL_INTENT_SURVIVAL) {
    blockingReasons.push(`Overall intent survival ${survival}% is below ${MIN_OVERALL_INTENT_SURVIVAL}%.`);
  }
  const subgenreSurvivalAvg = regression.prompts.length
    ? average(regression.prompts.map((p) => p.subgenreSurvival ?? p.survival))
    : survival;
  if (subgenreSurvivalAvg < MIN_SUBGENRE_SURVIVAL) {
    blockingReasons.push(`Subgenre survival ${subgenreSurvivalAvg}% is below ${MIN_SUBGENRE_SURVIVAL}%.`);
  }
  const emotionSurvivalAvg = regression.prompts.length
    ? average(regression.prompts.map((p) => p.survival))
    : survival;
  if (emotionSurvivalAvg < MIN_EMOTION_SURVIVAL) {
    blockingReasons.push(`Emotion/subgenre survival proxy ${emotionSurvivalAvg}% is below ${MIN_EMOTION_SURVIVAL}%.`);
  }
  const highConvergence = regression.prompts.filter((p) => p.convergenceRisk === "high" || p.convergenceRisk === "critical").length;
  if (highConvergence > Math.ceil(regression.prompts.length * 0.25)) {
    blockingReasons.push(`${highConvergence} prompt(s) exceed convergence risk threshold.`);
  }

  const globalDrift = baseline ? buildGlobalDrift(baseline, completion, survival, confidence) : [];
  const promptLevelDrift = baseline ? buildPromptDrift(baseline, regression) : [];
  const softRegressionWarnings = [
    ...globalDrift
      .filter((item) => item.warning)
      .map((item) => `${item.metric} dropped ${Math.abs(item.delta)} points vs baseline (${item.baseline} -> ${item.current}).`),
    ...promptLevelDrift
      .slice(0, 5)
      .map((item) => `${item.prompt} ${item.metric} dropped ${Math.abs(item.delta)} points vs baseline (${item.baseline} -> ${item.current}).`),
  ];
  const baselineDriftAcceptable = local || (Boolean(baseline) && softRegressionWarnings.length === 0);
  const status: CiStatus = blockingReasons.length === 0 ? "PASS" : "FAIL";

  return {
    generatedAt: new Date().toISOString(),
    status,
    passed: status === "PASS",
    inputs: {
      benchmarkReportPath: config.benchmarkPath,
      regressionReportPath: config.regressionPath,
      baselinePath: config.baselinePath,
    },
    thresholds: {
      minPromptReliabilityScore: MIN_PROMPT_RELIABILITY_SCORE,
      minRegressionScore: MIN_REGRESSION_SCORE,
      maxBenchmarkFailureRate: MAX_BENCHMARK_FAILURE_RATE,
      maxAllowedMajorGenreLeaks: 0,
      maxAllowedMajorEraLeaks: 0,
      maxAllowedCriticalRegressions: 0,
      softDriftWarningThreshold: Math.abs(SOFT_DRIFT_WARNING_THRESHOLD),
    },
    current: {
      commit: benchmark.commit,
      promptReliabilityScore,
      regressionScore,
      benchmarkPromptCount,
      benchmarkFailedPrompts,
      benchmarkBlockingFailedPrompts,
      benchmarkAdvisoryPromptWarnings,
      benchmarkFailureRate,
      benchmarkBlockingFailureRate,
      majorGenreLeakCount,
      majorEraLeakCount,
      criticalRegressionCount,
      completion,
      survival,
      confidence,
    },
    baseline: {
      configured: Boolean(baseline),
      acceptedAt: baseline?.acceptedAt ?? null,
      commit: baseline?.commit ?? null,
      promptReliabilityScore: baseline?.promptReliabilityScore ?? null,
      regressionScore: baseline?.regressionScore ?? null,
      completion: baseline ? baselineAverage(baseline, "completion") : null,
      survival: baseline ? baselineAverage(baseline, "survival") : null,
      confidence: baseline ? baselineAverage(baseline, "confidence") : null,
    },
    blockingReasons,
    softRegressionWarnings,
    driftSummary: {
      baselineDriftAcceptable,
      global: globalDrift,
      promptLevel: promptLevelDrift,
    },
    worstPromptRegressions: worstPromptRegressions(regression),
    topUnstablePrompts: unstablePrompts(regression),
  };
}

function markdownReport(report: CiGateReport): string {
  const blocking = report.blockingReasons.length > 0
    ? report.blockingReasons.map((reason) => `- ${reason}`).join("\n")
    : "- None";
  const warnings = report.softRegressionWarnings.length > 0
    ? report.softRegressionWarnings.map((warning) => `- ${warning}`).join("\n")
    : "- None";
  const drift = report.driftSummary.global.length > 0
    ? report.driftSummary.global.map((item) => `- ${item.metric}: current ${item.current}, baseline ${item.baseline}, delta ${item.delta}`).join("\n")
    : "- Baseline unavailable.";
  const worst = report.worstPromptRegressions.length > 0
    ? report.worstPromptRegressions.slice(0, 10).map((prompt) => `- ${summarizePrompt(prompt)}`).join("\n")
    : "- None";
  const unstable = report.topUnstablePrompts.length > 0
    ? report.topUnstablePrompts.slice(0, 10).map((prompt) => `- ${summarizePrompt(prompt)}`).join("\n")
    : "- None";

  return [
    "# Prompt Reliability CI Gate",
    "",
    `**Status:** ${report.status}`,
    `**Generated:** ${report.generatedAt}`,
    `**Commit:** ${report.current.commit}`,
    "",
    "## Current Scores",
    "",
    `- Prompt Reliability Score: ${report.current.promptReliabilityScore}`,
    `- Regression Score: ${report.current.regressionScore}`,
    `- Benchmark failures: ${report.current.benchmarkFailedPrompts}/${report.current.benchmarkPromptCount} (${report.current.benchmarkFailureRate}%)`,
    `- Blocking benchmark failures: ${report.current.benchmarkBlockingFailedPrompts}/${report.current.benchmarkPromptCount} (${report.current.benchmarkBlockingFailureRate}%)`,
    `- Advisory benchmark warnings: ${report.current.benchmarkAdvisoryPromptWarnings}`,
    `- Major genre leaks: ${report.current.majorGenreLeakCount}`,
    `- Major era leaks: ${report.current.majorEraLeakCount}`,
    `- Critical regressions: ${report.current.criticalRegressionCount}`,
    "",
    "## Blocking Reasons",
    "",
    blocking,
    "",
    "## Drift Summary",
    "",
    `Baseline drift acceptable: ${report.driftSummary.baselineDriftAcceptable ? "yes" : "no"}`,
    "",
    drift,
    "",
    "## Soft Regression Warnings",
    "",
    warnings,
    "",
    "## Worst Prompt Regressions",
    "",
    worst,
    "",
    "## Top Unstable Prompts",
    "",
    unstable,
    "",
  ].join("\n");
}

function printStatusSummary(report: CiGateReport): void {
  const topBlockingIssues = report.blockingReasons.slice(0, 3);
  const lines = ["", "CI STATUS SUMMARY", report.status, "Top 3 blocking issues:"];
  if (topBlockingIssues.length === 0) {
    lines.push("- None");
  } else {
    for (const issue of topBlockingIssues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push(`Baseline drift acceptable: ${report.driftSummary.baselineDriftAcceptable ? "yes" : "no"}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function writeReports(config: Config, report: CiGateReport): Promise<void> {
  await mkdir(config.outDir, { recursive: true });
  await writeFile(path.join(config.outDir, "ci-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(config.outDir, "ci-gate-report.md"), markdownReport(report));
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const requireReports = process.argv.includes("--require-reports") || process.env["CI"] === "true";
  for (const filePath of [config.benchmarkPath, config.regressionPath, config.baselinePath]) {
    try {
      await access(filePath);
    } catch {
      if (requireReports) {
        console.error(`Prompt reliability reports required but missing: ${filePath}`);
        process.exit(1);
      }
      console.log(`Prompt reliability reports not found (${filePath}) — skipping CI gate.`);
      process.exit(0);
    }
  }
  const [benchmark, regression, baseline] = await Promise.all([
    readJson<BenchmarkReport>(config.benchmarkPath),
    readJson<RegressionReport>(config.regressionPath),
    readJson<BaselineFile>(config.baselinePath),
  ]);

  const report = buildReport(config, benchmark, regression, baseline);
  await writeReports(config, report);
  printStatusSummary(report);

  if (!report.passed) {
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Prompt reliability CI gate failed to run: ${message}`);
  process.exit(2);
});
