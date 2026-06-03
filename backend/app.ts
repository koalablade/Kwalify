import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import pg from "pg";
import path from "node:path";
import router from "./routes/routes.index";
import { logger } from "./lib/logger";
import { type AppEnv } from "./lib/env";
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

  // Render (and most cloud platforms) terminate TLS at their load balancer and
  // forward requests to the app over HTTP. Without trust proxy, express-session
  // sees a non-secure connection and skips sending the Set-Cookie header when
  // cookie.secure is true — so the browser never gets a session cookie and every
  // OAuth state check fails. Setting this to 1 trusts the first X-Forwarded-*
  // hop (the Render proxy) so req.secure reflects the user-facing HTTPS.
  app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
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
    corsOrigins.size > 0 ? [...corsOrigins] : true;

  app.use(cors({ origin: allowedOrigins, credentials: true }));

  if (env.APP_URL && env.NODE_ENV === "production") {
    const canonical = new URL(env.APP_URL);
    app.use((req, res, next) => {
      if (req.path === "/api/healthz" || req.path === "/api/health") return next();
      if (req.hostname === "localhost" || req.hostname === canonical.hostname) return next();
      return res.redirect(301, `${canonical.origin}${req.originalUrl}`);
    });
  }

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
        // Same host (APP_URL on Render custom domain): lax. Split frontend/API: none.
        sameSite:
          env.NODE_ENV === "production"
            ? env.APP_URL
              ? "lax"
              : "none"
            : "lax",
      },
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve the static frontend from the repository-level frontend/public folder.
  // __dirname = backend/dist at runtime -> ../../frontend/public
  const frontendPublicDir = path.resolve(__dirname, "../../frontend/public");
  app.use(express.static(frontendPublicDir));

  // Named SPA routes served before the API router so Express doesn't 404 them.
  app.get("/p/:id", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "playlist.html")));
  app.get("/gallery", (_req, res) => res.sendFile(path.resolve(frontendPublicDir, "gallery.html")));

  app.use("/api", router);

  return app;
}
