import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

async function loadDotEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || env[m[1]]) continue;
      env[m[1]] = m[2].trim().replace(/^["']+|["']+$/g, "");
    }
  } catch { /* no .env */ }
  return env;
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

const PROMPTS = [
  { id: "party-70s-disco", prompt: "70s disco party dancefloor", mode: "strict", length: 30 },
  { id: "chill-late-night", prompt: "late night calm warm playlist", mode: "strict", length: 25 },
  { id: "launch-calibration-001", prompt: "90s neon nite driv tekk vibey but hard", mode: "strict", length: 30 },
];

const env = await loadDotEnv();
const token = randomBytes(16).toString("base64url").slice(0, 21);
env.PLAYLIST_EVAL_TOKEN = token;
env.GIT_COMMIT = env.GIT_COMMIT || "local-test";

const baseUrl = "http://localhost:5000";
let server = null;
if (!(await healthOk(baseUrl))) {
  server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await healthOk(baseUrl)) break;
  }
  if (!(await healthOk(baseUrl))) {
    server.kill("SIGTERM");
    throw new Error("API did not start");
  }
}

for (const p of PROMPTS) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: p.prompt,
      mode: p.mode,
      length: p.length,
      auditMode: true,
      spotifyUserId: "koalablade",
      varietyBoost: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  const tracks = Array.isArray(data.tracks) ? data.tracks.length : 0;
  const ok = res.ok && data.success === true && tracks > 0;
  console.log(JSON.stringify({
    id: p.id,
    ok,
    status: res.status,
    code: data.code ?? null,
    tracks,
    elapsedMs: Date.now() - started,
    fallback: data.generationDiagnostics?.fallbackLevel ?? null,
    error: data.error ?? data.message ?? null,
  }));
}

if (server) server.kill("SIGTERM");
