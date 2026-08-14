#!/usr/bin/env node
/**
 * V39 live world-gate A/B — V37 (flags off) vs PLAYLIST_CONTRACT_WORLD_GATE=1 only.
 *
 * Usage:
 *   node backend/scripts/v39-live-world-gate-ab.mjs [--skip-a] [--limit N]
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v39-live-world-gate-ab.json");
const OUT_MD = resolve(OUT_DIR, "V39_LIVE_WORLD_GATE_AB.md");
const OUT_LOG = resolve(OUT_DIR, "v39-live-world-gate-ab-run.log");
const MATRIX_V2 = resolve(OUT_DIR, "combinatorial-world-matrix-v2.json");

const require = createRequire(join(ROOT, "package.json"));

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 3000;
const DEFAULT_PORT = 5000;
const CONTROL_PROMPT = "dad rock BBQ";

const ALL_PROMPTS = [
  { id: "V35-01", category: "explicit_genre", prompt: "sunset beach reggae" },
  { id: "V35-02", category: "explicit_genre", prompt: "late night UK garage drive" },
  { id: "V35-03", category: "explicit_genre", prompt: "hard techno gym" },
  { id: "V35-04", category: "genre_era", prompt: "2000s pop punk gym workout" },
  { id: "V35-05", category: "genre_era", prompt: "90s Britpop pub night" },
  { id: "V35-06", category: "genre_era", prompt: "80s synth pop" },
  { id: "V35-07", category: "genre_activity", prompt: "UK grime workout" },
  { id: "V35-08", category: "genre_activity", prompt: "soul Sunday morning" },
  { id: "V35-09", category: "genre_activity", prompt: "drum and bass night drive" },
  { id: "V35-10", category: "mood", prompt: "melancholy indie" },
  { id: "V35-11", category: "mood", prompt: "feel-good soul" },
  { id: "V35-12", category: "mood", prompt: "sad party bangers" },
  { id: "V35-13", category: "context", prompt: "dad rock BBQ" },
  { id: "V35-14", category: "context", prompt: "rainy motorway night drive" },
  { id: "V35-15", category: "ambiguous", prompt: "something nostalgic for driving" },
  { id: "V35-16", category: "ambiguous", prompt: "energetic but not cheesy" },
  { id: "V35-17", category: "ambiguous", prompt: "chilled but not boring" },
  { id: "V35-18", category: "ambiguous", prompt: "music for a sunny Sunday" },
  { id: "V35-19", category: "explicit_genre", prompt: "classic country road trip" },
  { id: "V35-20", category: "explicit_genre", prompt: "deep house afterparty" },
  { id: "V35-21", category: "genre_era", prompt: "70s disco party" },
  { id: "V35-22", category: "genre_activity", prompt: "lo-fi study focus" },
  { id: "V35-23", category: "genre_activity", prompt: "indie gym pump up" },
  { id: "V35-24", category: "mood", prompt: "dark cinematic drive" },
  { id: "V35-25", category: "context", prompt: "morning coffee jazz" },
  { id: "V35-26", category: "context", prompt: "festival warmup EDM" },
  { id: "V35-27", category: "ambiguous", prompt: "songs for cooking dinner" },
  { id: "V35-28", category: "ambiguous", prompt: "late night coding focus" },
];

const TENSION_PROBES = [
  "sad party bangers",
  "energetic but not cheesy",
  "chilled but not boring",
];
const COLLAPSED_PROBES = [
  "sad party bangers",
  "energetic but not cheesy",
  "something nostalgic for driving",
  "deep house afterparty",
  "chilled but not boring",
];
const CONTROL_PROBES = [
  "dad rock BBQ",
  "sunset beach reggae",
  "2000s pop punk gym workout",
  "late night UK garage drive",
  "hard techno gym",
  "rainy motorway night drive",
  "classic country road trip",
  "UK grime workout",
];

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

function mutationStage(mutations, name) {
  return mutations.find((m) => m.stage === name) ?? null;
}

function extractRow(spec, httpStatus, data, arm) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const wf = v3.waterfall ?? gd.waterfall ?? {};
  const dl = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const purity = gd.puritySubFunnel ?? data.puritySubFunnel ?? {};
  const fin = data.finalization ?? {};
  const auth = fin.pipelineAuthority ?? {};
  const mutations = Array.isArray(auth.mutations) ? auth.mutations : [];
  const committed = data.committedWorld ?? gd.committedWorld ?? v3.committedWorld ?? null;
  const worldGate = data.playlistContractWorldGate ?? null;
  const routing = v3.controlledGeneration?.retrievalLatencyGuard?.v3InputRouting ?? null;
  const intentGuard = v3.intentContractGuard ?? {};
  const ccs = intentGuard.candidateCountPerStage ?? {};
  const orch = gd.orchestratorDiagnostics ?? data.orchestratorDiagnostics ?? {};

  const v3Handoff = mutationStage(mutations, "v3_handoff");
  const purityStage = mutationStage(mutations, "world_purity_gate");
  const genreStage = mutationStage(mutations, "genre_consistency");
  const hqgStage = mutationStage(mutations, "human_quality_gate");

  const funnel = {
    library: num(gd.initialLibrarySize) ?? num(wf.libraryCount),
    retrieval: num(gd.candidatesSampled) ?? num(wf.retrievalCount) ?? num(ccs.retrieval),
    retrievalFinal: num(gd.candidatesFinal) ?? num(orch.validCandidateSupply?.strictValidCount),
    contract: num(wf.contractCount) ?? num(gd.candidatesAfterIntent) ?? num(ccs.preRanking),
    v3Input: num(routing?.inputPoolSize) ?? num(dl.v3InputPoolSize),
    v3PreFilter: num(dl.v3PreFilterSurvivors) ?? num(v3.postIntentFilterSurvivors),
    v3Composed: num(dl.v3Composed) ?? v3Handoff?.afterCount ?? num(wf.samplerCount),
    genreConsistency: genreStage?.afterCount ?? null,
    prePurity: num(purity.prePurityCount) ?? purityStage?.beforeCount,
    postPurity: num(dl.postPurity) ?? num(purity.postCheckpointStripCount) ?? purityStage?.afterCount,
    delivered: (data.tracks ?? []).length,
    deliverableRefillPool: num(v3.deliverableRefillPoolSize),
  };

  const tracks = (data.tracks ?? []).map((t, i) => ({
    position: i + 1,
    trackId: t.trackId ?? t.id ?? null,
    artist: t.artistName ?? t.artist ?? "",
    track: t.trackName ?? t.name ?? "",
    genreFamily: t.genreFamily ?? null,
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
    committedWorld: committed ? { id: committed.id, hardLock: committed.hardLock, source: committed.source } : null,
    worldGate: worldGate
      ? {
          originalWorld: worldGate.originalWorld ?? null,
          originalHardLock: worldGate.originalHardLock ?? null,
          deferHardLock: worldGate.deferHardLock ?? false,
          deferReasons: worldGate.deferReasons ?? [],
          retrievalMode: worldGate.retrievalMode ?? null,
          finalWorldMode: worldGate.finalWorldMode ?? null,
        }
      : null,
    funnel,
    falseScarcity: (funnel.postPurity ?? 0) >= 20 && (funnel.delivered ?? 0) <= 10,
    hqgOutcome: fin.humanQualityGate?.action ?? data.humanQualityGate?.action ?? hqgStage?.reason ?? null,
    intentFidelity: fin.intentFidelity?.passed ?? data.intentFidelity?.passed ?? null,
    worldProofFailed: fin.worldProof?.passed === false,
    genreConsistencyFail: data.finalValidation?.genreConsistency === "FAIL" ?? null,
    deliveredTracks: tracks,
    mutations: mutations.map((m) => ({
      stage: m.stage,
      before: m.beforeCount,
      after: m.afterCount,
      removed: m.tracksRemoved,
      reason: m.reason,
    })),
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
        requestId: `v39-ab-${arm}-${id}-${Date.now()}`,
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
      log(`  → del=${row.funnel.delivered} ret=${row.funnel.retrieval} defer=${row.worldGate?.deferHardLock ?? "n/a"} postPur=${row.funnel.postPurity}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, arm, error: String(err.message ?? err), funnel: {} });
      log(`  ERROR: ${err.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return rows;
}

function enrichWithContractAudit(rows) {
  const { buildPlaylistContract } = require("./backend/dist/core/playlist-contract/build-playlist-contract.js");
  const { auditPlaylistAgainstContract } = require("./backend/dist/core/playlist-contract/contract-validator.js");
  const { resolveCommittedWorld } = require("./backend/dist/core/committed-world.js");

  return rows.map((row) => {
    if (!row.success || !row.deliveredTracks?.length) return { ...row, contractAudit: null };
    const world = resolveCommittedWorld({ prompt: row.prompt });
    const contract = buildPlaylistContract({ prompt: row.prompt, committedWorld: world });
    const audit = auditPlaylistAgainstContract(
      row.deliveredTracks.map((t) => ({
        trackId: t.trackId ?? String(t.position),
        trackName: t.track,
        artistName: t.artist,
        genreFamily: t.genreFamily,
        energy: t.energy,
        valence: t.valence,
      })),
      contract,
      REQUESTED,
    );
    return {
      ...row,
      contractAudit: {
        mustViolationCount: audit.mustViolationCount,
        softViolationCount: audit.softViolationCount,
        pass: audit.pass,
        honestPartial: audit.honestPartial,
        unsatisfiable: audit.unsatisfiableConstraints,
        tensionCount: contract.tension.length,
      },
    };
  });
}

function trackKey(t) {
  return `${(t.artist ?? "").toLowerCase()}|${(t.track ?? "").toLowerCase()}`;
}

function semanticProxy(tracks, prompt) {
  const lower = prompt.toLowerCase();
  const indieChill = /\b(wallows|1975|clairo|phoebe|bon iver|acoustic|folk)\b/i;
  const party = /\b(dance|club|banger|party|disco|house|techno|dnb|drum|garage|grime|punk|rock|metal|edm|pop punk)\b/i;
  let wrongWorld = 0;
  let partyLike = 0;
  let sadLike = 0;
  for (const t of tracks) {
    const label = `${t.artist} ${t.track}`;
    if (lower.includes("party") || lower.includes("banger")) {
      if (indieChill.test(label) && !party.test(label)) wrongWorld += 1;
      if (party.test(label)) partyLike += 1;
      if ((t.energy ?? 0.5) < 0.45 || (t.valence ?? 0.5) < 0.35) sadLike += 1;
    }
    if (lower.includes("deep house") && !/\bhouse|deep|disco|electronic|techno\b/i.test(label)) wrongWorld += 1;
    if (lower.includes("not cheesy") && /\bcheesy|kidz bop|abba cover\b/i.test(label)) wrongWorld += 1;
  }
  return { wrongWorldCount: wrongWorld, partyLike, sadLike, trackCount: tracks.length };
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
    aRetrieval: aRow.funnel?.retrieval,
    bRetrieval: bRow.funnel?.retrieval,
    deltaRetrieval: (bRow.funnel?.retrieval ?? 0) - (aRow.funnel?.retrieval ?? 0),
    aV3Input: aRow.funnel?.v3Input,
    bV3Input: bRow.funnel?.v3Input,
    deferHardLock: bRow.worldGate?.deferHardLock ?? false,
    deferReasons: bRow.worldGate?.deferReasons ?? [],
    trackOverlap: overlap,
    trackUnion: union,
    trackOverlapPct: Math.round((overlap / union) * 1000) / 1000,
    aFalseScarcity: aRow.falseScarcity,
    bFalseScarcity: bRow.falseScarcity,
    aMustViol: aRow.contractAudit?.mustViolationCount ?? null,
    bMustViol: bRow.contractAudit?.mustViolationCount ?? null,
    aSemantic: semanticProxy(aRow.deliveredTracks ?? [], aRow.prompt),
    bSemantic: semanticProxy(bRow.deliveredTracks ?? [], bRow.prompt),
    aHqg: aRow.hqgOutcome,
    bHqg: bRow.hqgOutcome,
    poolChanged: (bRow.funnel?.retrieval ?? 0) !== (aRow.funnel?.retrieval ?? 0)
      || (bRow.funnel?.v3Input ?? 0) !== (aRow.funnel?.v3Input ?? 0),
  };
}

function agg(rows) {
  const n = rows.length || 1;
  const delivered = rows.map((r) => r.funnel?.delivered ?? 0);
  return {
    count: rows.length,
    avgDelivered: delivered.reduce((s, d) => s + d, 0) / n,
    falseScarcity: rows.filter((r) => r.falseScarcity).length,
    avgMustViol: rows.filter((r) => r.contractAudit).reduce((s, r) => s + (r.contractAudit?.mustViolationCount ?? 0), 0) / n,
    deferCount: rows.filter((r) => r.worldGate?.deferHardLock).length,
  };
}

function classifyFailure(comparisons, deferred) {
  const deferredWithPoolChange = deferred.filter((c) => c.poolChanged);
  const deferredNoPoolChange = deferred.filter((c) => c.deferHardLock && !c.poolChanged);
  const semanticImproved = deferred.filter(
    (c) => (c.bSemantic?.wrongWorldCount ?? 99) < (c.aSemantic?.wrongWorldCount ?? 99),
  );
  const semanticRegressed = deferred.filter(
    (c) => (c.bSemantic?.wrongWorldCount ?? 0) > (c.aSemantic?.wrongWorldCount ?? 0),
  );

  if (deferredNoPoolChange.length > deferredWithPoolChange.length) return "A";
  if (deferredWithPoolChange.length > 0 && semanticImproved.length === 0) return "D";
  if (semanticRegressed.length > semanticImproved.length) return "G";
  if (deferredWithPoolChange.length > 0 && semanticImproved.length > 0) return "supported_partial";
  return "G";
}

function renderMd(payload) {
  const L = [];
  L.push("# V39 Live World Gate A/B");
  L.push("");
  L.push(`**Generated:** ${payload.generatedAt}`);
  L.push(`**Git SHA:** \`${payload.commit}\``);
  L.push(`**Uncommitted V39 files:** ${payload.uncommittedV39 ? "yes (world-gate prototype)" : "no"}`);
  L.push("");
  L.push("## Configuration");
  L.push("");
  L.push("| Arm | Flags |");
  L.push("|-----|-------|");
  L.push("| A (V37) | all PLAYLIST_CONTRACT_* off |");
  L.push("| B (V39) | `PLAYLIST_CONTRACT_WORLD_GATE=1` only |");
  L.push("");
  L.push(`Prompts: ${payload.promptCount}`);
  L.push("");
  L.push("## Live defer rate (Arm B)");
  L.push("");
  L.push(`- Deferred: ${payload.summary.deferCount}/${payload.promptCount} (${(payload.summary.deferRate * 100).toFixed(1)}%)`);
  L.push(`- Offline matrix defer (reference): ${payload.offlineMatrixDeferRate != null ? `${(payload.offlineMatrixDeferRate * 100).toFixed(1)}%` : "n/a"}`);
  L.push("");
  L.push("## Aggregate");
  L.push("");
  L.push("| Metric | Arm A | Arm B | Δ |");
  L.push("|--------|------:|------:|--:|");
  L.push(`| Avg delivered | ${payload.aggregate.a.avgDelivered.toFixed(1)} | ${payload.aggregate.b.avgDelivered.toFixed(1)} | ${(payload.aggregate.b.avgDelivered - payload.aggregate.a.avgDelivered).toFixed(1)} |`);
  L.push(`| False scarcity | ${payload.aggregate.a.falseScarcity} | ${payload.aggregate.b.falseScarcity} | ${payload.aggregate.b.falseScarcity - payload.aggregate.a.falseScarcity} |`);
  L.push(`| Avg MUST violations | ${payload.aggregate.a.avgMustViol.toFixed(2)} | ${payload.aggregate.b.avgMustViol.toFixed(2)} | — |`);
  L.push("");
  L.push("## Category breakdown");
  L.push("");
  L.push("| Category | A avg del | B avg del | B defer |");
  L.push("|----------|----------:|----------:|--------:|");
  for (const [cat, v] of Object.entries(payload.byCategory)) {
    L.push(`| ${cat} | ${v.aAvg.toFixed(1)} | ${v.bAvg.toFixed(1)} | ${v.bDefer} |`);
  }
  L.push("");
  L.push("## Critical: deferred prompts pool delta");
  L.push("");
  for (const c of payload.comparisons.filter((x) => x.deferHardLock)) {
    L.push(`### ${c.prompt}`);
    L.push(`- Defer reasons: ${c.deferReasons.join(", ")}`);
    L.push(`- Retrieval A→B: ${c.aRetrieval} → ${c.bRetrieval} (Δ ${c.deltaRetrieval})`);
    L.push(`- V3 input A→B: ${c.aV3Input} → ${c.bV3Input}`);
    L.push(`- Track overlap: ${(c.trackOverlapPct * 100).toFixed(0)}%`);
    L.push(`- Wrong-world proxy A→B: ${c.aSemantic.wrongWorldCount} → ${c.bSemantic.wrongWorldCount}`);
    L.push(`- Delivered A→B: ${c.aDelivered} → ${c.bDelivered}`);
    L.push("");
  }
  L.push("## Control regressions");
  L.push("");
  for (const c of payload.controlComparisons) {
    L.push(`- **${c.prompt}**: del ${c.aDelivered}→${c.bDelivered}, defer=${c.deferHardLock}, overlap=${(c.trackOverlapPct * 100).toFixed(0)}%`);
  }
  L.push("");
  L.push("## Failure classification");
  L.push("");
  L.push(`**Class:** ${payload.failureClass}`);
  L.push("");
  L.push(`**Hypothesis supported:** ${payload.hypothesisSupported ? "PARTIAL / YES (see details)" : "NO / INCONCLUSIVE"}`);
  L.push("");
  L.push(`**Recommendation:** ${payload.recommendation}`);
  L.push("");
  L.push("## Next step");
  L.push("");
  L.push(payload.nextStep);
  L.push("");
  return L.join("\n");
}

async function main() {
  const { skipA, limit } = parseArgs();
  const prompts = ALL_PROMPTS.slice(0, limit);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, `\n=== V39 A/B run ${new Date().toISOString()} ===\n`, "utf8");

  log("Building...");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const uncommittedV39 = existsSync(join(ROOT, "backend/core/playlist-contract/world-gate.ts"))
    && execSync("git status --porcelain backend/core/playlist-contract/world-gate.ts", { cwd: ROOT, encoding: "utf8" }).trim().length > 0;

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
      log(`Arm A flags: WORLD_GATE=${spawnedA.env?.PLAYLIST_CONTRACT_WORLD_GATE ?? "off"}`);

      log("Control request (Arm A): dad rock BBQ");
      const ctrlResA = await generateOne(spawnedA.baseUrl, spawnedA.token, CONTROL_PROMPT, "a-control", "CTRL");
      const ctrlA = extractRow(
        { id: "CTRL", category: "control", prompt: CONTROL_PROMPT },
        ctrlResA.httpStatus,
        ctrlResA.data,
        "a-control",
      );
      log(`  Control A: del=${ctrlA.funnel.delivered} world=${ctrlA.committedWorld?.id} hl=${ctrlA.committedWorld?.hardLock}`);

      aRows = await runArm("A", prompts, spawnedA.baseUrl, spawnedA.token);
      aRows = enrichWithContractAudit(aRows);
      if (aServer) aServer.kill("SIGTERM");
      aServer = null;
      await new Promise((r) => setTimeout(r, 4000));
    }

    log("=== ARM B: V39 WORLD_GATE only ===");
    const spawnedB = await spawnApiServer({ PLAYLIST_CONTRACT_WORLD_GATE: "1" }, creds.token, { reuseIfReady: false });
    bServer = spawnedB.server;
    log(`Arm B flags: WORLD_GATE=${spawnedB.env?.PLAYLIST_CONTRACT_WORLD_GATE}`);

    log("Control request (Arm B): dad rock BBQ");
    const ctrlRes = await generateOne(spawnedB.baseUrl, spawnedB.token, CONTROL_PROMPT, "b-control", "CTRL");
    const ctrlB = extractRow(
      { id: "CTRL", category: "control", prompt: CONTROL_PROMPT },
      ctrlRes.httpStatus,
      ctrlRes.data,
      "b-control",
    );
    log(`  Control B: del=${ctrlB.funnel.delivered} defer=${ctrlB.worldGate?.deferHardLock} world=${ctrlB.committedWorld?.id}`);

    bRows = await runArm("B", prompts, spawnedB.baseUrl, spawnedB.token);
    bRows = enrichWithContractAudit(bRows);
    if (bServer) bServer.kill("SIGTERM");
    bServer = null;
  } finally {
    if (aServer) aServer.kill("SIGTERM");
    if (bServer) bServer.kill("SIGTERM");
  }

  const bByPrompt = Object.fromEntries(bRows.map((r) => [r.prompt, r]));
  const aByPrompt = Object.fromEntries(aRows.map((r) => [r.prompt, r]));
  const comparisons = aRows.map((a) => comparePrompt(a, bByPrompt[a.prompt] ?? { prompt: a.prompt, funnel: {}, deliveredTracks: [] }));
  const controlComparisons = CONTROL_PROBES.map((p) => comparePrompt(aByPrompt[p] ?? { prompt: p }, bByPrompt[p] ?? { prompt: p }));

  const deferred = comparisons.filter((c) => c.deferHardLock);
  const poolChangedDeferred = deferred.filter((c) => c.poolChanged);
  const semanticWins = deferred.filter((c) => (c.bSemantic?.wrongWorldCount ?? 99) < (c.aSemantic?.wrongWorldCount ?? 99));
  const controlRegressions = controlComparisons.filter(
    (c) => c.bDelivered < c.aDelivered - 2 || (c.deferHardLock && CONTROL_PROBES.includes(c.prompt)),
  );

  let offlineMatrixDeferRate = null;
  if (existsSync(MATRIX_V2)) {
    try {
      const { evaluateWorldGate } = require("./backend/dist/core/playlist-contract/world-gate.js");
      const { buildPlaylistContract } = require("./backend/dist/core/playlist-contract/build-playlist-contract.js");
      const { compareContractWithWorld } = require("./backend/dist/core/playlist-contract/compare-with-world.js");
      const { resolveCommittedWorld } = require("./backend/dist/core/committed-world.js");
      const matrix = JSON.parse(readFileSync(MATRIX_V2, "utf8"));
      const items = matrix.results ?? matrix.rows ?? [];
      let defer = 0;
      for (const item of items) {
        const prompt = item.prompt;
        const world = resolveCommittedWorld({ prompt });
        const contract = buildPlaylistContract({ prompt, committedWorld: world });
        const disagreements = compareContractWithWorld(contract, world);
        if (evaluateWorldGate({ contract, world, disagreements }).deferHardLock) defer += 1;
      }
      offlineMatrixDeferRate = items.length ? defer / items.length : null;
    } catch { /* ignore */ }
  }

  const failureClass = classifyFailure(comparisons, deferred);
  const hypothesisSupported =
    poolChangedDeferred.length >= 2
    && semanticWins.length >= 2
    && controlRegressions.length === 0;

  let recommendation = "KEEP OFF — do not promote V39";
  let nextStep = "Diagnose next architectural seam from failure class.";
  if (hypothesisSupported) {
    recommendation = "PROMISING — keep flag off in production; extend live validation";
    nextStep = "Run downstream authority audit: if purity/proof still enforce deferred world, gate validation next.";
  } else if (poolChangedDeferred.length === 0 && deferred.length > 0) {
    recommendation = "REDESIGN — gate defers metadata but pool unchanged";
    nextStep = "Investigate retrieval pipeline re-resolve of CommittedWorld (failure class A).";
  } else if (controlRegressions.length > 0) {
    recommendation = "REDESIGN gate selectivity";
    nextStep = "Tighten explicit_musical agreement path without prompt-specific rules.";
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    uncommittedV39,
    promptCount: prompts.length,
    configuration: {
      armA: { PLAYLIST_CONTRACT_WORLD_GATE: "0", PLAYLIST_CONTRACT_RETRIEVAL: "0", PLAYLIST_CONTRACT_SHADOW: "0" },
      armB: { PLAYLIST_CONTRACT_WORLD_GATE: "1", PLAYLIST_CONTRACT_RETRIEVAL: "0", PLAYLIST_CONTRACT_SHADOW: "0" },
    },
    arms: { a: aRows, b: bRows },
    comparisons,
    controlComparisons,
    summary: {
      deferCount: bRows.filter((r) => r.worldGate?.deferHardLock).length,
      deferRate: bRows.filter((r) => r.worldGate?.deferHardLock).length / Math.max(1, prompts.length),
      poolChangedDeferred: poolChangedDeferred.length,
      semanticWinsOnDeferred: semanticWins.length,
      controlRegressions: controlRegressions.length,
    },
    aggregate: { a: agg(aRows), b: agg(bRows) },
    byCategory: Object.fromEntries(
      [...new Set(prompts.map((p) => p.category))].map((cat) => {
        const aSub = aRows.filter((r) => r.category === cat);
        const bSub = bRows.filter((r) => r.category === cat);
        const aAvg = aSub.length ? aSub.reduce((s, r) => s + (r.funnel?.delivered ?? 0), 0) / aSub.length : 0;
        const bAvg = bSub.length ? bSub.reduce((s, r) => s + (r.funnel?.delivered ?? 0), 0) / bSub.length : 0;
        return [cat, { aAvg, bAvg, bDefer: bSub.filter((r) => r.worldGate?.deferHardLock).length, count: aSub.length }];
      }),
    ),
    offlineMatrixDeferRate,
    failureClass,
    hypothesisSupported,
    recommendation,
    nextStep,
    tensionAnalysis: TENSION_PROBES.map((p) => comparisons.find((c) => c.prompt === p)).filter(Boolean),
    collapsedAnalysis: COLLAPSED_PROBES.map((p) => comparisons.find((c) => c.prompt === p)).filter(Boolean),
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_JSON}`);
  log(`Wrote ${OUT_MD}`);
  log(`Done. Defer=${payload.summary.deferCount} poolChanged=${payload.summary.poolChangedDeferred} semanticWins=${payload.summary.semanticWinsOnDeferred}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
