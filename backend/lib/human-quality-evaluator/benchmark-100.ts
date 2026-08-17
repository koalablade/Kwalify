/**
 * 100-generation human-quality benchmark run plan and aggregate reporting.
 * Measurement only — does not modify generation.
 */

import { randomUUID } from "node:crypto";
import { HUMAN_QUALITY_PROMPT_CORPUS, type CorpusPrompt } from "./prompt-corpus";
import { auditPlaylistAutomated, qualitativeBandLabel } from "./automated-audit";
import { evaluateFromApiResponse } from "./evidence-ingest";
import { clusterFailures, repeatedFailureClasses } from "./failure-clustering";
import type {
  EvaluatedPlaylist,
  FailureClass,
  HumanQualityReport,
  QualitativeBand,
} from "./types";
import { EVALUATOR_VERSION } from "./types";

export type Benchmark100RunItem = {
  runIndex: number;
  seed: number;
  promptId: string;
  prompt: string;
  category: CorpusPrompt["category"];
  difficulty: CorpusPrompt["difficulty"];
  requestId: string;
};

export type Benchmark100GenerationRecord = {
  benchmarkRunId: string;
  runItem: Benchmark100RunItem;
  startedAt: string;
  completedAt: string;
  httpStatus: number;
  success: boolean;
  error: string | null;
  commit: string | null;
  rawResponse: Record<string, unknown> | null;
  evaluated: EvaluatedPlaylist | null;
};

export const BENCHMARK100_PLAYLIST_LENGTH = 25;

/** Build exactly `target` runs from corpus with weighted second passes on hard categories. */
export function build100GenerationRunPlan(target = 100): Benchmark100RunItem[] {
  const runs: Benchmark100RunItem[] = [];
  const add = (p: CorpusPrompt, runIndex: number, seed: number) => {
    runs.push({
      runIndex,
      seed,
      promptId: `${p.id}${runIndex > 0 ? `-r${runIndex}` : ""}`,
      prompt: p.prompt,
      category: p.category,
      difficulty: p.difficulty,
      requestId: `hq100-${p.id}-s${seed}-${randomUUID().slice(0, 8)}`,
    });
  };

  for (const p of HUMAN_QUALITY_PROMPT_CORPUS) add(p, 0, 1);

  const secondPassCategories = new Set([
    "compound",
    "atmosphere",
    "vague",
    "natural",
    "edge_case",
    "negative_constraint",
  ]);
  for (const p of HUMAN_QUALITY_PROMPT_CORPUS.filter((x) => secondPassCategories.has(x.category))) {
    add(p, 1, 2);
  }

  let cursor = 0;
  while (runs.length < target) {
    const p = HUMAN_QUALITY_PROMPT_CORPUS[cursor % HUMAN_QUALITY_PROMPT_CORPUS.length]!;
    const runIndex = 1 + Math.floor(cursor / HUMAN_QUALITY_PROMPT_CORPUS.length);
    const seed = runIndex + 1;
    const id = `${p.id}-r${runIndex}`;
    if (!runs.some((r) => r.promptId === id)) {
      add(p, runIndex, seed);
    }
    cursor += 1;
    if (cursor > target * 3) break;
  }

  return runs.slice(0, target);
}

export function playlistQualityBand(evaluated: EvaluatedPlaylist): "STRONG" | "GOOD" | "MIXED" | "WEAK" | "FAIL" {
  const h = evaluated.automated.automatedHypothesis;
  if (evaluated.automated.underfill.outcome === "failure" || evaluated.tracks.length === 0) return "FAIL";
  if (h.humanQuality === "weak" || h.musicalCoherence === "weak") return "WEAK";
  if (h.humanQuality === "strong" && h.musicalCoherence === "strong") return "STRONG";
  if (h.humanQuality === "mixed" || h.musicalCoherence === "mixed") return "MIXED";
  return "GOOD";
}

export function build100GenerationReport(input: {
  benchmarkRunId: string;
  engineCommit: string | null;
  records: Benchmark100GenerationRecord[];
}): {
  markdown: string;
  summary: Record<string, unknown>;
} {
  const { records, benchmarkRunId, engineCommit } = input;
  const completed = records.filter((r) => r.evaluated);
  const evaluated = completed.map((r) => r.evaluated!);
  const success = records.filter((r) => r.success && r.evaluated && r.evaluated.tracks.length > 0);
  const partial = evaluated.filter((e) => e.automated.underfill.outcome === "partial");
  const failed = records.filter((r) => !r.success || r.evaluated?.tracks.length === 0);

  const bands = { STRONG: 0, GOOD: 0, MIXED: 0, WEAK: 0, FAIL: 0 };
  for (const e of evaluated) bands[playlistQualityBand(e)] += 1;

  const clusters = clusterFailures(evaluated);
  const repeated = repeatedFailureClasses(clusters);

  const tailCollapse = evaluated.filter((e) =>
    e.automated.segments.some((s) => s.range.includes("tail") && s.note?.includes("Elevated")),
  ).length;

  const underfillRate = evaluated.length
    ? Math.round((partial.length / evaluated.length) * 100)
    : 0;

  const byCategory = new Map<string, { total: number; weak: number }>();
  for (const r of completed) {
    const cat = r.runItem.category;
    const b = byCategory.get(cat) ?? { total: 0, weak: 0 };
    b.total += 1;
    const band = playlistQualityBand(r.evaluated!);
    if (band === "WEAK" || band === "FAIL") b.weak += 1;
    byCategory.set(cat, b);
  }

  const topFailures = repeated.slice(0, 8);
  const doNotTouch: string[] = [];
  if (bands.STRONG + bands.GOOD > evaluated.length * 0.4) {
    doNotTouch.push("Compound-intent prompts where automated hypothesis is strong/good");
  }
  if (underfillRate < 30) {
    doNotTouch.push("Honest partial delivery mechanism (when partials are intentional)");
  }

  let recommended = "Gather more human reviews on automated best/worst samples before any engine change.";
  if (repeated.length === 0) {
    recommended = "No repeated failure class in 100 runs — continue closed beta; do not change engine.";
  } else if (topFailures[0]) {
    recommended = `Investigate: ${topFailures[0].summary} (${topFailures[0].count} playlists, confidence ${topFailures[0].confidence}). Do NOT implement until human-calibrated.`;
  }

  const lines: string[] = [
    "# 100-GENERATION HUMAN-CENTRIC PLAYLIST QUALITY BENCHMARK",
    "",
    `Benchmark run ID: ${benchmarkRunId}`,
    `Evaluator: ${EVALUATOR_VERSION}`,
    `Engine commit: ${engineCommit ?? "unknown"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "> Automated bands are **hypotheses**. Human listening remains authoritative.",
    "",
    "## EXECUTIVE SUMMARY",
    "",
    `- Planned/completed: ${records.length} generations`,
    `- Successful (tracks delivered): ${success.length}`,
    `- Partial: ${partial.length} (${underfillRate}%)`,
    `- Failed/empty: ${failed.length}`,
    `- Tail collapse signals: ${tailCollapse}`,
    "",
    "## OVERALL QUALITY (automated hypothesis bands)",
    "",
    `- STRONG: ${bands.STRONG}`,
    `- GOOD: ${bands.GOOD}`,
    `- MIXED: ${bands.MIXED}`,
    `- WEAK: ${bands.WEAK}`,
    `- FAIL: ${bands.FAIL}`,
    "",
    "## HUMAN QUALITY",
    "",
    `- Human-reviewed in this run: 0 (select samples via \`npm run eval:human-quality -- review-template REQUEST_ID\`)`,
    `- Real beta feedback integrated separately via evidence.jsonl`,
    "",
    "## TOP FAILURE MODES",
    "",
  ];

  if (topFailures.length === 0) {
    lines.push("No repeated failure class detected across 100 runs.", "");
  } else {
    for (const c of topFailures) {
      lines.push(
        `### ${c.summary}`,
        `- Frequency: ${c.count} | Human signals: ${c.humanEvidenceCount} | Severity: ${c.severity}`,
        `- Confidence: ${c.confidence}`,
        `- Examples: ${c.exampleRequestIds.join(", ")}`,
        "",
      );
    }
  }

  lines.push(
    "## BY PROMPT CATEGORY (weak+fail rate)",
    "",
    ...[...byCategory.entries()].map(([cat, v]) =>
      `- ${cat}: ${v.weak}/${v.total} weak or fail`,
    ),
    "",
    "## UNDERFILL",
    "",
    `- Partial outcomes: ${partial.length}`,
    `- Full outcomes: ${evaluated.filter((e) => e.automated.underfill.outcome === "success").length}`,
    "",
    "## WHAT SHOULD WE BUILD NEXT?",
    "",
    "### DO NOT TOUCH",
    ...(doNotTouch.length ? doNotTouch.map((x) => `- ${x}`) : ["- Engine (insufficient human calibration yet)"]),
    "",
    "### INVESTIGATE",
    ...(topFailures.length
      ? topFailures.map((c) => `- ${c.summary} (${c.count} playlists)`)
      : ["- None identified from automated clustering alone"]),
    "",
    "### RECOMMENDED NEXT CHANGE",
    "",
    recommended,
    "",
    "## SAMPLE REQUEST IDS",
    "",
    ...completed.slice(0, 10).map((r) => `- ${r.runItem.requestId}: ${r.runItem.prompt.slice(0, 60)}`),
  );

  const summary = {
    benchmarkRunId,
    evaluatorVersion: EVALUATOR_VERSION,
    engineCommit,
    total: records.length,
    success: success.length,
    partial: partial.length,
    failed: failed.length,
    bands,
    topFailureClasses: topFailures.map((c) => ({
      class: c.failureClass,
      count: c.count,
      confidence: c.confidence,
    })),
    recommendedNextChange: recommended,
  };

  return { markdown: lines.join("\n"), summary };
}

export function evaluateRecordFromResponse(
  runItem: Benchmark100RunItem,
  data: Record<string, unknown>,
  httpStatus: number,
): EvaluatedPlaylist {
  const merged = { ...data, requestId: data.requestId ?? runItem.requestId };
  void httpStatus;
  return evaluateFromApiResponse(merged, { requestedCount: BENCHMARK100_PLAYLIST_LENGTH });
}
