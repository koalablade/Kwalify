#!/usr/bin/env node
/** Quick single-prompt eval for debugging. */
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const prompt = process.argv[2] ?? "late night drive";
const DEFAULT_PORT = 5000;

async function readFullDotEnv() {
  const { readLocalDotEnv } = await import("../dist/lib/benchmark-env-dotenv.js");
  return readLocalDotEnv();
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: `http://127.0.0.1:${DEFAULT_PORT}` });
}

async function killLocalPort(port) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) {
        try { execSync(`taskkill /F /PID ${pid}`); } catch { /* ignore */ }
      }
    }
  } catch { /* port free */ }
}

async function main() {
  const dotenv = await readFullDotEnv();
  const creds = await resolveCreds();
  await killLocalPort(DEFAULT_PORT);
  await new Promise((r) => setTimeout(r, 2000));
  const env = { ...process.env, ...dotenv, PORT: String(DEFAULT_PORT), PLAYLIST_EVAL_TOKEN: creds.token, PLAYLIST_CONTRACT_V40: "1", PLAYLIST_CONTRACT_V41: "1" };
  const server = spawn(process.execPath, [join(ROOT, "backend", "dist", "server.js")], { cwd: ROOT, env, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  try {
    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const hres = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
        const pres = await fetch(`${baseUrl}/api/eval/ping`, { method: "POST", headers: { "x-kwalify-evaluation-token": creds.token }, signal: AbortSignal.timeout(15000) });
        const pdata = await pres.json().catch(() => ({}));
        if (hres.ok && pdata.tokenAccepted === true) break;
      } catch { /* retry */ }
    }
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": creds.token },
      body: JSON.stringify({ vibe: prompt, mode: "balanced", length: 25, varietyBoost: true, auditMode: true, spotifyUserId: "koalablade" }),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    const data = await res.json();
    const tracks = (data.tracks ?? []).map((t) => `${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`);
    console.log(JSON.stringify({ prompt, delivered: tracks.length, tracks }, null, 2));
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
