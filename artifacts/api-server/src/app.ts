import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import pg from "pg";
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
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      },
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", router);

  return app;
}
