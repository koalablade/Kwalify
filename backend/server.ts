import { validateEnv, type AppEnv } from "./lib/env";
import { initPool, SESSION_TABLE_DDL } from "./lib/pg-pool";
import { initDb } from "./db";
import type pg from "pg";
import { createApp } from "./app";
import { markBootComplete } from "./lib/boot-state";
import { logger } from "./lib/logger";
import { runDbInit } from "./lib/db-init";
import { beginGracefulShutdown } from "./lib/shutdown";
import { warmGenreOntologyAtBoot } from "./lib/warm-genre-ontology";
import { startFeedbackMemoryDecayJob } from "./lib/feedback-memory";
import { setRuntimeFailed, setRuntimeInitializing, setRuntimeReady } from "./lib/runtime-readiness";

const BOOT_DB_TIMEOUT_MS = 15_000;

async function withBootTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = BOOT_DB_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Startup health verification.
 *
 * Runs bounded DB readiness checks after the liveness server is already bound.
 * If any check fails, /readyz reports failed and API routes stay gated.
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
    await withBootTimeout(rawPool.query("SELECT 1"), "startup database health check");
  } catch (err) {
    throw new Error(
      `[boot] Database health check failed: ${(err as Error).message}`,
    );
  }

  if (!env.DATABASE_URL || !env.SESSION_SECRET || env.PORT <= 0) {
    throw new Error("[boot] Env integrity check failed — one or more critical vars are empty");
  }
}

async function finishRuntimeInitialization(rawPool: pg.Pool, env: AppEnv): Promise<void> {
  setRuntimeInitializing();

  try {
    await withBootTimeout(rawPool.query(SESSION_TABLE_DDL), "session table bootstrap");
  } catch (err) {
    throw new Error(
      `[boot] Session table DDL failed: ${(err as Error).message}`,
    );
  }

  try {
    await withBootTimeout(runDbInit(rawPool), "app schema bootstrap", 20_000);
  } catch (err) {
    throw new Error(`[boot] App schema bootstrap failed: ${(err as Error).message}`);
  }

  await verifyStartupHealth(rawPool, env);

  warmGenreOntologyAtBoot();
  setRuntimeReady();
}

/**
 * Explicit bootstrap function — the single lifecycle gate for the entire process.
 *
 * The HTTP listener is opened before DB/schema initialization so /healthz and
 * /api/eval/ping are always responsive during deploys. API routes are gated
 * until background initialization marks runtime readiness.
 *
 * Phases:
 *   1. validateEnv        — fast-fail on missing config; returns {env, features}
 *   2. initPool           — create singleton pg.Pool; no connection opened yet
 *   3. initDb             — wrap raw pool in Drizzle; dep guard enforces pool exists
 *   4. markBootComplete   — unlock route dependencies; API remains readiness-gated
 *   5. createApp          — build Express + middleware; takes explicit env + rawPool
 *   6. listen             — bind port immediately for health/eval pings
 *   7. background init    — schema + DB health; marks /readyz ready or failed
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

  // ── 4. Mark boot complete — unlocks route proxies; API is still readiness gated.
  // After this line: db, pool (proxy), getEnv(), getFeatures() are all accessible.
  markBootComplete();

  // ── 5. App ──────────────────────────────────────────────────────────────────
  const app = createApp(env, rawPool);

  // ── 6. Listen immediately for health/eval pings ────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(env.PORT, () => {
        // Listener is open; readiness is finalized by background initialization.
        logger.info(
          {
            port: env.PORT,
            NODE_ENV: env.NODE_ENV,
            spotify: features.spotify.enabled ? "enabled" : "disabled",
          },
          "Server listening; runtime initialization in progress",
        );

        if (!features.spotify.enabled) {
          logger.warn(
            "[boot] Spotify credentials not configured — /auth, /spotify, and /generate return 503",
          );
        }

        process.on("SIGTERM", () => beginGracefulShutdown(logger));

        resolve();
      });
    server.requestTimeout = 95_000;
    server.headersTimeout = 100_000;
    server.keepAliveTimeout = 65_000;
    server.on("error", reject);
  });

  // ── 7. Background readiness initialization ─────────────────────────────────
  finishRuntimeInitialization(rawPool, env)
    .then(() => {
      logger.info({ db: "connected" }, "Server ready");
      startFeedbackMemoryDecayJob(logger);
    })
    .catch((err) => {
      setRuntimeFailed(err);
      logger.error({ err }, "[boot] Runtime initialization failed");
    });
}

bootstrap().catch((err) => {
  logger.error({ err }, "[boot] Fatal startup error — process exiting");
  process.exit(1);
});
