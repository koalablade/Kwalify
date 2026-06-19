import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { getFallbackCache, setFallbackCache, clearFallbackCacheForValidation, getFallbackCacheStats, requestPatternKey } from "../lib/fallback-cache";
import { classifyFailure, createFailureContext } from "../lib/failure-types";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

type Config = {
  baseUrl: string;
  outDir: string;
  spotifyUserId: string;
  token: string;
  requests: number[];
  concurrency: number[];
  concurrencyRequests: number;
  timeoutMs: number;
  expectedDeploymentVersion: string | null;
  dryRun: boolean;
  enforceSlo: boolean;
};

type RequestRow = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  timeout: boolean;
  degraded: boolean;
  recoveryCount: number;
  failureCount: number;
  queueRejected: boolean;
  error: string | null;
  heapUsedMb: number;
};

type ScenarioReport = {
  name: string;
  requests: number;
  concurrency: number;
  durationMs: number;
  requestsPerSecond: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  timeoutCount: number;
  degradedCount: number;
  recoveryCount: number;
  failureCount: number;
  rejectionCount: number;
  memory: {
    startHeapMb: number;
    endHeapMb: number;
    maxHeapMb: number;
    heapGrowthMb: number;
  };
};

type ValidationReport = {
  generatedAt: string;
  commit: string;
  baseUrl: string;
  dryRun: boolean;
  load: ScenarioReport[];
  concurrency: ScenarioReport[];
  slo: {
    enforced: boolean;
    pass: boolean;
    violations: string[];
    thresholds: {
      maxP95LatencyMs: number;
      maxTimeoutRate: number;
      maxFailureRate: number;
      maxHeapGrowthMb: number;
    };
  };
  cacheValidation: {
    pass: boolean;
    ttlExpiry: boolean;
    eviction: boolean;
    maxSizeRespected: boolean;
    stats: ReturnType<typeof getFallbackCacheStats>;
  };
  failureClassification: {
    pass: boolean;
    rows: Array<{ stage: string; expected: string; actual: string; pass: boolean }>;
  };
  securityProbes: {
    largePayload: {
      attempted: boolean;
      pass: boolean;
      status: number | null;
      code: string | null;
    };
  };
  notes: string[];
};

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  npm run validation:production -- --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --out DIR                         Output directory (default reports/production-validation/latest)",
    "  --requests LIST                   Request counts, comma-separated (default 100)",
    "  --concurrency LIST                Concurrency levels, comma-separated (default 5,10,25,50,100)",
    "  --concurrency-requests N          Requests per concurrency scenario (default 100, 0 to skip)",
    "  --timeout-ms N                    Per-request timeout (default 120000)",
    "  --expected-deployment-version SHA Expected deployed commit",
    "  --dry-run                         Validate local cache/classification only",
  ].join("\n") + "\n");
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function intList(raw: string | null, fallback: number[]): number[] {
  if (!raw) return fallback;
  return raw.split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseConfig(args: string[]): Config {
  if (args.includes("--help") || args.includes("-h")) usage();
  const dryRun = args.includes("--dry-run");
  const enforceSlo = args.includes("--enforce-slo");
  const creds = resolveLiveBenchmarkCredentials({
    dryRun,
    strict: !dryRun,
    cli: {
      baseUrl: argValue(args, "--base-url"),
      spotifyUserId: argValue(args, "--spotify-user-id"),
      token: argValue(args, "--token"),
      expectedDeploymentVersion: argValue(args, "--expected-deployment-version"),
    },
  });
  return {
    baseUrl: creds.baseUrl,
    outDir: argValue(args, "--out") ?? "reports/production-validation/latest",
    spotifyUserId: creds.spotifyUserId,
    token: creds.token,
    requests: intList(argValue(args, "--requests"), [100]),
    concurrency: intList(argValue(args, "--concurrency"), [5, 10, 25, 50, 100]),
    concurrencyRequests: Number(argValue(args, "--concurrency-requests") ?? 100),
    timeoutMs: Number(argValue(args, "--timeout-ms") ?? 120_000),
    expectedDeploymentVersion: creds.expectedDeploymentVersion,
    dryRun,
    enforceSlo,
  };
}

function localGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function versionsMatch(expected: string, actual: string): boolean {
  if (!expected || !actual || expected === "unknown" || actual === "unknown") return true;
  return expected === actual || expected.startsWith(actual) || actual.startsWith(expected);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function preflight(config: Config): Promise<void> {
  if (config.dryRun) return;
  process.stderr.write("[validation] preflight GET /api/eval/ping\n");
  const ping = await fetchJson(`${config.baseUrl}/api/eval/ping`, { method: "GET" }, 15_000);
  const commit = String(ping.body["commit"] ?? "unknown");
  const expected = config.expectedDeploymentVersion ?? localGitHead();
  if (!versionsMatch(expected, commit)) {
    throw new Error(`Deployment commit mismatch: expected ${expected}, got ${commit}`);
  }
  process.stderr.write(`[validation] preflight GET ok commit=${commit}\n`);
  process.stderr.write("[validation] preflight GET /api/readyz\n");
  const ready = await fetchJson(`${config.baseUrl}/api/readyz`, { method: "GET" }, 15_000);
  if (ready.status >= 400 || ready.body["status"] !== "ready" || ready.body["readiness"] !== "ready") {
    throw new Error(`Readiness preflight failed: /api/readyz returned ${ready.status} ${JSON.stringify(ready.body)}`);
  }
  process.stderr.write("[validation] preflight readiness ok\n");
  process.stderr.write("[validation] preflight POST /api/eval/ping\n");
  const auth = await fetchJson(`${config.baseUrl}/api/eval/ping`, {
    method: "POST",
    headers: { "x-eval-token": config.token },
  }, 15_000);
  if (auth.status >= 400 || auth.body["tokenAccepted"] !== true) {
    throw new Error(`Eval preflight failed: token rejected with status ${auth.status}`);
  }
  process.stderr.write("[validation] preflight POST ok\n");
}

function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractTrace(body: Record<string, unknown>): { degraded: boolean; recoveryCount: number; failureCount: number } {
  const diagnostics = body["diagnostics"] as Record<string, unknown> | undefined;
  const trace = diagnostics?.["trace"] as Record<string, unknown> | undefined;
  const v3 = body["v3Diagnostics"] as Record<string, unknown> | undefined;
  const degraded = body["degraded"] === true || (Array.isArray(body["degradationReasons"]) && body["degradationReasons"].length > 0);
  const recoveryEvents = Array.isArray(trace?.["recoveryEvents"])
    ? trace?.["recoveryEvents"] as unknown[]
    : Array.isArray(v3?.["recoveryEvents"])
      ? v3?.["recoveryEvents"] as unknown[]
      : [];
  const failures = Array.isArray(trace?.["failures"])
    ? trace?.["failures"] as unknown[]
    : Array.isArray(v3?.["failureTrace"])
      ? v3?.["failureTrace"] as unknown[]
      : [];
  return { degraded, recoveryCount: recoveryEvents.length, failureCount: failures.length };
}

async function postGenerate(config: Config, index: number): Promise<RequestRow> {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS[index % PLAYLIST_BENCHMARK_PROMPTS.length]!;
  const started = Date.now();
  try {
    const result = await fetchJson(`${config.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": config.token,
      },
      body: JSON.stringify({
        vibe: prompt.prompt,
        mode: prompt.mode ?? "balanced",
        length: 30,
        spotifyUserId: config.spotifyUserId,
      }),
    }, config.timeoutMs);
    const elapsed = Date.now() - started;
    const trace = extractTrace(result.body);
    return {
      ok: result.status >= 200 && result.status < 300 && result.body["success"] === true,
      status: result.status,
      latencyMs: elapsed,
      timeout: false,
      degraded: trace.degraded,
      recoveryCount: trace.recoveryCount,
      failureCount: trace.failureCount,
      queueRejected: result.status === 503 || result.body["code"] === "SERVER_BUSY",
      error: typeof result.body["error"] === "string" ? result.body["error"] : null,
      heapUsedMb: heapUsedMb(),
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    return {
      ok: false,
      status: null,
      latencyMs: elapsed,
      timeout: err instanceof Error && err.name === "AbortError",
      degraded: false,
      recoveryCount: 0,
      failureCount: 1,
      queueRejected: false,
      error: err instanceof Error ? err.message : String(err),
      heapUsedMb: heapUsedMb(),
    };
  }
}

async function runScenario(config: Config, name: string, requests: number, concurrency: number): Promise<ScenarioReport> {
  const started = Date.now();
  const startHeap = heapUsedMb();
  const rows: RequestRow[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < requests) {
      const index = next++;
      rows.push(await postGenerate(config, index));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
  const durationMs = Date.now() - started;
  const latencies = rows.map((row) => row.latencyMs);
  const endHeap = heapUsedMb();
  return {
    name,
    requests,
    concurrency,
    durationMs,
    requestsPerSecond: Math.round((requests / Math.max(1, durationMs / 1000)) * 100) / 100,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    timeoutCount: rows.filter((row) => row.timeout).length,
    degradedCount: rows.filter((row) => row.degraded).length,
    recoveryCount: rows.reduce((sum, row) => sum + row.recoveryCount, 0),
    failureCount: rows.filter((row) => !row.ok).length + rows.reduce((sum, row) => sum + row.failureCount, 0),
    rejectionCount: rows.filter((row) => row.queueRejected).length,
    memory: {
      startHeapMb: startHeap,
      endHeapMb: endHeap,
      maxHeapMb: Math.max(...rows.map((row) => row.heapUsedMb), endHeap),
      heapGrowthMb: Math.round((endHeap - startHeap) * 100) / 100,
    },
  };
}

async function runSecurityProbes(config: Config): Promise<ValidationReport["securityProbes"]> {
  if (config.dryRun) {
    return {
      largePayload: { attempted: false, pass: false, status: null, code: null },
    };
  }
  const payload = {
    vibe: "x".repeat(1024 * 1024 + 128 * 1024),
    mode: "balanced",
    length: 30,
    spotifyUserId: config.spotifyUserId,
  };
  const result = await fetchJson(`${config.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": config.token,
    },
    body: JSON.stringify(payload),
  }, config.timeoutMs);
  const code = typeof result.body["code"] === "string" ? result.body["code"] : null;
  return {
    largePayload: {
      attempted: true,
      pass: result.status === 413 && code === "PAYLOAD_TOO_LARGE",
      status: result.status,
      code,
    },
  };
}

async function validateCache(): Promise<ValidationReport["cacheValidation"]> {
  clearFallbackCacheForValidation();
  const key = requestPatternKey("validation", { prompt: "ttl" });
  setFallbackCache(key, { ok: true }, { ttlMs: 20, maxEntries: 3 });
  const beforeExpiry = getFallbackCache<{ ok: boolean }>(key)?.ok === true;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const ttlExpiry = beforeExpiry && getFallbackCache(key) === null;
  clearFallbackCacheForValidation();
  for (let i = 0; i < 5; i++) {
    setFallbackCache(`validation:${i}`, i, { ttlMs: 60_000, maxEntries: 3 });
  }
  const stats = getFallbackCacheStats();
  const eviction = getFallbackCache("validation:0") === null && getFallbackCache("validation:4") === 4;
  const maxSizeRespected = stats.size <= 3;
  return {
    pass: ttlExpiry && eviction && maxSizeRespected,
    ttlExpiry,
    eviction,
    maxSizeRespected,
    stats,
  };
}

function validateFailureClassification(): ValidationReport["failureClassification"] {
  const checks = [
    { stage: "v3.retrieval", error: new Error("boom"), expected: "RETRIEVAL_FAILURE" },
    { stage: "v3.scoring", error: new Error("boom"), expected: "SCORING_FAILURE" },
    { stage: "v3.clustering", error: new Error("boom"), expected: "CLUSTERING_FAILURE" },
    { stage: "hard_timeout", error: new Error("timeout"), expected: "TIMEOUT_FAILURE" },
    { stage: "db_query", error: Object.assign(new Error("connection terminated"), { code: "08006" }), expected: "DB_FAILURE" },
  ];
  const rows = checks.map((check) => {
    const ctx = createFailureContext({ stage: check.stage, error: check.error, requestId: "validation" });
    return {
      stage: check.stage,
      expected: check.expected,
      actual: ctx.type,
      pass: classifyFailure(check.stage, check.error) === check.expected,
    };
  });
  return { pass: rows.every((row) => row.pass), rows };
}

function validateSlo(
  scenarios: ScenarioReport[],
  enforce: boolean,
): ValidationReport["slo"] {
  const maxP95LatencyMs = Number.parseInt(process.env["PROD_SLO_P95_MS"] ?? "90000", 10);
  const maxTimeoutRate = Number.parseFloat(process.env["PROD_SLO_TIMEOUT_RATE"] ?? "0.05");
  const maxFailureRate = Number.parseFloat(process.env["PROD_SLO_FAILURE_RATE"] ?? "0.08");
  const maxHeapGrowthMb = Number.parseInt(process.env["PROD_SLO_HEAP_GROWTH_MB"] ?? "256", 10);
  const thresholds = { maxP95LatencyMs, maxTimeoutRate, maxFailureRate, maxHeapGrowthMb };
  const violations: string[] = [];

  for (const scenario of scenarios) {
    if (scenario.p95LatencyMs > maxP95LatencyMs) {
      violations.push(`${scenario.name}: p95 ${scenario.p95LatencyMs}ms > ${maxP95LatencyMs}ms`);
    }
    const timeoutRate = scenario.timeoutCount / Math.max(1, scenario.requests);
    if (timeoutRate > maxTimeoutRate) {
      violations.push(`${scenario.name}: timeout rate ${timeoutRate.toFixed(3)} > ${maxTimeoutRate}`);
    }
    const failureRate = scenario.failureCount / Math.max(1, scenario.requests);
    if (failureRate > maxFailureRate) {
      violations.push(`${scenario.name}: failure rate ${failureRate.toFixed(3)} > ${maxFailureRate}`);
    }
    if (scenario.memory.heapGrowthMb > maxHeapGrowthMb) {
      violations.push(`${scenario.name}: heap growth ${scenario.memory.heapGrowthMb}MB > ${maxHeapGrowthMb}MB`);
    }
  }

  return {
    enforced: enforce,
    pass: violations.length === 0,
    violations,
    thresholds,
  };
}

function markdown(report: ValidationReport): string {
  const scenarioRows = [...report.load, ...report.concurrency]
    .map((row) => `| ${row.name} | ${row.requests} | ${row.concurrency} | ${row.requestsPerSecond} | ${row.p50LatencyMs} | ${row.p95LatencyMs} | ${row.p99LatencyMs} | ${row.timeoutCount} | ${row.degradedCount} | ${row.recoveryCount} | ${row.failureCount} | ${row.rejectionCount} | ${row.memory.heapGrowthMb} |`)
    .join("\n");
  return `# Production Validation Report

Generated: ${report.generatedAt}

Commit: ${report.commit}

Base URL: ${report.baseUrl || "dry-run"}

## Load And Concurrency

| Scenario | Requests | Concurrency | RPS | P50 ms | P95 ms | P99 ms | Timeouts | Degraded | Recoveries | Failures | Rejections | Heap Growth MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${scenarioRows || "| Not run | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"}

## Cache Validation

- Pass: ${report.cacheValidation.pass}
- TTL expiry: ${report.cacheValidation.ttlExpiry}
- Eviction: ${report.cacheValidation.eviction}
- Max size respected: ${report.cacheValidation.maxSizeRespected}
- Stats: ${JSON.stringify(report.cacheValidation.stats)}

## Failure Classification

- Pass: ${report.failureClassification.pass}

${report.failureClassification.rows.map((row) => `- ${row.stage}: expected ${row.expected}, got ${row.actual} (${row.pass ? "pass" : "fail"})`).join("\n")}

## Security Probes

- Large payload attempted: ${report.securityProbes.largePayload.attempted}
- Large payload rejected correctly: ${report.securityProbes.largePayload.pass}
- Large payload status/code: ${report.securityProbes.largePayload.status ?? "n/a"} / ${report.securityProbes.largePayload.code ?? "n/a"}

## SLO Validation

- Enforced: ${report.slo.enforced}
- Pass: ${report.slo.pass}
- Thresholds: ${JSON.stringify(report.slo.thresholds)}
${report.slo.violations.map((v) => `- ${v}`).join("\n") || "- none"}

## Notes

${report.notes.map((note) => `- ${note}`).join("\n")}
`;
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  await mkdir(config.outDir, { recursive: true });
  await preflight(config);
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    commit: localGitHead(),
    baseUrl: config.baseUrl,
    dryRun: config.dryRun,
    load: [],
    concurrency: [],
    slo: validateSlo([], config.enforceSlo),
    cacheValidation: await validateCache(),
    failureClassification: validateFailureClassification(),
    securityProbes: {
      largePayload: { attempted: false, pass: false, status: null, code: null },
    },
    notes: [],
  };
  if (config.dryRun) {
    report.notes.push("Dry run: skipped external load/concurrency requests.");
  } else {
    for (const requestCount of config.requests) {
      report.load.push(await runScenario(config, `load-${requestCount}`, requestCount, Math.min(config.concurrency[0] ?? 5, requestCount)));
    }
    if (config.concurrencyRequests > 0) {
      for (const concurrency of config.concurrency) {
        report.concurrency.push(await runScenario(config, `concurrency-${concurrency}`, Math.max(concurrency, config.concurrencyRequests), concurrency));
      }
    }
    report.securityProbes = await runSecurityProbes(config);
    report.slo = validateSlo([...report.load, ...report.concurrency], config.enforceSlo);
    if (config.enforceSlo && !report.slo.pass) {
      report.notes.push(`SLO violations: ${report.slo.violations.join("; ")}`);
    }
  }
  await writeFile(path.join(config.outDir, "production-validation-report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(config.outDir, "PRODUCTION_READINESS_REPORT.md"), markdown(report));
  process.stdout.write(`${JSON.stringify({
    outDir: config.outDir,
    dryRun: config.dryRun,
    scenarios: report.load.length + report.concurrency.length,
    cachePass: report.cacheValidation.pass,
    failureClassificationPass: report.failureClassification.pass,
    sloPass: report.slo.pass,
  }, null, 2)}\n`);
  if (config.enforceSlo && !report.slo.pass) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
