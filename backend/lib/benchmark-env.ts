/**
 * Central benchmark / evaluation environment resolution.
 *
 * CI: GitHub Actions injects secrets via .github/actions/benchmark-env (all alias names).
 * Local: repo-root .env ALWAYS wins over process.env for PLAYLIST_EVAL_TOKEN.
 */

export const BENCHMARK_GITHUB_SECRETS = [
  "PLAYLIST_EVAL_TOKEN",
  "SMOKE_SPOTIFY_USER_ID",
] as const;

/** Production Render eval token length (must match exactly). */
export const EXPECTED_EVAL_TOKEN_LENGTH = 21;

export const BENCHMARK_ENV_ALIASES = {
  token: ["PLAYLIST_EVAL_TOKEN", "SMOKE_EVAL_TOKEN"] as const,
  spotifyUserId: ["SMOKE_SPOTIFY_USER_ID", "SPOTIFY_USER_ID", "PLAYLIST_EVAL_SPOTIFY_USER_ID"] as const,
  baseUrl: [
    "KWALIFY_BENCHMARK_BASE_URL",
    "SMOKE_BASE_URL",
    "API_BASE_URL",
    "PLAYLIST_EVAL_BASE_URL",
    "APP_URL",
  ] as const,
  expectedVersion: [
    "PLAYLIST_EVAL_EXPECTED_VERSION",
    "EXPECTED_DEPLOYMENT_VERSION",
    "SMOKE_EXPECTED_COMMIT",
  ] as const,
} as const;

export type LiveBenchmarkCredentials = {
  baseUrl: string;
  token: string;
  spotifyUserId: string;
  expectedDeploymentVersion: string | null;
};

export type ResolveLiveBenchmarkOptions = {
  cli?: {
    baseUrl?: string | null;
    token?: string | null;
    spotifyUserId?: string | null;
    expectedDeploymentVersion?: string | null;
  };
  dryRun?: boolean;
  /** When true (default in CI), missing live creds throw instead of returning partial config. */
  strict?: boolean;
  defaultBaseUrl?: string;
};

import { normalizeEvalToken } from "./eval-token-normalize";
import { readLocalDotEnvValue } from "./benchmark-env-dotenv";

function trimValue(raw: string | null | undefined): string | null {
  const value = normalizeEvalToken(raw);
  return value || null;
}

function keysAreTokenAliases(keys: readonly string[]): boolean {
  const tokenKeys = BENCHMARK_ENV_ALIASES.token as readonly string[];
  return keys.length === tokenKeys.length && keys.every((key) => tokenKeys.includes(key));
}

function readFromProcessEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimValue(process.env[key]);
    if (value) return value;
  }
  return null;
}

function readEvalTokenFromDotEnv(): string | null {
  for (const key of BENCHMARK_ENV_ALIASES.token) {
    const value = trimValue(readLocalDotEnvValue(key));
    if (value) return value;
  }
  return null;
}

export type EvalTokenResolution = {
  token: string;
  source: string;
  staleShellIgnored: boolean;
  tokenConflicts: Array<{ source: string; length: number; ignoredBecause: string }>;
};

/**
 * Local: .env always beats process.env for PLAYLIST_EVAL_TOKEN.
 * CI: process.env only (GitHub secrets).
 */
export function readEvalToken(): EvalTokenResolution {
  const empty: EvalTokenResolution = {
    token: "",
    source: "missing",
    staleShellIgnored: false,
    tokenConflicts: [],
  };

  if (isCiEnvironment()) {
    const token = readFromProcessEnv(BENCHMARK_ENV_ALIASES.token) ?? "";
    return {
      token,
      source: token ? "process.env (CI)" : "missing",
      staleShellIgnored: false,
      tokenConflicts: [],
    };
  }

  const dotEnvToken = readEvalTokenFromDotEnv();
  if (dotEnvToken) {
    const conflicts: EvalTokenResolution["tokenConflicts"] = [];
    for (const key of BENCHMARK_ENV_ALIASES.token) {
      const shell = trimValue(process.env[key]);
      if (shell && shell !== dotEnvToken) {
        console.warn(
          `[benchmark-env] Stale shell token ignored (${key} length ${shell.length} != .env length ${dotEnvToken.length})`,
        );
        conflicts.push({
          source: `process.env.${key}`,
          length: shell.length,
          ignoredBecause: ".env PLAYLIST_EVAL_TOKEN",
        });
      }
    }
    return {
      token: dotEnvToken,
      source: ".env PLAYLIST_EVAL_TOKEN",
      staleShellIgnored: conflicts.length > 0,
      tokenConflicts: conflicts,
    };
  }

  const shellToken = readFromProcessEnv(BENCHMARK_ENV_ALIASES.token) ?? "";
  return {
    token: shellToken,
    source: shellToken ? "process.env PLAYLIST_EVAL_TOKEN" : "missing",
    staleShellIgnored: false,
    tokenConflicts: [],
  };
}

export function readBenchmarkEnv(keys: readonly string[]): string | null {
  if (keysAreTokenAliases(keys)) {
    return readEvalToken().token || null;
  }

  if (!isCiEnvironment()) {
    for (const key of keys) {
      const fromDotEnv = trimValue(readLocalDotEnvValue(key));
      if (fromDotEnv) return fromDotEnv;
    }
  }
  return readFromProcessEnv(keys);
}

export function isCiEnvironment(): boolean {
  return process.env["CI"] === "true" || process.env["GITHUB_ACTIONS"] === "true";
}

export function formatMissingBenchmarkEnv(missing: string[]): string {
  const lines = [
    "Missing benchmark environment:",
    ...missing.map((item) => `  - ${item}`),
    "",
    "GitHub Actions: set repository secrets PLAYLIST_EVAL_TOKEN and SMOKE_SPOTIFY_USER_ID,",
    "then use .github/actions/benchmark-env in the workflow (see docs/benchmark-environment.md).",
    "",
    "Local runs: npm run sync:eval-token -Token \"<21-char Render token>\"",
    "Repo-root .env overrides shell PLAYLIST_EVAL_TOKEN.",
  ];
  return lines.join("\n");
}

export function listMissingLiveBenchmarkEnv(opts: {
  dryRun?: boolean;
  requireBaseUrl?: boolean;
} = {}): string[] {
  const missing: string[] = [];
  if (!opts.dryRun) {
    if (!readBenchmarkEnv(BENCHMARK_ENV_ALIASES.token)) {
      missing.push(`PLAYLIST_EVAL_TOKEN (GitHub secret: PLAYLIST_EVAL_TOKEN)`);
    }
    if (!readBenchmarkEnv(BENCHMARK_ENV_ALIASES.spotifyUserId)) {
      missing.push(`SMOKE_SPOTIFY_USER_ID (GitHub secret: SMOKE_SPOTIFY_USER_ID)`);
    }
  }
  if (opts.requireBaseUrl !== false && !readBenchmarkEnv(BENCHMARK_ENV_ALIASES.baseUrl)) {
    missing.push(`KWALIFY_BENCHMARK_BASE_URL or SMOKE_BASE_URL / API_BASE_URL / APP_URL`);
  }
  return missing;
}

export function validateBenchmarkEnvForCi(): {
  ok: boolean;
  missing: string[];
  present: Record<string, boolean>;
  tokenLength: number | null;
} {
  const token = readBenchmarkEnv(BENCHMARK_ENV_ALIASES.token);
  const present = {
    PLAYLIST_EVAL_TOKEN: Boolean(token),
    SMOKE_SPOTIFY_USER_ID: Boolean(readBenchmarkEnv(BENCHMARK_ENV_ALIASES.spotifyUserId)),
    KWALIFY_BENCHMARK_BASE_URL: Boolean(readBenchmarkEnv(BENCHMARK_ENV_ALIASES.baseUrl)),
  };
  const missing = listMissingLiveBenchmarkEnv();
  const tokenLength = token?.length ?? null;
  const lengthOk = tokenLength === EXPECTED_EVAL_TOKEN_LENGTH;
  return {
    ok: missing.length === 0 && lengthOk,
    missing: lengthOk ? missing : [...missing, `PLAYLIST_EVAL_TOKEN length must be ${EXPECTED_EVAL_TOKEN_LENGTH} (got ${tokenLength ?? 0})`],
    present,
    tokenLength,
  };
}

export function resolveLiveBenchmarkCredentials(
  opts: ResolveLiveBenchmarkOptions = {},
): LiveBenchmarkCredentials {
  const dryRun = opts.dryRun === true;
  const strict = opts.strict ?? isCiEnvironment();

  const baseUrl = trimValue(opts.cli?.baseUrl)
    ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.baseUrl)
    ?? trimValue(opts.defaultBaseUrl)
    ?? null;
  const spotifyUserId = trimValue(opts.cli?.spotifyUserId)
    ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.spotifyUserId)
    ?? "";
  const expectedDeploymentVersion = trimValue(opts.cli?.expectedDeploymentVersion)
    ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.expectedVersion);

  const token = trimValue(opts.cli?.token) ?? readEvalToken().token;

  const missing: string[] = [];
  if (!dryRun) {
    if (!token) missing.push("PLAYLIST_EVAL_TOKEN");
    if (!spotifyUserId) missing.push("SMOKE_SPOTIFY_USER_ID");
  }
  if (!baseUrl) missing.push("KWALIFY_BENCHMARK_BASE_URL (or alias)");

  if (missing.length > 0) {
    const message = formatMissingBenchmarkEnv(
      missing.map((key) => `${key}${BENCHMARK_GITHUB_SECRETS.includes(key as typeof BENCHMARK_GITHUB_SECRETS[number]) ? " (GitHub secret)" : ""}`),
    );
    if (strict && !dryRun) throw new Error(message);
  }

  return {
    baseUrl: (baseUrl ?? "https://kwalify.net").replace(/\/+$/, ""),
    token,
    spotifyUserId,
    expectedDeploymentVersion,
  };
}

/** Resolve eval token and validate length + production acceptance. */
export async function resolveVerifiedProductionCredentials(
  opts: ResolveLiveBenchmarkOptions = {},
): Promise<LiveBenchmarkCredentials & {
  tokenSource: string;
  tokenConflicts: Array<{ source: string; length: number; ignoredBecause: string }>;
}> {
  const base = resolveLiveBenchmarkCredentials({ ...opts, strict: false });
  const cliToken = trimValue(opts.cli?.token);
  const resolved = cliToken
    ? { token: cliToken, source: "cli", staleShellIgnored: false, tokenConflicts: [] as EvalTokenResolution["tokenConflicts"] }
    : readEvalToken();

  const token = resolved.token || base.token;
  const strict = opts.strict ?? isCiEnvironment();

  if (strict && token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    throw new Error(
      `PLAYLIST_EVAL_TOKEN length must be ${EXPECTED_EVAL_TOKEN_LENGTH} (got ${token.length} from ${resolved.source}).`,
    );
  }

  if (!token && strict) {
    throw new Error(formatMissingBenchmarkEnv(["PLAYLIST_EVAL_TOKEN (GitHub secret)"]));
  }

  return {
    ...base,
    token,
    tokenSource: resolved.source,
    tokenConflicts: resolved.tokenConflicts,
  };
}

/** Warn when production server lacks eval token (audit mode unavailable). */
export function warnIfProductionEvalTokenMissing(nodeEnv: string): void {
  if (nodeEnv !== "production") return;
  if (readBenchmarkEnv(BENCHMARK_ENV_ALIASES.token)) return;
  console.warn(
    "[env] PLAYLIST_EVAL_TOKEN is not set — /api/eval audit mode and live benchmarks against this deployment will fail until it is configured on Render and redeployed.",
  );
}

export async function fetchDeployedCommit(baseUrl: string, timeoutMs = 15_000): Promise<string> {
  const origin = baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/api/eval/ping`, { signal: controller.signal });
    const data = await response.json() as Record<string, unknown>;
    return typeof data["commit"] === "string" ? data["commit"] : "unknown";
  } finally {
    clearTimeout(timer);
  }
}
