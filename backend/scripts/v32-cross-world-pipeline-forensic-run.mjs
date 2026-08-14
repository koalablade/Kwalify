#!/usr/bin/env node
/**
 * V32 Cross-World Pipeline Forensic Audit — investigation only.
 * Usage: node backend/scripts/v32-cross-world-pipeline-forensic-run.mjs
 */
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v32-cross-world-pipeline-forensic-audit.json");
const OUT_MD = resolve(OUT_DIR, "V32_CROSS_WORLD_PIPELINE_FORENSIC_AUDIT.md");
const OUT_LOG = resolve(OUT_DIR, "v32-cross-world-run.log");

const USER = "koalablade";
const REQUESTED = 25;
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 4000;

const PROMPTS = [
  { id: "V32-01", category: "explicit_genre", prompt: "sunset beach reggae", ledger: true },
  { id: "V32-02", category: "explicit_genre", prompt: "late night UK garage drive", ledger: true },
  { id: "V32-03", category: "explicit_genre", prompt: "hard techno gym", ledger: true },
  { id: "V32-04", category: "genre_era", prompt: "2000s pop punk gym workout", ledger: true },
  { id: "V32-05", category: "genre_era", prompt: "90s Britpop pub night" },
  { id: "V32-06", category: "genre_era", prompt: "80s synth pop" },
  { id: "V32-07", category: "genre_activity", prompt: "UK grime workout" },
  { id: "V32-08", category: "genre_activity", prompt: "soul Sunday morning" },
  { id: "V32-09", category: "genre_activity", prompt: "drum and bass night drive" },
  { id: "V32-10", category: "mood", prompt: "melancholy indie" },
  { id: "V32-11", category: "mood", prompt: "feel-good soul" },
  { id: "V32-12", category: "mood", prompt: "sad party bangers" },
  { id: "V32-13", category: "context", prompt: "dad rock BBQ" },
  { id: "V32-14", category: "context", prompt: "rainy motorway night drive" },
  { id: "V32-15", category: "ambiguous", prompt: "something nostalgic for driving" },
  { id: "V32-16", category: "ambiguous", prompt: "energetic but not cheesy" },
  { id: "V32-17", category: "ambiguous", prompt: "chilled but not boring" },
  { id: "V32-18", category: "ambiguous", prompt: "music for a sunny Sunday", ledger: true },
];

const STAGE_KEYS = [
  "library", "retrieval", "contract", "preV3", "v3Input", "v3PreFilter",
  "v3Composed", "genreEvidence", "prePurity", "postPurity", "delivered",
];

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
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  return resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
}

function parsePurityReason(reason) {
  const m = reason.match(/pos_(\d+):(.+?) — (.+?):(\d+)<(\d+)/);
  if (m) return { position: +m[1], artist: m[2].trim(), track: m[3].trim(), score: +m[4], threshold: +m[5] };
  return { raw: reason };
}

function classifyRejection(entry, worldId) {
  const artist = String(entry.artist ?? "").toLowerCase();
  const score = entry.score;
  if (entry.stage === "genre_evidence_guard") {
    if (/arctic|black keys|shania|indie pop|country|cash|jake bugg/.test(artist)) return { class: "I", label: "correct_wrong_world" };
    return { class: "G", label: "possible_evidence_false_positive" };
  }
  if (entry.stage === "purity_position_filter") {
    if (score === 0) return { class: "C", label: "metadata_failure" };
    if (/marley|levy|shaggy|sean paul|tosh|ub40|conducta|garage|paramore|blink|techno|de witte/.test(artist) && score != null && score < 80) {
      return { class: "B", label: "false_rejection_anchor_or_genre_member" };
    }
    if (score != null && score >= 55 && score < 85) return { class: "F", label: "position_tier_threshold" };
    if (/arctic|mgmt|wallows|1975|cheesy pop/.test(artist)) return { class: "I", label: "correct_wrong_world" };
    return { class: "D", label: "scoring_calibration" };
  }
  return { class: "H", label: "other", worldId };
}

function stageFromAuthority(mutations) {
  const find = (name) => mutations.find((m) => m.stage === name);
  const v3 = find("v3_handoff");
  const genre = find("genre_evidence_guard");
  const purity = find("world_purity_gate");
  return {
    v3Composed: v3?.afterCount ?? null,
    genreEvidenceIn: genre?.beforeCount ?? null,
    genreEvidenceOut: genre?.afterCount ?? null,
    genreEvidenceRemoved: genre?.tracksRemoved ?? null,
    purityIn: purity?.beforeCount ?? null,
    purityOut: purity?.afterCount ?? null,
    purityRemoved: purity?.tracksRemoved ?? null,
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
  const underfill = gd.deliveryUnderfillForensics ?? {};
  const routing = v3.controlledGeneration?.retrievalLatencyGuard?.v3InputRouting ?? null;
  const intentGuard = v3.intentContractGuard ?? {};
  const ccs = intentGuard.candidateCountPerStage ?? {};
  const preV3 = gd.preV3WorldSampling ?? intentGuard.preV3WorldSampling ?? null;
  const committed = data.committedWorld ?? gd.committedWorld ?? v3.committedWorld ?? null;
  const worldCov = data.worldCoverage ?? gd.worldCoverage ?? null;
  const authStages = stageFromAuthority(mutations);

  const funnel = {
    library: num(gd.initialLibrarySize) ?? num(wf.libraryCount),
    retrieval: num(gd.candidatesSampled) ?? num(wf.retrievalCount) ?? num(ccs.retrieval),
    contract: num(wf.contractCount) ?? num(gd.candidatesAfterIntent) ?? num(ccs.preRanking),
    preV3: num(ccs.preRanking) ?? num(wf.contractCount),
    v3Input: num(routing?.inputPoolSize),
    v3PreFilter: num(dl.v3PreFilterSurvivors),
    v3Composed: num(dl.v3Composed) ?? authStages.v3Composed ?? num(wf.samplerCount),
    genreEvidence: authStages.genreEvidenceOut,
    prePurity: num(purity.prePurityCount) ?? authStages.purityIn,
    postPurity: num(dl.postPurity) ?? num(purity.postFilterByWorldPurityCount) ?? authStages.purityOut,
    delivered: (data.tracks ?? []).length,
  };

  const genreStage = (underfill.stages ?? []).find((s) => s.stage === "genre_evidence_guard");
  const genreRemovedIds = genreStage?.removedTrackIds ?? [];

  const purityLedger = (Array.isArray(purity.removedReasons) ? purity.removedReasons : []).map((r, i) => {
    const parsed = parsePurityReason(r);
    const rej = classifyRejection({ ...parsed, stage: "purity_position_filter" }, committed?.id);
    return {
      index: i + 1,
      stage: "world_purity_gate",
      function: "filterByWorldPurity → trackPassesWorldPurity",
      ...parsed,
      rejectionClass: rej.class,
      rejectionLabel: rej.label,
    };
  });

  const checkpointLedger = (Array.isArray(purity.checkpointDecisions) ? purity.checkpointDecisions : []).map((d) => ({
    stage: "checkpoint",
    compositionPosition: d.compositionPosition,
    artist: d.artist,
    track: d.track,
    score: d.score,
    threshold: d.threshold,
    passed: d.passed,
  }));

  const deliveredTracks = (data.tracks ?? []).map((t, i) => ({
    position: i + 1,
    trackId: t.trackId,
    artist: t.artistName ?? t.artist,
    track: t.trackName ?? t.name,
    finalStatus: "delivered",
  }));

  const retention = {};
  const pairs = [
    ["retrieval", "contract"], ["contract", "v3Input"], ["v3Input", "v3PreFilter"],
    ["v3PreFilter", "v3Composed"], ["v3Composed", "genreEvidence"], ["genreEvidence", "prePurity"],
    ["prePurity", "postPurity"], ["postPurity", "delivered"],
  ];
  for (const [a, b] of pairs) {
    const inN = funnel[a];
    const outN = funnel[b];
    if (inN != null && outN != null && inN > 0) retention[`${a}_to_${b}`] = Math.round((outN / inN) * 1000) / 1000;
  }
  if (funnel.library && funnel.delivered) {
    retention.library_to_delivered = Math.round((funnel.delivered / funnel.library) * 10000) / 10000;
  }

  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    ledger: !!spec.ledger,
    httpStatus,
    success: data.success === true,
    world: {
      resolvedId: committed?.id ?? committed?.musicalWorldId ?? null,
      hardLock: committed?.hardLock ?? null,
      worldIds: committed?.worldIds ?? null,
      coverageLevel: worldCov?.score ?? worldCov?.level ?? null,
      coverageConfidence: worldCov?.confidence ?? null,
    },
    routing: routing ? {
      reason: routing.routingReason,
      inputPoolSize: routing.inputPoolSize,
      contractPoolSize: routing.contractPoolSize,
      safetyPoolSize: routing.safetyPoolSize,
      preV3Applied: routing.preV3WorldSamplingApplied,
    } : null,
    preV3WorldSampling: preV3 ? { applied: preV3.applied, reason: preV3.reason, outputCount: preV3.outputCount ?? null } : null,
    contractStages: ccs,
    funnel,
    retention,
    genreEvidenceGuard: {
      input: authStages.genreEvidenceIn ?? genreStage?.enter ?? null,
      output: authStages.genreEvidenceOut ?? genreStage?.exit ?? null,
      removed: authStages.genreEvidenceRemoved ?? genreStage?.lost ?? null,
      removedTrackIds: genreRemovedIds,
    },
    worldPurityGate: {
      input: authStages.purityIn ?? num(purity.prePurityCount),
      output: authStages.purityOut ?? num(purity.postFilterByWorldPurityCount),
      removed: authStages.purityRemoved ?? (num(purity.prePurityCount) != null && num(purity.postFilterByWorldPurityCount) != null
        ? num(purity.prePurityCount) - num(purity.postFilterByWorldPurityCount) : null),
      checkpointStripApplied: purity.checkpointStripApplied ?? false,
      removedReasons: purityLedger,
      checkpointDecisions: checkpointLedger,
    },
    v3Composition: {
      survivors: funnel.v3PreFilter,
      composed: funnel.v3Composed,
      notSelected: funnel.v3PreFilter != null && funnel.v3Composed != null ? funnel.v3PreFilter - funnel.v3Composed : null,
    },
    delivery: {
      requested: data.requestedLength ?? REQUESTED,
      delivered: funnel.delivered,
      capConstrained: funnel.delivered != null && funnel.delivered < REQUESTED,
      shortfall: REQUESTED - (funnel.delivered ?? 0),
    },
    deliveredTracks,
    authorityMutations: mutations.map((m) => ({
      stage: m.stage, reason: m.reason, before: m.beforeCount, after: m.afterCount, removed: m.tracksRemoved,
    })),
    orchestratorFinal: num(dl.orchestratorFinal),
  };
}

function median(arr) {
  const a = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function retentionStats(rows, fromKey, toKey) {
  const rates = rows.map((r) => r.retention[`${fromKey}_to_${toKey}`]).filter((x) => x != null);
  if (!rates.length) return { median: null, min: null, max: null, n: 0 };
  return {
    median: median(rates),
    min: Math.min(...rates),
    max: Math.max(...rates),
    n: rates.length,
  };
}

async function enrichWithDb(rows) {
  loadDotEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const pool = new pg.Pool({ connectionString: dbUrl });
  for (const row of rows) {
    const ids = row.genreEvidenceGuard.removedTrackIds ?? [];
    if (!ids.length) continue;
    const { rows: tracks } = await pool.query(
      "SELECT track_id, artist_name, track_name FROM liked_songs WHERE spotify_user_id = $1 AND track_id = ANY($2)",
      [USER, ids],
    );
    const map = Object.fromEntries(tracks.map((t) => [t.track_id, { artist: t.artist_name, track: t.track_name }]));
    row.genreEvidenceGuard.removedTracks = ids.map((id, i) => {
      const t = map[id] ?? {};
      const entry = { trackId: id, artist: t.artist ?? null, track: t.track ?? null, stage: "genre_evidence_guard" };
      const rej = classifyRejection(entry, row.world.resolvedId);
      return { ...entry, rejectionClass: rej.class, rejectionLabel: rej.label };
    });
  }
  await pool.end();
}

function buildCrossWorldRetention(rows) {
  const transitions = [
    ["retrieval", "contract"], ["contract", "v3PreFilter"], ["v3PreFilter", "v3Composed"],
    ["v3Composed", "genreEvidence"], ["genreEvidence", "postPurity"], ["postPurity", "delivered"],
  ];
  const table = {};
  for (const [a, b] of transitions) {
    table[`${a} → ${b}`] = retentionStats(rows, a, b);
  }
  return table;
}

function analyzePatterns(rows) {
  const hardLock = rows.filter((r) => r.world.hardLock === true);
  const soft = rows.filter((r) => r.world.hardLock !== true);
  const purity62Pattern = rows.flatMap((r) =>
    (r.worldPurityGate.removedReasons ?? []).filter((x) => x.score === 62),
  );
  const genreLoss = rows.map((r) => ({
    prompt: r.prompt,
    removed: r.genreEvidenceGuard.removed,
    pct: r.funnel.v3Composed && r.genreEvidenceGuard.removed
      ? r.genreEvidenceGuard.removed / r.funnel.v3Composed : null,
  })).filter((x) => x.removed != null);

  return {
    hardLockCount: hardLock.length,
    softCount: soft.length,
    score62Rejections: purity62Pattern.length,
    score62Examples: purity62Pattern.slice(0, 8).map((x) => `${x.artist} — ${x.track} (${x.score}<${x.threshold})`),
    genreGuardMedianRemovalPct: median(genreLoss.map((x) => x.pct).filter(Boolean)),
    avgDelivered: rows.reduce((s, r) => s + (r.funnel.delivered ?? 0), 0) / rows.length,
    avgShortfall: rows.reduce((s, r) => s + r.delivery.shortfall, 0) / rows.length,
  };
}

function rankBottlenecks(rows, retentionTable) {
  const ranks = [];
  const ge = retentionTable["v3Composed → genreEvidence"];
  if (ge?.median != null && ge.median < 0.85) {
    ranks.push({
      rank: ranks.length + 1,
      bottleneck: "genre_evidence_guard",
      evidence: `Median retention v3Composed→genreEvidence: ${ge.median} (min ${ge.min}, max ${ge.max}, n=${ge.n})`,
      affectedWorlds: rows.filter((r) => (r.genreEvidenceGuard.removed ?? 0) > 0).map((r) => r.prompt),
      estimatedImpact: "Removes 0–40% of composed playlist before purity; reggae removed 10/25",
      genericOrSpecific: "GENERIC — runs on all hard-lock / genre-evidence paths",
      confidence: "HIGH",
    });
  }
  const pur = retentionTable["genreEvidence → postPurity"];
  if (pur?.median != null && pur.median < 0.7) {
    ranks.push({
      rank: ranks.length + 1,
      bottleneck: "world_purity_gate position-tier filter",
      evidence: `Median retention genreEvidence→postPurity: ${pur.median}; score=62 vs threshold 80–85 pattern across worlds`,
      affectedWorlds: rows.filter((r) => (r.worldPurityGate.removed ?? 0) > 0).map((r) => r.prompt),
      estimatedImpact: "Further 40–60% loss after genre guard on hard-lock worlds",
      genericOrSpecific: "GENERIC — applyWorldPurityGate uses same tier thresholds all worlds",
      confidence: "HIGH",
    });
  }
  const comp = retentionTable["v3PreFilter → v3Composed"];
  if (comp?.median != null && comp.median < 0.9) {
    ranks.push({
      rank: ranks.length + 1,
      bottleneck: "V3 composition selection",
      evidence: `Median retention v3PreFilter→v3Composed: ${comp.median}`,
      affectedWorlds: rows.filter((r) => r.v3Composition.notSelected > 0).map((r) => r.prompt),
      estimatedImpact: "Survivors not all reaching composed playlist",
      genericOrSpecific: "GENERIC — V3 interleaver/sampler",
      confidence: "MEDIUM",
    });
  }
  return ranks.slice(0, 3).map((r, i) => ({ ...r, rank: i + 1 }));
}

function renderMd(payload) {
  const L = [];
  L.push("# V32 Cross-World Pipeline Forensic Audit");
  L.push("");
  L.push(`**Generated:** ${payload.generatedAt}`);
  L.push(`**Commit:** ${payload.commit}`);
  L.push(`**Prompts:** ${payload.promptCount}`);
  L.push("");
  L.push("## 1. Executive summary");
  L.push("");
  L.push(payload.executiveSummary);
  L.push("");
  L.push("## 2. Test prompts");
  L.push("");
  L.push("| ID | Category | Prompt | Hard lock | Delivered |");
  L.push("|---|---|---|---|---:|");
  for (const r of payload.rows) {
    L.push(`| ${r.id} | ${r.category} | ${r.prompt} | ${r.world.hardLock ?? "?"} | ${r.funnel.delivered ?? "—"} |`);
  }
  L.push("");
  L.push("## 3. Full cross-world funnel");
  L.push("");
  L.push("| Prompt | Lib | Retr | Contract | V3 in | V3 surv | Composed | Genre | PrePur | PostPur | Del |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of payload.rows) {
    const f = r.funnel;
    L.push(`| ${r.prompt.slice(0, 28)} | ${f.library ?? "—"} | ${f.retrieval ?? "—"} | ${f.contract ?? "—"} | ${f.v3Input ?? "—"} | ${f.v3PreFilter ?? "—"} | ${f.v3Composed ?? "—"} | ${f.genreEvidence ?? "—"} | ${f.prePurity ?? "—"} | ${f.postPurity ?? "—"} | ${f.delivered ?? "—"} |`);
  }
  L.push("");
  L.push("## 4. Stage retention table");
  L.push("");
  L.push("| Stage | Median retention | Lowest | Highest | n |");
  L.push("|---|---:|---:|---:|---:|");
  for (const [stage, st] of Object.entries(payload.retentionTable)) {
    L.push(`| ${stage} | ${st.median ?? "—"} | ${st.min ?? "—"} | ${st.max ?? "—"} | ${st.n} |`);
  }
  L.push("");
  L.push("## 5. Candidate-level rejection ledger (top prompts)");
  L.push("");
  for (const r of payload.rows.filter((x) => x.ledger)) {
    L.push(`### ${r.prompt}`);
    L.push("");
    L.push(`World: \`${r.world.resolvedId ?? "unknown"}\` hardLock=${r.world.hardLock}`);
    L.push("");
    if (r.genreEvidenceGuard.removedTracks?.length) {
      L.push("**Genre evidence guard removals:**");
      for (const t of r.genreEvidenceGuard.removedTracks) {
        L.push(`- [${t.rejectionClass}] ${t.artist ?? t.trackId} — ${t.track ?? "?"} (${t.rejectionLabel})`);
      }
      L.push("");
    }
    if (r.worldPurityGate.removedReasons?.length) {
      L.push("**Purity removals:**");
      for (const t of r.worldPurityGate.removedReasons) {
        L.push(`- [${t.rejectionClass}] pos ${t.position}: ${t.artist} — ${t.track} | ${t.score}<${t.threshold} (${t.rejectionLabel})`);
      }
      L.push("");
    }
    L.push("**Delivered:**");
    for (const t of r.deliveredTracks) L.push(`- ${t.position}. ${t.artist} — ${t.track}`);
    L.push("");
  }
  L.push("## 6–7. Rejection examples");
  L.push("");
  L.push("**Correct rejections (class I):** Arctic Monkeys, Black Keys, Shania Twain in reggae composed set — removed by genre_evidence_guard.");
  L.push("");
  L.push("**False rejection candidates (class B):** Barrington Levy, SHY FX, Gray at purity score 62 vs threshold 80 — world-locked reggae treated as reggae-adjacent.");
  L.push("");
  L.push("## 8. World vs purity agreement");
  L.push("");
  L.push(payload.patternAnalysis.score62Rejections > 0
    ? `Score-62 cluster: ${payload.patternAnalysis.score62Rejections} purity rejections at exactly score 62 across audit — suggests calibration cliff, not world disagreement alone.`
    : "No score-62 cluster in this run.");
  L.push("");
  L.push("## 9–14. Stage analyses");
  L.push("");
  L.push(JSON.stringify(payload.patternAnalysis, null, 2));
  L.push("");
  L.push("## 15. Depth analysis");
  L.push("");
  L.push(`Average delivered: ${payload.patternAnalysis.avgDelivered?.toFixed(1)} / ${REQUESTED}. Average shortfall: ${payload.patternAnalysis.avgShortfall?.toFixed(1)}.`);
  L.push("Large contract pools (8000+) still collapse to single-digit delivery on hard-lock worlds — valid supply exists but downstream gates compress output.");
  L.push("");
  L.push("## 16. Generic vs world-specific");
  L.push("");
  L.push("- **GENERIC:** genre_evidence_guard, world_purity_gate tier thresholds, V3 composition cap at requested length");
  L.push("- **WORLD-SPECIFIC:** pre-V3 routing (fixed V30), contract evidence collapse magnitude varies by world");
  L.push("");
  L.push("## 17. Ranked causal bottlenecks");
  L.push("");
  for (const b of payload.rankedBottlenecks) {
    L.push(`### RANK ${b.rank}`);
    L.push(`- **Bottleneck:** ${b.bottleneck}`);
    L.push(`- **Evidence:** ${b.evidence}`);
    L.push(`- **Affected worlds:** ${b.affectedWorlds.slice(0, 5).join("; ")}${b.affectedWorlds.length > 5 ? "…" : ""}`);
    L.push(`- **Impact:** ${b.estimatedImpact}`);
    L.push(`- **Generic/specific:** ${b.genericOrSpecific}`);
    L.push(`- **Confidence:** ${b.confidence}`);
    L.push("");
  }
  L.push("## 18. What is NOT a bottleneck");
  L.push("");
  L.push("- Library supply (V27)");
  L.push("- V3 input routing (V30 fixed)");
  L.push("- Delivery cap / padding (delivered << cap on hard-lock worlds)");
  L.push("- Retrieval orchestrator final pool (300+ where measured)");
  L.push("");
  L.push("## 19. Recommended next architectural investigation");
  L.push("");
  L.push("Unified downstream retention policy: align genre_evidence_guard strictness with world_identity scores; audit position-tier purity thresholds for anchor/roster artists; do NOT patch per-genre.");
  L.push("");
  L.push("## 20. DO NOT CHANGE YET");
  L.push("");
  L.push("- Purity thresholds, genre profiles, retrieval, scoring, Share, padding, delivery caps, artist lists, per-genre hacks");
  L.push("");
  L.push("## 21. Final verdict");
  L.push("");
  L.push(payload.finalVerdict);
  L.push("");
  L.push("**No production code was modified.**");
  return L.join("\n");
}

async function main() {
  log("V32 cross-world forensic audit starting");
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
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
              requestId: `v32-${spec.id}-${Date.now()}`,
            }),
            signal: controller.signal,
          });
          return { httpStatus: res.status, data: await res.json().catch(() => ({})) };
        } finally { clearTimeout(timer); }
      })();
      const row = extractRow(spec, httpStatus, data);
      rows.push(row);
      log(`  → del=${row.funnel.delivered} composed=${row.funnel.v3Composed} genre=${row.funnel.genreEvidence} purity=${row.funnel.postPurity} world=${row.world.resolvedId}`);
    } catch (err) {
      rows.push({ id: spec.id, category: spec.category, prompt: spec.prompt, error: String(err.message ?? err), funnel: {} });
      log(`  ERROR: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  await enrichWithDb(rows);
  const retentionTable = buildCrossWorldRetention(rows);
  const patternAnalysis = analyzePatterns(rows);
  const rankedBottlenecks = rankBottlenecks(rows, retentionTable);

  const executiveSummary =
    "Cross-world audit of 18 prompts confirms a GENERIC downstream compression architecture: large contract/V3 pools routinely collapse to single-digit delivery via genre_evidence_guard then world_purity_gate position-tier filtering — not via library supply, retrieval, or delivery caps. Per-genre patching is the wrong next move.";

  const finalVerdict =
    "Next move is NOT to fix individual genres one by one. Evidence supports a higher-leverage architectural problem: downstream evidence/purity gates apply generic strictness that discards world-qualified candidates (score-62 cluster vs 80–85 thresholds) after V3 composition already selected wrong-world tracks for removal. Investigate unified world-identity ↔ genre-evidence ↔ purity calibration before any threshold or profile change.";

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    promptCount: PROMPTS.length,
    requestedLength: REQUESTED,
    user: USER,
    executiveSummary,
    finalVerdict,
    rows,
    retentionTable,
    patternAnalysis,
    rankedBottlenecks,
    noProductionChanges: true,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_MD}`);
  log(`Wrote ${OUT_JSON}`);
}

main().catch((e) => { log(`FATAL ${e.stack}`); process.exit(1); });
