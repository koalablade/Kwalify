/**
 * Experiment markdown reports.
 */

import type {
  ExperimentRecord,
  SuiteExperimentResult,
} from "./types";
import { formatDeltaLine } from "./experiment-comparator";
import { formatMetricsMarkdown } from "./metrics-aggregator";
import { loadQualityBaseline } from "./regression-gate";

function pct(v: number | null | undefined): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}

function formatSuiteSection(result: SuiteExperimentResult): string[] {
  const lines = [
    `### ${result.suite} suite${result.tuningAllowed ? "" : " (holdout — do not tune against)"}`,
    "",
    `- Recommendation: **${result.recommendation}**`,
    `- Opening pass: ${pct(result.metrics.openingPassRate)}`,
    `- First attempt success: ${pct(result.metrics.firstAttemptSuccessRate)}`,
    `- Human preference win rate: ${pct(result.metrics.humanPreferenceWinRate)}`,
    `- Save likelihood: ${result.metrics.avgSaveLikelihood?.toFixed(2) ?? "n/a"}`,
    `- Replay proxy: ${result.metrics.avgReplayProxyScore?.toFixed(2) ?? "n/a"}`,
    `- Skip risk: ${result.metrics.avgSkipRiskScore?.toFixed(2) ?? "n/a"} (lower is better)`,
    `- Save proxy: ${result.metrics.avgSaveProxyScore?.toFixed(2) ?? "n/a"}`,
    "",
  ];

  if (result.comparison.improvements.length) {
    lines.push("Improved:");
    for (const row of result.comparison.improvements) {
      lines.push(`- ${formatDeltaLine(row)}`);
    }
    lines.push("");
  }

  if (result.comparison.regressions.length) {
    lines.push("Regressed:");
    for (const row of result.comparison.regressions) {
      lines.push(`- ${formatDeltaLine(row)}`);
    }
    lines.push("");
  }

  return lines;
}

export function formatExperimentMarkdown(record: ExperimentRecord): string {
  const { metadata } = record;
  const training = record.suites.find((s) => s.suite === "training") ?? record.suites[0];

  const lines = [
    `# ${metadata.name}`,
    "",
    "## Experiment metadata",
    "",
    `- ID: \`${metadata.id}\``,
    `- Date: ${metadata.runAt}`,
    `- Git: ${metadata.gitCommit ?? "unknown"}${metadata.gitDirty ? " (dirty)" : ""}`,
    `- Branch: ${metadata.gitBranch ?? "unknown"}`,
    `- Mode: ${metadata.mode}`,
    `- Prompt suite: ${metadata.promptSuiteVersion}`,
    `- Dataset: ${metadata.datasetVersion}`,
    `- Evaluated suites: ${metadata.suite}`,
    "",
  ];

  if (Object.keys(metadata.configurationFlags).length) {
    lines.push("### Configuration flags", "");
    for (const [key, value] of Object.entries(metadata.configurationFlags)) {
      lines.push(`- \`${key}\`: ${String(value)}`);
    }
    lines.push("");
  }

  if (training) {
    const baseline = loadQualityBaseline()?.metrics ?? null;
    lines.push(
      "## Baseline comparison",
      "",
      `Baseline captured: ${training.comparison.baselineGeneratedAt ?? "n/a"}`,
      training.comparison.baselineDescription
        ? `Baseline note: ${training.comparison.baselineDescription}`
        : "",
      "",
      "| Metric | Baseline | Current |",
      "|---|---:|---:|",
      `| Opening pass rate | ${pct(baseline?.openingPassRate)} | ${pct(training.metrics.openingPassRate)} |`,
      `| First attempt success | ${pct(baseline?.firstAttemptSuccessRate)} | ${pct(training.metrics.firstAttemptSuccessRate)} |`,
      `| Human preference | ${pct(baseline?.humanPreferenceWinRate)} | ${pct(training.metrics.humanPreferenceWinRate)} |`,
      `| Save likelihood | ${baseline?.avgSaveLikelihood?.toFixed(2) ?? "n/a"} | ${training.metrics.avgSaveLikelihood?.toFixed(2) ?? "n/a"} |`,
      `| Regeneration rate | ${pct(baseline?.regenerationRate)} | ${pct(training.metrics.regenerationRate)} |`,
      `| Abandonment rate | ${pct(baseline?.abandonmentRate)} | ${pct(training.metrics.abandonmentRate)} |`,
      `| Replay proxy score | ${baseline?.avgReplayProxyScore?.toFixed(2) ?? "n/a"} | ${training.metrics.avgReplayProxyScore?.toFixed(2) ?? "n/a"} |`,
      `| Skip risk score | ${baseline?.avgSkipRiskScore?.toFixed(2) ?? "n/a"} | ${training.metrics.avgSkipRiskScore?.toFixed(2) ?? "n/a"} |`,
      `| Save proxy score | ${baseline?.avgSaveProxyScore?.toFixed(2) ?? "n/a"} | ${training.metrics.avgSaveProxyScore?.toFixed(2) ?? "n/a"} |`,
      "",
      "### Behavioral proxy note",
      "",
      "Replay/skip/save proxies estimate real listening survival. They are **not** fed into generation.",
      "",
    );
  }

  lines.push("## Suite results", "");
  for (const suite of record.suites) {
    lines.push(...formatSuiteSection(suite));
  }

  if (training) {
    lines.push(formatMetricsMarkdown(training.metrics), "");
  }

  lines.push(
    "## Recommendation",
    "",
    `**${record.overallRecommendation}**`,
    "",
    record.overallRecommendation === "SHIP"
      ? "Net quality improved without meaningful regressions. Safe to ship after live confirmation."
      : record.overallRecommendation === "REJECT"
        ? "Regression detected — do not ship until metrics recover."
        : "Mixed or inconclusive — gather more live signal before shipping.",
    "",
    "### Anti-overfitting note",
    "",
    "Training (Hall of Fame) scores are for inspection only. Treat validation and stress holdouts as the generalisation check — never optimize directly against validation/stress prompts.",
    "",
  );

  return lines.filter(Boolean).join("\n");
}
