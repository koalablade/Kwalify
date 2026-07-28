/**
 * Extended ops metrics: cache, Spotify API, generation phase timings, intent survival.
 */

import { getSessionSnapshotCacheStats } from "../core/cache/session-snapshot-cache";
import type { SpotifyApiAuditSnapshot } from "./spotify-api-audit";

export type PhaseTimingSample = {
  phase: string;
  durationMs: number;
  at: string;
};

export type IntentSurvivalAggregate = {
  count: number;
  avgOverall: number;
  avgEmotion: number;
  avgSubgenre: number;
  lastAt: string | null;
};

let spotifyTotals: SpotifyApiAuditSnapshot = {
  totalRequests: 0,
  retries: 0,
  rateLimitResponses: 0,
  failures: 0,
  totalDurationMs: 0,
  byEndpoint: [],
};

const phaseSamples: PhaseTimingSample[] = [];
const MAX_PHASE_SAMPLES = 200;
let intentSurvivalAggregate: IntentSurvivalAggregate = {
  count: 0,
  avgOverall: 0,
  avgEmotion: 0,
  avgSubgenre: 0,
  lastAt: null,
};

let generateSuccessTotal = 0;
let generateFailureTotal = 0;
const generateSuccessBuckets: Array<{ hourKey: string; count: number }> = [];
const generateFailureBuckets: Array<{ hourKey: string; count: number }> = [];
let response5xxTotal = 0;
const response5xxBuckets: Array<{ hourKey: string; count: number }> = [];
const requestMinuteBuckets: Array<{ minuteKey: string; count: number }> = [];
let userFeedbackTotal = 0;
const userFeedbackBuckets: Array<{ hourKey: string; count: number }> = [];

function hourKey(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

function minuteKey(d = new Date()): string {
  return d.toISOString().slice(0, 16);
}

function bumpHourBucket(buckets: Array<{ hourKey: string; count: number }>): number {
  const key = hourKey();
  const existing = buckets.find((b) => b.hourKey === key);
  if (existing) {
    existing.count += 1;
    return existing.count;
  }
  buckets.push({ hourKey: key, count: 1 });
  if (buckets.length > 48) buckets.shift();
  return 1;
}

function lastHourCount(buckets: Array<{ hourKey: string; count: number }>): number {
  const key = hourKey();
  return buckets.filter((b) => b.hourKey === key).reduce((s, b) => s + b.count, 0);
}

function bumpMinuteBucket(): number {
  const key = minuteKey();
  const existing = requestMinuteBuckets.find((b) => b.minuteKey === key);
  if (existing) {
    existing.count += 1;
    return existing.count;
  }
  requestMinuteBuckets.push({ minuteKey: key, count: 1 });
  if (requestMinuteBuckets.length > 120) requestMinuteBuckets.shift();
  return 1;
}

function requestsLastMinute(): number {
  const key = minuteKey();
  return requestMinuteBuckets.filter((b) => b.minuteKey === key).reduce((s, b) => s + b.count, 0);
}

export function recordSpotifyApiMetrics(snapshot: SpotifyApiAuditSnapshot): void {
  spotifyTotals = {
    totalRequests: spotifyTotals.totalRequests + snapshot.totalRequests,
    retries: spotifyTotals.retries + snapshot.retries,
    rateLimitResponses: spotifyTotals.rateLimitResponses + snapshot.rateLimitResponses,
    failures: spotifyTotals.failures + snapshot.failures,
    totalDurationMs: spotifyTotals.totalDurationMs + snapshot.totalDurationMs,
    byEndpoint: snapshot.byEndpoint,
  };
}

export function recordGenerationPhaseDuration(phase: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  phaseSamples.push({ phase, durationMs: Math.round(durationMs), at: new Date().toISOString() });
  if (phaseSamples.length > MAX_PHASE_SAMPLES) phaseSamples.shift();
}

export function recordGenerateOutcome(success: boolean, durationMs: number): void {
  recordGenerationPhaseDuration(success ? "generate.success" : "generate.failure", durationMs);
  if (success) {
    generateSuccessTotal += 1;
    bumpHourBucket(generateSuccessBuckets);
  } else {
    generateFailureTotal += 1;
    bumpHourBucket(generateFailureBuckets);
  }
  recordGenerationPhaseDuration("generate.total", durationMs);
}

export function record5xxResponse(): void {
  response5xxTotal += 1;
  bumpHourBucket(response5xxBuckets);
}

export function recordApiRequest(): void {
  bumpMinuteBucket();
}

export function recordUserFeedbackEvent(): void {
  userFeedbackTotal += 1;
  bumpHourBucket(userFeedbackBuckets);
}

export function recordIntentSurvivalSample(scores: {
  overall?: number;
  emotion?: number;
  subgenre?: number;
}): void {
  const n = intentSurvivalAggregate.count;
  const next = n + 1;
  intentSurvivalAggregate = {
    count: next,
    avgOverall: rollingAvg(intentSurvivalAggregate.avgOverall, n, scores.overall),
    avgEmotion: rollingAvg(intentSurvivalAggregate.avgEmotion, n, scores.emotion),
    avgSubgenre: rollingAvg(intentSurvivalAggregate.avgSubgenre, n, scores.subgenre),
    lastAt: new Date().toISOString(),
  };
}

function rollingAvg(prev: number, count: number, value?: number): number {
  if (value == null || !Number.isFinite(value)) return prev;
  return Math.round(((prev * count + value) / (count + 1)) * 10) / 10;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function phasePercentiles(phase: string): { sampleCount: number; p50Ms: number | null; p95Ms: number | null } {
  const durations = phaseSamples.filter((s) => s.phase === phase).map((s) => s.durationMs);
  return {
    sampleCount: durations.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
  };
}

export function getExtendedOpsMetrics(): {
  sessionSnapshotCache: ReturnType<typeof getSessionSnapshotCacheStats>;
  spotifyApi: SpotifyApiAuditSnapshot;
  generationPhases: {
    sampleCount: number;
    p50Ms: number | null;
    p95Ms: number | null;
    recent: PhaseTimingSample[];
    byPhase: Record<string, { sampleCount: number; p50Ms: number | null; p95Ms: number | null }>;
  };
  generateOutcomes: {
    successTotal: number;
    failureTotal: number;
    successLastHour: number;
    failureLastHour: number;
  };
  response5xx: {
    total: number;
    lastHour: number;
  };
  requestsPerMinute: number;
  userFeedback: {
    total: number;
    lastHour: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  intentSurvival: IntentSurvivalAggregate;
} {
  const durations = phaseSamples.map((s) => s.durationMs);
  const phaseNames = [...new Set(phaseSamples.map((s) => s.phase))];
  const byPhase: Record<string, { sampleCount: number; p50Ms: number | null; p95Ms: number | null }> = {};
  for (const phase of phaseNames) {
    byPhase[phase] = phasePercentiles(phase);
  }
  const mem = process.memoryUsage();
  return {
    sessionSnapshotCache: getSessionSnapshotCacheStats(),
    spotifyApi: spotifyTotals,
    generationPhases: {
      sampleCount: phaseSamples.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      recent: phaseSamples.slice(-15),
      byPhase,
    },
    generateOutcomes: {
      successTotal: generateSuccessTotal,
      failureTotal: generateFailureTotal,
      successLastHour: lastHourCount(generateSuccessBuckets),
      failureLastHour: lastHourCount(generateFailureBuckets),
    },
    response5xx: {
      total: response5xxTotal,
      lastHour: lastHourCount(response5xxBuckets),
    },
    requestsPerMinute: requestsLastMinute(),
    userFeedback: {
      total: userFeedbackTotal,
      lastHour: lastHourCount(userFeedbackBuckets),
    },
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
    },
    intentSurvival: intentSurvivalAggregate,
  };
}
