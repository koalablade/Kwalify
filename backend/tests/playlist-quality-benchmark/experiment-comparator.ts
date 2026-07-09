/**
 * Experiment comparison — current vs baseline with SHIP / HOLD / REJECT decision.
 */

import type {
  CategoryMetrics,
  ExperimentComparison,
  ExperimentRecommendation,
  HallOfFameCategory,
  LibraryDependency,
  MetricDelta,
  QualityBenchmarkBaseline,
  QualityBenchmarkMetrics,
} from "./types";
import { evaluateRegressionGate } from "./regression-gate";

const EMPTY_CATEGORY: CategoryMetrics = {
  count: 0,
  humanPreferenceWinRate: null,
  openingPassRate: null,
  firstAttemptSuccessRate: null,
  avgSaveLikelihood: null,
  negativeFailureRate: null,
  avgReplayProxyScore: null,
  avgSkipRiskScore: null,
  avgSaveProxyScore: null,
};

function normalizeMetrics(metrics: QualityBenchmarkMetrics): QualityBenchmarkMetrics {
  const deps: LibraryDependency[] = ["low", "medium", "high"];
  const categories: HallOfFameCategory[] = ["easy_mood", "functional", "hard_activity", "emotional_specific"];
  return {
    ...metrics,
    regenerationRate: metrics.regenerationRate ?? null,
    abandonmentRate: metrics.abandonmentRate ?? null,
    libraryInsufficientRate: metrics.libraryInsufficientRate ?? null,
    avgReplayProxyScore: metrics.avgReplayProxyScore ?? null,
    avgSkipRiskScore: metrics.avgSkipRiskScore ?? null,
    avgSaveProxyScore: metrics.avgSaveProxyScore ?? null,
    avgContinueListeningScore: metrics.avgContinueListeningScore ?? null,
    byLibraryDependency: {
      low: metrics.byLibraryDependency?.low ?? EMPTY_CATEGORY,
      medium: metrics.byLibraryDependency?.medium ?? EMPTY_CATEGORY,
      high: metrics.byLibraryDependency?.high ?? EMPTY_CATEGORY,
    },
    byCategory: Object.fromEntries(
      categories.map((category) => [category, metrics.byCategory?.[category] ?? EMPTY_CATEGORY]),
    ) as QualityBenchmarkMetrics["byCategory"],
  };
}

const GLOBAL_METRICS: Array<{
  key: keyof QualityBenchmarkMetrics;
  label: string;
  improveThresholdPp: number;
  regressThresholdPp: number;
}> = [
  { key: "humanPreferenceWinRate", label: "Human preference win rate", improveThresholdPp: 3, regressThresholdPp: -5 },
  { key: "openingPassRate", label: "Opening pass rate", improveThresholdPp: 3, regressThresholdPp: -8 },
  { key: "firstAttemptSuccessRate", label: "First attempt success", improveThresholdPp: 3, regressThresholdPp: -8 },
  { key: "avgSaveLikelihood", label: "Save likelihood", improveThresholdPp: 0.04, regressThresholdPp: -0.06 },
  { key: "activityAccuracy", label: "Activity accuracy", improveThresholdPp: 5, regressThresholdPp: -10 },
  { key: "regenerationRate", label: "Regeneration rate", improveThresholdPp: -3, regressThresholdPp: 5 },
  { key: "abandonmentRate", label: "Abandonment rate", improveThresholdPp: -3, regressThresholdPp: 5 },
  { key: "libraryInsufficientRate", label: "Library insufficient rate", improveThresholdPp: -3, regressThresholdPp: 5 },
  { key: "avgReplayProxyScore", label: "Replay proxy score", improveThresholdPp: 0.04, regressThresholdPp: -0.06 },
  { key: "avgSaveProxyScore", label: "Save proxy score", improveThresholdPp: 0.04, regressThresholdPp: -0.06 },
  { key: "avgSkipRiskScore", label: "Skip risk score", improveThresholdPp: -4, regressThresholdPp: 6 },
];

const CATEGORY_LABELS: Record<HallOfFameCategory, string> = {
  easy_mood: "chill/mood playlists",
  functional: "functional playlists",
  hard_activity: "gym/activity prompts",
  emotional_specific: "emotional specificity prompts",
};

function deltaPp(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null;
  return (current - baseline) * 100;
}

function classifyGlobalDelta(
  key: keyof QualityBenchmarkMetrics,
  label: string,
  current: number | null,
  baseline: number | null,
  cfg: (typeof GLOBAL_METRICS)[number],
): MetricDelta | null {
  if (current == null || baseline == null) return null;
  const d = current - baseline;
  const dpp = d * (label.includes("likelihood") ? 1 : 100);
  const lowerIsBetter = key === "regenerationRate" || key === "abandonmentRate" || key === "libraryInsufficientRate" || key === "negativeObviousFailureRate" || key === "avgSkipRiskScore";
  const isUnitScore = label.includes("likelihood") || String(key).includes("Proxy") || key === "avgContinueListeningScore";

  let direction: MetricDelta["direction"] = "flat";
  if (lowerIsBetter) {
    if (dpp <= cfg.improveThresholdPp) direction = "improved";
    else if (dpp >= cfg.regressThresholdPp) direction = "regressed";
  } else if (isUnitScore) {
    if (d >= cfg.improveThresholdPp) direction = "improved";
    else if (d <= cfg.regressThresholdPp) direction = "regressed";
  } else {
    if (dpp >= cfg.improveThresholdPp) direction = "improved";
    else if (dpp <= cfg.regressThresholdPp) direction = "regressed";
  }

  if (direction === "flat") return null;

  return {
    metric: key,
    label,
    baseline,
    current,
    delta: d,
    deltaPp: isUnitScore ? null : dpp,
    direction,
  };
}

function compareCategoryMetrics(
  category: HallOfFameCategory,
  current: CategoryMetrics,
  baseline: CategoryMetrics,
): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  const label = CATEGORY_LABELS[category];

  const opening = deltaPp(current.openingPassRate, baseline.openingPassRate);
  if (opening != null && Math.abs(opening) >= 3) {
    deltas.push({
      metric: `byCategory.${category}.openingPassRate`,
      label: `${label} opening quality`,
      baseline: baseline.openingPassRate,
      current: current.openingPassRate,
      delta: (current.openingPassRate ?? 0) - (baseline.openingPassRate ?? 0),
      deltaPp: opening,
      category,
      direction: opening >= 3 ? "improved" : "regressed",
    });
  }

  const firstAttempt = deltaPp(current.firstAttemptSuccessRate, baseline.firstAttemptSuccessRate);
  if (firstAttempt != null && Math.abs(firstAttempt) >= 3) {
    deltas.push({
      metric: `byCategory.${category}.firstAttemptSuccessRate`,
      label: `${label} first attempt success`,
      baseline: baseline.firstAttemptSuccessRate,
      current: current.firstAttemptSuccessRate,
      delta: (current.firstAttemptSuccessRate ?? 0) - (baseline.firstAttemptSuccessRate ?? 0),
      deltaPp: firstAttempt,
      category,
      direction: firstAttempt >= 3 ? "improved" : "regressed",
    });
  }

  const preference = deltaPp(current.humanPreferenceWinRate, baseline.humanPreferenceWinRate);
  if (preference != null && Math.abs(preference) >= 3) {
    deltas.push({
      metric: `byCategory.${category}.humanPreferenceWinRate`,
      label: `${label} human preference`,
      baseline: baseline.humanPreferenceWinRate,
      current: current.humanPreferenceWinRate,
      delta: (current.humanPreferenceWinRate ?? 0) - (baseline.humanPreferenceWinRate ?? 0),
      deltaPp: preference,
      category,
      direction: preference >= 3 ? "improved" : "regressed",
    });
  }

  return deltas;
}

export function compareExperimentMetrics(
  current: QualityBenchmarkMetrics,
  baselineSnapshot: QualityBenchmarkBaseline | null,
): ExperimentComparison {
  const baseline = baselineSnapshot?.metrics ? normalizeMetrics(baselineSnapshot.metrics) : null;
  const normalizedCurrent = normalizeMetrics(current);
  const regression = evaluateRegressionGate(normalizedCurrent, baseline);

  const improvements: MetricDelta[] = [];
  const regressions: MetricDelta[] = [];

  if (baseline) {
    for (const cfg of GLOBAL_METRICS) {
      const row = classifyGlobalDelta(
        cfg.key,
        cfg.label,
        normalizedCurrent[cfg.key] as number | null,
        baseline[cfg.key] as number | null,
        cfg,
      );
      if (!row) continue;
      if (row.direction === "improved") improvements.push(row);
      if (row.direction === "regressed") regressions.push(row);
    }

    const categories = Object.keys(normalizedCurrent.byCategory) as HallOfFameCategory[];
    for (const category of categories) {
      const cur = normalizedCurrent.byCategory[category];
      const base = baseline.byCategory[category];
      if (!cur?.count || !base?.count) continue;
      for (const row of compareCategoryMetrics(category, cur, base)) {
        if (row.direction === "improved") improvements.push(row);
        if (row.direction === "regressed") regressions.push(row);
      }
    }
  }

  const hard = normalizedCurrent.byCategory.hard_activity;
  const hardBase = baseline?.byCategory.hard_activity;
  const hardActivityRegressed = Boolean(
    hardBase?.count &&
    hard?.count &&
    (
      (deltaPp(hard.openingPassRate, hardBase.openingPassRate) ?? 0) <= -8 ||
      (deltaPp(hard.firstAttemptSuccessRate, hardBase.firstAttemptSuccessRate) ?? 0) <= -8 ||
      (deltaPp(hard.humanPreferenceWinRate, hardBase.humanPreferenceWinRate) ?? 0) <= -5 ||
      ((normalizedCurrent.activityAccuracy ?? 0) - (baseline?.activityAccuracy ?? 0)) <= -0.1
    ),
  );

  if (hardActivityRegressed) {
    regressions.push({
      metric: "hard_activity",
      label: "Hard activity prompts",
      baseline: hardBase?.openingPassRate ?? null,
      current: hard?.openingPassRate ?? null,
      delta: null,
      deltaPp: null,
      category: "hard_activity",
      direction: "regressed",
    });
  }

  return {
    baselineDescription: baselineSnapshot?.description ?? null,
    baselineGeneratedAt: baselineSnapshot?.generatedAt ?? null,
    deltas: regression.deltas,
    improvements,
    regressions,
    hardActivityRegressed,
    regressionPassed: regression.passed && !hardActivityRegressed,
    regressionFlags: [
      ...regression.flags,
      ...(hardActivityRegressed ? ["Hard activity prompts regressed vs baseline"] : []),
    ],
  };
}

export function decideExperimentRecommendation(comparison: ExperimentComparison): ExperimentRecommendation {
  if (!comparison.regressionPassed) return "REJECT";

  const keyImprovements = comparison.improvements.filter((row) =>
    typeof row.metric === "string" &&
    (
      row.metric.includes("openingPassRate") ||
      row.metric.includes("firstAttemptSuccessRate") ||
      row.metric.includes("humanPreferenceWinRate") ||
      row.metric === "openingPassRate" ||
      row.metric === "firstAttemptSuccessRate" ||
      row.metric === "humanPreferenceWinRate"
    ),
  );

  if (comparison.regressions.length > 0 && keyImprovements.length === 0) return "HOLD";
  if (keyImprovements.length >= 1 && comparison.regressions.length === 0) return "SHIP";
  if (keyImprovements.length >= 2) return "SHIP";
  if (comparison.regressions.length === 0) return "HOLD";
  return "HOLD";
}

export function decideOverallRecommendation(
  suiteResults: Array<{ recommendation: ExperimentRecommendation; suite: string; tuningAllowed: boolean }>,
): ExperimentRecommendation {
  if (suiteResults.some((r) => r.recommendation === "REJECT")) return "REJECT";

  const holdout = suiteResults.filter((r) => !r.tuningAllowed);
  if (holdout.some((r) => r.recommendation === "HOLD")) return "HOLD";

  const training = suiteResults.find((r) => r.suite === "training");
  if (training?.recommendation === "SHIP") {
    const allShip = suiteResults.every((r) => r.recommendation === "SHIP");
    return allShip ? "SHIP" : "HOLD";
  }

  if (suiteResults.every((r) => r.recommendation === "SHIP")) return "SHIP";
  return "HOLD";
}

export function formatDeltaLine(row: MetricDelta): string {
  if (row.deltaPp != null) {
    const sign = row.deltaPp >= 0 ? "+" : "";
    return `${sign}${row.deltaPp.toFixed(0)}% ${row.label.replace(/^./, (c) => c.toLowerCase())}`;
  }
  if (row.delta != null) {
    const sign = row.delta >= 0 ? "+" : "";
    return `${sign}${row.delta.toFixed(2)} ${row.label.toLowerCase()}`;
  }
  return row.label;
}
