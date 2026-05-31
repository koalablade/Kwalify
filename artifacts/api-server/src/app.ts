import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "./lib/pg-pool";
import "./lib/session";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const PgStore = connectPgSimple(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

function getAllowedOrigins(): string | string[] | boolean {
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    return frontendUrl.split(",").map((u) => u.trim()).filter(Boolean);
  }
  return true;
}

app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  }),
);

app.use(
  session({
    store: new PgStore({
      pool,
      createTableIfMissing: false,
      ttl: 7 * 24 * 60 * 60,
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
