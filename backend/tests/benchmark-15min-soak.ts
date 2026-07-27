/**
 * 15-minute soak benchmark — measurement only, no production changes.
 * Repeatedly runs HRPS, perception, golden, and stability checks until duration elapses.
 */

import { performance } from "perf_hooks";
import {
  BENCHMARK_PROMPTS,
  runHumanRetentionBenchmark,
  collectCurrentOutput,
  type BenchmarkReport,
} from "./benchmark-human-retention";
import { runEmotionalClarityTests } from "./emotional-clarity.test";
import { runGoldenPromptTests } from "./golden-prompts.test";

const DURATION_MS = 15 * 60 * 1000;

interface CycleResult {
  cycle: number;
  elapsedMs: number;
  hrps: {
    avgImprovement: number;
    regressionCount: number;
    hrpsWinCount: number;
    totalProcessed: number;
  };
  perception: { passed: number; failed: number };
  golden: { passed: number; failed: number };
  stability: { checked: number; unstable: number };
  cycleMs: number;
  errors: string[];
}

interface SoakReport {
  durationMs: number;
  cyclesCompleted: number;
  totalHrpsRuns: number;
  totalPromptsProcessed: number;
  avgCycleMs: number;
  hrps: {
    avgImprovementMean: number;
    avgImprovementMin: number;
    avgImprovementMax: number;
    totalRegressions: number;
    totalHrpsWins: number;
    winRatePct: number;
  };
  tests: {
    perceptionFailures: number;
    goldenFailures: number;
  };
  stability: {
    checks: number;
    unstable: number;
    stabilityRatePct: number;
  };
  errors: string[];
  cycleResults: CycleResult[];
}

async function checkStability(): Promise<{ checked: number; unstable: number }> {
  let checked = 0;
  let unstable = 0;

  for (const prompt of BENCHMARK_PROMPTS) {
    const signatures = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const out = await collectCurrentOutput(prompt);
      signatures.add(out.momentSignature ?? "");
    }
    checked += 1;
    if (signatures.size > 1) unstable += 1;
  }

  return { checked, unstable };
}

async function runCycle(cycle: number, startMs: number): Promise<CycleResult> {
  const cycleStart = performance.now();
  const errors: string[] = [];

  let hrpsReport: BenchmarkReport | null = null;
  try {
    hrpsReport = await runHumanRetentionBenchmark();
  } catch (err) {
    errors.push(`HRPS: ${err instanceof Error ? err.message : String(err)}`);
  }

  const perception = runEmotionalClarityTests();
  const golden = runGoldenPromptTests();
  const stability = await checkStability();

  return {
    cycle: cycle,
    elapsedMs: performance.now() - startMs,
    hrps: {
      avgImprovement: hrpsReport?.summary.avgHrpsImprovement ?? 0,
      regressionCount: hrpsReport?.summary.regressionCount ?? -1,
      hrpsWinCount: hrpsReport?.summary.hrpsWinCount ?? 0,
      totalProcessed: hrpsReport?.totalProcessedPrompts ?? 0,
    },
    perception: { passed: perception.passed, failed: perception.failed },
    golden: { passed: golden.passed, failed: golden.failed },
    stability,
    cycleMs: performance.now() - cycleStart,
    errors,
  };
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export async function run15MinSoakBenchmark(): Promise<SoakReport> {
  const startMs = performance.now();
  const deadline = startMs + DURATION_MS;
  const cycleResults: CycleResult[] = [];
  let cycle = 0;

  console.log(`[soak] starting 15-minute benchmark (deadline: ${new Date(Date.now() + DURATION_MS).toISOString()})`);

  while (performance.now() < deadline) {
    cycle += 1;
    const remainingMin = ((deadline - performance.now()) / 60000).toFixed(1);
    console.log(`[soak] cycle ${cycle} starting (${remainingMin} min remaining)`);

    const result = await runCycle(cycle, startMs);
    cycleResults.push(result);

    console.log(
      `[soak] cycle ${cycle} done in ${(result.cycleMs / 1000).toFixed(1)}s — ` +
        `HRPS Δ=${result.hrps.avgImprovement.toFixed(2)} regressions=${result.hrps.regressionCount} ` +
        `stability=${result.stability.checked - result.stability.unstable}/${result.stability.checked}`
    );

    if (result.errors.length) {
      console.log(`[soak] cycle ${cycle} errors: ${result.errors.join("; ")}`);
    }
  }

  const durationMs = performance.now() - startMs;
  const hrpsImprovements = cycleResults.map((c) => c.hrps.avgImprovement);
  const totalHrpsWins = cycleResults.reduce((s, c) => s + c.hrps.hrpsWinCount, 0);
  const totalHrpsComparisons = cycleResults.reduce((s, c) => s + c.hrps.totalProcessed, 0);
  const totalRegressions = cycleResults.reduce((s, c) => s + Math.max(0, c.hrps.regressionCount), 0);
  const stabilityChecks = cycleResults.reduce((s, c) => s + c.stability.checked, 0);
  const stabilityUnstable = cycleResults.reduce((s, c) => s + c.stability.unstable, 0);

  return {
    durationMs,
    cyclesCompleted: cycleResults.length,
    totalHrpsRuns: cycleResults.filter((c) => c.hrps.totalProcessed > 0).length,
    totalPromptsProcessed: totalHrpsComparisons,
    avgCycleMs: avg(cycleResults.map((c) => c.cycleMs)),
    hrps: {
      avgImprovementMean: avg(hrpsImprovements),
      avgImprovementMin: hrpsImprovements.length ? Math.min(...hrpsImprovements) : 0,
      avgImprovementMax: hrpsImprovements.length ? Math.max(...hrpsImprovements) : 0,
      totalRegressions,
      totalHrpsWins,
      winRatePct: totalHrpsComparisons > 0 ? (totalHrpsWins / totalHrpsComparisons) * 100 : 0,
    },
    tests: {
      perceptionFailures: cycleResults.reduce((s, c) => s + c.perception.failed, 0),
      goldenFailures: cycleResults.reduce((s, c) => s + c.golden.failed, 0),
    },
    stability: {
      checks: stabilityChecks,
      unstable: stabilityUnstable,
      stabilityRatePct:
        stabilityChecks > 0
          ? ((stabilityChecks - stabilityUnstable) / stabilityChecks) * 100
          : 100,
    },
    errors: cycleResults.flatMap((c) => c.errors),
    cycleResults,
  };
}

function printSoakReport(report: SoakReport): void {
  console.log("\n========== 15-MINUTE SOAK BENCHMARK REPORT ==========\n");
  console.log(`Duration:              ${(report.durationMs / 60000).toFixed(2)} min`);
  console.log(`Cycles completed:      ${report.cyclesCompleted}`);
  console.log(`HRPS full runs:        ${report.totalHrpsRuns}`);
  console.log(`Total prompts scored:  ${report.totalPromptsProcessed}`);
  console.log(`Avg cycle time:        ${(report.avgCycleMs / 1000).toFixed(1)}s`);
  console.log("\n--- HRPS (current vs baseline) ---");
  console.log(`Avg HRPS improvement:  +${report.hrps.avgImprovementMean.toFixed(2)} (min ${report.hrps.avgImprovementMin.toFixed(2)}, max ${report.hrps.avgImprovementMax.toFixed(2)})`);
  console.log(`HRPS win rate:         ${report.hrps.winRatePct.toFixed(1)}%`);
  console.log(`Total regressions:     ${report.hrps.totalRegressions}`);
  console.log("\n--- Regression suites (cumulative failures) ---");
  console.log(`Perception failures:   ${report.tests.perceptionFailures}`);
  console.log(`Golden failures:       ${report.tests.goldenFailures}`);
  console.log("\n--- Narrative stability (3-run signature check per prompt) ---");
  console.log(`Stable prompts:        ${report.stability.checks - report.stability.unstable} / ${report.stability.checks}`);
  console.log(`Stability rate:        ${report.stability.stabilityRatePct.toFixed(1)}%`);
  if (report.errors.length) {
    console.log(`\n--- Errors (${report.errors.length}) ---`);
    for (const e of report.errors.slice(0, 10)) console.log(`  - ${e}`);
  }
  console.log("\n====================================================\n");
}

async function main(): Promise<void> {
  const report = await run15MinSoakBenchmark();
  printSoakReport(report);

  const hasIssues =
    report.tests.perceptionFailures > 0 ||
    report.tests.goldenFailures > 0 ||
    report.stability.unstable > 0 ||
    report.errors.length > 0;

  if (hasIssues) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[soak] fatal:", err);
    process.exit(1);
  });
}
