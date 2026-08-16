#!/usr/bin/env node
/**
 * V52 stage trace — candidate pool evidence at each pipeline stage.
 * Usage: node backend/scripts/v52-stage-trace.mjs [--prompt "late night drive"]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const DEFAULT_PORT = 5000;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;

function loadDotEnv() {
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--prompt");
  return { prompt: i >= 0 && args[i + 1] ? args[i + 1] : "late night drive" };
}

function fmtTrack(t) {
  const artist = t.artistName ?? t.artist ?? "?";
  const track = t.trackName ?? t.name ?? t.title ?? "?";
  return `${artist} — ${track}`;
}

function sampleTracks(items, n = 5) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, n).map(fmtTrack);
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

async function spawnServer() {
  loadDotEnv();
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const creds = resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: `http://127.0.0.1:${DEFAULT_PORT}` });
  await killLocalPort(DEFAULT_PORT);
  await new Promise((r) => setTimeout(r, 2000));
  const env = {
    ...process.env,
    PORT: String(DEFAULT_PORT),
    PLAYLIST_EVAL_TOKEN: creds.token,
    PLAYLIST_CONTRACT_V40: "1",
    PLAYLIST_CONTRACT_V41: "1",
  };
  const server = spawn(process.execPath, [resolve(ROOT, "backend/dist/server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const h = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
      const p = await fetch(`${baseUrl}/api/eval/ping`, {
        method: "POST",
        headers: { "x-kwalify-evaluation-token": creds.token },
        signal: AbortSignal.timeout(15000),
      });
      const pd = await p.json().catch(() => ({}));
      if (h.ok && pd.tokenAccepted) return { server, baseUrl, token: creds.token };
    } catch { /* retry */ }
  }
  server.kill("SIGTERM");
  throw new Error("API did not become ready");
}

function extractStages(data) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const fin = data.finalization ?? {};
  const auth = fin.pipelineAuthority ?? {};
  const dl = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const mutations = (auth.mutations ?? []).map((m) => ({
    stage: m.stage,
    before: m.beforeCount,
    after: m.afterCount,
    removed: m.tracksRemoved,
  }));
  const forensic = v3.forensicPreV3Trace ?? gd.preV3Recovery?.forensicPreV3Trace ?? [];
  const funnelStages = [];
  if (Array.isArray(gd.preV3SamplingFunnel)) {
    for (const s of gd.preV3SamplingFunnel) {
      funnelStages.push({ stage: s.stage ?? s.label, count: s.count ?? s.after, sample: sampleTracks(s.sample ?? s.tracks) });
    }
  }
  if (Array.isArray(forensic)) {
    for (const s of forensic) {
      funnelStages.push({
        stage: `v3:${s.stage}`,
        before: s.before,
        after: s.after,
        removed: s.removed,
        topReasons: s.topReasons ?? s.rejectionReasons ?? null,
      });
    }
  }
  const v41 = data.playlistContractV41 ?? null;
  return {
    committedWorld: data.committedWorld ?? gd.committedWorld ?? null,
    deliveryLossFunnel: dl,
    mutations,
    funnelStages,
    poolSizes: {
      library: gd.initialLibrarySize ?? null,
      retrieval: gd.candidatesSampled ?? gd.candidatesAfterIntent ?? null,
      afterIntent: gd.candidatesAfterIntent ?? null,
      v3PreFilter: dl.v3PreFilterSurvivors ?? null,
      v3Composed: dl.v3Composed ?? null,
      postPurity: dl.postPurity ?? null,
      postWorldProof: dl.postWorldProof ?? null,
      orchestratorFinal: dl.orchestratorFinal ?? null,
      finalDelivered: dl.finalDelivered ?? (data.tracks ?? []).length,
    },
    v41Rebalance: v41?.rebalance ?? null,
    contractRebalanceGuard: fin.diagnostics?.contractRebalanceGuardSkippedTerminalHqg ?? null,
    humanQualityGate: fin.diagnostics?.humanQualityGate ?? v3.humanQualityGate ?? null,
    intentFidelityGate: fin.diagnostics?.intentFidelityGate ?? null,
    degradedDelivery: fin.diagnostics?.degradedDelivery ?? null,
    honestPartial: fin.diagnostics?.honestPartialPublished ?? null,
    deliveredTracks: (data.tracks ?? []).map((t, i) => ({
      position: i + 1,
      label: fmtTrack(t),
      energy: t.energy ?? null,
      genreFamily: t.genreFamily ?? null,
    })),
  };
}

async function main() {
  const { prompt } = parseArgs();
  mkdirSync(OUT_DIR, { recursive: true });
  const sha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const { server, baseUrl, token } = await spawnServer();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/api/generate?audit=1&debug=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: "koalablade",
        requestId: `v52-trace-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    const trace = extractStages(data);
    const payload = {
      sha,
      prompt,
      httpStatus: res.status,
      success: data.success,
      committedWorldTop: data.committedWorld ?? null,
      committedWorldDiag: data.generationDiagnostics?.committedWorld ?? data.generationTrust?.dominantIntentContract ?? null,
      playlistContractV41: data.playlistContractV41 ?? null,
      generationDiagnosticsKeys: data.generationDiagnostics ? Object.keys(data.generationDiagnostics).slice(0, 30) : [],
      trace,
    };
    const outJson = resolve(OUT_DIR, "v52-stage-trace.json");
    writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${outJson}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
