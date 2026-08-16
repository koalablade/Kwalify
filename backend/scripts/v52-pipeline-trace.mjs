#!/usr/bin/env node
/**
 * V52 full pipeline trace — interpretation → world → retrieval → pool → scoring → selection → gates → terminal
 * Usage: node backend/scripts/v52-pipeline-trace.mjs [--prompt "late night drive"]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const USER = "koalablade";
const DEFAULT_PORT = 5000;
const V41_ENV = { PLAYLIST_CONTRACT_V40: "1", PLAYLIST_CONTRACT_V41: "1" };

const promptArg = process.argv.find((a, i) => process.argv[i - 1] === "--prompt") ?? "late night drive";

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

function fmtTracks(tracks, limit = 40) {
  return (tracks ?? []).slice(0, limit).map((t, i) => ({
    pos: i + 1,
    artist: t.artistName ?? t.artist ?? "",
    track: t.trackName ?? t.name ?? t.track ?? "",
    genre: t.genreFamily ?? t.genrePrimary ?? null,
    energy: t.energy ?? null,
  }));
}

function extractTrace(data) {
  const gd = data.generationDiagnostics ?? {};
  const fin = data.finalization ?? {};
  const ps = gd.promptSurvivability ?? {};
  const dl = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const auth = fin.pipelineAuthority ?? {};
  const muts = (auth.mutations ?? []).map((m) => ({
    stage: m.stage,
    before: m.beforeCount,
    after: m.afterCount,
    removed: m.tracksRemoved,
    removedSample: (m.removedTracks ?? m.removed ?? []).slice(0, 8).map((t) =>
      `${t.artistName ?? t.artist ?? "?"} — ${t.trackName ?? t.track ?? "?"}`,
    ),
  }));
  const v41 = data.playlistContractV41 ?? null;
  const world =
    data.committedWorld ??
    gd.committedWorld ??
    gd.dominantIntentContract?.musicalWorldId ??
    null;
  const worldId = typeof world === "object" ? world?.id ?? world?.musicalWorldId : world;

  return {
    prompt: promptArg,
    delivered: (data.tracks ?? []).length,
    requested: 25,
    committedWorld: worldId,
    intentSignature: gd.intentSignature ?? data.intentSignature ?? null,
    promptSurvivability: {
      preFilterPoolSize: ps.preFilterPoolSize,
      postStructuredRetrievalSize: ps.postStructuredRetrievalSize,
      postContractFilterSize: ps.postContractFilterSize,
      postFinalizationSize: ps.postFinalizationSize,
      firstCollapseReason: ps.firstCollapseReason,
    },
    deliveryLossFunnel: dl,
    pipelineMutations: muts,
    v41Rebalance: v41?.rebalance ?? null,
    v41PoolSelection: v41?.poolSelection ?? null,
    humanQualityGate: fin.diagnostics?.humanQualityGate ?? fin.diagnostics?.humanQualityGateLate ?? null,
    intentFidelityGate: fin.diagnostics?.intentFidelityGate ?? null,
    worldPurity: fin.diagnostics?.worldPurity ?? gd.worldPurity ?? null,
    worldProof: fin.diagnostics?.worldProof ?? null,
    thinLibrary: fin.diagnostics?.thinLibraryPolicy ?? gd.thinLibraryPolicy ?? null,
    honestPartial: fin.diagnostics?.honestPartialPublished ?? gd.honestPartialPublished ?? null,
    terminalSemanticSpamStrip: fin.diagnostics?.terminalSemanticSpamStrip ?? null,
    refill: fin.diagnostics?.deliverableDepthRefill ?? gd.deliverableDepthRefill ?? null,
    retrievalFunnel: gd.retrievalFunnel ?? gd.retrievalFunnelTrace ?? null,
    finalTracks: fmtTracks(data.tracks, 30),
    error: data.error ?? data.message ?? null,
  };
}

async function main() {
  const { isSemanticSpamTrack } = await import("../dist/core/playlist-contract/contract-axis-scoring.js");
  const { server, baseUrl, token } = await spawnApiServer();
  try {
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: promptArg,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: USER,
        requestId: `v52-trace-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    const data = await res.json();
    const fin = data.finalization ?? {};
    const trace = extractTrace(data);
    trace.spamCheck = (data.tracks ?? []).slice(0, 5).map((t) => ({
      artist: t.artist ?? t.artistName,
      track: t.name ?? t.trackName,
      isSpam: isSemanticSpamTrack({
        artistName: t.artist ?? t.artistName,
        trackName: t.name ?? t.trackName,
      }),
    }));
    trace.terminalSemanticSpamStrip = fin.terminalSemanticSpamStrip ?? fin.diagnostics?.terminalSemanticSpamStrip ?? null;
    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = resolve(OUT_DIR, `v52-trace-${promptArg.replace(/\s+/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify({ httpStatus: res.status, trace, rawKeys: Object.keys(data) }, null, 2));
    console.log(JSON.stringify(trace, null, 2));
    console.log(`\nWrote ${outPath}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
