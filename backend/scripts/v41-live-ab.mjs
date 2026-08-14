#!/usr/bin/env node
/**
 * V41 live contract-aware composition A/B — V37 vs PLAYLIST_CONTRACT_V41=1 only.
 *
 * Usage:
 *   node backend/scripts/v41-live-ab.mjs [--skip-a] [--limit N]
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v41-live-contract-composition-ab.json");
const OUT_MD = resolve(OUT_DIR, "V41_LIVE_CONTRACT_COMPOSITION_AB.md");
const OUT_LOG = resolve(OUT_DIR, "v41-live-contract-composition-ab-run.log");

const require = createRequire(join(ROOT, "package.json"));

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 3000;
const DEFAULT_PORT = 5000;
const CONTROL_PROMPT = "dad rock BBQ";

const TENSION_PROBES = [
  { id: "V41-T01", category: "tension", prompt: "sad party bangers" },
  { id: "V41-T02", category: "tension", prompt: "energetic but not cheesy" },
  { id: "V41-T03", category: "tension", prompt: "chilled but not boring" },
  { id: "V41-T04", category: "tension", prompt: "something nostalgic for driving" },
];

const CONTROL_PROBES = [
  { id: "V41-C01", category: "control", prompt: "dad rock BBQ" },
  { id: "V41-C02", category: "control", prompt: "sunset beach reggae" },
  { id: "V41-C03", category: "control", prompt: "2000s pop punk gym workout" },
  { id: "V41-C04", category: "control", prompt: "late night UK garage drive" },
  { id: "V41-C05", category: "control", prompt: "hard techno gym" },
  { id: "V41-C06", category: "control", prompt: "rainy motorway night drive" },
];

const ALL_PROMPTS = [...TENSION_PROBES, ...CONTROL_PROBES];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    skipA: args.includes("--skip-a"),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "999"), 10) : ALL_PROMPTS.length,
  };
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

async function readFullDotEnv() {
  const { readLocalDotEnv } = await import("../dist/lib/benchmark-env-dotenv.js");
  return readLocalDotEnv();
}

async function killLocalPort(port) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.includes("LISTENING")) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && Number(pid) > 0) pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`); } catch { /* ignore */ }
    }
  } catch { /* port free */ }
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch { return false; }
}

async function evalPingOk(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": token },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return data.tokenAccepted === true;
  } catch { return false; }
}

async function spawnApiServer(envOverrides = {}, tokenOverride, { reuseIfReady = false } = {}) {
  const dotenv = await readFullDotEnv();
  const creds = tokenOverride ? { token: tokenOverride } : await resolveCreds();
  const token = creds.token;
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN missing");

  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  if (reuseIfReady && (await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token))) {
    return { server: null, baseUrl, token, reused: true, env: envOverrides };
  }

  await killLocalPort(DEFAULT_PORT);
  await new Promise((r) => setTimeout(r, 2000));

  const env = {
    ...process.env,
    ...dotenv,
    PORT: String(DEFAULT_PORT),
    PLAYLIST_EVAL_TOKEN: token,
    PLAYLIST_CONTRACT_SHADOW: "",
    PLAYLIST_CONTRACT_RETRIEVAL: "",
    PLAYLIST_CONTRACT_VALIDATION: "",
    PLAYLIST_CONTRACT_WORLD_GATE: "",
    PLAYLIST_CONTRACT_V40: "",
    PLAYLIST_CONTRACT_V41: "",
    ...envOverrides,
  };

  const server = spawn(process.execPath, [join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let bootLog = "";
  for (const stream of [server.stderr, server.stdout]) {
    stream?.on("data", (chunk) => {
      bootLog += chunk.toString();
      if (bootLog.length > 8000) bootLog = bootLog.slice(-8000);
    });
  }

  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token))) {
      return { server, baseUrl, token, env: envOverrides };
    }
  }
  server.kill("SIGTERM");
  throw new Error(`API did not become eval-ready${bootLog ? `\n${bootLog.slice(-1200)}` : ""}`);
}

function extractRow(spec, httpStatus, data, arm) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const dl = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const worldGate = data.playlistContractWorldGate ?? null;
  const v41 = data.playlistContractV41 ?? null;
  const v41Rebalance = v41?.rebalance ?? null;
  const v41PoolSelection = v41?.poolSelection ?? null;
  const routing = v3.controlledGeneration?.retrievalLatencyGuard?.v3InputRouting ?? null;

  const funnel = {
    library: num(gd.initialLibrarySize),
    retrieval: num(gd.candidatesSampled),
    contract: num(gd.candidatesAfterIntent),
    v3Input: num(routing?.inputPoolSize) ?? num(dl.v3InputPoolSize),
    v3PreFilter: num(dl.v3PreFilterSurvivors),
    v3Composed: num(dl.v3Composed),
    delivered: (data.tracks ?? []).length,
  };

  const tracks = (data.tracks ?? []).map((t, i) => ({
    position: i + 1,
    trackId: t.trackId ?? t.id ?? null,
    artist: t.artistName ?? t.artist ?? "",
    track: t.trackName ?? t.name ?? "",
    energy: t.energy ?? null,
    valence: t.valence ?? null,
  }));

  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    arm,
    httpStatus,
    success: data.success === true,
    error: data.error ?? null,
    worldGate: worldGate
      ? {
          deferHardLock: worldGate.deferHardLock ?? false,
          deferReasons: worldGate.deferReasons ?? [],
        }
      : null,
    v41: v41
      ? {
          deferHardLock: v41.deferHardLock ?? worldGate?.deferHardLock ?? false,
          compositionAuthority: v41.compositionAuthority ?? null,
          poolSelection: v41PoolSelection,
          rebalance: v41Rebalance,
        }
      : null,
    funnel,
    deliveredTracks: tracks,
  };
}

async function generateOne(baseUrl, token, prompt, arm, id) {
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
        requestId: `v41-ab-${arm}-${id}-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runArm(arm, prompts, baseUrl, token) {
  const rows = [];
  for (const spec of prompts) {
    log(`[${arm}] [${spec.id}] ${spec.prompt}`);
    try {
      const { httpStatus, data } = await generateOne(baseUrl, token, spec.prompt, arm, spec.id);
      const row = extractRow(spec, httpStatus, data, arm);
      rows.push(row);
      log(`  → del=${row.funnel.delivered} defer=${row.v41?.deferHardLock ?? false} rebalanced=${row.v41?.rebalance?.rebalanced ?? "n/a"}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, arm, error: String(err.message ?? err), funnel: {} });
      log(`  ERROR: ${err.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return rows;
}

function trackKey(t) {
  return `${(t.artist ?? "").toLowerCase()}|${(t.track ?? "").toLowerCase()}`;
}

function comparePrompt(aRow, bRow) {
  const aTracks = new Set((aRow.deliveredTracks ?? []).map(trackKey));
  const bTracks = new Set((bRow.deliveredTracks ?? []).map(trackKey));
  const overlap = [...aTracks].filter((k) => bTracks.has(k)).length;
  const union = new Set([...aTracks, ...bTracks]).size || 1;
  return {
    prompt: aRow.prompt,
    category: aRow.category,
    aDelivered: aRow.funnel?.delivered ?? 0,
    bDelivered: bRow.funnel?.delivered ?? 0,
    deltaDelivered: (bRow.funnel?.delivered ?? 0) - (aRow.funnel?.delivered ?? 0),
    deferHardLock: bRow.v41?.deferHardLock ?? bRow.worldGate?.deferHardLock ?? false,
    trackOverlapPct: Math.round((overlap / union) * 1000) / 1000,
    bRebalanced: bRow.v41?.rebalance?.rebalanced ?? false,
    bIntersectionCoverage: bRow.v41?.rebalance?.intersectionCoverage ?? null,
  };
}

function renderMd(payload) {
  const L = [];
  L.push("# V41 Live Contract-Aware Composition A/B");
  L.push("");
  L.push(`**Generated:** ${payload.generatedAt}`);
  L.push(`**Git SHA:** \`${payload.commit}\``);
  L.push("");
  L.push("| Arm | Flags |");
  L.push("|-----|-------|");
  L.push("| A (V37) | all PLAYLIST_CONTRACT_* off |");
  L.push("| B (V41) | `PLAYLIST_CONTRACT_V41=1` only |");
  L.push("");
  L.push(`Prompts: ${payload.promptCount} (${payload.tensionCount} tension + ${payload.controlCount} control)`);
  L.push("");
  L.push(`Deferred (Arm B): ${payload.summary.deferCount}/${payload.promptCount}`);
  L.push(`Rebalanced (Arm B): ${payload.summary.rebalanceCount}/${payload.promptCount}`);
  L.push("");
  for (const c of payload.comparisons.filter((x) => x.category === "tension")) {
    L.push(`- **${c.prompt}**: del ${c.aDelivered}→${c.bDelivered}, defer=${c.deferHardLock}, overlap=${(c.trackOverlapPct * 100).toFixed(0)}%, intersectionCov=${c.bIntersectionCoverage ?? "n/a"}`);
  }
  L.push("");
  L.push(`**Recommendation:** ${payload.recommendation}`);
  return L.join("\n");
}

async function main() {
  const { skipA, limit } = parseArgs();
  const prompts = ALL_PROMPTS.slice(0, limit);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, `\n=== V41 A/B run ${new Date().toISOString()} ===\n`, "utf8");

  log("Building...");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const creds = await resolveCreds();
  let aServer = null;
  let bServer = null;
  let aRows = [];
  let bRows = [];

  try {
    if (!skipA) {
      log("=== ARM A: V37 (all flags off) ===");
      const spawnedA = await spawnApiServer({}, creds.token, { reuseIfReady: false });
      aServer = spawnedA.server;
      aRows = await runArm("A", prompts, spawnedA.baseUrl, spawnedA.token);
      if (aServer) aServer.kill("SIGTERM");
      aServer = null;
      await new Promise((r) => setTimeout(r, 4000));
    }

    log("=== ARM B: V41 composition only ===");
    const spawnedB = await spawnApiServer({ PLAYLIST_CONTRACT_V41: "1" }, creds.token, { reuseIfReady: false });
    bServer = spawnedB.server;
    log(`Control (Arm B): ${CONTROL_PROMPT}`);
    const ctrlRes = await generateOne(spawnedB.baseUrl, spawnedB.token, CONTROL_PROMPT, "b-control", "CTRL");
    const ctrlB = extractRow(
      { id: "CTRL", category: "control", prompt: CONTROL_PROMPT },
      ctrlRes.httpStatus,
      ctrlRes.data,
      "b-control",
    );
    log(`  Control B: del=${ctrlB.funnel.delivered} defer=${ctrlB.v41?.deferHardLock}`);

    bRows = await runArm("B", prompts, spawnedB.baseUrl, spawnedB.token);
    if (bServer) bServer.kill("SIGTERM");
    bServer = null;
  } finally {
    if (aServer) aServer.kill("SIGTERM");
    if (bServer) bServer.kill("SIGTERM");
  }

  const bByPrompt = Object.fromEntries(bRows.map((r) => [r.prompt, r]));
  const aByPrompt = Object.fromEntries(aRows.map((r) => [r.prompt, r]));
  const comparisons = prompts.map((p) =>
    comparePrompt(aByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, funnel: {}, deliveredTracks: [] }, bByPrompt[p.prompt] ?? { prompt: p.prompt, category: p.category, funnel: {}, deliveredTracks: [] }),
  );

  const tensionComparisons = comparisons.filter((c) => c.category === "tension");
  const improvedTension = tensionComparisons.filter((c) => c.deferHardLock && (c.bIntersectionCoverage ?? 0) > 0);
  const recommendation = improvedTension.length >= 2
    ? "PROMISING — composition rebalance active on deferred tension prompts"
    : "INCONCLUSIVE — extend live validation or inspect pool meta attachment";

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    promptCount: prompts.length,
    tensionCount: TENSION_PROBES.length,
    controlCount: CONTROL_PROBES.length,
    configuration: {
      armA: { PLAYLIST_CONTRACT_V41: "0" },
      armB: { PLAYLIST_CONTRACT_V41: "1" },
    },
    arms: { a: aRows, b: bRows },
    comparisons,
    summary: {
      deferCount: bRows.filter((r) => r.v41?.deferHardLock || r.worldGate?.deferHardLock).length,
      rebalanceCount: bRows.filter((r) => r.v41?.rebalance?.rebalanced === true).length,
    },
    recommendation,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_JSON}`);
  log(`Done. defer=${payload.summary.deferCount} rebalance=${payload.summary.rebalanceCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
