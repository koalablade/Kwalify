/**
 * Regression gate — flags HRPS, opening, and human preference drops vs baseline.
 */

import fs from "node:fs";
import path from "node:path";
import type { QualityBenchmarkBaseline, QualityBenchmarkMetrics, RegressionGateResult } from "./types";

function resolveBaselinePath(): string {
  const candidates = [
    path.join(__dirname, "baseline.snapshot.json"),
    path.join(__dirname, "..", "..", "..", "tests", "playlist-quality-benchmark", "baseline.snapshot.json"),
    path.join(process.cwd(), "backend", "tests", "playlist-quality-benchmark", "baseline.snapshot.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[1]!;
}

const THRESHOLDS = {
  humanPreferenceWinRate: -0.05,
  openingPassRate: -0.08,
  firstAttemptSuccessRate: -0.08,
  avgSaveLikelihood: -0.06,
  negativeObviousFailureRate: 0.05,
  goldenPromptsFailed: 1,
};

export function loadQualityBaseline(): QualityBenchmarkBaseline | null {
  const baselinePath = resolveBaselinePath();
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, "utf8")) as QualityBenchmarkBaseline;
}

export function saveQualityBaseline(metrics: QualityBenchmarkMetrics, description: string): void {
  const writePath = path.join(
    path.dirname(resolveBaselinePath()),
    "baseline.snapshot.json",
  );
  const payload: QualityBenchmarkBaseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    description,
    metrics,
  };
  fs.writeFileSync(writePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function delta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null;
  return current - baseline;
}

export function evaluateRegressionGate(
  current: QualityBenchmarkMetrics,
  baseline: QualityBenchmarkMetrics | null,
): RegressionGateResult {
  const flags: string[] = [];
  const deltas: RegressionGateResult["deltas"] = {};

  if (!baseline) {
    return {
      passed: true,
      flags: ["no_baseline_snapshot — run with --write-baseline after a good run"],
      current,
      baseline: null,
      deltas,
    };
  }

  const checks: Array<{
    key: keyof QualityBenchmarkMetrics;
    label: string;
    threshold: number;
    higherIsBetter: boolean;
  }> = [
    { key: "humanPreferenceWinRate", label: "Human preference win rate", threshold: THRESHOLDS.humanPreferenceWinRate, higherIsBetter: true },
    { key: "openingPassRate", label: "Opening pass rate", threshold: THRESHOLDS.openingPassRate, higherIsBetter: true },
    { key: "firstAttemptSuccessRate", label: "First attempt success rate", threshold: THRESHOLDS.firstAttemptSuccessRate, higherIsBetter: true },
    { key: "avgSaveLikelihood", label: "Save likelihood", threshold: THRESHOLDS.avgSaveLikelihood, higherIsBetter: true },
    { key: "negativeObviousFailureRate", label: "Obvious failure rate", threshold: THRESHOLDS.negativeObviousFailureRate, higherIsBetter: false },
  ];

  for (const check of checks) {
    const cur = current[check.key] as number | null;
    const base = baseline[check.key] as number | null;
    const d = delta(cur, base);
    deltas[check.key] = d;
    if (d == null) continue;

    if (check.higherIsBetter && d < check.threshold) {
      flags.push(`${check.label} dropped ${(d * 100).toFixed(1)}pp (threshold ${(check.threshold * 100).toFixed(1)}pp)`);
    }
    if (!check.higherIsBetter && d > check.threshold) {
      flags.push(`${check.label} increased ${(d * 100).toFixed(1)}pp (threshold +${(check.threshold * 100).toFixed(1)}pp)`);
    }
  }

  if (current.goldenPromptsFailed > baseline.goldenPromptsFailed) {
    flags.push(
      `Golden prompt failures increased (${baseline.goldenPromptsFailed} → ${current.goldenPromptsFailed})`,
    );
  }

  if (
    current.hrpsAvgImprovement != null &&
    baseline.hrpsAvgImprovement != null &&
    current.hrpsAvgImprovement < baseline.hrpsAvgImprovement - 0.5
  ) {
    flags.push(`HRPS improvement dropped (${baseline.hrpsAvgImprovement.toFixed(2)} → ${current.hrpsAvgImprovement.toFixed(2)})`);
  }

  return {
    passed: flags.length === 0,
    flags,
    current,
    baseline,
    deltas,
  };
}

export function formatRegressionReport(result: RegressionGateResult): string {
  const lines = [
    "## Regression gate",
    "",
    result.passed ? "✅ PASSED" : "❌ FAILED",
    "",
  ];

  if (result.flags.length) {
    lines.push("### Flags");
    for (const flag of result.flags) lines.push(`- ${flag}`);
    lines.push("");
  }

  if (result.baseline) {
    lines.push("### Before vs after");
    lines.push("| Metric | Baseline | Current | Delta |");
    lines.push("|---|---:|---:|---:|");
    const keys: Array<keyof QualityBenchmarkMetrics> = [
      "humanPreferenceWinRate",
      "openingPassRate",
      "firstAttemptSuccessRate",
      "avgSaveLikelihood",
      "regenerationRate",
      "abandonmentRate",
      "libraryInsufficientRate",
      "negativeObviousFailureRate",
    ];
    for (const key of keys) {
      const base = result.baseline[key] as number | null;
      const cur = result.current[key] as number | null;
      const d = result.deltas[key];
      const fmt = (v: number | null) => (v == null ? "n/a" : key.includes("Rate") ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));
      lines.push(`| ${key} | ${fmt(base)} | ${fmt(cur)} | ${d == null ? "n/a" : key.includes("Rate") ? `${(d * 100).toFixed(1)}pp` : d.toFixed(2)} |`);
    }
  }

  return lines.join("\n");
}
