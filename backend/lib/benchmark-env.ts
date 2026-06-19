/**
 * Central benchmark / evaluation environment resolution.
 *
 * CI: GitHub Actions injects secrets via .github/actions/benchmark-env (all alias names).
 * Local: export vars or run npm run sync:eval-token — no automatic .env loading.
 */

export const BENCHMARK_GITHUB_SECRETS = [
  "PLAYLIST_EVAL_TOKEN",
  "SMOKE_SPOTIFY_USER_ID",
] as const;

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

function trimValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").replace(/\r?\n/g, "");
  return value || null;
}

export function readBenchmarkEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimValue(process.env[key]);
    if (value) return value;
  }
  return null;
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
    "Local runs: export variables in your shell or run npm run sync:eval-token.",
    "Do not rely on .env for CI; .env is local-only and gitignored.",
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
} {
  const present = {
    PLAYLIST_EVAL_TOKEN: Boolean(readBenchmarkEnv(BENCHMARK_ENV_ALIASES.token)),
    SMOKE_SPOTIFY_USER_ID: Boolean(readBenchmarkEnv(BENCHMARK_ENV_ALIASES.spotifyUserId)),
    KWALIFY_BENCHMARK_BASE_URL: Boolean(readBenchmarkEnv(BENCHMARK_ENV_ALIASES.baseUrl)),
  };
  const missing = listMissingLiveBenchmarkEnv();
  return { ok: missing.length === 0, missing, present };
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
  const token = trimValue(opts.cli?.token) ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.token) ?? "";
  const spotifyUserId = trimValue(opts.cli?.spotifyUserId)
    ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.spotifyUserId)
    ?? "";
  const expectedDeploymentVersion = trimValue(opts.cli?.expectedDeploymentVersion)
    ?? readBenchmarkEnv(BENCHMARK_ENV_ALIASES.expectedVersion);

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
