import pg from "pg";
import { assertBootReady } from "./boot-state";

// ── Singleton state ───────────────────────────────────────────────────────────

let _pool: pg.Pool | null = null;

// ── Public constants ──────────────────────────────────────────────────────────

export const SESSION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "session" (
    "sid"    VARCHAR      NOT NULL PRIMARY KEY,
    "sess"   JSON         NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

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
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
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
