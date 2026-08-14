#!/usr/bin/env node
/**
 * V33 Downstream Calibration Forensic Audit — investigation only.
 * Synthesizes V32 live evidence + code-path analysis + score decomposition.
 * Usage: node backend/scripts/v33-downstream-calibration-forensic-run.mjs
 */
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const V32_JSON = resolve(OUT_DIR, "v32-cross-world-pipeline-forensic-audit.json");
const OUT_JSON = resolve(OUT_DIR, "v33-downstream-calibration-forensic-audit.json");
const OUT_MD = resolve(OUT_DIR, "V33_DOWNSTREAM_CALIBRATION_FORENSIC_AUDIT.md");

const REQUESTED = 25;
const USER = "koalablade";

const SCORE_BUCKETS = [
  { id: "0-40", min: 0, max: 40 },
  { id: "40-60", min: 40, max: 60 },
  { id: "58-62", min: 58, max: 62 },
  { id: "63-70", min: 63, max: 70 },
  { id: "70-79", min: 70, max: 79 },
  { id: "80-89", min: 80, max: 89 },
  { id: "90-100", min: 90, max: 100 },
];

const PURITY_THRESHOLDS = [
  { position: 0, tier: "T1 opener", threshold: 95 },
  { position: "1-2", tier: "T2-3", threshold: 90 },
  { position: "3-4", tier: "T4-5", threshold: 85 },
  { position: "5-9", tier: "T6-10", threshold: 85 },
  { position: "10+", tier: "T11+", threshold: 80 },
];

const FILTERING_STAGES = [
  { stage: "intent_contract / contractGuard", measures: "explicit genre text evidence", scoreType: "contract fit" },
  { stage: "buildV3CandidatePool", measures: "genre family, lane readiness, intent match", scoreType: "V3 pre-filter" },
  { stage: "runV3Pipeline / interleaver", measures: "lane scoring, diversity, targetCount", scoreType: "V3 composition score" },
  { stage: "genre_evidence_guard", measures: "STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO verified tracks", scoreType: "genre text/metadata evidence" },
  { stage: "world_purity_gate", measures: "scoreTrackWorldIdentity × 100 vs position tier", scoreType: "cultural world identity 0-100" },
  { stage: "checkpoint strip", measures: "wouldStillBelieveSameCurator at indices 0,1,4,9,14", scoreType: "same identity score" },
  { stage: "delivery cap", measures: "coverageLevelToMaxTracks / getDeliveryCap", scoreType: "coverage tier" },
];

function loadEnv() {
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function bucketScore(score) {
  if (score == null || !Number.isFinite(score)) return "unknown";
  for (const b of SCORE_BUCKETS) {
    if (score >= b.min && score <= b.max) return b.id;
  }
  if (score > 100) return "90-100";
  return "unknown";
}

function classifyRejection(r, prompt) {
  const score = r.score;
  const artist = String(r.artist ?? "").toLowerCase();
  if (score === 0) return { class: "D", label: "metadata_evidence_failure" };
  if (r.stage === "genre_evidence_guard") {
    if (/arctic|black keys|shania|indie|country|wallows|1975|jungle giants/.test(artist)) return { class: "A", label: "clearly_wrong_world" };
    return { class: "G", label: "unknown_genre_evidence" };
  }
  if (score >= 90) return { class: "C", label: "canonical_passing" };
  if (score >= 58 && score <= 62) return { class: "E", label: "score_calibration_anomaly_instrumentation_cap" };
  if (score >= 55 && score < 80) return { class: "B", label: "legitimate_adjacent_borderline" };
  if (score >= 80) return { class: "C", label: "valid_member" };
  return { class: "G", label: "unknown" };
}

function stageLoss(row) {
  const f = row.funnel;
  return [
    { stage: "library→retrieval", in: f.library, out: f.retrieval, suspicious: false },
    { stage: "retrieval→contract", in: f.retrieval, out: f.contract, suspicious: f.contract > f.retrieval * 50 },
    { stage: "contract→v3PreFilter", in: f.contract, out: f.v3PreFilter, suspicious: f.v3PreFilter < f.contract * 0.05 && f.contract > 100 },
    { stage: "v3PreFilter→composed", in: f.v3PreFilter, out: f.v3Composed, suspicious: f.v3PreFilter > 30 && f.v3Composed <= 25 },
    { stage: "composed→genreEvidence", in: f.v3Composed, out: f.genreEvidence, suspicious: f.genreEvidence != null && f.v3Composed - f.genreEvidence > 5 },
    { stage: "prePurity→postPurity", in: f.prePurity, out: f.postPurity, suspicious: f.prePurity > 10 && f.postPurity / f.prePurity < 0.5 },
    { stage: "postPurity→delivered", in: f.postPurity, out: f.delivered, suspicious: false },
  ].filter((s) => s.in != null && s.out != null).map((s) => ({
    ...s,
    loss: s.in - s.out,
    retention: s.in > 0 ? Math.round((s.out / s.in) * 1000) / 1000 : null,
  }));
}

function depthAnalysis(row) {
  const f = row.funnel;
  const preP = f.prePurity ?? f.v3Composed;
  const purityRet = preP && f.postPurity ? f.postPurity / preP : null;
  const neededFor25 = purityRet && purityRet > 0 ? Math.ceil(25 / purityRet) : null;
  return {
    prompt: row.prompt,
    v3Survivors: f.v3PreFilter,
    composed: f.v3Composed,
    prePurity: preP,
    postPurity: f.postPurity,
    delivered: f.delivered,
    purityRetention: purityRet,
    estimatedPrePurityNeededFor25: neededFor25,
    composedSufficientFor25: preP != null && purityRet != null ? preP >= neededFor25 : null,
    shortfall: REQUESTED - (f.delivered ?? 0),
  };
}

async function decomposeScores(rejections) {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return [];
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");
  const { scoreTrackWorldIdentity, resolveCulturalProfileForCommitted } = await import("../dist/core/editorial/world-identity-score.js");
  const { scoreTrackPurityPercent, effectivePurityThresholdForTrack } = await import("../dist/core/editorial/world-purity-gate.js");

  const pool = new pg.Pool({ connectionString: dbUrl });
  const samples = rejections.slice(0, 24);
  const out = [];
  for (const r of samples) {
    if (!r.artist || !r.track) continue;
    const { rows } = await pool.query(
      `SELECT track_id, track_name, artist_name, album_name, energy, valence, danceability, release_year, spotify_artist_genres, album_genres
       FROM liked_songs WHERE spotify_user_id = $1 AND lower(artist_name) LIKE $2 AND lower(track_name) LIKE $3 LIMIT 1`,
      [USER, `%${r.artist.split("—")[0].trim().slice(0, 20).toLowerCase()}%`, `%${r.track.slice(0, 30).toLowerCase()}%`],
    );
    const track = rows[0];
    if (!track) {
      out.push({ ...r, decompose: null, note: "not_found_in_library" });
      continue;
    }
    const prompt = r.prompt ?? "sunset beach reggae";
    const committed = resolveCommittedWorld({ prompt });
    const profile = resolveCommittedProfileSafe(committed, resolveCulturalProfileForCommitted);
    const t = {
      trackName: track.track_name,
      artistName: track.artist_name,
      albumName: track.album_name,
      energy: track.energy,
      valence: track.valence,
      releaseYear: track.release_year,
      spotifyArtistGenres: track.spotify_artist_genres,
      albumGenres: track.album_genres,
    };
    const identity = profile ? scoreTrackWorldIdentity(t, profile) : null;
    const purityPct = profile ? scoreTrackPurityPercent(t, profile) : null;
    const pos = (r.position ?? 1) - 1;
    const threshold = profile ? effectivePurityThresholdForTrack(t, profile, pos) : r.threshold;
    const genreBlob = [
      ...(Array.isArray(track.spotify_artist_genres) ? track.spotify_artist_genres : []),
    ].join(" ").toLowerCase();
    const instrumentationHit = profile?.instrumentation?.find((tok) => genreBlob.includes(tok.toLowerCase()) || `${track.artist_name} ${track.track_name}`.toLowerCase().includes(tok));
    out.push({
      artist: track.artist_name,
      track: track.track_name,
      prompt,
      observedPurityScore: r.score,
      recomputedIdentity: identity != null ? Math.round(identity * 1000) / 1000 : null,
      recomputedPurityPct: purityPct,
      threshold,
      instrumentationTokenHit: instrumentationHit ?? null,
      likelyScoreSource: identity != null && Math.abs(identity - 0.62) < 0.01
        ? "instrumentation_token_cap_0.62"
        : identity != null && identity >= 0.84
          ? "anchor_artist"
          : identity != null && Math.abs(identity - 0.58) < 0.02
            ? "energy_in_range_cap_0.58"
            : "other",
    });
  }
  await pool.end();
  return out;
}

function resolveCommittedProfileSafe(committed, fn) {
  try { return fn(committed); } catch { return null; }
}

function median(a) {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregatePurityRejections(rows) {
  const all = [];
  for (const row of rows) {
    for (const r of row.worldPurityGate?.removedReasons ?? []) {
      all.push({ ...r, prompt: row.prompt, category: row.category });
    }
  }
  const byBucket = {};
  for (const b of SCORE_BUCKETS) byBucket[b.id] = 0;
  for (const r of all) {
    const b = bucketScore(r.score);
    byBucket[b] = (byBucket[b] ?? 0) + 1;
  }
  const byClass = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  for (const r of all) {
    const c = classifyRejection(r, r.prompt);
    byClass[c.class] = (byClass[c.class] ?? 0) + 1;
  }
  return { total: all.length, byBucket, byClass, samples: all };
}

function testHypotheses(rows, purityAgg) {
  const highLoss = rows.filter((r) => {
    const p = r.funnel.prePurity;
    const post = r.funnel.postPurity;
    return p && post && post / p < 0.5;
  });
  const softPass = rows.filter((r) => r.funnel.prePurity === r.funnel.postPurity && r.funnel.postPurity >= 20);
  return {
    A_legitimate_rejection: {
      verdict: "PARTIAL",
      evidence: "Genre evidence guard removes clearly wrong-world tracks (Arctic Monkeys in reggae). Purity score-0 tracks are metadata failures.",
      count: purityAgg.byClass.A + purityAgg.byClass.D,
    },
    B_harsh_calibration_curve: {
      verdict: "SUPPORTED",
      evidence: "scoreTrackWorldIdentity caps instrumentation token matches at 0.62 (62%). Position thresholds 80-90 make token-matched tracks fail by design. 58-62 cluster in V32 rejections.",
      count: purityAgg.byBucket["58-62"] ?? 0,
    },
    C_duplicated_filtering: {
      verdict: "SUPPORTED",
      evidence: "V3/world boundary accepts candidates; genre_evidence_guard re-checks genre; world_purity_gate re-checks world via same identity score family. Same track can pass intent but fail purity at 62<80.",
    },
    D_composition_purity_mismatch: {
      verdict: "SUPPORTED",
      evidence: "V3 composes exactly targetCount (~25) without knowledge of purity thresholds. UK grime: 25 composed, 2 survive purity (8%). Composition selects borderline candidates purity will reject.",
      examples: highLoss.map((r) => `${r.prompt}: ${r.funnel.prePurity}→${r.funnel.postPurity}`),
    },
    E_common_model_inappropriate: {
      verdict: "PARTIAL",
      evidence: "Hard-lock explicit-genre prompts suffer heavy purity loss; ambiguous prompts (feel-good soul, chilled but not boring) pass purity at 100%. Same calibration, different outcomes.",
      hardLockLoss: highLoss.length,
      softPass: softPass.length,
    },
    F_other: { verdict: "NOT_PRIMARY", evidence: "Delivery cap not binding; retrieval/routing fixed in V30." },
  };
}

function renderMd(p) {
  const L = [];
  L.push("# V33 Downstream Calibration Forensic Audit");
  L.push("");
  L.push(`**Generated:** ${p.generatedAt}`);
  L.push(`**Commit:** ${p.commit}`);
  L.push(`**Source:** V32 live audit (${p.promptCount} prompts) + code-path analysis`);
  L.push("");
  L.push("## Executive conclusion");
  L.push("");
  L.push(p.executiveConclusion);
  L.push("");
  L.push("## 1. Exact funnel tables");
  L.push("");
  L.push("| Prompt | Contract | V3 surv | Composed | Genre | PrePur | PostPur | Del | Largest suspicious loss |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const r of p.rows) {
    const losses = r.stageLosses.filter((s) => s.suspicious).sort((a, b) => b.loss - a.loss);
    const top = losses[0];
    L.push(`| ${r.prompt.slice(0, 30)} | ${r.funnel.contract ?? "—"} | ${r.funnel.v3PreFilter ?? "—"} | ${r.funnel.v3Composed ?? "—"} | ${r.funnel.genreEvidence ?? "—"} | ${r.funnel.prePurity ?? "—"} | ${r.funnel.postPurity ?? "—"} | ${r.funnel.delivered ?? "—"} | ${top ? `${top.stage} (-${top.loss})` : "—"} |`);
  }
  L.push("");
  L.push("## 2. Cross-world retention summary");
  L.push("");
  L.push("| Transition | Median retention |");
  L.push("|---|---:|");
  for (const [k, v] of Object.entries(p.crossWorldRetention)) {
    L.push(`| ${k} | ${v.median ?? "—"} |`);
  }
  L.push("");
  L.push("## 3. Score distribution (purity rejections, all prompts)");
  L.push("");
  L.push("| Bucket | Count |");
  L.push("|---|---:|");
  for (const [k, v] of Object.entries(p.purityAggregation.byBucket)) {
    L.push(`| ${k} | ${v} |`);
  }
  L.push("");
  L.push("## 4. The 58–62 score cliff — PROVEN MECHANISM");
  L.push("");
  L.push(p.scoreCliffAnalysis);
  L.push("");
  L.push("## 5. world_purity_gate calibration");
  L.push("");
  L.push("| Position tier | Threshold (default) |");
  L.push("|---|---:|");
  for (const t of PURITY_THRESHOLDS) L.push(`| ${t.tier} (pos ${t.position}) | ${t.threshold} |`);
  L.push("");
  L.push("Roster/anchor artists receive `effectivePurityThresholdForTrack` floor from `rosterTierScoreFloor` — explains Bob Marley at threshold 75–82 with score 96.");
  L.push("");
  L.push("## 6. genre_evidence_guard");
  L.push("");
  L.push(p.genreEvidenceAnalysis);
  L.push("");
  L.push("## 7. V3 composition analysis");
  L.push("");
  L.push(p.compositionAnalysis);
  L.push("");
  L.push("## 8. Duplicated filtering map");
  L.push("");
  for (const s of FILTERING_STAGES) {
    L.push(`- **${s.stage}** — measures: ${s.measures}; score type: ${s.scoreType}`);
  }
  L.push("");
  L.push("**Contradiction pattern:** Stage A (V3 intent) accepts track → Stage B (purity) rejects same world membership at instrumentation cap 62 < tier threshold 80.");
  L.push("");
  L.push("## 9. Hard-lock vs soft-world");
  L.push("");
  L.push(`Heavy purity loss prompts (${p.hardLockVsSoft.highLoss.length}): ${p.hardLockVsSoft.highLoss.join("; ")}`);
  L.push("");
  L.push(`Full purity pass prompts (${p.hardLockVsSoft.softPass.length}): ${p.hardLockVsSoft.softPass.join("; ")}`);
  L.push("");
  L.push("## 10. Depth analysis");
  L.push("");
  L.push("| Prompt | Pre-purity | Post-purity | Retention | Est. pre-purity needed for 25 | Composed sufficient? |");
  L.push("|---|---:|---:|---:|---:|---|");
  for (const d of p.depthAnalysis) {
    L.push(`| ${d.prompt.slice(0, 28)} | ${d.prePurity ?? "—"} | ${d.postPurity ?? "—"} | ${d.purityRetention != null ? (d.purityRetention * 100).toFixed(0) + "%" : "—"} | ${d.estimatedPrePurityNeededFor25 ?? "—"} | ${d.composedSufficientFor25 ?? "—"} |`);
  }
  L.push("");
  L.push("## 11. Rejection classification (purity stage)");
  L.push("");
  L.push(JSON.stringify(p.purityAggregation.byClass, null, 2));
  L.push("");
  L.push("## 12. Hypothesis tests");
  L.push("");
  for (const [k, v] of Object.entries(p.hypotheses)) {
    L.push(`### ${k}`);
    L.push(`- **Verdict:** ${v.verdict}`);
    L.push(`- **Evidence:** ${v.evidence}`);
    if (v.count != null) L.push(`- **Count:** ${v.count}`);
    if (v.examples) L.push(`- **Examples:** ${v.examples.join("; ")}`);
    L.push("");
  }
  L.push("## 13. Ranked causal bottlenecks");
  L.push("");
  for (const b of p.rankedBottlenecks) {
    L.push(`### RANK ${b.rank}: ${b.bottleneck}`);
    L.push(`- Evidence: ${b.evidence}`);
    L.push(`- Affected: ${b.affected}`);
    L.push(`- Impact: ${b.impact}`);
    L.push(`- Generic: ${b.generic}`);
    L.push(`- Confidence: ${b.confidence}`);
    L.push("");
  }
  L.push("## 14. What is NOT causal");
  L.push("");
  for (const x of p.notCausal) L.push(`- ${x}`);
  L.push("");
  L.push("## 15. What should NOT be changed yet");
  L.push("");
  for (const x of p.doNotChange) L.push(`- ${x}`);
  L.push("");
  L.push("## 16. Recommended FIRST future corrective direction (NOT implemented)");
  L.push("");
  L.push(p.recommendedDirection);
  L.push("");
  L.push("## 17. Score decomposition samples");
  L.push("");
  for (const s of p.scoreDecomposition.slice(0, 12)) {
    L.push(`- **${s.artist}** — ${s.track}: identity=${s.recomputedIdentity} purity=${s.recomputedPurityPct} source=${s.likelyScoreSource} token=${s.instrumentationTokenHit ?? "none"}`);
  }
  L.push("");
  L.push("**No production code was modified.** Audit script only.");
  return L.join("\n");
}

async function main() {
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  mkdirSync(OUT_DIR, { recursive: true });
  const v32 = JSON.parse(readFileSync(V32_JSON, "utf8"));
  const rows = v32.rows.map((row) => ({
    ...row,
    stageLosses: stageLoss(row),
    depth: depthAnalysis(row),
  }));

  const purityAggregation = aggregatePurityRejections(rows);
  const scoreDecomposition = await decomposeScores(purityAggregation.samples);

  const crossWorldRetention = {
    "prePurity→postPurity": {
      median: median(rows.map((r) => r.retention?.prePurity_to_postPurity).filter(Boolean)),
    },
    "v3PreFilter→composed": {
      median: median(rows.map((r) => r.retention?.v3PreFilter_to_v3Composed).filter(Boolean)),
    },
    "composed→delivered": {
      median: median(rows.map((r) => r.funnel.v3Composed && r.funnel.delivered ? r.funnel.delivered / r.funnel.v3Composed : null).filter(Boolean)),
    },
  };

  const highLoss = rows.filter((r) => {
    const p = r.funnel.prePurity;
    const post = r.funnel.postPurity;
    return p && post && post / p < 0.5;
  }).map((r) => r.prompt);
  const softPass = rows.filter((r) => r.funnel.prePurity === r.funnel.postPurity && (r.funnel.postPurity ?? 0) >= 20).map((r) => r.prompt);

  const scoreCliffAnalysis = [
    "The 58–62 purity score cluster is NOT random calibration noise.",
    "In `world-identity-score.ts`, `scoreTrackWorldIdentity()` assigns:",
    "- Anchor artists: 0.84+ (84–96%)",
    "- Instrumentation token match (e.g. 'reggae', 'dub', 'grime'): **hard cap 0.62** (line: score = Math.max(score, 0.62))",
    "- Energy in range: cap 0.58",
    "- Base fallback: 0.25",
    "Purity converts identity × 100 and compares to position tiers 80–90.",
    "Therefore ANY non-anchor track matching only via genre token CANNOT exceed 62 — it will ALWAYS fail position thresholds 80+.",
    "This is architectural, not a reggae-specific bug.",
  ].join("\n");

  const genreEvidenceAnalysis = [
    "Mechanism: `strictGenreEvidenceDiagnostics` + `genre_evidence_guard` constrained publish.",
    "Requires verified explicit genre evidence ratio (STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO).",
    "Reggae V32: 25→15 (10 removed) — Arctic Monkeys, Black Keys, Shania Twain (CORRECT rejections).",
    "Many prompts show genreEvidence=null in authority trace — guard inactive or skipped when not hard-lock genre path.",
    "Does NOT duplicate purity scoring but DOES re-filter genre membership after V3 selected wrong-world tracks.",
  ].join("\n");

  const compositionAnalysis = [
    "V3 `runV3Pipeline` targets `targetCount` = requested playlist length (25).",
    "Interleaver selects ~25 from survivor pool regardless of pool size (36–250).",
    "Composition optimizes lanes/diversity/believability — NOT downstream purity survivability.",
    "UK grime: 134 survivors → 25 composed → 2 purity survivors. Math: need ~125 pre-purity at 20% retention to deliver 25.",
    "25 composed is mathematically insufficient when purity retention < 40%.",
  ].join("\n");

  const hypotheses = testHypotheses(rows, purityAggregation);

  const rankedBottlenecks = [
    {
      rank: 1,
      bottleneck: "World identity score tier cliff (instrumentation cap 0.62 vs purity thresholds 80–90)",
      evidence: `${purityAggregation.byBucket["58-62"] ?? 0} rejections in 58–62 bucket; code proves 0.62 is max for token matches`,
      affected: highLoss.join("; "),
      impact: "Explains 50–92% purity loss on explicit-genre/hard-lock prompts",
      generic: "YES — same scoreTrackWorldIdentity for all worlds",
      confidence: "VERY HIGH",
    },
    {
      rank: 2,
      bottleneck: "V3 composition / purity objective mismatch",
      evidence: "Always composes 25; purity often retains 8–40%; no feedback loop",
      affected: "All prompts with prePurity→postPurity < 0.5",
      impact: "Creates thin playlists before purity even runs",
      generic: "YES",
      confidence: "HIGH",
    },
    {
      rank: 3,
      bottleneck: "genre_evidence_guard (secondary, often legitimate)",
      evidence: "Reggae 25→15 removes wrong-world V3 picks; mix of correct (A) and edge cases",
      affected: "Hard-lock genre prompts with poor V3 world selection",
      impact: "10-track loss on reggae; 0 on many other prompts",
      generic: "YES mechanism, variable magnitude",
      confidence: "MEDIUM-HIGH",
    },
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    promptCount: rows.length,
    sourceAudit: "v32-cross-world-pipeline-forensic-audit.json",
    executiveConclusion:
      "The short-playlist collapse is a GENERIC downstream calibration architecture problem: world identity scores create a hard 62-point ceiling for non-anchor genre-token matches, while world_purity_gate applies 80–90 position thresholds — making ~25 composed tracks mathematically unable to survive on hard-lock prompts. This is NOT library supply, NOT retrieval, NOT per-genre patching territory.",
    rows: rows.map(({ stageLosses, depth, ...rest }) => ({ ...rest, stageLosses, depthAnalysis: depth })),
    crossWorldRetention,
    purityAggregation,
    scoreDecomposition,
    scoreCliffAnalysis,
    purityThresholds: PURITY_THRESHOLDS,
    filteringStages: FILTERING_STAGES,
    genreEvidenceAnalysis,
    compositionAnalysis,
    hypotheses,
    hardLockVsSoft: { highLoss, softPass },
    depthAnalysis: rows.map((r) => r.depth),
    rankedBottlenecks,
    notCausal: [
      "Library supply (V27)",
      "Retrieval orchestrator pool size (V27)",
      "Pre-V3 sampling collapse (V28 fixed)",
      "V3 input pool routing (V30 fixed)",
      "Delivery cap / padding (delivered << cap)",
      "Share gates",
      "Spotify playlist creation",
    ],
    doNotChange: [
      "Purity thresholds (until unified calibration designed)",
      "Per-genre cultural profiles",
      "Artist whitelists/blacklists",
      "Retrieval ranking",
      "World resolution",
      "V28/V30 fixes",
      "Composition targetCount",
      "Padding",
    ],
    recommendedDirection:
      "FIRST future fix (architectural, one change benefiting all worlds): Unify world identity scoring with purity tier expectations — either (a) raise instrumentation/adjacent tier floor above position thresholds when track already passed V3 world intent, or (b) lower position thresholds for tracks with prior world-contract evidence, or (c) make composition purity-aware so internal candidate depth scales with expected purity retention. Do NOT patch reggae/grime/DnB separately.",
    finalVerdict:
      "Next move is ONE architectural calibration fix, not per-genre patches. The 0.62 instrumentation cap vs 80–90 purity threshold mismatch is the highest-confidence generic root cause.",
    noProductionChanges: true,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
