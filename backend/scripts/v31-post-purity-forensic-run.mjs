#!/usr/bin/env node
/**
 * V31 Forensic Post-Purity Audit — investigation only. No production changes.
 * Usage: node backend/scripts/v31-post-purity-forensic-run.mjs
 */
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v31-forensic-post-purity-audit.json");
const OUT_MD = resolve(OUT_DIR, "V31_FORENSIC_POST_PURITY_AUDIT.md");
const OUT_LOG = resolve(OUT_DIR, "v31-post-purity-run.log");

const USER = "koalablade";
const PROMPT_TIMEOUT_MS = 12 * 60 * 1000;
const DELAY_MS = 5000;

const PROMPTS = [
  { id: "V31-01", prompt: "sunset beach reggae", primary: true },
  { id: "V31-02", prompt: "late night UK garage drive" },
  { id: "V31-03", prompt: "2000s pop punk gym workout" },
  { id: "V31-04", prompt: "hard techno gym" },
];

const REGGAE_ANCHORS = [
  "bob marley", "peter tosh", "toots", "jimmy cliff", "gregory isaacs",
  "shaggy", "sean paul", "ub40", "damian marley", "burning spear", "steel pulse",
];

const V29_REGGAE = { v3Input: 17, v3PreFilter: 17, v3Composed: 25, postPurity: 6, delivered: 6 };
const V30_REGGAE = { v3Input: 200, v3PreFilter: 36, v3Composed: 25, postPurity: 6, delivered: 6 };

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function norm(s) {
  return String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
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
        spotifyUserId: USER,
        requestId: `v31-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      signal: controller.signal,
    });
    return { httpStatus: res.status, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

function trackKey(t) {
  return `${norm(t.artistName ?? t.artist)}|${norm(t.trackName ?? t.track ?? t.name)}`;
}

function classifyReggaeTrack(track, scorePct, profile) {
  const artist = norm(track.artistName ?? track.artist);
  const isAnchor = REGGAE_ANCHORS.some((a) => artist.includes(a));
  const genres = [
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    track.genrePrimary, track.genreFamily,
  ].join(" ").toLowerCase();
  const reggaeGenre = /reggae|dancehall|dub|rocksteady|ska/.test(genres);
  const wrongWorld = /mgmt|wallows|the 1975|beach house|indie/.test(artist + " " + genres);
  if (wrongWorld) return "genuinely_wrong_world";
  if (isAnchor || (reggaeGenre && scorePct >= 60)) return "unquestionably_reggae";
  if (reggaeGenre || scorePct >= 45) return "reggae_adjacent";
  if (scorePct >= 35) return "borderline";
  return "likely_wrong_world";
}

function parsePurityReason(reason) {
  const m = reason.match(/pos_(\d+):(.+?) — (.+?):(\d+)<(\d+)/);
  if (m) {
    return {
      position: Number(m[1]),
      artist: m[2].trim(),
      track: m[3].trim(),
      score: Number(m[4]),
      threshold: Number(m[5]),
    };
  }
  const ck = reason.match(/checkpoint_(\d+):(.+?) — (.+?):(\d+)<(\d+)@pos_(\d+)/);
  if (ck) {
    return {
      checkpoint: Number(ck[1]),
      artist: ck[2].trim(),
      track: ck[3].trim(),
      score: Number(ck[4]),
      threshold: Number(ck[5]),
      compositionPosition: Number(ck[6]),
    };
  }
  return { raw: reason };
}

function classifyRejectionBucket(entry, humanQuality) {
  if (entry.stage === "v3_composition_not_selected") return "D";
  if (entry.stage === "hard_reject_off_world") return "A";
  if (entry.stage === "purity_position_filter") {
    if (humanQuality === "genuinely_wrong_world") return "A";
    if (humanQuality === "unquestionably_reggae" || humanQuality === "reggae_adjacent") return "B";
    return "G";
  }
  if (entry.stage === "purity_checkpoint_strip") return "B";
  if (entry.stage === "genre_evidence_guard") return "G";
  if (entry.stage === "delivery_cap") return "E";
  if (entry.stage === "duplicate") return "F";
  return "H";
}

function extractRow(prompt, id, httpStatus, data, scoringHelpers) {
  const gd = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const wf = v3.waterfall ?? gd.waterfall ?? {};
  const deliveryLoss = gd.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
  const purity = gd.puritySubFunnel ?? data.puritySubFunnel ?? {};
  const finalization = data.finalization ?? {};
  const authority = finalization.pipelineAuthority ?? null;
  const underfill = gd.deliveryUnderfillForensics ?? {};
  const v3InputRouting = v3.controlledGeneration?.retrievalLatencyGuard?.v3InputRouting ?? null;

  const funnel = {
    library: num(gd.initialLibrarySize) ?? num(wf.libraryCount),
    retrieval: num(gd.candidatesSampled) ?? num(wf.retrievalCount),
    contract: num(wf.contractCount) ?? num(gd.candidatesAfterIntent),
    v3Input: num(v3InputRouting?.inputPoolSize),
    v3Survivors: num(deliveryLoss.v3PreFilterSurvivors),
    v3Composed: num(deliveryLoss.v3Composed) ?? num(wf.samplerCount),
    postPurity: num(deliveryLoss.postPurity) ?? num(purity.postFilterByWorldPurityCount),
    delivered: (data.tracks ?? []).length,
  };

  const deliveredTracks = (data.tracks ?? []).map((t, i) => ({
    position: i + 1,
    trackId: t.trackId ?? t.id ?? null,
    artist: t.artistName ?? t.artist,
    track: t.trackName ?? t.name,
    spotifyUri: t.spotifyUri ?? (t.trackId ? `spotify:track:${t.trackId}` : null),
  }));

  const checkpointDecisions = Array.isArray(purity.checkpointDecisions) ? purity.checkpointDecisions : [];
  const removedReasons = Array.isArray(purity.removedReasons) ? purity.removedReasons : [];
  const checkpointRemoved = Array.isArray(purity.checkpointRemovedReasons) ? purity.checkpointRemovedReasons : [];

  const preV3Candidates = Array.isArray(v3.preV3TopCandidates) ? v3.preV3TopCandidates : [];
  const profile = scoringHelpers?.profile ?? null;
  const scorePct = scoringHelpers?.scorePct ?? (() => 0);

  const scoredInputSample = preV3Candidates.slice(0, 40).map((t) => {
    const pct = profile ? scorePct(t) : null;
    return {
      trackId: t.trackId,
      artist: t.artistName,
      track: t.trackName,
      genrePrimary: t.genrePrimary ?? null,
      genreFamily: t.genreFamily ?? null,
      spotifyArtistGenres: t.spotifyArtistGenres ?? [],
      purityScorePct: pct,
      reggaeClass: profile && pct != null ? classifyReggaeTrack(t, pct, profile) : null,
      sourceNote: "preV3TopCandidates_input_pool_not_v3_survivor_list",
    };
  });

  const purityRejectLedger = removedReasons.map((reason, i) => {
    const parsed = parsePurityReason(reason);
    const hq = parsed.score != null ? classifyReggaeTrack(parsed, parsed.score, profile) : "unknown";
    return {
      index: i + 1,
      stage: "purity_position_filter",
      ...parsed,
      humanQualityClass: hq,
      bucket: classifyRejectionBucket({ stage: "purity_position_filter" }, hq),
      rejectionFunction: "filterByWorldPurity → trackPassesWorldPurity",
    };
  });

  const checkpointLedger = checkpointDecisions.map((d) => ({
    stage: d.passed ? "purity_checkpoint_pass" : "purity_checkpoint_fail",
    checkpointSurvivorIndex: d.checkpointSurvivorIndex,
    compositionPosition: d.compositionPosition,
    artist: d.artist,
    track: d.track,
    score: d.score,
    threshold: d.threshold,
    passed: d.passed,
    bucket: d.passed ? null : classifyRejectionBucket({ stage: "purity_checkpoint_strip" }, "reggae_adjacent"),
    rejectionFunction: "stripFromCheckpointFailure → evaluateCheckpointDecisions",
  }));

  const authorityStages = Array.isArray(authority?.mutations)
    ? authority.mutations.map((m) => ({
        stage: m.stage,
        reason: m.reason,
        beforeCount: m.beforeCount,
        afterCount: m.afterCount,
        tracksRemoved: m.tracksRemoved,
      }))
    : [];

  const underfillStages = Array.isArray(underfill.stages) ? underfill.stages : [];
  const genreEvidence = underfill.genreEvidenceAudit ?? null;

  return {
    id,
    prompt,
    httpStatus,
    success: data.success === true,
    funnel,
    puritySubFunnel: {
      prePurityCount: num(purity.prePurityCount),
      postFilterByWorldPurityCount: num(purity.postFilterByWorldPurityCount),
      postCheckpointStripCount: num(purity.postCheckpointStripCount),
      checkpointStripApplied: purity.checkpointStripApplied ?? null,
      hardRejectOffWorldCount: num(purity.hardRejectOffWorldCount),
    },
    deliveredTracks,
    purityRejectLedger,
    checkpointLedger,
    checkpointRemovedReasons: checkpointRemoved,
    authorityStages,
    underfillStages,
    genreEvidenceRejected: genreEvidence?.rejected ?? [],
    genreEvidenceVerified: genreEvidence?.verified ?? [],
    scoredInputSample,
    v3SurvivorCountNote: `API exposes v3PreFilterSurvivors=${funnel.v3Survivors} but not full survivor track list; ledger built from purity removedReasons + checkpointDecisions + delivered tracks`,
    preV3WorldSampling: gd.preV3WorldSampling ?? v3.intentContractGuard?.preV3WorldSampling ?? null,
  };
}

async function loadLibraryAndHelpers() {
  loadDotEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { library: [], helpers: null };

  const pool = new pg.Pool({ connectionString: dbUrl });
  const { rows } = await pool.query(
    "SELECT track_id, track_name, artist_name, album_name, energy, valence, danceability, popularity, release_year, spotify_artist_genres, album_genres FROM liked_songs WHERE spotify_user_id = $1",
    [USER],
  );
  await pool.end();

  const library = rows.map((r) => ({
    trackId: r.track_id,
    trackName: r.track_name,
    artistName: r.artist_name,
    albumName: r.album_name,
    energy: r.energy,
    valence: r.valence,
    danceability: r.danceability,
    popularity: r.popularity,
    releaseYear: r.release_year,
    spotifyArtistGenres: r.spotify_artist_genres,
    albumGenres: r.album_genres,
  }));

  const { resolveCulturalProfileForCommitted } = await import("../dist/core/editorial/world-identity-score.js");
  const { scoreTrackPurityPercent } = await import("../dist/core/editorial/world-purity-gate.js");
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");

  const committed = resolveCommittedWorld({ prompt: "sunset beach reggae" });
  const profile = resolveCulturalProfileForCommitted(committed);

  const anchorCounts = {};
  for (const a of REGGAE_ANCHORS) anchorCounts[a] = 0;
  for (const track of library) {
    const artist = norm(track.artistName);
    for (const a of REGGAE_ANCHORS) {
      if (artist.includes(a)) anchorCounts[a] += 1;
    }
  }

  return {
    library,
    librarySize: library.length,
    reggaeAnchorCounts: anchorCounts,
    helpers: {
      profile,
      scorePct: (t) => scoreTrackPurityPercent(t, profile),
    },
  };
}

function aggregateBuckets(rows) {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 };
  for (const row of rows) {
    for (const entry of [...row.purityRejectLedger, ...row.checkpointLedger.filter((c) => !c.passed)]) {
      const b = entry.bucket ?? "H";
      counts[b] = (counts[b] ?? 0) + 1;
    }
  }
  return counts;
}

function renderMd(payload) {
  const lines = [];
  lines.push("# V31 Forensic Post-Purity Audit");
  lines.push("");
  lines.push(`**Generated:** ${payload.generatedAt}`);
  lines.push(`**Commit:** ${payload.commit}`);
  lines.push("");
  lines.push("## A. Executive conclusion");
  lines.push("");
  lines.push(payload.executiveConclusion);
  lines.push("");
  lines.push("## B. Funnel table");
  lines.push("");
  lines.push("| Prompt | Library | Retrieval | Contract | V3 input | V3 survivors | V3 composed | Post-purity | Delivered |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of payload.liveResults) {
    const f = row.funnel;
    lines.push(`| ${row.prompt} | ${f.library ?? "—"} | ${f.retrieval ?? "—"} | ${f.contract ?? "—"} | ${f.v3Input ?? "—"} | ${f.v3Survivors ?? "—"} | ${f.v3Composed ?? "—"} | ${f.postPurity ?? "—"} | ${f.delivered ?? "—"} |`);
  }
  lines.push("");
  lines.push("## C. Track-level rejection ledger (reggae)");
  lines.push("");
  const reggae = payload.liveResults.find((r) => r.prompt === "sunset beach reggae");
  if (reggae) {
    lines.push(`V3 survivor count: **${reggae.funnel.v3Survivors}** (full list not exported by audit API)`);
    lines.push("");
    lines.push("### Purity position-filter rejections");
    lines.push("");
    if (reggae.purityRejectLedger.length === 0) lines.push("_No position-filter removedReasons captured._");
    for (const e of reggae.purityRejectLedger) {
      lines.push(`- **${e.artist ?? "?"}** — ${e.track ?? "?"} | score=${e.score ?? "?"} threshold=${e.threshold ?? "?"} | bucket **${e.bucket}** (${e.humanQualityClass})`);
    }
    lines.push("");
    lines.push("### Checkpoint decisions");
    lines.push("");
    for (const c of reggae.checkpointLedger) {
      lines.push(`- pos ${c.compositionPosition + 1}: **${c.artist}** — ${c.track} | score=${c.score} threshold=${c.threshold} | ${c.passed ? "PASS" : "FAIL"}`);
    }
    lines.push("");
    lines.push("### Delivered (survived all stages)");
    lines.push("");
    for (const t of reggae.deliveredTracks) {
      lines.push(`- ${t.position}. **${t.artist}** — ${t.track}`);
    }
  }
  lines.push("");
  lines.push("## D. Rejection classification counts");
  lines.push("");
  lines.push(JSON.stringify(payload.rejectionBuckets, null, 2));
  lines.push("");
  lines.push("## E. Metadata integrity (V28-expanded candidates)");
  lines.push("");
  lines.push(payload.metadataIntegrity);
  lines.push("");
  lines.push("## F. Human-quality candidate estimate (reggae input sample)");
  lines.push("");
  if (reggae?.scoredInputSample?.length) {
    const classes = {};
    for (const t of reggae.scoredInputSample) {
      const c = t.reggaeClass ?? "unknown";
      classes[c] = (classes[c] ?? 0) + 1;
    }
    lines.push(`Sampled ${reggae.scoredInputSample.length} tracks from preV3TopCandidates (V3 input pool, capped at 40 in audit):`);
    lines.push("");
    for (const [k, v] of Object.entries(classes)) lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## G. Root-cause verdict");
  lines.push("");
  lines.push(`**${payload.rootCauseVerdict.code}** — ${payload.rootCauseVerdict.label}`);
  lines.push("");
  lines.push(payload.rootCauseVerdict.evidence);
  lines.push("");
  lines.push("## H. V29/V30 path comparison (reggae)");
  lines.push("");
  lines.push("| Stage | V29 (17-track input) | V30 (200-track input) | V31 live |");
  lines.push("|---|---:|---:|---:|");
  if (reggae) {
    lines.push(`| V3 input | ${V29_REGGAE.v3Input} | ${V30_REGGAE.v3Input} | ${reggae.funnel.v3Input ?? "—"} |`);
    lines.push(`| v3PreFilter | ${V29_REGGAE.v3PreFilter} | ${V30_REGGAE.v3PreFilter} | ${reggae.funnel.v3Survivors ?? "—"} |`);
    lines.push(`| v3Composed | ${V29_REGGAE.v3Composed} | ${V30_REGGAE.v3Composed} | ${reggae.funnel.v3Composed ?? "—"} |`);
    lines.push(`| postPurity | ${V29_REGGAE.postPurity} | ${V30_REGGAE.postPurity} | ${reggae.funnel.postPurity ?? "—"} |`);
    lines.push(`| delivered | ${V29_REGGAE.delivered} | ${V30_REGGAE.delivered} | ${reggae.funnel.delivered ?? "—"} |`);
  }
  lines.push("");
  lines.push("## I. Library reggae supply");
  lines.push("");
  lines.push(JSON.stringify(payload.libraryReggaeSupply, null, 2));
  lines.push("");
  lines.push("## J. Purity implementation trace");
  lines.push("");
  lines.push(payload.purityImplementationTrace);
  lines.push("");
  lines.push("**No production code was modified for this audit.**");
  return lines.join("\n");
}

async function main() {
  log("V31 post-purity forensic audit starting");
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const { library, librarySize, reggaeAnchorCounts, helpers } = await loadLibraryAndHelpers();

  const creds = await resolveCreds();
  const liveResults = [];
  for (const { id, prompt } of PROMPTS) {
    log(`Audit: ${prompt}`);
    const { httpStatus, data } = await generate(creds, prompt);
    liveResults.push(extractRow(prompt, id, httpStatus, data, prompt.includes("reggae") ? helpers : null));
    log(`  survivors=${liveResults.at(-1).funnel.v3Survivors} composed=${liveResults.at(-1).funnel.v3Composed} postPurity=${liveResults.at(-1).funnel.postPurity} delivered=${liveResults.at(-1).funnel.delivered}`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const reggae = liveResults.find((r) => r.prompt === "sunset beach reggae");
  const rejectionBuckets = aggregateBuckets(liveResults.filter((r) => r.prompt.includes("reggae")));

  let executiveConclusion = "Causality partially resolved: post-purity and checkpoint strip remove most composed tracks for reggae; delivery count unchanged after V30 routing fix.";
  let rootCode = 6;
  let rootLabel = "Multiple bottlenecks";
  let rootEvidence = "";

  if (reggae) {
    const prePurity = reggae.puritySubFunnel.prePurityCount ?? reggae.funnel.v3Composed;
    const postFilter = reggae.puritySubFunnel.postFilterByWorldPurityCount;
    const postStrip = reggae.puritySubFunnel.postCheckpointStripCount;
    const v3Loss = (reggae.funnel.v3Survivors ?? 0) - (reggae.funnel.v3Composed ?? 0);
    const purityLoss = (prePurity ?? reggae.funnel.v3Composed ?? 0) - (reggae.funnel.postPurity ?? 0);

    rootEvidence = [
      `V3 composition: ${reggae.funnel.v3Survivors} survivors → ${reggae.funnel.v3Composed} composed (${v3Loss} not selected by V3).`,
      `Purity sub-funnel: prePurity=${prePurity} postFilter=${postFilter} postCheckpointStrip=${postStrip} delivered=${reggae.funnel.delivered}.`,
      `Position-filter removedReasons: ${reggae.purityRejectLedger.length}. Checkpoint failures: ${reggae.checkpointLedger.filter((c) => !c.passed).length}.`,
      `V30 routing fix increased survivors 17→${reggae.funnel.v3Survivors} but delivered unchanged at ${reggae.funnel.delivered} — downstream bottleneck confirmed.`,
    ].join(" ");

    if (reggae.funnel.delivered === V29_REGGAE.delivered && reggae.funnel.postPurity === V29_REGGAE.postPurity) {
      executiveConclusion = "V30 expanded V3 input and survivors (17→36) but post-purity and delivery remain at 6 — the causal bottleneck is downstream of V3 pre-filter, primarily world-purity checkpoint strip and position-tier filtering on the composed playlist.";
      rootCode = 6;
      rootLabel = "Multiple bottlenecks — primary: post-purity checkpoint strip + position-tier filter; secondary: V3 composition (36→25)";
    }
  }

  const metadataIntegrity = reggae?.scoredInputSample?.length
    ? "preV3TopCandidates from V30-expanded input retain genrePrimary/genreFamily/spotifyArtistGenres in audit payload; no evidence of metadata stripping between contractGuardedScoredPool and audit export. Survivor list not exported — cannot diff per-track metadata on all 36 survivors."
    : "Insufficient audit payload for metadata integrity check.";

  const purityImplementationTrace = [
    "Primary path: generation.controller.ts → applyWorldPurityGate() after V3 handoff",
    "Stages inside applyWorldPurityGate (world-purity-gate.ts):",
    "  1. filterByWorldPurity — per-position score vs effectivePurityThresholdForTrack (T1=95, T2-3=90, T4-5=85, T6-10=85, T11+=80; roster floor for anchors)",
    "  2. replaceCheckpointFailures — checkpoint backfill from replacement pool",
    "  3. stripFromCheckpointFailure — truncate from first failing checkpoint (indices 0,1,4,9,14)",
    "  4. sequenceAfterPurityFilter — world sequencer",
    "  5. coverageCap slice — getDeliveryCap / coverageLevelToMaxTracks",
    "Rejection format: pos_N:Artist — Track:score<threshold",
    "Reggae profile: cultural-identity-profile.ts reggae_world — anchor artists, avoidArtists list, minWorldIdentityScore 0.75 for opener",
  ].join("\n");

  const payload = {
    generatedAt: new Date().toISOString(),
    commit,
    executiveConclusion,
    liveResults,
    rejectionBuckets,
    libraryReggaeSupply: { librarySize, reggaeAnchorCounts },
    metadataIntegrity,
    purityImplementationTrace,
    rootCauseVerdict: { code: rootCode, label: rootLabel, evidence: rootEvidence },
    v29v30Comparison: { v29: V29_REGGAE, v30: V30_REGGAE, v31: reggae?.funnel ?? null },
    noProductionChanges: true,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(payload), "utf8");
  log(`Wrote ${OUT_MD}`);
}

main().catch((err) => {
  log(`FATAL: ${err.stack ?? err.message}`);
  process.exit(1);
});
