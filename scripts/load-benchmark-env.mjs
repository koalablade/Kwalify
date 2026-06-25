/**
 * Shared production benchmark credentials for proof/regression scripts.
 * Local: repo-root .env ALWAYS overrides process.env for PLAYLIST_EVAL_TOKEN.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const EXPECTED_EVAL_TOKEN_LENGTH = 21;
const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

export function normalizeEvalToken(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").replace(/\r?\n/g, "");
}

export function isCiEnvironment() {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

async function readDotEnv() {
  const out = {};
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      out[m[1]] = normalizeEvalToken(m[2]);
    }
  } catch { /* no .env */ }
  return out;
}

function readEvalTokenFromProcess() {
  return normalizeEvalToken(process.env.PLAYLIST_EVAL_TOKEN)
    || normalizeEvalToken(process.env.SMOKE_EVAL_TOKEN);
}

function resolveEvalToken(fileEnv) {
  const conflicts = [];

  if (isCiEnvironment()) {
    const token = readEvalTokenFromProcess();
    return {
      token,
      tokenSource: token ? "process.env (CI)" : "missing",
      conflicts,
    };
  }

  const dotEnvToken = normalizeEvalToken(fileEnv.PLAYLIST_EVAL_TOKEN)
    || normalizeEvalToken(fileEnv.SMOKE_EVAL_TOKEN);

  if (dotEnvToken) {
    for (const key of ["PLAYLIST_EVAL_TOKEN", "SMOKE_EVAL_TOKEN"]) {
      const shell = normalizeEvalToken(process.env[key]);
      if (shell && shell !== dotEnvToken) {
        console.warn(
          `[load-benchmark-env] Stale shell token ignored (${key} length ${shell.length} != .env length ${dotEnvToken.length})`,
        );
        conflicts.push({
          source: `process.env.${key}`,
          length: shell.length,
          ignoredBecause: ".env PLAYLIST_EVAL_TOKEN",
        });
      }
    }
    return { token: dotEnvToken, tokenSource: ".env PLAYLIST_EVAL_TOKEN", conflicts };
  }

  const shellToken = readEvalTokenFromProcess();
  return {
    token: shellToken,
    tokenSource: shellToken ? "process.env PLAYLIST_EVAL_TOKEN" : "missing",
    conflicts,
  };
}

async function tokenAccepted(baseUrl, token) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/eval/ping`, {
    method: "POST",
    headers: { "x-kwalify-evaluation-token": token },
  });
  const data = await res.json();
  return { status: res.status, accepted: data.tokenAccepted === true, data };
}

export async function loadBenchmarkEnv(opts = {}) {
  const fileEnv = await readDotEnv();
  const baseUrl = (
    process.env.KWALIFY_BENCHMARK_BASE_URL
    || process.env.SMOKE_BASE_URL
    || process.env.API_BASE_URL
    || fileEnv.SMOKE_BASE_URL
    || fileEnv.API_BASE_URL
    || opts.defaultBaseUrl
    || "https://kwalify.net"
  ).replace(/\/+$/, "");

  const spotifyUserId = normalizeEvalToken(fileEnv.SMOKE_SPOTIFY_USER_ID)
    || normalizeEvalToken(fileEnv.SPOTIFY_USER_ID)
    || normalizeEvalToken(process.env.SMOKE_SPOTIFY_USER_ID)
    || normalizeEvalToken(process.env.SPOTIFY_USER_ID)
    || "koalablade";

  const { token, tokenSource, conflicts } = resolveEvalToken(fileEnv);

  return {
    baseUrl,
    token,
    tokenSource,
    tokenLength: token.length,
    productionTokenLength: EXPECTED_EVAL_TOKEN_LENGTH,
    spotifyUserId,
    conflicts,
  };
}

export async function requireProductionAuth(cfg) {
  if (!cfg.token) {
    console.error("PLAYLIST_EVAL_TOKEN missing — npm run sync:eval-token -Token \"<21-char Render token>\"");
    process.exit(1);
  }
  if (cfg.token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    console.error(JSON.stringify({
      error: "INVALID_EVAL_TOKEN_LENGTH",
      tokenLength: cfg.token.length,
      expectedLength: EXPECTED_EVAL_TOKEN_LENGTH,
      tokenSource: cfg.tokenSource,
      fix: "npm run sync:eval-token -Token \"<paste exact 21-char Render token>\"",
    }, null, 2));
    process.exit(1);
  }
  const probe = await tokenAccepted(cfg.baseUrl, cfg.token);
  if (probe.status === 403 || !probe.accepted) {
    const hint = probe.data?.hint ?? {};
    console.error(JSON.stringify({
      error: "PRODUCTION_AUTH_FAILED",
      baseUrl: cfg.baseUrl,
      tokenSource: cfg.tokenSource,
      tokenLength: cfg.tokenLength,
      status: probe.status,
      reason: probe.data?.reason ?? "Evaluation token was missing or invalid.",
      staleShellOverride: cfg.conflicts?.length ? cfg.conflicts : undefined,
    }, null, 2));
    process.exit(1);
  }
  return cfg;
}

export function assertAuditResponse(res, data, context) {
  if (res.status === 403 || data?.code === "AUDIT_MODE_NOT_AUTHORIZED") {
    console.error(JSON.stringify({
      error: "AUDIT_MODE_NOT_AUTHORIZED",
      context,
      status: res.status,
      code: data?.code ?? null,
      message: data?.message ?? data?.error ?? data?.reason ?? null,
    }, null, 2));
    process.exit(1);
  }
}
