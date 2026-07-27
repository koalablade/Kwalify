/**
 * Worker-thread pool for parallelising the V3 multi-candidate loop.
 *
 * The 15 candidate invocations are independent and deterministic (candidate-specific
 * seed + interpretation; shared inputs are read-only during a run), so running them on
 * separate threads produces identical playlists while overlapping the CPU-bound work.
 *
 * Safety: this module is only engaged when V3_PARALLEL_CANDIDATES is enabled. Callers
 * MUST provide a sequential fallback — any worker error rejects the task so the caller
 * can recompute it on the main thread, guaranteeing no quality regression.
 */
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

export type V3WorkerInitContext = Record<string, unknown>;
export type V3WorkerTaskPayload = Record<string, unknown>;
export type V3WorkerResult = {
  ok: boolean;
  finalTracks?: unknown[];
  sceneWorldContext?: unknown;
  timingMs?: Record<string, number>;
  error?: string;
};

const WORKER_ENTRY = path.join(__dirname, "..", "core", "v3", "v3-candidate-worker.js");

/** Absolute ceiling on worker lanes, independent of config, to prevent CPU oversubscription. */
export const MAX_SAFE_V3_WORKERS = 8;

export function configuredWorkerCount(): number {
  const envValue = Number.parseInt(process.env["V3_PARALLEL_WORKERS"] ?? "", 10);
  if (Number.isFinite(envValue) && envValue > 0) {
    // Clamp explicit config to a safe ceiling — a mis-set value (e.g. 64) would
    // oversubscribe the box and make latency worse, not better.
    return Math.min(envValue, MAX_SAFE_V3_WORKERS);
  }
  const cores = os.cpus()?.length ?? 4;
  const computed = Math.max(2, Math.min(MAX_SAFE_V3_WORKERS, cores - 1));
  // Self-host serves a handful of friends on one machine — cap parallel lanes by default.
  if (process.env["KWALIFY_HOST_MODE"] === "selfhost") {
    return Math.min(4, computed);
  }
  return computed;
}

/**
 * Hard ceiling on a single worker task. A worker that neither resolves nor emits `error`
 * (e.g. wedged on an inherited open handle) must never stall the whole generation — the
 * task rejects on timeout and the caller recomputes it on the main thread. Generous by
 * default because a single V3 invocation can legitimately take several seconds.
 */
export function configuredTaskTimeoutMs(): number {
  const envValue = Number.parseInt(process.env["V3_PARALLEL_TASK_TIMEOUT_MS"] ?? "", 10);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return 45_000;
}

export function v3ParallelCandidatesEnabled(): boolean {
  return process.env["V3_PARALLEL_CANDIDATES"] === "1"
    || process.env["V3_PARALLEL_CANDIDATES"] === "true";
}

type PooledWorker = {
  worker: Worker;
  busy: boolean;
  initialized: boolean;
  contextToken: number;
  dead: boolean;
};

/**
 * A short-lived pool sized to the candidate batch. Workers are initialised once with the
 * loop-invariant context, then each runs one candidate task. Terminated after the batch
 * to avoid holding threads/memory between requests (generation is not high-QPS here).
 */
export type V3ParallelStats = {
  workerLanes: number;
  workersSpawned: number;
  tasksDispatched: number;
  workerSucceeded: number;
  workerFailed: number;
  workerTimedOut: number;
  // Startup-cost instrumentation (to compare per-request vs persistent pool).
  firstTaskCount: number;
  firstTaskTotalMs: number;
  warmTaskCount: number;
  warmTaskTotalMs: number;
  maxFirstTaskMs: number;
};

export class V3CandidatePool {
  private readonly workers: PooledWorker[] = [];
  private readonly size: number;
  // Observability only — never influences control flow or playlist output.
  private readonly stats: V3ParallelStats = {
    workerLanes: 0,
    workersSpawned: 0,
    tasksDispatched: 0,
    workerSucceeded: 0,
    workerFailed: 0,
    workerTimedOut: 0,
    firstTaskCount: 0,
    firstTaskTotalMs: 0,
    warmTaskCount: 0,
    warmTaskTotalMs: 0,
    maxFirstTaskMs: 0,
  };

  constructor(batchSize: number) {
    this.size = Math.max(1, Math.min(configuredWorkerCount(), batchSize));
  }

  getStats(): V3ParallelStats {
    return { ...this.stats };
  }

  private spawn(): PooledWorker {
    const worker = new Worker(WORKER_ENTRY);
    const pooled: PooledWorker = { worker, busy: false, initialized: false, contextToken: -1, dead: false };
    this.workers.push(pooled);
    this.stats.workersSpawned += 1;
    return pooled;
  }

  /**
   * Run a batch of candidate tasks in parallel. Resolves an array aligned with `tasks`;
   * entries are `null` when that candidate failed and must be recomputed sequentially.
   */
  async runBatch(
    context: V3WorkerInitContext,
    tasks: V3WorkerTaskPayload[],
  ): Promise<Array<V3WorkerResult | null>> {
    const results: Array<V3WorkerResult | null> = new Array(tasks.length).fill(null);
    let nextTask = 0;

    const runLane = async (): Promise<void> => {
      let pooled = this.spawn();
      while (nextTask < tasks.length) {
        const taskIndex = nextTask++;
        // A worker that timed out is terminated; replace it so the lane keeps draining the
        // queue instead of dispatching onto a dead thread.
        if (pooled.dead) pooled = this.spawn();
        this.stats.tasksDispatched += 1;
        try {
          const result = await this.dispatch(pooled, context, tasks[taskIndex]!);
          if (result.ok) {
            this.stats.workerSucceeded += 1;
            results[taskIndex] = result;
          } else {
            this.stats.workerFailed += 1;
            results[taskIndex] = null;
          }
        } catch (err) {
          if (err instanceof Error && /timed out/.test(err.message)) this.stats.workerTimedOut += 1;
          else this.stats.workerFailed += 1;
          results[taskIndex] = null;
        }
      }
    };

    const laneCount = Math.min(this.size, tasks.length);
    this.stats.workerLanes = laneCount;
    const lanes: Promise<void>[] = [];
    for (let i = 0; i < laneCount; i += 1) {
      lanes.push(runLane());
    }
    await Promise.all(lanes);
    return results;
  }

  private dispatch(
    pooled: PooledWorker,
    context: V3WorkerInitContext,
    task: V3WorkerTaskPayload,
  ): Promise<V3WorkerResult> {
    return new Promise<V3WorkerResult>((resolve, reject) => {
      const { worker } = pooled;
      const isFirstTask = !pooled.initialized;
      const startedAt = performance.now();
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.removeListener("message", onMessage);
        worker.removeListener("error", onError);
      };
      const onMessage = (msg: V3WorkerResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        pooled.busy = false;
        const elapsed = performance.now() - startedAt;
        if (isFirstTask) {
          this.stats.firstTaskCount += 1;
          this.stats.firstTaskTotalMs += elapsed;
          if (elapsed > this.stats.maxFirstTaskMs) this.stats.maxFirstTaskMs = elapsed;
        } else {
          this.stats.warmTaskCount += 1;
          this.stats.warmTaskTotalMs += elapsed;
        }
        resolve(msg);
      };
      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        pooled.busy = false;
        reject(err);
      };
      // Fail-safe: a wedged worker must not stall the batch. On timeout we terminate the
      // thread and reject so the caller recomputes this candidate on the main thread.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        pooled.busy = false;
        pooled.dead = true;
        void worker.terminate().catch(() => undefined);
        reject(new Error("v3 worker task timed out"));
      }, configuredTaskTimeoutMs());
      worker.once("message", onMessage);
      worker.once("error", onError);
      pooled.busy = true;
      if (!pooled.initialized) {
        worker.postMessage({ type: "init", context, task });
        pooled.initialized = true;
      } else {
        worker.postMessage({ type: "task", task });
      }
    });
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((pooled) => pooled.worker.terminate().catch(() => undefined)));
    this.workers.length = 0;
  }
}
