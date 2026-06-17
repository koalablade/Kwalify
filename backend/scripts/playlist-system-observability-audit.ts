import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Config = {
  baseUrl: string;
  spotifyUserId: string;
  token: string;
  outDir: string;
  timeoutMs: number;
  repeats: number;
  expectedDeploymentVersion: string | null;
  baselinePath: string | null;
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
};

type PromptSpec = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  expectedEnergy?: "low" | "medium" | "high";
};

type RunResult = {
  prompt: string;
  ok: boolean;
  latencyMs: number;
  count: number;
  fallbackUsed: boolean;
  trustScore: number;
  driftViolations: string[];
  candidatePool: number;
  sourceMode: string;
  tracks: AuditTrack[];
  genres: Record<string, number>;
  error: string | null;
};

const CONSISTENCY_PROMPTS: PromptSpec[] = [
  { id: "gym-vague", prompt: "something upbeat for gym", mode: "balanced", length: 25, expectedEnergy: "high" },
  { id: "gym-workout", prompt: "workout music", mode: "balanced", length: 25, expectedEnergy: "high" },
  { id: "gym-noisy-era", prompt: "2000s gym vibes but not too metal maybe?", mode: "balanced", length: 25, expectedEra: { start: 1998, end: 2012 }, expectedEnergy: "high" },
  { id: "edge-blend", prompt: "emo cardio punk focus", mode: "balanced", length: 25, expectedGenres: ["emo", "punk", "rock"], expectedEnergy: "medium" },
];

const FRONTIER_PROMPTS: Array<Omit<PromptSpec, "length">> = [
  { id: "frontier-gym", prompt: "gym 2000s pop punk workout", mode: "balanced", expectedGenres: ["punk", "rock"], expectedEra: { start: 1998, end: 2012 }, expectedEnergy: "high" },
  { id: "frontier-focus", prompt: "deep focus study session no distractions", mode: "balanced", expectedEnergy: "low" },
  { id: "frontier-mixed", prompt: "garage with mates fixing cars", mode: "balanced", expectedEnergy: "medium" },
];

const FRONTIER_LENGTHS = [20, 25, 30];
const LATENCY_BUDGET_MS = 30_000;

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  npm run audit:system-observability -- --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --out DIR                         Output directory (default reports/playlist-system-observability/latest)",
    "  --timeout-ms N                    Per-request timeout (default 30000)",
    "  --repeats N                       Repeated runs per consistency prompt (default 3)",
    "  --baseline FILE                   Optional previous snapshot for drift detection",
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
    outDir: argValue(args, "--out") ?? "reports/playlist-system-observability/latest",
    timeoutMs: Number(argValue(args, "--timeout-ms") ?? LATENCY_BUDGET_MS),
    repeats: Math.max(2, Number(argValue(args, "--repeats") ?? 3)),
    expectedDeploymentVersion: argValue(args, "--expected-deployment-version") ?? process.env["EXPECTED_DEPLOYMENT_VERSION"] ?? null,
    baselinePath: argValue(args, "--baseline"),
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
  if (!versionsMatch(expected, commit)) throw new Error(`Deployment commit mismatch: expected ${expected}, got ${commit}`);
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

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function stdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => Math.pow(value - mean, 2))));
}

function trackKey(track: AuditTrack): string {
  return String(track.id ?? track.trackId ?? `${track.name ?? track.trackName ?? "unknown"}:${track.artist ?? track.artistName ?? "unknown"}`);
}

function genreFamily(track: AuditTrack): string {
  return String(track.genreFamily ?? track.genrePrimary ?? track.genres?.[0] ?? "unknown").toLowerCase();
}

function expectedGenreMatch(track: AuditTrack, expectedGenres: string[] | undefined): boolean {
  if (!expectedGenres || expectedGenres.length === 0) return true;
  const haystack = [genreFamily(track), track.genrePrimary, ...(Array.isArray(track.genres) ? track.genres : [])].filter(Boolean).join(" ").toLowerCase();
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
    if (!expectedGenreMatch(track, spec.expectedGenres)) violations.push(`genre:${genreFamily(track)}`);
    if (!expectedEraMatch(track, spec.expectedEra)) violations.push(`era:${track.releaseYear ?? "unknown"}`);
    if (!expectedEnergyMatch(track, spec.expectedEnergy)) violations.push(`energy:${track.energy ?? "unknown"}`);
  }
  return [...new Set(violations)];
}

function candidateShape(body: Record<string, unknown>): { candidatePool: number; sourceMode: string } {
  const diagnostics = objectFrom(body["generationDiagnostics"]);
  const fastPath = objectFrom(diagnostics?.["performanceFastPath"]);
  const shape = objectFrom(fastPath?.["preScoringCandidateShape"]) ?? {};
  return {
    candidatePool: numberFrom(shape, "outputCount"),
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

function trustScore(spec: PromptSpec, tracks: AuditTrack[], fallback: boolean, latencyMs: number, violations: string[]): number {
  let score = 100;
  if (tracks.length === 0) score -= 100;
  if (fallback) score -= 25;
  if (latencyMs > LATENCY_BUDGET_MS) score -= 30;
  score -= Math.min(70, violations.length * 15);
  if (tracks.length > 0 && tracks.length < Math.min(10, spec.length)) score -= 20;
  return Math.max(0, score);
}

async function postGenerate(config: Config, spec: PromptSpec): Promise<RunResult> {
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
    const genres: Record<string, number> = {};
    for (const track of tracks) increment(genres, genreFamily(track));
    return {
      prompt: spec.prompt,
      ok: response.status < 400 && response.body["success"] === true && tracks.length > 0,
      latencyMs: elapsed,
      count: tracks.length,
      fallbackUsed: fallback,
      trustScore: trustScore(spec, tracks, fallback, elapsed, violations),
      driftViolations: violations,
      candidatePool: shape.candidatePool,
      sourceMode: shape.sourceMode,
      tracks,
      genres,
      error: response.status >= 400 ? String(response.body["error"] ?? response.body["message"] ?? response.status) : null,
    };
  } catch (err) {
    return {
      prompt: spec.prompt,
      ok: false,
      latencyMs: Date.now() - started,
      count: 0,
      fallbackUsed: false,
      trustScore: 0,
      driftViolations: ["request_failed"],
      candidatePool: 0,
      sourceMode: "unknown",
      tracks: [],
      genres: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let overlap = 0;
  for (const key of left) if (right.has(key)) overlap += 1;
  return overlap / union.size;
}

function genreSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const aTotal = Math.max(1, Object.values(a).reduce((sum, value) => sum + value, 0));
  const bTotal = Math.max(1, Object.values(b).reduce((sum, value) => sum + value, 0));
  let distance = 0;
  for (const key of keys) distance += Math.abs((a[key] ?? 0) / aTotal - (b[key] ?? 0) / bTotal);
  return Math.max(0, 1 - distance / 2);
}

function orderingStability(a: AuditTrack[], b: AuditTrack[]): number {
  const bPositions = new Map(b.map((track, index) => [trackKey(track), index]));
  const shared = a.map((track, index) => ({ key: trackKey(track), index })).filter((item) => bPositions.has(item.key));
  if (shared.length === 0) return 0;
  const sameDirection = shared.filter((item, index) => {
    if (index === 0) return true;
    const prev = shared[index - 1];
    if (!prev) return true;
    return (bPositions.get(item.key) ?? 0) >= (bPositions.get(prev.key) ?? 0);
  }).length;
  return sameDirection / shared.length;
}

function consistencyReport(prompt: PromptSpec, runs: RunResult[]) {
  const pairs: Array<{ overlap: number; genre: number; ordering: number }> = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const left = runs[i];
      const right = runs[j];
      if (!left || !right) continue;
      pairs.push({
        overlap: jaccard(left.tracks.map(trackKey), right.tracks.map(trackKey)),
        genre: genreSimilarity(left.genres, right.genres),
        ordering: orderingStability(left.tracks, right.tracks),
      });
    }
  }
  const densityVariance = stdev(runs.map((run) => run.count));
  const avgOverlap = average(pairs.map((pair) => pair.overlap));
  const avgGenreStability = average(pairs.map((pair) => pair.genre));
  const avgOrdering = average(pairs.map((pair) => pair.ordering));
  const flags = [
    avgOverlap < 0.35 ? "low_track_overlap" : null,
    avgGenreStability < 0.8 ? "genre_shift_between_runs" : null,
    densityVariance > 3 ? "density_variance" : null,
    avgOrdering < 0.55 ? "ordering_instability" : null,
    runs.some((run) => run.fallbackUsed) ? "fallback_used" : null,
  ].filter((flag): flag is string => !!flag);
  const score = Math.round((avgOverlap * 35) + (avgGenreStability * 30) + ((1 - Math.min(1, densityVariance / 8)) * 20) + (avgOrdering * 15));
  return {
    prompt: prompt.prompt,
    consistency_score: Math.max(0, Math.min(100, score)),
    variance_flags: flags,
    stability_level: score >= 80 && flags.length === 0 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
    track_overlap_ratio: Math.round(avgOverlap * 1000) / 1000,
    genre_stability: Math.round(avgGenreStability * 1000) / 1000,
    ordering_stability: Math.round(avgOrdering * 1000) / 1000,
    density_variance: Math.round(densityVariance * 1000) / 1000,
  };
}

function classifyWeaknesses(results: RunResult[]) {
  const scores: Record<string, { impact: number; evidence: string[] }> = {
    "retrieval weakness": { impact: 0, evidence: [] },
    "filtering weakness": { impact: 0, evidence: [] },
    "embedding mismatch": { impact: 0, evidence: [] },
    "candidate sparsity": { impact: 0, evidence: [] },
    "scoring bias": { impact: 0, evidence: [] },
    "architecture bottleneck": { impact: 0, evidence: [] },
    "pipeline ordering issue": { impact: 0, evidence: [] },
  };
  for (const result of results) {
    if (result.candidatePool < 90) {
      scores["candidate sparsity"].impact += 3;
      scores["candidate sparsity"].evidence.push(result.prompt);
    }
    if (result.candidatePool >= 240 && result.count < Math.min(10, 0.5 * 25)) {
      scores["filtering weakness"].impact += 3;
      scores["filtering weakness"].evidence.push(result.prompt);
    }
    if (result.driftViolations.some((violation) => violation.startsWith("genre") || violation.startsWith("energy"))) {
      scores["embedding mismatch"].impact += 2;
      scores["embedding mismatch"].evidence.push(result.prompt);
    }
    if (result.candidatePool >= 240 && result.driftViolations.length > 0) {
      scores["scoring bias"].impact += 1;
      scores["scoring bias"].evidence.push(result.prompt);
    }
    if (result.latencyMs > LATENCY_BUDGET_MS) {
      scores["architecture bottleneck"].impact += 4;
      scores["architecture bottleneck"].evidence.push(result.prompt);
    }
    if (result.fallbackUsed) {
      scores["pipeline ordering issue"].impact += 4;
      scores["pipeline ordering issue"].evidence.push(result.prompt);
    }
    if (result.sourceMode === "unfiltered") {
      scores["retrieval weakness"].impact += 1;
      scores["retrieval weakness"].evidence.push(result.prompt);
    }
  }
  return Object.entries(scores)
    .map(([weakness, row]) => ({ weakness, impact: row.impact, evidence: [...new Set(row.evidence)].slice(0, 5) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);
}

function frontierAnalysis(frontierRuns: Array<{ spec: PromptSpec; result: RunResult }>) {
  const rows = frontierRuns.map(({ spec, result }) => ({
    prompt: spec.prompt,
    requested_length: spec.length,
    density: result.count,
    trust: result.trustScore,
    fallback_used: result.fallbackUsed,
    latency_ms: result.latencyMs,
  }));
  const safeRows = rows.filter((row) => row.trust >= 85 && !row.fallback_used && row.latency_ms <= LATENCY_BUDGET_MS);
  const maxSafe = safeRows.sort((a, b) => b.density - a.density)[0] ?? null;
  return {
    max_safe_density_before_trust_drops: maxSafe?.density ?? 0,
    trust_threshold_boundary: 85,
    optimal_operating_zone: maxSafe ? `length<=${maxSafe.requested_length}, density<=${maxSafe.density}` : "no safe frontier point detected",
    observations: rows,
  };
}

function failureClusters(results: RunResult[], consistency: ReturnType<typeof consistencyReport>[]) {
  const clusters = {
    latency_failures: results.filter((result) => result.latencyMs > LATENCY_BUDGET_MS),
    semantic_drift_failures: results.filter((result) => result.driftViolations.length > 0),
    under_density_failures: results.filter((result) => result.count < Math.min(10, 25)),
    fallback_failures: results.filter((result) => result.fallbackUsed),
    retrieval_gaps: results.filter((result) => result.candidatePool < 90),
    consistency_failures: consistency.filter((row) => row.stability_level === "LOW" || row.variance_flags.length > 0),
  };
  return Object.entries(clusters).map(([cluster, rows]) => ({
    cluster,
    frequency: rows.length,
    severity: rows.length === 0 ? "LOW" : cluster.includes("fallback") || cluster.includes("latency") ? "HIGH" : rows.length >= 3 ? "MEDIUM" : "LOW",
    root_shared_causes: rows.length === 0
      ? []
      : cluster === "semantic_drift_failures"
        ? ["intent evidence is present but final track distribution can soften energy or genre constraints"]
        : cluster === "consistency_failures"
          ? ["non-deterministic retrieval/scoring order or broad candidate pool variance"]
          : ["candidate or finalization stage needs deeper inspection"],
  }));
}

function healthScore(results: RunResult[], consistency: ReturnType<typeof consistencyReport>[]) {
  const latencyHealth = Math.round(Math.max(0, 100 - Math.max(0, percentile(results.map((result) => result.latencyMs), 95) - 15_000) / 150));
  const qualityHealth = Math.round(average(results.map((result) => result.trustScore)));
  const stabilityHealth = Math.round(average(consistency.map((row) => row.consistency_score)));
  const fallbackHealth = results.some((result) => result.fallbackUsed) ? 70 : 100;
  const overall = Math.round((latencyHealth * 0.25) + (qualityHealth * 0.35) + (stabilityHealth * 0.25) + (fallbackHealth * 0.15));
  const topRisk = consistency.some((row) => row.stability_level === "LOW")
    ? "output consistency instability"
    : results.some((result) => result.driftViolations.length > 0)
      ? "semantic correctness drift"
      : results.some((result) => result.count < 10)
        ? "density adequacy"
        : "none";
  return {
    overall_health: overall,
    latency_health: latencyHealth,
    quality_health: qualityHealth,
    stability_health: stabilityHealth,
    top_risk: topRisk,
  };
}

function gitChangedFiles(): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD~1..HEAD"], { encoding: "utf8" }).trim();
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function changeImpactAnalyzer(results: RunResult[]) {
  const files = gitChangedFiles();
  const riskyChanges = files.filter((file) => file.includes("generation.controller") || file.includes("playlist") || file.includes("fallback") || file.includes("intent"));
  const hiddenDependencyRisks = riskyChanges.flatMap((file) => [
    `${file}: retrieval system interaction`,
    `${file}: scoring/finalization ordering interaction`,
    `${file}: fallback and latency pipeline interaction`,
  ]);
  const rollback = results.some((result) => result.fallbackUsed || result.latencyMs > LATENCY_BUDGET_MS || result.trustScore < 70);
  return {
    safe_changes: files.filter((file) => !riskyChanges.includes(file)),
    risky_changes: riskyChanges,
    hidden_dependency_risks: hiddenDependencyRisks,
    rollback_recommendation: rollback ? "YES" : "NO",
    reason: rollback ? "Observed production behavior breached safety thresholds." : "No fallback, latency, or severe trust breach observed in this audit.",
  };
}

async function driftMonitor(config: Config, currentHealth: ReturnType<typeof healthScore>) {
  if (!config.baselinePath) {
    return {
      drift_detected: false,
      drift_type: "baseline_unavailable",
      severity: "LOW",
      trend_direction: "STABLE",
    };
  }
  const raw = JSON.parse(await readFile(config.baselinePath, "utf8")) as Record<string, unknown>;
  const baselineHealth = objectFrom(raw["system_health_aggregator"]);
  const baselineOverall = numberFrom(baselineHealth, "overall_health");
  const delta = currentHealth.overall_health - baselineOverall;
  return {
    drift_detected: delta < 0,
    drift_type: delta < 0 ? "overall_health" : "none",
    severity: delta < -10 ? "HIGH" : delta < -3 ? "MEDIUM" : "LOW",
    trend_direction: delta < -3 ? "DEGRADING" : delta > 3 ? "IMPROVING" : "STABLE",
  };
}

function minimalReproducers(results: RunResult[]) {
  return results
    .filter((result) => result.trustScore < 85 || result.fallbackUsed || result.latencyMs > LATENCY_BUDGET_MS || result.count < 10)
    .map((result) => ({
      minimal_reproduction_prompt: result.prompt,
      failure_trigger_condition: result.fallbackUsed
        ? "fallback path was triggered"
        : result.latencyMs > LATENCY_BUDGET_MS
          ? "request exceeded 30s budget"
          : result.driftViolations.length > 0
            ? result.driftViolations[0]
            : "under-density final output",
      system_layer_responsible: result.candidatePool < 90
        ? "retrieval"
        : result.driftViolations.length > 0
          ? "semantic validation"
          : result.count < 10
            ? "finalization"
            : "latency pipeline",
    }));
}

function complexityGuard(systemHealth: ReturnType<typeof healthScore>, changeImpact: ReturnType<typeof changeImpactAnalyzer>) {
  const complexityIncrease = changeImpact.risky_changes.length > 0;
  const measurableGain = systemHealth.overall_health >= 80;
  return {
    complexity_increased: complexityIncrease,
    added_coupling_risks: changeImpact.hidden_dependency_risks,
    measurable_gain_detected: measurableGain,
    pass: !complexityIncrease || measurableGain,
    reason: !complexityIncrease || measurableGain
      ? "Recent changes are justified by current measured health."
      : "Complexity increased without sufficient measured system health.",
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const deployedCommit = await preflight(config);
  const consistencyRuns = new Map<string, RunResult[]>();
  for (const spec of CONSISTENCY_PROMPTS) {
    const runs: RunResult[] = [];
    for (let i = 0; i < config.repeats; i += 1) runs.push(await postGenerate(config, spec));
    consistencyRuns.set(spec.prompt, runs);
  }
  const consistency = CONSISTENCY_PROMPTS.map((spec) => consistencyReport(spec, consistencyRuns.get(spec.prompt) ?? []));
  const frontierRuns: Array<{ spec: PromptSpec; result: RunResult }> = [];
  for (const base of FRONTIER_PROMPTS) {
    for (const length of FRONTIER_LENGTHS) {
      const spec = { ...base, length };
      frontierRuns.push({ spec, result: await postGenerate(config, spec) });
    }
  }
  const allResults = [...consistencyRuns.values()].flatMap((runs) => runs).concat(frontierRuns.map((row) => row.result));
  const systemHealth = healthScore(allResults, consistency);
  const changeImpact = changeImpactAnalyzer(allResults);
  const report = {
    generatedAt: new Date().toISOString(),
    deployedCommit,
    output_consistency_enforcer: consistency,
    system_weakness_classifier: classifyWeaknesses(allResults),
    density_vs_trust_frontier_finder: frontierAnalysis(frontierRuns),
    failure_mode_clustering_engine: failureClusters(allResults, consistency),
    system_health_aggregator: systemHealth,
    change_impact_analyzer: changeImpact,
    system_drift_detector: await driftMonitor(config, systemHealth),
    minimal_regression_reproducer: minimalReproducers(allResults),
    complexity_guard: complexityGuard(systemHealth, changeImpact),
    production_state_snapshot: {
      system_state: systemHealth.overall_health >= 85 ? "HEALTHY" : systemHealth.overall_health >= 70 ? "DEGRADED" : "RISKY",
      latency: { p95_ms: percentile(allResults.map((result) => result.latencyMs), 95), health: systemHealth.latency_health },
      quality: { avg_trust: Math.round(average(allResults.map((result) => result.trustScore))), health: systemHealth.quality_health },
      stability: { avg_consistency: systemHealth.stability_health },
      top_risks: [
        systemHealth.top_risk,
        ...classifyWeaknesses(allResults).map((row) => row.weakness),
      ].filter((risk) => risk !== "none").slice(0, 3),
      recommended_action: systemHealth.overall_health >= 85
        ? "keep current guardrails and promote this snapshot as baseline"
        : "prioritize consistency and semantic drift fixes before further density work",
    },
  };
  await mkdir(config.outDir, { recursive: true });
  await writeFile(path.join(config.outDir, "system-observability-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    deployedCommit,
    health: report.system_health_aggregator,
    consistency: report.output_consistency_enforcer,
    topWeaknesses: report.system_weakness_classifier,
    snapshot: report.production_state_snapshot,
    report: path.join(config.outDir, "system-observability-audit.json"),
  }, null, 2)}\n`);
  if (systemHealth.overall_health < 70 || consistency.some((row) => row.stability_level === "LOW")) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
