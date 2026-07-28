/**
 * Lightweight durable totals for ops counters (survives API restart).
 * Hourly buckets remain in-memory only.
 */

import fs from "node:fs";
import path from "node:path";
import { moduleLogger } from "./logger";

const log = moduleLogger("ops-metrics-persistence");

export type PersistedOpsTotals = {
  version: 1;
  savedAt: string;
  generateSuccessTotal: number;
  generateFailureTotal: number;
  response5xxTotal: number;
  userFeedbackTotal: number;
  spotifyTotals: {
    totalRequests: number;
    retries: number;
    rateLimitResponses: number;
    failures: number;
    totalDurationMs: number;
  };
};

const PERSIST_PATH = path.join(process.cwd(), "reports", "ops-metrics-totals.json");

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function ensureReportsDir(): void {
  const dir = path.dirname(PERSIST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadPersistedOpsTotals(): Partial<PersistedOpsTotals> | null {
  if (loaded) return null;
  loaded = true;
  try {
    if (!fs.existsSync(PERSIST_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(PERSIST_PATH, "utf8")) as PersistedOpsTotals;
    if (raw?.version !== 1) return null;
    log.info({ savedAt: raw.savedAt }, "ops_metrics_totals_loaded");
    return raw;
  } catch (err) {
    log.warn({ err }, "ops_metrics_totals_load_failed");
    return null;
  }
}

export function schedulePersistOpsTotals(snapshot: PersistedOpsTotals): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureReportsDir();
      fs.writeFileSync(PERSIST_PATH, JSON.stringify(snapshot, null, 0), "utf8");
    } catch (err) {
      log.warn({ err }, "ops_metrics_totals_save_failed");
    }
  }, 2000);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}
