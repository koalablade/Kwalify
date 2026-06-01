import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import pg from "pg";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { type AppEnv } from "./lib/env";
import "./lib/session";

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

  const allowedOrigins: string | string[] | boolean = env.FRONTEND_URL
    ? env.FRONTEND_URL.split(",").map((u) => u.trim()).filter(Boolean)
    : true;

  app.use(cors({ origin: allowedOrigins, credentials: true }));

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
      cookie: {
        secure: env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        // TEMPORARY TEST: "none" forces cross-site cookie sending on production
        // to rule out sameSite="lax" as the cause of missing oauthState. Revert
        // to "lax" once the root cause is confirmed (requires secure:true in prod).
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      },
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve the frontend from public/ directory.
  // __dirname = artifacts/api-server/dist at runtime → ../public = artifacts/api-server/public
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.use("/api", router);

  return app;
}
