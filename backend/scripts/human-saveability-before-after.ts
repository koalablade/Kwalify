/**
 * Compare baseline vs post-fix human-saveability overnight benchmark reports.
 *
 * Usage:
 *   npm run benchmark:human-saveability-before-after
 *   npm run benchmark:human-saveability-before-after -- reports/baseline.json reports/after.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const REPORT_DIR = path.resolve(process.cwd(), "reports");
const DEFAULT_BEFORE = path.join(REPORT_DIR, "human-saveability-overnight-baseline.json");
const DEFAULT_AFTER = path.join(REPORT_DIR, "human-saveability-overnight.json");
const OUTPUT = path.join(REPORT_DIR, "human-saveability-before-after.json");

type RunRow = {
  promptId: string;
  seed: number;
  humanSaveable: boolean;
  gateBypassed: boolean;
  curatorScore: number | null;
  executionPath: string | null;
  rejectionReasons: string[];
  pipelineStageResponsible: string | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function summarize(runs: RunRow[]) {
  const valid = runs.filter((r) => r.humanSaveable && !r.gateBypassed);
  const passRate = runs.length > 0 ? valid.length / runs.length : 0;
  const curatorScores = valid
    .map((r) => r.curatorScore)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  const executionPaths = new Map<string, number>();
  const failureCategories = new Map<string, number>();
  for (const row of runs) {
    const pathKey = row.executionPath ?? "unknown";
    executionPaths.set(pathKey, (executionPaths.get(pathKey) ?? 0) + 1);
    if (!row.humanSaveable || row.gateBypassed) {
      const primary = row.rejectionReasons[0] ?? row.pipelineStageResponsible ?? "unknown";
      const key = primary.split(":")[0] ?? "unknown";
      failureCategories.set(key, (failureCategories.get(key) ?? 0) + 1);
    }
  }
  return {
    totalRuns: runs.length,
    passCount: valid.length,
    passRate,
    gateBypassRuns: runs.filter((r) => r.gateBypassed).length,
    medianCuratorScore: median(curatorScores),
    curatorScoreDistribution: {
      min: curatorScores.length > 0 ? Math.min(...curatorScores) : null,
      max: curatorScores.length > 0 ? Math.max(...curatorScores) : null,
      p25: curatorScores.length > 0 ? curatorScores[Math.floor(curatorScores.length * 0.25)] ?? null : null,
      p75: curatorScores.length > 0 ? curatorScores[Math.floor(curatorScores.length * 0.75)] ?? null : null,
    },
    executionPathDistribution: Object.fromEntries([...executionPaths.entries()].sort((a, b) => b[1] - a[1])),
    failureCategories: Object.fromEntries([...failureCategories.entries()].sort((a, b) => b[1] - a[1])),
  };
}

async function main(): Promise<void> {
  const beforePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_BEFORE;
  const afterPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_AFTER;

  const beforeRaw = await readFile(beforePath, "utf8");
  const afterRaw = await readFile(afterPath, "utf8");
  const beforeReport = JSON.parse(beforeRaw) as { runs: RunRow[] };
  const afterReport = JSON.parse(afterRaw) as { runs: RunRow[] };

  const before = summarize(beforeReport.runs ?? []);
  const after = summarize(afterReport.runs ?? []);

  const topRemainingBlockers = Object.entries(after.failureCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cause, count]) => ({ cause, count }));

  const output = {
    generatedAt: new Date().toISOString(),
    beforeReport: beforePath,
    afterReport: afterPath,
    before,
    after,
    delta: {
      passRate: after.passRate - before.passRate,
      medianCuratorScore:
        before.medianCuratorScore != null && after.medianCuratorScore != null
          ? after.medianCuratorScore - before.medianCuratorScore
          : null,
      gateBypassRuns: after.gateBypassRuns - before.gateBypassRuns,
    },
    targetPassRate: 0.8,
    targetMedianCuratorScore: 0.88,
    meetsTarget: after.passRate >= 0.8
      && after.gateBypassRuns === 0
      && (after.medianCuratorScore ?? 0) >= 0.88,
    topRemainingBlockers,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(output, null, 2));
  process.stdout.write(`Wrote ${OUTPUT}\n`);
  process.stdout.write(JSON.stringify({
    beforePassRate: before.passRate,
    afterPassRate: after.passRate,
    deltaPassRate: output.delta.passRate,
    meetsTarget: output.meetsTarget,
    topRemainingBlockers,
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
