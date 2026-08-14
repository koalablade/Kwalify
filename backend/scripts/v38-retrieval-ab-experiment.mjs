#!/usr/bin/env node
/**
 * V38 retrieval A/B experiment — V37 (flags off) vs contract-aware retrieval (B arm).
 *
 * Usage:
 *   node backend/scripts/v38-retrieval-ab-experiment.mjs [--skip-v37] [--limit N]
 *
 * Restarts local API between arms so env flags are isolated.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const V37_BASELINE_JSON = resolve(OUT_DIR, "v37-fresh-validation.json");
const OUT_JSON = resolve(OUT_DIR, "v38-retrieval-ab-experiment.json");
const OUT_MD = resolve(OUT_DIR, "KWALIFY_V38_RETRIEVAL_AB_EXPERIMENT.md");
const OUT_LOG = resolve(OUT_DIR, "v38-retrieval-ab-experiment-internal.log");

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 3000;
const DEFAULT_PORT = 5000;

const CORE_PROMPTS = [
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
];

const EXTRA_PROMPTS = [
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

const ALL_PROMPTS = [...CORE_PROMPTS, ...EXTRA_PROMPTS];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    skipV37: args.includes("--skip-v37"),
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
      try {
        execSync(`taskkill /F /PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* port free */
  }
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
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
  } catch {
    return false;
  }
}

async function spawnApiServer(envOverrides = {}, tokenOverride, { reuseIfReady = false } = {}) {
  const dotenv = await readFullDotEnv();
  const creds = tokenOverride ? { token: tokenOverride } : await resolveCreds();
  const token = creds.token;
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN missing");

  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  if (reuseIfReady && (await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token))) {
    return { server: null, baseUrl, token, reused: true };
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
    ...envOverrides,
  };

  const server = spawn(process.execPath, [join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let bootLog = "";
  server.stderr?.on("data", (chunk) => {
    bootLog += chunk.toString();
    if (bootLog.length > 8000) bootLog = bootLog.slice(-8000);
  });
  server.stdout?.on("data", (chunk) => {
    bootLog += chunk.toString();
    if (bootLog.length > 8000) bootLog = bootLog.slice(-8000);
  });

  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token))) {
      return { server, baseUrl, token };
    }
  }
  server.kill("SIGTERM");
  throw new Error(`API did not become eval-ready${bootLog ? `\n${bootLog.slice(-1200)}` : ""}`);
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
  const playlistContract = data.playlistContract ?? null;

  const find = (name) => mutations.find((m) => m.stage === name);
  const v3Stage = find("v3_handoff");
  const purityStage = find("world_purity_gate");
  const refillStage = find("deliverable_depth_refill");

  const funnel = {
    library: num(gd.initialLibrarySize) ?? num(wf.libraryCount),
    retrieval: num(gd.candidatesSampled) ?? num(wf.retrievalCount),
    contract: num(wf.contractCount) ?? num(gd.candidatesAfterIntent),
    v3Composed: num(dl.v3Composed) ?? v3Stage?.afterCount ?? num(wf.samplerCount),
    prePurity: num(purity.prePurityCount) ?? purityStage?.beforeCount,
    postRefill: refillStage?.afterCount ?? num(purity.postDeliverableDepthRefillCount),
    postPurity: num(dl.postPurity) ?? num(purity.postCheckpointStripCount) ?? purityStage?.afterCount,
    delivered: (data.tracks ?? []).length,
  };

  const falseScarcity =
    (funnel.postPurity ?? 0) >= 20 && (funnel.delivered ?? 0) <= 10;

  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    arm,
    httpStatus,
    success: data.success === true,
    hardLock: committed?.hardLock ?? null,
    funnel,
    delivery: {
      requested: data.requestedLength ?? REQUESTED,
      delivered: funnel.delivered,
      shortfall: REQUESTED - (funnel.delivered ?? 0),
    },
    playlistContract: playlistContract
      ? {
          disagreementCount: playlistContract.disagreementCount ?? null,
          collapseRisk: playlistContract.collapseRisk ?? null,
          retrieval: playlistContract.retrieval ?? null,
        }
      : null,
    falseScarcity,
    hqgOutcome: fin.humanQualityGate?.action ?? data.humanQualityGate?.action ?? null,
  };
}

async function runArm(arm, prompts, baseUrl, token) {
  const rows = [];
  for (const spec of prompts) {
    log(`[${arm}] [${spec.id}] ${spec.prompt}`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
      const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
        body: JSON.stringify({
          vibe: spec.prompt,
          mode: "balanced",
          length: REQUESTED,
          varietyBoost: true,
          auditMode: true,
          spotifyUserId: USER,
          requestId: `v38-ab-${arm}-${spec.id}-${Date.now()}`,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      const row = extractRow(spec, res.status, data, arm);
      rows.push(row);
      log(`  → del=${row.funnel.delivered} postPur=${row.funnel.postPurity} contract=${row.playlistContract?.retrieval ? "yes" : "no"}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, arm, error: String(err.message ?? err), funnel: {} });
      log(`  ERROR: ${err.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return rows;
}

function agg(subset) {
  const delivered = subset.map((r) => r.funnel?.delivered ?? 0);
  const n = delivered.length || 1;
  return {
    count: subset.length,
    avgDelivered: delivered.reduce((s, d) => s + d, 0) / n,
    promptsGte10: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 10).length,
    promptsGte15: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 15).length,
    promptsGte20: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 20).length,
    promptsEq25: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 25).length,
    falseScarcityCount: subset.filter((r) => r.falseScarcity).length,
  };
}

function byCategory(rows) {
  const cats = {};
  for (const r of rows) {
    const c = r.category ?? "unknown";
    if (!cats[c]) cats[c] = [];
    cats[c].push(r);
  }
  return Object.fromEntries(
    Object.entries(cats).map(([k, v]) => [k, agg(v)]),
  );
}

function compareArms(v37Rows, bRows) {
  const bByPrompt = Object.fromEntries(bRows.map((r) => [r.prompt, r]));
  return v37Rows.map((v37) => {
    const b = bByPrompt[v37.prompt];
    const v37Del = v37.funnel?.delivered ?? 0;
    const bDel = b?.funnel?.delivered ?? 0;
    return {
      id: v37.id,
      prompt: v37.prompt,
      category: v37.category,
      v37Delivered: v37Del,
      bDelivered: bDel,
      delta: bDel - v37Del,
      v37PostPurity: v37.funnel?.postPurity,
      bPostPurity: b?.funnel?.postPurity,
      regression: bDel < v37Del - 2,
      improvement: bDel > v37Del + 1,
      bRetrieval: b?.playlistContract?.retrieval ?? null,
      bDisagreements: b?.playlistContract?.disagreementCount ?? null,
    };
  });
}

function evaluateDecision(comparison, v37Agg, bAgg, baselineAgg) {
  const regressions = comparison.filter((c) => c.regression);
  const hardLockRegressions = regressions.filter((c) =>
    ["explicit_genre", "genre_era"].includes(c.category),
  );
  const moodAmbiguous = comparison.filter((c) =>
    ["mood", "ambiguous"].includes(c.category),
  );
  const moodAmbiguousWins = moodAmbiguous.filter((c) => c.improvement).length;
  const overallDelta = bAgg.avgDelivered - v37Agg.avgDelivered;
  const generalisation =
    comparison.filter((c) => c.improvement).length >= 4 &&
    new Set(comparison.filter((c) => c.improvement).map((c) => c.category)).size >= 3;

  let keepB = false;
  let reason = "";

  if (hardLockRegressions.length >= 2) {
    keepB = false;
    reason = `Hard-lock genre regressions on ${hardLockRegressions.length} prompts`;
  } else if (overallDelta < -0.5) {
    keepB = false;
    reason = `Overall delivery regression ${overallDelta.toFixed(1)} tracks/prompt`;
  } else if (generalisation && overallDelta >= 0 && hardLockRegressions.length === 0) {
    keepB = true;
    reason = "Cross-category improvements without hard-lock regressions";
  } else if (moodAmbiguousWins >= 2 && overallDelta >= 0 && hardLockRegressions.length === 0) {
    keepB = true;
    reason = `Mood/ambiguous gains (${moodAmbiguousWins}) with neutral aggregate`;
  } else {
    keepB = false;
    reason = "Insufficient generalisation evidence; genre-specific or flat deltas";
  }

  return { keepB, reason, overallDelta, regressions, hardLockRegressions, moodAmbiguousWins, generalisation };
}

function renderMd(payload) {
  const L = [];
  L.push("# Kwalify V38 Retrieval A/B Experiment");
  L.push("");
  L.push(`**Generated:** ${payload.generatedAt}`);
  L.push(`**Commit:** ${payload.commit}`);
  L.push(`**Historical baseline:** v37-fresh-validation @ ${payload.baselineCommit ?? "unknown"} (${payload.baselineAggregate?.avgDelivered?.toFixed(1) ?? "?"} avg)`);
  L.push("");
  L.push("## 1. Executive summary");
  L.push("");
  L.push(payload.executiveSummary);
  L.push("");
  L.push("## 2. Decision");
  L.push("");
  L.push(`**Recommendation B:** ${payload.decision.keepB ? "KEEP (continue shadow → retrieval)" : "REVERT / hold shadow-only"}`);
  L.push("");
  L.push(`Reason: ${payload.decision.reason}`);
  L.push("");
  L.push("## 3. Aggregate metrics");
  L.push("");
  L.push("| Arm | Avg delivered | ≥10 | ≥15 | =25 | False scarcity |");
  L.push("|---|---:|---:|---:|---:|---:|");
  L.push(`| V37 fresh (flags off) | ${payload.aggregate.v37.avgDelivered.toFixed(1)} | ${payload.aggregate.v37.promptsGte10} | ${payload.aggregate.v37.promptsGte15} | ${payload.aggregate.v37.promptsEq25} | ${payload.aggregate.v37.falseScarcityCount} |`);
  L.push(`| Retrieval B (SHADOW+RETRIEVAL) | ${payload.aggregate.b.avgDelivered.toFixed(1)} | ${payload.aggregate.b.promptsGte10} | ${payload.aggregate.b.promptsGte15} | ${payload.aggregate.b.promptsEq25} | ${payload.aggregate.b.falseScarcityCount} |`);
  L.push(`| Δ B − V37 | ${payload.decision.overallDelta.toFixed(1)} | — | — | — | — |`);
  L.push("");
  L.push("## 4. Category breakdown (avg delivered)");
  L.push("");
  L.push("| Category | V37 | B | Δ |");
  L.push("|---|---:|---:|---:|");
  for (const cat of Object.keys(payload.categoryComparison).sort()) {
    const v = payload.categoryComparison[cat];
    L.push(`| ${cat} | ${v.v37.toFixed(1)} | ${v.b.toFixed(1)} | ${(v.b - v.v37).toFixed(1)} |`);
  }
  L.push("");
  L.push("## 5. Per-prompt comparison");
  L.push("");
  L.push("| ID | Prompt | V37 del | B del | Δ | Regression |");
  L.push("|---|---|---:|---:|---:|:---:|");
  for (const c of payload.comparison) {
    L.push(`| ${c.id} | ${c.prompt.slice(0, 26)} | ${c.v37Delivered} | ${c.bDelivered} | ${c.delta} | ${c.regression ? "⚠" : ""} |`);
  }
  L.push("");
  L.push("## 6. Regressions & failure modes");
  L.push("");
  if (payload.decision.regressions.length === 0) L.push("- No regressions >2 tracks");
  else for (const r of payload.decision.regressions) L.push(`- **${r.prompt}**: ${r.v37Delivered} → ${r.bDelivered} (${r.category})`);
  L.push("");
  L.push("## 7. Tests");
  L.push("");
  for (const t of payload.tests) L.push(`- ${t}`);
  L.push("");
  L.push("## 8. Production safety");
  L.push("");
  L.push("- V37 path unchanged when `PLAYLIST_CONTRACT_*` flags off");
  L.push("- Retrieval rerank only when `PLAYLIST_CONTRACT_RETRIEVAL=1`");
  L.push("- Shadow logging only when `PLAYLIST_CONTRACT_SHADOW=1`");
  L.push("");
  L.push("## 9. Commits / files changed");
  L.push("");
  for (const f of payload.filesChanged) L.push(`- \`${f}\``);
  L.push("");
  return L.join("\n");
}

async function main() {
  const { skipV37, limit } = parseArgs();
  const prompts = ALL_PROMPTS.slice(0, limit);
  log(`V38 retrieval A/B experiment starting (${prompts.length} prompts)`);

  if (!existsSync(join(ROOT, "backend", "dist", "server.js"))) {
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }

  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const creds = await resolveCreds();
  const baseline = existsSync(V37_BASELINE_JSON)
    ? JSON.parse(readFileSync(V37_BASELINE_JSON, "utf8"))
    : null;
  const baselineAgg = baseline ? agg(baseline.rows ?? []) : null;

  let v37Rows = [];
  let bRows = [];
  let v37Server = null;
  let bServer = null;

  try {
    if (!skipV37) {
      log("=== ARM A: V37 (all PLAYLIST_CONTRACT flags off) ===");
      const spawned = await spawnApiServer({}, creds.token, { reuseIfReady: true });
      v37Server = spawned.server;
      v37Rows = await runArm("v37", prompts, spawned.baseUrl, spawned.token);
      if (v37Server) v37Server.kill("SIGTERM");
      v37Server = null;
      await new Promise((r) => setTimeout(r, 3000));
    } else if (baseline?.rows) {
      v37Rows = baseline.rows.map((r) => ({ ...r, arm: "v37-baseline" }));
      log("Skipped fresh V37 arm — using v37-fresh-validation.json");
    }

    log("=== ARM B: contract-aware retrieval (SHADOW+RETRIEVAL) ===");
    const spawnedB = await spawnApiServer({
      PLAYLIST_CONTRACT_SHADOW: "1",
      PLAYLIST_CONTRACT_RETRIEVAL: "1",
    }, creds.token);
    bServer = spawnedB.server;
    bRows = await runArm("retrieval-b", prompts, spawnedB.baseUrl, spawnedB.token);
    if (bServer) bServer.kill("SIGTERM");
    bServer = null;
  } finally {
    if (v37Server) v37Server.kill("SIGTERM");
    if (bServer) bServer.kill("SIGTERM");
  }

  const v37Agg = agg(v37Rows);
  const bAgg = agg(bRows);
  const comparison = compareArms(v37Rows, bRows);
  const decision = evaluateDecision(comparison, v37Agg, bAgg, baselineAgg);

  const categoryComparison = {};
  const cats = new Set([...v37Rows, ...bRows].map((r) => r.category));
  for (const cat of cats) {
    categoryComparison[cat] = {
      v37: agg(v37Rows.filter((r) => r.category === cat)).avgDelivered,
      b: agg(bRows.filter((r) => r.category === cat)).avgDelivered,
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    baselineCommit: baseline?.commit ?? null,
    promptCount: prompts.length,
    requestedLength: REQUESTED,
    arms: {
      v37: { flags: {}, rows: v37Rows },
      retrievalB: {
        flags: { PLAYLIST_CONTRACT_SHADOW: "1", PLAYLIST_CONTRACT_RETRIEVAL: "1" },
        rows: bRows,
      },
    },
    aggregate: { v37: v37Agg, b: bAgg, baseline: baselineAgg },
    categoryComparison,
    comparison,
    decision,
    executiveSummary: decision.keepB
      ? `Retrieval B arm avg ${bAgg.avgDelivered.toFixed(1)}/25 vs V37 ${v37Agg.avgDelivered.toFixed(1)} (Δ ${decision.overallDelta.toFixed(1)}). ${decision.reason}.`
      : `No convincing evidence for retrieval B: V37 ${v37Agg.avgDelivered.toFixed(1)} vs B ${bAgg.avgDelivered.toFixed(1)} (Δ ${decision.overallDelta.toFixed(1)}). ${decision.reason}. Hold shadow-only CI.`,
    filesChanged: [
      "backend/core/playlist-contract/constraint-aware-retrieval.ts",
      "backend/core/playlist-contract/shadow.ts",
      "backend/controllers/generation.controller.ts",
      "backend/tests/playlist-contract.test.ts",
      "backend/scripts/v38-retrieval-ab-experiment.mjs",
    ],
    tests: [],
    reverted: !decision.keepB,
    productionPath: "V37 when all PLAYLIST_CONTRACT_* flags off",
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_MD}`);
  log(`Decision: ${decision.keepB ? "KEEP B" : "HOLD/REVERT B"} — ${decision.reason}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
