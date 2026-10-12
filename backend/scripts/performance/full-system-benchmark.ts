import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * PERFORMANCE TEST FREEZE
 *
 * This benchmark is measurement-only. Do not change:
 * - ranking logic
 * - retrieval logic
 * - scoring logic
 * - V3 pipeline
 * - caching strategy
 * - DB schema
 *
 * If the benchmark exposes a bottleneck, fix it in a separate implementation pass.
 */

type Config = {
  baseUrl: string;
  spotifyUserId: string;
  token: string;
  outDir: string;
  timeoutMs: number;
  length: number;
  mode: string;
  warmRepeats: number;
  delayMs: number;
};

type TimingBreakdown = {
  totalLatencyMs: number;
  preV3LatencyMs: number | null;
  dbSessionLoadMs: number | null;
  retrievalMs: number | null;
  scoringMs: number | null;
  curatorMs: number | null;
  v3LatencyMs: number | null;
  cacheHit: boolean;
};

type RequestResult = {
  testType: "cold" | "warm";
  promptId: string;
  prompt: string;
  iteration: number;
  ok: boolean;
  status: number | null;
  error: string | null;
  trackCount: number;
  underfilled: boolean;
  latencyMs: number;
  timing: TimingBreakdown;
  preV3PerformanceReport: Record<string, unknown> | null;
  pipelinePerformanceReport: Record<string, unknown> | null;
};

type BenchmarkReport = {
  generatedAt: string;
  commit: string;
  baseUrl: string;
  config: Omit<Config, "token"> & { token: "redacted" };
  methodology: {
    functionalChangeFreeze: string[];
    coldStartMethod: string;
    warmCacheMethod: string;
    cacheClearingLimitations: string;
  };
  prompts: Array<{ id: string; category: string; prompt: string }>;
  results: RequestResult[];
  summary: {
    coldAverageLatencyMs: number;
    warmAverageLatencyMs: number;
    coldAveragePreV3Ms: number;
    warmAveragePreV3Ms: number;
    coldAverageDbSessionLoadMs: number;
    warmAverageDbSessionLoadMs: number;
    warmLatencyImprovementPercent: number;
    warmPreV3ImprovementPercent: number;
    averageCacheHitRate: number;
    dbSessionLoadDominant: boolean;
    successCount: number;
    failureCount: number;
    status409Count: number;
    underfilledCount: number;
    slowestPrompt: string | null;
    slowestPromptLatencyMs: number;
  };
  worstCasePromptAnalysis: {
    prompt: string | null;
    reason: string;
    timing: TimingBreakdown | null;
  };
  stabilityCheck: {
    failures: Array<{ prompt: string; status: number | null; error: string | null }>;
    status409s: Array<{ prompt: string; error: string | null }>;
    underfilled: Array<{ prompt: string; trackCount: number }>;
  };
  over_optimisation_risk_analysis: {
    likelyDiminishingReturns: boolean;
    likelyExternalBottleneck: boolean;
    productionStabilityAssessment: "stable" | "mixed" | "unstable";
    notes: string[];
  };
};

const PROMPTS: Array<{ id: string; category: string; prompt: string }> = [
  {
    id: "driving-home-sunset",
    category: "emotional_complex",
    prompt: "Driving home after a long day, sunset, windows down, indie rock and alternative music with a hopeful feeling",
  },
  {
    id: "burnout-recovery-arc",
    category: "worst_case",
    prompt: "Start with burnout and frustration from work, then gradually transition into motivation, determination and confidence",
  },
  {
    id: "london-2am-introspection",
    category: "worst_case",
    prompt: "Music for wandering through London alone at 2am after some genuinely life-changing news",
  },
  {
    id: "eclectic-genre-mixing",
    category: "worst_case",
    prompt: "An eclectic but coherent playlist that blends post-rock, ambient, UK garage, art pop and soulful electronic music without feeling random",
  },
  {
    id: "deep-emotional-storytelling",
    category: "worst_case",
    prompt: "Create a 30-track playlist for someone rebuilding their life after a major setback. Begin exhausted and uncertain, move through reflection and acceptance, then end with genuine optimism and momentum",
  },
  {
    id: "genre-heavy-90s-trance",
    category: "genre_heavy",
    prompt: "A 90s trance night drive playlist with euphoric leads, steady momentum and no modern EDM festival drops",
  },
  {
    id: "minimal-focus",
    category: "minimal",
    prompt: "Deep focus coding",
  },
  {
    id: "modern-synthwave-spirit",
    category: "genre_heavy",
    prompt: "Modern music that captures the spirit of classic 1980s synthwave without sounding like a parody",
  },
  {
    id: "friendship-faded",
    category: "emotional_complex",
    prompt: "Music for a friendship that slowly faded away rather than ending dramatically. Quiet, reflective and mature",
  },
  {
    id: "global-accessible",
    category: "stress_discovery",
    prompt: "Introduce me to music from around the world that still feels emotionally accessible to someone who mostly listens to Western music",
  },
];

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  node backend/dist/scripts/performance/full-system-benchmark.js --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --out DIR              Output directory (default reports/performance)",
    "  --timeout-ms N         Per-request timeout (default 240000)",
    "  --length N             Playlist length (default 30)",
    "  --mode MODE            Generation mode (default balanced)",
    "  --warm-repeats N       Warm repeats for one prompt (default 6)",
    "  --delay-ms N           Delay between requests (default 250)",
  ].join("\n") + "\n");
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

function parseConfig(args: string[]): Config {
  if (args.includes("--help") || args.includes("-h")) usage();
  const baseUrl = argValue(args, "--base-url") ?? process.env["API_BASE_URL"] ?? process.env["PLAYLIST_EVAL_BASE_URL"] ?? "";
  const spotifyUserId = argValue(args, "--spotify-user-id") ?? process.env["SPOTIFY_USER_ID"] ?? process.env["PLAYLIST_EVAL_SPOTIFY_USER_ID"] ?? "";
  const token = argValue(args, "--token") ?? process.env["PLAYLIST_EVAL_TOKEN"] ?? "";
  if (!baseUrl) throw new Error("API base URL is required.");
  if (!spotifyUserId) throw new Error("Spotify user id is required.");
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN is required.");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    spotifyUserId,
    token,
    outDir: argValue(args, "--out") ?? "reports/performance",
    timeoutMs: parseIntArg(args, "--timeout-ms", 240_000),
    length: parseIntArg(args, "--length", 30),
    mode: argValue(args, "--mode") ?? "balanced",
    warmRepeats: Math.max(1, parseIntArg(args, "--warm-repeats", 6)),
    delayMs: parseIntArg(args, "--delay-ms", 250),
  };
}

function localGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stageDuration(preV3: Record<string, unknown>, stage: string): number | null {
  for (const item of arrayValue(preV3["stageBreakdown"])) {
    const entry = record(item);
    if (entry["stage"] === stage) return numberValue(entry["durationMs"]);
  }
  return null;
}

function pipelineStageDuration(performance: Record<string, unknown>, pattern: RegExp): number | null {
  let total = 0;
  let matched = false;
  for (const item of arrayValue(performance["stages"])) {
    const entry = record(item);
    const name = typeof entry["stageName"] === "string" ? entry["stageName"] : "";
    const duration = numberValue(entry["durationMs"]) ?? 0;
    if (pattern.test(name)) {
      matched = true;
      total += duration;
    }
  }
  return matched ? total : null;
}

function cacheHit(preV3: Record<string, unknown>): boolean {
  const hitRate = numberValue(preV3["cacheHitRate"]) ?? 0;
  return hitRate > 0;
}

function cookieHeader(cookies: Map<string, string>): string | undefined {
  if (cookies.size === 0) return undefined;
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(cookies: Map<string, string>, headers: Headers): void {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return;
  for (const part of setCookie.split(/,(?=[^;,]+=)/)) {
    const [pair] = part.split(";");
    const [key, ...valueParts] = (pair ?? "").split("=");
    if (key && valueParts.length > 0) cookies.set(key.trim(), valueParts.join("=").trim());
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  cookies: Map<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    const cookie = cookieHeader(cookies);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    storeCookies(cookies, response.headers);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runGenerate(opts: {
  config: Config;
  testType: "cold" | "warm";
  promptId: string;
  prompt: string;
  iteration: number;
  cookies: Map<string, string>;
}): Promise<RequestResult> {
  const started = Date.now();
  try {
    const response = await fetchJson(`${opts.config.baseUrl}/api/generate?audit=1&debugPerformance=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": opts.config.token,
      },
      body: JSON.stringify({
        spotifyUserId: opts.config.spotifyUserId,
        vibe: opts.prompt,
        mode: opts.config.mode,
        length: opts.config.length,
        auditMode: true,
        debugPerformance: true,
      }),
    }, opts.config.timeoutMs, opts.cookies);
    const latencyMs = Date.now() - started;
    const preV3 = record(response.body["preV3PerformanceReport"]);
    const performance = record(response.body["pipelinePerformanceReport"]);
    const v3Timing = record(record(response.body["v3Diagnostics"])["timingMs"]);
    const trackCount = numberValue(response.body["totalTracks"]) ?? numberValue(response.body["count"]) ?? 0;
    const error = typeof response.body["error"] === "string" ? response.body["error"] : null;
    const timing: TimingBreakdown = {
      totalLatencyMs: latencyMs,
      preV3LatencyMs: numberValue(preV3["totalPreV3Time"]),
      dbSessionLoadMs: stageDuration(preV3, "dbSessionLoad"),
      retrievalMs: pipelineStageDuration(performance, /retrieval/i),
      scoringMs: pipelineStageDuration(performance, /scoring/i),
      curatorMs: pipelineStageDuration(performance, /curator/i),
      v3LatencyMs: numberValue(v3Timing["total"]) ?? pipelineStageDuration(performance, /^v3\./i),
      cacheHit: cacheHit(preV3),
    };
    return {
      testType: opts.testType,
      promptId: opts.promptId,
      prompt: opts.prompt,
      iteration: opts.iteration,
      ok: response.status >= 200 && response.status < 300 && response.body["success"] === true,
      status: response.status,
      error,
      trackCount,
      underfilled: response.status >= 200 && response.status < 300 && trackCount > 0 && trackCount < opts.config.length,
      latencyMs,
      timing,
      preV3PerformanceReport: Object.keys(preV3).length ? preV3 : null,
      pipelinePerformanceReport: Object.keys(performance).length ? performance : null,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      testType: opts.testType,
      promptId: opts.promptId,
      prompt: opts.prompt,
      iteration: opts.iteration,
      ok: false,
      status: null,
      error,
      trackCount: 0,
      underfilled: false,
      latencyMs: Date.now() - started,
      timing: {
        totalLatencyMs: Date.now() - started,
        preV3LatencyMs: null,
        dbSessionLoadMs: null,
        retrievalMs: null,
        scoringMs: null,
        curatorMs: null,
        v3LatencyMs: null,
        cacheHit: false,
      },
      preV3PerformanceReport: null,
      pipelinePerformanceReport: null,
    };
  }
}

function average(values: Array<number | null>): number {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 100) / 100 : 0;
}

function percentImprovement(cold: number, warm: number): number {
  if (cold <= 0) return 0;
  return Math.round(((cold - warm) / cold) * 10_000) / 100;
}

function dbDominant(results: RequestResult[]): boolean {
  const withDb = results.filter((result) => result.timing.preV3LatencyMs && result.timing.dbSessionLoadMs);
  if (!withDb.length) return false;
  const dominantCount = withDb.filter((result) =>
    (result.timing.dbSessionLoadMs ?? 0) >= (result.timing.preV3LatencyMs ?? 1) * 0.5
  ).length;
  return dominantCount / withDb.length >= 0.5;
}

function buildReport(config: Config, results: RequestResult[]): BenchmarkReport {
  const cold = results.filter((result) => result.testType === "cold");
  const warm = results.filter((result) => result.testType === "warm");
  const coldAverageLatencyMs = average(cold.map((result) => result.latencyMs));
  const warmAverageLatencyMs = average(warm.map((result) => result.latencyMs));
  const coldAveragePreV3Ms = average(cold.map((result) => result.timing.preV3LatencyMs));
  const warmAveragePreV3Ms = average(warm.map((result) => result.timing.preV3LatencyMs));
  const slowest = [...results].sort((a, b) => b.latencyMs - a.latencyMs)[0] ?? null;
  const failures = results.filter((result) => !result.ok);
  const status409s = results.filter((result) => result.status === 409);
  const underfilled = results.filter((result) => result.underfilled);
  const dbIsDominant = dbDominant(results);
  const successRate = results.length ? (results.length - failures.length) / results.length : 0;
  const warmImprovement = percentImprovement(coldAverageLatencyMs, warmAverageLatencyMs);
  const coldDbAverage = average(cold.map((result) => result.timing.dbSessionLoadMs));
  const maxDbSessionLoad = Math.max(...results.map((result) => result.timing.dbSessionLoadMs ?? 0), 0);
  const likelyExternal = dbIsDominant && (coldDbAverage > 2_000 || maxDbSessionLoad > 5_000);
  return {
    generatedAt: new Date().toISOString(),
    commit: localGitHead(),
    baseUrl: config.baseUrl,
    config: { ...config, token: "redacted" },
    methodology: {
      functionalChangeFreeze: [
        "ranking logic",
        "retrieval logic",
        "scoring logic",
        "V3 pipeline",
        "caching strategy",
        "DB schema",
      ],
      coldStartMethod: "Run against a freshly restarted server, new HTTP sessions, debugPerformance=true, and distinct prompts.",
      warmCacheMethod: "Repeat the same prompt with one preserved HTTP session to measure session/prompt cache behavior.",
      cacheClearingLimitations: "The benchmark does not mutate server internals or expose a cache-clear endpoint; only the first request after server restart is fully process-cold. Later cold-prompt requests may benefit from global liked-song/genre-profile caches.",
    },
    prompts: PROMPTS,
    results,
    summary: {
      coldAverageLatencyMs,
      warmAverageLatencyMs,
      coldAveragePreV3Ms,
      warmAveragePreV3Ms,
      coldAverageDbSessionLoadMs: average(cold.map((result) => result.timing.dbSessionLoadMs)),
      warmAverageDbSessionLoadMs: average(warm.map((result) => result.timing.dbSessionLoadMs)),
      warmLatencyImprovementPercent: warmImprovement,
      warmPreV3ImprovementPercent: percentImprovement(coldAveragePreV3Ms, warmAveragePreV3Ms),
      averageCacheHitRate: average(results.map((result) => {
        const report = result.preV3PerformanceReport;
        return report ? numberValue(report["cacheHitRate"]) : null;
      })),
      dbSessionLoadDominant: dbIsDominant,
      successCount: results.filter((result) => result.ok).length,
      failureCount: failures.length,
      status409Count: status409s.length,
      underfilledCount: underfilled.length,
      slowestPrompt: slowest?.prompt ?? null,
      slowestPromptLatencyMs: slowest?.latencyMs ?? 0,
    },
    worstCasePromptAnalysis: {
      prompt: slowest?.prompt ?? null,
      reason: slowest
        ? `Slowest request was dominated by ${slowest.preV3PerformanceReport?.["bottleneckStage"] ?? slowest.pipelinePerformanceReport?.["bottleneckStage"] ?? "unknown stage"}.`
        : "No requests completed.",
      timing: slowest?.timing ?? null,
    },
    stabilityCheck: {
      failures: failures.map((result) => ({ prompt: result.prompt, status: result.status, error: result.error })),
      status409s: status409s.map((result) => ({ prompt: result.prompt, error: result.error })),
      underfilled: underfilled.map((result) => ({ prompt: result.prompt, trackCount: result.trackCount })),
    },
    over_optimisation_risk_analysis: {
      likelyDiminishingReturns: warmImprovement < 20 && successRate >= 0.95,
      likelyExternalBottleneck: likelyExternal,
      productionStabilityAssessment: successRate >= 0.95 && underfilled.length === 0
        ? "stable"
        : successRate >= 0.8
          ? "mixed"
          : "unstable",
      notes: [
        likelyExternal
          ? "dbSessionLoad is confirmed as the cold-path bottleneck; further local CPU micro-optimisation is likely lower ROI than DB/query/cache strategy work."
          : dbIsDominant
            ? "dbSessionLoad dominated by count, but average DB latency was below the external-bottleneck threshold in this run."
            : "DB did not dominate this run; inspect per-stage breakdown before changing infrastructure.",
        underfilled.length === 0
          ? "No successful request silently underfilled."
          : "At least one successful request underfilled and needs follow-up.",
        status409s.length > 0
          ? "409 responses were explicit constraint/evidence failures, not silent generation corruption."
          : "No 409 responses observed.",
      ],
    },
  };
}

function markdownReport(report: BenchmarkReport): string {
  const s = report.summary;
  return [
    "# Cold vs Warm Performance Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.commit}`,
    `Base URL: ${report.baseUrl}`,
    "",
    "## Methodology",
    "",
    `- Cold start method: ${report.methodology.coldStartMethod}`,
    `- Warm cache method: ${report.methodology.warmCacheMethod}`,
    `- Cache clearing limitations: ${report.methodology.cacheClearingLimitations}`,
    "",
    "## Latency",
    "",
    `- Cold average latency: ${s.coldAverageLatencyMs}ms`,
    `- Warm average latency: ${s.warmAverageLatencyMs}ms`,
    `- Warm latency improvement: ${s.warmLatencyImprovementPercent}%`,
    `- Cold average pre-V3: ${s.coldAveragePreV3Ms}ms`,
    `- Warm average pre-V3: ${s.warmAveragePreV3Ms}ms`,
    `- Warm pre-V3 improvement: ${s.warmPreV3ImprovementPercent}%`,
    "",
    "## Bottleneck Confirmation",
    "",
    `- Cold average dbSessionLoad: ${s.coldAverageDbSessionLoadMs}ms`,
    `- Warm average dbSessionLoad: ${s.warmAverageDbSessionLoadMs}ms`,
    `- dbSessionLoad dominant: ${s.dbSessionLoadDominant ? "yes" : "no"}`,
    `- Slowest prompt: ${s.slowestPrompt ?? "n/a"}`,
    `- Slowest prompt latency: ${s.slowestPromptLatencyMs}ms`,
    `- Slowest prompt analysis: ${report.worstCasePromptAnalysis.reason}`,
    "",
    "## Stability",
    "",
    `- Success count: ${s.successCount}/${report.results.length}`,
    `- Failure count: ${s.failureCount}/${report.results.length}`,
    `- 409 count: ${s.status409Count}`,
    `- Underfilled successful playlists: ${s.underfilledCount}`,
    "",
    "## Cache Effectiveness",
    "",
    `- Average pre-V3 cache hit rate: ${s.averageCacheHitRate}`,
    `- Warm vs cold latency reduction: ${s.warmLatencyImprovementPercent}%`,
    "",
    "## Over-Optimisation Risk Analysis",
    "",
    `- Likely diminishing returns: ${report.over_optimisation_risk_analysis.likelyDiminishingReturns ? "yes" : "no"}`,
    `- Likely external bottleneck: ${report.over_optimisation_risk_analysis.likelyExternalBottleneck ? "yes" : "no"}`,
    `- Production stability assessment: ${report.over_optimisation_risk_analysis.productionStabilityAssessment}`,
    ...report.over_optimisation_risk_analysis.notes.map((note) => `- ${note}`),
    "",
    "## Per-Request Results",
    "",
    ...report.results.map((result) => [
      `### ${result.testType.toUpperCase()} ${result.promptId} #${result.iteration}`,
      "",
      `- Status: ${result.ok ? "PASS" : "FAIL"}${result.status ? ` (${result.status})` : ""}`,
      `- Latency: ${result.latencyMs}ms`,
      `- Tracks: ${result.trackCount}`,
      `- Pre-V3: ${result.timing.preV3LatencyMs ?? "n/a"}ms`,
      `- dbSessionLoad: ${result.timing.dbSessionLoadMs ?? "n/a"}ms`,
      `- Retrieval: ${result.timing.retrievalMs ?? "n/a"}ms`,
      `- Scoring: ${result.timing.scoringMs ?? "n/a"}ms`,
      `- Curator: ${result.timing.curatorMs ?? "n/a"}ms`,
      `- V3: ${result.timing.v3LatencyMs ?? "n/a"}ms`,
      `- Cache hit: ${result.timing.cacheHit ? "yes" : "no"}`,
      result.error ? `- Error: ${result.error}` : null,
    ].filter((line): line is string => line !== null).join("\n")),
    "",
  ].join("\n");
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const results: RequestResult[] = [];
  for (const prompt of PROMPTS) {
    process.stderr.write(`[full-system-benchmark] cold: ${prompt.id}\n`);
    results.push(await runGenerate({
      config,
      testType: "cold",
      promptId: prompt.id,
      prompt: prompt.prompt,
      iteration: 1,
      cookies: new Map(),
    }));
    await sleep(config.delayMs);
  }

  const warmPrompt = PROMPTS[0]!;
  const warmCookies = new Map<string, string>();
  for (let iteration = 1; iteration <= config.warmRepeats; iteration++) {
    process.stderr.write(`[full-system-benchmark] warm ${iteration}/${config.warmRepeats}: ${warmPrompt.id}\n`);
    results.push(await runGenerate({
      config,
      testType: "warm",
      promptId: warmPrompt.id,
      prompt: warmPrompt.prompt,
      iteration,
      cookies: warmCookies,
    }));
    await sleep(config.delayMs);
  }

  const report = buildReport(config, results);
  await mkdir(config.outDir, { recursive: true });
  const jsonPath = path.join(config.outDir, "cold-vs-warm-analysis.json");
  const mdPath = path.join(config.outDir, "cold-vs-warm-summary.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, markdownReport(report));
  process.stdout.write(JSON.stringify({
    jsonPath,
    mdPath,
    coldAverageLatencyMs: report.summary.coldAverageLatencyMs,
    warmAverageLatencyMs: report.summary.warmAverageLatencyMs,
    dbSessionLoadDominant: report.summary.dbSessionLoadDominant,
    successCount: report.summary.successCount,
    failureCount: report.summary.failureCount,
    underfilledCount: report.summary.underfilledCount,
  }, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
