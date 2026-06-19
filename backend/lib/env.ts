/**
 * Central environment configuration — pure declarations only.
 *
 * No code executes at module-load time. All validation is deferred to
 * validateEnv(), which is the very first call inside bootstrap().
 *
 * Consumer code (routes, middleware) uses getEnv() / getFeatures(), both of
 * which require boot to be complete. Bootstrap itself uses the values returned
 * directly by validateEnv() and never calls the consumer-facing getters.
 */

import { assertBootReady } from "./boot-state";
import { warnIfProductionEvalTokenMissing } from "./benchmark-env";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppEnv {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  PORT: number;
  /** Canonical public origin, e.g. https://kwalify.net (no trailing slash) */
  APP_URL: string | undefined;
  FRONTEND_URL: string | undefined;
  NODE_ENV: string;
}

/**
 * Discriminated union — when enabled is true the Spotify credentials are
 * guaranteed present as typed strings, so callers never need to assert or
 * re-read process.env.
 */
export type AppFeatures = {
  devMode: {
    useMockSpotify: boolean;
  };
  spotify:
    | { enabled: true; clientId: string; clientSecret: string; redirectUri: string }
    | { enabled: false };
};

// ── Internal singletons — populated once by validateEnv() ────────────────────

let _env: AppEnv | null = null;
let _features: AppFeatures | null = null;

// ── Private helper ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[env] ${key} is required but was not set`);
  return val;
}

function normalizeOptionalUrlEnv(key: "APP_URL" | "FRONTEND_URL"): string | undefined {
  const raw = process.env[key]?.trim();
  if (!raw) return undefined;
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0) return undefined;
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      throw new Error(`[env] ${key} must contain valid http(s) URL origins, got "${origin}"`);
    }
  }
  return origins.map((origin) => origin.replace(/\/+$/, "")).join(",");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validates all required environment variables, populates the internal
 * singletons, and returns the validated values directly.
 *
 * Bootstrap MUST use the returned object — it must NOT call getEnv() or
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

  const APP_URL = normalizeOptionalUrlEnv("APP_URL");
  const FRONTEND_URL = normalizeOptionalUrlEnv("FRONTEND_URL");

  _env = {
    DATABASE_URL,
    SESSION_SECRET,
    PORT,
    APP_URL,
    FRONTEND_URL,
    NODE_ENV: process.env["NODE_ENV"] ?? "development",
  };

  const spotifyMissing = (
    ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REDIRECT_URI"] as const
  ).filter((k) => !process.env[k]);

  _features = {
    devMode: {
      useMockSpotify: process.env["USE_MOCK_SPOTIFY"] === "true",
    },
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

  warnIfProductionEvalTokenMissing(_env.NODE_ENV);

  return { env: _env, features: _features };
}

/**
 * Returns the validated AppEnv object.
 *
 * Boot-locked: throws if called before bootstrap() has completed.
 * For use in route handlers and middleware only — never inside bootstrap itself.
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
 * For use in route handlers only — never inside bootstrap itself.
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
