/**
 * Worker-thread configuration summary + boot-time logging and memory warnings.
 *
 * V3 candidate parallelism uses per-request worker pools, so the true peak thread
 * count is `V3_PARALLEL_WORKERS × GENERATE_CONCURRENCY_LIMIT` (each concurrent
 * generation spawns its own lanes). This module surfaces that math at startup so a
 * self-hosted operator immediately sees whether the box is oversubscribed.
 */

import os from "node:os";
import { logger } from "./logger";
import {
  configuredWorkerCount,
  configuredTaskTimeoutMs,
  v3ParallelCandidatesEnabled,
  MAX_SAFE_V3_WORKERS,
} from "./v3-worker-pool";
import { getGenerateOverloadState } from "./runtime-overload";

/** Conservative per-worker peak heap during a single V3 invocation. */
const APPROX_WORKER_HEAP_MB = 320;

export interface WorkerConfigSummary {
  parallelEnabled: boolean;
  workers: number;
  maxSafeWorkers: number;
  taskTimeoutMs: number;
  generateConcurrencyLimit: number;
  cpuCores: number;
  totalMemMb: number;
  estimatedPeakWorkerThreads: number;
  estimatedPeakWorkerMemMb: number;
  warnings: string[];
}

export function resolveWorkerConfig(): WorkerConfigSummary {
  const parallelEnabled = v3ParallelCandidatesEnabled();
  const workers = configuredWorkerCount();
  const taskTimeoutMs = configuredTaskTimeoutMs();
  const generateConcurrencyLimit = getGenerateOverloadState().limit;
  const cpuCores = os.cpus()?.length ?? 0;
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));

  const estimatedPeakWorkerThreads = parallelEnabled
    ? workers * generateConcurrencyLimit
    : 0;
  const estimatedPeakWorkerMemMb = estimatedPeakWorkerThreads * APPROX_WORKER_HEAP_MB;

  const warnings: string[] = [];
  if (parallelEnabled) {
    if (cpuCores > 0 && workers > cpuCores) {
      warnings.push(
        `V3_PARALLEL_WORKERS (${workers}) exceeds CPU cores (${cpuCores}); expect scheduling contention.`,
      );
    }
    if (cpuCores > 0 && estimatedPeakWorkerThreads > cpuCores) {
      warnings.push(
        `Peak worker threads (~${estimatedPeakWorkerThreads} = ${workers} workers × ${generateConcurrencyLimit} concurrent generations) exceeds CPU cores (${cpuCores}). ` +
          `Lower GENERATE_CONCURRENCY_LIMIT (2-3) and/or V3_PARALLEL_WORKERS (≤4) for an 8-core beta host.`,
      );
    }
    if (totalMemMb > 0 && estimatedPeakWorkerMemMb > totalMemMb * 0.6) {
      warnings.push(
        `Estimated peak worker memory (~${estimatedPeakWorkerMemMb}MB) exceeds 60% of host RAM (${totalMemMb}MB). ` +
          `Reduce GENERATE_CONCURRENCY_LIMIT / V3_PARALLEL_WORKERS or provision more RAM.`,
      );
    }
  }

  return {
    parallelEnabled,
    workers,
    maxSafeWorkers: MAX_SAFE_V3_WORKERS,
    taskTimeoutMs,
    generateConcurrencyLimit,
    cpuCores,
    totalMemMb,
    estimatedPeakWorkerThreads,
    estimatedPeakWorkerMemMb,
    warnings,
  };
}

export function logWorkerConfigAtBoot(): void {
  const cfg = resolveWorkerConfig();
  const { warnings, ...fields } = cfg;
  logger.info(
    fields,
    cfg.parallelEnabled
      ? "[worker-config] V3 parallel candidates ENABLED"
      : "[worker-config] V3 parallel candidates disabled (sequential execution)",
  );
  for (const warning of warnings) {
    logger.warn({ workerConfig: true }, `[worker-config] ${warning}`);
  }
}
