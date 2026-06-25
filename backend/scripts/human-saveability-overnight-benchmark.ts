/**
 * Overnight human saveability benchmark — production API, 5 seeds per prompt.
 *
 * Usage: npm run benchmark:human-saveability-overnight
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveVerifiedProductionCredentials,
  EXPECTED_EVAL_TOKEN_LENGTH,
} from "../lib/benchmark-env";
import { normalizeEvalToken } from "../lib/eval-token-normalize";
import { fetchAndParseBenchmarkGenerate } from "../lib/benchmark-generate-fetch";
import {
  primaryRejectionReasonFromParsed,
  type ParsedHumanSaveabilityRun,
} from "../lib/human-saveability-benchmark-parse";

const SEEDS = [1, 2, 3, 4, 5];
const REPORT_DIR = path.resolve(process.cwd(), "reports");
const REPORT_PATH = path.join(REPORT_DIR, "human-saveability-overnight.json");
const ROOT_CAUSE_REPORT_PATH = path.join(REPORT_DIR, "human-saveability-root-causes.json");

const PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "late_night", prompt: "late night feeling" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
  { id: "study_session", prompt: "music for thinking and study session focus" },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout" },
];

type RunRow = {
  promptId: string;
  prompt: string;
  seed: number;
  requestId: string;
  httpStatus: number;
  responseKind: ParsedHumanSaveabilityRun["responseKind"];
  gateSource: string | null;
  ok: boolean;
  humanSaveable: boolean;
  curatorScore: number | null;
  rejectionReasons: string[];
  retriesUsed: number | null;
  error: string | null;
  trackCount: number;
  firstTen: string[];
  offendingTracks: Array<{ trackId: string; artist: string; reason: string }>;
  pipelineStageResponsible: string | null;
  suggestedFix: string | null;
  dominantCluster: string | null;
  archetypeLabel: string | null;
  opening5: string[];
  openingViolatingTracks: Array<{ trackId: string; artist: string; rank: number }>;
  openingFailureOrigin: "before interleaving" | "after interleaving" | null;
  openingTenDominantCluster: Record<string, unknown> | null;
  openingTenTrace: Array<Record<string, unknown>>;
  parseWarnings: string[];
  gateBypassed: boolean;
  bypassReason: string | null;
  executionPath: ParsedHumanSaveabilityRun["executionPath"];
  funnelCollapseStage: string | null;
  tracePresent: boolean;
  htmlResponse: boolean;
  fetchAttempts: number;
};

function applyParsed(row: RunRow, parsed: ParsedHumanSaveabilityRun): void {
  row.responseKind = parsed.responseKind;
  row.gateSource = parsed.gateSource;
  row.humanSaveable = parsed.humanSaveable;
  row.curatorScore = parsed.curatorScore;
  row.rejectionReasons = parsed.rejectionReasons;
  row.retriesUsed = parsed.retriesUsed;
  row.trackCount = parsed.trackCount;
  row.firstTen = parsed.firstTen;
  row.opening5 = parsed.firstTen.slice(0, 5);
  row.offendingTracks = parsed.offendingTracks;
  row.pipelineStageResponsible = parsed.pipelineStageResponsible;
  row.suggestedFix = parsed.suggestedFix;
  row.dominantCluster = parsed.dominantCluster;
  row.archetypeLabel = typeof parsed.archetype?.label === "string" ? parsed.archetype.label : null;
  row.openingViolatingTracks = parsed.openingClusterViolations;
  row.openingFailureOrigin = parsed.openingFailureOrigin;
  row.openingTenDominantCluster = parsed.openingTenDominantCluster;
  row.openingTenTrace = parsed.openingTenTrace;
  row.parseWarnings = parsed.parseWarnings;
  row.gateBypassed = parsed.gateBypassed;
  row.bypassReason = parsed.bypassReason;
  row.executionPath = parsed.executionPath;
  row.funnelCollapseStage = parsed.funnelCollapseStage;
  row.tracePresent = parsed.tracePresent;
}

async function generateRun(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  item: { id: string; prompt: string },
  seed: number,
): Promise<RunRow> {
  const requestId = `overnight-human-save-${item.id}-seed-${seed}`;
  const row: RunRow = {
    promptId: item.id,
    prompt: item.prompt,
    seed,
    requestId,
    httpStatus: 0,
    responseKind: "unparsed",
    gateSource: null,
    ok: false,
    humanSaveable: false,
    curatorScore: null,
    rejectionReasons: [],
    retriesUsed: null,
    error: null,
    trackCount: 0,
    firstTen: [],
    offendingTracks: [],
    pipelineStageResponsible: null,
    suggestedFix: null,
    dominantCluster: null,
    archetypeLabel: null,
    opening5: [],
    openingViolatingTracks: [],
    openingFailureOrigin: null,
    openingTenDominantCluster: null,
    openingTenTrace: [],
    parseWarnings: [],
    gateBypassed: false,
    bypassReason: null,
    executionPath: null,
    funnelCollapseStage: null,
    tracePresent: false,
    htmlResponse: false,
    fetchAttempts: 0,
  };

  try {
    const fetched = await fetchAndParseBenchmarkGenerate({
      baseUrl,
      token,
      spotifyUserId,
      prompt: item.prompt,
      seed,
      requestId,
    });
    row.httpStatus = fetched.httpStatus;
    row.fetchAttempts = fetched.attempts;
    row.htmlResponse = fetched.htmlResponse;
    applyParsed(row, fetched.parsed);

    if (fetched.htmlResponse) {
      row.ok = true;
      row.humanSaveable = false;
      row.error = null;
      return row;
    }

    if (!fetched.parsed.tracePresent) {
      row.ok = false;
      row.error = "missing_final_trace";
      return row;
    }

    if (fetched.fetchError) {
      row.ok = true;
      row.humanSaveable = false;
      return row;
    }

    row.ok = true;
    if (!row.humanSaveable && row.rejectionReasons.length === 0) {
      row.rejectionReasons = ["benchmark_hard_failure:empty_rejection_reasons_after_trace"];
    }
    return row;
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    row.rejectionReasons = [`benchmark_fetch_error:${row.error}`];
    row.executionPath = "unknown_exit";
    return row;
  }
}

function primaryRejectionReason(row: RunRow): string {
  return primaryRejectionReasonFromParsed(row);
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  if (token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    throw new Error(`PLAYLIST_EVAL_TOKEN length must be ${EXPECTED_EVAL_TOKEN_LENGTH}`);
  }

  const results: RunRow[] = [];
  for (const item of PROMPTS) {
    for (const seed of SEEDS) {
      process.stdout.write(`RUN ${item.id} seed=${seed}\n`);
      const row = await generateRun(creds.baseUrl, token, creds.spotifyUserId, item, seed);
      results.push(row);
      process.stdout.write(
        row.ok
          ? `  ${row.httpStatus} ${row.humanSaveable ? "PASS" : "FAIL"} path=${row.executionPath ?? "none"} stage=${row.pipelineStageResponsible ?? "n/a"} html=${row.htmlResponse ? "yes" : "no"} reasons=${row.rejectionReasons.slice(0, 2).join("; ") || "none"}\n`
          : `  ERROR ${row.error ?? row.rejectionReasons[0] ?? "unknown"}\n`,
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const attributable = results.filter((r) => r.tracePresent || r.htmlResponse || r.executionPath === "invalid_html_response");
  const humanSaveable = results.filter((r) => r.humanSaveable);
  const reasonCounts = new Map<string, number>();
  for (const row of results.filter((r) => !r.humanSaveable)) {
    const reason = primaryRejectionReason(row);
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const missingTraceCount = results.filter((r) => !r.tracePresent && !r.htmlResponse).length;
  const htmlResponseCount = results.filter((r) => r.htmlResponse).length;

  const byPrompt = new Map<string, { pass: number; total: number }>();
  for (const row of results.filter((r) => r.ok)) {
    const cur = byPrompt.get(row.promptId) ?? { pass: 0, total: 0 };
    cur.total += 1;
    if (row.humanSaveable) cur.pass += 1;
    byPrompt.set(row.promptId, cur);
  }
  const worstPrompts = [...byPrompt.entries()]
    .map(([promptId, stats]) => ({
      promptId,
      passRate: stats.total > 0 ? stats.pass / stats.total : 0,
      pass: stats.pass,
      total: stats.total,
    }))
    .sort((a, b) => a.passRate - b.passRate)
    .slice(0, 10);

  const summary = {
    totalRuns: results.length,
    attributableRuns: attributable.length,
    humanSaveableRuns: humanSaveable.length,
    humanSaveablePct: results.length > 0
      ? Math.round((humanSaveable.length / results.length) * 1000) / 1000
      : 0,
    missingTraceCount,
    htmlResponseCount,
    executionPathCounts: Object.fromEntries(
      [...results.reduce((map, row) => {
        const key = row.executionPath ?? (row.tracePresent ? "trace" : "missing_trace");
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>())],
    ),
    worstPrompts,
    topRejectionReasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([reason, count]) => ({ reason, count })),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    summary,
    runs: results,
  };

  const failed = results.filter((row) => !row.humanSaveable);
  const stageCounts = new Map<string, number>();
  for (const row of failed) {
    const stage = row.pipelineStageResponsible ?? row.executionPath ?? "unknown";
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  }
  const rootCauseReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    totalRuns: results.length,
    failedRuns: failed.length,
    missingTraceCount,
    htmlResponseCount,
    failedPlaylists: failed.map((row) => ({
      prompt: row.prompt,
      seed: row.seed,
      requestId: row.requestId,
      httpStatus: row.httpStatus,
      executionPath: row.executionPath,
      rejectionReason: primaryRejectionReason(row),
      rejectionReasons: row.rejectionReasons,
      curatorScore: row.curatorScore,
      dominantCluster: row.dominantCluster,
      pipelineStageResponsible: row.pipelineStageResponsible,
      htmlResponse: row.htmlResponse,
      fetchAttempts: row.fetchAttempts,
    })),
    aggregates: {
      mostCommonPipelineStage: [...stageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([stage, count]) => ({ stage, count })),
      executionPathCounts: summary.executionPathCounts,
    },
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  await writeFile(ROOT_CAUSE_REPORT_PATH, JSON.stringify(rootCauseReport, null, 2));
  process.stdout.write(`\nWrote ${REPORT_PATH}\n`);
  process.stdout.write(`Wrote ${ROOT_CAUSE_REPORT_PATH}\n`);
  process.stdout.write(JSON.stringify(summary, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
