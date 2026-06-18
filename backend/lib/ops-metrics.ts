/**
 * In-process ops counters for SERVER_BUSY, sync failures, and queue pressure.
 * Logs structured alert events for external monitoring (Sentry/Datadog/uptime hooks).
 */

import { moduleLogger } from "./logger";
import { getExtendedOpsMetrics } from "./ops-metrics-extended";

export { recordSpotifyApiMetrics, recordGenerationPhaseDuration, recordIntentSurvivalSample } from "./ops-metrics-extended";

const log = moduleLogger("ops-metrics");

type HourBucket = { hourKey: string; count: number };

export type OpsMetricsSnapshot = {
  generatedAt: string;
  serverBusy: {
    total: number;
    lastHour: number;
    lastEventAt: string | null;
  };
  syncFailures: {
    total: number;
    lastHour: number;
    lastEventAt: string | null;
  };
  generateQueue: {
    active: number;
    queued: number;
    limit: number;
    queueLimit: number;
    averageLatencyMs: number;
  } | null;
  extended: ReturnType<typeof getExtendedOpsMetrics>;
  alerts: Array<{ type: string; at: string; detail: Record<string, unknown> }>;
};

let serverBusyTotal = 0;
let syncFailureTotal = 0;
let serverBusyLastAt: string | null = null;
let syncFailureLastAt: string | null = null;
const serverBusyBuckets: HourBucket[] = [];
const syncFailureBuckets: HourBucket[] = [];
const recentAlerts: OpsMetricsSnapshot["alerts"] = [];
const MAX_ALERTS = 50;

function hourKey(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

function bumpBucket(buckets: HourBucket[]): number {
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

function lastHourCount(buckets: HourBucket[]): number {
  const key = hourKey();
  return buckets.filter((b) => b.hourKey === key).reduce((s, b) => s + b.count, 0);
}

function pushAlert(type: string, detail: Record<string, unknown>): void {
  const at = new Date().toISOString();
  recentAlerts.unshift({ type, at, detail });
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.pop();
  log.warn({ alert: true, alertType: type, ...detail }, `[ops-alert] ${type}`);
}

export function recordServerBusy(detail: {
  active: number;
  queued: number;
  limit: number;
  queueLimit: number;
  requestId?: string;
}): void {
  serverBusyTotal += 1;
  serverBusyLastAt = new Date().toISOString();
  bumpBucket(serverBusyBuckets);
  pushAlert("SERVER_BUSY", detail);
}

export function recordSyncFailure(detail: {
  userId?: string;
  phase?: string;
  message?: string;
}): void {
  syncFailureTotal += 1;
  syncFailureLastAt = new Date().toISOString();
  bumpBucket(syncFailureBuckets);
  pushAlert("SYNC_FAILURE", detail);
}

export function attachGenerateQueueState(state: OpsMetricsSnapshot["generateQueue"]): OpsMetricsSnapshot {
  return getOpsMetrics(state);
}

export function getOpsMetrics(generateQueue: OpsMetricsSnapshot["generateQueue"] = null): OpsMetricsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    serverBusy: {
      total: serverBusyTotal,
      lastHour: lastHourCount(serverBusyBuckets),
      lastEventAt: serverBusyLastAt,
    },
    syncFailures: {
      total: syncFailureTotal,
      lastHour: lastHourCount(syncFailureBuckets),
      lastEventAt: syncFailureLastAt,
    },
    generateQueue,
    extended: getExtendedOpsMetrics(),
    alerts: [...recentAlerts],
  };
}

export function shouldWarnHighServerBusyRate(): boolean {
  return lastHourCount(serverBusyBuckets) >= Number.parseInt(process.env["OPS_SERVER_BUSY_WARN_PER_HOUR"] ?? "12", 10);
}

export function shouldWarnHighSyncFailureRate(): boolean {
  return lastHourCount(syncFailureBuckets) >= Number.parseInt(process.env["OPS_SYNC_FAILURE_WARN_PER_HOUR"] ?? "5", 10);
}

let monitorTimer: ReturnType<typeof setInterval> | null = null;

export function startOpsMetricsMonitor(): void {
  if (monitorTimer) return;
  const intervalMs = Number.parseInt(process.env["OPS_METRICS_LOG_INTERVAL_MS"] ?? String(5 * 60 * 1000), 10);
  monitorTimer = setInterval(() => {
    if (shouldWarnHighServerBusyRate()) {
      log.warn(
        { alert: true, alertType: "SERVER_BUSY_RATE", lastHour: lastHourCount(serverBusyBuckets) },
        "[ops-alert] SERVER_BUSY rate elevated",
      );
    }
    if (shouldWarnHighSyncFailureRate()) {
      log.warn(
        { alert: true, alertType: "SYNC_FAILURE_RATE", lastHour: lastHourCount(syncFailureBuckets) },
        "[ops-alert] Sync failure rate elevated",
      );
    }
  }, intervalMs);
  monitorTimer.unref?.();
}
