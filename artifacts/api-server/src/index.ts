import { validateEnv, type AppEnv } from "./lib/env";
import { initPool, SESSION_TABLE_DDL } from "./lib/pg-pool";
import { initDb } from "./db";
import type pg from "pg";
import { createApp } from "./app";
import { markBootComplete } from "./lib/boot-state";
import { logger } from "./lib/logger";
import { runDbInit } from "./lib/db-init";

/**
 * Startup health verification.
 *
 * Runs ALL checks before the server is allowed to listen or markBootComplete()
 * is called. If any check fails the error propagates up to bootstrap(), which
 * exits the process. The server NEVER reaches app.listen() with a broken state.
 *
 * Checks performed:
 *   - SELECT 1  → DB is reachable and accepting queries
 *   - env fields → critical values are non-empty (belt-and-suspenders after validateEnv)
 */
async function verifyStartupHealth(
  rawPool: pg.Pool,
  env: AppEnv,
): Promise<void> {
  try {
    await rawPool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `[boot] Database health check failed: ${(err as Error).message}`,
    );
  }

  if (!env.DATABASE_URL || !env.SESSION_SECRET || env.PORT <= 0) {
    throw new Error("[boot] Env integrity check failed — one or more critical vars are empty");
  }
}

/**
 * Explicit bootstrap function — the single lifecycle gate for the entire process.
 *
 * Initialization order is enforced by function call sequence; each step depends
 * on all previous steps completing without error. Any failure is fatal: bootstrap
 * throws, the process exits, and app.listen() is NEVER reached.
 *
 * Phases:
 *   1. validateEnv        — fast-fail on missing config; returns {env, features}
 *   2. initPool           — create singleton pg.Pool; no connection opened yet
 *   3. initDb             — wrap raw pool in Drizzle; dep guard enforces pool exists
 *   4. DDL                — idempotent session table creation; first real DB connection
 *   5. Health check       — SELECT 1 + env integrity; all checks must pass
 *   6. createApp          — build Express + middleware; takes explicit env + rawPool
 *   7. markBootComplete   — unlock all consumer proxies and getters
 *   8. listen             — bind port; process accepts traffic only at this point
 */
async function bootstrap(): Promise<void> {
  // ── 1. Environment ──────────────────────────────────────────────────────────
  // validateEnv() returns {env, features} directly.
  // Bootstrap uses these values — never calls getEnv() / getFeatures(), which
  // are boot-locked and would throw at this point.
  const { env, features } = validateEnv();

  // ── 2. DB pool ──────────────────────────────────────────────────────────────
  // initPool() returns the created pool. rawPool is a local variable in bootstrap's
  // call stack — never stored in a module-level variable, never re-exported.
  const rawPool = initPool(env.DATABASE_URL);

  // ── 3. ORM ──────────────────────────────────────────────────────────────────
  // rawPool is injected explicitly. TypeScript enforces it is a valid pg.Pool,
  // making "db initialized without pool" structurally impossible.
  initDb(rawPool);

  // ── 4. Schema bootstrap (idempotent DDL) ────────────────────────────────────
  try {
    await rawPool.query(SESSION_TABLE_DDL);
  } catch (err) {
    throw new Error(
      `[boot] Session table DDL failed: ${(err as Error).message}`,
    );
  }

  // ── 4b. Application schema bootstrap ──────────────────────────────────────
  try {
    await runDbInit(rawPool);
  } catch (err) {
    throw new Error(`[boot] App schema bootstrap failed: ${(err as Error).message}`);
  }

  // ── 5. Health verification — must pass before any listener is opened ─────────
  await verifyStartupHealth(rawPool, env);

  // ── 6. App ──────────────────────────────────────────────────────────────────
  const app = createApp(env, rawPool);

  // ── 7. Mark boot complete — unlocks all consumer proxies and getters ─────────
  // After this line: db, pool (proxy), getEnv(), getFeatures() are all accessible.
  // Before this line: any consumer access would have thrown [boot] errors.
  markBootComplete();

  // ── 8. Listen ───────────────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    app
      .listen(env.PORT, () => {
        // Single consolidated startup success log — logged exactly once.
        logger.info(
          {
            port: env.PORT,
            NODE_ENV: env.NODE_ENV,
            db: "connected",
            spotify: features.spotify.enabled ? "enabled" : "disabled",
          },
          "Server ready",
        );

        if (!features.spotify.enabled) {
          logger.warn(
            "[boot] Spotify credentials not configured — /auth, /spotify, and /generate return 503",
          );
        }

        resolve();
      })
      .on("error", reject);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "[boot] Fatal startup error — process exiting");
  process.exit(1);
});
