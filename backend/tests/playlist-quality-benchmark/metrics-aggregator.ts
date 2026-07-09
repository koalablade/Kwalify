/**
 * Aggregate benchmark metrics and first-attempt success tracking.
 */

import type {
  CategoryMetrics,
  FirstAttemptOutcome,
  FirstAttemptRecord,
  HallOfFameCategory,
  LibraryDependency,
  PromptBenchmarkResult,
  QualityBenchmarkMetrics,
} from "./types";

const LIBRARY_DEPS: LibraryDependency[] = ["low", "medium", "high"];

function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function rate(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function outcomeRate(results: PromptBenchmarkResult[], outcome: FirstAttemptOutcome): number | null {
  const attempts = results.map((r) => r.firstAttempt);
  return rate(attempts.filter((r) => r.outcome === outcome).length, attempts.length);
}

function buildCategoryMetrics(rows: PromptBenchmarkResult[]): CategoryMetrics {
  const catJudged = rows.filter((r) => r.blindPairwise);
  const catOpening = rows.filter((r) => r.openingFive);
  const catFirst = rows.map((r) => r.firstAttempt);
  return {
    count: rows.length,
    humanPreferenceWinRate: rate(
      catJudged.filter((r) => r.blindPairwise?.winner === "kwalify").length,
      catJudged.length,
    ),
    openingPassRate: rate(catOpening.filter((r) => r.openingFive?.pass).length, catOpening.length),
    firstAttemptSuccessRate: rate(
      catFirst.filter((r) => r.firstGenerationSuccess).length,
      catFirst.length,
    ),
    avgSaveLikelihood: mean(rows.map((r) => r.saveLikelihood)),
    negativeFailureRate: rate(rows.filter((r) => r.negativeDetection.detected).length, rows.length),
    avgReplayProxyScore: mean(rows.map((r) => r.replaySimulation?.replayProxyScore)),
    avgSkipRiskScore: mean(rows.map((r) => r.replaySimulation?.skipRiskScore)),
    avgSaveProxyScore: mean(rows.map((r) => r.replaySimulation?.saveProxyScore)),
  };
}

export function buildFirstAttemptRecord(opts: {
  promptId: string;
  prompt: string;
  category: HallOfFameCategory;
  difficulty: import("./types").HallOfFameDifficulty;
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  varietyBoost?: boolean;
}): FirstAttemptRecord {
  let outcome: FirstAttemptOutcome;
  let attempts = 1;

  if (opts.libraryInsufficient) {
    outcome = "library_insufficient";
  } else if (opts.generationSuccess) {
    outcome = opts.varietyBoost ? "regenerated" : "saved";
    attempts = opts.varietyBoost ? 2 : 1;
  } else {
    outcome = "abandoned";
  }

  return {
    promptId: opts.promptId,
    prompt: opts.prompt,
    category: opts.category,
    difficulty: opts.difficulty,
    outcome,
    attempts,
    firstGenerationSuccess: opts.generationSuccess && !opts.varietyBoost && !opts.libraryInsufficient,
  };
}

export function aggregateBenchmarkMetrics(
  results: PromptBenchmarkResult[],
  golden: { passed: number; failed: number },
  hrpsAvgImprovement: number | null = null,
): QualityBenchmarkMetrics {
  const judged = results.filter((r) => r.blindPairwise);
  const kwalifyWins = judged.filter((r) => r.blindPairwise?.winner === "kwalify").length;
  const ties = judged.filter((r) => r.blindPairwise?.winner === "tie").length;

  const openingEvaluated = results.filter((r) => r.openingFive);
  const openingPass = openingEvaluated.filter((r) => r.openingFive?.pass).length;

  const firstAttempts = results.map((r) => r.firstAttempt);
  const firstAttemptSuccess = firstAttempts.filter((r) => r.firstGenerationSuccess).length;

  const negativeHits = results.filter((r) => r.negativeDetection.detected).length;

  const hardActivity = results.filter((r) =>
    r.category === "hard_activity" && r.blindPairwise?.dimensions.activityFit === "kwalify"
  ).length;
  const hardActivityTotal = results.filter((r) => r.category === "hard_activity" && r.blindPairwise).length;

  const categories: HallOfFameCategory[] = ["easy_mood", "functional", "hard_activity", "emotional_specific"];
  const byCategory = Object.fromEntries(
    categories.map((category) => [category, buildCategoryMetrics(results.filter((r) => r.category === category))]),
  ) as Record<HallOfFameCategory, CategoryMetrics>;

  const byLibraryDependency = Object.fromEntries(
    LIBRARY_DEPS.map((dep) => [dep, buildCategoryMetrics(results.filter((r) => r.libraryDependency === dep))]),
  ) as Record<LibraryDependency, CategoryMetrics>;

  return {
    humanPreferenceWinRate: rate(kwalifyWins, judged.length),
    humanPreferenceTieRate: rate(ties, judged.length),
    openingPassRate: rate(openingPass, openingEvaluated.length),
    activityAccuracy: rate(hardActivity, hardActivityTotal),
    avgSaveLikelihood: mean(results.map((r) => r.saveLikelihood)),
    firstAttemptSuccessRate: rate(firstAttemptSuccess, firstAttempts.length),
    regenerationRate: outcomeRate(results, "regenerated"),
    abandonmentRate: outcomeRate(results, "abandoned"),
    libraryInsufficientRate: outcomeRate(results, "library_insufficient"),
    negativeObviousFailureRate: rate(negativeHits, results.length),
    goldenPromptsPassed: golden.passed,
    goldenPromptsFailed: golden.failed,
    hrpsAvgImprovement,
    avgReplayProxyScore: mean(results.map((r) => r.replaySimulation?.replayProxyScore)),
    avgSkipRiskScore: mean(results.map((r) => r.replaySimulation?.skipRiskScore)),
    avgSaveProxyScore: mean(results.map((r) => r.replaySimulation?.saveProxyScore)),
    avgContinueListeningScore: mean(results.map((r) => r.replaySimulation?.continueListeningScore)),
    byCategory,
    byLibraryDependency,
  };
}

export function formatMetricsMarkdown(metrics: QualityBenchmarkMetrics): string {
  const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const lines = [
    "## Quality benchmark metrics",
    "",
    `- Human preference win rate (Kwalify): ${pct(metrics.humanPreferenceWinRate)}`,
    `- Opening pass rate: ${pct(metrics.openingPassRate)}`,
    `- First attempt success rate: ${pct(metrics.firstAttemptSuccessRate)}`,
    `- Regeneration rate: ${pct(metrics.regenerationRate)}`,
    `- Abandonment rate: ${pct(metrics.abandonmentRate)}`,
    `- Library insufficient rate: ${pct(metrics.libraryInsufficientRate)}`,
    `- Activity accuracy (hard): ${pct(metrics.activityAccuracy)}`,
    `- Avg save likelihood: ${metrics.avgSaveLikelihood?.toFixed(2) ?? "n/a"}`,
    `- Obvious negative failure rate: ${pct(metrics.negativeObviousFailureRate)}`,
    `- Golden prompts: ${metrics.goldenPromptsPassed} passed, ${metrics.goldenPromptsFailed} failed`,
    `- HRPS avg improvement: ${metrics.hrpsAvgImprovement?.toFixed(2) ?? "n/a"}`,
    `- Replay proxy score: ${metrics.avgReplayProxyScore?.toFixed(2) ?? "n/a"}`,
    `- Skip risk score: ${metrics.avgSkipRiskScore?.toFixed(2) ?? "n/a"} (lower is better)`,
    `- Save proxy score: ${metrics.avgSaveProxyScore?.toFixed(2) ?? "n/a"}`,
    `- Continue listening score: ${metrics.avgContinueListeningScore?.toFixed(2) ?? "n/a"}`,
    "",
    "### By category",
  ];

  for (const [category, row] of Object.entries(metrics.byCategory)) {
    if (row.count === 0) continue;
    lines.push(
      `**${category}** (${row.count}) — first-attempt ${pct(row.firstAttemptSuccessRate)}, opening ${pct(row.openingPassRate)}, preference ${pct(row.humanPreferenceWinRate)}`,
    );
  }

  lines.push("", "### By library dependency");
  for (const [dep, row] of Object.entries(metrics.byLibraryDependency)) {
    if (row.count === 0) continue;
    lines.push(
      `**${dep}** (${row.count}) — first-attempt ${pct(row.firstAttemptSuccessRate)}, opening ${pct(row.openingPassRate)}`,
    );
  }

  return lines.join("\n");
}
