import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLAYLIST_BENCHMARK_PROMPTS, type PlaylistBenchmarkPrompt } from "../lib/playlist-evaluation/benchmark-prompts";
import { writeEvaluationReports, type EvaluationReportPayload } from "../lib/playlist-evaluation/report";
import type { EvaluationTrack, GenerationEvaluationResult, PlaylistMetrics } from "../lib/playlist-evaluation/metrics";

type HarnessConfig = {
  baseUrl: string;
  outDir: string;
  spotifyUserId: string | null;
  authCookie: string | null;
  token: string | null;
  liveApi: boolean;
  allowSpotifyCreate: boolean;
  allowDbWrites: boolean;
  expectedDeploymentVersion: string | null;
  concurrency: number;
  delayMs: number;
  limit: number | null;
  benchmarkSize: number | null;
  category: string | null;
  requestTimeoutMs: number;
  dryRun: boolean;
  maxHttpRetries: number;
  maxFailures: number | null;
  clusterFailFast: number | null;
  checkpointEvery: number;
  resume: boolean;
  fresh: boolean;
};

type EvaluationRunState = {
  runId: string;
  commitHash: string;
  baseUrl: string;
  outDir: string;
  totalPrompts: number;
  completedIndices: number[];
  failedIndices: number[];
  lastSuccessfulPlaylist: string | null;
  promptIds: string[];
  updatedAt: string;
};

type ClusterEarlyExitSummary = {
  category: string;
  failureThreshold: number;
  failureMode: string;
  failureRate: number;
  evaluatedPromptIds: string[];
  failedPromptIds: string[];
  skippedPromptIds: string[];
  reason: string;
};

const LEGACY_RUN_STATE_FILE = path.join("reports", "playlist-evaluation", "run-state.json");
const PREFLIGHT_TIMEOUT_MS = 45_000;
const PREVIOUS_BASELINE = {
  successCount: 11,
  benchmarkSize: 20,
  overlap: 0.241,
  trackRepetition: 0,
};

function usage(): never {
  console.error([
    "Usage:",
    "  npm run evaluation:playlists -- --spotify-user-id USER_ID --out reports/playlist-evaluation/latest",
    "",
    "Options:",
    "  --base-url URL              API base URL (or API_BASE_URL / PLAYLIST_EVAL_BASE_URL env)",
    "  --spotify-user-id ID        Synced Spotify user id for token-authorized audit mode",
    "  --auth-cookie COOKIE        Existing authenticated session cookie",
    "  --token TOKEN               PLAYLIST_EVAL_TOKEN value (default env PLAYLIST_EVAL_TOKEN)",
    "  --live-api                  Use authenticated live API mode instead of audit mode",
    "  --allow-spotify-create      In live API mode, allow real Spotify playlist creation",
    "  --allow-db-writes           In live API mode, allow DB history/saved-playlist writes",
    "  --expected-deployment-version SHA  Expected deployed git SHA (default env or local git HEAD)",
    "  --concurrency N             Low concurrency limit (default 1, max 3)",
    "  --delay-ms N                Delay between requests per worker (default 1200)",
    "  --limit N                   Run only first N prompts",
    "  --benchmark-size N          Fixed run size: 10, 50, 100, or 250",
    "  --category NAME             Run one benchmark category",
    "  --timeout-ms N              Per-request timeout (default 90000)",
    "  --max-http-retries N        Harness API retries for 429/5xx (default 3)",
    "  --max-failures N            Stop early after N failed prompts (default disabled)",
    "  --cluster-fail-fast N       Stop remaining prompts in a category after one failure mode appears in >=80% of N category prompts (default 3, 0 disables)",
    "  --checkpoint-every N        Write full report every N completed prompts (default 5)",
    "  --resume                    Resume from reports/playlist-evaluation/run-state.json",
    "  --fresh                     Ignore existing run state and start from scratch",
    "  --dry-run                   Do not call API; emit prompt list only",
  ].join("\n"));
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function parseIntArg(args: string[], name: string, fallback: number): number {
  const raw = argValue(args, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseConfig(args: string[]): HarnessConfig {
  if (args.includes("--help") || args.includes("-h")) usage();
  const liveApi = args.includes("--live-api");
  const baseUrlRaw = argValue(args, "--base-url") ?? process.env["API_BASE_URL"] ?? process.env["PLAYLIST_EVAL_BASE_URL"] ?? process.env["APP_URL"] ?? null;
  const benchmarkSize = argValue(args, "--benchmark-size") ? parseIntArg(args, "--benchmark-size", 0) : null;
  const clusterFailFastArg = argValue(args, "--cluster-fail-fast");
  if (benchmarkSize !== null && ![10, 50, 100, 250].includes(benchmarkSize)) {
    throw new Error("--benchmark-size must be one of: 10, 50, 100, 250");
  }
  const config: HarnessConfig = {
    baseUrl: baseUrlRaw ? baseUrlRaw.replace(/\/+$/, "") : "",
    outDir: argValue(args, "--out") ?? "reports/playlist-evaluation/latest",
    spotifyUserId: argValue(args, "--spotify-user-id") ?? process.env["SPOTIFY_USER_ID"] ?? process.env["PLAYLIST_EVAL_SPOTIFY_USER_ID"] ?? null,
    authCookie: argValue(args, "--auth-cookie") ?? process.env["PLAYLIST_EVAL_AUTH_COOKIE"] ?? null,
    token: argValue(args, "--token") ?? process.env["PLAYLIST_EVAL_TOKEN"] ?? null,
    liveApi,
    allowSpotifyCreate: args.includes("--allow-spotify-create"),
    allowDbWrites: args.includes("--allow-db-writes"),
    expectedDeploymentVersion: argValue(args, "--expected-deployment-version") ?? process.env["PLAYLIST_EVAL_EXPECTED_VERSION"] ?? process.env["EXPECTED_DEPLOYMENT_VERSION"] ?? null,
    concurrency: Math.max(1, Math.min(3, parseIntArg(args, "--concurrency", 1))),
    delayMs: parseIntArg(args, "--delay-ms", 1200),
    limit: argValue(args, "--limit") ? parseIntArg(args, "--limit", 0) : null,
    benchmarkSize,
    category: argValue(args, "--category"),
    requestTimeoutMs: parseIntArg(args, "--timeout-ms", 90_000),
    dryRun: args.includes("--dry-run"),
    maxHttpRetries: parseIntArg(args, "--max-http-retries", 3),
    maxFailures: argValue(args, "--max-failures") ? parseIntArg(args, "--max-failures", 0) : null,
    clusterFailFast: clusterFailFastArg === "0"
      ? null
      : clusterFailFastArg
        ? Math.max(3, parseIntArg(args, "--cluster-fail-fast", 3))
        : 3,
    checkpointEvery: Math.max(1, parseIntArg(args, "--checkpoint-every", 5)),
    resume: args.includes("--resume"),
    fresh: args.includes("--fresh"),
  };
  if (config.resume && config.fresh) {
    throw new Error("--resume and --fresh cannot be used together.");
  }
  if (!config.baseUrl) {
    throw new Error("API_BASE_URL is required. Set API_BASE_URL or pass --base-url.");
  }
  if (config.dryRun) return config;
  if (!config.token) {
    throw new Error("PLAYLIST_EVAL_TOKEN is required. Set PLAYLIST_EVAL_TOKEN or pass --token.");
  }
  if (!config.spotifyUserId) {
    throw new Error("SPOTIFY_USER_ID is required. Set SPOTIFY_USER_ID or pass --spotify-user-id.");
  }
  if (config.allowSpotifyCreate && !config.liveApi) {
    throw new Error("--allow-spotify-create can only be used with --live-api.");
  }
  if (config.allowDbWrites && !config.liveApi) {
    throw new Error("--allow-db-writes can only be used with --live-api.");
  }
  if (config.liveApi && config.allowSpotifyCreate && !config.allowDbWrites) {
    throw new Error("--allow-spotify-create requires --allow-db-writes because the current production path writes saved playlist/history rows.");
  }
  if (config.liveApi && config.allowDbWrites && !config.allowSpotifyCreate) {
    throw new Error("--allow-db-writes requires --allow-spotify-create so live mode side effects are explicit as a pair.");
  }
  if (config.liveApi && config.allowSpotifyCreate && !config.authCookie) {
    throw new Error("--live-api --allow-spotify-create requires --auth-cookie so Spotify creation runs exactly as an authenticated user.");
  }
  if (!config.liveApi && config.authCookie) {
    throw new Error("Audit-only mode must use PLAYLIST_EVAL_TOKEN + SPOTIFY_USER_ID, not a session cookie. Omit --auth-cookie or use --live-api.");
  }
  if (config.liveApi && !config.allowSpotifyCreate && config.authCookie) {
    throw new Error("--live-api without explicit write flags still runs audit-only. Omit --auth-cookie unless enabling writes.");
  }
  return config;
}

function selectPrompts(config: HarnessConfig): PlaylistBenchmarkPrompt[] {
  let prompts = PLAYLIST_BENCHMARK_PROMPTS;
  if (config.category) prompts = prompts.filter((prompt) => prompt.category === config.category);
  if (config.benchmarkSize !== null) prompts = prompts.slice(0, config.benchmarkSize);
  if (config.limit !== null) prompts = prompts.slice(0, config.limit);
  if (prompts.length === 0) throw new Error("No benchmark prompts selected");
  return prompts;
}

function sanitizedBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/[?].*$/, "");
  }
}

function runStateFile(outDir: string): string {
  return path.join(outDir, "run-state.json");
}

function logStartup(config: HarnessConfig, promptCount: number): void {
  const auditOnly = !liveWritesEnabled(config);
  console.error("[evaluation] startup");
  console.error(`[evaluation] Active mode: ${auditOnly ? "audit-only" : "live-api"}`);
  console.error(`[evaluation] Spotify writes: ${config.allowSpotifyCreate ? "enabled" : "disabled"}`);
  console.error(`[evaluation] DB writes: ${config.allowDbWrites ? "enabled" : "disabled"}`);
  console.error(`[evaluation] API_BASE_URL: ${sanitizedBaseUrl(config.baseUrl)}`);
  console.error(`[evaluation] prompts: ${promptCount}, concurrency: ${config.concurrency}, delayMs: ${config.delayMs}, maxHttpRetries: ${config.maxHttpRetries}`);
  console.error("[evaluation] preflight: deployment reachable=false, eval route deployed=false, token accepted=false, commit=unknown");
}

function liveWritesEnabled(config: HarnessConfig): boolean {
  return config.liveApi && config.allowSpotifyCreate && config.allowDbWrites;
}

function localGitHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function versionsMatch(expected: string, actual: string): boolean {
  const cleanExpected = expected.trim();
  const cleanActual = actual.trim();
  return cleanExpected.length > 0 &&
    cleanActual.length > 0 &&
    cleanActual !== "unknown" &&
    (cleanExpected === cleanActual || cleanExpected.startsWith(cleanActual) || cleanActual.startsWith(cleanExpected));
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2));
  await rename(tmpPath, filePath);
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function resultIndexByPrompt(prompts: PlaylistBenchmarkPrompt[], result: GenerationEvaluationResult): number {
  return prompts.findIndex((prompt) => prompt.id === result.benchmark.id);
}

async function loadPreviousResults(outDir: string): Promise<GenerationEvaluationResult[]> {
  const report = await readJsonFile<{ rawResults?: GenerationEvaluationResult[] }>(
    path.join(outDir, "evaluation-report.json"),
  );
  if (Array.isArray(report?.rawResults) && report.rawResults.length > 0) return report.rawResults;
  try {
    const lines = (await readFile(path.join(outDir, "evaluation-results.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as GenerationEvaluationResult);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
}

function runStateFromResults(input: {
  runId: string;
  commitHash: string;
  config: HarnessConfig;
  prompts: PlaylistBenchmarkPrompt[];
  results: GenerationEvaluationResult[];
}): EvaluationRunState {
  const completedIndices = input.results
    .map((result) => resultIndexByPrompt(input.prompts, result))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const failedIndices = input.results
    .filter((result) => !result.ok)
    .map((result) => resultIndexByPrompt(input.prompts, result))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const lastSuccessful = [...input.results].reverse().find((result) => result.ok);
  return {
    runId: input.runId,
    commitHash: input.commitHash,
    baseUrl: input.config.baseUrl,
    outDir: input.config.outDir,
    totalPrompts: input.prompts.length,
    completedIndices,
    failedIndices,
    lastSuccessfulPlaylist: lastSuccessful?.benchmark.id ?? null,
    promptIds: input.prompts.map((prompt) => prompt.id),
    updatedAt: new Date().toISOString(),
  };
}

async function checkpointRun(input: {
  runId: string;
  commitHash: string;
  config: HarnessConfig;
  prompts: PlaylistBenchmarkPrompt[];
  started: number;
  results: GenerationEvaluationResult[];
  latestResult?: GenerationEvaluationResult;
  writeReports?: boolean;
}): Promise<Awaited<ReturnType<typeof writeEvaluationReports>> | null> {
  if (input.latestResult) {
    await mkdir(input.config.outDir, { recursive: true });
    await appendFile(
      path.join(input.config.outDir, "evaluation-results.jsonl"),
      `${JSON.stringify(input.latestResult)}\n`,
    );
  }
  await writeJsonAtomic(runStateFile(input.config.outDir), runStateFromResults(input));
  if (input.writeReports === false) return null;
  const report = await writeEvaluationReports({
    outDir: input.config.outDir,
    generatedAt: new Date().toISOString(),
    run: {
      mode: liveWritesEnabled(input.config) ? "live-api" : "audit",
      baseUrl: input.config.baseUrl,
      promptCount: input.prompts.length,
      concurrency: input.config.concurrency,
      delayMs: input.config.delayMs,
      allowSpotifyCreate: input.config.allowSpotifyCreate,
      allowDbWrites: input.config.allowDbWrites,
      durationMs: Date.now() - input.started,
    },
    results: input.results,
  });
  return report;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  return `${round(value * 100, 1)}%`;
}

function formatSeconds(ms: number): string {
  return `${round(ms / 1000, 1)}s`;
}

function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function failureReason(result: GenerationEvaluationResult, metrics: PlaylistMetrics | undefined): string {
  if (result.ok) return "none";
  return result.error ?? metrics?.likelyCause ?? "unknown_failure";
}

function failureModeCounts(report: EvaluationReportPayload): Record<string, number> {
  return Object.fromEntries(report.summary.failureModes.map((row) => [row.mode, row.count]));
}

function writeReportCheckpointDue(completedCount: number, config: HarnessConfig): boolean {
  return completedCount > 0 && completedCount % config.checkpointEvery === 0;
}

function clusterFailureShortcut(input: {
  report: EvaluationReportPayload;
  category: PlaylistBenchmarkPrompt["category"];
  prompts: PlaylistBenchmarkPrompt[];
  completed: Set<string>;
  minPrompts: number;
  currentIndex: number;
}): ClusterEarlyExitSummary | null {
  const clusterRows = input.report.summary.playlists.filter((row) => row.category === input.category);
  if (clusterRows.length < input.minPrompts) return null;

  const failureCounts = new Map<string, string[]>();
  for (const row of clusterRows) {
    for (const mode of row.failureModes) {
      const promptIds = failureCounts.get(mode) ?? [];
      promptIds.push(row.promptId);
      failureCounts.set(mode, promptIds);
    }
  }

  const dominant = [...failureCounts.entries()]
    .map(([mode, promptIds]) => ({
      mode,
      promptIds,
      rate: promptIds.length / Math.max(1, clusterRows.length),
    }))
    .filter((row) => row.promptIds.length >= input.minPrompts && row.rate >= 0.80)
    .sort((a, b) => b.rate - a.rate || b.promptIds.length - a.promptIds.length)[0];
  if (!dominant) return null;

  const skippedPromptIds = input.prompts
    .slice(input.currentIndex + 1)
    .filter((prompt) => prompt.category === input.category && !input.completed.has(prompt.id))
    .map((prompt) => prompt.id);
  if (skippedPromptIds.length === 0) return null;

  return {
    category: input.category,
    failureThreshold: input.minPrompts,
    failureMode: dominant.mode,
    failureRate: Math.round(dominant.rate * 1000) / 1000,
    evaluatedPromptIds: clusterRows.map((row) => row.promptId),
    failedPromptIds: dominant.promptIds,
    skippedPromptIds,
    reason: `${dominant.mode} appeared in ${dominant.promptIds.length}/${clusterRows.length} evaluated ${input.category} prompts`,
  };
}

function clusterShortcutCheckpointDue(
  results: GenerationEvaluationResult[],
  category: PlaylistBenchmarkPrompt["category"],
  config: HarnessConfig,
): boolean {
  if (config.clusterFailFast === null) return false;
  return results.filter((row) => row.benchmark.category === category).length >= config.clusterFailFast;
}

function runningAverages(rows: PlaylistMetrics[]): {
  overlap: number;
  trackRepetition: number;
  artistRepetition: number;
} {
  return {
    overlap: average(rows.map((row) => row.crossPlaylistOverlap)),
    trackRepetition: average(rows.map((row) => row.trackRepetition)),
    artistRepetition: average(rows.map((row) => row.artistRepetition)),
  };
}

function etaRemainingMs(results: GenerationEvaluationResult[], remainingCount: number, delayMs: number): number {
  if (results.length === 0 || remainingCount <= 0) return 0;
  return average(results.map((result) => result.elapsedMs)) * remainingCount + Math.max(0, remainingCount - 1) * delayMs;
}

function liveSummary(input: {
  config: HarnessConfig;
  prompts: PlaylistBenchmarkPrompt[];
  started: number;
  results: GenerationEvaluationResult[];
  report: EvaluationReportPayload;
}): Record<string, unknown> {
  const failed = input.results.filter((result) => !result.ok);
  const succeeded = input.results.length - failed.length;
  const averages = runningAverages(input.report.summary.playlists);
  const remainingCount = Math.max(0, input.prompts.length - input.results.length);
  return {
    generatedAt: new Date().toISOString(),
    outDir: input.config.outDir,
    totalPrompts: input.prompts.length,
    completed: input.results.length,
    remaining: remainingCount,
    succeeded,
    failed: failed.length,
    passRate: input.results.length ? succeeded / input.results.length : 0,
    runningOverlap: averages.overlap,
    runningTrackRepetition: averages.trackRepetition,
    runningArtistRepetition: averages.artistRepetition,
    averageGenerationTimeMs: input.report.spotifyApiMetrics.averageGenerationTimeMs,
    p95GenerationTimeMs: input.report.spotifyApiMetrics.p95GenerationTimeMs,
    elapsedMs: Date.now() - input.started,
    etaRemainingMs: etaRemainingMs(input.results, remainingCount, input.config.delayMs),
    failureModes: failureModeCounts(input.report),
    latest: input.results.at(-1)
      ? {
          promptId: input.results.at(-1)!.benchmark.id,
          status: input.results.at(-1)!.ok ? "PASS" : "FAIL",
          tracks: input.results.at(-1)!.tracks.length,
          generationTimeMs: input.results.at(-1)!.elapsedMs,
        }
      : null,
  };
}

function liveSummaryMarkdown(summary: Record<string, unknown>): string {
  const failureModes = summary["failureModes"] && typeof summary["failureModes"] === "object"
    ? Object.entries(summary["failureModes"] as Record<string, number>)
    : [];
  return [
    "# Live Playlist Evaluation Summary",
    "",
    `Updated: ${String(summary["generatedAt"])}`,
    `Progress: ${summary["completed"]}/${summary["totalPrompts"]} completed`,
    `Pass rate: ${summary["succeeded"]}/${summary["completed"]} (${formatPercent(Number(summary["passRate"] ?? 0))})`,
    `Running overlap: ${formatPercent(Number(summary["runningOverlap"] ?? 0))}`,
    `Track repetition: ${formatPercent(Number(summary["runningTrackRepetition"] ?? 0))}`,
    `Artist repetition: ${formatPercent(Number(summary["runningArtistRepetition"] ?? 0))}`,
    `Average generation time: ${formatSeconds(Number(summary["averageGenerationTimeMs"] ?? 0))}`,
    `P95 generation time: ${formatSeconds(Number(summary["p95GenerationTimeMs"] ?? 0))}`,
    `ETA remaining: ${formatDuration(Number(summary["etaRemainingMs"] ?? 0))}`,
    "",
    "## Failure Modes",
    ...(failureModes.length ? failureModes.map(([mode, count]) => `- ${mode}: ${count}`) : ["- none"]),
    "",
  ].join("\n");
}

async function writeLiveSummaryFiles(input: {
  config: HarnessConfig;
  prompts: PlaylistBenchmarkPrompt[];
  started: number;
  results: GenerationEvaluationResult[];
  report: EvaluationReportPayload;
}): Promise<void> {
  const summary = liveSummary(input);
  await writeJsonAtomic(path.join(input.config.outDir, "live-summary.json"), summary);
  await writeFile(path.join(input.config.outDir, "live-summary.md"), liveSummaryMarkdown(summary));
}

function printLiveProgress(input: {
  config: HarnessConfig;
  prompts: PlaylistBenchmarkPrompt[];
  index: number;
  result: GenerationEvaluationResult;
  results: GenerationEvaluationResult[];
  report: EvaluationReportPayload;
}): void {
  const metrics = input.report.summary.playlists.find((row) => row.promptId === input.result.benchmark.id);
  const failed = input.results.filter((result) => !result.ok);
  const succeeded = input.results.length - failed.length;
  const remainingCount = Math.max(0, input.prompts.length - input.results.length);
  const averages = runningAverages(input.report.summary.playlists);
  const failureModes = input.report.summary.failureModes;
  console.error("");
  console.error(`[${input.index + 1}/${input.prompts.length}] ${input.result.benchmark.id}`);
  console.error(`Status: ${input.result.ok ? "PASS" : "FAIL"}`);
  if (!input.result.ok) console.error(`Reason: ${failureReason(input.result, metrics)}`);
  console.error(`Tracks: ${input.result.tracks.length}`);
  console.error(`Confidence: ${round(metrics?.confidenceScore ?? 0, 2)}`);
  console.error(`Overlap (running avg): ${formatPercent(averages.overlap)}`);
  console.error(`Generation time: ${formatSeconds(input.result.elapsedMs)}`);
  console.error(`ETA remaining: ${formatDuration(etaRemainingMs(input.results, remainingCount, input.config.delayMs))}`);
  console.error("");
  console.error(`Current pass rate: ${succeeded}/${input.results.length} (${formatPercent(input.results.length ? succeeded / input.results.length : 0)})`);
  console.error(`Running overlap: ${formatPercent(averages.overlap)}`);
  console.error(`Running repetition: ${formatPercent(averages.trackRepetition)}`);
  console.error(`Average generation time: ${formatSeconds(input.report.spotifyApiMetrics.averageGenerationTimeMs)}`);
  console.error(`Estimated finish time: ${formatDuration(etaRemainingMs(input.results, remainingCount, input.config.delayMs))} remaining`);
  console.error("Failure Modes:");
  if (failureModes.length === 0) {
    console.error("none");
  } else {
    for (const mode of failureModes.slice(0, 10)) console.error(`${mode.mode}: ${mode.count}`);
  }
  console.error("");
}

async function withStallWarning<T>(input: {
  prompt: PlaylistBenchmarkPrompt;
  started: number;
  task: Promise<T>;
}): Promise<T> {
  let lastWarningAt = input.started;
  const interval = setInterval(() => {
    const now = Date.now();
    if (now - lastWarningAt < 90_000) return;
    lastWarningAt = now;
    console.error("WARNING: No completed playlist for 90s");
    console.error(`Current prompt: ${input.prompt.id}`);
    console.error("Current stage: server /api/generate request in progress (server sub-stage is not streamed to the harness)");
    console.error(`Elapsed in stage: ${formatDuration(now - input.started)}`);
  }, 10_000);
  try {
    return await input.task;
  } finally {
    clearInterval(interval);
  }
}

async function preflight(config: HarnessConfig): Promise<Record<string, unknown>> {
  const expectedVersion = config.expectedDeploymentVersion ?? localGitHead();
  if (!expectedVersion) {
    throw new Error("Could not determine expected deployment version. Pass --expected-deployment-version or set PLAYLIST_EVAL_EXPECTED_VERSION.");
  }
  try {
    const { response, data } = await fetchJsonWithTimeout(`${config.baseUrl}/api/readyz`, { method: "GET" }, PREFLIGHT_TIMEOUT_MS);
    if (!response.ok || data["status"] !== "ready" || data["readiness"] !== "ready") {
      throw new Error(`GET /api/readyz returned ${response.status} ${String(data["status"] ?? "unknown")}/${String(data["readiness"] ?? "unknown")}`);
    }
  } catch (err) {
    throw new Error(`Preflight failed: deployment is not ready. ${err instanceof Error ? err.message : String(err)}`);
  }
  let deploymentData: Record<string, unknown>;
  try {
    const { response: deploymentResponse, data } = await fetchJsonWithTimeout(`${config.baseUrl}/api/eval/ping`, { method: "GET" }, PREFLIGHT_TIMEOUT_MS);
    deploymentData = data;
    if (!deploymentResponse.ok || deploymentData["status"] !== "ok" || deploymentData["deployed"] !== true) {
      console.error(`[evaluation] preflight: deployment reachable=${deploymentResponse.ok}, eval route deployed=false, token accepted=false, commit=${String(deploymentData["commit"] ?? "unknown")}`);
      throw new Error(`Preflight failed: deployment not reachable or route missing. GET /api/eval/ping returned ${deploymentResponse.status}.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Preflight failed:")) throw err;
    throw new Error(`Preflight failed: deployment not reachable or route missing. ${err instanceof Error ? err.message : String(err)}`);
  }

  const commit = typeof deploymentData["commit"] === "string" ? deploymentData["commit"] : "unknown";
  console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=false, commit=${commit}`);

  if (!versionsMatch(expectedVersion, commit)) {
    throw new Error(`Preflight failed: deployed commit ${commit} does not match expected ${expectedVersion}. Deploy the current commit or pass the correct --expected-deployment-version.`);
  }

  const { response: authResponse, data: authData } = await fetchJsonWithTimeout(`${config.baseUrl}/api/eval/ping`, {
    method: "POST",
    headers: {
      "x-eval-token": config.token!,
    },
  }, PREFLIGHT_TIMEOUT_MS);
  const authCommit = typeof authData["commit"] === "string" ? authData["commit"] : commit;
  if (!authResponse.ok) {
    console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=false, commit=${authCommit}`);
    throw new Error(`Preflight failed: deployment OK, eval auth broken. POST /api/eval/ping returned ${authResponse.status}. ${String(authData["reason"] ?? authData["error"] ?? authResponse.statusText)}`);
  }
  if (authData["evalEnabled"] !== true) {
    console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=false, commit=${authCommit}`);
    throw new Error("Preflight failed: deployment OK, eval auth broken. evalEnabled is not true on the deployed API.");
  }
  if (authData["tokenAccepted"] !== true) {
    console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=false, commit=${authCommit}`);
    throw new Error("Preflight failed: deployment OK, eval auth broken. Evaluation token was not accepted by the deployed API.");
  }
  if (authData["mode"] !== "evaluation") {
    console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=true, commit=${authCommit}`);
    throw new Error(`Preflight failed: deployment OK, eval auth broken. Authenticated ping did not report evaluation mode; got ${String(authData["mode"] ?? "missing")}.`);
  }
  if (!versionsMatch(expectedVersion, authCommit)) {
    throw new Error(`Preflight failed: authenticated eval commit ${authCommit} does not match expected ${expectedVersion}. Deploy the current commit or pass the correct --expected-deployment-version.`);
  }
  console.error(`[evaluation] preflight: deployment reachable=true, eval route deployed=true, token accepted=true, commit=${authCommit}`);
  return authData;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tracksFromResponse(data: Record<string, unknown>): EvaluationTrack[] {
  const tracks = data["tracks"];
  return Array.isArray(tracks) ? tracks as EvaluationTrack[] : [];
}

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  const base = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 1500 * Math.pow(2, Math.min(attempt, 4));
  return Math.min(60_000, base);
}

async function postGenerate(
  config: HarnessConfig,
  benchmark: PlaylistBenchmarkPrompt,
  runMemory?: BenchmarkRunMemory,
): Promise<GenerationEvaluationResult> {
  const started = Date.now();
  const auditMode = !liveWritesEnabled(config);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authCookie) headers["Cookie"] = config.authCookie;
  if (config.token) headers["x-kwalify-evaluation-token"] = config.token;
  const body: Record<string, unknown> = {
    vibe: benchmark.prompt,
    mode: benchmark.mode,
    length: benchmark.length,
    varietyBoost: true,
  };
  if (auditMode) {
    body.auditMode = true;
    if (config.spotifyUserId) body.spotifyUserId = config.spotifyUserId;
    if (runMemory && runMemory.previousTrackLists.length > 0) {
      body.evaluationSessionMemory = {
        previousTrackIds: [...runMemory.previousTrackLists].reverse().slice(0, 20),
      };
    }
  }
  let httpRetries = 0;
  let attemptsMade = 0;
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= config.maxHttpRetries; attempt++) {
    attemptsMade += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
    const response = await fetch(`${config.baseUrl}/api/generate${auditMode ? "?audit=1" : ""}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    lastStatus = response.status;
    if ((response.status === 429 || response.status >= 500) && attempt < config.maxHttpRetries) {
      httpRetries += 1;
      await sleep(retryAfterMs(response, attempt));
      continue;
    }
    return {
      benchmark,
      ok: response.ok && data["success"] === true,
      status: response.status,
      error: response.ok ? undefined : String(data["message"] ?? data["error"] ?? response.statusText),
      response: { ...data, harnessHttp: { retries: httpRetries, attempts: attemptsMade } },
      tracks: tracksFromResponse(data),
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < config.maxHttpRetries) {
        httpRetries += 1;
        await sleep(1500 * Math.pow(2, Math.min(attempt, 4)));
        continue;
      }
  } finally {
    clearTimeout(timeout);
  }
  }
  return {
    benchmark,
    ok: false,
    status: lastStatus,
    error: lastError ?? "request_failed_after_retries",
    response: { harnessHttp: { retries: httpRetries, attempts: attemptsMade } },
    tracks: [],
    elapsedMs: Date.now() - started,
  };
}

type BenchmarkRunMemory = {
  previousTrackLists: string[][];
};

function trackIdFromEvaluationTrack(track: EvaluationTrack): string | null {
  const id = track.trackId || track.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function updateBenchmarkRunMemory(memory: BenchmarkRunMemory, result: GenerationEvaluationResult): void {
  const ids = result.tracks
    .map(trackIdFromEvaluationTrack)
    .filter((id): id is string => !!id);
  if (ids.length > 0) memory.previousTrackLists.push(ids);
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const prompts = selectPrompts(config);
  const started = Date.now();
  logStartup(config, prompts.length);
  if (config.dryRun) {
    const dryResults: GenerationEvaluationResult[] = prompts.map((benchmark) => ({
      benchmark,
      ok: false,
      response: { dryRun: true },
      tracks: [],
      elapsedMs: 0,
      error: "dry_run",
    }));
    const report = await writeEvaluationReports({
      outDir: config.outDir,
      generatedAt: new Date().toISOString(),
      run: {
        mode: liveWritesEnabled(config) ? "live-api" : "audit",
        baseUrl: config.baseUrl,
        promptCount: prompts.length,
        concurrency: config.concurrency,
        delayMs: config.delayMs,
        allowSpotifyCreate: config.allowSpotifyCreate,
        allowDbWrites: config.allowDbWrites,
        durationMs: Date.now() - started,
      },
      results: dryResults,
    });
    process.stdout.write(`${JSON.stringify({ dryRun: true, outDir: config.outDir, prompts: prompts.length, reportFiles: Object.keys(report) }, null, 2)}\n`);
    return;
  }
  const preflightData = await preflight(config);
  const deployedCommit = typeof preflightData["commit"] === "string"
    ? preflightData["commit"]
    : config.expectedDeploymentVersion ?? localGitHead() ?? "unknown";
  const stateFile = runStateFile(config.outDir);
  let savedState = config.resume ? await readJsonFile<EvaluationRunState>(stateFile) : null;
  if (config.resume && !savedState && config.outDir === "reports/playlist-evaluation/latest") {
    savedState = await readJsonFile<EvaluationRunState>(LEGACY_RUN_STATE_FILE);
  }
  if (config.resume && !savedState) {
    throw new Error(`Cannot resume: ${stateFile} does not exist. Run without --resume or pass --fresh.`);
  }
  if (savedState) {
    const promptIds = prompts.map((prompt) => prompt.id);
    if (savedState.baseUrl !== config.baseUrl) {
      throw new Error(`Cannot resume: saved base URL ${savedState.baseUrl} differs from ${config.baseUrl}. Pass --fresh to start over.`);
    }
    if (!versionsMatch(savedState.commitHash, deployedCommit)) {
      throw new Error(`Cannot resume: saved commit ${savedState.commitHash} differs from deployed commit ${deployedCommit}. Pass --fresh to start over.`);
    }
    if (savedState.totalPrompts !== prompts.length || savedState.promptIds.join("\n") !== promptIds.join("\n")) {
      throw new Error("Cannot resume: saved prompt selection differs from current prompt selection. Pass --fresh to start over.");
    }
    if (savedState.outDir !== config.outDir) {
      throw new Error(`Cannot resume: saved outDir ${savedState.outDir} differs from ${config.outDir}. Pass the same --out or use --fresh.`);
    }
  }
  if (!config.resume) {
    await rm(stateFile, { force: true });
    await rm(LEGACY_RUN_STATE_FILE, { force: true });
    await rm(path.join(config.outDir, "evaluation-results.jsonl"), { force: true });
  }
  const runId = savedState?.runId ?? randomUUID();
  const previousResults = config.resume ? await loadPreviousResults(config.outDir) : [];
  const resultByPrompt = new Map(previousResults.map((result) => [result.benchmark.id, result]));
  const results: GenerationEvaluationResult[] = prompts
    .map((prompt) => resultByPrompt.get(prompt.id))
    .filter((result): result is GenerationEvaluationResult => !!result);
  const completed = new Set(results.map((result) => result.benchmark.id));
  const runMemory: BenchmarkRunMemory = { previousTrackLists: [] };
  for (const result of results) updateBenchmarkRunMemory(runMemory, result);
  const clusterEarlyExitSummaries: ClusterEarlyExitSummary[] = [];
  const skippedClusters = new Set<string>();
  if (results.length > 0) {
    const report = await checkpointRun({
      runId,
      commitHash: deployedCommit,
      config,
      prompts,
      started,
      results,
    });
    if (report) {
      await writeLiveSummaryFiles({ config, prompts, started, results, report });
    }
    console.error(`[evaluation] resumed ${results.length}/${prompts.length} completed playlists from ${config.outDir}`);
  }
  const parallelSafe = config.concurrency > 1 && liveWritesEnabled(config) && config.clusterFailFast === null;
  if (config.concurrency > 1 && !parallelSafe) {
    console.error("[evaluation] concurrency kept serial: audit session memory or cluster fail-fast requires ordered execution");
  }
  if (parallelSafe) {
    const pendingPrompts = prompts
      .map((benchmark, index) => ({ benchmark, index }))
      .filter(({ benchmark }) => !completed.has(benchmark.id));
    let cursor = 0;
    const workerCount = Math.min(config.concurrency, pendingPrompts.length);
    let checkpointQueue: Promise<void> = Promise.resolve();
    const writeParallelCheckpoint = async (checkpoint: Parameters<typeof checkpointRun>[0]): Promise<Awaited<ReturnType<typeof checkpointRun>>> => {
      let report: Awaited<ReturnType<typeof checkpointRun>> = null;
      checkpointQueue = checkpointQueue.then(async () => {
        report = await checkpointRun(checkpoint);
      });
      await checkpointQueue;
      return report;
    };
    const runWorker = async (): Promise<void> => {
      while (cursor < pendingPrompts.length) {
        const next = pendingPrompts[cursor++];
        if (!next) return;
        const { benchmark, index } = next;
        console.error(`[evaluation] ${index + 1}/${prompts.length} ${benchmark.id}: ${benchmark.prompt}`);
        const promptStarted = Date.now();
        const result = await withStallWarning({
          prompt: benchmark,
          started: promptStarted,
          task: postGenerate(config, benchmark),
        });
        resultByPrompt.set(benchmark.id, result);
        completed.add(benchmark.id);
        const orderedResults = prompts
          .map((prompt) => resultByPrompt.get(prompt.id))
          .filter((row): row is GenerationEvaluationResult => !!row);
        results.splice(0, results.length, ...orderedResults);
        const report = await writeParallelCheckpoint({
          runId,
          commitHash: deployedCommit,
          config,
          prompts,
          started,
          results,
          latestResult: result,
          writeReports: writeReportCheckpointDue(results.length, config) || clusterShortcutCheckpointDue(results, benchmark.category, config),
        });
        if (report) {
          await writeLiveSummaryFiles({ config, prompts, started, results, report });
          printLiveProgress({ config, prompts, index, result, results, report });
        } else {
          console.error(`[evaluation] checkpoint persisted (${results.length}/${prompts.length}); next full report at ${Math.ceil(results.length / config.checkpointEvery) * config.checkpointEvery}`);
        }
        const failedCount = results.filter((row) => !row.ok).length;
        if (config.maxFailures !== null && failedCount >= config.maxFailures) {
          cursor = pendingPrompts.length;
          console.error(`[evaluation] stopping early: max failures reached (${failedCount}/${config.maxFailures})`);
        }
        if (config.delayMs > 0 && cursor < pendingPrompts.length) {
          await sleep(config.delayMs);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, runWorker));
  } else {
  for (let index = 0; index < prompts.length; index++) {
    const benchmark = prompts[index]!;
    if (completed.has(benchmark.id)) continue;
    if (skippedClusters.has(benchmark.category)) continue;
    console.error(`[evaluation] ${index + 1}/${prompts.length} ${benchmark.id}: ${benchmark.prompt}`);
    const promptStarted = Date.now();
    const result = await withStallWarning({
      prompt: benchmark,
      started: promptStarted,
      task: postGenerate(config, benchmark, runMemory),
    });
    resultByPrompt.set(benchmark.id, result);
    completed.add(benchmark.id);
    updateBenchmarkRunMemory(runMemory, result);
    const orderedResults = prompts
      .map((prompt) => resultByPrompt.get(prompt.id))
      .filter((row): row is GenerationEvaluationResult => !!row);
    results.splice(0, results.length, ...orderedResults);
    const report = await checkpointRun({
      runId,
      commitHash: deployedCommit,
      config,
      prompts,
      started,
      results,
      latestResult: result,
      writeReports: writeReportCheckpointDue(results.length, config) || clusterShortcutCheckpointDue(results, benchmark.category, config),
    });
    if (report) {
      await writeLiveSummaryFiles({ config, prompts, started, results, report });
      printLiveProgress({ config, prompts, index, result, results, report });
      if (config.clusterFailFast !== null) {
        const shortcut = clusterFailureShortcut({
          report,
          category: benchmark.category,
          prompts,
          completed,
          minPrompts: config.clusterFailFast,
          currentIndex: index,
        });
        if (shortcut) {
          skippedClusters.add(benchmark.category);
          clusterEarlyExitSummaries.push(shortcut);
          await writeJsonAtomic(path.join(config.outDir, "cluster-early-exit-summary.json"), clusterEarlyExitSummaries);
          console.error(`[evaluation] cluster early exit: ${benchmark.category} skipped ${shortcut.skippedPromptIds.length} prompts because ${shortcut.reason}`);
        }
      }
    } else {
      console.error(`[evaluation] checkpoint persisted (${results.length}/${prompts.length}); next full report at ${Math.ceil(results.length / config.checkpointEvery) * config.checkpointEvery}`);
    }
    const failedCount = results.filter((row) => !row.ok).length;
    if (config.maxFailures !== null && failedCount >= config.maxFailures) {
      console.error(`[evaluation] stopping early: max failures reached (${failedCount}/${config.maxFailures})`);
      break;
    }
    if (config.delayMs > 0 && prompts.slice(index + 1).some((prompt) => !completed.has(prompt.id))) {
      await sleep(config.delayMs);
    }
  }
  }
  const report = await checkpointRun({
    runId,
    commitHash: deployedCommit,
    config,
    prompts,
    started,
    results,
  });
  if (!report) throw new Error("Final evaluation report was not written.");
  await writeLiveSummaryFiles({ config, prompts, started, results, report });
  if (clusterEarlyExitSummaries.length > 0) {
    await writeJsonAtomic(path.join(config.outDir, "cluster-early-exit-summary.json"), clusterEarlyExitSummaries);
  }
  const failed = results.filter((result) => !result.ok);
  const success = results.length - failed.length;
  const playlistMetrics = report.summary.playlists;
  const average = (values: number[]): number => values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : 0;
  process.stdout.write(`${JSON.stringify({
    pass: failed.length === 0,
    outDir: config.outDir,
    prompts: prompts.length,
    succeeded: success,
    failed: failed.length,
    latency: {
      averageMs: report.spotifyApiMetrics.averageGenerationTimeMs,
      p95Ms: report.spotifyApiMetrics.p95GenerationTimeMs,
    },
    spotifyApi: {
      totalRequests: report.spotifyApiMetrics.totalSpotifyRequests,
      requestsPerPlaylist: report.spotifyApiMetrics.requestsPerPlaylist,
      cacheHitPercent: report.spotifyApiMetrics.cacheHitPercent,
      cacheMissPercent: report.spotifyApiMetrics.cacheMissPercent,
      retries: report.spotifyApiMetrics.retries,
      rateLimitEvents: report.spotifyApiMetrics.rateLimitEvents,
      averageGenerationTimeMs: report.spotifyApiMetrics.averageGenerationTimeMs,
      p95GenerationTimeMs: report.spotifyApiMetrics.p95GenerationTimeMs,
    },
    quality: {
      cacheHitRatePercent: report.spotifyApiMetrics.cacheHitPercent,
      averageArtistRepetition: average(playlistMetrics.map((row) => row.artistRepetition)),
      averageTrackRepetition: average(playlistMetrics.map((row) => row.trackRepetition)),
      averageCrossPlaylistOverlap: average(playlistMetrics.map((row) => row.crossPlaylistOverlap)),
      topFailureModes: report.summary.failureModes.slice(0, 10).map((row) => ({
        mode: row.mode,
        count: row.count,
        promptIds: row.promptIds.slice(0, 8),
      })),
    },
    improvementVsPreviousBaseline: {
      baselineSuccess: `${PREVIOUS_BASELINE.successCount}/${PREVIOUS_BASELINE.benchmarkSize}`,
      currentSuccess: `${success}/${prompts.length}`,
      successDelta: prompts.length === PREVIOUS_BASELINE.benchmarkSize
        ? success - PREVIOUS_BASELINE.successCount
        : null,
      baselineOverlap: PREVIOUS_BASELINE.overlap,
      currentOverlap: average(playlistMetrics.map((row) => row.crossPlaylistOverlap)),
      baselineTrackRepetition: PREVIOUS_BASELINE.trackRepetition,
      currentTrackRepetition: average(playlistMetrics.map((row) => row.trackRepetition)),
    },
    benchmarkSizeReports: report.benchmarkSizeReports,
    performanceControls: {
      checkpointEvery: config.checkpointEvery,
      clusterFailFast: config.clusterFailFast,
      clusterEarlyExits: clusterEarlyExitSummaries,
      parallelExecutionUsed: parallelSafe,
      completedEvaluations: results.length,
      skippedByClusterEarlyExit: clusterEarlyExitSummaries.reduce((sum, row) => sum + row.skippedPromptIds.length, 0),
    },
    worst: report.worstPlaylists.slice(0, 5).map((row) => ({ promptId: row.promptId, qualityScore: row.qualityScore, likelyCause: row.likelyCause })),
    best: report.bestPlaylists.slice(0, 5).map((row) => ({ promptId: row.promptId, qualityScore: row.qualityScore })),
  }, null, 2)}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

