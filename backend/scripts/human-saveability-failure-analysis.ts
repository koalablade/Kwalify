/**
 * Analyze human-saveability overnight benchmark failures.
 *
 * Usage:
 *   npm run analyze:human-saveability-failures
 *   npm run analyze:human-saveability-failures -- reports/human-saveability-overnight.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const REPORT_DIR = path.resolve(process.cwd(), "reports");
const DEFAULT_INPUT = path.join(REPORT_DIR, "human-saveability-overnight.json");
const FAILURE_OUTPUT = path.join(REPORT_DIR, "human-saveability-failure-analysis.json");
const PRIORITY_OUTPUT = path.join(REPORT_DIR, "human-saveability-priority-list.json");

type RunRow = {
  promptId: string;
  prompt: string;
  seed: number;
  humanSaveable: boolean;
  ok: boolean;
  curatorScore: number | null;
  rejectionReasons: string[];
  executionPath: string | null;
  dominantCluster: string | null;
  archetypeLabel: string | null;
  firstTen: string[];
  firstTwenty?: string[];
  trackCount: number;
  gateBypassed: boolean;
  intentCollapseLayer?: Record<string, unknown> | null;
  artistRepetition?: {
    maxInFirst15: number;
    duplicateArtists: string[];
  } | null;
  energyProgression?: number[];
  clusterConsistency?: number | null;
  pipelineStageResponsible: string | null;
  httpStatus: number;
};

type FailureRecord = {
  promptId: string;
  prompt: string;
  seed: number;
  executionPath: string | null;
  curatorScore: number | null;
  rejectionReasons: string[];
  intentCollapseLayer: Record<string, unknown> | null;
  dominantSceneCluster: string | null;
  archetypeLabel: string | null;
  opening10: string[];
  first20: string[];
  artistRepetition: RunRow["artistRepetition"] | null;
  energyProgression: number[];
  clusterConsistency: number | null;
  rootCause: string;
};

function rootCauseFromRun(row: RunRow): string {
  const primary = row.rejectionReasons[0] ?? "unknown";
  if (row.gateBypassed || row.executionPath === "timeout_fallback" || row.executionPath === "fast_fallback") {
    return "gate_bypass";
  }
  if (row.executionPath === "partial_pipeline" && primary.includes("insufficient_intent_pool")) {
    return "insufficient_intent_pool";
  }
  if (primary.includes("world_identity") || primary.includes("incompatible_with_archetype")) {
    return "world_identity_conflict";
  }
  if (primary.includes("incompatible_with_dominant_cluster")) {
    return "dominant_cluster_conflict";
  }
  if (primary.includes("curatorScore")) {
    return "curator_score_below_threshold";
  }
  if (primary.includes("opening") || primary.includes("cluster")) {
    return "opening_cluster_integrity";
  }
  if (primary.includes("distinct sonic worlds") || primary.includes("genre families")) {
    return "genre_world_fragmentation";
  }
  if (row.pipelineStageResponsible === "sampler" || primary.includes("funnel_collapse")) {
    return "sampler_pool_collapse";
  }
  if (row.pipelineStageResponsible === "interleaver") {
    return "interleaver_opening_degradation";
  }
  return `other:${primary.split(":")[0] ?? "unknown"}`;
}

function estimateEffort(rootCause: string): "low" | "medium" | "high" {
  if (rootCause === "insufficient_intent_pool" || rootCause === "world_identity_conflict") return "medium";
  if (rootCause === "gate_bypass") return "high";
  if (rootCause === "curator_score_below_threshold") return "medium";
  return "medium";
}

function estimateRisk(rootCause: string): "low" | "medium" | "high" {
  if (rootCause === "world_identity_conflict" || rootCause === "dominant_cluster_conflict") return "low";
  if (rootCause === "gate_bypass") return "medium";
  return "medium";
}

function curatorImpact(rootCause: string): number {
  const map: Record<string, number> = {
    gate_bypass: 1.0,
    insufficient_intent_pool: 0.9,
    world_identity_conflict: 0.85,
    dominant_cluster_conflict: 0.8,
    curator_score_below_threshold: 0.75,
    opening_cluster_integrity: 0.7,
    genre_world_fragmentation: 0.65,
    sampler_pool_collapse: 0.6,
    interleaver_opening_degradation: 0.55,
  };
  return map[rootCause] ?? 0.5;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;
  const raw = await readFile(inputPath, "utf8");
  const report = JSON.parse(raw) as { runs: RunRow[]; summary?: Record<string, unknown> };
  const runs = report.runs ?? [];

  const failures = runs.filter((row) => !row.humanSaveable || row.gateBypassed);
  const failureRecords: FailureRecord[] = failures.map((row) => ({
    promptId: row.promptId,
    prompt: row.prompt,
    seed: row.seed,
    executionPath: row.executionPath,
    curatorScore: row.curatorScore,
    rejectionReasons: row.rejectionReasons,
    intentCollapseLayer: row.intentCollapseLayer ?? null,
    dominantSceneCluster: row.dominantCluster,
    archetypeLabel: row.archetypeLabel,
    opening10: row.firstTen,
    first20: row.firstTwenty ?? row.firstTen,
    artistRepetition: row.artistRepetition ?? null,
    energyProgression: row.energyProgression ?? [],
    clusterConsistency: row.clusterConsistency ?? null,
    rootCause: rootCauseFromRun(row),
  }));

  const byCause = new Map<string, FailureRecord[]>();
  for (const row of failureRecords) {
    const list = byCause.get(row.rootCause) ?? [];
    list.push(row);
    byCause.set(row.rootCause, list);
  }

  const categories = [...byCause.entries()].map(([rootCause, rows]) => ({
    rootCause,
    frequency: rows.length,
    frequencyPct: failures.length > 0 ? rows.length / failures.length : 0,
    curatorScoreImpact: curatorImpact(rootCause),
    estimatedFixEffort: estimateEffort(rootCause),
    estimatedRegressionRisk: estimateRisk(rootCause),
    priorityScore: 0,
    allowedFixSurface: [
      "editorial_worlds",
      "intent_collapse_mappings",
      "library_aware_world_selection",
      "world_alignment",
      "retrieval_input_weighting",
      "opening_candidate_pool",
      "existing_polish_stabiliser",
    ],
    examples: rows.slice(0, 3).map((r) => ({
      promptId: r.promptId,
      seed: r.seed,
      executionPath: r.executionPath,
      curatorScore: r.curatorScore,
      rejectionReasons: r.rejectionReasons.slice(0, 2),
      editorialWorldTag: r.intentCollapseLayer?.editorialWorldTag ?? null,
      dominantSceneCluster: r.dominantSceneCluster,
    })),
  }));

  for (const cat of categories) {
    const riskWeight = cat.estimatedRegressionRisk === "low" ? 1 : cat.estimatedRegressionRisk === "medium" ? 0.7 : 0.4;
    cat.priorityScore = (cat.frequency * cat.curatorScoreImpact) / riskWeight;
  }
  categories.sort((a, b) => b.priorityScore - a.priorityScore);

  const passRate = runs.length > 0
    ? runs.filter((r) => r.humanSaveable && !r.gateBypassed).length / runs.length
    : 0;

  const failureAnalysis = {
    generatedAt: new Date().toISOString(),
    sourceReport: inputPath,
    totalRuns: runs.length,
    failedRuns: failures.length,
    passRate,
    gateBypassRuns: runs.filter((r) => r.gateBypassed).length,
    categories: categories.map(({ examples, ...rest }) => rest),
    failures: failureRecords,
  };

  const priorityList = {
    generatedAt: new Date().toISOString(),
    sourceReport: inputPath,
    passRate,
    targetPassRate: 0.8,
    rankedFixes: categories.map((cat, index) => ({
      rank: index + 1,
      rootCause: cat.rootCause,
      frequency: cat.frequency,
      curatorScoreImpact: cat.curatorScoreImpact,
      estimatedFixEffort: cat.estimatedFixEffort,
      estimatedRegressionRisk: cat.estimatedRegressionRisk,
      priorityScore: Math.round(cat.priorityScore * 1000) / 1000,
      proposedChanges: cat.rootCause === "insufficient_intent_pool"
        ? ["Expand editorial worlds for benchmark prompts", "Library-aware world selection"]
        : cat.rootCause === "world_identity_conflict"
          ? ["Align editorial world tags with scene archetype IDs", "Fail early diagnostics only"]
          : cat.rootCause === "curator_score_below_threshold"
            ? ["Tune existing intent filter mappings per world", "Improve library-world fit selection"]
            : cat.rootCause === "sampler_pool_collapse"
              ? ["Fix curator score NaN in existing gate entropy", "Deploy intent collapse + alignment to production API"]
            : cat.rootCause === "gate_bypass"
              ? ["Ensure gate executes on all success paths — controller/pipeline only"]
              : ["Improve existing layer mappings within allowed surfaces"],
      examples: cat.examples,
    })),
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(FAILURE_OUTPUT, JSON.stringify(failureAnalysis, null, 2));
  await writeFile(PRIORITY_OUTPUT, JSON.stringify(priorityList, null, 2));
  process.stdout.write(`Wrote ${FAILURE_OUTPUT}\n`);
  process.stdout.write(`Wrote ${PRIORITY_OUTPUT}\n`);
  process.stdout.write(JSON.stringify({
    passRate,
    failedRuns: failures.length,
    topCauses: categories.slice(0, 5).map((c) => ({ cause: c.rootCause, n: c.frequency })),
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
