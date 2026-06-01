## package.json

```json
{
  "name": "kwalify-api",
  "version": "1.0.0",
  "private": true,
  "engines": {
    "node": "20.x"
  },
  "scripts": {
    "build": "tsc",
    "start": "node artifacts/api-server/dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@types/connect-pg-simple": "^7.0.3",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/express-session": "^1.19.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.20.0",
    "axios": "^1.9.0",
    "connect-pg-simple": "^10.0.0",
    "cors": "^2.8.6",
    "drizzle-orm": "^0.45.2",
    "drizzle-zod": "^0.7.0",
    "express": "^5.2.1",
    "express-session": "^1.18.1",
    "pg": "^8.20.0",
    "pino": "^9.14.0",
    "pino-http": "^10.5.0",
    "pino-pretty": "^13.1.3",
    "typescript": "5.7.3",
    "zod": "^3.25.76"
  },
  "overrides": {
    "typescript": "5.7.3"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0"
  }
}

```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "node16",
    "outDir": "./artifacts/api-server/dist",
    "rootDir": "artifacts/api-server/src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true
  },
  "include": ["artifacts/api-server/src/**/*"]
}

```

## render.yaml

```yaml
# Render Blueprint â€” https://render.com/docs/blueprint-spec
# After connecting GitHub, use: New > Blueprint > select koalablade/Kwalify

databases:
  - name: kwalify-db
    plan: free
    region: frankfurt
    databaseName: kwalify
    user: kwalify

services:
  - type: web
    name: kwalify-api
    runtime: node
    plan: free
    region: frankfurt
    repo: https://github.com/koalablade/Kwalify
    branch: main
    buildCommand: NPM_CONFIG_PRODUCTION=false npm install && npm run build
    startCommand: npm start
    healthCheckPath: /api/healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: kwalify-db
          property: connectionString
      - key: SESSION_SECRET
        generateValue: true
      - key: SPOTIFY_CLIENT_ID
        sync: false
      - key: SPOTIFY_CLIENT_SECRET
        sync: false
      - key: SPOTIFY_REDIRECT_URI
        sync: false
      - key: FRONTEND_URL
        sync: false

```

## artifacts/api-server/src/app.ts

```typescript
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
 * called safely during bootstrap() â€” before markBootComplete() â€” without
 * triggering the boot-locked getEnv() or pool proxy guards.
 *
 * Dependency contract:
 *   env     â€” must be the object returned by validateEnv()
 *   rawPool â€” must be the pg.Pool returned by initPool()
 *
 * Throws immediately if either argument is absent or clearly invalid, making
 * "app created without env validation" structurally impossible.
 */
export function createApp(env: AppEnv, rawPool: pg.Pool): Express {
  if (!env?.DATABASE_URL || !env?.SESSION_SECRET || env?.PORT <= 0) {
    throw new Error(
      "[app] createApp() called with invalid env â€” ensure validateEnv() ran first",
    );
  }
  if (!rawPool) {
    throw new Error(
      "[app] createApp() called without a pool â€” ensure initPool() ran first",
    );
  }

  const PgStore = connectPgSimple(session);
  const app: Express = express();

  // Render (and most cloud platforms) terminate TLS at their load balancer and
  // forward requests to the app over HTTP. Without trust proxy, express-session
  // sees a non-secure connection and skips sending the Set-Cookie header when
  // cookie.secure is true â€” so the browser never gets a session cookie and every
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
  // __dirname = artifacts/api-server/dist at runtime â†’ ../public = artifacts/api-server/public
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.use("/api", router);

  return app;
}

```

## artifacts/api-server/src/index.ts

```typescript
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
 *   - SELECT 1  â†’ DB is reachable and accepting queries
 *   - env fields â†’ critical values are non-empty (belt-and-suspenders after validateEnv)
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
    throw new Error("[boot] Env integrity check failed â€” one or more critical vars are empty");
  }
}

/**
 * Explicit bootstrap function â€” the single lifecycle gate for the entire process.
 *
 * Initialization order is enforced by function call sequence; each step depends
 * on all previous steps completing without error. Any failure is fatal: bootstrap
 * throws, the process exits, and app.listen() is NEVER reached.
 *
 * Phases:
 *   1. validateEnv        â€” fast-fail on missing config; returns {env, features}
 *   2. initPool           â€” create singleton pg.Pool; no connection opened yet
 *   3. initDb             â€” wrap raw pool in Drizzle; dep guard enforces pool exists
 *   4. DDL                â€” idempotent session table creation; first real DB connection
 *   5. Health check       â€” SELECT 1 + env integrity; all checks must pass
 *   6. createApp          â€” build Express + middleware; takes explicit env + rawPool
 *   7. markBootComplete   â€” unlock all consumer proxies and getters
 *   8. listen             â€” bind port; process accepts traffic only at this point
 */
async function bootstrap(): Promise<void> {
  // â”€â”€ 1. Environment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // validateEnv() returns {env, features} directly.
  // Bootstrap uses these values â€” never calls getEnv() / getFeatures(), which
  // are boot-locked and would throw at this point.
  const { env, features } = validateEnv();

  // â”€â”€ 2. DB pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // initPool() returns the created pool. rawPool is a local variable in bootstrap's
  // call stack â€” never stored in a module-level variable, never re-exported.
  const rawPool = initPool(env.DATABASE_URL);

  // â”€â”€ 3. ORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // rawPool is injected explicitly. TypeScript enforces it is a valid pg.Pool,
  // making "db initialized without pool" structurally impossible.
  initDb(rawPool);

  // â”€â”€ 4. Schema bootstrap (idempotent DDL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    await rawPool.query(SESSION_TABLE_DDL);
  } catch (err) {
    throw new Error(
      `[boot] Session table DDL failed: ${(err as Error).message}`,
    );
  }

  // â”€â”€ 4b. Application schema bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    await runDbInit(rawPool);
  } catch (err) {
    throw new Error(`[boot] App schema bootstrap failed: ${(err as Error).message}`);
  }

  // â”€â”€ 5. Health verification â€” must pass before any listener is opened â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await verifyStartupHealth(rawPool, env);

  // â”€â”€ 6. App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const app = createApp(env, rawPool);

  // â”€â”€ 7. Mark boot complete â€” unlocks all consumer proxies and getters â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // After this line: db, pool (proxy), getEnv(), getFeatures() are all accessible.
  // Before this line: any consumer access would have thrown [boot] errors.
  markBootComplete();

  // â”€â”€ 8. Listen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await new Promise<void>((resolve, reject) => {
    app
      .listen(env.PORT, () => {
        // Single consolidated startup success log â€” logged exactly once.
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
            "[boot] Spotify credentials not configured â€” /auth, /spotify, and /generate return 503",
          );
        }

        resolve();
      })
      .on("error", reject);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "[boot] Fatal startup error â€” process exiting");
  process.exit(1);
});

```

## artifacts/api-server/src/db/index.ts

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pool } from "../lib/pg-pool";
import { assertBootReady } from "../lib/boot-state";
import * as schema from "./schema";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// â”€â”€ Singleton state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _db: DrizzleDb | null = null;

// â”€â”€ Initialisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Creates the Drizzle ORM wrapper. Idempotent â€” subsequent calls are no-ops.
 *
 * rawPool is injected explicitly by bootstrap() â€” it is the value returned by
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

// â”€â”€ Consumer proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Boot-locked lazy proxy for the Drizzle db instance.
 *
 * Route files import { db } exactly as before â€” no call-site changes needed.
 * assertBootReady() ensures no route or module can access db before the full
 * bootstrap sequence has completed and health checks have passed.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_, prop) {
    assertBootReady("db");
    if (!_db) {
      throw new Error(
        "[db] Database not initialized â€” call initDb() in bootstrap() first",
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

```

## artifacts/api-server/src/db/schema/index.ts

```typescript
export * from "./kwalah";

```

## artifacts/api-server/src/db/schema/kwalah.ts

```typescript
import { pgTable, text, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const likedSongsTable = pgTable("liked_songs", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull(),
  trackId: text("track_id").notNull(),
  trackName: text("track_name").notNull(),
  artistName: text("artist_name").notNull(),
  albumName: text("album_name").notNull(),
  albumArt: text("album_art"),
  durationMs: integer("duration_ms").notNull(),
  energy: real("energy"),
  valence: real("valence"),
  tempo: real("tempo"),
  danceability: real("danceability"),
  acousticness: real("acousticness"),
  instrumentalness: real("instrumentalness"),
  loudness: real("loudness"),
  speechiness: real("speechiness"),
  addedAt: timestamp("added_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playlistHistoryTable = pgTable("playlist_history", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull(),
  playlistId: text("playlist_id").notNull(),
  playlistUrl: text("playlist_url").notNull(),
  name: text("name").notNull(),
  vibe: text("vibe").notNull(),
  mode: text("mode").notNull(),
  trackCount: integer("track_count").notNull(),
  emotionProfile: jsonb("emotion_profile"),
  trackIds: jsonb("track_ids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const syncStatusTable = pgTable("sync_status", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  totalTracks: integer("total_tracks").notNull().default(0),
  isSyncing: integer("is_syncing").notNull().default(0),
  syncProgress: integer("sync_progress"),
  syncTotal: integer("sync_total"),
  lastSyncedAt: timestamp("last_synced_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const savedPlaylistsTable = pgTable("saved_playlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  emotionProfile: jsonb("emotion_profile"),
  tracks: jsonb("tracks"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLikedSongSchema = createInsertSchema(likedSongsTable).omit({ id: true, createdAt: true });
export const insertPlaylistHistorySchema = createInsertSchema(playlistHistoryTable).omit({ id: true, createdAt: true });
export const insertSyncStatusSchema = createInsertSchema(syncStatusTable).omit({ id: true });

export type LikedSong = typeof likedSongsTable.$inferSelect;
export type InsertLikedSong = z.infer<typeof insertLikedSongSchema>;
export type PlaylistHistory = typeof playlistHistoryTable.$inferSelect;
export type SyncStatus = typeof syncStatusTable.$inferSelect;
export type SavedPlaylist = typeof savedPlaylistsTable.$inferSelect;

```

## artifacts/api-server/src/lib/boot-state.ts

```typescript
/**
 * Global boot-state tracker.
 *
 * Tracks a single boolean: has bootstrap() completed successfully?
 *
 * All consumer-facing proxies (pool, db) and getters (getEnv, getFeatures)
 * call assertBootReady() so that any access before the server is fully
 * initialised fails immediately with a clear error rather than silently
 * operating in a partial state.
 *
 * Bootstrap internals NEVER call these proxies / getters â€” they use
 * dedicated init functions (initPool, initDb), receiving raw values via the
 * return value of initPool() rather than any bypass accessor.
 *
 * State machine:
 *   IDLE  â†’ bootstrap() has not yet completed (initial state)
 *   READY â†’ markBootComplete() was called; all services are accessible
 *
 * There is no FAILED state: any bootstrap error is fatal and the process exits.
 */

type BootPhase = "IDLE" | "READY";

let _phase: BootPhase = "IDLE";

/**
 * Called as the final step of bootstrap(), after all health checks pass and
 * immediately before app.listen(). Idempotent â€” calling it a second time is
 * a no-op.
 */
export function markBootComplete(): void {
  _phase = "READY";
}

/** Returns true only after markBootComplete() has been called. */
export function isBootComplete(): boolean {
  return _phase === "READY";
}

/**
 * Throws if called before markBootComplete().
 *
 * Used inside every consumer-facing proxy and getter to make partial-init
 * access a hard, immediate error rather than a silent degraded state.
 *
 * Error message format:
 *   [boot] Attempted to access <resource> before server bootstrap completed
 */
export function assertBootReady(resource: string): void {
  if (_phase !== "READY") {
    throw new Error(
      `[boot] Attempted to access ${resource} before server bootstrap completed`,
    );
  }
}

```

## artifacts/api-server/src/lib/db-init.ts

```typescript
import pg from "pg";
import { logger } from "./logger";

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS "liked_songs" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL,
  "track_id" text NOT NULL,
  "track_name" text NOT NULL,
  "artist_name" text NOT NULL,
  "album_name" text NOT NULL,
  "album_art" text,
  "duration_ms" integer NOT NULL,
  "energy" real,
  "valence" real,
  "tempo" real,
  "danceability" real,
  "acousticness" real,
  "instrumentalness" real,
  "loudness" real,
  "speechiness" real,
  "added_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_liked_songs_user" ON "liked_songs" ("spotify_user_id");

CREATE TABLE IF NOT EXISTS "sync_status" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL UNIQUE,
  "total_tracks" integer NOT NULL DEFAULT 0,
  "is_syncing" integer NOT NULL DEFAULT 0,
  "sync_progress" integer,
  "sync_total" integer,
  "last_synced_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_sync_status_user" ON "sync_status" ("spotify_user_id");

CREATE TABLE IF NOT EXISTS "playlist_history" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL,
  "playlist_id" text NOT NULL,
  "playlist_url" text NOT NULL,
  "name" text NOT NULL,
  "vibe" text NOT NULL,
  "mode" text NOT NULL,
  "track_count" integer NOT NULL,
  "emotion_profile" jsonb,
  "track_ids" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_playlist_history_user" ON "playlist_history" ("spotify_user_id");

CREATE TABLE IF NOT EXISTS "saved_playlists" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "emotion_profile" jsonb,
  "tracks" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_saved_playlists_user" ON "saved_playlists" ("user_id");
`;

export async function runDbInit(rawPool: pg.Pool): Promise<void> {
  try {
    await rawPool.query(SCHEMA_DDL);
    logger.info("[db-init] schema verified â€” all tables ready");
  } catch (err) {
    throw new Error(`[db-init] Schema bootstrap failed: ${(err as Error).message}`);
  }
}

```

## artifacts/api-server/src/lib/emotion.ts

```typescript
// â”€â”€â”€ EMOTION ENGINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Analyses a free-text vibe string and converts it into a structured
// EmotionProfile that drives playlist scoring.

export interface EmotionProfile {
  energy: number;
  valence: number;
  tension: number;
  nostalgia: number;
  calm: number;
  environment: string | null;
  timeOfDay: string | null;
  motionState: string | null;
}

interface SceneContext {
  environment: string | null;
  timeOfDay: string | null;
  motionState: string | null;
  intensityBoost: number;
}

interface VibeKeyword {
  terms: string[];
  weights: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  };
  sceneHints?: Partial<SceneContext>;
  artistOrGenreCue?: boolean;
  exactMatch?: boolean;
}

// â”€â”€â”€ INTENSIFIER DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const INTENSIFIER_SCALES: Array<{ pattern: RegExp; scale: number }> = [
  { pattern: /\bextremely\b|\binsanely\b|\babsolutely\b|\bcompletely\b/i, scale: 1.6 },
  { pattern: /\bvery\b|\breally\b|\bso\b|\bsuper\b|\bdeeply\b|\bintensely\b/i, scale: 1.35 },
  { pattern: /\bquite\b|\bpretty\b|\brather\b|\bfairly\b/i, scale: 1.15 },
  { pattern: /\ba\s+bit\b|\bslightly\b|\ba\s+little\b|\bsomewhat\b/i, scale: 0.7 },
  { pattern: /\bhardly\b|\bbarely\b|\bscarcely\b/i, scale: 0.4 },
];

function getIntensifierScale(text: string): number {
  for (const { pattern, scale } of INTENSIFIER_SCALES) {
    if (pattern.test(text)) return scale;
  }
  return 1.0;
}

// â”€â”€â”€ NEGATION DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NEGATION_PATTERNS = [
  /\bnot\s+(\w+)/gi,
  /\bno\s+(\w+)/gi,
  /\bwithout\s+(\w+)/gi,
  /\bnever\s+(\w+)/gi,
  /\bdon't\s+feel\s+(\w+)/gi,
  /\bdon't\s+want\s+(\w+)/gi,
];

function extractNegatedTerms(text: string): Set<string> {
  const negated = new Set<string>();
  for (const pattern of NEGATION_PATTERNS) {
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(text)) !== null) {
      if (match[1]) negated.add(match[1].toLowerCase());
    }
  }
  return negated;
}

function detectContradictionBoost(text: string): number {
  const contradictionPhrases = [
    /happy.*sad|sad.*happy/i,
    /love.*hate|hate.*love/i,
    /excited.*anxious|anxious.*excited/i,
    /nostalgic.*hopeful|hopeful.*nostalgic/i,
    /calm.*restless|restless.*calm/i,
    /bittersweet/i,
    /love-hate/i,
    /mixed feelings/i,
    /don't know how (i|to) feel/i,
  ];
  let boost = 0;
  for (const phrase of contradictionPhrases) {
    if (phrase.test(text)) boost += 0.12;
  }
  return Math.min(boost, 0.3);
}

function computeEmotionalDepth(text: string): number {
  const wordCount = text.split(/\s+/).length;
  const hasSubclauses = /,|;|because|although|even though|despite|while/i.test(text);
  const hasMeta = /feel(ing)?|emotion|mood|vibe|sense/i.test(text);
  let depth = 0;
  if (wordCount > 5) depth += 0.1;
  if (wordCount > 12) depth += 0.1;
  if (hasSubclauses) depth += 0.15;
  if (hasMeta) depth += 0.1;
  return Math.min(depth, 0.4);
}

// â”€â”€â”€ SCENE DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SCENE_PATTERNS: Array<{
  pattern: RegExp;
  environment?: string;
  timeOfDay?: string;
  motionState?: string;
}> = [
  { pattern: /\bdriving\b|\bhighway\b|\bmotorway\b|\bcar\b|\bcommute\b/i, environment: "urban", motionState: "driving" },
  { pattern: /\bwalk(ing)?\b/i, motionState: "walking" },
  { pattern: /\brun(ning)?\b|\bjogging\b/i, motionState: "running" },
  { pattern: /\btrain\b|\bsubway\b|\bmetro\b|\bbus\b/i, environment: "transit", motionState: "transit" },
  { pattern: /\bplane\b|\bflight\b|\bairport\b/i, environment: "transit", motionState: "transit" },
  { pattern: /\bcity\b|\burban\b|\bstreet\b|\bdowntown\b|\balley\b/i, environment: "urban" },
  { pattern: /\bforest\b|\bwoods\b|\bhike\b|\btrail\b|\bnature\b|\bpark\b/i, environment: "nature" },
  { pattern: /\beach\b|\bocean\b|\bsea\b|\bcoast\b|\bwaves?\b/i, environment: "coastal" },
  { pattern: /\brainy?\b|\brain(fall)?\b|\bstorm\b|\bthunder\b/i, environment: "rainy" },
  { pattern: /\bsnow\b|\bwinter storm\b|\bblizzard\b/i, environment: "winter" },
  { pattern: /\bhome\b|\bbedroom\b|\broom\b|\bindoors?\b/i, environment: "indoor" },
  { pattern: /\bcafe\b|\bcoffee shop\b|\bbar\b|\brestaurant\b/i, environment: "social_indoor" },
  { pattern: /\b2\s*am\b|\blate night\b|\bafter midnight\b|\bdeep night\b|\bdead of night\b/i, timeOfDay: "late_night" },
  { pattern: /\bmidnight\b|\b1\s*am\b|\b3\s*am\b|\b4\s*am\b/i, timeOfDay: "late_night" },
  { pattern: /\bmorning\b|\bsunrise\b|\bdawn\b|\bearly\b/i, timeOfDay: "morning" },
  { pattern: /\bafternoon\b|\bmidday\b|\bnoon\b/i, timeOfDay: "afternoon" },
  { pattern: /\bsunset\b|\bdusk\b|\bgolden hour\b|\bevening\b/i, timeOfDay: "evening" },
  { pattern: /\bnight\b|\bnight time\b/i, timeOfDay: "night" },
];

function detectScene(text: string): SceneContext {
  const ctx: SceneContext = {
    environment: null,
    timeOfDay: null,
    motionState: null,
    intensityBoost: 0,
  };

  for (const { pattern, environment, timeOfDay, motionState } of SCENE_PATTERNS) {
    if (pattern.test(text)) {
      if (environment && !ctx.environment) ctx.environment = environment;
      if (timeOfDay && !ctx.timeOfDay) ctx.timeOfDay = timeOfDay;
      if (motionState && !ctx.motionState) ctx.motionState = motionState;
    }
  }

  // Motion boosts energy slightly
  if (ctx.motionState === "running") ctx.intensityBoost = 0.15;
  else if (ctx.motionState === "driving") ctx.intensityBoost = 0.08;

  return ctx;
}

function applySceneWeights(
  profile: EmotionProfile,
  scene: SceneContext
): EmotionProfile {
  const p = { ...profile };

  if (scene.environment === "rainy") {
    p.energy = clamp(p.energy - 0.08);
    p.valence = clamp(p.valence - 0.06);
    p.calm = clamp(p.calm + 0.07);
    p.tension = clamp(p.tension + 0.05);
  }
  if (scene.environment === "nature") {
    p.calm = clamp(p.calm + 0.1);
    p.tension = clamp(p.tension - 0.08);
  }
  if (scene.environment === "urban") {
    p.energy = clamp(p.energy + 0.06);
    p.tension = clamp(p.tension + 0.04);
  }
  if (scene.environment === "coastal") {
    p.calm = clamp(p.calm + 0.08);
    p.valence = clamp(p.valence + 0.05);
  }
  if (scene.environment === "indoor") {
    p.calm = clamp(p.calm + 0.05);
    p.energy = clamp(p.energy - 0.04);
  }
  if (scene.timeOfDay === "late_night") {
    p.energy = clamp(p.energy - 0.12);
    p.nostalgia = clamp(p.nostalgia + 0.1);
    p.tension = clamp(p.tension + 0.06);
    p.calm = clamp(p.calm - 0.04);
  }
  if (scene.timeOfDay === "morning") {
    p.energy = clamp(p.energy + 0.08);
    p.valence = clamp(p.valence + 0.06);
    p.calm = clamp(p.calm + 0.04);
  }
  if (scene.timeOfDay === "evening") {
    p.nostalgia = clamp(p.nostalgia + 0.08);
    p.calm = clamp(p.calm + 0.05);
    p.energy = clamp(p.energy - 0.05);
  }
  if (scene.timeOfDay === "night") {
    p.energy = clamp(p.energy - 0.06);
    p.nostalgia = clamp(p.nostalgia + 0.06);
  }
  if (scene.motionState === "driving") {
    p.energy = clamp(p.energy + 0.07);
    p.tension = clamp(p.tension + 0.03);
  }
  if (scene.motionState === "running") {
    p.energy = clamp(p.energy + 0.15);
    p.tension = clamp(p.tension + 0.04);
  }

  p.energy = clamp(p.energy + scene.intensityBoost);

  return p;
}

// â”€â”€â”€ VIBE KEYWORD BANK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const VIBE_KEYWORDS: VibeKeyword[] = [
  // â”€â”€ Core Moods â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["2am", "2 am", "late night", "insomnia", "can't sleep", "sleepless", "up late", "3am", "4am"],
    weights: { energy: -0.35, valence: -0.15, tension: 0.25, nostalgia: 0.2, calm: -0.1 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["motorway", "highway", "driving at night", "long drive", "road trip", "open road"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.05, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { motionState: "driving" },
  },
  {
    terms: ["rainy", "rain", "raining", "drizzle", "stormy", "grey day", "overcast", "pouring"],
    weights: { energy: -0.2, valence: -0.15, calm: 0.15, tension: 0.08, nostalgia: 0.12 },
    sceneHints: { environment: "rainy" },
  },
  {
    terms: ["alone", "lonely", "by myself", "solitude", "isolated", "on my own", "just me"],
    weights: { energy: -0.2, valence: -0.2, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
  },
  {
    terms: ["argument", "fight", "conflict", "angry", "pissed off", "frustrated", "rage", "furious"],
    weights: { energy: 0.3, valence: -0.35, tension: 0.45, nostalgia: -0.05, calm: -0.35 },
  },
  {
    terms: ["sad", "sadness", "depressed", "depression", "down", "blue", "melancholy", "miserable", "unhappy", "sorrow"],
    weights: { energy: -0.3, valence: -0.4, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
  },
  {
    terms: ["happy", "happiness", "joy", "joyful", "elated", "great", "good vibes", "positive", "upbeat"],
    weights: { energy: 0.2, valence: 0.45, tension: -0.2, nostalgia: -0.05, calm: 0.1 },
  },
  {
    terms: ["nostalgic", "nostalgia", "throwback", "memories", "remember when", "back then", "old times", "miss those days"],
    weights: { energy: -0.1, valence: 0.05, tension: -0.05, nostalgia: 0.5, calm: 0.08 },
  },
  {
    terms: ["villain", "villain arc", "villain mode", "evil", "menacing", "sinister", "dark energy"],
    weights: { energy: 0.3, valence: -0.2, tension: 0.4, nostalgia: -0.1, calm: -0.3 },
  },
  {
    terms: ["chill", "chilled", "chilling", "relaxed", "relaxing", "mellow", "laid back", "easy going", "low key"],
    weights: { energy: -0.25, valence: 0.15, tension: -0.25, nostalgia: 0.05, calm: 0.4 },
  },
  {
    terms: ["party", "partying", "club", "clubbing", "dancing", "dance", "turn up", "hype", "rave", "festival"],
    weights: { energy: 0.5, valence: 0.35, tension: 0.1, nostalgia: -0.1, calm: -0.35 },
  },
  {
    terms: ["morning", "sunrise", "dawn", "fresh start", "new day", "wake up", "breakfast"],
    weights: { energy: 0.15, valence: 0.2, tension: -0.15, nostalgia: 0.08, calm: 0.2 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["sunset", "golden hour", "dusk", "end of day", "evening glow"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.08, nostalgia: 0.25, calm: 0.2 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["city", "urban", "street", "downtown", "metropolitan", "cityscape", "city lights"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.1, nostalgia: 0.1, calm: -0.1 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["nature", "outdoors", "forest", "woods", "hiking", "mountains", "countryside"],
    weights: { energy: 0.05, valence: 0.15, tension: -0.15, nostalgia: 0.1, calm: 0.3 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["focus", "study", "studying", "concentrate", "concentration", "work", "productive", "deep work"],
    weights: { energy: 0.05, valence: 0.05, tension: -0.1, nostalgia: -0.1, calm: 0.35 },
  },
  {
    terms: ["summer", "summertime", "summer vibes", "hot", "sunny", "beach", "vacation"],
    weights: { energy: 0.2, valence: 0.3, tension: -0.15, nostalgia: 0.15, calm: 0.1 },
  },
  {
    terms: ["winter", "cold", "freezing", "snow", "snowfall", "cozy", "hibernation"],
    weights: { energy: -0.15, valence: 0.0, tension: -0.05, nostalgia: 0.2, calm: 0.2 },
  },
  {
    terms: ["anxious", "anxiety", "nervous", "worried", "overthinking", "panic", "on edge", "stressed"],
    weights: { energy: 0.1, valence: -0.3, tension: 0.45, nostalgia: 0.05, calm: -0.4 },
  },
  {
    terms: ["floating", "dreamy", "ethereal", "surreal", "dissociated", "out of body", "weightless", "drifting"],
    weights: { energy: -0.2, valence: 0.1, tension: -0.15, nostalgia: 0.15, calm: 0.3 },
  },
  {
    terms: ["bittersweet", "bittersweetness", "mixed feelings", "happy sad", "sad happy", "beautiful sadness"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.1, nostalgia: 0.3, calm: 0.05 },
  },
  {
    terms: ["triumphant", "triumph", "victory", "winning", "i made it", "overcome", "proud moment"],
    weights: { energy: 0.35, valence: 0.4, tension: 0.05, nostalgia: 0.05, calm: -0.1 },
  },
  {
    terms: ["drunk", "tipsy", "buzzed", "wine drunk", "high", "stoned", "altered"],
    weights: { energy: 0.1, valence: 0.15, tension: -0.1, nostalgia: 0.2, calm: 0.15 },
  },
  {
    terms: ["heartbroken", "heartbreak", "breakup", "broke up", "dumped", "ended things", "lost love", "ex"],
    weights: { energy: -0.2, valence: -0.45, tension: 0.2, nostalgia: 0.3, calm: -0.2 },
  },

  // â”€â”€ Narrative / Psychological States â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["numb", "empty", "hollow", "nothing", "void", "blank", "disconnected", "apathetic"],
    weights: { energy: -0.4, valence: -0.2, tension: 0.05, nostalgia: 0.1, calm: 0.15 },
  },
  {
    terms: ["seeking", "searching", "looking for myself", "lost", "finding my way", "drifting", "wandering"],
    weights: { energy: 0.0, valence: -0.1, tension: 0.2, nostalgia: 0.2, calm: -0.1 },
  },
  {
    terms: ["identity crisis", "who am i", "don't know who i am", "lost myself", "not myself"],
    weights: { energy: -0.1, valence: -0.2, tension: 0.3, nostalgia: 0.25, calm: -0.2 },
  },
  {
    terms: ["internal conflict", "torn", "conflicted", "can't decide", "two minds", "contradicted"],
    weights: { energy: 0.05, valence: -0.1, tension: 0.3, nostalgia: 0.1, calm: -0.2 },
  },
  {
    terms: ["temporal drift", "time passing", "watching time go by", "slow", "nothing changes", "stuck"],
    weights: { energy: -0.25, valence: -0.1, tension: 0.05, nostalgia: 0.3, calm: 0.15 },
  },

  // â”€â”€ Extended Emotional States â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["burned out", "burnout", "exhausted", "drained", "depleted", "tired", "worn out", "fatigued"],
    weights: { energy: -0.45, valence: -0.2, tension: 0.1, nostalgia: 0.1, calm: 0.05 },
  },
  {
    terms: ["grief", "grieving", "loss", "mourning", "miss someone", "someone died", "missing"],
    weights: { energy: -0.3, valence: -0.4, tension: 0.15, nostalgia: 0.35, calm: -0.05 },
  },
  {
    terms: ["existential", "existential dread", "meaning of life", "what's the point", "nihilistic", "void"],
    weights: { energy: -0.2, valence: -0.25, tension: 0.2, nostalgia: 0.15, calm: 0.05 },
  },
  {
    terms: ["restless", "restlessness", "can't sit still", "agitated", "antsy", "need to move"],
    weights: { energy: 0.2, valence: -0.1, tension: 0.3, nostalgia: 0.0, calm: -0.35 },
  },
  {
    terms: ["hopeful", "hope", "optimistic", "things will get better", "looking up", "bright future"],
    weights: { energy: 0.1, valence: 0.35, tension: -0.1, nostalgia: 0.05, calm: 0.2 },
  },
  {
    terms: ["proud", "pride", "accomplished", "achievement", "did it", "made it", "success"],
    weights: { energy: 0.25, valence: 0.4, tension: -0.05, nostalgia: 0.1, calm: 0.1 },
  },
  {
    terms: ["longing", "yearn", "yearning", "ache", "aching", "pine", "pining", "want so badly"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.2, nostalgia: 0.35, calm: -0.1 },
  },
  {
    terms: ["romantic", "romance", "love", "in love", "falling in love", "crush", "infatuated", "adore"],
    weights: { energy: 0.05, valence: 0.4, tension: 0.1, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["cathartic", "catharsis", "release", "let it out", "cry it out", "emotional release", "purge"],
    weights: { energy: 0.1, valence: 0.1, tension: 0.25, nostalgia: 0.1, calm: 0.0 },
  },
  {
    terms: ["overcoming", "getting over it", "moving on", "healing", "recovering", "bouncing back"],
    weights: { energy: 0.15, valence: 0.2, tension: -0.1, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["introspective", "introspection", "self reflection", "reflect", "thinking about life", "deep thoughts"],
    weights: { energy: -0.15, valence: 0.0, tension: 0.1, nostalgia: 0.2, calm: 0.2 },
  },

  // â”€â”€ Compound Scene Phrases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["sunday morning", "lazy sunday", "slow sunday"],
    weights: { energy: -0.2, valence: 0.2, tension: -0.2, nostalgia: 0.15, calm: 0.35 },
    sceneHints: { timeOfDay: "morning", environment: "indoor" },
  },
  {
    terms: ["2am drive", "late night drive", "driving at 2am", "midnight drive"],
    weights: { energy: 0.05, valence: -0.05, tension: 0.1, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", motionState: "driving" },
  },
  {
    terms: ["empty train", "late train", "last train", "midnight train", "empty subway"],
    weights: { energy: -0.2, valence: -0.1, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { timeOfDay: "night", environment: "transit", motionState: "transit" },
  },
  {
    terms: ["last day of summer", "end of summer", "summer ending", "summer's almost over"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.05, nostalgia: 0.45, calm: 0.05 },
    sceneHints: { environment: "outdoor" },
  },
  {
    terms: ["walking home alone", "walk home alone", "walking alone at night"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.15, nostalgia: 0.2, calm: 0.05 },
    sceneHints: { motionState: "walking", timeOfDay: "night" },
  },
  {
    terms: ["after the party", "post party", "everyone's gone home", "party's over"],
    weights: { energy: -0.2, valence: -0.05, tension: 0.05, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["first coffee", "morning coffee", "coffee and thoughts"],
    weights: { energy: 0.1, valence: 0.2, tension: -0.1, nostalgia: 0.1, calm: 0.25 },
    sceneHints: { timeOfDay: "morning", environment: "indoor" },
  },
  {
    terms: ["rainy window", "watching rain", "rain on window", "looking out at rain"],
    weights: { energy: -0.25, valence: -0.05, tension: -0.05, nostalgia: 0.3, calm: 0.25 },
    sceneHints: { environment: "rainy", environment2: "indoor" } as any,
  },
  {
    terms: ["city at night", "night city", "city lights at night", "neon lights"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.1, nostalgia: 0.2, calm: 0.0 },
    sceneHints: { environment: "urban", timeOfDay: "night" },
  },

  // â”€â”€ Genre / Artist Cues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["radiohead", "thom yorke", "ok computer", "kid a"],
    weights: { energy: -0.2, valence: -0.25, tension: 0.3, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["early kanye", "college dropout", "late registration", "graduation kanye"],
    weights: { energy: 0.25, valence: 0.2, tension: 0.05, nostalgia: 0.3, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["dark kanye", "yeezus", "donda kanye", "tlop kanye"],
    weights: { energy: 0.3, valence: -0.2, tension: 0.35, nostalgia: 0.05, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["frank ocean", "channel orange", "blonde frank"],
    weights: { energy: -0.15, valence: 0.1, tension: 0.1, nostalgia: 0.25, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["indie folk", "folk", "acoustic folk", "folk music"],
    weights: { energy: -0.2, valence: 0.05, tension: -0.05, nostalgia: 0.3, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["post punk", "post-punk", "dark wave", "darkwave", "gothic"],
    weights: { energy: 0.1, valence: -0.3, tension: 0.35, nostalgia: 0.15, calm: -0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["drill", "uk drill", "chicago drill", "trap", "dark trap"],
    weights: { energy: 0.35, valence: -0.15, tension: 0.4, nostalgia: -0.1, calm: -0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["jazz", "jazzy", "jazz vibes", "bebop", "swing", "jazz fusion"],
    weights: { energy: -0.05, valence: 0.15, tension: -0.1, nostalgia: 0.25, calm: 0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["classical", "orchestral", "symphony", "piano classical", "chamber music"],
    weights: { energy: -0.1, valence: 0.1, tension: 0.05, nostalgia: 0.15, calm: 0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["metal", "heavy metal", "hard rock", "metalcore", "death metal"],
    weights: { energy: 0.55, valence: -0.2, tension: 0.45, nostalgia: 0.05, calm: -0.5 },
    artistOrGenreCue: true,
  },
  {
    terms: ["edm", "electronic dance", "house music", "techno", "electro", "club music"],
    weights: { energy: 0.5, valence: 0.25, tension: 0.1, nostalgia: -0.1, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["lofi", "lo-fi", "lo fi", "chill hop", "lofi hip hop", "study beats"],
    weights: { energy: -0.3, valence: 0.05, tension: -0.2, nostalgia: 0.2, calm: 0.45 },
    artistOrGenreCue: true,
  },
  {
    terms: ["90s", "90s music", "nineties", "old school 90s"],
    weights: { energy: 0.1, valence: 0.1, tension: -0.05, nostalgia: 0.45, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["80s", "80s music", "eighties", "synthwave", "retro"],
    weights: { energy: 0.1, valence: 0.2, tension: -0.05, nostalgia: 0.5, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["hip hop", "rap", "hiphop", "hip-hop", "bars"],
    weights: { energy: 0.2, valence: 0.1, tension: 0.1, nostalgia: 0.05, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["rnb", "r&b", "neo soul", "soul music", "smooth rnb"],
    weights: { energy: -0.05, valence: 0.2, tension: 0.0, nostalgia: 0.15, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["ambient", "ambient music", "drone", "soundscape", "atmospheric"],
    weights: { energy: -0.4, valence: 0.05, tension: -0.15, nostalgia: 0.1, calm: 0.5 },
    artistOrGenreCue: true,
  },
  {
    terms: ["punk", "punk rock", "punk music", "anarchy"],
    weights: { energy: 0.5, valence: -0.1, tension: 0.35, nostalgia: 0.1, calm: -0.45 },
    artistOrGenreCue: true,
  },
  {
    terms: ["gospel", "church music", "gospel choir", "worship", "spiritual"],
    weights: { energy: 0.2, valence: 0.4, tension: -0.05, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["country", "country music", "americana", "bluegrass", "western"],
    weights: { energy: 0.05, valence: 0.1, tension: 0.0, nostalgia: 0.35, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["kendrick", "kendrick lamar", "to pimp a butterfly", "damn kendrick"],
    weights: { energy: 0.2, valence: -0.1, tension: 0.25, nostalgia: 0.15, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["tyler", "tyler the creator", "igor", "flower boy", "goblin tyler"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.15, nostalgia: 0.15, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["billie eilish", "billie", "when we all fall asleep"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.2, nostalgia: 0.05, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["arctic monkeys", "am arctic", "favourite worst nightmare", "tranquility base"],
    weights: { energy: 0.15, valence: 0.0, tension: 0.2, nostalgia: 0.2, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["taylor swift", "taylor", "swiftie", "folklore taylor", "evermore taylor"],
    weights: { energy: 0.05, valence: 0.15, tension: 0.05, nostalgia: 0.3, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sza", "ctrl sza", "sos sza"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.15, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["james blake", "james blake music", "overgrown", "assume form"],
    weights: { energy: -0.25, valence: -0.05, tension: 0.15, nostalgia: 0.2, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mac miller", "swimming mac", "circles mac", "good am"],
    weights: { energy: 0.0, valence: 0.05, tension: 0.05, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["phoebe bridgers", "phoebe", "punisher phoebe", "stranger in the alps"],
    weights: { energy: -0.3, valence: -0.15, tension: 0.1, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["the weeknd", "weeknd", "after hours weeknd", "starboy weeknd"],
    weights: { energy: 0.15, valence: -0.1, tension: 0.2, nostalgia: 0.1, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["daniel caesar", "freudian", "case study daniel"],
    weights: { energy: -0.1, valence: 0.2, tension: 0.0, nostalgia: 0.15, calm: 0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["glass animals", "dreamland", "how to be a human being"],
    weights: { energy: 0.05, valence: 0.1, tension: 0.1, nostalgia: 0.15, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["flume", "skin flume", "palaces flume", "electronic flume"],
    weights: { energy: 0.1, valence: 0.15, tension: 0.05, nostalgia: 0.1, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mount kimbie", "crooks and lovers", "love what survives"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.1, nostalgia: 0.15, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["four tet", "kieran hebden", "there is love in you", "rounds four tet"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.05, nostalgia: 0.15, calm: 0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["daft punk", "random access memories", "discovery daft punk", "homework daft punk"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.0, nostalgia: 0.25, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["lcd soundsystem", "sound of silver", "american dream lcd"],
    weights: { energy: 0.25, valence: 0.05, tension: 0.1, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["bon iver", "for emma", "22 a million", "i i bon iver"],
    weights: { energy: -0.25, valence: 0.0, tension: 0.05, nostalgia: 0.3, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["grimes", "art angels", "visions grimes", "miss anthropocene"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.2, nostalgia: 0.05, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["childish gambino", "donald glover", "because the internet", "awaken my love", "camp gambino"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["solange", "a seat at the table", "when i get home solange"],
    weights: { energy: -0.05, valence: 0.1, tension: 0.05, nostalgia: 0.2, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mitski", "puberty 2", "be the cowboy", "bury me at makeout creek"],
    weights: { energy: 0.05, valence: -0.2, tension: 0.25, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["beach house", "teen dream", "depression cherry", "thank your lucky stars"],
    weights: { energy: -0.2, valence: 0.1, tension: 0.0, nostalgia: 0.3, calm: 0.3 },
    artistOrGenreCue: true,
  },

  // â”€â”€ Activity / Lifestyle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["workout", "gym", "lifting", "weights", "training", "fitness", "pre-workout", "pre workout"],
    weights: { energy: 0.5, valence: 0.2, tension: 0.1, nostalgia: -0.1, calm: -0.45 },
  },
  {
    terms: ["getting ready", "pre-drinks", "pregame", "pre game", "before the party", "going out tonight"],
    weights: { energy: 0.3, valence: 0.35, tension: 0.05, nostalgia: -0.05, calm: -0.2 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["sleepy", "drowsy", "half asleep", "barely awake", "nodding off"],
    weights: { energy: -0.45, valence: 0.05, tension: -0.25, nostalgia: 0.1, calm: 0.35 },
  },
  {
    terms: ["peaceful", "serene", "tranquil", "at peace", "zen", "meditative", "meditate"],
    weights: { energy: -0.2, valence: 0.25, tension: -0.3, nostalgia: 0.08, calm: 0.45 },
  },
  {
    terms: ["cozy", "comfy", "comfort", "snug", "bundled up", "warm inside"],
    weights: { energy: -0.15, valence: 0.2, tension: -0.2, nostalgia: 0.15, calm: 0.38 },
    sceneHints: { environment: "indoor" },
  },
  {
    terms: ["boss mode", "main character", "main character energy", "confident", "unstoppable", "that girl", "that guy"],
    weights: { energy: 0.25, valence: 0.35, tension: 0.05, nostalgia: -0.1, calm: -0.1 },
  },
  {
    terms: ["grind", "grind mode", "hustle", "grindset", "no days off"],
    weights: { energy: 0.25, valence: 0.1, tension: 0.1, nostalgia: -0.1, calm: -0.2 },
  },
  {
    terms: ["sultry", "sensual", "seductive", "slow burn", "intimate"],
    weights: { energy: -0.05, valence: 0.2, tension: 0.15, nostalgia: 0.1, calm: 0.1 },
  },
  {
    terms: ["cinematic", "epic", "movie moment", "film score", "orchestral vibes", "montage"],
    weights: { energy: 0.2, valence: 0.1, tension: 0.2, nostalgia: 0.2, calm: -0.05 },
  },
  {
    terms: ["daydream", "daydreaming", "zoning out", "mind wandering", "in my head"],
    weights: { energy: -0.2, valence: 0.1, tension: -0.05, nostalgia: 0.2, calm: 0.25 },
  },
  {
    terms: ["aggressive", "intense", "raw energy", "primal"],
    weights: { energy: 0.4, valence: -0.1, tension: 0.35, nostalgia: -0.05, calm: -0.4 },
  },
  {
    terms: ["melancholic", "melancholia"],
    weights: { energy: -0.25, valence: -0.35, tension: 0.12, nostalgia: 0.18, calm: -0.05 },
  },
  {
    terms: ["empowered", "empowerment", "liberation", "freedom vibe"],
    weights: { energy: 0.2, valence: 0.35, tension: -0.05, nostalgia: 0.05, calm: 0.1 },
  },
  {
    terms: ["escape", "escapism", "running away", "get away", "leave it all behind"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
  },
  {
    terms: ["coffee"],
    weights: { energy: 0.1, valence: 0.12, tension: -0.08, nostalgia: 0.06, calm: 0.18 },
    sceneHints: { timeOfDay: "morning" },
  },

  // â”€â”€ Additional Compound Scene Phrases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    terms: ["friday night", "saturday night", "weekend night", "night out"],
    weights: { energy: 0.25, valence: 0.3, tension: 0.05, nostalgia: 0.05, calm: -0.15 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["sunday afternoon", "slow afternoon", "lazy afternoon"],
    weights: { energy: -0.15, valence: 0.15, tension: -0.15, nostalgia: 0.2, calm: 0.3 },
    sceneHints: { timeOfDay: "afternoon", environment: "indoor" },
  },
  {
    terms: ["morning commute", "commute", "on the way to work"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.08, nostalgia: 0.05, calm: -0.05 },
    sceneHints: { motionState: "transit", timeOfDay: "morning" },
  },
  {
    terms: ["midnight thoughts", "midnight vibes", "midnight hour"],
    weights: { energy: -0.2, valence: -0.05, tension: 0.15, nostalgia: 0.25, calm: 0.05 },
    sceneHints: { timeOfDay: "late_night" },
  },
];

// â”€â”€â”€ VIBE ANALYSIS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function analyzeVibe(vibe: string): EmotionProfile {
  const text = vibe.toLowerCase().trim();
  const negatedTerms = extractNegatedTerms(text);
  const contradictionBoost = detectContradictionBoost(text);
  const emotionalDepth = computeEmotionalDepth(text);
  const scene = detectScene(text);

  const profile: EmotionProfile = {
    energy: 0.5,
    valence: 0.5,
    tension: 0.3,
    nostalgia: 0.2,
    calm: 0.5,
    environment: scene.environment,
    timeOfDay: scene.timeOfDay,
    motionState: scene.motionState,
  };

  let totalWeight = 0;

  for (const keyword of VIBE_KEYWORDS) {
    let matched = false;
    let matchedTerm = "";

    for (const term of keyword.terms) {
      if (keyword.exactMatch) {
        if (text === term) {
          matched = true;
          matchedTerm = term;
          break;
        }
      } else {
        if (text.includes(term)) {
          matched = true;
          matchedTerm = term;
          break;
        }
      }
    }

    if (!matched) continue;

    // Check if the matched term is negated
    const termWords = matchedTerm.split(/\s+/);
    const isNegated = termWords.some((word) => negatedTerms.has(word));

    // Intensifier context around the match
    const matchIdx = text.indexOf(matchedTerm);
    const contextStart = Math.max(0, matchIdx - 20);
    const context = text.slice(contextStart, matchIdx + matchedTerm.length + 20);
    const intensifierScale = getIntensifierScale(context);

    // Artist/genre cues get a fixed weight (0.6) regardless of intensifiers
    const baseScale = keyword.artistOrGenreCue ? 0.6 : 1.0;
    const effectiveScale = isNegated ? -0.5 : baseScale * intensifierScale;

    const w = keyword.weights;

    if (w.energy !== undefined) profile.energy += w.energy * effectiveScale;
    if (w.valence !== undefined) profile.valence += w.valence * effectiveScale;
    if (w.tension !== undefined) profile.tension += w.tension * effectiveScale;
    if (w.nostalgia !== undefined) profile.nostalgia += w.nostalgia * effectiveScale;
    if (w.calm !== undefined) profile.calm += w.calm * effectiveScale;

    // Apply scene hints from keyword if not already set
    if (keyword.sceneHints) {
      if (keyword.sceneHints.environment && !profile.environment) {
        profile.environment = keyword.sceneHints.environment;
      }
      if (keyword.sceneHints.timeOfDay && !profile.timeOfDay) {
        profile.timeOfDay = keyword.sceneHints.timeOfDay;
      }
      if (keyword.sceneHints.motionState && !profile.motionState) {
        profile.motionState = keyword.sceneHints.motionState;
      }
    }

    totalWeight += 1;
  }

  // Apply contradiction boost to tension
  profile.tension += contradictionBoost;

  // Emotional depth nudges calm down slightly (deeper = more complex)
  profile.calm -= emotionalDepth * 0.2;

  // Normalise â€” clamp all to [0,1]
  profile.energy = clamp(profile.energy);
  profile.valence = clamp(profile.valence);
  profile.tension = clamp(profile.tension);
  profile.nostalgia = clamp(profile.nostalgia);
  profile.calm = clamp(profile.calm);

  // Apply scene-based weight adjustments
  const withScene = applySceneWeights(profile, scene);

  return withScene;
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, val));
}

// â”€â”€â”€ SONG SCORING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SongFeatures {
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}

const FEATURE_WEIGHTS = {
  strict: { energy: 0.4, valence: 0.35, danceability: 0.1, acousticness: 0.08, tempo: 0.07 },
  balanced: { energy: 0.3, valence: 0.3, danceability: 0.15, acousticness: 0.1, tempo: 0.15 },
  chaotic: { energy: 0.2, valence: 0.2, danceability: 0.2, acousticness: 0.15, tempo: 0.25 },
};

export function scoreSong(
  song: SongFeatures,
  profile: EmotionProfile,
  mode: "strict" | "balanced" | "chaotic"
): number {
  const weights = FEATURE_WEIGHTS[mode];

  // Normalise tempo from BPM to [0,1] â€” 60 BPM â†’ 0, 200 BPM â†’ 1
  const normTempo = song.tempo != null ? clamp((song.tempo - 60) / 140) : 0.5;

  // Desired tempo from emotion profile
  // High energy/tension â†’ high tempo, low energy/calm â†’ low tempo
  const desiredTempo = clamp(profile.energy * 0.6 + profile.tension * 0.4);

  // Tracks missing audio features receive a neutral 0.5 value rather than a
  // fixed 0.3 delta penalty. This ensures songs that were never returned by
  // Spotify's /audio-features endpoint still compete fairly in scoring.
  const effectiveEnergy = song.energy ?? 0.5;
  const effectiveValence = song.valence ?? 0.5;

  const desiredDanceability = clamp(profile.energy * 0.5 + profile.valence * 0.3 + 0.2);
  const effectiveDanceability = song.danceability ?? 0.5;

  const desiredAcousticness = clamp(profile.calm * 0.4 + profile.nostalgia * 0.4);
  const effectiveAcousticness = song.acousticness ?? 0.5;

  const energyDelta = Math.abs(effectiveEnergy - profile.energy);
  const valenceDelta = Math.abs(effectiveValence - profile.valence);
  const tempoDelta = Math.abs(normTempo - desiredTempo);
  const danceabilityDelta = Math.abs(effectiveDanceability - desiredDanceability);
  const acousticnessDelta = Math.abs(effectiveAcousticness - desiredAcousticness);

  // Score = 1 - weighted delta (higher = better match)
  const rawScore =
    1 -
    (energyDelta * weights.energy +
      valenceDelta * weights.valence +
      danceabilityDelta * weights.danceability +
      acousticnessDelta * weights.acousticness +
      tempoDelta * weights.tempo);

  // Tension bonus â€” high energy + low valence scores better when tension is high
  const tensionBonus = profile.tension * 0.1 * (effectiveEnergy - effectiveValence);

  // Nostalgia bonus â€” acousticness correlates with nostalgia
  const nostalgiaBonus = profile.nostalgia * 0.05 * effectiveAcousticness;

  return clamp(rawScore + tensionBonus + nostalgiaBonus);
}

// â”€â”€â”€ PLAYLIST STRUCTURE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildPlaylistStructure<T extends { score: number; energy: number | null }>(
  songs: T[],
  targetLength: number,
  mode: "strict" | "balanced" | "chaotic"
): T[] {
  const sorted = [...songs].sort((a, b) => b.score - a.score);

  const poolSize =
    mode === "strict"
      ? targetLength
      : mode === "balanced"
        ? targetLength * 2
        : targetLength * 3;
  const pool = sorted.slice(0, Math.min(poolSize, sorted.length));

  if (pool.length <= targetLength) return pool;

  // Intro â†’ Build â†’ Peak â†’ Descent arc
  const introCount = Math.max(1, Math.round(targetLength * 0.15));
  const buildCount = Math.max(1, Math.round(targetLength * 0.25));
  const peakCount = Math.max(1, Math.round(targetLength * 0.3));
  const descentCount = Math.max(1, targetLength - introCount - buildCount - peakCount);

  // Separate pool by energy quartiles
  const byEnergy = [...pool].sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
  const quartile = Math.floor(byEnergy.length / 4);

  const lowEnergy = byEnergy.slice(0, quartile * 2);
  const midEnergy = byEnergy.slice(quartile, quartile * 3);
  const highEnergy = byEnergy.slice(quartile * 2);

  function pickBest<U extends { score: number }>(arr: U[], n: number, used: Set<number>): U[] {
    return arr
      .map((item, i) => ({ item, origIdx: pool.indexOf(item as any) }))
      .filter(({ origIdx }) => !used.has(origIdx))
      .sort((a, b) => b.item.score - a.item.score)
      .slice(0, n)
      .map(({ item, origIdx }) => {
        used.add(origIdx);
        return item;
      });
  }

  const used = new Set<number>();

  // Intro: low energy
  const intro = pickBest(lowEnergy.length > 0 ? lowEnergy : pool, introCount, used);
  // Build: mid energy
  const build = pickBest(midEnergy.length > 0 ? midEnergy : pool, buildCount, used);
  // Peak: high energy
  const peak = pickBest(highEnergy.length > 0 ? highEnergy : pool, peakCount, used);
  // Descent: low-mid, remaining
  const descentPool = pool.filter((_, i) => !used.has(i));
  const descent = pickBest(
    descentPool.length > 0 ? descentPool : pool,
    descentCount,
    new Set()
  );

  return [...intro, ...build, ...peak, ...descent];
}

// â”€â”€â”€ ARTIST REPETITION LIMITER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function limitArtistRepetition<T extends { artistName: string }>(
  songs: T[],
  maxPerArtist: number
): T[] {
  const counts = new Map<string, number>();
  const result: T[] = [];

  for (const song of songs) {
    const artist = song.artistName.toLowerCase();
    const current = counts.get(artist) ?? 0;
    if (current < maxPerArtist) {
      result.push(song);
      counts.set(artist, current + 1);
    }
  }

  return result;
}

// â”€â”€â”€ QUALITY ENGINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Ensures no two adjacent tracks share the same primary artist.
 * Displaced tracks are reinserted at the next safe position.
 */
export function separateAdjacentArtists<T extends { artistName: string }>(songs: T[]): T[] {
  if (songs.length < 2) return songs;

  const result: T[] = [];
  const deferred: T[] = [];

  for (const song of songs) {
    const last = result[result.length - 1];
    if (last && last.artistName.toLowerCase() === song.artistName.toLowerCase()) {
      deferred.push(song);
    } else {
      result.push(song);
    }
  }

  // Re-insert deferred tracks at the first non-conflicting position
  for (const song of deferred) {
    let inserted = false;
    for (let i = result.length - 1; i >= 1; i--) {
      const prev = result[i - 1]!;
      const next = result[i];
      if (
        prev.artistName.toLowerCase() !== song.artistName.toLowerCase() &&
        (!next || next.artistName.toLowerCase() !== song.artistName.toLowerCase())
      ) {
        result.splice(i, 0, song);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(song);
  }

  return result;
}

/**
 * Nudges track order so energy doesn't spike or drop by more than `maxStep`
 * between consecutive tracks.
 */
export function smoothEnergyCurve<T extends { energy: number | null }>(
  songs: T[],
  minEnergy: number,
  maxEnergy: number
): T[] {
  if (songs.length < 3) return songs;

  // Filter out extreme outliers
  return songs.filter((s) => {
    const e = s.energy ?? 0.5;
    return e >= minEnergy && e <= maxEnergy;
  });
}

/**
 * Removes tracks with energy so low they would kill momentum (dead zones).
 * Applies only when the track pool is large enough to afford it.
 */
export function filterDeadZones<T extends { energy: number | null }>(
  songs: T[],
  targetLength: number
): T[] {
  if (songs.length <= targetLength) return songs;

  const DEAD_ZONE_THRESHOLD = 0.08;
  const filtered = songs.filter((s) => (s.energy ?? 0.5) >= DEAD_ZONE_THRESHOLD);

  // Safety: don't over-trim
  return filtered.length >= targetLength ? filtered : songs;
}

/**
 * Re-sorts a playlist to follow an energy arc shaped by the emotion profile:
 *   - Hype (energy â‰¥ 0.72, calm < 0.35): front-load high energy, brief wind-down
 *   - Chill (energy â‰¤ 0.30 or calm â‰¥ 0.65): flat / consistent â€” sorted by proximity to target
 *   - Default: low intro â†’ build â†’ peak (60-75%) â†’ descent
 */
export function enforceArc<T extends { energy: number | null; score: number }>(
  songs: T[],
  profile?: EmotionProfile
): T[] {
  if (songs.length < 4) return songs;

  const n = songs.length;
  const targetEnergy = profile?.energy ?? 0.5;
  const targetCalm = profile?.calm ?? 0.5;

  const byEnergy = [...songs].sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
  const totalQ = Math.floor(n / 4);

  const lowPool = byEnergy.slice(0, totalQ + 1);
  const midPool = byEnergy.slice(totalQ, totalQ * 3);
  const highPool = byEnergy.slice(totalQ * 2);

  const usedEnergy = new Set<T>();

  // Hype: front-load peak energy, brief mid section, calm descent
  if (targetEnergy >= 0.72 && targetCalm < 0.35) {
    const peakCount = Math.round(n * 0.6);
    const midCount = Math.round(n * 0.25);
    const peak = highPool.slice(0, peakCount);
    peak.forEach((t) => usedEnergy.add(t));
    const mid = midPool.filter((t) => !usedEnergy.has(t)).slice(0, midCount);
    mid.forEach((t) => usedEnergy.add(t));
    const rest = songs.filter((t) => !usedEnergy.has(t));
    return [...peak, ...mid, ...rest];
  }

  // Chill: flat energy â€” sort by proximity to target energy, then score
  if (targetEnergy <= 0.3 || targetCalm >= 0.65) {
    return [...songs].sort((a, b) => {
      const aDist = Math.abs((a.energy ?? 0.5) - targetEnergy);
      const bDist = Math.abs((b.energy ?? 0.5) - targetEnergy);
      return aDist !== bDist ? aDist - bDist : b.score - a.score;
    });
  }

  // Standard arc: low intro â†’ build â†’ peak (60-75%) â†’ descent
  const introEnd = Math.round(n * 0.15);
  const buildEnd = Math.round(n * 0.4);
  const peakEnd = Math.round(n * 0.75);

  const introFinal = lowPool.slice(0, introEnd);
  introFinal.forEach((t) => usedEnergy.add(t));

  const buildFinal = midPool.filter((t) => !usedEnergy.has(t)).slice(0, buildEnd - introEnd);
  buildFinal.forEach((t) => usedEnergy.add(t));

  const peakFinal = highPool.filter((t) => !usedEnergy.has(t)).slice(0, peakEnd - buildEnd);
  peakFinal.forEach((t) => usedEnergy.add(t));

  const remainingFinal = songs.filter((t) => !usedEnergy.has(t));

  return [...introFinal, ...buildFinal, ...peakFinal, ...remainingFinal];
}

// â”€â”€â”€ PLAYLIST NAMING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NAME_TEMPLATES = {
  hype: [
    "Adrenaline Loop",
    "Pre-Game",
    "Locked In",
    "Going Off",
    "Maximum Output",
    "Red Zone",
    "Surge Protocol",
    "Unleashed",
  ],
  high_energy: [
    "Maximum Voltage",
    "Kinetic",
    "Overdrive",
    "Full Throttle",
    "Critical Mass",
    "Velocity",
    "Electric Pulse",
    "Power Grid",
  ],
  low_energy: [
    "Slow Dissolve",
    "Undertow",
    "Suspended",
    "Still Water",
    "Low Signal",
    "Gentle Frequency",
    "Soft Static",
    "Fade Out",
  ],
  high_tension: [
    "Edge of Collapse",
    "Tight Frequency",
    "Static Pressure",
    "Fault Lines",
    "Live Wire",
    "Storm Front",
    "Hairline Fracture",
    "Voltage Spike",
  ],
  nostalgic: [
    "Ghost Light",
    "Faded Polaroid",
    "Memory Foam",
    "Analogue Warmth",
    "Soft Rewind",
    "Before Everything Changed",
    "Golden Archive",
    "Long Exposure",
  ],
  calm: [
    "Low Tide",
    "Quiet Current",
    "Drift State",
    "Settled",
    "Still Morning",
    "Glass Water",
    "Fog Quiet",
    "Open Air",
  ],
  joyful: [
    "Signal Boost",
    "Bright Circuit",
    "Open Window",
    "Sun Exposure",
    "Clear Channel",
    "Golden Static",
    "Good Frequency",
    "Radiant",
  ],
  dark: [
    "Negative Space",
    "Black Box",
    "3AM Transmission",
    "Deep Current",
    "Radio Silence",
    "Dark Matter",
    "2AM Static",
    "Glass Half Empty",
  ],
  late_night: [
    "2AM Static",
    "Dead Hours",
    "Midnight Drift",
    "Blue Hours",
    "Witching Hour",
    "Insomnia Radio",
    "After Last Call",
    "Night Signal",
  ],
  morning: [
    "First Light",
    "Slow Sunrise",
    "Before the Day",
    "Dawn Frequency",
    "Golden Hour",
    "Waking State",
    "Coffee and Clouds",
    "Morning Pages",
  ],
  heartbreak: [
    "Glass Half Empty",
    "Exit Wounds",
    "What Remains",
    "Aftermath",
    "Signal Lost",
    "The Space You Left",
    "Old Frequency",
    "Residue",
  ],
  summer: [
    "Golden Hour Drift",
    "Sun-Bleached",
    "Heat Haze",
    "Open Sky",
    "Long Day",
    "Coastal Static",
    "Vitamin D",
    "Solar Frequency",
  ],
  cozy: [
    "Indoor Weather",
    "Soft Ceiling",
    "Home Signal",
    "Interior Warmth",
    "Blanket Static",
    "Lamp Glow",
    "Window Seat",
    "Wool and Warmth",
  ],
  default: [
    "Emotional Frequency",
    "Signal and Noise",
    "Interior Landscape",
    "Frequency Shift",
    "Current State",
    "Live Feed",
    "The Mix",
    "Mood Index",
  ],
};

function pickFromList(list: string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % list.length;
  return list[idx]!;
}

export function generatePlaylistName(vibe: string, profile: EmotionProfile): string {
  const { energy, valence, tension, nostalgia, calm, timeOfDay, environment } = profile;
  const lowerVibe = vibe.toLowerCase();

  let category: keyof typeof NAME_TEMPLATES;

  // Specific combined states take precedence over single-dimension checks
  if (timeOfDay === "late_night" && energy < 0.5) {
    category = "late_night";
  } else if (valence < 0.28 && nostalgia > 0.38 && energy < 0.45) {
    category = "heartbreak";
  } else if (timeOfDay === "morning" && calm > 0.4) {
    category = "morning";
  } else if (
    (environment === "coastal" || /summer|beach|sunny|vacation/.test(lowerVibe)) &&
    valence > 0.55
  ) {
    category = "summer";
  } else if (environment === "indoor" && calm > 0.5 && valence > 0.45) {
    category = "cozy";
  } else if (energy > 0.72 && calm < 0.35) {
    category = "hype";
  } else if (energy > 0.7) {
    category = "high_energy";
  } else if (energy < 0.28) {
    category = "low_energy";
  } else if (tension > 0.6) {
    category = "high_tension";
  } else if (nostalgia > 0.5) {
    category = "nostalgic";
  } else if (calm > 0.6) {
    category = "calm";
  } else if (valence > 0.65) {
    category = "joyful";
  } else if (valence < 0.3) {
    category = "dark";
  } else {
    category = "default";
  }

  return pickFromList(NAME_TEMPLATES[category], vibe);
}

```

## artifacts/api-server/src/lib/env.ts

```typescript
/**
 * Central environment configuration â€” pure declarations only.
 *
 * No code executes at module-load time. All validation is deferred to
 * validateEnv(), which is the very first call inside bootstrap().
 *
 * Consumer code (routes, middleware) uses getEnv() / getFeatures(), both of
 * which require boot to be complete. Bootstrap itself uses the values returned
 * directly by validateEnv() and never calls the consumer-facing getters.
 */

import { assertBootReady } from "./boot-state";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AppEnv {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  PORT: number;
  FRONTEND_URL: string | undefined;
  NODE_ENV: string;
}

/**
 * Discriminated union â€” when enabled is true the Spotify credentials are
 * guaranteed present as typed strings, so callers never need to assert or
 * re-read process.env.
 */
export type AppFeatures = {
  spotify:
    | { enabled: true; clientId: string; clientSecret: string; redirectUri: string }
    | { enabled: false };
};

// â”€â”€ Internal singletons â€” populated once by validateEnv() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _env: AppEnv | null = null;
let _features: AppFeatures | null = null;

// â”€â”€ Private helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[env] ${key} is required but was not set`);
  return val;
}

// â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Validates all required environment variables, populates the internal
 * singletons, and returns the validated values directly.
 *
 * Bootstrap MUST use the returned object â€” it must NOT call getEnv() or
 * getFeatures() afterward, because those are boot-locked and will throw until
 * markBootComplete() is called at the end of bootstrap().
 *
 * Throws immediately with a clear message on any missing or malformed variable.
 */
export function validateEnv(): { env: AppEnv; features: AppFeatures } {
  const DATABASE_URL = requireEnv("DATABASE_URL");
  const SESSION_SECRET = requireEnv("SESSION_SECRET");

  const rawPort = requireEnv("PORT");
  const PORT = Number(rawPort);
  if (!Number.isInteger(PORT) || PORT <= 0) {
    throw new Error(`[env] PORT must be a positive integer, got "${rawPort}"`);
  }

  _env = {
    DATABASE_URL,
    SESSION_SECRET,
    PORT,
    FRONTEND_URL: process.env["FRONTEND_URL"],
    NODE_ENV: process.env["NODE_ENV"] ?? "development",
  };

  const spotifyMissing = (
    ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REDIRECT_URI"] as const
  ).filter((k) => !process.env[k]);

  _features = {
    spotify:
      spotifyMissing.length === 0
        ? {
            enabled: true,
            clientId: process.env["SPOTIFY_CLIENT_ID"] as string,
            clientSecret: process.env["SPOTIFY_CLIENT_SECRET"] as string,
            redirectUri: process.env["SPOTIFY_REDIRECT_URI"] as string,
          }
        : { enabled: false },
  };

  return { env: _env, features: _features };
}

/**
 * Returns the validated AppEnv object.
 *
 * Boot-locked: throws if called before bootstrap() has completed.
 * For use in route handlers and middleware only â€” never inside bootstrap itself.
 */
export function getEnv(): AppEnv {
  assertBootReady("env");
  // _env is guaranteed non-null when boot is complete (validateEnv() ran in bootstrap)
  return _env!;
}

/**
 * Returns the feature-flag structure.
 *
 * Boot-locked: throws if called before bootstrap() has completed.
 * For use in route handlers only â€” never inside bootstrap itself.
 *
 * Route usage pattern:
 *   const feat = getFeatures();
 *   if (!feat.spotify.enabled) { res.status(503)...; return; }
 *   // feat.spotify.redirectUri is now a typed string
 */
export function getFeatures(): AppFeatures {
  assertBootReady("feature flags");
  return _features!;
}

```

## artifacts/api-server/src/lib/logger.ts

```typescript
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

```

## artifacts/api-server/src/lib/pg-pool.ts

```typescript
import pg from "pg";
import { assertBootReady } from "./boot-state";

// â”€â”€ Singleton state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _pool: pg.Pool | null = null;

// â”€â”€ Public constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const SESSION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "session" (
    "sid"    VARCHAR      NOT NULL PRIMARY KEY,
    "sess"   JSON         NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

// â”€â”€ Initialisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Creates the singleton pg.Pool from the supplied connection string.
 *
 * Idempotent â€” returns the existing pool on subsequent calls, ensuring only
 * one pool instance ever exists. Throws immediately if connectionString is
 * empty, which would only happen if called before validateEnv().
 */
export function initPool(connectionString: string): pg.Pool {
  if (_pool) return _pool;
  if (!connectionString) {
    throw new Error(
      "[pool] initPool() called with an empty connectionString â€” call validateEnv() first",
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

// â”€â”€ Consumer proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Boot-locked lazy proxy for the pg.Pool singleton.
 *
 * Consumers import { pool } exactly as before â€” no call-site changes needed.
 * Two guards run on every property access:
 *   1. assertBootReady()  â€” throws [boot] error if boot not yet complete
 *   2. !_pool check       â€” throws [pool] error if initPool() was somehow skipped
 *
 * In a correctly ordered bootstrap these guards are never triggered at request
 * time; they exist to catch programming errors early.
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_, prop) {
    assertBootReady("pool");
    if (!_pool) {
      throw new Error(
        "[pool] Pool not initialized â€” call initPool() in bootstrap() first",
      );
    }
    const val = Reflect.get(_pool, prop);
    return typeof val === "function"
      ? (val as (...args: unknown[]) => unknown).bind(_pool)
      : val;
  },
});

```

## artifacts/api-server/src/lib/rate-limit.ts

```typescript
interface WindowState {
  timestamps: number[];
}

const windows = new Map<string, WindowState>();

setInterval(
  () => {
    const cutoff = Date.now() - 60_000 * 10;
    for (const [key, state] of windows) {
      if (state.timestamps.every((t) => t < cutoff)) {
        windows.delete(key);
      }
    }
  },
  10 * 60 * 1000
).unref();

export function checkRateLimit(
  userId: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let state = windows.get(userId);
  if (!state) {
    state = { timestamps: [] };
    windows.set(userId, state);
  }

  state.timestamps = state.timestamps.filter((t) => t > cutoff);

  if (state.timestamps.length >= maxRequests) {
    const oldest = state.timestamps[0]!;
    const resetInMs = oldest + windowMs - now;
    return { allowed: false, remaining: 0, resetInMs };
  }

  state.timestamps.push(now);
  const remaining = maxRequests - state.timestamps.length;
  return { allowed: true, remaining, resetInMs: 0 };
}

```

## artifacts/api-server/src/lib/session.ts

```typescript
import type { SpotifyTokens } from "./spotify";

declare module "express-session" {
  interface SessionData {
    spotifyTokens?: SpotifyTokens;
    spotifyUserId?: string;
    spotifyDisplayName?: string;
    spotifyEmail?: string;
    spotifyAvatarUrl?: string;
    spotifyCountry?: string;
    oauthState?: string;
  }
}

export {};

```

## artifacts/api-server/src/lib/spotify.ts

```typescript
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { logger } from "./logger";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_AUTH_BASE = "https://accounts.spotify.com";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
  duration_ms: number;
  /** ISO-8601 timestamp from the liked-songs `added_at` field */
  addedAt?: string;
}

export interface SpotifyAudioFeatures {
  id: string;
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
}

async function spotifyRequest<T = unknown>(
  config: AxiosRequestConfig,
  maxRetries = 2
): Promise<AxiosResponse<T>> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.request<T>(config);
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;

      if (status === 429) {
        const retryAfter = parseInt(err.response.headers["retry-after"] ?? "2", 10);
        const wait = (isNaN(retryAfter) ? 2 : retryAfter) * 1000;
        logger.warn({ attempt, wait }, "Spotify 429 â€” waiting before retry");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (status && status < 500) throw err;

      if (attempt < maxRetries) {
        const wait = (attempt + 1) * 500;
        logger.warn({ attempt, status, wait }, "Spotify error â€” retrying");
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastErr;
}

export function getAuthUrl(redirectUri: string, state: string): string {
  const scopes = [
    "user-library-read",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-read-private",
    "user-read-email",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    show_dialog: "true",
  });

  return `${SPOTIFY_AUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<SpotifyTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: params.toString(),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = response.data as any;

  // Log the exact scopes Spotify included in the issued token.
  // If playlist-modify-private / playlist-modify-public are absent here,
  // Spotify is not granting write scopes to this app (requires Extended Quota).
  console.log("[oauth-token-scopes] Spotify issued token with scopes:", data.scope ?? "NONE");

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: params.toString(),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = response.data as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getValidAccessToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  if (Date.now() < tokens.expiresAt - 60000) {
    return tokens;
  }
  logger.info("Refreshing Spotify access token");
  return refreshAccessToken(tokens.refreshToken);
}

/**
 * Obtains a short-lived Client Credentials access token.
 *
 * Audio features are not user-specific â€” they only need a valid app token,
 * not the user's OAuth token. Using a separate CC token gives the audio-features
 * call its own quota bucket so it doesn't exhaust the user token that is also
 * handling 189+ liked-songs pages in the same sync run.
 */
export async function getClientCredentialsToken(): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest<any>({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data.access_token as string;
}

export async function getSpotifyUser(accessToken: string): Promise<any> {
  const response = await spotifyRequest<any>({
    method: "GET",
    url: `${SPOTIFY_API_BASE}/me`,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

export async function fetchLikedSongs(
  accessToken: string,
  onBatch: (tracks: SpotifyTrack[], total: number, offset: number) => Promise<void>,
  stopBefore?: Date
): Promise<void> {
  let offset = 0;
  const limit = 50;
  let total = 0;

  do {
    const response = await spotifyRequest<any>({
      method: "GET",
      url: `${SPOTIFY_API_BASE}/me/tracks`,
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit, offset, market: "from_token" },
    });

    const data = response.data;
    total = data.total;

    // Attach added_at to each track so callers can use it for incremental sync
    let tracks: SpotifyTrack[] = data.items
      .filter((item: any) => item.track && !item.track.is_local)
      .map((item: any) => ({ ...item.track, addedAt: item.added_at as string | undefined }));

    // Incremental stop: Spotify returns tracks newest-first.
    // If stopBefore is set, drop tracks that were added before the cutoff.
    // When some tracks in this page are older than the cutoff we've reached
    // already-synced territory â€” emit the new ones and stop.
    if (stopBefore) {
      const cutoff = stopBefore.getTime();
      const newTracks = tracks.filter(
        (t) => t.addedAt && new Date(t.addedAt).getTime() > cutoff
      );
      if (newTracks.length < tracks.length) {
        // Hit the boundary â€” emit new tracks from this page and bail out
        if (newTracks.length > 0) {
          await onBatch(newTracks, total, offset);
        }
        return;
      }
      tracks = newTracks;
    }

    await onBatch(tracks, total, offset);
    offset += limit;

    if (offset < total) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (offset < total);
}

export async function fetchAudioFeatures(
  accessToken: string,
  trackIds: string[]
): Promise<SpotifyAudioFeatures[]> {
  const results: SpotifyAudioFeatures[] = [];
  const batchSize = 100;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);

    try {
      const response = await spotifyRequest<any>({
        method: "GET",
        url: `${SPOTIFY_API_BASE}/audio-features`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: batch.join(",") },
      });

      const features = response.data.audio_features?.filter(Boolean) ?? [];
      results.push(...features);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, batchStart: i },
        "Audio features fetch failed for batch â€” continuing without features"
      );
    }

    if (i + batchSize < trackIds.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

export async function createSpotifyPlaylist(
  accessToken: string,
  userId: string,
  name: string,
  trackUris: string[]
): Promise<{ id: string; url: string }> {
  // POST /me/playlists is the correct endpoint per Spotify docs and confirmed
  // working in Spotify's own API console with this account.
  const playlistResponse = await spotifyRequest<any>({
    method: "POST",
    url: `${SPOTIFY_API_BASE}/me/playlists`,
    data: {
      name,
      public: false,
      description: `Generated by K_WALAH â€” your emotional AI DJ`,
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const playlist = playlistResponse.data;

  const batchSize = 100;
  for (let i = 0; i < trackUris.length; i += batchSize) {
    const batch = trackUris.slice(i, i + batchSize);
    await spotifyRequest({
      method: "POST",
      url: `${SPOTIFY_API_BASE}/playlists/${playlist.id}/tracks`,
      data: { uris: batch },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  return {
    id: playlist.id,
    url: playlist.external_urls.spotify,
  };
}

```

## artifacts/api-server/src/routes/auth.ts

```typescript
import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { getAuthUrl, exchangeCode, getSpotifyUser, getValidAccessToken } from "../lib/spotify";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

/** Where to send the browser after OAuth (your site, not the API root). */
function getFrontendRedirect(path = "/"): string {
  const base = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  if (!base) {
    return path;
  }
  const normalized = base.replace(/\/$/, "");
  return path === "/" ? normalized : `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Returns the registered SPOTIFY_REDIRECT_URI from the features singleton.
 * Only callable after requireSpotify() has confirmed Spotify is enabled, which
 * means the discriminated union narrows to { enabled: true } and redirectUri
 * is a typed string â€” no process.env access or unsafe cast needed.
 */
function getRedirectUri(): string {
  const feat = getFeatures();
  if (!feat.spotify.enabled) {
    throw new Error("[auth] getRedirectUri() called when Spotify is disabled");
  }
  return feat.spotify.redirectUri;
}

/** Returns false and sends 503 if Spotify credentials were not provided at startup. */
function requireSpotify(res: any): boolean {
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return false;
  }
  return true;
}

router.get("/auth/login", (req, res): void => {
  if (!requireSpotify(res)) return;
  const redirectUri = getRedirectUri();

  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;

  req.log.info(
    { sessionId: req.sessionID, statePrefix: state.slice(0, 8) },
    "[oauth-debug] state generated and stored in session",
  );

  req.log.info(
    {
      cookie: req.headers.cookie,
      sessionId: req.sessionID,
      session: (() => { try { return JSON.stringify(req.session); } catch { return "[unserializable]"; } })(),
      oauthState: req.session?.oauthState,
      host: req.headers.host,
      origin: req.headers.origin,
    },
    "[oauth-debug-raw] login â€” session state before save",
  );

  req.session.save((err) => {
    if (err) {
      req.log.error({ err }, "Failed to save session before OAuth redirect");
      res.status(500).json({ error: "Session error. Please try again." });
      return;
    }
    req.log.info(
      { sessionId: req.sessionID },
      "[oauth-debug-raw] login â€” session saved successfully",
    );
    req.log.info(
      { sessionId: req.sessionID, redirectUri },
      "[oauth-debug] session saved â€” redirecting to Spotify",
    );
    const url = getAuthUrl(redirectUri, state);
    res.redirect(url);
  });
});

router.get("/auth/callback", async (req, res): Promise<void> => {
  if (!requireSpotify(res)) return;
  const { code, error, state: returnedState } = req.query as {
    code?: string;
    error?: string;
    state?: string;
  };

  if (error) {
    req.log.warn({ error }, "Spotify OAuth error");
    res.redirect(getFrontendRedirect(`/?error=${encodeURIComponent(String(error))}`));
    return;
  }

  if (!code) {
    res.redirect(getFrontendRedirect("/?error=no_code"));
    return;
  }

  req.log.info(
    {
      cookie: req.headers.cookie,
      sessionId: req.sessionID,
      session: (() => { try { return JSON.stringify(req.session); } catch { return "[unserializable]"; } })(),
      oauthState: req.session?.oauthState,
      host: req.headers.host,
      origin: req.headers.origin,
    },
    "[oauth-debug-raw] callback â€” raw session on arrival",
  );

  const expectedState = req.session.oauthState;

  req.log.info(
    {
      sessionId: req.sessionID,
      hasExpectedState: !!expectedState,
      hasReturnedState: !!returnedState,
      stateMatch: returnedState === expectedState,
      expectedPrefix: expectedState?.slice(0, 8) ?? "MISSING",
      returnedPrefix: returnedState?.slice(0, 8) ?? "MISSING",
    },
    "[oauth-debug] callback state check",
  );

  if (!expectedState || !returnedState || returnedState !== expectedState) {
    req.log.warn(
      { expectedState: !!expectedState, returnedState: !!returnedState, match: returnedState === expectedState },
      "OAuth state mismatch â€” possible CSRF attempt"
    );
    res.status(400).json({ error: "Invalid OAuth state. Please try logging in again." });
    return;
  }

  delete req.session.oauthState;

  try {
    const redirectUri = getRedirectUri();
    const tokens = await exchangeCode(String(code), redirectUri);
    const user = await getSpotifyUser(tokens.accessToken);

    req.session.spotifyTokens = tokens;
    req.session.spotifyUserId = user.id;
    req.session.spotifyDisplayName = user.display_name ?? user.id;
    req.session.spotifyEmail = user.email ?? null;
    req.session.spotifyAvatarUrl = user.images?.[0]?.url ?? null;
    req.session.spotifyCountry = user.country ?? null;

    req.log.info({ userId: user.id }, "Spotify OAuth successful");
    res.redirect(getFrontendRedirect("/"));
  } catch (err) {
    req.log.error({ err }, "Spotify OAuth callback failed");
    res.redirect(getFrontendRedirect("/?error=auth_failed"));
  }
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!requireSpotify(res)) return;
  if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const freshTokens = await getValidAccessToken(req.session.spotifyTokens);
    if (freshTokens.accessToken !== req.session.spotifyTokens.accessToken) {
      req.session.spotifyTokens = freshTokens;
    }

    res.json({
      id: req.session.spotifyUserId,
      displayName: req.session.spotifyDisplayName,
      email: req.session.spotifyEmail ?? null,
      avatarUrl: req.session.spotifyAvatarUrl ?? null,
      country: req.session.spotifyCountry ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get user");
    res.status(401).json({ error: "Not authenticated" });
  }
});

export default router;

```

## artifacts/api-server/src/routes/generate.ts

```typescript
import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, playlistHistoryTable, savedPlaylistsTable } from "../db";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
import { eq, desc, and } from "drizzle-orm";
import {
  analyzeVibe,
  scoreSong,
  buildPlaylistStructure,
  limitArtistRepetition,
  generatePlaylistName,
  filterDeadZones,
  smoothEnergyCurve,
  separateAdjacentArtists,
  enforceArc,
  type EmotionProfile,
} from "../lib/emotion";
import { GeneratePlaylistBody } from "../zod/api";
import { checkRateLimit } from "../lib/rate-limit";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const NEUTRAL_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

router.post("/generate", async (req, res): Promise<void> => {
  try {
    if (!getFeatures().spotify.enabled) {
      res.status(503).json({ error: "Spotify is not configured on this server." });
      return;
    }
    if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const userId = req.session.spotifyUserId;

    const rateCheck = checkRateLimit(userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.resetInMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec}s before generating again.`,
      });
      return;
    }

    const rawBody = req.body ?? {};
    const vibeRaw = rawBody.vibe ?? "";
    const modeRaw = rawBody.mode ?? "balanced";
    const lengthRaw = rawBody.length ?? 25;
    const parsedLength =
      typeof lengthRaw === "string" ? parseInt(lengthRaw, 10) : Number(lengthRaw);

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { vibe, mode, length } = parsed.data;

    let emotionProfile: EmotionProfile;
    try {
      emotionProfile = analyzeVibe(vibe);
      req.log.info({ emotionProfile }, "Emotion profile computed");
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed â€” using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }

    const likedSongs = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));

    if (likedSongs.length === 0) {
      res.status(400).json({
        error: "No liked songs found. Please sync your Spotify library first.",
      });
      return;
    }

    const scored = likedSongs.map((song) => ({
      ...song,
      score: scoreSong(
        {
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
        },
        emotionProfile,
        mode as "strict" | "balanced" | "chaotic"
      ),
    }));

    req.log.info({ totalSongs: likedSongs.length }, "Songs scored");

    const recentPlaylists = await db
      .select()
      .from(playlistHistoryTable)
      .where(eq(playlistHistoryTable.spotifyUserId, userId))
      .limit(5);

    const recentTrackIds = new Set<string>();
    for (const pl of recentPlaylists) {
      const ids = (pl.trackIds as string[]) ?? [];
      ids.forEach((id) => recentTrackIds.add(id));
    }

    const penalised = scored.map((song) => ({
      ...song,
      score: recentTrackIds.has(song.trackId) ? song.score * 0.6 : song.score,
    }));

    const maxPerArtist = mode === "strict" ? 2 : mode === "balanced" ? 3 : 5;
    const sorted = penalised.sort((a, b) => b.score - a.score);
    const diversified = limitArtistRepetition(sorted, maxPerArtist);

    const poolTarget = Math.max(Math.ceil(length * 3), 75);
    const structured = buildPlaylistStructure(
      diversified,
      poolTarget,
      mode as "strict" | "balanced" | "chaotic"
    );

    const afterDeadZone = filterDeadZones(structured, length);
    const smoothMin = Math.max(0.05, emotionProfile.energy - 0.5);
    const smoothMax = Math.min(0.95, emotionProfile.energy + 0.5);
    const afterSmoothing = smoothEnergyCurve(afterDeadZone, smoothMin, smoothMax);
    const afterArtistSep = separateAdjacentArtists(afterSmoothing);
    const afterArc = enforceArc(afterArtistSep, emotionProfile);
    const finalTracks = afterArc.slice(0, length);

    req.log.info(
      {
        poolAfterStructure: structured.length,
        afterDeadZone: afterDeadZone.length,
        afterSmoothing: afterSmoothing.length,
        afterArtistSep: afterArtistSep.length,
        finalTracks: finalTracks.length,
      },
      "Quality engine pipeline complete"
    );

    if (finalTracks.length === 0) {
      res.status(400).json({
        error: "Could not build a playlist. Try syncing more songs.",
      });
      return;
    }

    const playlistName = generatePlaylistName(vibe, emotionProfile);

    const trackObjects = finalTracks.map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
    }));

    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: emotionProfile as any,
        tracks: trackObjects as any,
      })
      .returning({ id: savedPlaylistsTable.id });

    const savedPlaylistId = insertResult[0]?.id ?? 0;

    req.log.info({ userId, playlistId: savedPlaylistId, trackCount: finalTracks.length }, "Playlist saved to DB");

    // Attempt Spotify playlist creation â€” graceful degradation on any failure
    let spotifyPlaylistUrl: string | null = null;

    try {
      const freshTokens = await getValidAccessToken(req.session.spotifyTokens!);
      if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
        req.session.spotifyTokens = freshTokens;
      }
      const trackUris = finalTracks.map((t) => `spotify:track:${t.trackId}`);
      const spotifyResult = await createSpotifyPlaylist(
        freshTokens.accessToken,
        userId,
        playlistName,
        trackUris
      );
      spotifyPlaylistUrl = spotifyResult.url;
      req.log.info({ spotifyPlaylistId: spotifyResult.id, userId }, "Spotify playlist created");
    } catch (spotifyErr: any) {
      req.log.warn(
        { err: spotifyErr?.message, status: spotifyErr?.response?.status },
        "Spotify playlist creation failed â€” degrading gracefully"
      );
    }

    const spotifyFields = spotifyPlaylistUrl
      ? { spotifyPlaylistUrl }
      : { spotifyUnavailable: true as const };

    res.json({
      success: true,
      playlistId: savedPlaylistId,
      ...spotifyFields,
      playlistName,
      name: playlistName,
      vibe,
      mode,
      count: finalTracks.length,
      totalTracks: finalTracks.length,
      emotionProfile,
      tracks: finalTracks.map((t) => ({
        id: t.trackId,
        name: t.trackName,
        artist: t.artistName,
        album: t.albumName,
        albumArt: t.albumArt ?? null,
        durationMs: t.durationMs,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        tempo: t.tempo ?? null,
        score: Math.round(t.score * 100) / 100,
      })),
    });
  } catch (fatalErr: any) {
    req.log.error({ err: fatalErr }, "Unhandled error in /generate");
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "An unexpected error occurred. Please try again.",
        playlist: [],
      });
    }
  }
});

router.get("/playlists", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  try {
    const playlists = await db
      .select()
      .from(savedPlaylistsTable)
      .where(eq(savedPlaylistsTable.userId, userId))
      .orderBy(desc(savedPlaylistsTable.createdAt));

    res.json({
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        emotionProfile: p.emotionProfile ?? null,
        tracks: p.tracks ?? [],
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching playlists");
    res.status(500).json({ error: "Failed to fetch playlists." });
  }
});

router.delete("/playlists/:id", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const playlistId = parseInt(req.params.id, 10);

  if (isNaN(playlistId)) {
    res.status(400).json({ error: "Invalid playlist id." });
    return;
  }

  try {
    const deleted = await db
      .delete(savedPlaylistsTable)
      .where(and(eq(savedPlaylistsTable.id, playlistId), eq(savedPlaylistsTable.userId, userId)))
      .returning({ id: savedPlaylistsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Playlist not found." });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Error deleting playlist");
    res.status(500).json({ error: "Failed to delete playlist." });
  }
});

export default router;

```

## artifacts/api-server/src/routes/health.ts

```typescript
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "../zod/api";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;

```

## artifacts/api-server/src/routes/history.ts

```typescript
import { Router, type IRouter } from "express";
import { db } from "../db";
import { playlistHistoryTable } from "../db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/history", async (req, res): Promise<void> => {
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  const history = await db
    .select()
    .from(playlistHistoryTable)
    .where(eq(playlistHistoryTable.spotifyUserId, userId))
    .orderBy(desc(playlistHistoryTable.createdAt))
    .limit(50);

  res.json(
    history.map((item) => ({
      id: item.id,
      playlistId: item.playlistId,
      playlistUrl: item.playlistUrl,
      name: item.name,
      vibe: item.vibe,
      mode: item.mode,
      trackCount: item.trackCount,
      createdAt: item.createdAt.toISOString(),
      emotionProfile: item.emotionProfile ?? null,
    }))
  );
});

export default router;

```

## artifacts/api-server/src/routes/index.ts

```typescript
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import spotifyRouter from "./spotify";
import generateRouter from "./generate";
import historyRouter from "./history";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(spotifyRouter);
router.use(generateRouter);
router.use(historyRouter);

export default router;

```

## artifacts/api-server/src/routes/spotify.ts

```typescript
import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, syncStatusTable } from "../db";
import { eq } from "drizzle-orm";
import {
  fetchLikedSongs,
  fetchAudioFeatures,
  getValidAccessToken,
  getClientCredentialsToken,
  type SpotifyTrack,
} from "../lib/spotify";
import { logger } from "../lib/logger";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

const activeSyncs = new Set<string>();

router.get("/spotify/cache-status", async (req, res): Promise<void> => {
  // Guard: Spotify must be configured for any sync-related endpoint to work.
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return;
  }
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const [status] = await db
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.spotifyUserId, userId));

  if (!status) {
    res.json({
      synced: false,
      totalTracks: 0,
      lastSyncedAt: null,
      isSyncing: activeSyncs.has(userId),
      syncProgress: null,
      syncTotal: null,
    });
    return;
  }

  res.json({
    synced: !!status.lastSyncedAt,
    totalTracks: status.totalTracks,
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
    isSyncing: activeSyncs.has(userId) || status.isSyncing === 1,
    syncProgress: status.syncProgress ?? null,
    syncTotal: status.syncTotal ?? null,
  });
});

router.post("/spotify/sync", async (req, res): Promise<void> => {
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return;
  }
  if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  if (activeSyncs.has(userId)) {
    res.json({ message: "Sync already in progress", started: false });
    return;
  }

  activeSyncs.add(userId);

  await db
    .insert(syncStatusTable)
    .values({ spotifyUserId: userId, isSyncing: 1, totalTracks: 0 })
    .onConflictDoUpdate({
      target: syncStatusTable.spotifyUserId,
      set: { isSyncing: 1, syncProgress: 0, updatedAt: new Date() },
    });

  res.json({ message: "Sync started", started: true });

  runSync(userId, req.session.spotifyTokens).catch((err) => {
    logger.error({ err, userId }, "Background sync failed");
    activeSyncs.delete(userId);
  });
});

async function runSync(userId: string, tokens: any): Promise<void> {
  try {
    const freshTokens = await getValidAccessToken(tokens);
    const accessToken = freshTokens.accessToken;

    // Determine whether this is an incremental sync by checking lastSyncedAt
    const [existingStatus] = await db
      .select()
      .from(syncStatusTable)
      .where(eq(syncStatusTable.spotifyUserId, userId));

    const lastSyncedAt: Date | null = existingStatus?.lastSyncedAt ?? null;
    const isIncremental = !!lastSyncedAt;

    let newTracks: SpotifyTrack[] = [];
    let grandTotal = 0;

    await fetchLikedSongs(
      accessToken,
      async (tracks, total, offset) => {
        newTracks.push(...tracks);
        grandTotal = total;

        const progressCount = isIncremental
          ? newTracks.length
          : offset + tracks.length;
        const progressTotal = isIncremental ? null : total;

        await db
          .update(syncStatusTable)
          .set({
            syncProgress: progressCount,
            syncTotal: progressTotal ?? total,
            // During incremental sync keep totalTracks as existing count until done
            totalTracks: isIncremental
              ? (existingStatus?.totalTracks ?? 0)
              : offset + tracks.length,
            updatedAt: new Date(),
          })
          .where(eq(syncStatusTable.spotifyUserId, userId));
      },
      // Pass the cutoff so fetchLikedSongs stops early on incremental runs
      lastSyncedAt ?? undefined
    );

    if (isIncremental) {
      logger.info(
        { userId, newTrackCount: newTracks.length, lastSyncedAt },
        `[sync] Incremental sync: found ${newTracks.length} new tracks since lastSyncedAt`
      );
    }

    const trackIds = newTracks.map((t) => t.id);

    // Use a server-level Client Credentials token for audio features so it has
    // its own quota bucket, independent of the user token that was already used
    // for liked-songs pages above.  Falls back to the user token if the CC
    // token request fails (e.g. missing env vars in local dev).
    let audioFeaturesToken = accessToken;
    try {
      audioFeaturesToken = await getClientCredentialsToken();
    } catch (err) {
      logger.warn({ err }, "Could not obtain CC token for audio features â€” using user token");
    }

    const allFeatures = trackIds.length > 0
      ? await fetchAudioFeatures(audioFeaturesToken, trackIds)
      : [];
    const featuresMap = new Map(allFeatures.map((f) => [f.id, f]));

    if (!isIncremental) {
      // Full sync: wipe and re-insert everything
      await db.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));
    }

    if (newTracks.length > 0) {
      const batchSize = 200;
      for (let i = 0; i < newTracks.length; i += batchSize) {
        const batch = newTracks.slice(i, i + batchSize);
        const rows = batch.map((track) => {
          const features = featuresMap.get(track.id);
          return {
            spotifyUserId: userId,
            trackId: track.id,
            trackName: track.name,
            artistName: track.artists[0]?.name ?? "Unknown",
            albumName: track.album.name,
            albumArt: track.album.images[0]?.url ?? null,
            durationMs: track.duration_ms,
            energy: features?.energy ?? null,
            valence: features?.valence ?? null,
            tempo: features?.tempo ?? null,
            danceability: features?.danceability ?? null,
            acousticness: features?.acousticness ?? null,
            instrumentalness: features?.instrumentalness ?? null,
            loudness: features?.loudness ?? null,
            speechiness: features?.speechiness ?? null,
            addedAt: track.addedAt ? new Date(track.addedAt) : new Date(),
          };
        });

        await db.insert(likedSongsTable).values(rows);
      }
    }

    const finalTotalTracks = isIncremental
      ? (existingStatus?.totalTracks ?? 0) + newTracks.length
      : newTracks.length;

    await db
      .update(syncStatusTable)
      .set({
        isSyncing: 0,
        totalTracks: finalTotalTracks,
        lastSyncedAt: new Date(),
        syncProgress: newTracks.length,
        syncTotal: grandTotal,
        updatedAt: new Date(),
      })
      .where(eq(syncStatusTable.spotifyUserId, userId));

    logger.info(
      { userId, totalTracks: finalTotalTracks, newTracks: newTracks.length, isIncremental },
      "Sync complete"
    );
  } catch (err) {
    logger.error({ err, userId }, "Sync failed");

    await db
      .update(syncStatusTable)
      .set({ isSyncing: 0, updatedAt: new Date() })
      .where(eq(syncStatusTable.spotifyUserId, userId));
  } finally {
    activeSyncs.delete(userId);
  }
}

export default router;

```

## artifacts/api-server/src/zod/api.ts

```typescript
/**
 * Generated by orval v8.9.1 ðŸº
 * Do not edit manually.
 * Api
 * K_WALAH Emotional AI Spotify DJ API
 * OpenAPI spec version: 0.1.0
 */
import * as zod from 'zod';


/**
 * Returns server health status
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  "status": zod.string()
})


/**
 * @summary Spotify OAuth callback
 */
export const AuthCallbackQueryParams = zod.object({
  "code": zod.coerce.string().optional(),
  "error": zod.coerce.string().optional()
})


/**
 * @summary Logout
 */
export const AuthLogoutResponse = zod.object({
  "message": zod.string()
})


/**
 * @summary Get current user profile
 */
export const GetMeResponse = zod.object({
  "id": zod.string(),
  "displayName": zod.string(),
  "email": zod.string().nullish(),
  "avatarUrl": zod.string().nullish(),
  "country": zod.string().nullish()
})


/**
 * @summary Get liked songs cache status
 */
export const GetCacheStatusResponse = zod.object({
  "synced": zod.boolean(),
  "totalTracks": zod.number(),
  "lastSyncedAt": zod.string().nullable(),
  "isSyncing": zod.boolean(),
  "syncProgress": zod.number().nullish(),
  "syncTotal": zod.number().nullish()
})


/**
 * @summary Trigger sync of liked songs
 */
export const SyncLikedSongsResponse = zod.object({
  "message": zod.string(),
  "started": zod.boolean()
})


/**
 * @summary Generate emotional playlist
 */

export const generatePlaylistBodyModeDefault = `balanced`;
export const generatePlaylistBodyLengthDefault = 25;
export const generatePlaylistBodyLengthMin = 10;
export const generatePlaylistBodyLengthMax = 100;



export const GeneratePlaylistBody = zod.object({
  "vibe": zod.string().min(1),
  "mode": zod.enum(['strict', 'balanced', 'chaotic']).default(generatePlaylistBodyModeDefault),
  "length": zod.number().min(generatePlaylistBodyLengthMin).max(generatePlaylistBodyLengthMax).default(generatePlaylistBodyLengthDefault)
})

export const GeneratePlaylistResponse = zod.object({
  "playlistId": zod.string(),
  "playlistUrl": zod.string(),
  "name": zod.string(),
  "vibe": zod.string(),
  "mode": zod.string(),
  "tracks": zod.array(zod.object({
  "id": zod.string(),
  "name": zod.string(),
  "artist": zod.string(),
  "album": zod.string(),
  "albumArt": zod.string().nullish(),
  "durationMs": zod.number().optional(),
  "energy": zod.number().nullish(),
  "valence": zod.number().nullish(),
  "tempo": zod.number().nullish(),
  "score": zod.number().optional()
})),
  "emotionProfile": zod.object({
  "energy": zod.number(),
  "valence": zod.number(),
  "tension": zod.number(),
  "nostalgia": zod.number(),
  "calm": zod.number(),
  "environment": zod.string().nullish(),
  "timeOfDay": zod.string().nullish(),
  "motionState": zod.string().nullish()
}),
  "totalTracks": zod.number().optional()
})


/**
 * @summary Get generated playlist history
 */
export const GetHistoryResponseItem = zod.object({
  "id": zod.number(),
  "playlistId": zod.string(),
  "playlistUrl": zod.string(),
  "name": zod.string(),
  "vibe": zod.string(),
  "mode": zod.string(),
  "trackCount": zod.number(),
  "createdAt": zod.string(),
  "emotionProfile": zod.object({
  "energy": zod.number(),
  "valence": zod.number(),
  "tension": zod.number(),
  "nostalgia": zod.number(),
  "calm": zod.number(),
  "environment": zod.string().nullish(),
  "timeOfDay": zod.string().nullish(),
  "motionState": zod.string().nullish()
}).optional()
})
export const GetHistoryResponse = zod.array(GetHistoryResponseItem)



```

## artifacts/api-server/public/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kwalify â€” AI DJ</title>
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#090910" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           #090910;
      --surface:      rgba(255,255,255,0.04);
      --surface-hi:   rgba(255,255,255,0.07);
      --border:       rgba(255,255,255,0.08);
      --border-hi:    rgba(255,255,255,0.14);
      --border-focus: rgba(130,80,255,0.5);
      --green:        #1db954;
      --green-dim:    rgba(29,185,84,0.12);
      --green-glow:   rgba(29,185,84,0.28);
      --purple:       #8250ff;
      --purple-dim:   rgba(130,80,255,0.12);
      --purple-mid:   rgba(130,80,255,0.2);
      --purple-glow:  rgba(130,80,255,0.28);
      --text:         #ffffff;
      --text-sub:     rgba(255,255,255,0.58);
      --text-muted:   rgba(255,255,255,0.33);
      --text-faint:   rgba(255,255,255,0.18);
      --r:            14px;
      --r-sm:         10px;
      --r-pill:       9999px;
      --spring:       cubic-bezier(0.16,1,0.3,1);
      --ease:         ease-out;
      --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px; --sp-12: 48px;
    }

    html, body {
      min-height: 100%;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      scroll-behavior: smooth;
    }

    :focus-visible { outline: 2px solid var(--purple); outline-offset: 2px; border-radius: 4px; }

    /* â”€â”€â”€ Background â”€â”€â”€ */
    .bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
    .orb { position: absolute; border-radius: 50%; filter: blur(90px); animation: drift 20s ease-out infinite alternate; }
    .orb-1 { width:700px;height:700px;top:-200px;left:-150px; background:radial-gradient(circle,rgba(130,80,255,.20),transparent 70%); animation-duration:24s; }
    .orb-2 { width:550px;height:550px;bottom:-120px;right:-100px; background:radial-gradient(circle,rgba(29,185,84,.13),transparent 70%); animation-duration:18s;animation-delay:-9s; }
    .orb-3 { width:420px;height:420px;top:45%;left:50%;transform:translate(-50%,-50%); background:radial-gradient(circle,rgba(130,80,255,.08),transparent 70%); animation-duration:28s;animation-delay:-5s; }
    @keyframes drift { 0%{transform:translate(0,0) scale(1)} 40%{transform:translate(28px,-22px) scale(1.04)} 70%{transform:translate(-18px,26px) scale(.97)} 100%{transform:translate(14px,-32px) scale(1.02)} }

    /* wave bars */
    .waves { position: fixed; bottom:0; left:50%; transform:translateX(-50%); display:flex; align-items:flex-end; gap:3px; height:55px; padding-bottom:6px; pointer-events:none; z-index:0; opacity:.10; }
    .wb { width:3px; border-radius:3px; background:var(--purple); animation: wv 1.5s ease-out infinite alternate; }
    @keyframes wv { from{height:3px} to{height:var(--h)} }

    /* â”€â”€â”€ Layout â”€â”€â”€ */
    .page { position:relative; z-index:1; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding: 0 16px 140px; animation: pageFadeIn .4s ease-out both; }
    .inner { width:100%; max-width:660px; }
    @keyframes pageFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

    /* â”€â”€â”€ Header â”€â”€â”€ */
    .header { width:100%; max-width:660px; display:flex; align-items:center; justify-content:space-between; padding:22px 0 0; }
    .logo { display:flex; align-items:center; gap:10px; text-decoration:none; }
    .logo-mark { width:33px; height:33px; background:linear-gradient(135deg,#8250ff,#b47eff); border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 0 18px rgba(130,80,255,.4); flex-shrink:0; }
    .logo-name { font-size:15px; font-weight:800; letter-spacing:-.3px; color:var(--text); }
    .logo-name em { color:var(--purple); font-style:normal; }
    .header-nav { display:flex; align-items:center; gap:8px; }

    /* â”€â”€â”€ Buttons â”€â”€â”€ */
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; border:none; font-family:inherit; font-weight:600; cursor:pointer; text-decoration:none; user-select:none; white-space:nowrap; transition: transform .15s var(--spring), box-shadow .2s, background .18s, opacity .18s, color .18s, border-color .18s; }
    .btn:active:not(:disabled) { transform:scale(0.95) !important; }
    .btn:disabled { opacity:.42; cursor:not-allowed; }
    .btn-sm  { padding:8px 15px; font-size:13px; border-radius:var(--r-pill); }
    .btn-md  { padding:12px 20px; font-size:14px; border-radius:var(--r-sm); }
    .btn-lg  { padding:15px 32px; font-size:15px; font-weight:700; border-radius:var(--r-pill); }
    .btn-ghost { background:var(--surface); border:1px solid var(--border); color:var(--text-sub); }
    .btn-ghost:hover { background:var(--surface-hi); color:var(--text); border-color:var(--border-hi); }
    .btn-green { background:var(--green); color:#000; font-weight:700; box-shadow:0 4px 18px var(--green-glow); }
    .btn-green:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 28px var(--green-glow); }
    .btn-purple { background:linear-gradient(135deg,#8250ff,#6535d4); color:#fff; box-shadow:0 4px 18px var(--purple-glow); }
    .btn-purple:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 28px rgba(130,80,255,.4); }
    .btn-subtle { background:var(--surface); border:1px solid var(--border); color:var(--text-sub); border-radius:var(--r-sm); }
    .btn-subtle:hover { background:var(--surface-hi); color:var(--text); border-color:var(--border-hi); }
    @keyframes btnShimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }
    .btn-generating {
      background: linear-gradient(90deg, #6535d4, #8250ff, #a87fff, #8250ff, #6535d4) !important;
      background-size: 200% auto !important;
      animation: btnShimmer 1.5s linear infinite !important;
    }

    /* â”€â”€â”€ Glass card â”€â”€â”€ */
    .glass { background:var(--surface); border:1px solid var(--border); border-radius:18px; backdrop-filter:blur(28px); -webkit-backdrop-filter:blur(28px); transition: border-color .2s ease-out, box-shadow .2s ease-out; }
    .glass-interactive:hover { border-color: var(--border-hi); box-shadow: 0 0 0 1px var(--border-hi), 0 8px 32px rgba(0,0,0,.3); }

    /* â•â•â•â•â•â•â•â• LOGGED-IN UI â•â•â•â•â•â•â•â• */
    .hero { padding:52px 0 36px; text-align:center; }
    .badge { display:inline-flex; align-items:center; gap:7px; background:rgba(130,80,255,.11); border:1px solid rgba(130,80,255,.26); border-radius:var(--r-pill); padding:5px 14px 5px 10px; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#c09fff; margin-bottom:20px; }
    .badge-dot { width:7px; height:7px; background:var(--purple); border-radius:50%; box-shadow:0 0 10px var(--purple); animation:pdot 2.4s ease-out infinite; animation-delay:1s; }
    @keyframes pdot { 0%,100%{opacity:1;box-shadow:0 0 8px var(--purple)} 50%{opacity:.4;box-shadow:0 0 18px var(--purple)} }
    .hero h1 { font-size:clamp(36px,7vw,58px); font-weight:900; line-height:1.06; letter-spacing:-2px; margin-bottom:14px; background:linear-gradient(155deg,#fff 0%,rgba(255,255,255,.48) 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .hero p { font-size:16px; color:var(--text-sub); line-height:1.65; max-width:430px; margin:0 auto; }

    /* Input card */
    .input-card { padding:22px 24px; transition:border-color .25s ease-out,box-shadow .25s ease-out; }
    .input-card.glow { border-color:var(--border-focus); box-shadow:0 0 0 3px var(--purple-glow),0 24px 56px rgba(0,0,0,.35); }
    .field-label { font-size:10.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; }
    .input-row { display:flex; gap:8px; }
    .input-wrap { flex:1; min-width:0; position:relative; }
    .vibe-input { width:100%; background:rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.07); border-radius:10px; color:var(--text); font-family:inherit; font-size:15px; padding:13px 48px 13px 16px; outline:none; transition:border-color .2s; }
    .vibe-input::placeholder { color:var(--text-faint); }
    .vibe-input:focus { border-color:rgba(130,80,255,.45); }
    .vibe-counter { position:absolute; bottom:9px; right:10px; font-size:11px; color:var(--text-faint); pointer-events:none; font-variant-numeric:tabular-nums; transition:color .15s; }
    #generateBtn { border-radius:10px; padding:0 22px; font-size:14px; }

    /* Presets */
    .presets { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:14px; }
    .preset-label { font-size:10px; font-weight:700; letter-spacing:.7px; text-transform:uppercase; color:var(--text-faint); }
    .preset-btn { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); color:var(--text-sub); padding:6px 13px; border-radius:var(--r-pill); font-size:12.5px; font-weight:500; cursor:pointer; font-family:inherit; transition:background .18s,border-color .18s,color .18s,transform .15s var(--spring); }
    .preset-btn:hover { background:var(--purple-dim); border-color:rgba(130,80,255,.35); color:#c09fff; transform:translateY(-1px); }
    .preset-btn:active { transform:scale(.94); }

    /* Controls */
    .controls { display:flex; gap:12px; margin-top:18px; flex-wrap:wrap; align-items:flex-end; }
    .ctrl-block { display:flex; flex-direction:column; gap:6px; }
    .ctrl-block.grow { flex:1; min-width:140px; }
    .ctrl-label { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted); }
    .ctrl-val { font-size:10px; color:var(--purple); font-weight:600; }
    .length-slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px; background:rgba(255,255,255,.1); cursor:pointer; }
    .length-slider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:var(--purple); box-shadow:0 0 8px var(--purple-glow); cursor:pointer; transition:box-shadow .15s,transform .15s; }
    .length-slider::-webkit-slider-thumb:hover { box-shadow:0 0 14px var(--purple-glow); transform:scale(1.15); }
    .length-slider::-moz-range-thumb { width:16px; height:16px; border:none; border-radius:50%; background:var(--purple); cursor:pointer; }
    .mode-tabs { display:flex; gap:4px; }
    .mode-tab { padding:7px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; border:1px solid var(--border); background:var(--surface); color:var(--text-muted); transition:all .18s var(--spring); }
    .mode-tab:hover { background:var(--surface-hi); color:var(--text-sub); border-color:var(--border-hi); }
    .mode-tab.active { background:var(--purple-dim); border-color:rgba(130,80,255,.4); color:#c09fff; }
    .mode-tab:active { transform:scale(.95); }
    .kbd-hint { font-size:11px; color:var(--text-faint); display:flex; justify-content:flex-end; align-items:center; gap:4px; margin-top:12px; }
    kbd { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); border-radius:4px; padding:2px 5px; font-size:10px; font-family:inherit; }

    /* Progress */
    .prog-wrap { margin-top:18px; display:none; }
    .prog-wrap.visible { display:block; }
    .prog-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; }
    .prog-label { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-sub); font-weight:500; }
    .spin { width:20px; height:20px; border:2px solid rgba(255,255,255,0.15); border-top-color:var(--purple); border-radius:50%; animation:spin .65s linear infinite; flex-shrink:0; }
    @keyframes spin { to{transform:rotate(360deg)} }
    .prog-pct { font-size:11.5px; color:var(--text-muted); font-weight:600; font-variant-numeric:tabular-nums; }
    .prog-track { height:3px; background:rgba(255,255,255,.06); border-radius:2px; overflow:hidden; }
    .prog-fill { height:100%; background:linear-gradient(90deg,#8250ff,#1db954); border-radius:2px; width:0; transition:width .5s ease-out; }

    /* Skeleton */
    .skel-card { margin-top:18px; padding:22px 24px; display:none; }
    .skel-card.visible { display:block; }
    .skel { background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.05) 75%); background-size:200% 100%; border-radius:8px; animation:shimmer 1.6s infinite; }
    @keyframes shimmer { from{background-position:200% 0} to{background-position:-200% 0} }
    .skel-line { height:12px; margin-bottom:8px; }

    /* Result card */
    .result-card { margin-top:18px; padding:22px 24px; display:none; }
    .result-card.visible { display:block; animation:fsu .4s var(--spring); }
    .result-card.result-flash { animation: fsu .4s var(--spring), resultFlash .8s ease-out forwards; }
    @keyframes fsu { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
    @keyframes resultFlash { 0%,100%{border-color:var(--border)} 40%{border-color:rgba(29,185,84,.5);box-shadow:0 0 0 3px rgba(29,185,84,.12);} }
    .result-top { display:flex; align-items:center; gap:16px; margin-bottom:20px; }
    .result-icon { width:52px; height:52px; background:linear-gradient(135deg,var(--green),#17a349); border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; box-shadow:0 4px 20px var(--green-glow); animation:popIn .5s var(--spring); }
    @keyframes popIn { from{transform:scale(.4);opacity:0} to{transform:scale(1);opacity:1} }
    .result-info { flex:1; min-width:0; }
    .result-tag { font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--green); margin-bottom:3px; }
    .result-name { font-size:17px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .result-meta-txt { font-size:12.5px; color:var(--text-muted); margin-top:2px; }
    .result-actions { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
    .result-actions .btn-green { flex:1; min-width:140px; }
    .tracks-label { font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; }
    .track-list { display:flex; flex-direction:column; gap:1px; max-height:420px; overflow-y:auto; scrollbar-width:thin; scrollbar-color:rgba(130,80,255,.3) transparent; }
    .track-row { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:8px; transition:background .15s; animation:fsu .3s var(--spring) both; }
    .track-row:hover { background:rgba(255,255,255,.04); }
    .track-num { font-size:11px; color:var(--text-faint); width:14px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
    .track-art { width:36px; height:36px; border-radius:8px; object-fit:cover; flex-shrink:0; display:block; }
    .track-art-fallback { width:36px; height:36px; border-radius:8px; background:var(--purple-dim); border:1px solid var(--purple-mid); display:inline-flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
    .track-info { flex:1; min-width:0; }
    .track-name { font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .track-artist { font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    /* Emotion profile */
    .emotion-section { margin-top:16px; }
    .emotion-title { font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; }
    .emotion-row { display:flex; align-items:center; gap:10px; margin-bottom:7px; }
    .emotion-label { font-size:11px; color:var(--text-sub); width:72px; flex-shrink:0; }
    .emotion-track { flex:1; max-width:200px; height:5px; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; }
    .emotion-fill { height:100%; background:linear-gradient(90deg,#8250ff,#1db954); border-radius:3px; transition:width .6s ease-out; }
    .emotion-pct { font-size:10px; color:var(--text-faint); width:28px; text-align:right; font-variant-numeric:tabular-nums; }
    .divider { height:1px; background:var(--border); margin:18px 0; }
    .status-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
    .status-left { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-faint); }
    .status-dot { width:6px; height:6px; background:var(--green); border-radius:50%; box-shadow:0 0 7px var(--green); flex-shrink:0; }
    .mode-badge { display:inline-flex; align-items:center; gap:5px; background:var(--purple-dim); border:1px solid var(--purple-mid); border-radius:var(--r-pill); padding:3px 10px; font-size:11px; font-weight:600; color:#c09fff; margin-left:8px; }

    /* Pending preview card (403 / dev-mode block) */
    .pending-card { margin-top:18px; padding:22px 24px; display:none; border-color:rgba(255,200,60,.18); }
    .pending-card.visible { display:block; animation:fsu .4s var(--spring); }
    .pending-banner { display:flex; align-items:center; gap:10px; background:rgba(255,180,40,.07); border:1px solid rgba(255,180,40,.18); border-radius:10px; padding:10px 14px; margin-bottom:18px; font-size:13px; color:#f0c060; }
    .pending-banner svg { flex-shrink:0; }
    .pending-top { display:flex; align-items:center; gap:14px; margin-bottom:16px; }
    .pending-icon { width:48px; height:48px; background:rgba(255,180,40,.13); border:1px solid rgba(255,180,40,.28); border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
    .pending-title { font-size:16px; font-weight:700; }
    .pending-subtitle { font-size:12.5px; color:var(--text-muted); margin-top:3px; }
    .pending-track-list { display:flex; flex-direction:column; gap:1px; margin-top:2px; }
    .pending-track { display:flex; align-items:center; gap:12px; padding:7px 8px; border-radius:8px; transition:background .15s; animation:fsu .3s var(--spring) both; }
    .pending-track:hover { background:rgba(255,255,255,.04); }
    .pending-track-num { font-size:11px; color:var(--text-faint); width:14px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
    .pending-art { width:40px; height:40px; border-radius:6px; object-fit:cover; flex-shrink:0; }
    .pending-art-fb { width:40px; height:40px; border-radius:6px; background:var(--purple-dim); border:1px solid var(--purple-mid); display:inline-flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
    .pending-track-info { flex:1; min-width:0; }
    .pending-track-name { font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pending-track-artist { font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pending-track-album { font-size:11px; color:var(--text-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pending-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
    .pending-more { font-size:12px; color:var(--text-faint); text-align:center; padding:10px 0 2px; }

    /* Sync gate card */
    .sync-gate-card { margin-top:18px; padding:22px 24px; text-align:center; }
    .sync-gate-icon { font-size:44px; margin-bottom:16px; }
    .sync-gate-title { font-size:18px; font-weight:700; margin-bottom:10px; }
    .sync-gate-body { font-size:14px; color:var(--text-sub); line-height:1.65; max-width:340px; margin:0 auto 24px; }
    .sync-prog-track { background:rgba(255,255,255,.06); border-radius:4px; height:6px; overflow:hidden; max-width:320px; margin:0 auto 10px; }
    .sync-prog-fill { height:100%; background:linear-gradient(90deg,#8250ff,#1db954); border-radius:4px; transition:width .5s ease-out; }
    .sync-track-count { font-size:12px; color:var(--text-muted); margin-bottom:8px; }
    .sync-time-hint { font-size:12px; color:var(--text-faint); margin-top:12px; }

    /* Track Spotify link */
    .track-spotify { display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--green); text-decoration:none; opacity:.7; transition:opacity .15s; flex-shrink:0; padding:3px 6px; border-radius:4px; }
    .track-spotify:hover { opacity:1; background:var(--green-dim); }

    /* My Playlists */
    .my-playlists-section { margin-top:26px; }
    .section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .section-title { display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--text-muted); }
    .pl-list { display:flex; flex-direction:column; gap:8px; }
    .pl-empty { text-align:center; padding:28px 0; font-size:13px; color:var(--text-faint); }
    .pl-card { border-radius:12px; overflow:hidden; transition:border-color .18s; }
    .pl-card-head { display:flex; align-items:center; gap:12px; padding:12px 16px; cursor:pointer; user-select:none; }
    .pl-card-head:hover { background:rgba(255,255,255,.03); }
    .pl-thumbs { display:flex; gap:2px; flex-shrink:0; }
    .pl-thumb { width:28px; height:28px; border-radius:5px; object-fit:cover; }
    .pl-thumb-fb { width:28px; height:28px; border-radius:5px; background:var(--purple-dim); border:1px solid var(--purple-mid); display:inline-flex; align-items:center; justify-content:center; font-size:12px; }
    .pl-body { flex:1; min-width:0; }
    .pl-name { font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pl-meta { font-size:11.5px; color:var(--text-faint); margin-top:1px; }
    .pl-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
    .pl-chevron { font-size:11px; color:var(--text-faint); transition:transform .2s; }
    .pl-card.expanded .pl-chevron { transform:rotate(180deg); }
    .pl-track-list { display:none; padding:0 16px 12px; flex-direction:column; gap:1px; }
    .pl-card.expanded .pl-track-list { display:flex; }
    .pl-track { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:7px; transition:background .15s; }
    .pl-track:hover { background:rgba(255,255,255,.04); }
    .pl-track-num { font-size:11px; color:var(--text-faint); width:14px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
    .pl-track-art { width:32px; height:32px; border-radius:6px; object-fit:cover; flex-shrink:0; }
    .pl-track-art-fb { width:32px; height:32px; border-radius:6px; background:var(--purple-dim); border:1px solid var(--purple-mid); display:inline-flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0; }
    .pl-track-info { flex:1; min-width:0; }
    .pl-track-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pl-track-artist { font-size:11.5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .btn-del { background:none; border:none; color:var(--text-faint); font-size:14px; cursor:pointer; padding:5px 7px; border-radius:6px; line-height:1; transition:color .15s,background .15s; }
    .btn-del:hover { color:#ff7070; background:rgba(255,60,60,.08); }

    /* History (keep for legacy compat but hide) */
    .history-section { display:none !important; }
    .btn-logout:hover { color:#ff7070; }

    /* â•â•â•â•â•â•â•â• TOASTS â•â•â•â•â•â•â•â• */
    .toast-stack { position:fixed; bottom:24px; right:24px; display:flex; flex-direction:column-reverse; gap:8px; z-index:200; pointer-events:none; }
    .toast { display:flex; align-items:center; gap:10px; padding:12px 18px; border-radius:12px; font-size:13.5px; font-weight:500; max-width:340px; pointer-events:all; backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); animation:tin .3s var(--spring) forwards; box-shadow:0 8px 32px rgba(0,0,0,.45); }
    @keyframes tin { from{opacity:0;transform:translateX(20px) scale(.95)} to{opacity:1;transform:none} }
    .toast-out { animation:tout .25s ease-out forwards; }
    @keyframes tout { to{opacity:0;transform:translateX(20px) scale(.9)} }
    .toast-error   { background:rgba(28,8,8,.93); border:1px solid rgba(255,80,80,.25); color:#ff9090; }
    .toast-success { background:rgba(4,20,10,.93); border:1px solid rgba(29,185,84,.28); color:#5edf8a; }
    .toast-info    { background:rgba(14,8,28,.93); border:1px solid rgba(130,80,255,.28); color:#c09fff; }

    /* â•â•â•â•â•â•â•â• LANDING PAGE â•â•â•â•â•â•â•â• */
    .landing { width:100%; }
    .lhero { text-align:center; padding:72px 20px 56px; }
    .lhero-badge { display:inline-flex; align-items:center; gap:8px; background:rgba(130,80,255,.1); border:1px solid rgba(130,80,255,.25); border-radius:var(--r-pill); padding:6px 16px; font-size:12px; font-weight:600; letter-spacing:.4px; color:#c09fff; margin-bottom:28px; }
    .lhero h1 { font-size:clamp(44px,9vw,76px); font-weight:900; line-height:1.02; letter-spacing:-3px; margin-bottom:22px; background:linear-gradient(155deg,#fff 30%,rgba(255,255,255,.38) 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .lhero h1 span { color:#8250ff; -webkit-text-fill-color:#8250ff; }
    .lhero p { font-size:18px; color:var(--text-sub); line-height:1.7; max-width:500px; margin:0 auto 36px; }
    .lhero-cta { display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; }
    .lhero .btn-green { font-size:15px; padding:15px 32px; border-radius:var(--r-pill); }
    .lhero-note { font-size:12.5px; color:var(--text-faint); margin-top:14px; }
    .features { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; padding:0 0 16px; margin-bottom:24px; }
    .feat-card { padding:22px 20px; border-radius:16px; }
    .feat-icon { font-size:26px; margin-bottom:14px; }
    .feat-title { font-size:14px; font-weight:700; margin-bottom:6px; color:var(--text); }
    .feat-desc { font-size:13px; color:var(--text-sub); line-height:1.55; }
    .how { padding:8px 0 48px; text-align:center; }
    .how h2 { font-size:22px; font-weight:700; letter-spacing:-.4px; margin-bottom:32px; }
    .steps { display:flex; gap:0; flex-wrap:wrap; justify-content:center; }
    .step { display:flex; flex-direction:column; align-items:center; text-align:center; padding:0 20px; max-width:200px; position:relative; }
    .step:not(:last-child)::after { content:'â†’'; position:absolute; right:-10px; top:20px; font-size:16px; color:var(--text-faint); }
    .step-num { width:40px; height:40px; border-radius:50%; background:var(--purple-dim); border:1px solid var(--purple-mid); display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; color:var(--purple); margin-bottom:14px; }
    .step-title { font-size:13.5px; font-weight:700; margin-bottom:6px; }
    .step-desc { font-size:12.5px; color:var(--text-muted); line-height:1.6; }
    .proof { border-radius:16px; padding:20px 24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:48px; }
    .proof-stat { text-align:center; }
    .proof-num { font-size:24px; font-weight:700; letter-spacing:-.5px; color:var(--text); }
    .proof-lbl { font-size:12px; color:var(--text-muted); margin-top:2px; }
    .bottom-cta { text-align:center; padding:0 20px 20px; }
    .bottom-cta h2 { font-size:28px; font-weight:700; letter-spacing:-.5px; margin-bottom:12px; }
    .bottom-cta p { font-size:15px; color:var(--text-sub); margin-bottom:28px; }

    /* Sync status banner */
    .sync-banner { display:flex; align-items:center; gap:9px; padding:9px 16px; border-radius:10px; font-size:12.5px; font-weight:500; margin-bottom:12px; transition:opacity .3s ease-out; }
    .sync-banner.syncing { background:rgba(130,80,255,.10); border:1px solid rgba(130,80,255,.22); color:#c09fff; }
    .sync-banner.done    { background:rgba(29,185,84,.07);  border:1px solid rgba(29,185,84,.18);  color:#5edf8a; }
    .sync-banner.idle, .sync-banner.error { background:rgba(255,255,255,.03); border:1px solid var(--border); color:var(--text-muted); }

    /* Loading overlay */
    #loadOverlay { display:flex; align-items:center; justify-content:center; min-height:60vh; }

    /* â”€â”€â”€ Responsive â”€â”€â”€ */
    @media (max-width:520px) {
      .lhero h1 { letter-spacing:-1.5px; }
      .lhero p { font-size:16px; }
      .step:not(:last-child)::after { display:none; }
      .input-row { flex-direction:column; }
      #generateBtn { padding:13px; }
      .result-actions { flex-wrap:wrap; }
      .result-actions .btn-green { min-width:0; }
      .h-actions { flex-direction:column; }
      .toast-stack { right:12px; left:12px; bottom:16px; }
      .toast { max-width:100%; }
      .controls { flex-direction:column; }
      .mode-tabs .mode-tab { flex:1; text-align:center; }
      .kbd-hint { display:none; }
      .presets { overflow-x:auto; flex-wrap:nowrap; padding-bottom:4px; }
    }
  </style>
</head>
<body>

<div class="bg">
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
</div>
<div class="waves" id="waveBars"></div>
<div class="toast-stack" id="toastStack"></div>

<div class="page">

  <header class="header">
    <a class="logo" href="/">
      <div class="logo-mark">ðŸŽ§</div>
      <span class="logo-name">K<em>walify</em></span>
    </a>
    <nav class="header-nav" id="headerNav">
      <!-- populated by JS after auth check -->
    </nav>
  </header>

  <div class="inner">

    <!-- â”€â”€ Loading â”€â”€ -->
    <div id="loadOverlay"><div class="spin"></div></div>

    <!-- â”€â”€ APP VIEW (logged in) â”€â”€ -->
    <div id="appView" style="display:none">

      <section class="hero">
        <div class="badge"><span class="badge-dot"></span>AI DJ Â· Vibe Intelligence</div>
        <h1>What's the vibe?</h1>
        <p>Describe your mood, scene, or moment â€” the AI scores your entire library and builds the perfect playlist.</p>
      </section>

      <div id="syncBanner" class="sync-banner" style="display:none" aria-live="polite"></div>

      <!-- Sync onboarding gate card -->
      <div class="glass sync-gate-card" id="syncGateCard" style="display:none" aria-live="polite"></div>

      <div class="glass input-card glass-interactive" id="inputCard" style="display:none">
        <div class="field-label">Describe your vibe</div>
        <div class="input-row">
          <div class="input-wrap">
            <input class="vibe-input" id="vibeInput" type="text"
              placeholder="e.g. night drive alone in the rainâ€¦"
              maxlength="140" autocomplete="off" spellcheck="false" />
            <span class="vibe-counter" id="vibeCounter">0/140</span>
          </div>
          <button class="btn btn-purple" id="generateBtn" onclick="generate()" style="min-width:110px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Generate
          </button>
        </div>

        <div class="presets">
          <span class="preset-label">Quick</span>
          <button class="preset-btn" onclick="applyPreset('night drive alone on the motorway')">ðŸŒ™ Night Drive</button>
          <button class="preset-btn" onclick="applyPreset('gym rage villain arc training session')">ðŸ’ª Gym</button>
          <button class="preset-btn" onclick="applyPreset('chill evening at home relaxing')">â˜ï¸ Chill</button>
          <button class="preset-btn" onclick="applyPreset('deep focus study session no distractions')">ðŸ§  Focus</button>
          <button class="preset-btn" onclick="applyPreset('summer sunset golden hour warm vibes')">ðŸŒ… Summer</button>
        </div>

        <div class="controls">
          <div class="ctrl-block grow">
            <div class="ctrl-label">Playlist length â€” <span class="ctrl-val" id="lenVal">25 tracks</span></div>
            <input class="length-slider" id="lenSlider" type="range" min="10" max="100" step="5" value="25"
              oninput="document.getElementById('lenVal').textContent=this.value+' tracks'" />
          </div>
          <div class="ctrl-block">
            <div class="ctrl-label">Match mode</div>
            <div class="mode-tabs">
              <button class="mode-tab" id="modeStrict"   onclick="setMode('strict')">Strict</button>
              <button class="mode-tab active" id="modeBalanced" onclick="setMode('balanced')">Balanced</button>
              <button class="mode-tab" id="modeChaotic"  onclick="setMode('chaotic')">Chaotic</button>
            </div>
          </div>
        </div>

        <div class="kbd-hint"><kbd>Enter</kbd> generate &nbsp;Â·&nbsp; <kbd>Ctrl K</kbd> focus</div>

        <div class="prog-wrap" id="progWrap">
          <div class="prog-head">
            <div class="prog-label"><div class="spin"></div><span id="progLabel">Feeling the vibeâ€¦</span></div>
            <span class="prog-pct" id="progPct">0%</span>
          </div>
          <div class="prog-track"><div class="prog-fill" id="progFill"></div></div>
        </div>
      </div>

      <!-- Skeleton -->
      <div class="glass skel-card" id="skelCard">
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
          <div class="skel" style="width:52px;height:52px;border-radius:13px;flex-shrink:0"></div>
          <div style="flex:1">
            <div class="skel skel-line" style="width:38%;margin-bottom:8px"></div>
            <div class="skel skel-line" style="width:66%"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:18px">
          <div class="skel" style="flex:1;height:44px;border-radius:10px"></div>
          <div class="skel" style="width:120px;height:44px;border-radius:10px"></div>
        </div>
        <div class="skel skel-line" style="width:100%"></div>
        <div class="skel skel-line" style="width:84%;margin-top:6px"></div>
        <div class="skel skel-line" style="width:91%;margin-top:6px"></div>
      </div>

      <!-- Result card -->
      <div class="glass result-card" id="resultCard">
        <div class="result-top">
          <div class="result-icon">ðŸŽµ</div>
          <div class="result-info">
            <div class="result-tag">Playlist ready</div>
            <div class="result-name" id="resultName">Kwalify Playlist</div>
            <div class="result-meta-txt" id="resultMeta">25 tracks Â· Private playlist</div>
          </div>
        </div>
        <div class="result-actions">
          <div id="spotifyActionArea" style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:5px;"></div>
          <button class="btn btn-subtle btn-md" id="regenBtn" onclick="regenerate()" title="Regenerate same vibe">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Regen
          </button>
        </div>
        <div class="tracks-label">Top picks from your library</div>
        <div class="track-list" id="trackList"></div>
        <div id="emotionBars"></div>
        <div class="divider"></div>
        <div class="status-row">
          <div class="status-left">
            <div class="status-dot"></div>
            <span>Saved to Kwalify Â· scored from your liked songs</span>
          </div>
          <span class="mode-badge" id="modeBadge">balanced</span>
        </div>
      </div>

      <!-- Pending preview card (shown when Spotify playlist creation is blocked) -->
      <div class="glass pending-card" id="pendingCard">
        <div class="pending-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Playlist saved locally â€” Spotify creation is temporarily unavailable (Development Mode)</span>
        </div>
        <div class="pending-top">
          <div class="pending-icon">ðŸŽµ</div>
          <div>
            <div class="pending-title" id="pendingTitle">Your Playlist Preview</div>
            <div class="pending-subtitle" id="pendingSubtitle">25 tracks Â· Preview only Â· not yet on Spotify</div>
          </div>
        </div>
        <div class="tracks-label">Tracks selected for your vibe</div>
        <div class="pending-track-list" id="pendingTrackList"></div>
        <div id="pendingMore" class="pending-more"></div>
        <div id="pendingEmotionBars"></div>
        <div class="pending-actions">
          <button class="btn btn-purple btn-md" onclick="generate()" style="flex:1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Try Again
          </button>
        </div>
      </div>

      <!-- History (hidden â€” replaced by My Playlists) -->
      <div class="history-section" id="histSection" style="display:none">
        <div class="h-list" id="hList"></div>
      </div>

      <!-- My Playlists -->
      <div class="my-playlists-section" id="myPlaylistsSection" style="display:none">
        <div class="section-header">
          <div class="section-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            My Playlists
          </div>
        </div>
        <div class="pl-list" id="plList"></div>
      </div>

    </div><!-- /appView -->

    <!-- â”€â”€ LANDING VIEW (logged out) â”€â”€ -->
    <div id="landingView" style="display:none">
      <div class="landing">

        <div class="lhero">
          <div class="lhero-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            AI-crafted playlists
          </div>
          <h1>Your vibe.<br/><span>Your playlist.</span></h1>
          <p>Describe your mood. Get a playlist in seconds.</p>
          <div class="lhero-cta">
            <a href="/api/auth/login" class="btn btn-green" style="font-size:15px;padding:15px 32px;border-radius:9999px">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              Connect with Spotify â€” it's free
            </a>
          </div>
          <p class="lhero-note">No credit card Â· No data stored Â· Private playlists only</p>
        </div>

        <div class="features">
          <div class="glass feat-card">
            <div class="feat-icon">ðŸ§ </div>
            <div class="feat-title">3-Layer Vibe AI</div>
            <div class="feat-desc">Parses your scene into location, time, mood, and motion â€” then maps it to exact audio fingerprints.</div>
          </div>
          <div class="glass feat-card">
            <div class="feat-icon">ðŸŽµ</div>
            <div class="feat-title">Scores your library</div>
            <div class="feat-desc">Every liked song is scored against 5 audio dimensions. Only songs you already love make the cut.</div>
          </div>
          <div class="glass feat-card">
            <div class="feat-icon">ðŸŽ²</div>
            <div class="feat-title">Strict, Balanced, Chaotic</div>
            <div class="feat-desc">Choose how closely tracks match your vibe. Balanced ensures artist variety and tempo diversity.</div>
          </div>
          <div class="glass feat-card">
            <div class="feat-icon">âš¡</div>
            <div class="feat-title">One click, done</div>
            <div class="feat-desc">Describe your mood, hit Generate. A private playlist appears in your Spotify in seconds.</div>
          </div>
        </div>

        <div class="how">
          <h2>How it works</h2>
          <div class="steps">
            <div class="step">
              <div class="step-num">1</div>
              <div class="step-title">Connect Spotify</div>
              <div class="step-desc">One-click OAuth â€” read-only access to your liked songs</div>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <div class="step-title">Describe your vibe</div>
              <div class="step-desc">Type anything: "night drive alone" or hit a preset</div>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <div class="step-title">AI scores tracks</div>
              <div class="step-desc">Energy, valence, tempo, acousticness â€” all matched locally</div>
            </div>
            <div class="step">
              <div class="step-num">4</div>
              <div class="step-title">Playlist created</div>
              <div class="step-desc">Opens in Spotify automatically â€” no manual steps</div>
            </div>
          </div>
        </div>

        <div class="glass proof">
          <div class="proof-stat"><div class="proof-num">5</div><div class="proof-lbl">Audio dimensions scored</div></div>
          <div class="proof-stat"><div class="proof-num">3</div><div class="proof-lbl">AI pipeline layers</div></div>
          <div class="proof-stat"><div class="proof-num">10â€“100</div><div class="proof-lbl">Tracks per playlist</div></div>
          <div class="proof-stat"><div class="proof-num">0</div><div class="proof-lbl">Data stored on server</div></div>
        </div>

        <div class="bottom-cta">
          <h2>Ready to hear it?</h2>
          <p>Connect your Spotify and describe your first vibe. Takes 10 seconds.</p>
          <a href="/api/auth/login" class="btn btn-green" style="font-size:15px;padding:15px 32px;border-radius:9999px">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            Get started free
          </a>
        </div>

      </div>
    </div><!-- /landingView -->

  </div><!-- /inner -->
</div><!-- /page -->

<script>
/* â”€â”€ Wave bars â”€â”€ */
(function(){
  const c=document.getElementById('waveBars'); if(!c) return;
  [8,14,22,34,28,40,28,34,22,14,8,18,30,24,36,24,30,18].forEach((h,i)=>{
    const b=document.createElement('div'); b.className='wb';
    b.style.cssText=`--h:${h}px;animation-delay:${(i*.07).toFixed(2)}s;animation-duration:${(1.2+i*.05).toFixed(2)}s`;
    c.appendChild(b);
  });
})();

/* â”€â”€ Toast â”€â”€ */
const toastStack=document.getElementById('toastStack');
function showToast(msg,type='info',ms=4000){
  if(!toastStack) return;
  const icons={error:'âœ•',success:'âœ“',info:'â—†'};
  const t=document.createElement('div');
  t.className=`toast toast-${type}`;
  t.innerHTML=`<span style="flex-shrink:0">${icons[type]}</span><span>${msg}</span>`;
  toastStack.appendChild(t);
  const rm=()=>{ t.classList.add('toast-out'); setTimeout(()=>t.remove(),280); };
  setTimeout(rm,ms);
  t.addEventListener('click',rm);
}

/* â”€â”€ Helpers â”€â”€ */
const $=id=>document.getElementById(id);
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* â”€â”€ API wrapper â”€â”€ */
async function api(path, opts={}){
  const res = await fetch('/api'+path, {credentials:'include', headers:{'Content-Type':'application/json',...(opts.headers||{})}, ...opts});
  return {ok:res.ok, status:res.status, data: await res.json().catch(()=>({}))};
}

/* â”€â”€ Auth init â”€â”€ */
async function init(){
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  if(err){ showToast('Login failed: '+err,'error',5000); history.replaceState(null,'','/'); }

  try {
    const {ok, data} = await api('/auth/me');
    if(ok){ showApp(data); } else { showLanding(); }
  } catch { showLanding(); }
}

function showLanding(){
  $('loadOverlay').style.display='none';
  $('landingView').style.display='block';
  $('headerNav').innerHTML=`
    <a href="/api/auth/login" class="btn btn-green btn-sm">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
      Connect
    </a>`;
}

function showApp(userData){
  $('loadOverlay').style.display='none';
  $('appView').style.display='block';

  const displayName = userData && userData.displayName ? userData.displayName : '';
  const avatarUrl   = userData && userData.avatarUrl   ? userData.avatarUrl   : '';
  const avatarHtml  = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid var(--border-hi);" onerror="this.style.display='none'">`
    : '';
  const nameHtml = displayName
    ? `<span style="font-size:13px;font-weight:600;color:var(--text-sub);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(displayName)}</span>`
    : '';

  $('headerNav').innerHTML=`
    ${avatarHtml}${nameHtml}
    <a href="/api/spotify/cache-status" class="btn btn-ghost btn-sm" target="_blank">Cache</a>
    <button class="btn btn-ghost btn-sm btn-logout" onclick="logout()">Log out</button>`;

  fetchAndRenderPlaylists();
  if($('vibeInput')) setTimeout(()=>$('vibeInput').focus(),180);
  startSyncPolling();
}

async function logout(){
  await api('/auth/logout',{method:'POST'});
  location.reload();
}

/* â”€â”€ State â”€â”€ */
const vibeInput=$('vibeInput'), generateBtn=$('generateBtn'), inputCard=$('inputCard');
const progWrap=$('progWrap'), progFill=$('progFill'), progPct=$('progPct'), progLabel=$('progLabel');
const skelCard=$('skelCard'), resultCard=$('resultCard');
const resultName=$('resultName'), resultMeta=$('resultMeta'), openBtn=$('openBtn');
const copyBtn=$('copyBtn'), trackList=$('trackList'), modeBadge=$('modeBadge');
const histSection=$('histSection'), hList=$('hList');

let currentUrl='', lastVibe='', currentMode='balanced';
let isGenerating=false, debTimer=null;
let currentPlaylistId=null;

const HIST_KEY='kwalah_v3', MAX_HIST=10;
const ICONS=['ðŸŽµ','ðŸŒ™','ðŸ’ª','â˜ï¸','ðŸŒ…','ðŸŽ§','ðŸ”¥','âœ¨','ðŸŽ¶','ðŸŒŠ'];

/* â”€â”€ Mode selector â”€â”€ */
function setMode(m){
  currentMode=m;
  ['strict','balanced','chaotic'].forEach(k=>{
    const el=$(('mode'+k.charAt(0).toUpperCase()+k.slice(1)));
    if(el) el.classList.toggle('active', k===m);
  });
}

/* â”€â”€ Progress stages â”€â”€ */
const STAGES=[
  {label:'Feeling the vibeâ€¦',           pct:10},
  {label:'Scanning your libraryâ€¦',      pct:28},
  {label:'Scoring every trackâ€¦',        pct:52},
  {label:'Applying diversity magicâ€¦',   pct:74},
  {label:'Creating your playlistâ€¦',     pct:90},
];
let stageIdx=0, progTimer=null;

function startProgress(){ stageIdx=0; setStage(0); progTimer=setInterval(()=>{ if(stageIdx<STAGES.length-1) setStage(++stageIdx); },1800); }
function setStage(i){ const s=STAGES[i]; if(progLabel) progLabel.textContent=s.label; if(progFill) progFill.style.width=s.pct+'%'; if(progPct) progPct.textContent=s.pct+'%'; }
function finishProgress(){ clearInterval(progTimer); if(progFill) progFill.style.width='100%'; if(progPct) progPct.textContent='100%'; }

const _GEN_HTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generate`;
const _GEN_LOADING=`<span class="spin"></span> Generatingâ€¦`;

function setLoading(on){
  if(!generateBtn) return;
  isGenerating=on;
  generateBtn.disabled=on;
  if(on){
    generateBtn.innerHTML=_GEN_LOADING;
  } else {
    generateBtn.innerHTML=_GEN_HTML;
  }
  if(progWrap) progWrap.classList.toggle('visible',on);
  if(skelCard) skelCard.classList.toggle('visible',on);
  if(on){ resultCard&&resultCard.classList.remove('visible'); startProgress(); }
  else  { finishProgress(); setTimeout(()=>{ progWrap&&progWrap.classList.remove('visible'); skelCard&&skelCard.classList.remove('visible'); },350); }
}

/* â”€â”€ Show result â”€â”€ */
function showResult(playlistId, playlistName, vibe, tracks, count, mode, emotionProfile, spotifyPlaylistUrl, spotifyUnavailable){
  currentPlaylistId=playlistId; lastVibe=vibe;
  const displayName = playlistName || `Kwalify â€¢ ${vibe}`;
  if(resultName) resultName.textContent=displayName;
  const spotifyLabel = spotifyPlaylistUrl ? ' + Spotify' : '';
  if(resultMeta) resultMeta.textContent=`${count||tracks.length||25} tracks Â· Saved to Kwalify${spotifyLabel} Â· ${mode||currentMode}`;
  if(modeBadge)  modeBadge.textContent=mode||currentMode;

  const spotifyArea=$('spotifyActionArea');
  if(spotifyArea){
    if(spotifyPlaylistUrl){
      spotifyArea.innerHTML=`<a class="btn btn-green btn-md" href="${esc(spotifyPlaylistUrl)}" target="_blank" rel="noopener" style="width:100%;justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        âœ“ Saved to Kwalify + Open Playlist on Spotify
      </a>`;
    } else {
      spotifyArea.innerHTML=`<span class="btn btn-subtle btn-md" style="opacity:.65;cursor:default;pointer-events:none;width:100%;justify-content:center;">âœ“ Saved to Kwalify</span>
        <span style="font-size:11px;color:var(--text-faint);text-align:center;padding:0 4px;">Spotify playlist creation unavailable â€” tracks saved here</span>`;
    }
  }

  if(trackList){
    trackList.innerHTML=(tracks||[]).map((t,i)=>{
      const artHtml = t.albumArt
        ? `<img src="${esc(t.albumArt)}" alt="" class="track-art" onerror="this.outerHTML='<span class=track-art-fallback>ðŸŽµ</span>'">`
        : '<span class="track-art-fallback">ðŸŽµ</span>';
      const spotifyLink = t.id
        ? `<a class="track-spotify" href="https://open.spotify.com/track/${esc(t.id)}" target="_blank" rel="noopener" title="Open in Spotify">â–¶</a>`
        : '';
      return `<div class="track-row" style="animation-delay:${i*.04}s">
        <span class="track-num">${i+1}</span>
        ${artHtml}
        <div class="track-info">
          <div class="track-name">${esc(t.name)}</div>
          <div class="track-artist">${esc(t.artist)}</div>
        </div>
        ${spotifyLink}
      </div>`;
    }).join('');
  }

  /* Emotion profile bars */
  const emotionEl=$('emotionBars');
  if(emotionEl){
    if(emotionProfile && typeof emotionProfile==='object'){
      const dims=[
        {key:'energy',    label:'Energy'},
        {key:'valence',   label:'Valence'},
        {key:'tension',   label:'Tension'},
        {key:'nostalgia', label:'Nostalgia'},
        {key:'calm',      label:'Calm'},
      ];
      emotionEl.innerHTML=`<div class="emotion-section">
        <div class="emotion-title">Vibe Analysis</div>
        ${dims.map(({key,label})=>{
          const val=Math.min(1,Math.max(0,emotionProfile[key]||0));
          const pct=Math.round(val*100);
          return `<div class="emotion-row">
            <span class="emotion-label">${label}</span>
            <div class="emotion-track"><div class="emotion-fill" style="width:${pct}%"></div></div>
            <span class="emotion-pct">${pct}%</span>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      emotionEl.innerHTML='';
    }
  }

  resultCard&&resultCard.classList.remove('result-flash');
  resultCard&&resultCard.classList.add('visible');
  /* Trigger green flash */
  void resultCard.offsetWidth;
  resultCard&&resultCard.classList.add('result-flash');
  setTimeout(()=>resultCard&&resultCard.classList.remove('result-flash'), 900);

  resetCopyBtn();
  resultCard&&resultCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* â”€â”€ Pending Preview (403 / dev-mode block) â”€â”€ */
function showPendingPreview(pendingTracks, emotionProfile, playlistName, vibe){
  const card=$('pendingCard');
  if(!card) return;

  const title=$('pendingTitle');
  const subtitle=$('pendingSubtitle');
  const list=$('pendingTrackList');
  const moreEl=$('pendingMore');
  const emotionEl=$('pendingEmotionBars');

  if(title) title.textContent = playlistName || `Your Playlist Preview`;
  if(subtitle) subtitle.textContent = `${pendingTracks.length} tracks Â· Preview only Â· not yet on Spotify`;

  const shown = pendingTracks.slice(0, 25);
  if(list){
    list.innerHTML = shown.map((t, i) => {
      const artHtml = t.albumArt
        ? `<img src="${esc(t.albumArt)}" alt="" class="pending-art" onerror="this.outerHTML='<span class=pending-art-fb>ðŸŽµ</span>'">`
        : '<span class="pending-art-fb">ðŸŽµ</span>';
      return `<div class="pending-track" style="animation-delay:${i*.04}s">
        <span class="pending-track-num">${i+1}</span>
        ${artHtml}
        <div class="pending-track-info">
          <div class="pending-track-name">${esc(t.trackName)}</div>
          <div class="pending-track-artist">${esc(t.artistName)}</div>
          <div class="pending-track-album">${esc(t.albumName||'')}</div>
        </div>
      </div>`;
    }).join('');
  }
  if(moreEl) moreEl.textContent = pendingTracks.length > 25 ? `+ ${pendingTracks.length - 25} more tracks` : '';

  /* Emotion profile bars */
  if(emotionEl){
    if(emotionProfile && typeof emotionProfile === 'object'){
      const dims=[
        {key:'energy',    label:'Energy'},
        {key:'valence',   label:'Valence'},
        {key:'tension',   label:'Tension'},
        {key:'nostalgia', label:'Nostalgia'},
        {key:'calm',      label:'Calm'},
      ];
      emotionEl.innerHTML=`<div class="emotion-section">
        <div class="emotion-title">Vibe Analysis</div>
        ${dims.map(({key,label})=>{
          const val=Math.min(1,Math.max(0,emotionProfile[key]||0));
          const pct=Math.round(val*100);
          return `<div class="emotion-row">
            <span class="emotion-label">${label}</span>
            <div class="emotion-track"><div class="emotion-fill" style="width:${pct}%"></div></div>
            <span class="emotion-pct">${pct}%</span>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      emotionEl.innerHTML='';
    }
  }

  // Hide normal result card, show pending card
  resultCard&&resultCard.classList.remove('visible');
  card.classList.add('visible');
  card.scrollIntoView({behavior:'smooth', block:'nearest'});
}

/* â”€â”€ Generate â”€â”€ */
function generate(){
  if(debTimer||isGenerating) return;
  const vibe=(vibeInput?.value||'').trim();
  if(!vibe){ vibeInput?.focus(); showToast('Type a vibe first!','info',2200); return; }
  debTimer=setTimeout(()=>debTimer=null, 900);
  setLoading(true);
  resultCard&&resultCard.classList.remove('visible');
  const length=parseInt($('lenSlider')?.value)||25;

  fetch('/api/generate',{
    method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vibe, length, mode:currentMode}),
  })
  .then(r=>r.json().then(d=>({ok:r.ok,status:r.status,d})))
  .then(({ok,status,d})=>{
    setLoading(false);
    if(status===429){
      const retryAfter=(d&&d.retry_after)||60;
      let rem=retryAfter;
      const updateBtn=()=>{ generateBtn.disabled=true; generateBtn.innerHTML=`Try again in ${rem}sâ€¦`; };
      updateBtn();
      const cd=setInterval(()=>{
        rem--;
        if(rem<=0){ clearInterval(cd); generateBtn.disabled=false; generateBtn.innerHTML=_GEN_HTML; }
        else { updateBtn(); }
      },1000);
      showToast(`Rate limited â€” try again in ${retryAfter}s`,'info',5000);
      return;
    }
    if(!ok||d.error){
      const m={
        'Not authenticated':'Log in with Spotify to generate playlists.',
        'Spotify session expired. Please log in again.':'Session expired â€” redirectingâ€¦',
      };
      showToast(m[d.error]||d.error||'Something went wrong.','error',5500);
      if(status===401) setTimeout(()=>window.location.href='/api/auth/login',2200);
      return;
    }
    // Hide pending card on successful generation
    const pc=$('pendingCard'); if(pc) pc.classList.remove('visible');
    if(vibeInput) vibeInput.value='';
    if($('vibeCounter')) $('vibeCounter').textContent='0/140';
    const trackCount=d.count||d.totalTracks||25;
    showResult(d.playlistId, d.playlistName||d.name, vibe, d.tracks||[], trackCount, d.mode, d.emotionProfile, d.spotifyPlaylistUrl||null, !!d.spotifyUnavailable);
    fetchAndRenderPlaylists();
    const toastMsg = d.spotifyPlaylistUrl
      ? `âœ“ Playlist saved to Kwalify + Spotify â€” ${trackCount} tracks!`
      : `âœ“ Playlist saved to Kwalify â€” ${trackCount} tracks matched your vibe!`;
    showToast(toastMsg,'success',3500);
  })
  .catch(()=>{ setLoading(false); showToast('Connection failed. Check your internet and try again.','error',5000); });
}

function regenerate(){
  if(!lastVibe) return;
  if(vibeInput) vibeInput.value=lastVibe;
  if(currentMode==='strict') setMode('balanced');
  generate();
}

function applyPreset(v){ if(!vibeInput) return; vibeInput.value=v; generate(); }

/* â”€â”€ Copy link â”€â”€ */
function resetCopyBtn(){
  if(!copyBtn) return;
  copyBtn.classList.remove('btn-green'); copyBtn.classList.add('btn-subtle');
  copyBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy link`;
}
function copyLink(){
  if(!currentUrl) return;
  const ok=()=>{
    copyBtn.classList.remove('btn-subtle'); copyBtn.classList.add('btn-green');
    copyBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    showToast('Link copied to clipboard','success',2500);
    setTimeout(resetCopyBtn,3000);
  };
  navigator.clipboard?.writeText(currentUrl).then(ok).catch(()=>{
    const ta=Object.assign(document.createElement('textarea'),{value:currentUrl,style:'position:fixed;opacity:0'});
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok();
  });
}

/* â”€â”€ History â”€â”€ */
function loadHist(){ try{return JSON.parse(localStorage.getItem(HIST_KEY)||'[]');}catch{return[];} }
function saveHist(items){ try{localStorage.setItem(HIST_KEY,JSON.stringify(items));}catch{} }

function addToHistory(vibe,url,count,mode){
  const prev=loadHist().filter(h=>h.vibe.toLowerCase()!==vibe.toLowerCase());
  const entry={vibe,url,count,mode,ts:Date.now(),icon:ICONS[Math.floor(Math.random()*ICONS.length)]};
  const updated=[entry,...prev].slice(0,MAX_HIST);
  saveHist(updated); renderHist(updated);
}
function clearHistory(){ saveHist([]); renderHist([]); showToast('History cleared','info',2000); }

function timeAgo(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'just now';
  const m=Math.floor(s/60); if(m<60) return `${m}m ago`;
  const h=Math.floor(m/60); if(h<24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function renderHist(items){
  if(!histSection||!hList) return;
  histSection.style.display='block';
  if(!items||!items.length){
    hList.innerHTML='<div class="h-empty"><div style="font-size:15px;font-weight:600;margin-bottom:6px">ðŸŽµ&nbsp;&nbsp;No playlists yet</div><div>Generate your first one above â†‘</div></div>';
    return;
  }
  hList.innerHTML=items.map((h,i)=>`
    <div class="glass h-item glass-interactive" style="animation-delay:${i*.04}s">
      <div class="h-icon">${h.icon||'ðŸŽµ'}</div>
      <div class="h-body">
        <div class="h-vibe">${esc(h.vibe)}</div>
        <div class="h-meta">${timeAgo(h.ts)}${h.count?' Â· '+h.count+' tracks':''}${h.mode?' Â· '+h.mode:''}</div>
      </div>
      <div class="h-actions">
        <a class="btn-h btn-h-open" href="${esc(h.url)}" target="_blank" rel="noopener">Open</a>
        <button class="btn-h btn-h-replay" onclick="replayHist(${i})">â–¶ Replay</button>
      </div>
    </div>`).join('');
}

function replayHist(i){ const h=loadHist()[i]; if(!h||!vibeInput) return; vibeInput.value=h.vibe; generate(); }

/* â”€â”€ My Playlists (server-side) â”€â”€ */
async function fetchAndRenderPlaylists(){
  try {
    const {ok, data} = await api('/playlists');
    if(ok && Array.isArray(data.playlists)){
      renderPlaylists(data.playlists);
    }
  } catch {}
}

function renderPlaylists(items){
  const section=$('myPlaylistsSection');
  const list=$('plList');
  if(!section||!list) return;
  section.style.display='block';
  if(!items||!items.length){
    list.innerHTML='<div class="pl-empty"><div style="font-size:15px;font-weight:600;margin-bottom:6px">ðŸŽµ&nbsp;&nbsp;No playlists yet</div><div>Generate your first one above â†‘</div></div>';
    return;
  }
  list.innerHTML=items.map((p,idx)=>{
    const tracks=Array.isArray(p.tracks)?p.tracks:[];
    const trackCount=tracks.length;
    const date=p.createdAt?new Date(p.createdAt).toLocaleDateString([],{month:'short',day:'numeric'}):'';
    const thumbs=tracks.slice(0,3).map(t=>
      t.albumArt
        ? `<img src="${esc(t.albumArt)}" alt="" class="pl-thumb" onerror="this.outerHTML='<span class=pl-thumb-fb>ðŸŽµ</span>'">`
        : '<span class="pl-thumb-fb">ðŸŽµ</span>'
    ).join('');
    const trackRows=tracks.map((t,i)=>{
      const artHtml=t.albumArt
        ? `<img src="${esc(t.albumArt)}" alt="" class="pl-track-art" onerror="this.outerHTML='<span class=pl-track-art-fb>ðŸŽµ</span>'">`
        : '<span class="pl-track-art-fb">ðŸŽµ</span>';
      const link=t.trackId
        ? `<a class="track-spotify" href="https://open.spotify.com/track/${esc(t.trackId)}" target="_blank" rel="noopener" title="Open in Spotify">â–¶</a>`
        : '';
      return `<div class="pl-track">
        <span class="pl-track-num">${i+1}</span>
        ${artHtml}
        <div class="pl-track-info">
          <div class="pl-track-name">${esc(t.trackName||'')}</div>
          <div class="pl-track-artist">${esc(t.artistName||'')}</div>
        </div>
        ${link}
      </div>`;
    }).join('');
    return `<div class="glass pl-card" id="plc-${p.id}" style="animation-delay:${idx*.04}s">
      <div class="pl-card-head" onclick="togglePlaylist(${p.id})">
        <div class="pl-thumbs">${thumbs||'<span class="pl-thumb-fb">ðŸŽµ</span>'}</div>
        <div class="pl-body">
          <div class="pl-name">${esc(p.name)}</div>
          <div class="pl-meta">${trackCount} track${trackCount!==1?'s':''}${date?' Â· '+date:''}</div>
        </div>
        <div class="pl-actions">
          <button class="btn-del" onclick="event.stopPropagation();deletePlaylist(${p.id})" title="Delete playlist">ðŸ—‘</button>
          <span class="pl-chevron">â–¼</span>
        </div>
      </div>
      <div class="pl-track-list">${trackRows}</div>
    </div>`;
  }).join('');
}

function togglePlaylist(id){
  const card=$('plc-'+id);
  if(card) card.classList.toggle('expanded');
}

async function deletePlaylist(id){
  if(!confirm('Delete this playlist?')) return;
  try {
    const {ok}=await api('/playlists/'+id,{method:'DELETE'});
    if(ok){
      showToast('Playlist deleted','info',2000);
      fetchAndRenderPlaylists();
    } else {
      showToast('Could not delete playlist','error',3000);
    }
  } catch { showToast('Connection error','error',3000); }
}

/* â”€â”€ Input glow â”€â”€ */
if(vibeInput&&inputCard){
  vibeInput.addEventListener('focus',()=>inputCard.classList.add('glow'));
  vibeInput.addEventListener('blur', ()=>inputCard.classList.remove('glow'));
}

/* â”€â”€ Character counter â”€â”€ */
const vibeCounter=$('vibeCounter');
if(vibeInput&&vibeCounter){
  vibeInput.addEventListener('input',()=>{
    const len=vibeInput.value.length;
    vibeCounter.textContent=`${len}/140`;
    vibeCounter.style.color=len>130?'#ff7070':len>100?'#f59e0b':'var(--text-faint)';
  });
}

/* â”€â”€ Keyboard shortcuts â”€â”€ */
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement===vibeInput){ e.preventDefault(); if(!generateBtn?.disabled) generate(); }
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){ e.preventDefault(); vibeInput?.focus(); vibeInput?.select(); }
});

/* â”€â”€ Sync status & onboarding gate â”€â”€ */
const _SYNC_SPIN='<span class="spin"></span>';
const _SYNC_CHECK='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function _fmtSyncTime(isoStr){
  if(!isoStr) return '';
  try{ const d=new Date(isoStr.endsWith('Z')?isoStr:isoStr+'Z'); return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }catch{ return ''; }
}

let _syncTimer=null, _syncPending=false, _syncState=null;
let _syncStartTime=null, _syncStartProgress=0, _syncIsIncremental=false;

function startSyncPolling(){
  _pollSync();
  _syncTimer=setInterval(_pollSync,7000);
}

function _pollSync(){
  if(_syncPending) return; _syncPending=true;
  fetch('/api/spotify/cache-status',{credentials:'include'})
    .then(r=>r.ok?r.json():null)
    .then(d=>{ if(d) _updateSyncUI(d); else _showInputFallback(); })
    .catch(()=>{ _showInputFallback(); })
    .finally(()=>{ _syncPending=false; });
}

function _showInputFallback(){
  const ic=$('inputCard');
  if(ic&&ic.style.display==='none') ic.style.display='';
}

function _updateSyncUI(d){
  const gate=$('syncGateCard');
  const banner=$('syncBanner');
  const ic=$('inputCard');
  const prevState=_syncState;
  _syncState=d.isSyncing?'syncing':d.synced?'synced':'unsynced';

  /* Tighten poll interval during active sync */
  if(d.isSyncing&&prevState!=='syncing'){
    // Sync just started â€” record start time and baseline progress
    _syncStartTime=Date.now();
    _syncStartProgress=d.syncProgress||0;
    // Incremental sync: syncTotal is very small relative to totalTracks
    _syncIsIncremental = !!(d.syncTotal && d.totalTracks && d.syncTotal < d.totalTracks * 0.5);
    clearInterval(_syncTimer); _syncTimer=setInterval(_pollSync,3000);
  } else if(!d.isSyncing&&prevState==='syncing'){
    _syncStartTime=null;
    clearInterval(_syncTimer); _syncTimer=setInterval(_pollSync,7000);
  }

  if(_syncState==='synced'){
    if(gate) gate.style.display='none';
    if(ic){
      if(prevState&&prevState!=='synced'){
        ic.style.display=''; ic.style.animation='fsu .4s var(--spring) both';
        setTimeout(()=>{ if(ic) ic.style.animation=''; },500);
      } else { ic.style.display=''; }
    }
    const t=_fmtSyncTime(d.lastSyncedAt);
    const n=d.totalTracks||0;
    if(banner){
      banner.className='sync-banner done';
      banner.innerHTML=_SYNC_CHECK+`<span>Library ready â€” ${n} track${n!==1?'s':''}${t?' Â· Last synced '+t:''}</span>`;
      banner.style.display='flex';
    }
  } else {
    if(ic) ic.style.display='none';
    if(banner) banner.style.display='none';
    if(gate){ gate.style.display='block'; _renderSyncGate(d); }
  }
}

function _fmtRemaining(elapsedMs, done, total){
  if(!done||done<=0||!total||total<=0||done>=total) return '';
  const ratePerMs=done/elapsedMs;
  if(ratePerMs<=0) return '';
  const remainMs=((total-done)/ratePerMs);
  if(remainMs<5000) return '~a few seconds remaining';
  const remainSec=Math.ceil(remainMs/1000);
  if(remainSec<90) return `~${remainSec}s remaining`;
  return `~${Math.ceil(remainSec/60)}min remaining`;
}

function _renderSyncGate(d){
  const gate=$('syncGateCard');
  if(!gate) return;
  if(d.isSyncing){
    const done=d.syncProgress||0, total=d.syncTotal||0;
    const pct=total>0?Math.round(done/total*100):null;

    let timeHint='This usually takes 1â€“3 minutes';
    if(_syncStartTime&&done>_syncStartProgress){
      const elapsed=Date.now()-_syncStartTime;
      const hint=_fmtRemaining(elapsed, done-_syncStartProgress, (total||done*1.5)-_syncStartProgress);
      if(hint) timeHint=hint;
    }

    const syncLabel=_syncIsIncremental
      ? `Syncing ${done>0?done+' ':'' }new tracksâ€¦`
      : 'Syncing your libraryâ€¦';

    const countLabel=total>0
      ? (_syncIsIncremental ? `${done} new track${done!==1?'s':''} found` : `${done} of ${total} tracks`)
      : 'Scanningâ€¦';

    gate.innerHTML=`
      <div class="spin" style="margin:0 auto 20px"></div>
      <div class="sync-gate-title">${syncLabel}</div>
      <div class="sync-prog-track">
        <div class="sync-prog-fill" style="width:${pct!==null?pct:35}%"></div>
      </div>
      <div class="sync-track-count">${countLabel}</div>
      <div class="sync-time-hint">${timeHint}</div>`;
  } else {
    gate.innerHTML=`
      <div class="sync-gate-icon">ðŸŽµ</div>
      <div class="sync-gate-title">Sync your Spotify library</div>
      <div class="sync-gate-body">We need to analyse your liked songs before generating playlists. This takes 1â€“3 minutes.</div>
      <button class="btn btn-green btn-md" onclick="_startSync()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Sync Now
      </button>`;
  }
}

async function _startSync(){
  const btn=document.querySelector('#syncGateCard .btn-green');
  if(btn){ btn.disabled=true; btn.textContent='Startingâ€¦'; }
  try {
    await fetch('/api/spotify/sync',{method:'POST',credentials:'include'});
    _pollSync();
  } catch { showToast('Failed to start sync â€” try again.','error',4000); if(btn){ btn.disabled=false; btn.textContent='Sync Now'; } }
}

/* â”€â”€ Boot â”€â”€ */
init();
</script>
</body>
</html>

```


