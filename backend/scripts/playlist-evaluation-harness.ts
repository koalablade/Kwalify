import { PLAYLIST_BENCHMARK_PROMPTS, type PlaylistBenchmarkPrompt } from "../lib/playlist-evaluation/benchmark-prompts";
import { writeEvaluationReports } from "../lib/playlist-evaluation/report";
import type { EvaluationTrack, GenerationEvaluationResult } from "../lib/playlist-evaluation/metrics";

type HarnessConfig = {
  baseUrl: string;
  outDir: string;
  spotifyUserId: string | null;
  authCookie: string | null;
  token: string | null;
  liveApi: boolean;
  allowSpotifyCreate: boolean;
  concurrency: number;
  delayMs: number;
  limit: number | null;
  benchmarkSize: number | null;
  category: string | null;
  requestTimeoutMs: number;
  dryRun: boolean;
  maxHttpRetries: number;
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
    "  --concurrency N             Low concurrency limit (default 1, max 3)",
    "  --delay-ms N                Delay between requests per worker (default 1200)",
    "  --limit N                   Run only first N prompts",
    "  --benchmark-size N          Fixed run size: 10, 50, 100, or 250",
    "  --category NAME             Run one benchmark category",
    "  --timeout-ms N              Per-request timeout (default 90000)",
    "  --max-http-retries N        Harness API retries for 429/5xx (default 3)",
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
    concurrency: Math.max(1, Math.min(3, parseIntArg(args, "--concurrency", 1))),
    delayMs: parseIntArg(args, "--delay-ms", 1200),
    limit: argValue(args, "--limit") ? parseIntArg(args, "--limit", 0) : null,
    benchmarkSize,
    category: argValue(args, "--category"),
    requestTimeoutMs: parseIntArg(args, "--timeout-ms", 90_000),
    dryRun: args.includes("--dry-run"),
    maxHttpRetries: parseIntArg(args, "--max-http-retries", 3),
  };
  if (!config.baseUrl) {
    throw new Error("API_BASE_URL is required. Set API_BASE_URL or pass --base-url.");
  }
  if (config.dryRun) return config;
  if (config.liveApi && config.allowSpotifyCreate && !config.authCookie) {
    throw new Error("--allow-spotify-create requires --auth-cookie so the API runs exactly as an authenticated user");
  }
  if (!config.liveApi && !config.authCookie && (!config.token || !config.spotifyUserId)) {
    throw new Error("Audit mode requires either --auth-cookie or both --token/PLAYLIST_EVAL_TOKEN and --spotify-user-id");
  }
  if (config.liveApi && !config.authCookie && !config.token) {
    throw new Error("Live API mode requires --auth-cookie, or token-authorized audit fallback without Spotify creation");
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

function logStartup(config: HarnessConfig, promptCount: number): void {
  const auditOnly = !config.liveApi || !config.allowSpotifyCreate;
  console.error("[evaluation] startup");
  console.error(`[evaluation] Active mode: ${auditOnly ? "audit-only" : "live-api"}`);
  console.error(`[evaluation] Spotify writes: ${config.allowSpotifyCreate ? "enabled" : "disabled"}`);
  console.error(`[evaluation] DB writes: ${auditOnly ? "disabled" : "production API path"}`);
  console.error(`[evaluation] API_BASE_URL: ${sanitizedBaseUrl(config.baseUrl)}`);
  console.error(`[evaluation] prompts: ${promptCount}, concurrency: ${config.concurrency}, delayMs: ${config.delayMs}, maxHttpRetries: ${config.maxHttpRetries}`);
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

async function postGenerate(config: HarnessConfig, benchmark: PlaylistBenchmarkPrompt): Promise<GenerationEvaluationResult> {
  const started = Date.now();
  const auditMode = !config.liveApi || !config.allowSpotifyCreate;
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
  }
  let httpRetries = 0;
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= config.maxHttpRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
    const response = await fetch(`${config.baseUrl}/api/generate${auditMode ? "?audit=1&debug=1" : "?debug=1"}`, {
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
      response: { ...data, harnessHttp: { retries: httpRetries, attempts: attempt + 1 } },
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
    response: { harnessHttp: { retries: httpRetries, attempts: httpRetries + 1 } },
    tracks: [],
    elapsedMs: Date.now() - started,
  };
}

async function runLimited<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
      if (delayMs > 0 && cursor < items.length) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
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
        mode: config.liveApi && config.allowSpotifyCreate ? "live-api" : "audit",
        baseUrl: config.baseUrl,
        promptCount: prompts.length,
        concurrency: config.concurrency,
        delayMs: config.delayMs,
        allowSpotifyCreate: config.allowSpotifyCreate,
        durationMs: Date.now() - started,
      },
      results: dryResults,
    });
    console.log(JSON.stringify({ dryRun: true, outDir: config.outDir, prompts: prompts.length, reportFiles: Object.keys(report) }, null, 2));
    return;
  }
  const results = await runLimited(prompts, config.concurrency, config.delayMs, async (benchmark, index) => {
    console.error(`[evaluation] ${index + 1}/${prompts.length} ${benchmark.id}: ${benchmark.prompt}`);
    return postGenerate(config, benchmark);
  });
  const report = await writeEvaluationReports({
    outDir: config.outDir,
    generatedAt: new Date().toISOString(),
    run: {
      mode: config.liveApi && config.allowSpotifyCreate ? "live-api" : "audit",
      baseUrl: config.baseUrl,
      promptCount: prompts.length,
      concurrency: config.concurrency,
      delayMs: config.delayMs,
      allowSpotifyCreate: config.allowSpotifyCreate,
      durationMs: Date.now() - started,
    },
    results,
  });
  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    pass: failed.length === 0,
    outDir: config.outDir,
    prompts: prompts.length,
    failed: failed.length,
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
    benchmarkSizeReports: report.benchmarkSizeReports,
    worst: report.worstPlaylists.slice(0, 5).map((row) => ({ promptId: row.promptId, qualityScore: row.qualityScore, likelyCause: row.likelyCause })),
    best: report.bestPlaylists.slice(0, 5).map((row) => ({ promptId: row.promptId, qualityScore: row.qualityScore })),
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

