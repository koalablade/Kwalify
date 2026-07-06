/**
 * Human Retention Proxy Benchmark (HRPS)
 *
 * Measurement-only harness — does NOT modify production generation, scoring,
 * sequencing, or UX. Evaluates narrative-layer outputs against a frozen baseline.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import {
  buildPerceptionSnapshot,
  PERCEPTION_FIXED_PHASES,
} from "../lib/perception-fixture";
import { computeEmotionalConsistencyScore } from "../lib/emotional-consistency-score";
import { classifyArcDirection } from "../lib/emotional-invariance";
import type { EmotionalSequencePhases } from "../lib/emotional-sequencing";

// ── Fixed benchmark prompt set ────────────────────────────────────────────────

export const BENCHMARK_PROMPTS = [
  "chill evening",
  "late night overthinking",
  "gym motivation",
  "focus deep work",
  "breakup sadness",
  "getting ready to go out",
  "sunday reset cleaning",
  "road trip drive",
  "happy summer energy",
  "anxious stress relief",
  "nostalgic memories",
  "emotional calm wind-down",
] as const;

export const EXPECTED_PROMPT_COUNT = BENCHMARK_PROMPTS.length;

const BASELINE_SNAPSHOT_PATH = join(__dirname, "benchmark-baseline.snapshot.json");

// ── Structured record (extracted fields only) ─────────────────────────────────

export interface BenchmarkNarrative {
  momentLabel: string;
  summary: string;
  arcSummary: string;
}

export interface BenchmarkRecord {
  prompt: string;
  primaryNarrative: BenchmarkNarrative;
  emotionalConsistencyScore: number;
  syncQualityLabel: string | null;
  momentSignature: string | null;
  trackCount: number;
}

export interface BenchmarkScores {
  clarity: number;
  coherence: number;
  specificity: number;
  stability: number;
  hrps: number;
}

export interface BenchmarkComparisonRow {
  prompt: string;
  old: BenchmarkScores;
  new: BenchmarkScores;
  notes: string[];
}

// ── Baseline (mock legacy / cached snapshot) ────────────────────────────────

/** Represents pre-narrative-layer generic outputs — benchmark-only mock. */
function buildBaselineMock(prompt: string): BenchmarkRecord {
  const genericByPrompt: Record<string, string> = {
    "chill evening": "chill vibes",
    "late night overthinking": "relaxing music",
    "gym motivation": "workout energy mix",
    "focus deep work": "focus playlist",
    "breakup sadness": "sad songs",
    "getting ready to go out": "party vibes",
    "sunday reset cleaning": "feel-good mix",
    "road trip drive": "driving music",
    "happy summer energy": "good vibes",
    "anxious stress relief": "calm playlist",
    "nostalgic memories": "throwback hits",
    "emotional calm wind-down": "relaxing music",
  };

  return {
    prompt,
    primaryNarrative: {
      momentLabel: genericByPrompt[prompt] ?? "relaxing music",
      summary: "Built for your moment with a balanced mood and energy throughout.",
      arcSummary:
        "Tracks are ordered to ease in, lift, and settle without jarring jumps.",
    },
    emotionalConsistencyScore: 52,
    syncQualityLabel: null,
    momentSignature: "baseline-generic-v0",
    trackCount: 20,
  };
}

function loadBaselineSnapshot(): Record<string, BenchmarkRecord> {
  if (!existsSync(BASELINE_SNAPSHOT_PATH)) {
    const generated: Record<string, BenchmarkRecord> = {};
    for (const prompt of BENCHMARK_PROMPTS) {
      generated[prompt] = buildBaselineMock(prompt);
    }
    return generated;
  }

  const raw = JSON.parse(readFileSync(BASELINE_SNAPSHOT_PATH, "utf8")) as {
    records: BenchmarkRecord[];
  };
  const map: Record<string, BenchmarkRecord> = {};
  for (const record of raw.records ?? []) {
    map[record.prompt] = record;
  }
  for (const prompt of BENCHMARK_PROMPTS) {
    if (!map[prompt]) map[prompt] = buildBaselineMock(prompt);
  }
  return map;
}

function validateBaselineRecord(record: BenchmarkRecord, prompt: string): void {
  if (record.prompt !== prompt) {
    throw new Error(
      `[benchmark] baseline record prompt mismatch: expected "${prompt}", got "${record.prompt}"`
    );
  }
  if (!record.primaryNarrative?.momentLabel?.trim()) {
    throw new Error(`[benchmark] baseline missing momentLabel for "${prompt}"`);
  }
  if (typeof record.primaryNarrative.summary !== "string") {
    throw new Error(`[benchmark] baseline missing summary for "${prompt}"`);
  }
  if (typeof record.primaryNarrative.arcSummary !== "string") {
    throw new Error(`[benchmark] baseline missing arcSummary for "${prompt}"`);
  }
  if (!Number.isFinite(record.emotionalConsistencyScore)) {
    throw new Error(`[benchmark] baseline missing emotionalConsistencyScore for "${prompt}"`);
  }
  if (!Number.isFinite(record.trackCount) || record.trackCount < 1) {
    throw new Error(`[benchmark] baseline invalid trackCount for "${prompt}"`);
  }
}

/** Synchronous load + validation — must pass before the prompt loop starts. */
export function validateBaselineSnapshot(
  baselines: Record<string, BenchmarkRecord>
): void {
  const missing = BENCHMARK_PROMPTS.filter((prompt) => !baselines[prompt]);
  if (missing.length > 0) {
    throw new Error(
      `[benchmark] baseline snapshot missing ${missing.length} prompt(s): ${missing.join(", ")}`
    );
  }

  for (const prompt of BENCHMARK_PROMPTS) {
    validateBaselineRecord(baselines[prompt]!, prompt);
  }
}

/** Optional: persist baseline snapshot for reproducible comparisons. */
export function writeBaselineSnapshot(): void {
  const records = BENCHMARK_PROMPTS.map((prompt) => buildBaselineMock(prompt));
  writeFileSync(
    BASELINE_SNAPSHOT_PATH,
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), records }, null, 2),
    "utf8"
  );
}

// ── Current system collection (read-only imports) ───────────────────────────

function syntheticTracks(phases: EmotionalSequencePhases, targetEnergy: number) {
  const total = phases.intro + phases.build + phases.peak + phases.cooldown;
  const tracks: Array<{ energy: number; score: number }> = [];

  for (let i = 0; i < total; i++) {
    let energy = targetEnergy;
    if (i < phases.intro) energy = targetEnergy * 0.72;
    else if (i < phases.intro + phases.build) {
      const t = (i - phases.intro) / Math.max(1, phases.build);
      energy = targetEnergy * (0.78 + t * 0.18);
    } else if (i < phases.intro + phases.build + phases.peak) {
      energy = Math.min(1, targetEnergy * 1.12);
    } else {
      const t = (i - phases.intro - phases.build - phases.peak) / Math.max(1, phases.cooldown);
      energy = targetEnergy * (0.95 - t * 0.22);
    }
    tracks.push({ energy, score: 0.7 + energy * 0.15 });
  }

  return tracks;
}

function energyVariance(tracks: Array<{ energy: number }>): number {
  if (!tracks.length) return 0;
  const values = tracks.map((t) => t.energy);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function collectCurrentOutputSync(prompt: string): BenchmarkRecord {
  const snapshot = buildPerceptionSnapshot(prompt);
  const pipeline = analyzeMomentPipeline(prompt);
  const tracks = syntheticTracks(PERCEPTION_FIXED_PHASES, pipeline.profile.energy);
  const consistency = computeEmotionalConsistencyScore({
    tracks,
    sceneConfidence: pipeline.canonicalScene?.confidence ?? null,
    hasCanonicalScene: !!pipeline.canonicalScene?.sceneId,
  });

  return {
    prompt,
    primaryNarrative: {
      momentLabel: snapshot.primaryNarrative.momentLabel,
      summary: snapshot.primaryNarrative.summary,
      arcSummary: snapshot.primaryNarrative.arcSummary,
    },
    emotionalConsistencyScore: consistency.score,
    syncQualityLabel: null,
    momentSignature: snapshot.identitySignature,
    trackCount: tracks.length,
  };
}

/** Async wrapper — ensures each prompt is awaited sequentially in the runner. */
export async function collectCurrentOutput(prompt: string): Promise<BenchmarkRecord> {
  await Promise.resolve();
  return collectCurrentOutputSync(prompt);
}

function collectStabilitySignatures(prompt: string): string[] {
  const runs = [
    buildPerceptionSnapshot(prompt).identitySignature,
    buildPerceptionSnapshot(prompt).identitySignature,
    buildPerceptionSnapshot(prompt).identitySignature,
  ];
  return runs;
}

// ── Deterministic scoring (no LLM) ──────────────────────────────────────────

const GENERIC_LABEL_PATTERNS = [
  /^chill vibes?$/i,
  /^relaxing music$/i,
  /^good vibes$/i,
  /^focus playlist$/i,
  /^sad songs$/i,
  /^party vibes$/i,
  /^feel-good mix$/i,
  /^driving music$/i,
  /^calm playlist$/i,
  /^throwback hits$/i,
  /^workout energy mix$/i,
];

function scoreNarrativeClarity(record: BenchmarkRecord): number {
  let score = 0;
  const label = record.primaryNarrative.momentLabel.trim();

  if (label.length > 2) score += 2;
  if (label.split(/\s+/).length >= 3) score += 2;

  const arcDirection = classifyArcDirection(
    record.primaryNarrative.arcSummary,
    PERCEPTION_FIXED_PHASES
  );
  if (arcDirection === "rise_peak_fall") score += 4;
  else if (arcDirection === "rise" || arcDirection === "fall") score += 2.5;
  else score += 1;

  if (record.primaryNarrative.summary.length > 20) score += 1.5;

  return roundScore(Math.min(10, score));
}

function scoreEmotionalCoherence(
  record: BenchmarkRecord,
  tracks: Array<{ energy: number }>
): number {
  const consistencyPart = (record.emotionalConsistencyScore / 100) * 6;
  const variance = energyVariance(tracks);
  const stabilityPart = Math.max(0, 3 - variance * 8);

  const arcDirection = classifyArcDirection(
    record.primaryNarrative.arcSummary,
    PERCEPTION_FIXED_PHASES
  );
  const arcPart = arcDirection === "rise_peak_fall" ? 1.5 : arcDirection === "flat" ? 0 : 0.8;

  return roundScore(Math.min(10, consistencyPart + stabilityPart + arcPart));
}

function scoreSpecificity(record: BenchmarkRecord): number {
  const label = record.primaryNarrative.momentLabel.trim().toLowerCase();

  if (GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(label))) {
    return 2;
  }

  const words = label.split(/\s+/).filter((w) => w.length > 1);
  let score = 2 + Math.min(4, words.length * 0.9);

  const situationalTokens = [
    "night",
    "gym",
    "work",
    "drive",
    "breakup",
    "sunday",
    "summer",
    "stress",
    "nostalgic",
    "wind",
    "overthink",
    "focus",
    "clean",
    "trip",
    "anxious",
    "calm",
  ];
  const hits = situationalTokens.filter((token) => label.includes(token)).length;
  score += Math.min(3.5, hits * 1.2);

  return roundScore(Math.min(10, score));
}

function scoreStability(prompt: string, record: BenchmarkRecord): number {
  const signatures = collectStabilitySignatures(prompt);
  const unique = new Set(signatures);
  let score = 10;
  if (unique.size > 1) score -= 5;
  if (!record.momentSignature || record.momentSignature.startsWith("baseline")) {
    score -= 2;
  }
  return roundScore(Math.max(0, score));
}

function scoreIdentityFit(record: BenchmarkRecord): number {
  const specificity = scoreSpecificity(record);
  const label = record.primaryNarrative.momentLabel.toLowerCase();
  let relatable = 3;
  if (label.split(/\s+/).length >= 3) relatable += 2;
  if (/night|drive|gym|work|breakup|stress|calm|nostalgic/.test(label)) relatable += 2;
  return roundScore(Math.min(10, specificity * 0.55 + relatable));
}

function scoreReplayUtility(record: BenchmarkRecord): number {
  const label = record.primaryNarrative.momentLabel.toLowerCase();
  if (/focus|work|gym|chill|calm|stress|nostalgic|wind/.test(label)) return 8;
  if (/getting ready|breakup|sunday|party|out/.test(label)) return 4.5;
  if (/summer|road trip|drive/.test(label)) return 6.5;
  return 5.5;
}

function scoreEmotionalSpike(record: BenchmarkRecord): number {
  const arcDirection = classifyArcDirection(
    record.primaryNarrative.arcSummary,
    PERCEPTION_FIXED_PHASES
  );
  if (arcDirection === "rise_peak_fall") return 9;
  if (arcDirection === "flat") return 2.5;
  if (arcDirection === "rise" || arcDirection === "fall") return 6;
  return 5;
}

function scoreHRPS(record: BenchmarkRecord): number {
  const identityFit = scoreIdentityFit(record);
  const replayUtility = scoreReplayUtility(record);
  const emotionalSpike = scoreEmotionalSpike(record);
  return roundScore(identityFit * 0.4 + replayUtility * 0.3 + emotionalSpike * 0.3);
}

function scoreRecord(prompt: string, record: BenchmarkRecord): BenchmarkScores {
  const pipeline = analyzeMomentPipeline(prompt);
  const tracks = syntheticTracks(PERCEPTION_FIXED_PHASES, pipeline.profile.energy);

  return {
    clarity: scoreNarrativeClarity(record),
    coherence: scoreEmotionalCoherence(record, tracks),
    specificity: scoreSpecificity(record),
    stability: scoreStability(prompt, record),
    hrps: scoreHRPS(record),
  };
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Comparison & regression ───────────────────────────────────────────────────

function detectRegressions(
  oldScores: BenchmarkScores,
  newScores: BenchmarkScores
): string[] {
  const notes: string[] = [];
  const metrics: Array<keyof BenchmarkScores> = [
    "clarity",
    "coherence",
    "specificity",
    "stability",
    "hrps",
  ];

  for (const metric of metrics) {
    const delta = newScores[metric] - oldScores[metric];
    if (delta < -1) {
      notes.push(`${metric} dropped ${Math.abs(delta).toFixed(2)}`);
    }
  }

  if (newScores.hrps < oldScores.hrps) {
    notes.push("HRPS decreased");
  }

  return notes;
}

async function comparePrompt(
  index: number,
  prompt: string,
  baseline: BenchmarkRecord
): Promise<BenchmarkComparisonRow> {
  console.log(
    `[benchmark] executing prompt ${index + 1}/${EXPECTED_PROMPT_COUNT}: "${prompt}"`
  );

  const current = await collectCurrentOutput(prompt);
  await Promise.resolve();

  const oldScores = scoreRecord(prompt, baseline);
  const newScores = scoreRecord(prompt, current);
  const notes = detectRegressions(oldScores, newScores);

  console.log(
    `[benchmark] completed comparison ${index + 1}/${EXPECTED_PROMPT_COUNT}: ` +
      `"${prompt}" — HRPS baseline=${oldScores.hrps.toFixed(1)} current=${newScores.hrps.toFixed(1)}`
  );

  return { prompt, old: oldScores, new: newScores, notes };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function formatTable(rows: BenchmarkComparisonRow[]): string {
  const header =
    "Prompt".padEnd(28) +
    " | Old HRPS | New HRPS | Old Clr | New Clr | Old Coh | New Coh | Old Spec | New Spec | Notes";

  const lines = rows.map((row) => {
    const prompt = pad(row.prompt, 28);
    return (
      `${prompt} | ${row.old.hrps.toFixed(1).padStart(8)} | ${row.new.hrps.toFixed(1).padStart(8)} | ` +
      `${row.old.clarity.toFixed(1).padStart(7)} | ${row.new.clarity.toFixed(1).padStart(7)} | ` +
      `${row.old.coherence.toFixed(1).padStart(7)} | ${row.new.coherence.toFixed(1).padStart(7)} | ` +
      `${row.old.specificity.toFixed(1).padStart(8)} | ${row.new.specificity.toFixed(1).padStart(8)} | ` +
      `${row.notes.join("; ") || "—"}`
    );
  });

  return [header, "-".repeat(header.length), ...lines].join("\n");
}

export interface BenchmarkReport {
  rows: BenchmarkComparisonRow[];
  totalProcessedPrompts: number;
  summary: {
    avgHrpsImprovement: number;
    avgClarityImprovement: number;
    avgCoherenceImprovement: number;
    regressionCount: number;
    hrpsWinCount: number;
    conclusion: string;
  };
}

export async function runHumanRetentionBenchmark(): Promise<BenchmarkReport> {
  console.log(
    `[benchmark] starting HRPS benchmark (${EXPECTED_PROMPT_COUNT} prompts, sequential)`
  );

  const baselines = loadBaselineSnapshot();
  validateBaselineSnapshot(baselines);
  console.log(
    `[benchmark] baseline snapshot loaded and validated (${EXPECTED_PROMPT_COUNT} records)`
  );

  const rows: BenchmarkComparisonRow[] = [];
  let totalProcessedPrompts = 0;

  for (let index = 0; index < BENCHMARK_PROMPTS.length; index++) {
    const prompt = BENCHMARK_PROMPTS[index]!;
    const baseline = baselines[prompt] ?? buildBaselineMock(prompt);
    const row = await comparePrompt(index, prompt, baseline);
    rows.push(row);
    totalProcessedPrompts += 1;
  }

  console.log(
    `[benchmark] all comparisons complete (totalProcessedPrompts=${totalProcessedPrompts})`
  );

  if (totalProcessedPrompts !== EXPECTED_PROMPT_COUNT) {
    throw new Error(
      `[benchmark] assertion failed: totalProcessedPrompts=${totalProcessedPrompts}, expected ${EXPECTED_PROMPT_COUNT}`
    );
  }

  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const avgHrpsImprovement = avg(rows.map((r) => r.new.hrps - r.old.hrps));
  const avgClarityImprovement = avg(rows.map((r) => r.new.clarity - r.old.clarity));
  const avgCoherenceImprovement = avg(rows.map((r) => r.new.coherence - r.old.coherence));
  const regressionCount = rows.filter((r) => r.notes.length > 0).length;
  const hrpsWinCount = rows.filter((r) => r.new.hrps > r.old.hrps).length;

  const likelyImprovesRetention =
    avgHrpsImprovement > 0.5 && hrpsWinCount >= Math.ceil(rows.length * 0.6);

  const conclusion = likelyImprovesRetention
    ? "Yes — heuristically, the new system increases the likelihood of save/replay behaviour compared to baseline (higher average HRPS and majority prompt wins)."
    : avgHrpsImprovement > 0
      ? "Mixed — average HRPS improved slightly, but gains are not consistent enough across prompts to conclude a clear retention uplift."
      : "No — heuristically, the new system does not show a clear retention uplift versus baseline on this benchmark set.";

  return {
    rows,
    totalProcessedPrompts,
    summary: {
      avgHrpsImprovement: roundScore(avgHrpsImprovement),
      avgClarityImprovement: roundScore(avgClarityImprovement),
      avgCoherenceImprovement: roundScore(avgCoherenceImprovement),
      regressionCount,
      hrpsWinCount,
      conclusion,
    },
  };
}

export function printHumanRetentionBenchmark(report: BenchmarkReport): void {
  console.log("\n=== Kwalify Human Retention Proxy Benchmark ===\n");
  console.log(formatTable(report.rows));
  console.log("\n--- Summary ---\n");
  console.log(`Total prompts processed:       ${report.totalProcessedPrompts} / ${EXPECTED_PROMPT_COUNT}`);
  console.log(`Average HRPS improvement:      ${report.summary.avgHrpsImprovement >= 0 ? "+" : ""}${report.summary.avgHrpsImprovement}`);
  console.log(`Average clarity improvement:   ${report.summary.avgClarityImprovement >= 0 ? "+" : ""}${report.summary.avgClarityImprovement}`);
  console.log(`Average coherence improvement: ${report.summary.avgCoherenceImprovement >= 0 ? "+" : ""}${report.summary.avgCoherenceImprovement}`);
  console.log(`Regressions flagged:           ${report.summary.regressionCount} / ${report.rows.length}`);
  console.log(`HRPS wins (new > old):         ${report.summary.hrpsWinCount} / ${report.rows.length}`);
  console.log(`\nConclusion: ${report.summary.conclusion}\n`);
  console.log(
    "(Heuristic only — not a guarantee of real user save/replay behaviour.)\n"
  );
}

async function main(): Promise<void> {
  const writeBaseline = process.argv.includes("--write-baseline");
  if (writeBaseline) {
    writeBaselineSnapshot();
    console.log(`[benchmark] baseline snapshot written to ${BASELINE_SNAPSHOT_PATH}`);
  }

  const report = await runHumanRetentionBenchmark();
  printHumanRetentionBenchmark(report);

  if (report.totalProcessedPrompts !== EXPECTED_PROMPT_COUNT) {
    console.error(
      `[benchmark] FATAL: totalProcessedPrompts=${report.totalProcessedPrompts}, expected ${EXPECTED_PROMPT_COUNT}`
    );
    process.exitCode = 1;
    return;
  }

  if (report.summary.regressionCount > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error("[benchmark] fatal error:", error);
    process.exit(1);
  });
}
