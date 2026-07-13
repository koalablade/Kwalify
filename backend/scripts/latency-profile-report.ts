/**
 * Evidence-driven latency profile from an existing evaluation-results.jsonl.
 * Aggregates the pipeline's own timing telemetry (no new instrumentation).
 * Usage: npx tsx backend/scripts/latency-profile-report.ts --from <jsonl>
 */
import { readFileSync } from "node:fs";

const fromIndex = process.argv.indexOf("--from");
const path = fromIndex >= 0 ? process.argv[fromIndex + 1]! : "";
if (!path) throw new Error("--from <jsonl> required");

type Row = Record<string, any>;

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}
function avg(values: number[]): number {
  return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
}

const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
const rows: Row[] = lines.map((l) => JSON.parse(l));
const ok = rows.filter((r) => r.ok === true && r.response?.generationDiagnostics?.timingMs);

const totals: number[] = [];
const v3LoopMs: number[] = [];
const poolBuildMs: number[] = [];
const retrievalMs: number[] = [];
const preV3Ms: number[] = [];
const repairMs: number[] = [];
const invocationCounts: number[] = [];
const avgInvocation: number[] = [];
const poolSizes: number[] = [];

const byInvocation = new Map<number, number[]>();

for (const r of ok) {
  const gd = r.response.generationDiagnostics;
  const t = gd.timingMs;
  const prof = gd.v3PipelineTimingProfile ?? {};
  const total = t.total ?? r.response.generationMs ?? r.elapsedMs;
  totals.push(total);
  v3LoopMs.push(t.v3MultiCandidateLoop ?? t.v3Pipeline?.v3ScoringAndSampling ?? 0);
  poolBuildMs.push(t.candidatePoolBuild ?? 0);
  retrievalMs.push(t.retrieval ?? 0);
  preV3Ms.push(t.preV3?.totalBeforeV3Ms ?? 0);
  repairMs.push(t.repair ?? 0);
  const inv = prof.invocationCount ?? 0;
  invocationCounts.push(inv);
  avgInvocation.push(prof.avgInvocationMs ?? 0);
  poolSizes.push(prof.poolSize ?? 0);
  const bucket = byInvocation.get(inv) ?? [];
  bucket.push(total);
  byInvocation.set(inv, bucket);
}

const report = {
  path,
  okGenerations: ok.length,
  totalMs: { avg: avg(totals), median: pct(totals, 50), p95: pct(totals, 95), max: Math.max(...totals) },
  stageShareOfTotal: {
    v3MultiCandidateLoop: `${Math.round((avg(v3LoopMs) / avg(totals)) * 100)}%`,
    candidatePoolBuild: `${Math.round((avg(poolBuildMs) / avg(totals)) * 100)}%`,
    retrieval: `${Math.round((avg(retrievalMs) / avg(totals)) * 100)}%`,
    preV3: `${Math.round((avg(preV3Ms) / avg(totals)) * 100)}%`,
    repair: `${Math.round((avg(repairMs) / avg(totals)) * 100)}%`,
  },
  stageAvgMs: {
    v3MultiCandidateLoop: avg(v3LoopMs),
    candidatePoolBuild: avg(poolBuildMs),
    retrieval: avg(retrievalMs),
    preV3: avg(preV3Ms),
    repair: avg(repairMs),
  },
  v3Invocations: {
    avg: avg(invocationCounts),
    median: pct(invocationCounts, 50),
    max: Math.max(...invocationCounts),
    min: Math.min(...invocationCounts),
    avgMsPerInvocation: avg(avgInvocation),
    avgPoolSize: avg(poolSizes),
  },
  totalByInvocationCount: Object.fromEntries(
    [...byInvocation.entries()].sort((a, b) => a[0] - b[0]).map(([inv, list]) => [
      inv,
      { count: list.length, avgTotalMs: avg(list) },
    ]),
  ),
};

console.log(JSON.stringify(report, null, 2));
