/**
 * V3_PARALLEL_CANDIDATES validation report — DISTRIBUTIONAL + STABILITY model.
 *
 * The pipeline is nondeterministic across separate requests by design (candidate seeds are
 * derived from a per-request timestamp + requestId; verified: two sequential runs of the same
 * prompt diverge). Byte-identical track IDs across requests is therefore impossible and is NOT
 * used as the equivalence criterion. Instead we assert:
 *   (a) STABILITY  — across many parallel runs: zero worker failures/timeouts, zero HTTP
 *                    errors/crashes, Pipeline Authority stays clean, degraded rate not worse.
 *   (b) DISTRIBUTION — parallel quality metrics match the sequential baseline (means/medians
 *                    within run-to-run variance), i.e. workers don't change WHAT quality of
 *                    playlist is produced, only how fast.
 *
 * Inputs:
 *   --seq <evaluation-results.jsonl>     sequential baseline (flag off)
 *   --par-dir <dir>                      dir with par-1/, par-2/, ... (flag on, repeated)
 *   --mem <file>                         optional "iso,rssBytes" samples -> peak RSS
 *
 * Exit non-zero if stability gates fail.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

type Row = Record<string, any>;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadRows(file: string): Row[] {
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
}

function gd(row: Row): Record<string, any> {
  return (row?.response?.generationDiagnostics ?? {}) as Record<string, any>;
}
function num(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function metrics(row: Row): Record<string, number | null> {
  const g = gd(row);
  const resp = row?.response ?? {};
  return {
    latencyMs: num(resp.generationMs) ?? num(row.elapsedMs),
    trackCount: num(resp.count) ?? num(resp.totalTracks) ?? (Array.isArray(row.tracks) ? row.tracks.length : null),
    playlistConfidence: num(resp.playlistConfidence),
    humanCoherenceScore: num(g.humanCoherenceScore),
    clusterPurity: num(g.clusterPurity),
    artistReuseRate: num(g.artistReuseRate),
    cohesionScore: num(g.cohesionScore),
    coherenceScore: num(g.coherenceScore),
  };
}
function degraded(row: Row): boolean {
  return row?.response?.degraded === true;
}
function paClean(row: Row): { evaluated: boolean; clean: boolean } {
  const fin = row?.response?.finalization as Record<string, any> | undefined;
  const authority = fin?.pipelineAuthority as Record<string, any> | undefined;
  if (!authority) return { evaluated: false, clean: true };
  const av = authority.authorityValidation as Record<string, any> | undefined;
  return { evaluated: true, clean: av?.pass === true };
}
function telemetry(row: Row): Record<string, any> | null {
  const t = gd(row).v3ParallelExecution;
  return t && typeof t === "object" && t.enabled ? t : null;
}

const pct = (v: number[], p: number): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const stdev = (v: number[]): number => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

function collect(rows: Row[], key: string): number[] {
  return rows.map((r) => metrics(r)[key]).filter((n): n is number => n !== null);
}
function dist(rows: Row[], key: string) {
  const v = collect(rows, key);
  return { n: v.length, mean: round(mean(v)), median: round(pct(v, 50)), p95: round(pct(v, 95)), stdev: round(stdev(v)) };
}

const seqFile = arg("--seq");
const parDir = arg("--par-dir");
if (!seqFile || !parDir) {
  console.error("Usage: parallel-validation-report --seq <jsonl> --par-dir <dir> [--mem <file>]");
  process.exit(2);
}

const seqAll = loadRows(seqFile);
const seqOk = seqAll.filter((r) => r.ok === true);

const parRunDirs = readdirSync(parDir)
  .filter((d) => existsSync(path.join(parDir, d, "evaluation-results.jsonl")))
  .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

const parRuns = parRunDirs.map((d) => ({ name: d, rows: loadRows(path.join(parDir, d, "evaluation-results.jsonl")) }));
const parAll = parRuns.flatMap((r) => r.rows);
const parOk = parAll.filter((r) => r.ok === true);

// ── stability ────────────────────────────────────────────────────────────────
const httpFailures = parAll.filter((r) => r.ok !== true).length;
let workerSucceeded = 0, workerFailed = 0, workerTimedOut = 0, workersSpawned = 0, tasksDispatched = 0,
    winnerRecomputedGens = 0, mainThreadFallbacks = 0, gensWithWorkers = 0, gensWithoutTelemetry = 0;
for (const r of parOk) {
  const t = telemetry(r);
  if (!t) { gensWithoutTelemetry += 1; continue; }
  gensWithWorkers += 1;
  workerSucceeded += t.workerSucceeded ?? 0;
  workerFailed += t.workerFailed ?? 0;
  workerTimedOut += t.workerTimedOut ?? 0;
  workersSpawned += t.workersSpawned ?? 0;
  tasksDispatched += t.tasksDispatched ?? 0;
  if (t.winnerRecomputed) winnerRecomputedGens += 1;
  mainThreadFallbacks += t.mainThreadFallbacks ?? 0;
}
const seqPa = seqOk.map(paClean);
const parPa = parOk.map(paClean);
const paFailuresPar = parPa.filter((p) => p.evaluated && !p.clean).length;
const paFailuresSeq = seqPa.filter((p) => p.evaluated && !p.clean).length;
const degradedSeq = seqOk.filter(degraded).length;
const degradedPar = parOk.filter(degraded).length;
const degradedRateSeq = seqOk.length ? degradedSeq / seqOk.length : 0;
const degradedRatePar = parOk.length ? degradedPar / parOk.length : 0;
// Degradation reasons that indicate CPU/health load-shedding (expected to DROP under
// parallelism, since work finishes before the health monitor trips).
const OVERLOAD_REASON = /system_health_degraded|bypassed_overload/;
function overloadDegraded(rows: Row[]): number {
  return rows.filter((r) => (r?.response?.degradationReasons ?? []).some((x: string) => OVERLOAD_REASON.test(x))).length;
}
const overloadSeq = overloadDegraded(seqOk);
const overloadPar = overloadDegraded(parOk);

// ── distributions ──────────────────────────────────────────────────────────
const metricKeys = ["latencyMs", "trackCount", "playlistConfidence", "humanCoherenceScore", "clusterPurity", "artistReuseRate", "cohesionScore", "coherenceScore"];
const distribution: Record<string, any> = {};
for (const k of metricKeys) {
  const s = dist(seqOk, k);
  const p = dist(parOk, k);
  const meanDeltaPct = s.mean ? round(((p.mean - s.mean) / s.mean) * 100, 2) : 0;
  distribution[k] = { sequential: s, parallel: p, meanDeltaPct };
}

// ── verdict ──────────────────────────────────────────────────────────────────
const workerFailuresTotal = workerFailed + workerTimedOut;
const stabilityClean =
  httpFailures === 0 &&
  workerFailuresTotal === 0 &&
  paFailuresPar === 0 &&
  degradedRatePar <= degradedRateSeq + 0.02; // parallelism must not increase the degraded RATE

// quality distributions comparable: parallel mean within 3x seq-stdev of seq mean (or ~5% rel)
const qualityKeys = ["playlistConfidence", "humanCoherenceScore", "clusterPurity", "cohesionScore", "coherenceScore"];
const qualityDrift = qualityKeys.filter((k) => {
  const d = distribution[k];
  if (!d || d.sequential.n < 2) return false;
  const tol = Math.max(3 * d.sequential.stdev, Math.abs(d.sequential.mean) * 0.05);
  return Math.abs(d.parallel.mean - d.sequential.mean) > tol;
});

let peakRssMb: number | null = null;
const memFile = arg("--mem");
if (memFile && existsSync(memFile)) {
  const bytes = readFileSync(memFile, "utf8").trim().split(/\r?\n/).filter(Boolean)
    .map((l) => Number(l.split(/[,\s]+/).pop())).filter((n) => Number.isFinite(n));
  if (bytes.length) peakRssMb = Math.round(Math.max(...bytes) / (1024 * 1024));
}

const report = {
  seqFile,
  parDir,
  runs: { sequential: 1, parallel: parRuns.length, promptsPerRun: seqAll.length },
  counts: { seqOk: seqOk.length, parOk: parOk.length, parTotal: parAll.length },
  stability: {
    httpFailures,
    workerFailed,
    workerTimedOut,
    pipelineAuthorityFailures: { sequential: paFailuresSeq, parallel: paFailuresPar },
    degradedRate: { sequential: round(degradedRateSeq, 3), parallel: round(degradedRatePar, 3) },
    overloadDegradations: { sequential: overloadSeq, parallel: overloadPar },
    clean: stabilityClean,
  },
  workers: {
    generationsUsingWorkers: gensWithWorkers,
    generationsWithoutTelemetry: gensWithoutTelemetry,
    tasksDispatched,
    workersSpawned,
    workerSucceeded,
    workerFailed,
    workerTimedOut,
    winnerRecomputedGens,
    mainThreadFallbacks,
    avgWorkersPerGen: gensWithWorkers ? round(workersSpawned / gensWithWorkers, 1) : 0,
  },
  latency: {
    sequential: dist(seqOk, "latencyMs"),
    parallel: dist(parOk, "latencyMs"),
    improvement: {
      avgPct: dist(seqOk, "latencyMs").mean ? round((1 - dist(parOk, "latencyMs").mean / dist(seqOk, "latencyMs").mean) * 100, 1) : 0,
      p95Pct: dist(seqOk, "latencyMs").p95 ? round((1 - dist(parOk, "latencyMs").p95 / dist(seqOk, "latencyMs").p95) * 100, 1) : 0,
    },
  },
  qualityDistributions: distribution,
  qualityDrift,
  peakRssMb,
  verdict:
    stabilityClean && qualityDrift.length === 0
      ? "PRODUCTION-READY — stable across all parallel runs (no worker failures/timeouts, PA clean, no HTTP errors, degraded not worse) and quality distributions match the sequential baseline"
      : "NOT PRODUCTION-READY — see stability / qualityDrift",
};

console.log(JSON.stringify(report, null, 2));
if (!(stabilityClean && qualityDrift.length === 0)) process.exit(1);
