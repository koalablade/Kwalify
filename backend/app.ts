import express, { type ErrorRequestHandler, type Express } from "express";
import compression from "compression";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import pg from "pg";
import path from "node:path";
import { randomUUID } from "node:crypto";
import router from "./routes/routes.index";
import healthRouter from "./routes/health";
import evalRouter from "./routes/eval";
import evalAdminRouter from "./routes/eval-admin";
import opsRouter from "./routes/ops";
import { logger } from "./lib/logger";
import { type AppEnv } from "./lib/env";
import { getRuntimeReadiness, isRuntimeReady } from "./lib/runtime-readiness";
import { acquireGenerateSlot, getGenerateOverloadState, recordGenerateLatency } from "./lib/runtime-overload";
import { recordServerBusy } from "./lib/ops-metrics";
import { globalRateLimit } from "./lib/global-rate-limit";
import { requireReportsAccess } from "./middleware/benchmark-auth";
import { sendApiError } from "./lib/api-error-envelope";
import { captureError } from "./lib/error-tracking";
import { isShuttingDown } from "./lib/shutdown";
import "./lib/session";

let appInstanceCreated = false;

/**
 * Creates and returns the configured Express application.
 *
 * Takes the validated env and the raw pool as explicit arguments so it can be
 * called safely during bootstrap() — before markBootComplete() — without
 * triggering the boot-locked getEnv() or pool proxy guards.
 *
 * Dependency contract:
 *   env     — must be the object returned by validateEnv()
 *   rawPool — must be the pg.Pool returned by initPool()
 *
 * Throws immediately if either argument is absent or clearly invalid, making
 * "app created without env validation" structurally impossible.
 */
export function createApp(env: AppEnv, rawPool: pg.Pool): Express {
  if (appInstanceCreated) {
    throw new Error("[architecture] createApp() may only be called once; backend/server.ts is the single entry point");
  }
  if (!env?.DATABASE_URL || !env?.SESSION_SECRET || env?.PORT <= 0) {
    throw new Error(
      "[app] createApp() called with invalid env — ensure validateEnv() ran first",
    );
  }
  if (!rawPool) {
    throw new Error(
      "[app] createApp() called without a pool — ensure initPool() ran first",
    );
  }
  appInstanceCreated = true;

  const PgStore = connectPgSimple(session);
  const app: Express = express();

  // Self-hosted deployments run behind a reverse proxy (nginx/Caddy/Traefik)
  // that terminates TLS and forwards over HTTP. Without trust proxy,
  // express-session sees a non-secure connection and skips the Set-Cookie header
  // when cookie.secure is true — so the browser never gets a session cookie and
  // every OAuth state check fails. Trusting the first X-Forwarded-* hop makes
  // req.secure reflect the user-facing HTTPS. Ensure the proxy sets
  // X-Forwarded-Proto (see docs/OPERATIONS.md).
  app.set("trust proxy", 1);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.spotify.com https://accounts.spotify.com;",
    );
    next();
  });

  app.use(compression());

  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const header = req.headers["x-request-id"] ?? req.headers["x-correlation-id"];
        const requestId = Array.isArray(header) ? header[0] : header;
        const id = typeof requestId === "string" && requestId.trim() ? requestId.trim() : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customProps(req) {
        return {
          requestId: req.id,
          correlationId: req.id,
        };
      },
      customSuccessMessage() {
        return "request_completed";
      },
      customErrorMessage() {
        return "request_completed";
      },
      customSuccessObject(req, res, val) {
        const responseTime = (val as Record<string, unknown>)["responseTime"];
        return {
          ...val,
          requestId: req.id,
          route: req.route?.path ?? req.path,
          statusCode: res.statusCode,
          latencyMs: typeof responseTime === "number" ? Math.round(responseTime) : undefined,
        };
      },
      customErrorObject(req, res, err, val) {
        const responseTime = (val as Record<string, unknown>)["responseTime"];
        return {
          ...val,
          err,
          requestId: req.id,
          route: req.route?.path ?? req.path,
          statusCode: res.statusCode,
          latencyMs: typeof responseTime === "number" ? Math.round(responseTime) : undefined,
        };
      },
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  const corsOrigins = new Set<string>();
  if (env.APP_URL) corsOrigins.add(env.APP_URL);
  if (env.FRONTEND_URL) {
    for (const u of env.FRONTEND_URL.split(",")) {
      const t = u.trim().replace(/\/$/, "");
      if (t) corsOrigins.add(t);
    }
  }
  const allowedOrigins: string | string[] | boolean =
    corsOrigins.size > 0 ? [...corsOrigins] : env.NODE_ENV === "production" ? false : true;

  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(globalRateLimit);

  if (env.APP_URL && env.NODE_ENV === "production") {
    const canonical = new URL(env.APP_URL);
    app.use((req, res, next) => {
      if (
        req.path === "/healthz" ||
        req.path === "/readyz" ||
        req.path === "/api/healthz" ||
        req.path === "/api/readyz" ||
        req.path === "/api/health" ||
        req.path === "/api/eval/ping"
      ) {
        return next();
      }
      if (req.hostname === "localhost" || req.hostname === "127.0.0.1" || req.hostname === canonical.hostname) return next();
      return res.redirect(301, `${canonical.origin}${req.originalUrl}`);
    });
  }

  // Keep deployment and eval pings independent from the database-backed session
  // store, so health checks still return during session-store contention.
  app.use("/", healthRouter);
  app.use("/api", healthRouter);
  app.use("/api", evalRouter);
  app.use("/api", evalAdminRouter);
  app.use("/api", opsRouter);

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api") || isRuntimeReady()) return next();
    const readiness = getRuntimeReadiness();
    res.status(503).json({
      success: false,
      code: "SERVER_STARTING",
      error: readiness.state === "failed"
        ? "Server startup failed. Please try again shortly."
        : "Server is starting. Please try again shortly.",
      requestId: req.id,
      readiness: readiness.state,
      retryAfterSeconds: 5,
    });
  });

  app.use(async (req, res, next) => {
    if (req.method !== "POST" || req.path !== "/api/generate") return next();
    if (isShuttingDown()) {
      res.setHeader("Retry-After", "30");
      res.status(503).json({
        success: false,
        code: "SERVER_RESTARTING",
        error: "Kwalify is restarting. Please try again in a moment.",
        requestId: req.id,
        retryAfterSeconds: 30,
      });
      return;
    }
    const startedAt = Date.now();
    let releaseSlot: (() => void) | null = null;
    try {
      releaseSlot = await acquireGenerateSlot();
    } catch (err) {
      const queueCode = (err as Error & { code?: string })?.code;
      const overload = getGenerateOverloadState();
      recordServerBusy({
        active: overload.active,
        queued: overload.queued,
        limit: overload.limit,
        queueLimit: overload.queueLimit,
        requestId: String(req.id),
      });
      const retryAfter = queueCode === "QUEUE_TIMEOUT" ? 15 : 10;
      res.setHeader("Retry-After", String(retryAfter));
      res.status(503).json({
        success: false,
        code: queueCode === "QUEUE_TIMEOUT" ? "QUEUE_TIMEOUT" : "SERVER_BUSY",
        error: queueCode === "QUEUE_TIMEOUT"
          ? "Playlist generation queue was busy. Please retry in a moment."
          : "Playlist generation is currently busy. Please retry shortly.",
        requestId: req.id,
        activeGenerateRequests: overload.active,
        queuedGenerateRequests: overload.queued,
        generateConcurrencyLimit: overload.limit,
        generateQueueLimit: overload.queueLimit,
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      recordGenerateLatency(Date.now() - startedAt);
      releaseSlot?.();
    };

    res.once("finish", release);
    res.once("close", release);
    req.once("aborted", release);
    next();
  });

  app.use(
    session({
      store: new PgStore({
        pool: rawPool,
        createTableIfMissing: false,
        ttl: 7 * 24 * 60 * 60,
        pruneSessionInterval: 60 * 60,
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: env.NODE_ENV === "production",
      cookie: {
        secure: env.NODE_ENV === "production",
        httpOnly: true,
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        // Same host (frontend served from APP_URL): lax. Split client/API host: none.
        sameSite:
          env.NODE_ENV === "production"
            ? env.APP_URL
              ? "lax"
              : "none"
            : "lax",
      },
    }),
  );

  app.use(express.json({ limit: process.env["JSON_BODY_LIMIT"] ?? "64kb" }));
  app.use(express.urlencoded({ extended: true, limit: process.env["URLENCODED_BODY_LIMIT"] ?? "256kb" }));

  const frontendPublicDir = path.resolve(__dirname, "../../frontend/public");
  const reportsDir = path.resolve(__dirname, "../../reports");
  app.use(express.static(frontendPublicDir));
  app.use(
    "/reports",
    requireReportsAccess,
    express.static(reportsDir, {
      index: false,
      dotfiles: "deny",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".json")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  app.get("/", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "index.html")));
  app.get("/p/:slug", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "playlist.html")));
  app.get("/gallery", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "gallery.html")));
  app.get("/settings", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "settings.html")));
  app.get("/status", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "status.html")));
  app.get("/benchmark", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "benchmark-launcher.html")));
  app.get("/benchmark-status.html", (_req, res) => res.redirect(301, "/benchmark#live-dashboard"));
  app.get("/benchmark-history.html", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "benchmark-history.html")));
  app.get("/benchmark-guide.html", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "benchmark-guide.html")));
  app.get("/local-start-help.html", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "local-start-help.html")));
  app.get("/favicon.ico", (_req, res) => res.redirect(301, "/favicon.svg"));
  for (const legacy of ["benchmark-status.html", "benchmark-history.html", "benchmark-guide.html", "favicon.ico"]) {
    app.get(`/public/${legacy}`, (_req, res) => res.redirect(301, `/${legacy}`));
  }
  app.get("/privacy", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "privacy.html")));
  app.get("/terms", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "terms.html")));

  app.use("/api", router);

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.status(404).sendFile(path.resolve(frontendPublicDir, "404.html"));
  });

  const apiErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next(err);
      return;
    }
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
    const payloadTooLarge = status === 413 || err?.type === "entity.too.large";
    req.log.error(
      { err, status, path: req.path, method: req.method, requestId: req.id },
      payloadTooLarge ? "API payload too large" : "Unhandled API route error",
    );
    if (status >= 500) {
      captureError(err, {
        path: req.path,
        method: req.method,
        requestId: String(req.id),
        status,
        source: "apiErrorHandler",
      });
    }
    sendApiError(res, status, payloadTooLarge ? "PAYLOAD_TOO_LARGE" : status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", payloadTooLarge ? "Request payload is too large." : status === 500 ? "Unexpected server error." : "Request failed.", {
      requestId: String(req.id),
    });
  };
  app.use(apiErrorHandler);

  return app;
}
