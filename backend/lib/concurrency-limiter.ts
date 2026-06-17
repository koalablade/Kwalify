import { moduleLogger } from "./logger";
import { recordSystemOverload } from "./system-health";

const log = moduleLogger("concurrency-limiter");

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timer?: NodeJS.Timeout;
};

export type ConcurrencyLimiter = {
  acquire: () => Promise<() => void>;
  release: () => void;
  state: () => { active: number; queued: number; limit: number; queueLimit: number; averageLatencyMs: number };
  recordLatency: (latencyMs: number) => void;
};

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createConcurrencyLimiter(opts: {
  name: string;
  limitEnv?: string;
  queueLimitEnv?: string;
  defaultLimit: number;
  defaultQueueLimit: number;
  overloadQueueThreshold?: number;
  overloadLatencyMs?: number;
}): ConcurrencyLimiter {
  const limit = envInt(opts.limitEnv ?? "", opts.defaultLimit);
  const queueLimit = envInt(opts.queueLimitEnv ?? "", opts.defaultQueueLimit);
  const maxWaitMs = envInt(`${opts.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_QUEUE_MAX_WAIT_MS`, envInt("CONCURRENCY_QUEUE_MAX_WAIT_MS", 45_000));
  const overloadQueueThreshold = opts.overloadQueueThreshold ?? Math.max(1, Math.floor(queueLimit * 0.8));
  const overloadLatencyMs = opts.overloadLatencyMs ?? 30_000;
  const queue: Waiter[] = [];
  const latencies: number[] = [];
  let active = 0;

  const state = () => ({
    active,
    queued: queue.length,
    limit,
    queueLimit,
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : 0,
  });

  const logOverloadIfNeeded = (): void => {
    const snapshot = state();
    if (snapshot.queued < overloadQueueThreshold && snapshot.averageLatencyMs < overloadLatencyMs) return;
    recordSystemOverload();
    log.warn({ limiter: opts.name, ...snapshot }, "system_overloaded");
  };

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (!next) return;
      if (next.timer) clearTimeout(next.timer);
      active += 1;
      next.resolve(makeRelease());
    };
  };

  return {
    async acquire() {
      logOverloadIfNeeded();
      if (active < limit) {
        active += 1;
        return makeRelease();
      }
      if (queue.length >= queueLimit) {
        const err = new Error(`${opts.name} queue is full`);
        (err as Error & { code?: string }).code = "QUEUE_FULL";
        recordSystemOverload();
        log.warn({ limiter: opts.name, ...state() }, "system_overloaded");
        throw err;
      }
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, enqueuedAt: Date.now() };
        waiter.timer = setTimeout(() => {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          const err = new Error(`${opts.name} queue wait timed out`);
          (err as Error & { code?: string }).code = "QUEUE_TIMEOUT";
          recordSystemOverload();
          log.warn({ limiter: opts.name, ...state(), maxWaitMs }, "system_overloaded_queue_timeout");
          reject(err);
        }, maxWaitMs);
        waiter.timer.unref?.();
        queue.push(waiter);
        logOverloadIfNeeded();
      });
    },
    release() {
      makeRelease()();
    },
    state,
    recordLatency(latencyMs: number) {
      if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
      latencies.push(latencyMs);
      while (latencies.length > 50) latencies.shift();
      logOverloadIfNeeded();
    },
  };
}
