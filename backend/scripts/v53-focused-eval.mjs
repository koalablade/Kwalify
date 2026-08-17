#!/usr/bin/env node
/**
 * V53 focused 6-prompt atmospheric eval.
 * Usage: node backend/scripts/v53-focused-eval.mjs [--out reports/playlist-evaluation/v53-focused-results.json]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const USER = "koalablade";
const REQUESTED = 25;
const DEFAULT_PORT = 5000;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const V41_ENV = { PLAYLIST_CONTRACT_V40: "1", PLAYLIST_CONTRACT_V41: "1" };

const FOCUSED_PROMPTS = [
  "late night drive",
  "cozy sunday morning coffee",
  "lo-fi study focus",
  "sad party bangers",
  "party but not cheesy",
  "party but restrained",
];

const outArg = process.argv.find((a, i) => process.argv[i - 1] === "--out");
const OUT_JSON = resolve(ROOT, outArg ?? "reports/playlist-evaluation/v53-focused-results.json");

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

async function spawnApiServer() {
  const dotenv = await readFullDotEnv();
  const creds = await resolveCreds();
  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  await killLocalPort(DEFAULT_PORT);
  await new Promise((r) => setTimeout(r, 2000));

  const env = {
    ...process.env,
    ...dotenv,
    PORT: String(DEFAULT_PORT),
    PLAYLIST_EVAL_TOKEN: creds.token,
    PLAYLIST_CONTRACT_SHADOW: "",
    ...V41_ENV,
  };

  const server = spawn(process.execPath, [join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const hres = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
      const pres = await fetch(`${baseUrl}/api/eval/ping`, {
        method: "POST",
        headers: { "x-kwalify-evaluation-token": creds.token },
        signal: AbortSignal.timeout(15000),
      });
      const pdata = await pres.json().catch(() => ({}));
      if (hres.ok && pdata.tokenAccepted === true) return { server, baseUrl, token: creds.token };
    } catch { /* retry */ }
  }
  server.kill("SIGTERM");
  throw new Error("API did not become ready");
}

function artistRepetition(tracks) {
  const counts = new Map();
  for (const t of tracks) {
    const artist = String(t.artist ?? t.artistName ?? "").trim().toLowerCase();
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([artist, count]) => ({ artist, count }));
}

async function generateOne(baseUrl, token, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: REQUESTED,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: USER,
        requestId: `v53-focused-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      signal: controller.signal,
    });
    return { httpStatus: res.status, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { verifyIndependentHumanQuality } = await import(
    "../dist/core/editorial/independent-human-quality-verifier.js"
  );
  const candidateSha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const { server, baseUrl, token } = await spawnApiServer();
  const results = [];

  try {
    for (const prompt of FOCUSED_PROMPTS) {
      console.log(`[v53-focused] ${prompt}`);
      const { httpStatus, data } = await generateOne(baseUrl, token, prompt);
      const tracks = (data.tracks ?? []).map((t) => ({
        artist: t.artistName ?? t.artist ?? "",
        track: t.trackName ?? t.name ?? "",
        energy: t.energy ?? null,
      }));
      const mapped = tracks.map((t) => ({
        trackName: t.track,
        artistName: t.artist,
        energy: t.energy,
      }));
      const verifier = verifyIndependentHumanQuality(prompt, mapped);
      const spamHits = tracks.filter((t) =>
        /\b(?:sped|sp33d|nightcore|phonk|stutter techno|chillhop beats)\b/i.test(t.track),
      ).length;
      const misfits = verifier.tracks.filter((t) => t.flag === "misfit").length;
      results.push({
        prompt,
        httpStatus,
        delivered: tracks.length,
        spamHits,
        misfits,
        verifier: verifier.playlistVerdict,
        first10: tracks.slice(0, 10).map((t) => `${t.artist} — ${t.track}`),
        artistRepetition: artistRepetition(tracks),
        tracks: tracks.map((t) => `${t.artist} — ${t.track}`),
      });
      console.log(
        `  → del=${tracks.length} spam=${spamHits} misfits=${misfits} verifier=${verifier.playlistVerdict}`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    server.kill("SIGTERM");
  }

  const payload = { candidateSha, results };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
