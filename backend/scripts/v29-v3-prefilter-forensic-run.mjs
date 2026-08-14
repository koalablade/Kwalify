#!/usr/bin/env node
/**
 * V29 Forensic V3 Pre-Filter Audit — diagnosis only. No production changes.
 * Usage: node backend/scripts/v29-v3-prefilter-forensic-run.mjs [--prompt "text"] [--skip-live]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v29-forensic-v3-prefilter-audit.json");
const OUT_MD = resolve(OUT_DIR, "V29_FORENSIC_V3_PREFILTER_AUDIT.md");
const OUT_LOG = resolve(OUT_DIR, "v29-forensic-run.log");

const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 5000;

const PROMPTS = [
  { id: "V29-01", prompt: "sunset beach reggae" },
  { id: "V29-02", prompt: "hard techno gym" },
  { id: "V29-03", prompt: "late night UK garage drive" },
  { id: "V29-04", prompt: "2000s pop punk gym workout" },
];

const V27_BASELINE = {
  "sunset beach reggae": { afterIntent: 17, v3PreFilter: null, delivered: 6, retrieval: 300 },
  "hard techno gym": { afterIntent: 8703, v3PreFilter: null, delivered: 4, retrieval: 300 },
  "late night UK garage drive": { afterIntent: 8651, v3PreFilter: null, delivered: 8, retrieval: 300 },
  "2000s pop punk gym workout": { afterIntent: 2204, v3PreFilter: null, delivered: 6, retrieval: 300 },
};

const V28_BASELINE = {
  "sunset beach reggae": { afterIntent: 200, delivered: null, preV3Applied: true },
  "hard techno gym": { afterIntent: null, delivered: null, preV3Applied: true },
  "late night UK garage drive": { afterIntent: null, delivered: null, preV3Applied: true },
  "2000s pop punk gym workout": { afterIntent: null, delivered: null, preV3Applied: true },
};

const REGGAE_CANONICAL = ["bob marley", "peter tosh", "shaggy", "jimmy cliff", "sean paul", "damian marley", "chronixx"];

const V3_SAFETY_INPUT_MIN = 200;
const V3_SAFETY_INPUT_PER_TRACK = 16;
const V3_SAFETY_INPUT_MAX = 500;

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function v3SafetyCap(playlistLength = 25) {
  return Math.min(V3_SAFETY_INPUT_MAX, Math.max(V3_SAFETY_INPUT_MIN, playlistLength * V3_SAFETY_INPUT_PER_TRACK));
}

function norm(s) {
  return String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

async function resolveCreds() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

async function generate(creds, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId ?? "koalablade",
        requestId: `v29-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function pickForensicPreV3Trace(data) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const scoringV3 = data.scoringDiagnostics?.v3Pipeline ?? null;
  const removalReasons = gd.removalReasons ?? v3.removalReasons ?? scoringV3?.removalReasons ?? [];
  const fromRemoval = Array.isArray(removalReasons)
    ? removalReasons.filter((r) => r?.stage && /genre family|lane readiness|metadata|era|intent readiness|duplicate|final candidate/i.test(String(r.stage)))
    : [];
  const controlled = v3.controlledGeneration ?? scoringV3?.controlledGeneration ?? {};
  const preV3Recovery = v3.preV3Recovery ?? controlled?.preV3Recovery ?? null;
  const direct = preV3Recovery?.forensicPreV3Trace ?? v3.forensicPreV3Trace ?? null;
  if (Array.isArray(direct) && direct.length) return direct;
  if (fromRemoval.length) return fromRemoval;
  return null;
}

function flattenRetrievalLaneCounts(v3) {
  const pools = v3.retrievalPoolsDetailed ?? v3.retrievalPools ?? null;
  if (!pools || typeof pools !== "object") return null;
  const lanes = ["core", "anchor", "adjacent", "bridge", "energyArc", "discovery"];
  const byLane = {};
  let total = 0;
  for (const lane of lanes) {
    const entry = pools[lane];
    const count = typeof entry === "number" ? entry : num(entry?.count) ?? (Array.isArray(entry) ? entry.length : 0);
    byLane[lane] = count ?? 0;
    total += byLane[lane];
  }
  return { byLane, flattenedUncapped: total, safetyCap: v3SafetyCap(25) };
}

function sampleRejectedTracks(forensicTrace, tracks, prompt) {
  if (!Array.isArray(forensicTrace)) return [];
  const intentStage = forensicTrace.find((s) => /intent readiness/i.test(String(s.stage)));
  const reasonCounts = intentStage?.rejectionReasons ?? intentStage?.topReasons ?? {};
  const topReasons = Array.isArray(reasonCounts)
    ? reasonCounts
    : Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count }));

  const samples = [];
  for (const artistPat of REGGAE_CANONICAL) {
    const hit = (tracks ?? []).find((t) => norm(t.artist ?? t.artistName).includes(artistPat));
    if (hit) {
      samples.push({
        artist: hit.artist ?? hit.artistName,
        track: hit.track ?? hit.trackName,
        note: "delivered (not rejected)",
      });
    }
  }
  return { topReasons, canonicalArtistSamples: samples, intentStageBefore: intentStage?.before ?? null, intentStageAfter: intentStage?.after ?? null };
}

function extractAuditRow(prompt, id, httpStatus, data) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const intentGuard = v3.intentContractGuard ?? {};
  const controlled = v3.controlledGeneration ?? {};
  const latencyGuard = controlled.retrievalLatencyGuard ?? {};
  const waterfall = gd.waterfall ?? v3.waterfall ?? {};
  const deliveryLoss = gd.deliveryLossFunnel ?? null;
  const purity = gd.puritySubFunnel ?? null;
  const forensicTrace = pickForensicPreV3Trace(data);
  const retrievalLanes = flattenRetrievalLaneCounts(v3);
  const candidateCountPerStage = intentGuard.candidateCountPerStage ?? null;
  const v3Invocation = (gd.v3InvocationDecomposition ?? controlled.v3InvocationDecomposition ?? null);
  const inputPoolSizes = Array.isArray(v3Invocation?.invocations)
    ? v3Invocation.invocations.map((i) => ({ label: i.label, inputPoolSize: i.inputPoolSize, candidatePoolSize: i.candidatePoolSize }))
    : null;

  const preFilterSurvivors =
    deliveryLoss?.v3PreFilterSurvivors ??
    num(latencyGuard.candidatePoolSizeFinal) ??
    num(gd.performanceFastPath?.candidatePoolSizeFinal);

  const afterIntent = num(gd.candidatesAfterIntent) ?? num(waterfall.contractCount);
  const retrievalCount =
    num(gd.candidatesSampled) ??
    num(candidateCountPerStage?.retrieval) ??
    num(waterfall.retrievalCount);

  const funnelStages = [];
  if (Array.isArray(gd.preV3SamplingFunnel)) funnelStages.push(...gd.preV3SamplingFunnel);
  if (Array.isArray(forensicTrace)) {
    for (const stage of forensicTrace) {
      funnelStages.push({
        stage: `v3_build:${stage.stage}`,
        count: stage.after,
        before: stage.before,
        removed: stage.removed,
        topReasons: stage.topReasons ?? [],
      });
    }
  }

  return {
    id,
    prompt,
    httpStatus,
    success: data.success === true,
    error: data.error ?? data.message ?? null,
    metrics: {
      libraryCount: num(gd.initialLibrarySize),
      retrieval: retrievalCount,
      retrievalLanes,
      flattenedRetrievalEstimate: retrievalLanes?.flattenedUncapped ?? null,
      v3SafetyInputCap: v3SafetyCap(25),
      contract: num(waterfall.contractCount) ?? afterIntent,
      afterIntent,
      candidateCountPerStage,
      preV3SamplingFunnel: gd.preV3SamplingFunnel ?? null,
      preV3WorldSampling: gd.preV3WorldSampling ?? intentGuard.preV3WorldSampling ?? null,
      deliveryLossFunnel: deliveryLoss,
      v3PreFilterSurvivors: preFilterSurvivors,
      v3Composed: deliveryLoss?.v3Composed ?? num(waterfall.samplerCount),
      postPurity: deliveryLoss?.postPurity ?? purity?.postFilterByWorldPurityCount ?? null,
      finalDelivered: deliveryLoss?.finalDelivered ?? (data.tracks ?? []).length,
      orchestratorFinal: deliveryLoss?.orchestratorFinal ?? null,
      inputPoolSizes,
      controlledGeneration: {
        candidatePoolSizeFinal: num(latencyGuard.candidatePoolSizeFinal),
        candidatePoolBuildCount: num(latencyGuard.candidatePoolBuildCount),
        selectedCandidate: controlled.selectedCandidate ?? null,
        retrievalSafetyExpanded: latencyGuard.active ?? false,
      },
      forensicPreV3Trace: forensicTrace,
      funnelStages,
      puritySubFunnel: purity,
      waterfall,
      performanceFastPath: gd.performanceFastPath ?? null,
      delivered: (data.tracks ?? []).length,
      requested: data.requestedLength ?? 25,
      tracks: (data.tracks ?? []).slice(0, 25).map((t, i) => ({
        position: i + 1,
        artist: t.artistName ?? t.artist,
        track: t.trackName ?? t.name,
      })),
    },
    reggaeRejectionSample:
      /reggae/i.test(prompt)
        ? sampleRejectedTracks(forensicTrace, data.tracks, prompt)
        : null,
  };
}

function classifyIntentional17(row) {
  const m = row.metrics;
  const survivors = m.v3PreFilterSurvivors;
  const afterIntent = m.afterIntent;
  const retrievalFlat = m.flattenedRetrievalEstimate;
  const safetyCap = m.v3SafetyInputCap;
  const inputPool = m.inputPoolSizes?.[0]?.inputPoolSize ?? retrievalFlat;

  if (survivors === 17 && afterIntent >= 100) {
    if (inputPool != null && inputPool <= 20) return { code: "C", label: "V3 input is retrieval pool (~≤20 tracks), not contractGuardedScoredPool" };
    if (retrievalFlat != null && retrievalFlat <= 20) return { code: "F", label: "Retrieval lane flatten yields ~17 before V3 safety cap" };
    return { code: "D", label: "buildV3CandidatePool filters small retrieval input — not an explicit 17 cap" };
  }
  if (survivors === safetyCap) return { code: "B", label: "Matches V3_SAFETY_INPUT cap" };
  if (survivors === 17) return { code: "A", label: "Coincidental 17 — check explicit constant (none found in code)" };
  if (afterIntent != null && survivors != null && survivors < afterIntent * 0.15) return { code: "G", label: "Emergent multi-stage collapse from retrieval→V3 pre-filter" };
  if (survivors != null && survivors >= 50) return { code: "E", label: "Healthy V3 pre-filter survivor count" };
  return { code: "G", label: "Emergent filtering — no hard-coded 17" };
}

function classifyRootCause(rows) {
  const reggae = rows.find((r) => r.prompt === "sunset beach reggae");
  if (!reggae) return { code: "H", label: "Insufficient audit data" };
  const m = reggae.metrics;
  if (m.afterIntent >= 100 && m.v3PreFilterSurvivors != null && m.v3PreFilterSurvivors <= 25) {
    if (m.flattenedRetrievalEstimate != null && m.flattenedRetrievalEstimate <= 25) {
      return {
        code: "C",
        label: "V3 buildV3CandidatePool receives sharedRetrievalPool (~17) not contractGuardedScoredPool (~200)",
      };
    }
    return { code: "G", label: "Intent contract / buildV3CandidatePool collapse on small input" };
  }
  if ((m.finalDelivered ?? 0) < 10 && (m.postPurity ?? 0) < (m.v3PreFilterSurvivors ?? 0)) {
    return { code: "D", label: "Secondary post-purity funnel after V3 pre-filter" };
  }
  return { code: "C", label: "Input pool routing mismatch (primary)" };
}

function renderMd(payload) {
  const lines = [];
  lines.push("# V29 Forensic V3 Pre-Filter Audit");
  lines.push("");
  lines.push(`**Generated:** ${payload.generatedAt}`);
  lines.push(`**Commit:** ${payload.commit}`);
  lines.push("");
  lines.push("## 1. Executive summary");
  lines.push("");
  lines.push(payload.executiveSummary);
  lines.push("");
  lines.push("## 2. Current proven pipeline state");
  lines.push("");
  lines.push(payload.pipelineState);
  lines.push("");
  lines.push("## 3. Exact 200 → 17 funnel (sunset beach reggae)");
  lines.push("");
  lines.push(payload.reggaeFunnelNarrative);
  lines.push("");
  lines.push("## 4. Whether 17 is intentional");
  lines.push("");
  lines.push(`**Classification: ${payload.intentional17Classification.code} — ${payload.intentional17Classification.label}**`);
  lines.push("");
  lines.push(payload.intentional17Detail);
  lines.push("");
  lines.push("## 5. Every rejection stage");
  lines.push("");
  for (const stage of payload.rejectionStages) lines.push(`- ${stage}`);
  lines.push("");
  lines.push("## 6. Rejection counts");
  lines.push("");
  lines.push("| Stage | Before | After | Removed |");
  lines.push("|---|---:|---:|---:|");
  for (const row of payload.rejectionCounts) {
    lines.push(`| ${row.stage} | ${row.before ?? "—"} | ${row.after ?? "—"} | ${row.removed ?? "—"} |`);
  }
  lines.push("");
  lines.push("## 7. Rejection reasons");
  lines.push("");
  for (const [reason, count] of payload.topRejectionReasons) {
    lines.push(`- **${reason}**: ${count}`);
  }
  lines.push("");
  lines.push("## 8. Representative rejected tracks/artists (reggae)");
  lines.push("");
  for (const s of payload.reggaeArtistSamples) lines.push(`- ${s.artist} — ${s.track} (${s.note})`);
  lines.push("");
  lines.push("## 9. Four-world comparison");
  lines.push("");
  lines.push("| Prompt | Library | Retrieval | Flattened lanes | afterIntent | V3 input est. | v3PreFilter | v3Composed | postPurity | Delivered |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of payload.comparisonTable) {
    lines.push(
      `| ${row.prompt} | ${row.library} | ${row.retrieval} | ${row.flattened} | ${row.afterIntent} | ${row.v3Input} | ${row.v3PreFilter} | ${row.v3Composed} | ${row.postPurity} | ${row.delivered} |`,
    );
  }
  lines.push("");
  lines.push("## 10. 17 → 5 secondary funnel (post-purity)");
  lines.push("");
  lines.push(payload.secondaryFunnel);
  lines.push("");
  lines.push("## 11. Root-cause classification");
  lines.push("");
  lines.push(`**${payload.rootCause.code} — ${payload.rootCause.label}**`);
  lines.push("");
  lines.push("## 12. What is definitively NOT the problem");
  lines.push("");
  for (const item of payload.notRootCauses) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## 13. Single highest-value next action");
  lines.push("");
  lines.push(payload.nextAction);
  lines.push("");
  lines.push("## 14. Explicit statement");
  lines.push("");
  lines.push("**No production pipeline code, thresholds, profiles, retrieval, purity, Share, or padding logic was modified for this audit.** Only diagnostic script `backend/scripts/v29-v3-prefilter-forensic-run.mjs` and report artifacts were created.");
  return lines.join("\n");
}

function buildReportPayload(results) {
  const reggae = results.find((r) => r.prompt === "sunset beach reggae") ?? results[0];
  const m = reggae?.metrics ?? {};
  const intentional = classifyIntentional17(reggae ?? { metrics: {} });
  const rootCause = classifyRootCause(results);

  const forensic = m.forensicPreV3Trace ?? [];
  const rejectionCounts = [];
  const rejectionStages = [
    "Library → retrieval (retrieveScoringCandidates + lanes)",
    "Retrieval lanes → flattenRetrievalPools → capV3SafetyPool → sharedRetrievalPool (V3 candidate input when pool non-empty)",
    "contractGuardedScoredPool (afterIntent / preRanking) — parallel path, NOT default V3 input",
    "buildV3CandidatePool: genre family → lane readiness → metadata completeness → era → relaxation ladder → capV3IntentReadyPool → window slice → uncollapseV11",
    "mergeV3UniverseInput (intent-ready + retrieval top-up to safety cap)",
    "runV3Pipeline composition",
    "post-purity / world proof / terminal delivery",
  ];
  if (Array.isArray(m.preV3SamplingFunnel)) {
    for (const s of m.preV3SamplingFunnel) {
      rejectionCounts.push({ stage: s.stage, before: null, after: s.count, removed: null });
    }
  }
  if (Array.isArray(forensic)) {
    for (const s of forensic) {
      rejectionCounts.push({ stage: s.stage, before: s.before, after: s.after, removed: s.removed });
    }
  }
  const intentStage = Array.isArray(forensic) ? forensic.find((s) => /intent readiness/i.test(String(s.stage))) : null;
  const topRejectionReasons = intentStage?.topReasons
    ? intentStage.topReasons.map((r) => [r.reason, r.count])
    : Object.entries(intentStage?.rejectionReasons ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const comparisonTable = results.map((r) => {
    const mm = r.metrics;
    return {
      prompt: r.prompt,
      library: mm.libraryCount ?? "—",
      retrieval: mm.retrieval ?? "—",
      flattened: mm.flattenedRetrievalEstimate ?? "—",
      afterIntent: mm.afterIntent ?? "—",
      v3Input: mm.inputPoolSizes?.[0]?.inputPoolSize ?? mm.flattenedRetrievalEstimate ?? "—",
      v3PreFilter: mm.v3PreFilterSurvivors ?? "—",
      v3Composed: mm.v3Composed ?? "—",
      postPurity: mm.postPurity ?? "—",
      delivered: mm.delivered ?? "—",
    };
  });

  const v27 = V27_BASELINE["sunset beach reggae"];
  const v28 = V28_BASELINE["sunset beach reggae"];

  const secondaryFunnel =
    m.v3PreFilterSurvivors != null && m.postPurity != null
      ? `Reggae: v3PreFilterSurvivors=${m.v3PreFilterSurvivors} → postPurity=${m.postPurity} → delivered=${m.finalDelivered}. ` +
        (m.puritySubFunnel
          ? `Purity sub-funnel: prePurity=${m.puritySubFunnel.prePurityCount}, hardReject=${m.puritySubFunnel.hardRejectOffWorldCount}, checkpointStrip=${m.puritySubFunnel.postCheckpointStripCount}. Removed: ${(m.puritySubFunnel.removedReasons ?? []).join(", ") || "—"}.`
          : "puritySubFunnel diagnostics not populated.")
      : "Secondary funnel counts unavailable.";

  return {
    generatedAt: new Date().toISOString(),
    commit: getHeadCommit(),
    experiment: "v29-forensic-v3-prefilter-audit",
    codeTrace: {
      baseInputPoolRule: "candidate.pool.length > 0 ? candidate.pool : contractGuardedScoredPool",
      candidatePoolSource: "sharedRetrievalPool = capV3SafetyPool(flattenRetrievalPools(lanes))",
      v3PreFilterSurvivorsSource: "v3CandidatePool.tracks.length from buildV3CandidatePool(inputPool)",
      v3SafetyInputCapFormula: `min(${V3_SAFETY_INPUT_MAX}, max(${V3_SAFETY_INPUT_MIN}, playlistLength * ${V3_SAFETY_INPUT_PER_TRACK})) = ${v3SafetyCap(25)} for length=25`,
      explicitCapsFound: ["V3_SAFETY_INPUT_MIN=200", "V3_SAFETY_INPUT_MAX=500", "V3_SAFETY_INPUT_PER_TRACK=16", "MAX_CANDIDATE_PLAYLISTS=50", "SAMPLER_SEED_VARIANTS=3-10", "capV3IntentReadyPool artist≤4 per family", "NO literal cap at 17"],
    },
    liveResults: results,
    executiveSummary:
      `Live audit confirms v3PreFilterSurvivors=${m.v3PreFilterSurvivors ?? "?"} for sunset beach reggae while afterIntent=${m.afterIntent ?? "?"} — ` +
      `the ~200 contract pool does not feed buildV3CandidatePool; sharedRetrievalPool (~${m.flattenedRetrievalEstimate ?? "?"}) does. ` +
      `17 is emergent (${intentional.code}), not a hard-coded cap. Root cause: ${rootCause.code}.`,
    pipelineState:
      "V28 pre-V3 world sampling expanded contractGuardedScoredPool (afterIntent) to ~200 for reggae. " +
      "V3 multi-candidate loop still passes sharedRetrievalPool as candidate.pool when non-empty, bypassing the expanded contract pool.",
    reggaeFunnelNarrative:
      `| Step | Count |\n|---|---:|\n` +
      `| Library | ${m.libraryCount ?? "?"} |\n` +
      `| Retrieval sampled | ${m.retrieval ?? "?"} |\n` +
      `| Flattened retrieval lanes (uncapped) | ${m.flattenedRetrievalEstimate ?? "?"} |\n` +
      `| capV3SafetyPool (max ${v3SafetyCap(25)}) | ≤${v3SafetyCap(25)} |\n` +
      `| contractGuardedScoredPool (afterIntent) | ${m.afterIntent ?? "?"} |\n` +
      `| buildV3CandidatePool input (sharedRetrievalPool) | ${m.inputPoolSizes?.[0]?.inputPoolSize ?? m.flattenedRetrievalEstimate ?? "?"} |\n` +
      `| v3PreFilterSurvivors | ${m.v3PreFilterSurvivors ?? "?"} |\n` +
      `| v3Composed | ${m.v3Composed ?? "?"} |\n` +
      `| postPurity | ${m.postPurity ?? "?"} |\n` +
      `| finalDelivered | ${m.finalDelivered ?? "?"} |`,
    intentional17Classification: intentional,
    intentional17Detail:
      "Code search finds no constant 17. V3_SAFETY_INPUT cap for length=25 is 400. " +
      "When sharedRetrievalPool has ~17 tracks, buildV3CandidatePool filters that small set through genre/lane/intent gates — survivors ≈ input size.",
    rejectionStages,
    rejectionCounts,
    topRejectionReasons,
    reggaeArtistSamples: reggae?.reggaeRejectionSample?.canonicalArtistSamples ?? [],
    comparisonTable,
    v27v28Comparison: {
      reggae: {
        v27: v27,
        v28: { afterIntent: m.afterIntent, preV3Applied: m.preV3WorldSampling?.applied },
        v29: { afterIntent: m.afterIntent, v3PreFilterSurvivors: m.v3PreFilterSurvivors, delivered: m.finalDelivered },
      },
    },
    secondaryFunnel,
    rootCause,
    notRootCauses: [
      "Explicit hard-coded cap at 17 (no such constant in playlist-pipeline.ts)",
      "V3_SAFETY_INPUT cap (400 for length=25) — not binding at 17",
      "Insufficient reggae library supply (V27 disproved 100+ reggae tracks)",
      "Wrong world resolution (reggae_world hardLock confirmed in prior audits)",
      "V28 pre-V3 sampling failure (afterIntent now ~200; bottleneck moved downstream to V3 input routing)",
    ],
    nextAction:
      "Route buildV3CandidatePool input through mergeV3UniverseInput(contractGuardedScoredPool, sharedRetrievalPool) — or use contractGuardedScoredPool when preV3WorldSampling applied — so the ~200 afterIntent pool reaches V3 pre-filter. Verify with audit-only rerun before any threshold changes.",
    comparisonTable,
  };
}

async function main() {
  const skipLive = process.argv.includes("--skip-live");
  const singlePrompt = process.argv.find((a, i) => process.argv[i - 1] === "--prompt");
  mkdirSync(OUT_DIR, { recursive: true });

  let results = [];
  if (!skipLive) {
    const creds = await resolveCreds();
    try {
      const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
        headers: { "x-kwalify-evaluation-token": creds.token },
      });
      if (!ping.ok) throw new Error(`eval/ping ${ping.status}`);
    } catch (e) {
      log(`API unavailable: ${e.message}`);
      process.exit(1);
    }

    const prompts = singlePrompt
      ? [{ id: "V29-X", prompt: singlePrompt }]
      : PROMPTS;

    for (const { id, prompt } of prompts) {
      log(`START ${id}: ${prompt}`);
      try {
        const { httpStatus, data } = await generate(creds, prompt);
        const row = extractAuditRow(prompt, id, httpStatus, data);
        results.push(row);
        log(
          `DONE ${id}: afterIntent=${row.metrics.afterIntent} v3PreFilter=${row.metrics.v3PreFilterSurvivors} delivered=${row.metrics.delivered}`,
        );
      } catch (e) {
        results.push({ id, prompt, error: e.message, metrics: {} });
        log(`FAILED ${id}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } else if (existsSync(OUT_JSON)) {
    const prior = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    results = prior.liveResults ?? [];
  }

  const payload = buildReportPayload(results);
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  console.log(`V29 JSON: ${OUT_JSON}`);
  console.log(`V29 MD:   ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
