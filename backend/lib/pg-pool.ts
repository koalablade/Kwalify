import pg from "pg";
import { assertBootReady } from "./boot-state";
import { createFailureContext } from "./failure-types";
import { moduleLogger } from "./logger";
import { recordSystemFailure } from "./system-health";

// ── Singleton state ───────────────────────────────────────────────────────────

let _pool: pg.Pool | null = null;
const log = moduleLogger("pg-pool");

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const DB_MAX_RETRIES = 5;
const DB_MAX_BACKOFF_MS = 10_000;
const DB_FAILURES_TO_OPEN = 5;
const DB_SUCCESSES_TO_CLOSE = 3;
const DB_POOL_WAITING_WARN_THRESHOLD = Number.parseInt(process.env["DB_POOL_WAITING_WARN_THRESHOLD"] ?? "20", 10);

const circuit = {
  state: "CLOSED" as CircuitState,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  nextAttemptAt: 0,
};

// ── Public constants ──────────────────────────────────────────────────────────

export const SESSION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "session" (
    "sid"    VARCHAR      NOT NULL PRIMARY KEY,
    "sess"   JSON         NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = Math.min(DB_MAX_BACKOFF_MS, 100 * 2 ** Math.max(0, attempt - 1));
  return Math.min(DB_MAX_BACKOFF_MS, base + Math.floor(Math.random() * Math.max(50, base)));
}

function isTransientDbError(err: unknown): boolean {
  const error = err as Partial<{ code: string; message: string }>;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EPIPE" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    code.startsWith("08") ||
    message.includes("connection terminated") ||
    message.includes("timeout") ||
    message.includes("terminating connection")
  );
}

function assertCircuitAllowsQuery(): void {
  if (circuit.state !== "OPEN") return;
  if (Date.now() >= circuit.nextAttemptAt) {
    circuit.state = "HALF_OPEN";
    circuit.consecutiveSuccesses = 0;
    log.warn({ circuitState: circuit.state }, "db_circuit_half_open");
    return;
  }
  const err = new Error("Database circuit is open after repeated connection failures");
  (err as Error & { code?: string }).code = "DB_CIRCUIT_OPEN";
  throw err;
}

function recordDbSuccess(): void {
  circuit.consecutiveFailures = 0;
  if (circuit.state !== "HALF_OPEN") return;
  circuit.consecutiveSuccesses += 1;
  if (circuit.consecutiveSuccesses >= DB_SUCCESSES_TO_CLOSE) {
    circuit.state = "CLOSED";
    circuit.consecutiveSuccesses = 0;
    log.info({ circuitState: circuit.state }, "db_circuit_closed");
  }
}

function recordDbFailure(err: unknown): void {
  circuit.consecutiveFailures += 1;
  circuit.consecutiveSuccesses = 0;
  if (circuit.consecutiveFailures < DB_FAILURES_TO_OPEN && circuit.state !== "HALF_OPEN") return;
  circuit.state = "OPEN";
  circuit.nextAttemptAt = Date.now() + DB_MAX_BACKOFF_MS;
  recordSystemFailure(createFailureContext({
    stage: "db_query",
    error: err,
    recoverable: true,
  }));
  log.error(
    { err, circuitState: circuit.state, consecutiveFailures: circuit.consecutiveFailures },
    "db_circuit_open",
  );
}

function protectPool(pool: pg.Pool): void {
  const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  pool.query = (async (...args: unknown[]) => {
    const waitingCount = typeof pool.waitingCount === "number" ? pool.waitingCount : 0;
    if (waitingCount >= DB_POOL_WAITING_WARN_THRESHOLD) {
      log.warn({ waitingCount, threshold: DB_POOL_WAITING_WARN_THRESHOLD }, "db_pool_queue_high");
    }
    assertCircuitAllowsQuery();
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DB_MAX_RETRIES; attempt++) {
      try {
        const result = await originalQuery(...args);
        recordDbSuccess();
        return result;
      } catch (err) {
        lastError = err;
        if (!isTransientDbError(err)) throw err;
        recordDbFailure(err);
        if (attempt >= DB_MAX_RETRIES) break;
        const wait = backoffMs(attempt);
        log.warn({ err, attempt, maxRetries: DB_MAX_RETRIES, wait }, "db_query_retry");
        await sleep(wait);
        assertCircuitAllowsQuery();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }) as typeof pool.query;
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Creates the singleton pg.Pool from the supplied connection string.
 *
 * Idempotent — returns the existing pool on subsequent calls, ensuring only
 * one pool instance ever exists. Throws immediately if connectionString is
 * empty, which would only happen if called before validateEnv().
 */
export function initPool(connectionString: string): pg.Pool {
  if (_pool) return _pool;
  if (!connectionString) {
    throw new Error(
      "[pool] initPool() called with an empty connectionString — call validateEnv() first",
    );
  }
  _pool = new pg.Pool({
    connectionString,
    max: Number.parseInt(process.env["DB_POOL_MAX"] ?? process.env["PG_POOL_MAX"] ?? "10", 10),
    idleTimeoutMillis: Number.parseInt(process.env["DB_POOL_IDLE_MS"] ?? "30000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env["DB_POOL_CONNECT_MS"] ?? "12000", 10),
  });
  protectPool(_pool);
  return _pool;
}

// ── Consumer proxy ────────────────────────────────────────────────────────────

/**
 * Boot-locked lazy proxy for the pg.Pool singleton.
 *
 * Consumers import { pool } exactly as before — no call-site changes needed.
 * Two guards run on every property access:
 *   1. assertBootReady()  — throws [boot] error if boot not yet complete
 *   2. !_pool check       — throws [pool] error if initPool() was somehow skipped
 *
 * In a correctly ordered bootstrap these guards are never triggered at request
 * time; they exist to catch programming errors early.
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_, prop) {
    assertBootReady("pool");
    if (!_pool) {
      throw new Error(
        "[pool] Pool not initialized — call initPool() in bootstrap() first",
      );
    }
    const val = Reflect.get(_pool, prop);
    return typeof val === "function"
      ? (val as (...args: unknown[]) => unknown).bind(_pool)
      : val;
  },
});
