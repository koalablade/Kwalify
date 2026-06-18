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
  phaseSamples.push({ phase, durationMs, at: new Date().toISOString() });
  if (phaseSamples.length > MAX_PHASE_SAMPLES) phaseSamples.shift();
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

export function getExtendedOpsMetrics(): {
  sessionSnapshotCache: ReturnType<typeof getSessionSnapshotCacheStats>;
  spotifyApi: SpotifyApiAuditSnapshot;
  generationPhases: {
    sampleCount: number;
    p50Ms: number | null;
    p95Ms: number | null;
    recent: PhaseTimingSample[];
  };
  intentSurvival: IntentSurvivalAggregate;
} {
  const durations = phaseSamples.map((s) => s.durationMs);
  return {
    sessionSnapshotCache: getSessionSnapshotCacheStats(),
    spotifyApi: spotifyTotals,
    generationPhases: {
      sampleCount: phaseSamples.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      recent: phaseSamples.slice(-15),
    },
    intentSurvival: intentSurvivalAggregate,
  };
}
