import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pool } from "../lib/pg-pool";
import { assertBootReady } from "../lib/boot-state";
import * as schema from "./schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// ── Singleton state ───────────────────────────────────────────────────────────

let _db: DrizzleDb | null = null;

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Creates the Drizzle ORM wrapper. Idempotent — subsequent calls are no-ops.
 *
 * rawPool is injected explicitly by bootstrap() — it is the value returned by
 * initPool(), captured in bootstrap's local scope. No bypass function is needed:
 * the TypeScript type system enforces that a valid pg.Pool must be provided, so
 * "db initialized without pool" is structurally impossible.
 *
 * Drizzle stores rawPool internally and uses it directly for queries, keeping
 * all Drizzle I/O outside the consumer proxy's boot-ready check.
 */
export function initDb(rawPool: pg.Pool): void {
  if (_db) return;
  _db = drizzle(rawPool, { schema });
}

// ── Consumer proxy ────────────────────────────────────────────────────────────

/**
 * Boot-locked lazy proxy for the Drizzle db instance.
 *
 * Route files import { db } exactly as before — no call-site changes needed.
 * assertBootReady() ensures no route or module can access db before the full
 * bootstrap sequence has completed and health checks have passed.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_, prop) {
    assertBootReady("db");
    if (!_db) {
      throw new Error(
        "[db] Database not initialized — call initDb() in bootstrap() first",
      );
    }
    const val = Reflect.get(_db, prop);
    return typeof val === "function"
      ? (val as (...args: unknown[]) => unknown).bind(_db)
      : val;
  },
});

// Re-export pool proxy so consumers that import it from here continue to work.
export { pool };
export * from "./schema";
