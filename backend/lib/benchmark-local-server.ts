/**
 * Shared local API bootstrap for live benchmarks (eval token + optional spawn).
 */

import path from "node:path";
import { readEvalToken } from "./benchmark-env";
import { readLocalDotEnv } from "./benchmark-env-dotenv";

const ROOT = path.resolve(__dirname, "..", "..", "..");

export async function healthOk(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function evalPingOk(baseUrl: string, token: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": token },
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.tokenAccepted === true) return { ok: true };
    return {
      ok: false,
      reason: String(data.reason ?? `HTTP ${res.status}`),
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function spawnLocalServer(
  baseUrl: string,
  token: string,
  label = "benchmark",
): Promise<{ shutdown: () => void; baseUrl: string }> {
  const { spawn } = await import("node:child_process");
  const parsed = new URL(baseUrl);
  let port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!parsed.port && parsed.hostname === "localhost") port = 5000;

  const healthAndPing = async (origin: string) => {
    const health = await healthOk(origin);
    const ping = health ? await evalPingOk(origin, token) : { ok: false };
    return health && ping.ok;
  };

  if (await healthAndPing(baseUrl)) {
    return { shutdown: () => {}, baseUrl };
  }

  const portsToTry = port === 5000 && parsed.hostname === "localhost" ? [5000, 5001] : [port];
  let lastError = "API did not become eval-ready";

  for (const tryPort of portsToTry) {
    const origin = `${parsed.protocol}//${parsed.hostname}:${tryPort}`;
    if (await healthAndPing(origin)) {
      return { shutdown: () => {}, baseUrl: origin };
    }

    const portBusy = await healthOk(origin);
    if (portBusy && tryPort === port) {
      lastError = `Port ${tryPort} is up but eval token does not match — trying alternate port`;
      continue;
    }

    const env = {
      ...readLocalDotEnv(),
      ...process.env,
      PORT: String(tryPort),
      PLAYLIST_EVAL_TOKEN: token,
      GIT_COMMIT: process.env.GIT_COMMIT || label,
    };
    const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bootLog = "";
    server.stderr?.on("data", (chunk: Buffer) => {
      bootLog += chunk.toString();
      if (bootLog.length > 8000) bootLog = bootLog.slice(-8000);
    });

    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await healthAndPing(origin)) {
        return { shutdown: () => server.kill("SIGTERM"), baseUrl: origin };
      }
    }

    server.kill("SIGTERM");
    lastError = `API did not become eval-ready at ${origin}${bootLog ? `\n${bootLog.slice(-1200)}` : ""}`;
  }

  throw new Error(lastError);
}

export async function ensureEvalReady(
  baseUrl: string,
  token: string,
  spawnLocal: boolean,
  resumeHint = "npm run benchmark:live-6h:local",
): Promise<{ shutdown: (() => void) | null; baseUrl: string }> {
  const ping = await evalPingOk(baseUrl, token);
  if (ping.ok) return { shutdown: null, baseUrl };

  const health = await healthOk(baseUrl);
  if (health && !ping.ok) {
    const tokenMeta = readEvalToken();
    const hint = [
      `Eval token rejected by ${baseUrl}: ${ping.reason ?? "unknown"}.`,
      `Your token source: ${tokenMeta.source} (length ${token.length}).`,
      "Restart the dev server after updating repo-root .env, or run:",
      `  ${resumeHint}`,
    ].join("\n");
    if (!spawnLocal) {
      throw new Error(hint);
    }
    process.stderr.write("[benchmark] Spawning fresh local API with matching eval token...\n");
    return spawnLocalServer(baseUrl, token);
  }

  if (!health) {
    if (!spawnLocal) {
      throw new Error(`No API at ${baseUrl}. Start the server or use ${resumeHint}`);
    }
    process.stderr.write(`[benchmark] Starting local API at ${baseUrl}...\n`);
    return spawnLocalServer(baseUrl, token);
  }

  return { shutdown: null, baseUrl };
}
