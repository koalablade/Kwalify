/**
 * Launch smoke suite — minimum end-to-end coverage for a safe private beta.
 *
 * Runs fully offline (no live Postgres, no live Spotify): the database probe is
 * pointed at an unreachable host and the Spotify OAuth handlers are exercised on
 * their DB-free branches (redirect + failure paths). Auth/generate routers are
 * mounted on bare Express apps with an in-memory session store so we test the
 * real handlers without a session database.
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";

import { logger } from "../lib/logger";
import { validateEnv } from "../lib/env";
import { initPool, SESSION_TABLE_DDL, pool } from "../lib/pg-pool";
import { initDb } from "../db";
import { markBootComplete } from "../lib/boot-state";
import { setRuntimeReady } from "../lib/runtime-readiness";
import { createConcurrencyLimiter } from "../lib/concurrency-limiter";
import { acquireGenerateSlot, releaseGenerateSlot, resolveGenerateLimiterDefaults } from "../lib/runtime-overload";
import healthRouter from "../routes/health";
import authRouter from "../routes/auth";
import generateRouter from "../controllers/generation.controller";

// ── Offline test environment ─────────────────────────────────────────────────
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "5099";
process.env.SESSION_SECRET = "smoke-test-secret-smoke-test-secret-0123456789";
// Well-formed but unreachable DB — the readiness probe must report it down fast.
process.env.DATABASE_URL = "postgresql://kwalify:pw@127.0.0.1:1/kwalify";
process.env.DB_POOL_CONNECT_MS = "500";
process.env.SPOTIFY_CLIENT_ID = "smoke_client_id";
process.env.SPOTIFY_CLIENT_SECRET = "smoke_client_secret";
process.env.SPOTIFY_REDIRECT_URI = "https://smoke.example/api/auth/callback";
process.env.APP_URL = "https://smoke.example";

// Boot lifecycle so getEnv()/getFeatures()/pool proxy are usable.
const { env } = validateEnv();
const rawPool = initPool(env.DATABASE_URL);
// Swallow pool 'error' events so a background connection failure to the
// unreachable host cannot surface as an uncaught exception in the test process.
rawPool.on("error", () => undefined);
initDb(rawPool);
markBootComplete();
setRuntimeReady();

// ── Helpers ──────────────────────────────────────────────────────────────────

type StartedServer = { url: string; close: () => Promise<void> };

async function start(app: express.Express): Promise<StartedServer> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Bare app with req.log + req.id stubs and an in-memory session store. */
function baseApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: typeof logger }).log = logger;
    (req as unknown as { id: string }).id = "smoke-req";
    next();
  });
  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  return app;
}

// ── 1. Health endpoint ─────────────────────────────────────────────────────

test("livez reports liveness 200 with no dependencies", async () => {
  const app = express();
  app.use("/", healthRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/livez`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string };
    assert.equal(body.status, "ok");
    assert.equal(Object.keys(body).length, 1, "livez must stay ultra-light");
  } finally {
    await srv.close();
  }
});

test("healthz reports liveness 200", async () => {
  const app = express();
  app.use("/", healthRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string };
    assert.equal(body.status, "ok");
  } finally {
    await srv.close();
  }
});

test("readyz surfaces dependency checks and reports DB down when unreachable", async () => {
  const app = express();
  app.use("/", healthRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/readyz`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { checks?: Record<string, unknown> };
    assert.ok(body.checks, "readyz must include a checks object");
    assert.equal(body.checks!.databaseAvailable, false);
    assert.equal(typeof body.checks!.spotifyConfigured, "boolean");
    assert.ok("pipelineAvailable" in body.checks!);
  } finally {
    await srv.close();
  }
});

test("readyz stays ready while generation slot is active (DB probe may lag)", async () => {
  const release = await acquireGenerateSlot();
  const app = express();
  app.use("/", healthRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/readyz`);
    assert.equal(res.status, 200, "readyz must not fail during active generation");
    const body = (await res.json()) as { checks?: Record<string, unknown> };
    assert.equal(body.checks?.generationBusy, true);
    assert.equal(body.checks?.databaseAvailable, true);
  } finally {
    release();
    await srv.close();
  }
});

test("readiness alias responds", async () => {
  const app = express();
  app.use("/", healthRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/readiness`);
    assert.equal(res.status, 503);
  } finally {
    await srv.close();
  }
});

// ── 2. Spotify auth flow ─────────────────────────────────────────────────────

test("auth login redirects to Spotify authorize", async () => {
  const app = baseApp();
  app.use("/api", authRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/api/auth/login`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /accounts\.spotify\.com/);
  } finally {
    await srv.close();
  }
});

test("auth callback failure path redirects with error", async () => {
  const app = baseApp();
  app.use("/api", authRouter);
  const srv = await start(app);
  try {
    const denied = await fetch(`${srv.url}/api/auth/callback?error=access_denied`, { redirect: "manual" });
    assert.equal(denied.status, 302);
    assert.match(denied.headers.get("location") ?? "", /error=access_denied/);

    const noCode = await fetch(`${srv.url}/api/auth/callback`, { redirect: "manual" });
    assert.equal(noCode.status, 302);
    assert.match(noCode.headers.get("location") ?? "", /error=no_code/);
  } finally {
    await srv.close();
  }
});

// ── 3. Generate endpoint ─────────────────────────────────────────────────────

test("generate rejects unauthenticated requests (never 200)", async () => {
  const app = baseApp();
  app.use("/api", generateRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vibe: "late night drive" }),
    });
    assert.ok([400, 401, 403].includes(res.status), `expected 4xx auth refusal, got ${res.status}`);
  } finally {
    await srv.close();
  }
});

test("generate rejects an invalid request body (never 200)", async () => {
  const app = baseApp();
  app.use("/api", generateRouter);
  const srv = await start(app);
  try {
    const res = await fetch(`${srv.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  } finally {
    await srv.close();
  }
});

// ── 4. Database / busy behaviour ─────────────────────────────────────────────

test("database wiring: SESSION_TABLE_DDL present and pool query rejects when DB down", async () => {
  assert.match(SESSION_TABLE_DDL, /CREATE TABLE IF NOT EXISTS "session"/);
  await assert.rejects(
    () => (pool as unknown as { query: (q: string) => Promise<unknown> }).query("SELECT 1"),
    "query against an unreachable DB must reject (not hang or resolve)",
  );
});

test("busy: concurrency limiter rejects once saturated (SERVER_BUSY trigger)", async () => {
  const limiter = createConcurrencyLimiter({
    name: "smoke_generate",
    limitEnv: "SMOKE_LIMIT_UNSET",
    queueLimitEnv: "SMOKE_QUEUE_UNSET",
    defaultLimit: 1,
    defaultQueueLimit: 0,
  });
  const release = await limiter.acquire();
  await assert.rejects(() => limiter.acquire(), "saturated limiter must reject the overflow acquire");
  release();
});

test("selfhost lowers default generate concurrency when env unset", () => {
  const prevHost = process.env.KWALIFY_HOST_MODE;
  try {
    process.env.KWALIFY_HOST_MODE = "selfhost";
    const self = resolveGenerateLimiterDefaults();
    assert.equal(self.defaultLimit, 2);
    assert.equal(self.defaultQueueLimit, 4);
    delete process.env.KWALIFY_HOST_MODE;
    const cloud = resolveGenerateLimiterDefaults();
    assert.equal(cloud.defaultLimit, 4);
    assert.equal(cloud.defaultQueueLimit, 12);
  } finally {
    if (prevHost !== undefined) process.env.KWALIFY_HOST_MODE = prevHost;
    else delete process.env.KWALIFY_HOST_MODE;
  }
});
