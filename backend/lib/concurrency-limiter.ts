import { moduleLogger } from "./logger";
import { recordSystemOverload } from "./system-health";

const log = moduleLogger("concurrency-limiter");

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
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
        queue.push({ resolve, reject, enqueuedAt: Date.now() });
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
