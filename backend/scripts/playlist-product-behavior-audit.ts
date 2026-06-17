import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLAYLIST_BENCHMARK_PROMPTS, type PlaylistBenchmarkPrompt } from "../lib/playlist-evaluation/benchmark-prompts";

type Config = {
  baseUrl: string;
  spotifyUserId: string;
  token: string;
  outDir: string;
  timeoutMs: number;
  expectedDeploymentVersion: string | null;
  coverageSample: number;
};

type PromptSpec = {
  id: string;
  category: "vague" | "contradictory" | "underspecified" | "noisy" | "edge_case_blend" | "coverage";
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  expectedActivity?: "gym" | "focus" | "party" | "driving" | "chill" | "work";
  expectedEnergy?: "low" | "medium" | "high";
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  tags: string[];
};

type AuditTrack = {
  id?: string;
  trackId?: string;
  name?: string;
  trackName?: string;
  artist?: string;
  artistName?: string;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
};

type CandidateShape = {
  inputCount: number;
  outputCount: number;
  strictConstrainedCount: number;
  hardConstrainedCount: number;
  explicitGenreEraConstrainedCount: number;
  adjacentGenreEraConstrainedCount: number;
  genericGymFamilySafeCount: number;
  sourceMode: string;
};

type RequestResult = {
  id: string;
  category: PromptSpec["category"];
  prompt: string;
  ok: boolean;
  latencyMs: number;
  trackCount: number;
  requestedLength: number;
  fallbackUsed: boolean;
  trustScore: number;
  intentPreserved: boolean;
  driftViolations: string[];
  failureMode: string;
  sourceMode: string;
  candidateShape: CandidateShape;
  latencyBreakdown: {
    queue: number;
    candidate_fetch: number;
    scoring: number;
    response_build: number;
    total: number;
  };
  tracks: AuditTrack[];
  topGenres: Record<string, number>;
  topEras: Record<string, number>;
  error: string | null;
};

const USER_VARIABILITY_PROMPTS: PromptSpec[] = [
  {
    id: "vague-upbeat-gym",
    category: "vague",
    prompt: "something upbeat for gym",
    mode: "balanced",
    length: 25,
    expectedActivity: "gym",
    expectedEnergy: "high",
    tags: ["vague", "gym", "upbeat"],
  },
  {
    id: "contradictory-chill-heavy-workout",
    category: "contradictory",
    prompt: "chill heavy workout music",
    mode: "balanced",
    length: 25,
    expectedActivity: "gym",
    expectedEnergy: "medium",
    tags: ["contradictory", "gym", "mixed_energy"],
  },
  {
    id: "underspecified-workout",
    category: "underspecified",
    prompt: "workout music",
    mode: "balanced",
    length: 25,
    expectedActivity: "gym",
    expectedEnergy: "high",
    tags: ["underspecified", "gym"],
  },
  {
    id: "noisy-2000s-gym-not-too-metal",
    category: "noisy",
    prompt: "2000s gym vibes but not too metal maybe?",
    mode: "balanced",
    length: 25,
    expectedActivity: "gym",
    expectedEnergy: "high",
    expectedEra: { start: 1998, end: 2012 },
    tags: ["noisy", "gym", "era", "negation"],
  },
  {
    id: "edge-emo-cardio-punk-focus",
    category: "edge_case_blend",
    prompt: "emo cardio punk focus",
    mode: "balanced",
    length: 25,
    expectedActivity: "gym",
    expectedEnergy: "medium",
    expectedGenres: ["emo", "punk", "rock"],
    tags: ["edge_case_blend", "gym", "focus", "genre"],
  },
];

const BUDGETS_MS = {
  queue: 1_000,
  candidate_fetch: 6_000,
  scoring: 14_000,
  response_build: 4_000,
  total: 30_000,
};

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  npm run audit:product-behavior -- --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --out DIR                         Output directory (default reports/playlist-product-behavior/latest)",
    "  --timeout-ms N                    Per-request timeout (default 30000)",
    "  --coverage-sample N               Benchmark prompts to sample for coverage map (default 48)",
    "  --expected-deployment-version SHA Expected deployed commit",
  ].join("\n") + "\n");
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function parseConfig(args: string[]): Config {
  if (args.includes("--help") || args.includes("-h")) usage();
  const baseUrl = argValue(args, "--base-url") ?? process.env["API_BASE_URL"] ?? process.env["PLAYLIST_EVAL_BASE_URL"] ?? process.env["APP_URL"] ?? "";
  const spotifyUserId = argValue(args, "--spotify-user-id") ?? process.env["SPOTIFY_USER_ID"] ?? process.env["PLAYLIST_EVAL_SPOTIFY_USER_ID"] ?? "";
  const token = argValue(args, "--token") ?? process.env["PLAYLIST_EVAL_TOKEN"] ?? "";
  if (!baseUrl) throw new Error("Base URL is required.");
  if (!spotifyUserId) throw new Error("Spotify user id is required.");
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN is required.");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    spotifyUserId,
    token,
    outDir: argValue(args, "--out") ?? "reports/playlist-product-behavior/latest",
    timeoutMs: Number(argValue(args, "--timeout-ms") ?? BUDGETS_MS.total),
    expectedDeploymentVersion: argValue(args, "--expected-deployment-version") ?? process.env["EXPECTED_DEPLOYMENT_VERSION"] ?? null,
    coverageSample: Number(argValue(args, "--coverage-sample") ?? 48),
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

async function preflight(config: Config): Promise<string> {
  const ping = await fetchJson(`${config.baseUrl}/api/eval/ping`, { method: "GET" }, Math.max(30_000, config.timeoutMs));
  const commit = String(ping.body["commit"] ?? "unknown");
  const expected = config.expectedDeploymentVersion ?? localGitHead();
  if (!versionsMatch(expected, commit)) {
    throw new Error(`Deployment commit mismatch: expected ${expected}, got ${commit}`);
  }
  return commit;
}

function objectFrom(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberFrom(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFrom(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function genreFamily(track: AuditTrack): string {
  return String(track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
}

function eraBucket(year: unknown): string {
  if (typeof year !== "number" || !Number.isFinite(year)) return "unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

function timeline(body: Record<string, unknown>, elapsedMs: number): RequestResult["latencyBreakdown"] {
  const diagnostics = objectFrom(body["generationDiagnostics"]);
  const productionTimeline = objectFrom(diagnostics?.["productionTimeline"]);
  const marks = objectFrom(productionTimeline?.["timeline"]) ?? {};
  const scoringEnd = numberFrom(marks, "scoring_end");
  return {
    queue: Math.max(0, numberFrom(marks, "worker_acquired") - numberFrom(marks, "queue_entered")),
    candidate_fetch: Math.max(0, numberFrom(marks, "candidate_fetch_end") - numberFrom(marks, "candidate_fetch_start")),
    scoring: Math.max(0, scoringEnd - numberFrom(marks, "scoring_start")),
    response_build: scoringEnd > 0 ? Math.max(0, elapsedMs - scoringEnd) : 0,
    total: elapsedMs,
  };
}

function candidateShape(body: Record<string, unknown>): CandidateShape {
  const diagnostics = objectFrom(body["generationDiagnostics"]);
  const fastPath = objectFrom(diagnostics?.["performanceFastPath"]);
  const shape = objectFrom(fastPath?.["preScoringCandidateShape"]) ?? {};
  return {
    inputCount: numberFrom(shape, "inputCount"),
    outputCount: numberFrom(shape, "outputCount"),
    strictConstrainedCount: numberFrom(shape, "strictConstrainedCount"),
    hardConstrainedCount: numberFrom(shape, "hardConstrainedCount"),
    explicitGenreEraConstrainedCount: numberFrom(shape, "explicitGenreEraConstrainedCount"),
    adjacentGenreEraConstrainedCount: numberFrom(shape, "adjacentGenreEraConstrainedCount"),
    genericGymFamilySafeCount: numberFrom(shape, "genericGymFamilySafeCount"),
    sourceMode: stringFrom(shape, "sourceMode", "unknown"),
  };
}

function fallbackUsed(body: Record<string, unknown>): boolean {
  const diagnostics = objectFrom(body["generationDiagnostics"]);
  return body["fastFallback"] === true ||
    body["degraded"] === true ||
    diagnostics?.["fallbackTriggered"] === true ||
    (typeof diagnostics?.["fallbackLevel"] === "string" && diagnostics["fallbackLevel"] !== "none");
}

function expectedGenreMatch(track: AuditTrack, expectedGenres: string[] | undefined): boolean {
  if (!expectedGenres || expectedGenres.length === 0) return true;
  const haystack = [
    genreFamily(track),
    track.genrePrimary,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return expectedGenres.some((genre) => haystack.includes(genre.toLowerCase()));
}

function expectedEraMatch(track: AuditTrack, expectedEra: PromptSpec["expectedEra"]): boolean {
  if (!expectedEra) return true;
  if (typeof track.releaseYear !== "number") return false;
  return track.releaseYear >= expectedEra.start && track.releaseYear <= expectedEra.end;
}

function expectedEnergyMatch(track: AuditTrack, expectedEnergy: PromptSpec["expectedEnergy"]): boolean {
  if (!expectedEnergy || typeof track.energy !== "number") return true;
  if (expectedEnergy === "high") return track.energy >= 0.55;
  if (expectedEnergy === "medium") return track.energy >= 0.35 && track.energy <= 0.85;
  return track.energy <= 0.6;
}

function driftViolations(spec: PromptSpec, tracks: AuditTrack[]): string[] {
  const violations: string[] = [];
  for (const track of tracks) {
    const family = genreFamily(track);
    if (spec.expectedActivity === "gym" && ["classical", "christmas", "country"].includes(family)) {
      violations.push(`activity_mismatch:${family}`);
    }
    if (!expectedGenreMatch(track, spec.expectedGenres)) violations.push(`genre_mismatch:${family}`);
    if (!expectedEraMatch(track, spec.expectedEra)) violations.push(`era_mismatch:${eraBucket(track.releaseYear)}`);
    if (!expectedEnergyMatch(track, spec.expectedEnergy)) violations.push(`energy_mismatch:${track.energy ?? "unknown"}`);
  }
  return [...new Set(violations)];
}

function trustScore(spec: PromptSpec, tracks: AuditTrack[], fallback: boolean, latencyMs: number, violations: string[]): number {
  let score = 100;
  if (tracks.length === 0) score -= 100;
  if (tracks.length > 0 && tracks.length < Math.min(10, spec.length)) score -= 20;
  if (fallback) score -= 25;
  if (latencyMs > BUDGETS_MS.total) score -= 30;
  score -= Math.min(60, violations.length * 15);
  return Math.max(0, score);
}

function classifyFailure(result: RequestResult): string {
  if (result.error) return "request_error";
  if (!result.ok || result.trackCount === 0) return "empty_or_failed_response";
  if (result.latencyMs > BUDGETS_MS.total) return "latency_budget_exceeded";
  if (result.fallbackUsed) return "fallback_corruption_risk";
  if (result.driftViolations.length > 0) return "semantic_drift";
  if (result.trackCount < Math.min(10, result.requestedLength)) return "density_underfill";
  if (result.candidateShape.outputCount > 0 && result.candidateShape.outputCount < 90) return "candidate_sparsity";
  return "none";
}

async function postGenerate(config: Config, spec: PromptSpec): Promise<RequestResult> {
  const started = Date.now();
  try {
    const response = await fetchJson(`${config.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": config.token,
      },
      body: JSON.stringify({
        vibe: spec.prompt,
        mode: spec.mode,
        length: spec.length,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: config.spotifyUserId,
      }),
    }, config.timeoutMs);
    const elapsed = Date.now() - started;
    const tracks = Array.isArray(response.body["tracks"]) ? response.body["tracks"] as AuditTrack[] : [];
    const fallback = fallbackUsed(response.body);
    const violations = driftViolations(spec, tracks);
    const shape = candidateShape(response.body);
    const topGenres: Record<string, number> = {};
    const topEras: Record<string, number> = {};
    for (const track of tracks) {
      increment(topGenres, genreFamily(track));
      increment(topEras, eraBucket(track.releaseYear));
    }
    const base: RequestResult = {
      id: spec.id,
      category: spec.category,
      prompt: spec.prompt,
      ok: response.status < 400 && response.body["success"] === true && tracks.length > 0,
      latencyMs: elapsed,
      trackCount: tracks.length,
      requestedLength: spec.length,
      fallbackUsed: fallback,
      trustScore: trustScore(spec, tracks, fallback, elapsed, violations),
      intentPreserved: violations.length === 0,
      driftViolations: violations,
      failureMode: "none",
      sourceMode: shape.sourceMode,
      candidateShape: shape,
      latencyBreakdown: timeline(response.body, elapsed),
      tracks,
      topGenres,
      topEras,
      error: response.status >= 400 ? String(response.body["error"] ?? response.body["message"] ?? response.status) : null,
    };
    return { ...base, failureMode: classifyFailure(base) };
  } catch (err) {
    const elapsed = Date.now() - started;
    const failed: RequestResult = {
      id: spec.id,
      category: spec.category,
      prompt: spec.prompt,
      ok: false,
      latencyMs: elapsed,
      trackCount: 0,
      requestedLength: spec.length,
      fallbackUsed: false,
      trustScore: 0,
      intentPreserved: false,
      driftViolations: ["request_failed"],
      failureMode: "request_error",
      sourceMode: "unknown",
      candidateShape: {
        inputCount: 0,
        outputCount: 0,
        strictConstrainedCount: 0,
        hardConstrainedCount: 0,
        explicitGenreEraConstrainedCount: 0,
        adjacentGenreEraConstrainedCount: 0,
        genericGymFamilySafeCount: 0,
        sourceMode: "unknown",
      },
      latencyBreakdown: { queue: 0, candidate_fetch: 0, scoring: 0, response_build: 0, total: elapsed },
      tracks: [],
      topGenres: {},
      topEras: {},
      error: err instanceof Error ? err.message : String(err),
    };
    return failed;
  }
}

function toCoverageSpec(prompt: PlaylistBenchmarkPrompt): PromptSpec {
  const category = prompt.category === "gym" ||
    prompt.category === "focus" ||
    prompt.category === "party" ||
    prompt.category === "driving" ||
    prompt.category === "chill" ||
    prompt.category === "work"
    ? prompt.category
    : undefined;
  return {
    id: `coverage-${prompt.id}`,
    category: "coverage",
    prompt: prompt.prompt,
    mode: prompt.mode,
    length: Math.min(prompt.length, 25),
    expectedActivity: category,
    expectedEnergy: prompt.expectedEnergy,
    expectedGenres: prompt.expectedGenres,
    expectedEra: prompt.expectedEra,
    tags: [...prompt.tags, prompt.category],
  };
}

function selectCoveragePrompts(limit: number): PromptSpec[] {
  const buckets = new Map<string, PlaylistBenchmarkPrompt[]>();
  for (const prompt of PLAYLIST_BENCHMARK_PROMPTS) {
    const key = prompt.category;
    buckets.set(key, [...(buckets.get(key) ?? []), prompt]);
  }
  const selected: PlaylistBenchmarkPrompt[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const bucket of buckets.values()) {
      const next = bucket.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected.map(toCoverageSpec);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function robustnessSummary(results: RequestResult[]) {
  return Object.values(results.reduce<Record<string, {
    category: string;
    prompt_count: number;
    valid_playlist_rate: number;
    intent_preservation_rate: number;
    fallback_free_rate: number;
    p95_latency_ms: number;
    robustness_score: number;
    failure_modes: Record<string, number>;
  }>>((acc, result) => {
    const row = acc[result.category] ?? {
      category: result.category,
      prompt_count: 0,
      valid_playlist_rate: 0,
      intent_preservation_rate: 0,
      fallback_free_rate: 0,
      p95_latency_ms: 0,
      robustness_score: 0,
      failure_modes: {},
    };
    row.prompt_count += 1;
    row.valid_playlist_rate += result.ok ? 1 : 0;
    row.intent_preservation_rate += result.intentPreserved ? 1 : 0;
    row.fallback_free_rate += result.fallbackUsed ? 0 : 1;
    increment(row.failure_modes, result.failureMode);
    acc[result.category] = row;
    return acc;
  }, {})).map((row) => {
    const categoryResults = results.filter((result) => result.category === row.category);
    const valid = row.valid_playlist_rate / row.prompt_count;
    const intent = row.intent_preservation_rate / row.prompt_count;
    const fallbackFree = row.fallback_free_rate / row.prompt_count;
    const latencyStable = categoryResults.filter((result) => result.latencyMs <= BUDGETS_MS.total).length / row.prompt_count;
    return {
      ...row,
      valid_playlist_rate: Math.round(valid * 1000) / 1000,
      intent_preservation_rate: Math.round(intent * 1000) / 1000,
      fallback_free_rate: Math.round(fallbackFree * 1000) / 1000,
      p95_latency_ms: percentile(categoryResults.map((result) => result.latencyMs), 95),
      robustness_score: Math.round(((valid * 0.35) + (intent * 0.35) + (fallbackFree * 0.15) + (latencyStable * 0.15)) * 100),
    };
  });
}

function coverageMap(results: RequestResult[]) {
  const clusters = new Map<string, {
    cluster: string;
    candidate_count: number;
    embedding_coverage_quality: number;
    retrieval_frequency: number;
    requests: number;
    avg_survival_rate: number;
    failures: number;
  }>();
  const addCluster = (key: string, result: RequestResult) => {
    const shape = result.candidateShape;
    const survival = shape.inputCount > 0 ? shape.outputCount / shape.inputCount : 0;
    const row = clusters.get(key) ?? {
      cluster: key,
      candidate_count: 0,
      embedding_coverage_quality: 0,
      retrieval_frequency: 0,
      requests: 0,
      avg_survival_rate: 0,
      failures: 0,
    };
    row.candidate_count += shape.outputCount;
    row.embedding_coverage_quality += Math.min(1, shape.outputCount / 240);
    row.retrieval_frequency += result.trackCount > 0 ? 1 : 0;
    row.requests += 1;
    row.avg_survival_rate += survival;
    row.failures += result.failureMode === "none" ? 0 : 1;
    clusters.set(key, row);
  };
  for (const result of results) {
    addCluster(`activity:${result.category}`, result);
    for (const tag of result.id.startsWith("coverage-") ? result.id.split("-").slice(1, 2) : []) addCluster(`source:${tag}`, result);
    for (const family of Object.keys(result.topGenres)) addCluster(`genre:${family}`, result);
    for (const era of Object.keys(result.topEras)) addCluster(`era:${era}`, result);
    if (result.sourceMode !== "unknown") addCluster(`source_mode:${result.sourceMode}`, result);
  }
  const rows = [...clusters.values()].map((row) => ({
    ...row,
    candidate_count: Math.round(row.candidate_count / Math.max(1, row.requests)),
    embedding_coverage_quality: Math.round((row.embedding_coverage_quality / Math.max(1, row.requests)) * 1000) / 1000,
    retrieval_frequency: Math.round((row.retrieval_frequency / Math.max(1, row.requests)) * 1000) / 1000,
    avg_survival_rate: Math.round((row.avg_survival_rate / Math.max(1, row.requests)) * 1000) / 1000,
  }));
  return {
    sparse_clusters: rows.filter((row) => row.candidate_count < 90 || row.embedding_coverage_quality < 0.35),
    over_represented_clusters: rows.filter((row) => row.candidate_count > 600 && row.retrieval_frequency > 0.85),
    missing_subgenres: rows.filter((row) => row.cluster.startsWith("genre:") && row.retrieval_frequency === 0),
    weak_embedding_regions: rows.filter((row) => row.avg_survival_rate < 0.02 && row.requests >= 2),
    clusters: rows.sort((a, b) => a.cluster.localeCompare(b.cluster)),
  };
}

function replayFailures(results: RequestResult[]) {
  return results
    .filter((result) => result.failureMode !== "none" || result.trustScore < 80)
    .map((result) => {
      const earliestStage = result.error
        ? "request"
        : result.candidateShape.outputCount < 90
          ? "candidate_filtering"
          : result.driftViolations.length > 0
            ? "semantic_validation"
            : result.latencyMs > BUDGETS_MS.total
              ? "latency_budget"
              : "finalization";
      const correctedPath = earliestStage === "candidate_filtering"
        ? "expand retrieval or loosen filters before scoring"
        : earliestStage === "semantic_validation"
          ? "tighten post-format semantic prune and candidate allowlist"
          : earliestStage === "latency_budget"
            ? "reduce pre-scoring candidate work or enforce stage timeout"
            : "preserve partial valid prefix and avoid fallback fill";
      return {
        prompt: result.prompt,
        root_cause: result.failureMode,
        earliest_failure_stage: earliestStage,
        simulated_corrected_path: correctedPath,
        output_delta: {
          current_tracks: result.trackCount,
          target_tracks: Math.min(result.requestedLength, Math.max(10, result.trackCount)),
          current_trust: result.trustScore,
          target_trust: Math.max(80, result.trustScore),
        },
        fix_opportunity_rank: result.failureMode === "semantic_drift" ? 1 : result.failureMode === "candidate_sparsity" ? 2 : 3,
      };
    })
    .sort((a, b) => a.fix_opportunity_rank - b.fix_opportunity_rank);
}

function latencyBudget(results: RequestResult[]) {
  const violations = results.flatMap((result) => Object.entries(BUDGETS_MS)
    .filter(([stage, budget]) => result.latencyBreakdown[stage as keyof typeof BUDGETS_MS] > budget)
    .map(([stage, budget]) => ({
      prompt: result.prompt,
      stage,
      actual_ms: result.latencyBreakdown[stage as keyof typeof BUDGETS_MS],
      budget_ms: budget,
    })));
  return {
    budgets_ms: BUDGETS_MS,
    budget_violations: violations,
    trend_drift_detection: {
      p50_latency_ms: percentile(results.map((result) => result.latencyMs), 50),
      p95_latency_ms: percentile(results.map((result) => result.latencyMs), 95),
      avg_candidate_fetch_ms: Math.round(average(results.map((result) => result.latencyBreakdown.candidate_fetch))),
      avg_scoring_ms: Math.round(average(results.map((result) => result.latencyBreakdown.scoring))),
    },
    regression_warnings: violations.map((violation) => `${violation.prompt}:${violation.stage}`),
  };
}

function densityOptimizer(results: RequestResult[]) {
  const opportunities = results
    .filter((result) => result.failureMode === "candidate_sparsity" || result.trackCount < result.requestedLength)
    .map((result) => ({
      prompt: result.prompt,
      current_density: result.trackCount,
      candidate_pool: result.candidateShape.outputCount,
      source_mode: result.sourceMode,
      allowed_change: result.sourceMode.includes("strict")
        ? "add subgenre or adjacent-era retrieval before scoring"
        : "calibrate filtering looseness and diversify clustering before scoring",
      scoring_change_allowed: false,
    }));
  return {
    decision: opportunities.some((item) => item.current_density < 10) ? "MODIFY" : "KEEP",
    scoring_logic_unchanged: true,
    opportunities,
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const deployedCommit = await preflight(config);
  const coveragePrompts = selectCoveragePrompts(config.coverageSample);
  const robustnessResults: RequestResult[] = [];
  for (const spec of USER_VARIABILITY_PROMPTS) {
    robustnessResults.push(await postGenerate(config, spec));
  }
  const coverageResults: RequestResult[] = [];
  for (const spec of coveragePrompts) {
    coverageResults.push(await postGenerate(config, spec));
  }
  const allResults = [...robustnessResults, ...coverageResults];
  const report = {
    generatedAt: new Date().toISOString(),
    deployedCommit,
    robustness_simulation: {
      categories: robustnessSummary(robustnessResults),
      prompts: robustnessResults.map(({ tracks, ...result }) => result),
    },
    candidate_coverage_map: coverageMap(allResults),
    failure_replay: {
      root_causes: replayFailures(allResults),
      systemic_patterns: Object.entries(allResults.reduce<Record<string, number>>((acc, result) => {
        increment(acc, result.failureMode);
        return acc;
      }, {})).map(([failure_mode, count]) => ({ failure_mode, count })),
    },
    latency_budget_enforcer: latencyBudget(allResults),
    quality_density_optimizer_without_scoring_change: densityOptimizer(allResults),
  };
  await mkdir(config.outDir, { recursive: true });
  await writeFile(path.join(config.outDir, "product-behavior-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    deployedCommit,
    robustness: report.robustness_simulation.categories,
    budgetViolations: report.latency_budget_enforcer.budget_violations.length,
    failureReplayItems: report.failure_replay.root_causes.length,
    densityOptimizerDecision: report.quality_density_optimizer_without_scoring_change.decision,
    report: path.join(config.outDir, "product-behavior-audit.json"),
  }, null, 2)}\n`);
  const hardFailures = robustnessResults.some((result) => !result.ok || result.fallbackUsed || result.latencyMs > BUDGETS_MS.total);
  if (hardFailures) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
