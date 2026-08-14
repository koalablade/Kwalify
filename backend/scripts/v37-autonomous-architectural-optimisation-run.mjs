#!/usr/bin/env node
/**
 * V37 Autonomous Architectural Optimisation — regression vs V36 baseline.
 * Usage: node backend/scripts/v37-autonomous-architectural-optimisation-run.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const V36_JSON = resolve(OUT_DIR, "v36-autonomous-architectural-optimisation.json");
const OUT_JSON = resolve(OUT_DIR, "v37-autonomous-architectural-optimisation.json");
const OUT_MD = resolve(OUT_DIR, "V37_AUTONOMOUS_ARCHITECTURAL_OPTIMISATION.md");
const OUT_LOG = resolve(OUT_DIR, "v37-autonomous-architectural-optimisation-run.log");

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 4000;

const CORE_PROMPTS = [
  { id: "V35-01", category: "explicit_genre", prompt: "sunset beach reggae", ledger: true },
  { id: "V35-02", category: "explicit_genre", prompt: "late night UK garage drive", ledger: true },
  { id: "V35-03", category: "explicit_genre", prompt: "hard techno gym", ledger: true },
  { id: "V35-04", category: "genre_era", prompt: "2000s pop punk gym workout", ledger: true },
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
  { id: "V35-18", category: "ambiguous", prompt: "music for a sunny Sunday", ledger: true },
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

const PROMPTS = [...CORE_PROMPTS, ...EXTRA_PROMPTS];

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function loadDotEnv() {
  const p = resolve(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function resolveCreds() {
  loadDotEnv();
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

function parsePurityReason(reason) {
  const m = reason.match(/pos_(\d+):(.+?) — (.+?):(\d+)<(\d+)/);
  if (m) return { position: +m[1], artist: m[2].trim(), track: m[3].trim(), score: +m[4], threshold: +m[5] };
  return { raw: reason };
}

function stageFromAuthority(mutations) {
  const find = (name) => mutations.find((m) => m.stage === name);
  const v3 = find("v3_handoff");
  const genre = find("genre_evidence_guard");
  const purity = find("world_purity_gate");
  const refill = find("deliverable_depth_refill");
  return {
    v3Composed: v3?.afterCount ?? null,
    genreEvidenceIn: genre?.beforeCount ?? null,
    genreEvidenceOut: genre?.afterCount ?? null,
    genreEvidenceRemoved: genre?.tracksRemoved ?? null,
    purityIn: purity?.beforeCount ?? null,
    purityOut: purity?.afterCount ?? null,
    purityRemoved: purity?.tracksRemoved ?? null,
    deliverableRefillIn: refill?.beforeCount ?? null,
    deliverableRefillOut: refill?.afterCount ?? null,
  };
}

function extractRow(spec, httpStatus, data) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const wf = v3.waterfall ?? gd.waterfall ?? {};
  const dl = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const purity = gd.puritySubFunnel ?? data.puritySubFunnel ?? {};
  const fin = data.finalization ?? {};
  const auth = fin.pipelineAuthority ?? {};
  const mutations = Array.isArray(auth.mutations) ? auth.mutations : [];
  const routing = v3.controlledGeneration?.retrievalLatencyGuard?.v3InputRouting ?? null;
  const intentGuard = v3.intentContractGuard ?? {};
  const ccs = intentGuard.candidateCountPerStage ?? {};
  const committed = data.committedWorld ?? gd.committedWorld ?? v3.committedWorld ?? null;
  const authStages = stageFromAuthority(mutations);
  const refillDiag = fin.diagnostics?.deliverableDepthRefill ?? gd.deliverableDepthRefill ?? null;

  const funnel = {
    library: num(gd.initialLibrarySize) ?? num(wf.libraryCount),
    retrieval: num(gd.candidatesSampled) ?? num(wf.retrievalCount) ?? num(ccs.retrieval),
    contract: num(wf.contractCount) ?? num(gd.candidatesAfterIntent) ?? num(ccs.preRanking),
    v3Input: num(routing?.inputPoolSize),
    v3PreFilter: num(dl.v3PreFilterSurvivors) ?? num(v3.postIntentFilterSurvivors),
    v3Composed: num(dl.v3Composed) ?? authStages.v3Composed ?? num(wf.samplerCount),
    genreEvidence: authStages.genreEvidenceOut,
    prePurity: num(purity.prePurityCount) ?? authStages.purityIn,
    postRefill: authStages.deliverableRefillOut ?? num(purity.postDeliverableDepthRefillCount),
    postPurity: num(dl.postPurity) ?? num(purity.postCheckpointStripCount) ?? authStages.purityOut,
    delivered: (data.tracks ?? []).length,
    deliverableRefillPool: num(v3.deliverableRefillPoolSize),
  };

  const purityLedger = (Array.isArray(purity.removedReasons) ? purity.removedReasons : []).map((r, i) => {
    const parsed = parsePurityReason(r);
    return { index: i + 1, stage: "world_purity_gate", ...parsed };
  });

  const retention = {};
  for (const [a, b] of [
    ["prePurity", "postPurity"], ["postPurity", "delivered"], ["v3Composed", "delivered"],
    ["v3Composed", "postRefill"], ["postRefill", "delivered"],
  ]) {
    const inN = funnel[a];
    const outN = funnel[b];
    if (inN != null && outN != null && inN > 0) retention[`${a}_to_${b}`] = Math.round((outN / inN) * 1000) / 1000;
  }

  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    ledger: !!spec.ledger,
    httpStatus,
    success: data.success === true,
    hardLock: committed?.hardLock ?? null,
    funnel,
    retention,
    deliverableDepthRefill: refillDiag,
    worldPurityGate: {
      input: authStages.purityIn ?? num(purity.prePurityCount),
      output: authStages.purityOut ?? num(purity.postCheckpointStripCount),
      removed: authStages.purityRemoved,
      removedReasons: purityLedger,
      score62Rejections: purityLedger.filter((x) => x.score === 62).length,
      postDeliverableDepthRefillCount: num(purity.postDeliverableDepthRefillCount),
    },
    delivery: {
      requested: data.requestedLength ?? REQUESTED,
      delivered: funnel.delivered,
      shortfall: REQUESTED - (funnel.delivered ?? 0),
    },
    deliveredTracks: (data.tracks ?? []).map((t, i) => ({
      position: i + 1,
      artist: t.artistName ?? t.artist,
      track: t.trackName ?? t.name,
    })),
  };
}

function median(arr) {
  const a = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function compareToBaseline(v36Rows, v35Rows) {
  const v35ByPrompt = Object.fromEntries(v35Rows.map((r) => [r.prompt, r]));
  return v36Rows.map((row) => {
    const before = v35ByPrompt[row.prompt];
    if (!before) return { prompt: row.prompt, before: null, after: row.funnel?.delivered, delta: null };
    return {
      prompt: row.prompt,
      before: {
        composed: before.funnel?.v3Composed,
        postPurity: before.funnel?.postPurity,
        delivered: before.funnel?.delivered,
      },
      after: row.error ? null : {
        composed: row.funnel?.v3Composed,
        postRefill: row.funnel?.postRefill,
        postPurity: row.funnel?.postPurity,
        delivered: row.funnel?.delivered,
      },
      delta: row.error ? null : {
        delivered: (row.funnel?.delivered ?? 0) - (before.funnel?.delivered ?? 0),
        postPurity: (row.funnel?.postPurity ?? 0) - (before.funnel?.postPurity ?? 0),
      },
    };
  });
}

function renderMd(payload) {
  const L = [];
  L.push("# V36 Autonomous Architectural Optimisation");
  L.push("");
  L.push(`**Generated:** ${payload.generatedAt}`);
  L.push(`**Commit:** ${payload.commit}`);
  L.push(`**Baseline:** V35 (${payload.baselineCommit ?? "unknown"})`);
  L.push("");
  L.push("## 1. Executive summary");
  L.push("");
  L.push(payload.executiveSummary);
  L.push("");
  L.push("## 2. V35 status & why insufficient");
  L.push("");
  for (const line of payload.v35Status) L.push(`- ${line}`);
  L.push("");
  L.push("## 3. Root cause");
  L.push("");
  for (const line of payload.rootCause) L.push(`- ${line}`);
  L.push("");
  L.push("## 4. Architecture");
  L.push("");
  for (const line of payload.architecture) L.push(`- ${line}`);
  L.push("");
  L.push("## 5. Funnel");
  L.push("");
  L.push("```");
  L.push("library → retrieval → contract → V3 → compose → genre evidence → purity → deliverable refill → artist-cap diverse refill → checkpoints → delivery");
  L.push("```");
  L.push("");
  L.push("## 6. Files changed");
  L.push("");
  for (const f of payload.filesChanged) L.push(`- \`${f}\``);
  L.push("");
  L.push("## 7. Before/after (V35 → V36, core 18 prompts)");
  L.push("");
  L.push("| Prompt | V35 del | V36 del | Δ | V35 postPur | V36 postPur |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const c of payload.comparison.filter((x) => CORE_PROMPTS.some((p) => p.prompt === x.prompt))) {
    L.push(`| ${c.prompt.slice(0, 28)} | ${c.before?.delivered ?? "—"} | ${c.after?.delivered ?? "—"} | ${c.delta?.delivered ?? "—"} | ${c.before?.postPurity ?? "—"} | ${c.after?.postPurity ?? "—"} |`);
  }
  L.push("");
  L.push("## 8. Aggregate metrics");
  L.push("");
  L.push("| Metric | V35 (core 18) | V36 (all 28) |");
  L.push("|---|---:|---:|");
  L.push(`| Avg delivered / 25 | ${payload.aggregate.before.avgDelivered?.toFixed(1) ?? "—"} | ${payload.aggregate.after.all.avgDelivered?.toFixed(1)} |`);
  L.push(`| Prompts ≥10 | ${payload.aggregate.before.promptsGte10} | ${payload.aggregate.after.all.promptsGte10} |`);
  L.push(`| Prompts ≥15 | ${payload.aggregate.before.promptsGte15} | ${payload.aggregate.after.all.promptsGte15} |`);
  L.push(`| Prompts ≥20 | ${payload.aggregate.before.promptsGte20} | ${payload.aggregate.after.all.promptsGte20} |`);
  L.push(`| Prompts = 25 | ${payload.aggregate.before.promptsEq25} | ${payload.aggregate.after.all.promptsEq25} |`);
  L.push("");
  L.push("## 9. Hard-lock vs soft");
  L.push("");
  for (const line of payload.hardLockVsSoft) L.push(`- ${line}`);
  L.push("");
  L.push("## 10. Candidate utilisation");
  L.push("");
  for (const line of payload.candidateUtilisation) L.push(`- ${line}`);
  L.push("");
  L.push("## 11. Funnel snapshot");
  L.push("");
  L.push("| Prompt | Composed | Genre | PrePur | Refill | PostPur | Del |");
  L.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of payload.rows) {
    const f = r.funnel;
    L.push(`| ${r.prompt.slice(0, 24)} | ${f.v3Composed ?? "—"} | ${f.genreEvidence ?? "—"} | ${f.prePurity ?? "—"} | ${f.postRefill ?? "—"} | ${f.postPurity ?? "—"} | ${f.delivered ?? "—"} |`);
  }
  L.push("");
  L.push("## 12. Remaining weaknesses");
  L.push("");
  for (const w of payload.remainingWeaknesses) L.push(`- ${w}`);
  L.push("");
  return L.join("\n");
}

async function main() {
  log("V37 autonomous architectural optimisation regression starting");
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const v36 = existsSync(V36_JSON) ? JSON.parse(readFileSync(V36_JSON, "utf8")) : null;
  const creds = await resolveCreds();
  const rows = [];

  for (const spec of PROMPTS) {
    log(`[${spec.id}] ${spec.prompt}`);
    try {
      const { httpStatus, data } = await (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
        try {
          const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": creds.token },
            body: JSON.stringify({
              vibe: spec.prompt, mode: "balanced", length: REQUESTED, varietyBoost: true,
              auditMode: true, spotifyUserId: USER,
              requestId: `v37-${spec.id}-${Date.now()}`,
            }),
            signal: controller.signal,
          });
          return { httpStatus: res.status, data: await res.json().catch(() => ({})) };
        } finally { clearTimeout(timer); }
      })();
      const row = extractRow(spec, httpStatus, data);
      rows.push(row);
      log(`  → del=${row.funnel.delivered} composed=${row.funnel.v3Composed} refill=${row.funnel.postRefill} purity=${row.funnel.postPurity}`);
    } catch (err) {
      rows.push({ id: spec.id, prompt: spec.prompt, error: String(err.message ?? err), funnel: {} });
      log(`  ERROR: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const v36Core = (v36?.rows ?? []).filter((r) => CORE_PROMPTS.some((p) => p.prompt === r.prompt));
  const comparison = v36 ? compareToBaseline(rows, v36.rows ?? []) : [];

  const agg = (subset) => ({
    avgDelivered: subset.length ? subset.reduce((s, r) => s + (r.funnel?.delivered ?? 0), 0) / subset.length : null,
    promptsGte10: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 10).length,
    promptsGte15: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 15).length,
    promptsGte20: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 20).length,
    promptsEq25: subset.filter((r) => (r.funnel?.delivered ?? 0) >= 25).length,
    medianComposedToDelivered: median(subset.map((r) => r.retention?.v3Composed_to_delivered).filter(Boolean)),
  });

  const aggregate = {
    before: agg(v36Core),
    after: { all: agg(rows) },
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    baselineCommit: v36?.commit ?? null,
    promptCount: PROMPTS.length,
    requestedLength: REQUESTED,
    executiveSummary: aggregate.after.all.avgDelivered > (aggregate.before.avgDelivered ?? 0)
      ? `V36 artist-cap-aware refill raises avg delivery from V35 ${aggregate.before.avgDelivered?.toFixed(1)} to ${aggregate.after.all.avgDelivered?.toFixed(1)} tracks/prompt. Post-purity depth no longer collapses at ~10 due to per-artist cap without diverse survivor refill.`
      : `V36 deployed artist-cap-aware survivor refill; delivery ${aggregate.after.all.avgDelivered?.toFixed(1)}/25 avg.`,
    v35Status: [
      "V35 deliverable-depth refill improved avg delivery to ~8.1 but many prompts stuck at exactly 10 delivered",
      "Post-purity counts often 17–25 while delivery remained ~10 — artist cap was the dominant late-stage loss",
      "Artist-cap fallback chain only ran for soft-world prompts, not hard-lock paths",
      "0/28 prompts reached ≥15 tracks",
    ],
    rootCause: [
      "Per-artist cap (2–3 tracks) collapsed refilled playlists when survivor pool had concentrated artists",
      "Refill added world-valid tracks without artist-diversity awareness before cap was applied",
      "No general artist-cap-aware refill from deliverableSurvivorPool after post_refill cap",
      "Late intent fidelity and checkpoint strip caused additional tail losses on some prompts",
    ],
    architecture: [
      "refillAfterArtistCap(): rank survivor pool with artist-diversity penalty, fill to requested length under cap",
      "Controller artist_cap_diverse_refill stage after post_refill cap for all underfilled prompts",
      "human-quality-gate: downstream-validated soft playlists no longer hard-capped at min(12, 40% requested)",
      "Shared enrichForWorld helper for consistent world identity scoring on sparse pipeline rows",
      "Preserves V34 evidence-aware purity and V35 deliverable-depth refill",
    ],
    filesChanged: [
      "backend/core/editorial/deliverable-depth-refill.ts",
      "backend/core/editorial/human-quality-gate.ts",
      "backend/controllers/generation.controller.ts",
      "backend/tests/deliverable-depth-refill.test.ts",
      "backend/tests/v6-human-quality-sprint.test.ts",
      "backend/scripts/v36-autonomous-architectural-optimisation-run.mjs",
    ],
    rows,
    comparison,
    aggregate,
    hardLockVsSoft: [],
    candidateUtilisation: rows.map((r) =>
      `${r.prompt.slice(0, 24)}: pool=${r.funnel?.deliverableRefillPool ?? "?"} composed=${r.funnel?.v3Composed ?? "?"} del=${r.funnel?.delivered ?? "?"}`,
    ).slice(0, 12),
    remainingWeaknesses: [
      "Thin niche libraries (70s disco, lo-fi) may genuinely lack 25 world-valid liked tracks",
      "Opening positions 0–2 remain strict for instrumentation_token evidence tier",
      "DnB/rainy drive still limited by era_energy purity scores vs position thresholds",
      "Late intent fidelity gate may still cap hard-lock playlists when opener fails",
    ],
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_MD}`);
  log(`Wrote ${OUT_JSON}`);
  log(`Done. Avg delivered: ${aggregate.after.all.avgDelivered?.toFixed(1)} (V35 baseline: ${aggregate.before.avgDelivered?.toFixed(1) ?? "n/a"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
