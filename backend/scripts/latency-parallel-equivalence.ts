/**
 * Before/after validator for V3_PARALLEL_CANDIDATES.
 *
 * Compares two evaluation-results.jsonl files produced by the playlist evaluation harness
 * against the SAME prompt suite — one from a server started with V3_PARALLEL_CANDIDATES=0
 * (sequential baseline) and one with V3_PARALLEL_CANDIDATES=1 (worker parallel) — and
 * reports:
 *   - functional equivalence: per-prompt delivered track-ID sequences (order-sensitive)
 *   - latency before/after: avg / median / P95 and improvement %
 *
 * This is the authoritative "no quality change" gate for the parallelism work: the worker
 * path is only safe to ship if the delivered playlists are byte-identical to the sequential
 * baseline for every prompt.
 *
 * Usage:
 *   node backend/dist/scripts/latency-parallel-equivalence.js \
 *     --seq reports/playlist-evaluation/latency-seq/evaluation-results.jsonl \
 *     --par reports/playlist-evaluation/latency-par/evaluation-results.jsonl \
 *     [--json]
 */
import { readFileSync } from "node:fs";

type Row = Record<string, any>;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function loadRows(path: string): Row[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row);
}

function promptKey(row: Row): string {
  return String(row?.benchmark?.id ?? row?.benchmark?.prompt ?? row?.id ?? row?.prompt ?? "");
}

function trackSequence(row: Row): string[] {
  const tracks: any[] = Array.isArray(row?.tracks) ? row.tracks : [];
  return tracks
    .map((t) => (typeof t?.trackId === "string" ? t.trackId : typeof t?.id === "string" ? t.id : null))
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

function elapsed(row: Row): number {
  const gm = row?.response?.generationMs;
  if (typeof gm === "number" && Number.isFinite(gm)) return gm;
  return typeof row?.elapsedMs === "number" ? row.elapsedMs : 0;
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function avg(values: number[]): number {
  return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

const seqPath = argValue("--seq");
const parPath = argValue("--par");
if (!seqPath || !parPath) {
  console.error("Usage: latency-parallel-equivalence --seq <jsonl> --par <jsonl> [--json]");
  process.exit(2);
}

const seqRows = loadRows(seqPath).filter((r) => r.ok === true);
const parRows = loadRows(parPath).filter((r) => r.ok === true);
const seqByKey = new Map(seqRows.map((r) => [promptKey(r), r]));
const parByKey = new Map(parRows.map((r) => [promptKey(r), r]));

const matchedKeys = [...seqByKey.keys()].filter((k) => parByKey.has(k));

let identical = 0;
let sameSetDifferentOrder = 0;
let different = 0;
const diffs: Array<{ prompt: string; jaccard: number; seqLen: number; parLen: number }> = [];

for (const key of matchedKeys) {
  const seqSeq = trackSequence(seqByKey.get(key)!);
  const parSeq = trackSequence(parByKey.get(key)!);
  const sameOrder = seqSeq.length === parSeq.length && seqSeq.every((id, i) => id === parSeq[i]);
  if (sameOrder) {
    identical += 1;
  } else {
    const sameSet = seqSeq.length === parSeq.length && new Set(seqSeq).size === new Set([...seqSeq, ...parSeq]).size;
    if (sameSet) sameSetDifferentOrder += 1;
    else different += 1;
    diffs.push({ prompt: key, jaccard: Math.round(jaccard(seqSeq, parSeq) * 1000) / 1000, seqLen: seqSeq.length, parLen: parSeq.length });
  }
}

const seqTimes = matchedKeys.map((k) => elapsed(seqByKey.get(k)!));
const parTimes = matchedKeys.map((k) => elapsed(parByKey.get(k)!));

const report = {
  seqFile: seqPath,
  parFile: parPath,
  matchedPrompts: matchedKeys.length,
  equivalence: {
    identicalOrder: identical,
    sameSetDifferentOrder,
    different,
    equivalentPct: matchedKeys.length ? Math.round((identical / matchedKeys.length) * 1000) / 10 : 0,
    verdict: different === 0 && sameSetDifferentOrder === 0
      ? "IDENTICAL — safe to ship"
      : "DIVERGENCE DETECTED — do not ship until root-caused",
  },
  latency: {
    sequential: { avgMs: avg(seqTimes), medianMs: pct(seqTimes, 50), p95Ms: pct(seqTimes, 95), maxMs: Math.max(0, ...seqTimes) },
    parallel: { avgMs: avg(parTimes), medianMs: pct(parTimes, 50), p95Ms: pct(parTimes, 95), maxMs: Math.max(0, ...parTimes) },
    improvement: {
      avgPct: avg(seqTimes) ? Math.round((1 - avg(parTimes) / avg(seqTimes)) * 1000) / 10 : 0,
      p95Pct: pct(seqTimes, 95) ? Math.round((1 - pct(parTimes, 95) / pct(seqTimes, 95)) * 1000) / 10 : 0,
    },
  },
  worstDivergences: diffs.sort((a, b) => a.jaccard - b.jaccard).slice(0, 10),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
  if (report.equivalence.different > 0 || report.equivalence.sameSetDifferentOrder > 0) {
    process.exit(1);
  }
}
