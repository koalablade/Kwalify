/**
 * CI gate: retrieval→final overlap must stay below convergence threshold (#10).
 *
 * Usage:
 *   npm run ci:convergence-overlap
 *   npm run ci:convergence-overlap -- --report reports/prompt-reliability/local/regression-report.json
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_RETRIEVAL_TO_FINAL_OVERLAP = Number.parseFloat(
  process.env["CI_MAX_RETRIEVAL_TO_FINAL_OVERLAP"] ?? "0.55",
);

function setOverlap(a: string[], b: string[]): number | null {
  if (a.length === 0) return null;
  const setB = new Set(b);
  const inter = a.filter((id) => setB.has(id)).length;
  return inter / a.length;
}

function runUnitFixtures(): string[] {
  const failures: string[] = [];
  const healthyRetrieval = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const diverseFinal = ["a", "x", "y", "z", "w", "q"];
  const healthyOverlap = setOverlap(healthyRetrieval, diverseFinal);
  if (healthyOverlap == null || healthyOverlap > MAX_RETRIEVAL_TO_FINAL_OVERLAP) {
    failures.push(`healthy fixture overlap ${healthyOverlap} exceeds ${MAX_RETRIEVAL_TO_FINAL_OVERLAP}`);
  }

  const collapsedFinal = ["a", "b", "c", "d", "e", "f", "g"];
  const collapsedOverlap = setOverlap(healthyRetrieval, collapsedFinal);
  if (collapsedOverlap == null || collapsedOverlap <= MAX_RETRIEVAL_TO_FINAL_OVERLAP) {
    failures.push(`collapsed fixture overlap ${collapsedOverlap} should exceed ${MAX_RETRIEVAL_TO_FINAL_OVERLAP}`);
  }

  return failures;
}

type RegressionRow = {
  promptId?: string;
  prompt?: string;
  convergenceRisk?: string | null;
  retrievalToFinalOverlap?: number | null;
};

async function runReportGate(reportPath: string): Promise<string[]> {
  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw) as { prompts?: RegressionRow[] };
  const failures: string[] = [];
  for (const row of report.prompts ?? []) {
    const overlap = row.retrievalToFinalOverlap;
    if (typeof overlap === "number" && overlap > MAX_RETRIEVAL_TO_FINAL_OVERLAP) {
      failures.push(
        `${row.promptId ?? row.prompt ?? "prompt"} retrievalToFinal=${overlap} > ${MAX_RETRIEVAL_TO_FINAL_OVERLAP}`,
      );
    }
    if (row.convergenceRisk === "critical") {
      failures.push(`${row.promptId ?? row.prompt ?? "prompt"} has critical convergence risk`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : null;

  const failures = runUnitFixtures();
  if (reportPath) {
    failures.push(...await runReportGate(path.resolve(reportPath)));
  }

  const result = {
    pass: failures.length === 0,
    maxRetrievalToFinalOverlap: MAX_RETRIEVAL_TO_FINAL_OVERLAP,
    reportPath: reportPath ?? null,
    failures,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
