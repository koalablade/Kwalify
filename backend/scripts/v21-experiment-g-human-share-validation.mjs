/**
 * V21 Experiment G — verify audit, build human review set, analysis artifacts.
 * INVESTIGATION ONLY — no production changes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BENCH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-share-validation.json");
const BLIND_OUT = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-blinded.json");
const MAPPING_OUT = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-mapping.json");
const REVIEW_SET = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-set.json");

const {
  deriveWouldShareVerdict,
  hasMajorSequencingShareBlocker,
  legacyFlatSequencingWouldShare,
  SHARE_CORE_COHESION_MIN,
  SHARE_YES_HCS_MIN,
} = await import("../dist/core/editorial/shareability-verdict.js");
const {
  deriveWouldSaveVerdict,
  classifySaveabilityDeliveryTier,
  SAVEABILITY_YES_HCS_MIN,
} = await import("../dist/core/editorial/saveability-verdict.js");
const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");

function sha256(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function pickStratified(pool, n, keyFn, seed = 42) {
  const buckets = new Map();
  for (const r of pool) {
    const k = keyFn(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const keys = [...buckets.keys()].sort();
  const out = [];
  let s = seed;
  let i = 0;
  while (out.length < n && keys.some((k) => buckets.get(k).length > 0)) {
    const k = keys[i % keys.length];
    const arr = buckets.get(k);
    if (arr?.length) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % arr.length;
      out.push(arr.splice(j, 1)[0]);
    }
    i += 1;
    if (i > n * keys.length * 3) break;
  }
  return out;
}

function isPrimaryGPopulation(r) {
  const coh = r.dimensions?.cohesion?.score ?? 0;
  const seq = r.dimensions?.sequencing?.score ?? 0;
  const fails = r.listenabilityFailures ?? [];
  const seqBlock = hasMajorSequencingShareBlocker(seq, fails);
  return (
    r.save === "YES" &&
    r.share !== "YES" &&
    (r.hcs ?? 0) >= SHARE_YES_HCS_MIN &&
    coh === 16 &&
    r.deliveryTier !== "STUB" &&
    !seqBlock
  );
}

function hcsBand(h) {
  if (h < 87) return "85-86";
  if (h < 89) return "87-88";
  if (h < 92) return "89-91";
  return "92+";
}

function promptSpecificity(prompt) {
  const p = prompt.toLowerCase();
  const words = p.split(/\s+/).length;
  const hasGenre = /\b(?:grunge|punk|garage|disco|country|gym|grime|indie|metal|rap|synth|house|techno)\b/.test(p);
  const hasEra = /\b(?:80s|90s|70s|2000s|2010s)\b/.test(p);
  const hasNeg = /\b(?:no |without |non-)\w/.test(p);
  if (words <= 3 && !hasGenre) return "vague";
  if (hasGenre || hasEra || hasNeg || words >= 7) return "specific";
  return "moderate";
}

function analyzeShareBlockers(row) {
  const d = row.dimensions ?? {};
  const hcs = row.hcs ?? 0;
  const seq = d.sequencing?.score ?? 0;
  const moment = d.momentUnderstanding?.score ?? 0;
  const cohesion = d.cohesion?.score ?? 0;
  const plaus = d.humanPlausibility?.score ?? 0;
  const tier = row.deliveryTier ?? classifySaveabilityDeliveryTier(row.trackCount ?? 0, row.listenabilityFailures ?? []);
  const fails = row.listenabilityFailures ?? [];
  const seqBlock = hasMajorSequencingShareBlocker(seq, fails);
  if (hcs < 70) return "hcs_below_70";
  if (tier === "STUB") return "tier_stub";
  if (seqBlock) return "sequencing_blocker";
  if (hcs < 85) return "hcs_80_84";
  if (cohesion < SHARE_CORE_COHESION_MIN) return "cohesion_below_18";
  if (moment < 20) return "moment_below_20";
  return "other";
}

function rowTracks(r) {
  return r.tracks ?? r.normalizedTracks ?? [];
}

function verifyIntegrity(rows) {
  const scored = rows.filter((r) => r.success && r.trackCount > 0 && r.hcs != null);
  const ids = new Set(rows.map((r) => r.id));
  let shareMismatch = 0;
  let saveMismatch = 0;
  let undefinedArtists = 0;
  let missingTracklists = 0;

  for (const r of scored) {
    if (r.opener === "? — ?") undefinedArtists += 1;
    if (!rowTracks(r).length) missingTracklists += 1;
    const d = r.dimensions ?? {};
    const recomputedShare = deriveWouldShareVerdict({
      totalScore: r.hcs,
      trackCount: r.trackCount,
      sequencingScore: d.sequencing?.score ?? 0,
      momentScore: d.momentUnderstanding?.score ?? 0,
      cohesionScore: d.cohesion?.score ?? 0,
      plausibilityScore: d.humanPlausibility?.score ?? 0,
      listenabilityFailures: r.listenabilityFailures ?? [],
      deliveryTier: r.deliveryTier,
    });
    const recomputedSave = deriveWouldSaveVerdict({
      totalScore: r.hcs,
      trackCount: r.trackCount,
      momentScore: d.momentUnderstanding?.score ?? 0,
      listenabilityFailures: r.listenabilityFailures ?? [],
    });
    if (recomputedShare !== r.share) shareMismatch += 1;
    if (recomputedSave !== r.save) saveMismatch += 1;
  }

  const cohesion16 = scored.filter((r) => r.dimensions?.cohesion?.score === 16).length;
  const saveYes = scored.filter((r) => r.save === "YES");
  const saveYesShareNotYes = saveYes.filter((r) => r.share !== "YES");

  const blockerCounts = { cohesion: 0, hcs80_84: 0, seq: 0, other: 0 };
  for (const r of saveYesShareNotYes) {
    const b = analyzeShareBlockers(r);
    if (b === "cohesion_below_18") blockerCounts.cohesion += 1;
    else if (b === "hcs_80_84") blockerCounts.hcs80_84 += 1;
    else if (b === "sequencing_blocker") blockerCounts.seq += 1;
    else blockerCounts.other += 1;
  }

  const shareYes = scored.filter((r) => r.share === "YES");
  let shareYesValid = 0;
  for (const r of shareYes) {
    const d = r.dimensions ?? {};
    const ok =
      r.hcs >= 85 &&
      d.cohesion?.score >= 18 &&
      d.momentUnderstanding?.score >= 20 &&
      d.humanPlausibility?.score >= 11 &&
      !hasMajorSequencingShareBlocker(d.sequencing?.score ?? 0, r.listenabilityFailures ?? []) &&
      r.deliveryTier !== "STUB";
    if (ok) shareYesValid += 1;
  }

  return {
    rowCount: rows.length,
    uniqueIds: ids.size,
    duplicates: rows.length - ids.size,
    scored: scored.length,
    unscored: rows.length - scored.length,
    http422: rows.filter((r) => r.httpStatus === 422).length,
    undefinedArtists,
    missingTracklists,
    shareMismatch,
    saveMismatch,
    cohesion16,
    saveYes: saveYes.length,
    shareYes: shareYes.length,
    saveYesShareNotYes: saveYesShareNotYes.length,
    blockerCounts,
    shareYesValid,
    primaryGPopulation: scored.filter(isPrimaryGPopulation).length,
  };
}

const data = JSON.parse(readFileSync(BENCH, "utf8"));
const rows = data.rows;
const scored = rows.filter((r) => r.success && r.trackCount > 0 && r.hcs != null);

// STOP check — audit claims
const AUDIT_CLAIMS = {
  rowCount: 595,
  scored: 580,
  unscored: 15,
  cohesion16: 500,
  saveYesShareNotYesCohesion: 436,
  saveYesHcs8084: 28,
  saveYesSeqBlock: 1,
  shareYes: 48,
};
const verification = verifyIntegrity(rows);
const discrepancies = [];
for (const [k, expected] of Object.entries(AUDIT_CLAIMS)) {
  const actual = verification[k] ?? verification.blockerCounts?.[k.replace("saveYesShareNotYesCohesion", "cohesion")] ?? null;
  let act = verification[k];
  if (k === "saveYesShareNotYesCohesion") act = verification.blockerCounts.cohesion;
  if (k === "saveYesHcs8084") act = verification.blockerCounts.hcs80_84;
  if (k === "saveYesSeqBlock") act = verification.blockerCounts.seq;
  if (act !== expected) discrepancies.push({ claim: k, expected, actual: act });
}

// Primary G population breakdown
const primaryPop = scored.filter(isPrimaryGPopulation);
const primaryByHcs = {};
const primaryByCat = {};
for (const r of primaryPop) {
  const b = hcsBand(r.hcs);
  primaryByHcs[b] = (primaryByHcs[b] ?? 0) + 1;
  const c = r.category ?? "mixed";
  primaryByCat[c] = (primaryByCat[c] ?? 0) + 1;
}

// HCS>=85 cohesion 16 all save yes share maybe
const blocked437 = scored.filter(
  (r) => r.save === "YES" && r.share !== "YES" && r.hcs >= 85 && r.dimensions?.cohesion?.score === 16,
);

// Build proper review set ~40
const primarySample = pickStratified(primaryPop, 22, (r) => `${r.category ?? "x"}|${hcsBand(r.hcs)}`);
const shareYesControls = pickStratified(scored.filter((r) => r.share === "YES"), 8, (r) => r.category ?? "x");
const lowHcsControls = pickStratified(
  scored.filter((r) => r.hcs <= 70).sort((a, b) => a.hcs - b.hcs),
  6,
  (r) => r.category ?? "x",
);
const artistRunSample = scored
  .filter((r) => (r.listenabilityFailures ?? []).some((f) => f.code === "artist_run_3"))
  .slice(0, 4);

const ids = new Set();
function uniqueAdd(arr) {
  const out = [];
  for (const r of arr) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push(r);
  }
  return out;
}

const reviewSet = uniqueAdd([...primarySample, ...shareYesControls, ...lowHcsControls, ...artistRunSample]);

// Audit existing 76 sample
let existingSample = { count: 0, primaryGInSample: 0, strata: {} };
const EXISTING = resolve(ROOT, "reports/playlist-evaluation/v21-share-human-review-sample.json");
if (existsSync(EXISTING)) {
  const ex = JSON.parse(readFileSync(EXISTING, "utf8"));
  existingSample.count = ex.count ?? ex.playlists?.length ?? 0;
  for (const p of ex.playlists ?? []) {
    if (isPrimaryGPopulation(p)) existingSample.primaryGInSample += 1;
    const s = p.selectionStratum ?? "unknown";
    existingSample.strata[s] = (existingSample.strata[s] ?? 0) + 1;
  }
}

// World resolution sample for cohesion-16
const worldSample = pickStratified(primaryPop, 15, (r) => promptSpecificity(r.prompt)).map((r) => ({
  id: r.id,
  prompt: r.prompt,
  category: r.category,
  specificity: promptSpecificity(r.prompt),
  committedWorld: resolveCommittedWorld({ prompt: r.prompt }),
  cohesionEvidence: r.dimensions?.cohesion?.evidence,
}));

// Instrumentation checks
const instrumentationChecks = {
  tmpFileExists: existsSync(resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json.tmp")),
  rowCount595: verification.rowCount === 595,
  uniqueIds595: verification.uniqueIds === 595,
  noUndefinedArtists: verification.undefinedArtists === 0,
  noShareMismatch: verification.shareMismatch === 0,
  noSaveMismatch: verification.saveMismatch === 0,
  noMissingTracklists: verification.missingTracklists === 0,
  experimentTag: data.experiment === "F",
  verdictRecomputation: verification.shareMismatch === 0 && verification.saveMismatch === 0,
};

// Cohesion vs HCS correlation for blocked437
const hcsBandBlocked = {};
for (const r of blocked437) {
  const b = hcsBand(r.hcs);
  hcsBandBlocked[b] = (hcsBandBlocked[b] ?? 0) + 1;
}

// Legacy share rate
let legacyYes = 0;
for (const r of scored) {
  if (legacyFlatSequencingWouldShare(r.hcs, r.dimensions?.sequencing?.score ?? 0) === "YES") legacyYes += 1;
}

function exportReviewRow(r, stratum, reviewId) {
  return {
    reviewId,
    originalId: r.id,
    stratum,
    prompt: r.prompt,
    category: r.category,
    tracklist: rowTracks(r).map((t, i) => ({
      position: i + 1,
      artistName: t.artistName,
      trackName: t.trackName,
    })),
    // evaluator fields — for mapping file only
    _evaluator: {
      hcs: r.hcs,
      save: r.save,
      share: r.share,
      pressPlay: r.pressPlay,
      tier: r.deliveryTier,
      cohesion: r.dimensions?.cohesion?.score,
      moment: r.dimensions?.momentUnderstanding?.score,
      sequencing: r.dimensions?.sequencing?.score,
      plausibility: r.dimensions?.humanPlausibility?.score,
      cohesionEvidence: r.dimensions?.cohesion?.evidence,
    },
    humanScores: {
      wouldSendToFriend: null,
      coherentOneThing: null,
      fitsPrompt: null,
      wouldKeepListen: null,
      obviousWrongTrack: null,
      wrongTrackSeverity: null,
      intentionallyCurated: null,
      notes: null,
    },
  };
}

const reviewRows = reviewSet.map((r, i) => {
  let stratum = "control";
  if (isPrimaryGPopulation(r)) stratum = "primary_g";
  else if (r.share === "YES") stratum = "share_yes_control";
  else if (r.hcs <= 70) stratum = "low_hcs_control";
  else if ((r.listenabilityFailures ?? []).some((f) => f.code === "artist_run_3")) stratum = "artist_run_secondary";
  return exportReviewRow(r, stratum, `G-${String(i + 1).padStart(3, "0")}`);
});

const blinded = reviewRows.map(({ reviewId, prompt, tracklist, humanScores }) => ({
  reviewId,
  prompt,
  tracklist,
  humanScores,
  rubric: {
    wouldSendToFriend: "1=absolutely not … 5=definitely yes (primary question)",
    coherentOneThing: "1–5",
    fitsPrompt: "1–5",
    wouldKeepListen: "1–5",
    obviousWrongTrack: "YES/NO",
    wrongTrackSeverity: "1–5 if YES",
    intentionallyCurated: "1–5",
    notes: "optional",
  },
}));

const mapping = reviewRows.map(({ reviewId, originalId, stratum, _evaluator }) => ({
  reviewId,
  originalId,
  stratum,
  ..._evaluator,
}));

const payload = {
  generatedAt: new Date().toISOString(),
  experiment: "G",
  productionCodeChanged: false,
  productionCommit: false,
  humanReviewPerformed: false,
  auditVerification: verification,
  auditClaimsExpected: AUDIT_CLAIMS,
  discrepancies,
  stopInvestigation: discrepancies.length > 0,
  instrumentationChecks,
  primaryGPopulation: {
    count: primaryPop.length,
    byHcsBand: primaryByHcs,
    byCategory: primaryByCat,
    pctOfScored: Math.round((primaryPop.length / scored.length) * 1000) / 10,
  },
  blocked437Analysis: {
    count: blocked437.length,
    byHcsBand: hcsBandBlocked,
    byCategory: Object.fromEntries(
      Object.entries(
        blocked437.reduce((acc, r) => {
          const c = r.category ?? "mixed";
          acc[c] = (acc[c] ?? 0) + 1;
          return acc;
        }, {}),
      ).sort((a, b) => b[1] - a[1]),
    ),
  },
  existingSampleAudit: existingSample,
  reviewSet: {
    count: reviewRows.length,
    strata: reviewRows.reduce((acc, r) => {
      acc[r.stratum] = (acc[r.stratum] ?? 0) + 1;
      return acc;
    }, {}),
  },
  legacyFlatShareYesPct: Math.round((legacyYes / scored.length) * 1000) / 10,
  currentShareYesPct: Math.round((verification.shareYes / scored.length) * 1000) / 10,
  worldResolutionSample: worldSample,
  cohesion16EvidencePattern: {
    noCommittedWorld: scored.filter((r) =>
      (r.dimensions?.cohesion?.evidence ?? []).some((e) => e.includes("No committed world")),
    ).length,
    cohesionExactly16: verification.cohesion16,
  },
  experimentEProvenance: {
    shareVerdictFile: "backend/core/editorial/shareability-verdict.ts",
    experimentLabel: "Experiment E — tier-aware Shareability",
    shareCoreCohesionMin: SHARE_CORE_COHESION_MIN,
    cohesionNoWorldPenalty: -4,
    cohesionNoWorldSource: "human-curation-score.ts lines 196-198",
    humanDataAtIntroduction: "UNKNOWN — tests use synthetic playlists; no broad-corpus human validation found in repo",
    threshold18Rationale: "UNKNOWN — heuristic aligned with 'believable single world' scores 18-20; not empirically calibrated on 595 corpus",
    statedTargetShareRate: "NONE found",
    problemSolved: "Pre-E flat gate (HCS>=85 AND seq>=14) caused split-brain: high HCS playable playlists with seq=13 got Share MAYBE despite Save YES (madchester case)",
  },
  cohesionPenaltyProvenance: {
    rule: "no profile → cohesion -= 4 (20→16)",
    designedFor: "HCS cohesion dimension (predates Share gate usage)",
    shareGateReuse: "Experiment E reused cohesion score >= 18 as Share core floor without separate vague-prompt calibration",
    empiricalCalibration: "UNKNOWN",
  },
  decisionFramework: "PENDING_HUMAN_REVIEW",
  reviewArtifactPaths: {
    full: REVIEW_SET,
    blinded: BLIND_OUT,
    mapping: MAPPING_OUT,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
writeFileSync(REVIEW_SET, JSON.stringify({ generatedAt: new Date().toISOString(), count: reviewRows.length, playlists: reviewRows }, null, 2));
writeFileSync(BLIND_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), note: "Blinded for human reviewer — no evaluator scores", playlists: blinded }, null, 2));
writeFileSync(MAPPING_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), note: "Reviewer must not see this during listen", mapping }, null, 2));

console.log(JSON.stringify({ discrepancies, verification, reviewSetCount: reviewRows.length, primaryPop: primaryPop.length }, null, 2));
