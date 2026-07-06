/**
 * Live API soak benchmark — real /api/generate, noise injection, behavioural proxies.
 *
 * Measurement only. Does NOT modify production logic.
 *
 * Usage:
 *   SOAK_SESSION_COOKIE='connect.sid=...' SOAK_BASE_URL=http://localhost:3000 \
 *     npm run test:benchmark-live-soak
 *
 * Options (env):
 *   SOAK_DURATION_MS=900000          (default 15 min)
 *   SOAK_JITTER_MS_MIN=2000
 *   SOAK_JITTER_MS_MAX=8000
 *   SOAK_GENERATE_TIMEOUT_MS=180000
 *   SOAK_ROUND_ROBIN=true              cycle all 12 prompts until duration elapses
 *
 * Offline narrative-only (no API):
 *   npm run test:benchmark-live-soak -- --simulate
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { performance } from "perf_hooks";
import {
  BENCHMARK_PROMPTS,
  collectCurrentOutput,
} from "./benchmark-human-retention";
import { buildPerceptionSnapshot } from "../lib/perception-fixture";
import {
  createSoakClient,
  loadSoakClientConfig,
  randomJitter,
  requireSessionCookie,
  sleep,
  waitForGenerateSlot,
  waitForIdleGenerate,
} from "./benchmark-live-soak-client";
import {
  computeBehaviouralProxies,
  computeDivergence,
  extractSoakRecord,
  loadBaselineForPrompt,
  listBenchmarkPrompts,
  scoreExtractedRecord,
  type DivergenceMetrics,
  type ExtractedSoakRecord,
  type LiveGenerateResponse,
  type SoakScenarioKind,
} from "./benchmark-live-soak-metrics";

const RESULTS_DIR = join(__dirname, "results");

export interface SoakEvent {
  at: string;
  prompt: string;
  scenario: SoakScenarioKind;
  simulate: boolean;
  ok: boolean;
  status: number;
  latencyMs: number;
  cached: boolean;
  errorCode: string | null;
  extracted: ExtractedSoakRecord;
  scores: ReturnType<typeof scoreExtractedRecord>;
  baselineHrps: number | null;
  hrpsVsBaseline: number | null;
}

export interface LiveSoakReport {
  mode: "live" | "simulate";
  durationMs: number;
  userId: string | null;
  totalEvents: number;
  successCount: number;
  errorCount: number;
  cacheHitCount: number;
  partialResponseCount: number;
  latency: { p50: number; p95: number; max: number };
  hrps: { mean: number; min: number; max: number; stddev: number };
  behavioural: ReturnType<typeof computeBehaviouralProxies>;
  divergence: {
    pairs: number;
    momentLabelClassStableRate: number;
    arcStableRate: number;
    avgTrackJaccard: number;
    avgHrpsDeltaOnRegen: number;
  };
  errorsByCode: Record<string, number>;
  events: SoakEvent[];
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

async function executeSimulated(
  prompt: string,
  scenario: SoakScenarioKind
): Promise<{ response: LiveGenerateResponse; extracted: ExtractedSoakRecord }> {
  const start = performance.now();
  await sleep(randomJitter(10, 50));
  const current = await collectCurrentOutput(prompt);
  const snapshot = buildPerceptionSnapshot(prompt);
  const latencyMs = performance.now() - start;

  const body: Record<string, unknown> = {
    success: true,
    cached: scenario === "cache_hit",
    vibe: prompt,
    count: current.trackCount,
    totalTracks: current.trackCount,
    generationMs: Math.round(latencyMs),
    uxSignals: {
      primaryNarrative: current.primaryNarrative,
      emotionalConsistencyScore: current.emotionalConsistencyScore,
      emotionalClarityScore: snapshot.emotionalClarityScore,
    },
    debugSignals: { identitySignature: current.momentSignature },
    tracks: [],
  };

  const response: LiveGenerateResponse = {
    ok: true,
    status: 200,
    latencyMs,
    cached: scenario === "cache_hit",
    body,
  };

  const extracted = extractSoakRecord(prompt, scenario, response);
  return { response, extracted };
}

async function executeLive(
  client: ReturnType<typeof createSoakClient>,
  prompt: string,
  scenario: SoakScenarioKind
): Promise<{ response: LiveGenerateResponse; extracted: ExtractedSoakRecord }> {
  const isRegen = scenario === "regenerate" || scenario === "regenerate_followup";
  const response = await waitForGenerateSlot(
    client,
    prompt,
    envMs("SOAK_GENERATE_TIMEOUT_MS", 180_000),
    { regenerate: isRegen }
  );
  const extracted = extractSoakRecord(prompt, scenario, response);
  return { response, extracted };
}

async function runScenario(
  simulate: boolean,
  client: ReturnType<typeof createSoakClient> | null,
  prompt: string,
  scenario: SoakScenarioKind
): Promise<SoakEvent> {
  const { response, extracted } = simulate
    ? await executeSimulated(prompt, scenario)
    : await executeLive(client!, prompt, scenario);

  const scores = scoreExtractedRecord(extracted);
  const baseline = loadBaselineForPrompt(prompt);
  const baselineHrps = baseline
    ? scoreExtractedRecord(extractSoakRecord(prompt, "generate", {
        ok: true,
        status: 200,
        latencyMs: 0,
        body: {
          uxSignals: { primaryNarrative: baseline.primaryNarrative },
          emotionalConsistencyScore: baseline.emotionalConsistencyScore,
          count: baseline.trackCount,
          debugSignals: { identitySignature: baseline.momentSignature },
        },
      }))
    : null;

  return {
    at: new Date().toISOString(),
    prompt,
    scenario,
    simulate,
    ok: response.ok,
    status: response.status,
    latencyMs: response.latencyMs,
    cached: !!response.cached || extracted.cached,
    errorCode: response.errorCode ?? null,
    extracted,
    scores,
    baselineHrps: baselineHrps?.hrps ?? null,
    hrpsVsBaseline: baselineHrps ? scores.hrps - baselineHrps.hrps : null,
  };
}

const SCENARIOS: SoakScenarioKind[] = [
  "generate",
  "cache_hit",
  "regenerate",
  "regenerate_followup",
];

export async function runLiveSoakBenchmark(opts: {
  simulate: boolean;
  durationMs?: number;
}): Promise<LiveSoakReport> {
  const durationMs = opts.durationMs ?? envMs("SOAK_DURATION_MS", 15 * 60 * 1000);
  const jitterMin = envMs("SOAK_JITTER_MS_MIN", 2_000);
  const jitterMax = envMs("SOAK_JITTER_MS_MAX", 8_000);
  const prompts = listBenchmarkPrompts();
  const deadline = performance.now() + durationMs;
  const events: SoakEvent[] = [];
  let userId: string | null = null;

  console.log(
    `[live-soak] starting ${opts.simulate ? "SIMULATE" : "LIVE"} soak for ${(durationMs / 60000).toFixed(1)} min`
  );

  let client: ReturnType<typeof createSoakClient> | null = null;

  if (!opts.simulate) {
    requireSessionCookie();
    const config = loadSoakClientConfig();
    client = createSoakClient(config);

    const health = await client.healthCheck();
    console.log(`[live-soak] healthz: ${health.status} (${health.latencyMs}ms)`);
    if (!health.ok) throw new Error(`Health check failed: HTTP ${health.status}`);

    const me = await client.getMe();
    userId = me.userId;
    console.log(`[live-soak] auth/me: ${me.ok ? me.userId : "unauthorized"} (${me.latencyMs}ms)`);
    if (!me.ok) {
      throw new Error(
        "Session invalid — refresh SOAK_SESSION_COOKIE from a logged-in browser session"
      );
    }

    const sync = await client.getSyncStatus();
    console.log(
      `[live-soak] library: synced=${sync.synced} tracks=${sync.totalTracks} syncing=${sync.isSyncing}`
    );
    if (!sync.synced || sync.totalTracks < 15) {
      console.warn(
        "[live-soak] WARNING: library may be unsynced or small — expect LIBRARY_EMPTY / INSUFFICIENT_MATCHES"
      );
    }

    console.log("[live-soak] waiting for idle generate slot (close kwalify.net tabs)...");
    await waitForIdleGenerate(client, 120_000);
    const slotStatus = await client.getGenerateStatus();
    console.log(
      `[live-soak] generate slot: active=${slotStatus.active} phase=${slotStatus.phase}`
    );
    if (slotStatus.active) {
      throw new Error(
        "Generate slot still active after cancel — close kwalify.net tabs and retry soak"
      );
    }
  }

  let round = 0;
  while (performance.now() < deadline) {
    round += 1;
    console.log(`[live-soak] round ${round} starting (${prompts.length} prompts × ${SCENARIOS.length} scenarios)`);

    for (const prompt of prompts) {
      if (performance.now() >= deadline) break;

      for (const scenario of SCENARIOS) {
        if (performance.now() >= deadline) break;

        console.log(`[live-soak] → ${scenario} "${prompt}"`);
        try {
          const event = await runScenario(opts.simulate, client, prompt, scenario);
          events.push(event);
          console.log(
            `[live-soak] ✓ ${scenario} "${prompt}" — ` +
              `${event.ok ? "ok" : "fail"} ${event.latencyMs}ms ` +
              `HRPS=${event.scores.hrps.toFixed(1)} ` +
              `${event.cached ? "(cached)" : ""} ` +
              `${event.errorCode ?? ""}`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[live-soak] ✗ ${scenario} "${prompt}" — ${message}`);
          events.push({
            at: new Date().toISOString(),
            prompt,
            scenario,
            simulate: opts.simulate,
            ok: false,
            status: 0,
            latencyMs: 0,
            cached: false,
            errorCode: "HARNESS_ERROR",
            extracted: extractSoakRecord(prompt, scenario, {
              ok: false,
              status: 0,
              latencyMs: 0,
              body: {},
            }),
            scores: { clarity: 0, coherence: 0, specificity: 0, stability: 0, hrps: 0 },
            baselineHrps: null,
            hrpsVsBaseline: null,
          });
        }

        const jitter = randomJitter(jitterMin, jitterMax);
        await sleep(jitter);
      }
    }
  }

  const latencies = events.map((e) => e.latencyMs).filter((n) => n > 0);
  const hrpsValues = events.filter((e) => e.ok).map((e) => e.scores.hrps);
  const errorsByCode: Record<string, number> = {};
  for (const e of events) {
    if (!e.ok && e.errorCode) {
      errorsByCode[e.errorCode] = (errorsByCode[e.errorCode] ?? 0) + 1;
    }
  }

  const divergencePairs: DivergenceMetrics[] = [];
  for (const prompt of prompts) {
    const gen = events.find((e) => e.prompt === prompt && e.scenario === "generate" && e.ok);
    const regen = events.find(
      (e) => e.prompt === prompt && e.scenario === "regenerate_followup" && e.ok
    );
    if (gen && regen) {
      divergencePairs.push(computeDivergence(gen.extracted, regen.extracted));
    }
  }

  const behavioural = computeBehaviouralProxies(
    events.map((e) => e.extracted),
    events.filter((e) => e.ok).length
  );

  const report: LiveSoakReport = {
    mode: opts.simulate ? "simulate" : "live",
    durationMs: performance.now() - (deadline - durationMs),
    userId,
    totalEvents: events.length,
    successCount: events.filter((e) => e.ok).length,
    errorCount: events.filter((e) => !e.ok).length,
    cacheHitCount: events.filter((e) => e.cached).length,
    partialResponseCount: events.filter((e) => e.extracted.partial).length,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    hrps: {
      mean: hrpsValues.length ? hrpsValues.reduce((a, b) => a + b, 0) / hrpsValues.length : 0,
      min: hrpsValues.length ? Math.min(...hrpsValues) : 0,
      max: hrpsValues.length ? Math.max(...hrpsValues) : 0,
      stddev: stddev(hrpsValues),
    },
    behavioural,
    divergence: {
      pairs: divergencePairs.length,
      momentLabelClassStableRate:
        divergencePairs.length > 0
          ? divergencePairs.filter((d) => d.momentLabelClassStable).length / divergencePairs.length
          : 0,
      arcStableRate:
        divergencePairs.length > 0
          ? divergencePairs.filter((d) => d.arcDirectionStable).length / divergencePairs.length
          : 0,
      avgTrackJaccard:
        divergencePairs.length > 0
          ? divergencePairs.reduce((s, d) => s + d.trackJaccard, 0) / divergencePairs.length
          : 0,
      avgHrpsDeltaOnRegen:
        divergencePairs.length > 0
          ? divergencePairs.reduce((s, d) => s + d.hrpsDelta, 0) / divergencePairs.length
          : 0,
    },
    errorsByCode,
    events,
  };

  return report;
}

export function printLiveSoakReport(report: LiveSoakReport): void {
  console.log("\n========== LIVE SOAK BENCHMARK REPORT ==========\n");
  console.log(`Mode:                 ${report.mode.toUpperCase()}`);
  console.log(`Duration:             ${(report.durationMs / 60000).toFixed(2)} min`);
  console.log(`User:                 ${report.userId ?? "n/a"}`);
  console.log(`Total events:         ${report.totalEvents}`);
  console.log(`Success / error:      ${report.successCount} / ${report.errorCount}`);
  console.log(`Cache hits:           ${report.cacheHitCount}`);
  console.log(`Partial responses:    ${report.partialResponseCount}`);
  console.log(`Latency p50/p95/max:  ${report.latency.p50}ms / ${report.latency.p95}ms / ${report.latency.max}ms`);
  console.log(`HRPS mean/min/max/σ:  ${report.hrps.mean.toFixed(2)} / ${report.hrps.min.toFixed(2)} / ${report.hrps.max.toFixed(2)} / ${report.hrps.stddev.toFixed(2)}`);
  console.log("\n--- Behavioural proxies ---");
  console.log(`Regenerate rate:      ${(report.behavioural.regenerateRate * 100).toFixed(1)}%`);
  console.log(`Save proxy rate:      ${(report.behavioural.saveProxyRate * 100).toFixed(1)}%`);
  console.log(`Continuation proxy:   ${(report.behavioural.continuationProxyRate * 100).toFixed(1)}%`);
  console.log(`Skip proxy (bottom Q): ${report.behavioural.skipProxyMean.toFixed(3)}`);
  console.log("\n--- Divergence (first gen vs regen followup) ---");
  console.log(`Pairs analysed:       ${report.divergence.pairs}`);
  console.log(`Moment class stable:  ${(report.divergence.momentLabelClassStableRate * 100).toFixed(1)}%`);
  console.log(`Arc direction stable: ${(report.divergence.arcStableRate * 100).toFixed(1)}%`);
  console.log(`Avg track Jaccard:    ${report.divergence.avgTrackJaccard.toFixed(3)}`);
  console.log(`Avg HRPS Δ on regen:  ${report.divergence.avgHrpsDeltaOnRegen.toFixed(3)}`);
  if (Object.keys(report.errorsByCode).length) {
    console.log("\n--- Errors by code ---");
    for (const [code, count] of Object.entries(report.errorsByCode)) {
      console.log(`  ${code}: ${count}`);
    }
  }
  console.log("\n================================================\n");
}

export function saveLiveSoakReport(report: LiveSoakReport): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RESULTS_DIR, `live-soak-${report.mode}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}

async function main(): Promise<void> {
  const simulate = process.argv.includes("--simulate");
  const durationMs = envMs("SOAK_DURATION_MS", 15 * 60 * 1000);

  const report = await runLiveSoakBenchmark({ simulate, durationMs });
  printLiveSoakReport(report);
  const saved = saveLiveSoakReport(report);
  console.log(`[live-soak] report saved: ${saved}`);

  if (report.errorCount > report.successCount && report.mode === "live") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[live-soak] fatal:", err);
    process.exit(1);
  });
}
