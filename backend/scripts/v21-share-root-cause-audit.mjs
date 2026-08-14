/**
 * V21 Share root-cause audit — read-only analysis of corrected 595 benchmark.
 * Does NOT modify production code.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BENCH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v21-share-root-cause-audit.json");
const HUMAN_OUT = resolve(ROOT, "reports/playlist-evaluation/v21-share-human-review-sample.json");

const {
  SHARE_YES_HCS_MIN,
  SHARE_MAYBE_HCS_MIN,
  SHARE_MINI_YES_HCS_MIN,
  SHARE_MINI_YES_MOMENT_MIN,
  SHARE_CORE_MOMENT_MIN,
  SHARE_CORE_COHESION_MIN,
  SHARE_CORE_PLAUSIBILITY_MIN,
  SHARE_MAJOR_SEQUENCING_FLOOR,
  hasMajorSequencingShareBlocker,
  deriveWouldShareVerdict,
} = await import("../dist/core/editorial/shareability-verdict.js");
const { deriveWouldSaveVerdict, classifySaveabilityDeliveryTier, SAVEABILITY_YES_HCS_MIN } =
  await import("../dist/core/editorial/saveability-verdict.js");

function analyzeShareBlockers(row) {
  const d = row.dimensions ?? {};
  const hcs = row.hcs ?? 0;
  const seq = d.sequencing?.score ?? 0;
  const moment = d.momentUnderstanding?.score ?? 0;
  const cohesion = d.cohesion?.score ?? 0;
  const plaus = d.humanPlausibility?.score ?? 0;
  const tier = row.deliveryTier ?? classifySaveabilityDeliveryTier(row.trackCount ?? 0, row.listenabilityFailures ?? []);
  const failures = row.listenabilityFailures ?? [];
  const seqBlocker = hasMajorSequencingShareBlocker(seq, failures);

  const gates = {
    hcsBelowMaybe70: hcs < SHARE_MAYBE_HCS_MIN,
    tierStub: tier === "STUB",
    sequencingMajorBlocker: seqBlocker,
    sequencingBelow10: seq < SHARE_MAJOR_SEQUENCING_FLOOR,
    listenabilitySeqMajor: failures.some(
      (f) => f.severity === "major" && ["obscure_opener", "artist_run_3", "madchester_oasis_cluster"].includes(f.code),
    ),
    hcsBelowShareYes85: hcs < SHARE_YES_HCS_MIN,
    momentBelowCore20: moment < SHARE_CORE_MOMENT_MIN,
    cohesionBelowCore18: cohesion < SHARE_CORE_COHESION_MIN,
    plausibilityBelowCore11: plaus < SHARE_CORE_PLAUSIBILITY_MIN,
    coreStrong: moment >= SHARE_CORE_MOMENT_MIN && cohesion >= SHARE_CORE_COHESION_MIN && plaus >= SHARE_CORE_PLAUSIBILITY_MIN,
    tierMiniNeeds88: tier === "MINI" && hcs < SHARE_MINI_YES_HCS_MIN,
    tierMiniNeedsMoment22: tier === "MINI" && moment < SHARE_MINI_YES_MOMENT_MIN,
    tierNotFullPartialOrMiniExcellence: !(
      tier === "FULL" ||
      tier === "PARTIAL" ||
      (tier === "MINI" && hcs >= SHARE_MINI_YES_HCS_MIN && moment >= SHARE_MINI_YES_MOMENT_MIN)
    ),
  };

  const primaryReasons = [];
  if (gates.hcsBelowMaybe70) primaryReasons.push("hcs_below_70_no");
  else if (gates.tierStub) primaryReasons.push("tier_stub_maybe");
  else if (gates.sequencingMajorBlocker) primaryReasons.push("sequencing_major_blocker_maybe");
  else if (gates.hcsBelowShareYes85) primaryReasons.push("hcs_80_84_band");
  else if (gates.cohesionBelowCore18) primaryReasons.push("core_cohesion_weak");
  else if (gates.momentBelowCore20) primaryReasons.push("core_moment_weak");
  else if (gates.plausibilityBelowCore11) primaryReasons.push("core_plausibility_weak");
  else if (tier === "MINI" && gates.tierMiniNeeds88) primaryReasons.push("mini_hcs_below_88");
  else if (tier === "MINI" && gates.tierMiniNeedsMoment22) primaryReasons.push("mini_moment_below_22");
  else primaryReasons.push("other_maybe");

  const recomputedShare = deriveWouldShareVerdict({
    totalScore: hcs,
    trackCount: row.trackCount ?? 0,
    sequencingScore: seq,
    momentScore: moment,
    cohesionScore: cohesion,
    plausibilityScore: plaus,
    listenabilityFailures: failures,
    deliveryTier: tier,
  });

  return { gates, primaryReasons, tier, recomputedShare, seq, moment, cohesion, plaus };
}

function analyzeSaveBlockers(row) {
  const hcs = row.hcs ?? 0;
  const moment = row.dimensions?.momentUnderstanding?.score ?? 0;
  const tier = row.deliveryTier ?? "UNKNOWN";
  const recomputedSave = deriveWouldSaveVerdict({
    totalScore: hcs,
    trackCount: row.trackCount ?? 0,
    momentScore: moment,
    listenabilityFailures: row.listenabilityFailures ?? [],
  });
  return { recomputedSave, saveNeedsHcs80: hcs < SAVEABILITY_YES_HCS_MIN, tier };
}

function pick(arr, n, seed = 42) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function rowExport(row, extra = {}) {
  return {
    id: row.id,
    prompt: row.prompt,
    category: row.category,
    trackCount: row.trackCount,
    tier: row.deliveryTier,
    hcs: row.hcs,
    save: row.save,
    share: row.share,
    pressPlay: row.pressPlay,
    dimensions: row.dimensions
      ? {
          moment: row.dimensions.momentUnderstanding?.score,
          cohesion: row.dimensions.cohesion?.score,
          sequencing: row.dimensions.sequencing?.score,
          plausibility: row.dimensions.humanPlausibility?.score,
          variety: row.dimensions.variety?.score,
        }
      : null,
    listenabilityFailures: row.listenabilityFailures ?? [],
    artists: row.artists ?? [],
    tracks: row.tracks ?? row.normalizedTracks ?? [],
    opener: row.opener,
    closer: row.closer,
    ...extra,
  };
}

const data = JSON.parse(readFileSync(BENCH, "utf8"));
const rows = data.rows;
const scored = rows.filter((r) => r.success && r.trackCount > 0 && r.hcs != null);

// Integrity checks
const ids = new Set(rows.map((r) => r.id));
const integrity = {
  rowCount: rows.length,
  uniqueIds: ids.size,
  duplicates: rows.length - ids.size,
  missingTracklists: scored.filter((r) => !(r.tracks?.length || r.normalizedTracks?.length)).length,
  undefinedArtists: scored.filter((r) => r.opener === "? — ?").length,
  normalizationErrors: rows.filter((r) => (r.normalizationErrors ?? []).length > 0).length,
  recomputedShareMismatch: 0,
  recomputedSaveMismatch: 0,
};

// Gate pass rates across 580 scored
const gateStats = {};
function inc(key, pass) {
  if (!gateStats[key]) gateStats[key] = { pass: 0, fail: 0 };
  if (pass) gateStats[key].pass += 1;
  else gateStats[key].fail += 1;
}

const shareFailureTaxonomy = {};
const saveYesShareNotYes = [];

for (const row of scored) {
  const a = analyzeShareBlockers(row);
  const b = analyzeSaveBlockers(row);
  if (a.recomputedShare !== row.share) integrity.recomputedShareMismatch += 1;
  if (b.recomputedSave !== row.save) integrity.recomputedSaveMismatch += 1;

  inc("hcs_gte_70", !a.gates.hcsBelowMaybe70);
  inc("hcs_gte_85", !a.gates.hcsBelowShareYes85);
  inc("hcs_gte_80_save", !b.saveNeedsHcs80);
  inc("sequencing_gte_10", !a.gates.sequencingBelow10);
  inc("no_seq_major_blocker", !a.gates.sequencingMajorBlocker);
  inc("core_moment_gte_20", !a.gates.momentBelowCore20);
  inc("core_cohesion_gte_18", !a.gates.cohesionBelowCore18);
  inc("core_plausibility_gte_11", !a.gates.plausibilityBelowCore11);
  inc("core_strong_all", a.gates.coreStrong);
  inc("tier_not_stub", a.tier !== "STUB");

  if (row.share !== "YES") {
    const primary = a.primaryReasons[0] ?? "other_maybe";
    shareFailureTaxonomy[primary] = (shareFailureTaxonomy[primary] ?? 0) + 1;
  }

  if (row.save === "YES" && row.share !== "YES") {
    saveYesShareNotYes.push(rowExport(row, { shareAnalysis: a }));
  }
}

// Confusion matrix
const matrix = {
  "Save YES": { "Share YES": 0, "Share MAYBE": 0, "Share NO": 0 },
  "Save MAYBE": { "Share YES": 0, "Share MAYBE": 0, "Share NO": 0 },
  "Save NO": { "Share YES": 0, "Share MAYBE": 0, "Share NO": 0 },
};
for (const row of scored) {
  const sk = `Save ${row.save}`;
  const shk = `Share ${row.share}`;
  if (matrix[sk] && matrix[sk][shk] !== undefined) matrix[sk][shk] += 1;
}

const saveYes = scored.filter((r) => r.save === "YES");
const shareYes = scored.filter((r) => r.share === "YES");
const saveYesShareYes = scored.filter((r) => r.save === "YES" && r.share === "YES");
const saveYesShareMaybe = scored.filter((r) => r.save === "YES" && r.share === "MAYBE");
const saveYesShareNo = scored.filter((r) => r.save === "YES" && r.share === "NO");

// HCS band analysis for Save YES / Share NOT YES
const hcsBandShare = { "80-84": 0, "85-89": 0, "90+": 0 };
for (const row of saveYesShareNotYes) {
  if (row.hcs < 85) hcsBandShare["80-84"] += 1;
  else if (row.hcs < 90) hcsBandShare["85-89"] += 1;
  else hcsBandShare["90+"] += 1;
}

// Sequencing distribution for Save YES
const seqDistSaveYes = { below10: 0, "10-12": 0, "13-14": 0, "15+": 0 };
for (const row of saveYes) {
  const s = row.dimensions?.sequencing?.score ?? 0;
  if (s < 10) seqDistSaveYes.below10 += 1;
  else if (s <= 12) seqDistSaveYes["10-12"] += 1;
  else if (s <= 14) seqDistSaveYes["13-14"] += 1;
  else seqDistSaveYes["15+"] += 1;
}

// Artist-run failures
const artistRunFailures = scored.filter(
  (r) =>
    r.dimensions?.sequencing?.score === 0 ||
    (r.listenabilityFailures ?? []).some((f) => f.code === "artist_run_3"),
);

// STUBs
const stubs = scored.filter((r) => r.deliveryTier === "STUB");

// 422s
const f422 = rows.filter((r) => r.httpStatus === 422);

// Worst/best 50
const worst50 = [...scored].sort((a, b) => a.hcs - b.hcs).slice(0, 50);
const best50 = [...scored].sort((a, b) => b.hcs - a.hcs).slice(0, 50);

function classifyWorst(row) {
  const coh = row.dimensions?.cohesion?.score ?? 20;
  const seq = row.dimensions?.sequencing?.score ?? 20;
  const p = row.prompt.toLowerCase();
  if (coh <= 4) return "world_coherence_failure";
  if (seq === 0) return "sequencing_artist_run";
  if (row.deliveryTier === "STUB") return "stub_thin_delivery";
  if (/\b(?:gym|workout|punk|grunge)\b/.test(p)) return "genre_activity_mismatch";
  if (/\b(?:beer|bbq|barbecue|garden)\b/.test(p)) return "social_vague";
  return "other";
}

const worstClusters = {};
for (const r of worst50) {
  const c = classifyWorst(r);
  worstClusters[c] = (worstClusters[c] ?? 0) + 1;
}

// Stratified human sample
const ids2 = new Set();
function addSample(arr) {
  const out = [];
  for (const r of arr) {
    if (ids2.has(r.id)) continue;
    ids2.add(r.id);
    out.push(rowExport(r, { shareAnalysis: analyzeShareBlockers(r) }));
  }
  return out;
}

const humanSample = [
  ...addSample(pick(saveYesShareNotYes, 15)),
  ...addSample(pick(saveYesShareYes, 10)),
  ...addSample(pick(scored.filter((r) => r.hcs <= 70), 10)),
  ...addSample(pick(scored.filter((r) => r.hcs >= 91), 10)),
  ...addSample(pick(scored.filter((r) => /punk|grunge|gym/.test(r.prompt.toLowerCase())), 10)),
  ...addSample(artistRunFailures),
  ...addSample(stubs),
  ...addSample(pick(scored, 10)),
];

const payload = {
  generatedAt: new Date().toISOString(),
  source: BENCH,
  scored: scored.length,
  thresholds: {
    SHARE_YES_HCS_MIN,
    SHARE_MAYBE_HCS_MIN,
    SHARE_MINI_YES_HCS_MIN,
    SHARE_CORE_MOMENT_MIN,
    SHARE_CORE_COHESION_MIN,
    SHARE_CORE_PLAUSIBILITY_MIN,
    SHARE_MAJOR_SEQUENCING_FLOOR,
    SAVEABILITY_YES_HCS_MIN,
  },
  integrity,
  gatePassRates: Object.fromEntries(
    Object.entries(gateStats).map(([k, v]) => [
      k,
      { pass: v.pass, fail: v.fail, passPct: Math.round((v.pass / scored.length) * 1000) / 10 },
    ]),
  ),
  confusionMatrix: matrix,
  crossMetrics: {
    saveYes: saveYes.length,
    shareYes: shareYes.length,
    saveYesShareYes: saveYesShareYes.length,
    saveYesShareNotYes: saveYesShareNotYes.length,
    saveYesShareMaybe: saveYesShareMaybe.length,
    saveYesShareNo: saveYesShareNo.length,
    saveYesToShareYesRate: Math.round((saveYesShareYes.length / saveYes.length) * 1000) / 10,
    saveYesToShareNotYesRate: Math.round((saveYesShareNotYes.length / saveYes.length) * 1000) / 10,
    hcsBandAmongSaveYesShareNotYes: hcsBandShare,
    seqDistAmongSaveYes: seqDistSaveYes,
  },
  shareFailureTaxonomy,
  saveYesShareNotYesPrimaryReasons: Object.fromEntries(
    Object.entries(
      saveYesShareNotYes.reduce((acc, r) => {
        const a = analyzeShareBlockers(r);
        const p = a.primaryReasons[0] ?? "other";
        acc[p] = (acc[p] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]),
  ),
  artistRunAudit: artistRunFailures.map((r) =>
    rowExport(r, {
      artistSequence: (r.tracks ?? []).map((t) => t.artistName),
      sequencingEvidence: r.sequencingEvidence,
    }),
  ),
  stubAudit: stubs.map((r) => rowExport(r)),
  http422Audit: f422.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    httpStatus: r.httpStatus,
    error: r.error,
  })),
  worst50Summary: worst50.map((r) => ({
    prompt: r.prompt,
    hcs: r.hcs,
    tier: r.deliveryTier,
    cohesion: r.dimensions?.cohesion?.score,
    sequencing: r.dimensions?.sequencing?.score,
    cluster: classifyWorst(r),
    cohesionEvidence: r.dimensions?.cohesion?.evidence,
  })),
  best50Summary: best50.map((r) => ({ prompt: r.prompt, hcs: r.hcs, tier: r.deliveryTier, share: r.share, save: r.save })),
  worstClusters,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
writeFileSync(
  HUMAN_OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: "HUMAN REVIEW NOT PERFORMED — full tracklists for listen audit",
      count: humanSample.length,
      playlists: humanSample,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ integrity, crossMetrics: payload.crossMetrics, shareFailureTaxonomy, saveYesShareNotYesPrimaryReasons: payload.saveYesShareNotYesPrimaryReasons, gatePassRates: payload.gatePassRates }, null, 2));
