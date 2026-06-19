import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Severity = "critical" | "high" | "medium" | "low";
type ConvergenceRisk = "low" | "medium" | "high" | "critical";

type GoldenPromptAssertion = {
  minTrackCount: number;
  minCompletion: number;
  minConfidence: number;
  minSurvival: number;
  maxLeaks: number;
  maxConvergenceRisk: ConvergenceRisk;
  minEmotionSurvival?: number;
  minSubgenreSurvival?: number;
  maxGenreDrift?: number;
  maxEraDrift?: number;
  maxRecoveryCount?: number;
};

type GoldenPromptSpec = Record<string, GoldenPromptAssertion>;

type BenchmarkPromptRow = {
  input: {
    id: string;
    group: string;
    prompt: string;
    mode: string;
    requestedLength: number;
  };
  ok: boolean;
  status: number | null;
  error: string | null;
  retrieval: {
    retrievalCount: number | null;
    structuredRetrievalCount: number | null;
    fallbackLevelUsed: string | null;
    firstCollapseReason: string | null;
  };
  intent: {
    contractSurvivalPercent: number;
    emotionSurvivalPercent: number;
    subgenreSurvivalPercent: number;
    overallSurvivalPercent: number;
  };
  generation: {
    finalTrackCount: number;
    repairCount: number;
    recoveryCount: number;
  };
  finalization: {
    finalizationSurvivalPercent: number;
    eraRelaxationUsed: boolean;
    emergencyFillUsed: boolean;
  };
  quality: {
    leakCount: number;
    majorGenreLeak: boolean;
    majorEraLeak: boolean;
    convergenceRisk: string | null;
    confidenceScore: number;
  };
  success: boolean;
  promptReliabilityScore: number;
  failureReasons: string[];
};

type BenchmarkReport = {
  generatedAt: string;
  commit: string;
  run: {
    baseUrl: string;
    promptCount: number;
    requestedLength: number;
  };
  summary: {
    promptReliabilityScore: number;
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
  leaks: number;
  convergenceRisk: string | null;
  recoveryCount: number;
  collapseStage: string;
  failures: RegressionFailure[];
  trend: {
    previousScore: number | null;
    delta: number | null;
    previousCompletion: number | null;
    completionDelta: number | null;
    previousSurvival: number | null;
    survivalDelta: number | null;
    previousConfidence: number | null;
    confidenceDelta: number | null;
  };
};

type RegressionReport = {
  generatedAt: string;
  specPath: string;
  currentRun: {
    reportPath: string;
    generatedAt: string;
    commit: string;
    baseUrl: string;
    promptCount: number;
  };
  previousRun: {
    reportPath: string | null;
    generatedAt: string | null;
    commit: string | null;
  };
  summary: {
    promptReliabilityRegressionScore: number;
    passedPrompts: number;
    failedPrompts: number;
    failureCount: number;
    criticalFailures: number;
    highFailures: number;
    mediumFailures: number;
    lowFailures: number;
    previousScore: number | null;
    delta: number | null;
  };
  topRegressions: PromptRegressionResult[];
  topImprovements: PromptRegressionResult[];
  mostUnstablePrompts: PromptRegressionResult[];
  mostReliablePrompts: PromptRegressionResult[];
  prompts: PromptRegressionResult[];
  failures: RegressionFailure[];
};

type Config = {
  currentPath: string;
  previousPath: string | null;
  specPath: string;
  outDir: string;
};

const DEFAULT_CURRENT = "reports/prompt-reliability/latest/prompt-reliability-report.json";
const DEFAULT_SPEC = "backend/lib/playlist-evaluation/golden-prompt-regression.json";
const DEFAULT_OUT = "reports/prompt-reliability/regression-latest";

const riskRank: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const severityPenalty: Record<Severity, number> = {
  critical: 18,
  high: 10,
  medium: 5,
  low: 2,
};

function usage(): never {
  console.error([
    "Usage:",
    "  npm run regression:prompt-reliability -- --current reports/prompt-reliability/latest/prompt-reliability-report.json",
    "",
    "Options:",
    "  --current FILE    Current prompt reliability benchmark JSON report",
    "  --previous FILE   Previous benchmark JSON report for trend deltas",
    "  --spec FILE       Golden prompt regression spec JSON",
    "  --out DIR         Output directory for regression reports",
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
    currentPath: argValue(args, "--current") ?? process.env["PROMPT_REGRESSION_CURRENT"] ?? DEFAULT_CURRENT,
    previousPath: argValue(args, "--previous") ?? process.env["PROMPT_REGRESSION_PREVIOUS"] ?? null,
    specPath: argValue(args, "--spec") ?? process.env["PROMPT_REGRESSION_SPEC"] ?? DEFAULT_SPEC,
    outDir: argValue(args, "--out") ?? process.env["PROMPT_REGRESSION_OUT"] ?? DEFAULT_OUT,
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function completion(row: BenchmarkPromptRow): number {
  return row.input.requestedLength > 0
    ? row.generation.finalTrackCount / row.input.requestedLength
    : 0;
}

function percentCompletion(row: BenchmarkPromptRow): number {
  return round(completion(row) * 100);
}

function riskAllowed(actual: string | null, maximum: ConvergenceRisk): boolean {
  if (!actual) return true;
  return (riskRank[actual] ?? 0) <= riskRank[maximum];
}

function likelyCollapseStage(row: BenchmarkPromptRow): string {
  if (row.error || !row.ok) return "generation_failure";
  if (row.retrieval.firstCollapseReason) return row.retrieval.firstCollapseReason;
  if ((row.retrieval.structuredRetrievalCount ?? 1) === 0) return "structured_retrieval_empty";
  if (completion(row) < 0.7) return "finalization_completion_below_70_percent";
  if (completion(row) < 0.9) return "finalization_underfill";
  if (row.quality.majorGenreLeak) return "major_genre_leak";
  if (row.quality.majorEraLeak || row.finalization.eraRelaxationUsed) return "era_evidence_relaxation";
  if (row.generation.recoveryCount > 0) return "recovery_used";
  if (row.intent.overallSurvivalPercent < 70) return "intent_survival_below_threshold";
  if (row.quality.confidenceScore < 70) return "confidence_below_threshold";
  return "none";
}

function failure(
  row: BenchmarkPromptRow,
  metric: string,
  expected: number | string | boolean,
  actual: number | string | boolean | null,
  severity: Severity,
): RegressionFailure {
  return {
    prompt: row.input.prompt,
    promptId: row.input.id,
    metric,
    expected,
    actual,
    severity,
    likelyCollapseStage: likelyCollapseStage(row),
  };
}

function evaluateFailures(row: BenchmarkPromptRow, spec: GoldenPromptAssertion): RegressionFailure[] {
  const failures: RegressionFailure[] = [];
  const actualCompletion = completion(row);
  if (row.error || !row.ok) {
    failures.push(failure(row, "generation", true, false, "critical"));
  }
  if (row.quality.majorGenreLeak) {
    failures.push(failure(row, "majorGenreLeak", false, true, "critical"));
  }
  if (row.quality.majorEraLeak || row.finalization.eraRelaxationUsed) {
    failures.push(failure(row, "majorEraLeak", false, true, "critical"));
  }
  if (actualCompletion < 0.7) {
    failures.push(failure(row, "completion", ">= 70%", `${percentCompletion(row)}%`, "critical"));
  } else if (actualCompletion < spec.minCompletion) {
    failures.push(failure(row, "completion", `>= ${round(spec.minCompletion * 100)}%`, `${percentCompletion(row)}%`, "medium"));
  }
  if (row.generation.finalTrackCount < spec.minTrackCount) {
    failures.push(failure(row, "trackCount", spec.minTrackCount, row.generation.finalTrackCount, actualCompletion < 0.7 ? "critical" : "medium"));
  }
  if (row.quality.confidenceScore < spec.minConfidence) {
    failures.push(failure(row, "confidence", spec.minConfidence, row.quality.confidenceScore, "high"));
  }
  if (row.intent.overallSurvivalPercent < spec.minSurvival) {
    failures.push(failure(row, "overallSurvival", spec.minSurvival, row.intent.overallSurvivalPercent, "high"));
  }
  if (row.quality.leakCount > spec.maxLeaks) {
    failures.push(failure(row, "leakCount", `<= ${spec.maxLeaks}`, row.quality.leakCount, row.quality.leakCount >= spec.maxLeaks + 2 ? "high" : "low"));
  }
  if (!riskAllowed(row.quality.convergenceRisk, spec.maxConvergenceRisk)) {
    const severity: Severity =
      row.input.group === "subgenre" || row.input.group === "emotion" ? "high" : "low";
    failures.push(failure(row, "convergenceRisk", `<= ${spec.maxConvergenceRisk}`, row.quality.convergenceRisk, severity));
  }
  if (spec.maxGenreDrift !== undefined) {
    const genreDrift = row.quality.majorGenreLeak ? 1 : Math.min(1, row.quality.leakCount / Math.max(1, spec.maxLeaks + 1));
    if (genreDrift > spec.maxGenreDrift) {
      failures.push(failure(row, "genreDrift", `<= ${spec.maxGenreDrift}`, genreDrift, "high"));
    }
  }
  if (spec.maxEraDrift !== undefined) {
    const eraDrift = row.quality.majorEraLeak || row.finalization.eraRelaxationUsed ? 1 : 0;
    if (eraDrift > spec.maxEraDrift) {
      failures.push(failure(row, "eraDrift", `<= ${spec.maxEraDrift}`, eraDrift, "high"));
    }
  }
  if (spec.minEmotionSurvival !== undefined && row.intent.emotionSurvivalPercent < spec.minEmotionSurvival) {
    failures.push(failure(row, "emotionSurvival", spec.minEmotionSurvival, row.intent.emotionSurvivalPercent, "low"));
  }
  if (spec.minSubgenreSurvival !== undefined && row.intent.subgenreSurvivalPercent < spec.minSubgenreSurvival) {
    failures.push(failure(row, "subgenreSurvival", spec.minSubgenreSurvival, row.intent.subgenreSurvivalPercent, "low"));
  }
  if (spec.maxRecoveryCount !== undefined && row.generation.recoveryCount > spec.maxRecoveryCount) {
    failures.push(failure(row, "recoveryCount", `<= ${spec.maxRecoveryCount}`, row.generation.recoveryCount, "medium"));
  } else if (row.generation.recoveryCount > 1) {
    failures.push(failure(row, "recoveryCount", "<= 1", row.generation.recoveryCount, "medium"));
  }
  return failures;
}

function scorePrompt(row: BenchmarkPromptRow, failures: RegressionFailure[]): number {
  const base =
    Math.min(100, percentCompletion(row)) * 0.32 +
    row.intent.overallSurvivalPercent * 0.28 +
    row.quality.confidenceScore * 0.24 +
    Math.max(0, 100 - row.quality.leakCount * 25) * 0.16;
  const penalty = failures.reduce((sum, item) => sum + severityPenalty[item.severity], 0);
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

function trendFor(
  row: BenchmarkPromptRow,
  score: number,
  previousByPrompt: Map<string, PromptRegressionResult>,
): PromptRegressionResult["trend"] {
  const previous = previousByPrompt.get(row.input.prompt);
  const previousCompletion = previous?.completion ?? null;
  const previousSurvival = previous?.survival ?? null;
  const previousConfidence = previous?.confidence ?? null;
  return {
    previousScore: previous?.score ?? null,
    delta: previous ? round(score - previous.score) : null,
    previousCompletion,
    completionDelta: previousCompletion === null ? null : round(percentCompletion(row) - previousCompletion),
    previousSurvival,
    survivalDelta: previousSurvival === null ? null : round(row.intent.overallSurvivalPercent - previousSurvival),
    previousConfidence,
    confidenceDelta: previousConfidence === null ? null : round(row.quality.confidenceScore - previousConfidence),
  };
}

function evaluateReport(
  benchmark: BenchmarkReport,
  spec: GoldenPromptSpec,
  previous: RegressionReport | null,
): { prompts: PromptRegressionResult[]; failures: RegressionFailure[] } {
  const previousByPrompt = new Map((previous?.prompts ?? []).map((row) => [row.prompt, row]));
  const prompts = benchmark.prompts.map((row): PromptRegressionResult => {
    const assertion = spec[row.input.prompt];
    const failures = assertion
      ? evaluateFailures(row, assertion)
      : [failure(row, "goldenSpec", "present", "missing", "critical")];
    const score = scorePrompt(row, failures);
    return {
      prompt: row.input.prompt,
      promptId: row.input.id,
      group: row.input.group,
      passed: failures.length === 0,
      score,
      completion: percentCompletion(row),
      confidence: row.quality.confidenceScore,
      survival: row.intent.overallSurvivalPercent,
      leaks: row.quality.leakCount,
      convergenceRisk: row.quality.convergenceRisk,
      recoveryCount: row.generation.recoveryCount,
      collapseStage: likelyCollapseStage(row),
      failures,
      trend: trendFor(row, score, previousByPrompt),
    };
  });
  return {
    prompts,
    failures: prompts.flatMap((row) => row.failures),
  };
}

function severityCount(failures: RegressionFailure[], severity: Severity): number {
  return failures.filter((failureRow) => failureRow.severity === severity).length;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function buildReport(input: {
  config: Config;
  benchmark: BenchmarkReport;
  previous: RegressionReport | null;
  prompts: PromptRegressionResult[];
  failures: RegressionFailure[];
}): RegressionReport {
  const score = Math.round(average(input.prompts.map((row) => row.score)));
  const previousScore = input.previous?.summary.promptReliabilityRegressionScore ?? null;
  const byRegression = [...input.prompts]
    .filter((row) => row.trend.delta !== null)
    .sort((a, b) => (a.trend.delta ?? 0) - (b.trend.delta ?? 0));
  const byImprovement = [...input.prompts]
    .filter((row) => row.trend.delta !== null)
    .sort((a, b) => (b.trend.delta ?? 0) - (a.trend.delta ?? 0));
  const byUnstable = [...input.prompts]
    .filter((row) => row.trend.delta !== null)
    .sort((a, b) => Math.abs(b.trend.delta ?? 0) - Math.abs(a.trend.delta ?? 0));
  const byReliable = [...input.prompts]
    .sort((a, b) =>
      Number(b.passed) - Number(a.passed) ||
      b.score - a.score ||
      a.leaks - b.leaks ||
      b.survival - a.survival
    );
  return {
    generatedAt: new Date().toISOString(),
    specPath: input.config.specPath,
    currentRun: {
      reportPath: input.config.currentPath,
      generatedAt: input.benchmark.generatedAt,
      commit: input.benchmark.commit,
      baseUrl: input.benchmark.run.baseUrl,
      promptCount: input.benchmark.prompts.length,
    },
    previousRun: {
      reportPath: input.config.previousPath,
      generatedAt: input.previous?.currentRun.generatedAt ?? null,
      commit: input.previous?.currentRun.commit ?? null,
    },
    summary: {
      promptReliabilityRegressionScore: score,
      passedPrompts: input.prompts.filter((row) => row.passed).length,
      failedPrompts: input.prompts.filter((row) => !row.passed).length,
      failureCount: input.failures.length,
      criticalFailures: severityCount(input.failures, "critical"),
      highFailures: severityCount(input.failures, "high"),
      mediumFailures: severityCount(input.failures, "medium"),
      lowFailures: severityCount(input.failures, "low"),
      previousScore,
      delta: previousScore === null ? null : score - previousScore,
    },
    topRegressions: byRegression.slice(0, 10),
    topImprovements: byImprovement.slice(0, 10),
    mostUnstablePrompts: byUnstable.slice(0, 10),
    mostReliablePrompts: byReliable.slice(0, 10),
    prompts: input.prompts,
    failures: input.failures,
  };
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" |")} |`),
  ];
}

function summaryMarkdown(report: RegressionReport): string {
  return [
    "# Golden Prompt Regression Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Current benchmark: ${report.currentRun.reportPath}`,
    `Previous benchmark: ${report.previousRun.reportPath ?? "none"}`,
    `Prompt Reliability Regression Score: ${report.summary.promptReliabilityRegressionScore}/100`,
    `Passed prompts: ${report.summary.passedPrompts}`,
    `Failed prompts: ${report.summary.failedPrompts}`,
    `Failures: ${report.summary.failureCount} (${report.summary.criticalFailures} critical, ${report.summary.highFailures} high, ${report.summary.mediumFailures} medium, ${report.summary.lowFailures} low)`,
    `Trend delta: ${report.summary.delta === null ? "N/A" : report.summary.delta >= 0 ? `+${report.summary.delta}` : String(report.summary.delta)}`,
    "",
    "## Prompt Results",
    ...table(
      ["Prompt", "Status", "Score", "Completion", "Survival", "Confidence", "Leaks", "Collapse Stage"],
      report.prompts.map((row) => [
        row.prompt,
        row.passed ? "PASS" : "FAIL",
        String(row.score),
        `${row.completion}%`,
        `${row.survival}%`,
        `${row.confidence}%`,
        String(row.leaks),
        row.collapseStage,
      ]),
    ),
    "",
    "## Top Regressions",
    ...(report.topRegressions.length
      ? report.topRegressions.map((row) => `- ${row.prompt}: ${row.trend.delta}`)
      : ["- No previous run supplied."]),
    "",
    "## Top Improvements",
    ...(report.topImprovements.length
      ? report.topImprovements.map((row) => `- ${row.prompt}: +${row.trend.delta}`)
      : ["- No previous run supplied."]),
    "",
    "## Most Reliable Prompts",
    ...report.mostReliablePrompts.slice(0, 10).map((row) => `- ${row.prompt}: ${row.score}/100 (${row.passed ? "PASS" : "FAIL"})`),
    "",
  ].join("\n");
}

function failuresMarkdown(report: RegressionReport): string {
  return [
    "# Golden Prompt Regression Failures",
    "",
    `Total failures: ${report.summary.failureCount}`,
    "",
    ...table(
      ["Prompt", "Metric", "Expected", "Actual", "Severity", "Likely Collapse Stage"],
      report.failures
        .sort((a, b) =>
          severityPenalty[b.severity] - severityPenalty[a.severity] ||
          a.prompt.localeCompare(b.prompt)
        )
        .map((failureRow) => [
          failureRow.prompt,
          failureRow.metric,
          String(failureRow.expected),
          String(failureRow.actual),
          failureRow.severity,
          failureRow.likelyCollapseStage,
        ]),
    ),
    "",
  ].join("\n");
}

async function writeReports(outDir: string, report: RegressionReport): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "regression-report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, "regression-report.md"), summaryMarkdown(report));
  await writeFile(path.join(outDir, "regression-failures.md"), failuresMarkdown(report));
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const [benchmark, spec] = await Promise.all([
    readJson<BenchmarkReport>(config.currentPath),
    readJson<GoldenPromptSpec>(config.specPath),
  ]);
  const previous = config.previousPath
    ? await readJson<RegressionReport>(config.previousPath)
    : null;
  const evaluated = evaluateReport(benchmark, spec, previous);
  const report = buildReport({
    config,
    benchmark,
    previous,
    prompts: evaluated.prompts,
    failures: evaluated.failures,
  });
  await writeReports(config.outDir, report);
  process.stdout.write(`${JSON.stringify({
    outDir: config.outDir,
    promptReliabilityRegressionScore: report.summary.promptReliabilityRegressionScore,
    passedPrompts: report.summary.passedPrompts,
    failedPrompts: report.summary.failedPrompts,
    failureCount: report.summary.failureCount,
    reports: [
      "regression-report.json",
      "regression-report.md",
      "regression-failures.md",
    ],
  }, null, 2)}\n`);
  if (report.summary.failedPrompts > 0 || report.summary.criticalFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
