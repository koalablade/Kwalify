/**
 * Resilient overnight Human Experience benchmark — batched, resumable, measurement-only.
 *
 * Usage:
 *   npm run benchmark:human-experience-overnight
 *   npm run benchmark:human-experience-overnight:resume
 *   node backend/dist/scripts/run-human-experience-audit-overnight.js --batch-size 100 --max-batches 5
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  AUDIT_DIMENSIONS,
  auditBenchmarkCase,
  type AuditCaseRecord,
  type AuditDimension,
  type FailureCategory,
} from "../lib/world-understanding/human-experience-audit";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_OUT_DIR = "backend/reports/human-experience-overnight";
const HEAP_PRESSURE_RATIO = 0.82;
const HEAP_PRESSURE_BYTES = 700 * 1024 * 1024;

interface BenchmarkPrompt {
  prompt: string;
  category: string;
  style: string;
}

interface ProgressFile {
  version: 1;
  startedAt: string;
  lastUpdatedAt: string;
  outDir: string;
  benchmarkPath: string;
  totalPrompts: number;
  batchSize: number;
  lastCompletedBatch: number;
  casesCompleted: number;
  concurrency: number;
  running: boolean;
  crashRecoveryEnabled: true;
  aggregate: {
    dimensionTotals: Record<AuditDimension, number>;
    failureSummary: Record<FailureCategory, number>;
    scoreSum: number;
    scoreMin: number;
    scoreMax: number;
    caseErrors: number;
    passed: number;
    failed: number;
  };
}

interface BatchReport {
  batchNumber: number;
  caseRange: { from: number; to: number };
  casesCompleted: number;
  startedAt: string;
  completedAt: string;
  processingTimeMs: number;
  averageScore: number;
  lowestScore: number;
  highestScore: number;
  passed: number;
  failed: number;
  caseErrors: number;
  commonFailures: Array<{ weakness: FailureCategory; count: number }>;
  engineImprovementsSuggested: string[];
  dimensionAverages: Record<AuditDimension, number>;
}

function parseArgs(): {
  batchSize: number;
  outDir: string;
  resume: boolean;
  maxBatches?: number;
  fresh: boolean;
  benchmarkPath: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
  };
  const has = (flag: string) => args.includes(flag);
  const maxBatchesRaw = get("--max-batches", "");
  return {
    batchSize: Number(get("--batch-size", String(DEFAULT_BATCH_SIZE))),
    outDir: get("--out-dir", DEFAULT_OUT_DIR),
    benchmarkPath: get(
      "--benchmark-path",
      join(__dirname, "../../tests/human-experience-benchmark.json"),
    ),
    resume: has("--resume"),
    fresh: has("--fresh"),
    maxBatches: maxBatchesRaw ? Number(maxBatchesRaw) : undefined,
  };
}

function loadPromptSlice(
  benchmarkFile: string,
  offset: number,
  limit: number,
): { total: number; prompts: BenchmarkPrompt[] } {
  if (!existsSync(benchmarkFile)) {
    throw new Error(`Benchmark file not found: ${benchmarkFile}`);
  }
  const raw = JSON.parse(readFileSync(benchmarkFile, "utf8")) as {
    prompts: BenchmarkPrompt[];
    count?: number;
  };
  const total = raw.count ?? raw.prompts.length;
  const prompts = raw.prompts.slice(offset, offset + limit);
  return { total, prompts };
}

function emptyAggregate(): ProgressFile["aggregate"] {
  return {
    dimensionTotals: Object.fromEntries(AUDIT_DIMENSIONS.map((d) => [d, 0])) as Record<
      AuditDimension,
      number
    >,
    failureSummary: {
      wrong_experience: 0,
      missing_concept: 0,
      priority_mistake: 0,
      phrase_interpretation_failure: 0,
      multi_hop_failure: 0,
      emotional_arc_failure: 0,
    },
    scoreSum: 0,
    scoreMin: 1,
    scoreMax: 0,
    caseErrors: 0,
    passed: 0,
    failed: 0,
  };
}

function progressPath(outDir: string): string {
  return join(outDir, "progress.json");
}

function loadProgress(outDir: string, fresh: boolean): ProgressFile | null {
  const path = progressPath(outDir);
  if (fresh || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ProgressFile;
}

function saveProgress(outDir: string, progress: ProgressFile): void {
  progress.lastUpdatedAt = new Date().toISOString();
  writeFileSync(progressPath(outDir), JSON.stringify(progress, null, 2), "utf8");
}

function heapPressure(): boolean {
  const mem = process.memoryUsage();
  const ratio = mem.heapUsed / Math.max(mem.heapTotal, 1);
  return ratio > HEAP_PRESSURE_RATIO || mem.heapUsed > HEAP_PRESSURE_BYTES;
}

function summariseBatch(cases: AuditCaseRecord[]): Omit<BatchReport, "batchNumber" | "caseRange" | "startedAt" | "completedAt" | "processingTimeMs" | "casesCompleted"> {
  const scores = cases.map((c) => c.overallScore);
  const failureCounts = new Map<FailureCategory, number>();
  const suggestionCounts = new Map<string, number>();
  const dimensionTotals = Object.fromEntries(AUDIT_DIMENSIONS.map((d) => [d, 0])) as Record<
    AuditDimension,
    number
  >;

  let passed = 0;
  let failed = 0;
  let caseErrors = 0;

  for (const c of cases) {
    if (c.error) caseErrors += 1;
    if (c.passed) passed += 1;
    else failed += 1;
    for (const w of c.weaknesses) {
      failureCounts.set(w, (failureCounts.get(w) ?? 0) + 1);
    }
    for (const s of c.improvementSuggestions) {
      suggestionCounts.set(s, (suggestionCounts.get(s) ?? 0) + 1);
    }
    for (const d of c.scoreBreakdown) {
      dimensionTotals[d.dimension] += d.score;
    }
  }

  const n = Math.max(cases.length, 1);
  const dimensionAverages = Object.fromEntries(
    AUDIT_DIMENSIONS.map((d) => [d, Math.round((dimensionTotals[d] / n) * 1000) / 1000]),
  ) as Record<AuditDimension, number>;

  return {
    averageScore: Math.round((scores.reduce((a, b) => a + b, 0) / n) * 1000) / 1000,
    lowestScore: scores.length ? Math.min(...scores) : 0,
    highestScore: scores.length ? Math.max(...scores) : 0,
    passed,
    failed,
    caseErrors,
    commonFailures: [...failureCounts.entries()]
      .map(([weakness, count]) => ({ weakness, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    engineImprovementsSuggested: [...suggestionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([s]) => s),
    dimensionAverages,
  };
}

function mergeAggregate(
  agg: ProgressFile["aggregate"],
  cases: AuditCaseRecord[],
): void {
  for (const c of cases) {
    agg.scoreSum += c.overallScore;
    agg.scoreMin = Math.min(agg.scoreMin, c.overallScore);
    agg.scoreMax = Math.max(agg.scoreMax, c.overallScore);
    if (c.error) agg.caseErrors += 1;
    if (c.passed) agg.passed += 1;
    else agg.failed += 1;
    for (const w of c.weaknesses) {
      agg.failureSummary[w] += 1;
    }
    for (const d of c.scoreBreakdown) {
      agg.dimensionTotals[d.dimension] += d.score;
    }
  }
}

function logBatchComplete(report: BatchReport): void {
  const lines = [
    "",
    "BATCH COMPLETE:",
    `Batch number: ${report.batchNumber}`,
    `Cases completed: ${report.casesCompleted} (range ${report.caseRange.from}-${report.caseRange.to})`,
    `Average score: ${report.averageScore}`,
    `Lowest score: ${report.lowestScore}`,
    `Highest score: ${report.highestScore}`,
    `Passed: ${report.passed} | Failed: ${report.failed} | Errors: ${report.caseErrors}`,
    `Processing time: ${(report.processingTimeMs / 1000).toFixed(1)}s`,
    `Common failures: ${report.commonFailures.map((f) => `${f.weakness}(${f.count})`).join(", ") || "none"}`,
    `Engine improvements suggested: ${report.engineImprovementsSuggested.slice(0, 5).join(" | ") || "none"}`,
    "",
  ];
  process.stderr.write(lines.join("\n"));
}

function runBatch(
  progress: ProgressFile,
  batchNumber: number,
  outDir: string,
): BatchReport {
  const batchSize = progress.batchSize;
  const offset = (batchNumber - 1) * batchSize;
  const { total, prompts } = loadPromptSlice(progress.benchmarkPath, offset, batchSize);
  if (prompts.length === 0) {
    throw new Error(`No prompts for batch ${batchNumber} (offset ${offset})`);
  }

  const startedAt = new Date().toISOString();
  const batchStarted = Date.now();
  const cases: AuditCaseRecord[] = [];
  const failuresPath = join(outDir, "failures.jsonl");

  let concurrency = progress.concurrency;
  if (heapPressure()) {
    concurrency = 1;
    progress.concurrency = 1;
    process.stderr.write(
      `[overnight-audit] Memory pressure detected — concurrency reduced to 1\n`,
    );
  }

  for (let i = 0; i < prompts.length; i++) {
    const { prompt, category, style } = prompts[i]!;
    const globalIndex = offset + i;
    const caseRecord = auditBenchmarkCase(prompt, category, style ?? category, globalIndex);
    cases.push(caseRecord);

    if (!caseRecord.passed || caseRecord.error) {
      appendFileSync(failuresPath, `${JSON.stringify(caseRecord)}\n`, "utf8");
    }

    if (heapPressure() && concurrency > 1) {
      concurrency = 1;
      progress.concurrency = 1;
    }
  }

  const summary = summariseBatch(cases);
  const completedAt = new Date().toISOString();
  const processingTimeMs = Date.now() - batchStarted;

  const report: BatchReport = {
    batchNumber,
    caseRange: { from: offset, to: offset + prompts.length - 1 },
    casesCompleted: progress.casesCompleted + prompts.length,
    startedAt,
    completedAt,
    processingTimeMs,
    ...summary,
  };

  const batchDir = join(outDir, "batches");
  mkdirSync(batchDir, { recursive: true });
  const batchFile = join(batchDir, `batch-${String(batchNumber).padStart(4, "0")}.json`);
  writeFileSync(
    batchFile,
    JSON.stringify({ ...report, cases }, null, 2),
    "utf8",
  );

  mergeAggregate(progress.aggregate, cases);
  progress.lastCompletedBatch = batchNumber;
  progress.casesCompleted += prompts.length;
  progress.running = true;
  saveProgress(outDir, progress);

  logBatchComplete(report);

  if (offset + prompts.length >= total) {
    progress.running = false;
    saveProgress(outDir, progress);
    writeFinalSummary(outDir, progress);
  }

  return report;
}

function writeFinalSummary(outDir: string, progress: ProgressFile): void {
  const n = Math.max(progress.casesCompleted, 1);
  const agg = progress.aggregate;
  const accuracy = Object.fromEntries(
    AUDIT_DIMENSIONS.map((d) => [d, Math.round((agg.dimensionTotals[d] / n) * 1000) / 1000]),
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    total_cases: progress.casesCompleted,
    batches_completed: progress.lastCompletedBatch,
    average_overall_score: Math.round((agg.scoreSum / n) * 1000) / 1000,
    score_range: { min: agg.scoreMin, max: agg.scoreMax },
    passed: agg.passed,
    failed: agg.failed,
    case_errors: agg.caseErrors,
    accuracy,
    accuracy_pct: Object.fromEntries(
      AUDIT_DIMENSIONS.map((d) => [d, Math.round(accuracy[d] * 1000) / 10]),
    ),
    failure_summary: agg.failureSummary,
    weakest_dimensions: AUDIT_DIMENSIONS.map((d) => ({
      dimension: d,
      pct: Math.round(accuracy[d] * 1000) / 10,
    })).sort((a, b) => a.pct - b.pct),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  process.stderr.write(`[overnight-audit] Final summary written to ${join(outDir, "summary.json")}\n`);
}

function main(): void {
  const { batchSize, outDir, resume, maxBatches, fresh, benchmarkPath } = parseArgs();
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "batches"), { recursive: true });

  const existing = loadProgress(outDir, fresh);
  const { total } = loadPromptSlice(benchmarkPath, 0, 1);
  const totalBatches = Math.ceil(total / batchSize);

  let progress: ProgressFile;
  if (existing && resume && !fresh) {
    progress = existing;
    process.stderr.write(
      `[overnight-audit] Resuming from batch ${progress.lastCompletedBatch + 1} (${progress.casesCompleted}/${total} cases)\n`,
    );
  } else {
    progress = {
      version: 1,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      outDir,
      benchmarkPath,
      totalPrompts: total,
      batchSize,
      lastCompletedBatch: 0,
      casesCompleted: 0,
      concurrency: 1,
      running: true,
      crashRecoveryEnabled: true,
      aggregate: emptyAggregate(),
    };
    saveProgress(outDir, progress);
    process.stderr.write(
      `[overnight-audit] Starting fresh — ${total} prompts, ${totalBatches} batches of ${batchSize}\n`,
    );
  }

  process.stderr.write(`[overnight-audit] Storage: ${outDir}\n`);
  process.stderr.write(`[overnight-audit] Benchmark: ${benchmarkPath}\n`);
  process.stderr.write(`[overnight-audit] Crash recovery: enabled (progress.json)\n`);

  let batchNumber = progress.lastCompletedBatch + 1;
  let batchesRun = 0;

  while (batchNumber <= totalBatches) {
    if (maxBatches !== undefined && batchesRun >= maxBatches) {
      process.stderr.write(`[overnight-audit] Reached --max-batches ${maxBatches}, stopping.\n`);
      break;
    }
    try {
      runBatch(progress, batchNumber, outDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[overnight-audit] Batch ${batchNumber} fatal error: ${message}\n`);
      progress.running = false;
      saveProgress(outDir, progress);
      process.exitCode = 1;
      break;
    }
    batchNumber += 1;
    batchesRun += 1;
  }

  if (progress.casesCompleted >= total) {
    process.stderr.write(`[overnight-audit] All ${total} cases complete.\n`);
  } else {
    process.stderr.write(
      `[overnight-audit] Paused at ${progress.casesCompleted}/${total} — resume with --resume\n`,
    );
  }
}

main();
