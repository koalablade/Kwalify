/**
 * Real vs synthetic benchmark auditor.
 *
 * Compares curated fixture cohort vs adversarial/real simulation cohort.
 * Detects overfitting, inflated scores, hidden collapse cases.
 *
 * Usage:
 *   npm run audit:benchmarks
 *   npm run audit:benchmarks:ci
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { benchmarkAuditorGate, runBenchmarkAuditor } from "../lib/quality-control/benchmark-auditor";

function parseArgs(): { out: string; adversarialLimit: number; seed: number; libraryId: string; ci: boolean; strict: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
  };
  return {
    out: get("--out", "reports/quality/real-vs-synthetic-auditor.json"),
    adversarialLimit: Number(get("--limit", args.includes("--ci") ? "100" : "200")),
    seed: Number(get("--seed", "42")),
    libraryId: get("--library", "uk-electronic-only"),
    ci: args.includes("--ci"),
    strict: args.includes("--strict"),
  };
}

function main(): void {
  const { out, adversarialLimit, seed, libraryId, ci, strict } = parseArgs();
  const report = runBenchmarkAuditor({ adversarialLimit, seed, libraryId });
  const gate = benchmarkAuditorGate(report, strict);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    fixturePassRate: report.fixtureCohort.stressPassRate,
    realSimPassRate: report.realSimulationCohort.stressPassRate,
    passRateGap: report.delta.passRateGap,
    overfittingDetected: report.delta.overfittingDetected,
    inflatedScoresDetected: report.delta.inflatedScoresDetected,
    correctedProductionScore: report.correctedProductionScoreEstimate,
    hiddenCollapseCount: report.hiddenCollapseCases.length,
    meanInflation: report.metricAuditSummary.meanInflation,
    gatePass: gate.pass,
    warnings: gate.warnings,
  }));

  for (const fix of report.recommendedFixes) {
    console.log(JSON.stringify({ recommendedFix: fix }));
  }

  for (const collapse of report.hiddenCollapseCases.slice(0, 8)) {
    console.log(JSON.stringify({ hiddenCollapse: collapse }));
  }

  if (ci && !gate.pass) {
    console.error(`audit:benchmarks strict gate failed: ${gate.reasons.join("; ")}`);
    process.exit(1);
  }

  if (ci && gate.warnings.length > 0) {
    console.log(JSON.stringify({ auditorWarnings: gate.warnings }));
  }

  console.log(`audit:benchmarks complete → ${out}`);
}

main();
