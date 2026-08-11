/**
 * V20 large real-world benchmark — frozen V19 validation at scale.
 *
 * Usage:
 *   node backend/scripts/v20-large-real-benchmark.mjs [--limit N] [--resume]
 *
 * Corpus: fault-diagnosis (429) + human-benchmark-2026-07-28 (243), deduped.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

const CORPUS_OUT = resolve(ROOT, "reports/playlist-evaluation/v20-large-prompt-corpus.json");
const RESULTS_PATH = resolve(ROOT, "reports/playlist-evaluation/v20-large-real-benchmark.json");
const LOG_PATH = resolve(ROOT, "reports/playlist-evaluation/v20-large-benchmark-run.log");

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DELAY_MS = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "9999"), 10) : 9999,
    resume: args.includes("--resume"),
  };
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(msg);
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  try {
    const { appendFileSync } = require("node:fs");
    appendFileSync(LOG_PATH, msg);
  } catch {
    /* ignore */
  }
}

function loadCorpus() {
  const fault = JSON.parse(
    readFileSync(resolve(ROOT, "data/corpus/fault-diagnosis-prompt-corpus.json"), "utf8"),
  );
  const human = JSON.parse(
    readFileSync(resolve(ROOT, "reports/playlist-evaluation/human-benchmark-2026-07-28/prompts.json"), "utf8"),
  );

  const seen = new Set();
  const prompts = [];

  for (const src of [
    ...(fault.prompts ?? []).map((p) => ({
      id: p.id,
      prompt: p.prompt,
      category: p.category ?? p.tags?.[0] ?? "mixed",
      source: p.source ?? "fault-diagnosis",
      length: p.length ?? 25,
    })),
    ...(human.prompts ?? []).map((p) => ({
      id: p.id,
      prompt: p.prompt,
      category: p.category ?? "mixed",
      source: p.source ?? "human-benchmark-2026-07-28",
      length: p.length ?? 25,
    })),
  ]) {
    const key = String(src.prompt ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    prompts.push({ ...src, id: src.id ?? `p-${prompts.length + 1}` });
  }

  mkdirSync(dirname(CORPUS_OUT), { recursive: true });
  writeFileSync(
    CORPUS_OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        provenance: ["data/corpus/fault-diagnosis-prompt-corpus.json", "reports/playlist-evaluation/human-benchmark-2026-07-28/prompts.json"],
        count: prompts.length,
        prompts,
      },
      null,
      2,
    ),
  );
  return prompts;
}

function classifyFailure(row, score) {
  if (row.timeout) return "E_infrastructure";
  if (row.httpStatus !== 200 || !row.success) return "E_infrastructure";
  if (row.trackCount === 0) return "B_library_limitation";
  if (row.trackCount < 3 && score?.saveabilityDeliveryTier === "STUB") return "C_honest_partial";
  if (score && score.totalScore >= 80 && score.wouldSave === "NO") return "D_evaluator_contradiction";
  return null;
}

function persist(payload) {
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(rows) {
  const ok = rows.filter((r) => r.success);
  const durations = ok.map((r) => r.durationMs).sort((a, b) => a - b);
  const hcs = ok.map((r) => r.hcs).sort((a, b) => a - b);
  const tracks = ok.map((r) => r.trackCount).sort((a, b) => a - b);

  const countVerdict = (field, val) => ok.filter((r) => r[field] === val).length;
  const tierCount = (tier) => ok.filter((r) => r.deliveryTier === tier).length;

  const byCategory = {};
  for (const r of ok) {
    const cat = r.category ?? "mixed";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }
  const categoryStats = Object.entries(byCategory).map(([category, items]) => ({
    category,
    n: items.length,
    hcsMean: Math.round((items.reduce((s, x) => s + x.hcs, 0) / items.length) * 10) / 10,
    hcsMedian: percentile(items.map((x) => x.hcs).sort((a, b) => a - b), 50),
    saveYesPct: Math.round((items.filter((x) => x.save === "YES").length / items.length) * 1000) / 10,
    shareYesPct: Math.round((items.filter((x) => x.share === "YES").length / items.length) * 1000) / 10,
    pressPlayYesPct: Math.round((items.filter((x) => x.pressPlay === "YES").length / items.length) * 1000) / 10,
    avgTracks: Math.round((items.reduce((s, x) => s + x.trackCount, 0) / items.length) * 10) / 10,
    fullPct: Math.round((items.filter((x) => x.deliveryTier === "FULL").length / items.length) * 1000) / 10,
    partialPct: Math.round((items.filter((x) => x.deliveryTier === "PARTIAL").length / items.length) * 1000) / 10,
    miniPct: Math.round((items.filter((x) => x.deliveryTier === "MINI").length / items.length) * 1000) / 10,
    stubPct: Math.round((items.filter((x) => x.deliveryTier === "STUB").length / items.length) * 1000) / 10,
    errorPct: Math.round((items.filter((x) => !x.success).length / items.length) * 1000) / 10,
  }));

  return {
    total: rows.length,
    successful: ok.length,
    failed: rows.length - ok.length,
    timeouts: rows.filter((r) => r.timeout).length,
    successPct: Math.round((ok.length / rows.length) * 1000) / 10,
    timeoutPct: Math.round((rows.filter((r) => r.timeout).length / rows.length) * 1000) / 10,
    durationMs: {
      median: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      max: durations[durations.length - 1] ?? null,
    },
    hcs: {
      mean: ok.length ? Math.round((hcs.reduce((a, b) => a + b, 0) / hcs.length) * 10) / 10 : null,
      median: percentile(hcs, 50),
      p10: percentile(hcs, 10),
      p25: percentile(hcs, 25),
      p75: percentile(hcs, 75),
      p90: percentile(hcs, 90),
      min: hcs[0] ?? null,
      max: hcs[hcs.length - 1] ?? null,
      gte80Pct: Math.round((ok.filter((r) => r.hcs >= 80).length / ok.length) * 1000) / 10,
      gte85Pct: Math.round((ok.filter((r) => r.hcs >= 85).length / ok.length) * 1000) / 10,
      gte90Pct: Math.round((ok.filter((r) => r.hcs >= 90).length / ok.length) * 1000) / 10,
    },
    save: {
      YES: countVerdict("save", "YES"),
      MAYBE: countVerdict("save", "MAYBE"),
      NO: countVerdict("save", "NO"),
      yesPct: Math.round((countVerdict("save", "YES") / ok.length) * 1000) / 10,
    },
    share: {
      YES: countVerdict("share", "YES"),
      MAYBE: countVerdict("share", "MAYBE"),
      NO: countVerdict("share", "NO"),
      yesPct: Math.round((countVerdict("share", "YES") / ok.length) * 1000) / 10,
    },
    pressPlay: {
      YES: countVerdict("pressPlay", "YES"),
      MAYBE: countVerdict("pressPlay", "MAYBE"),
      NO: countVerdict("pressPlay", "NO"),
      yesPct: Math.round((countVerdict("pressPlay", "YES") / ok.length) * 1000) / 10,
    },
    deliveryTier: {
      FULL: tierCount("FULL"),
      PARTIAL: tierCount("PARTIAL"),
      MINI: tierCount("MINI"),
      STUB: tierCount("STUB"),
      fullPct: Math.round((tierCount("FULL") / ok.length) * 1000) / 10,
      partialPct: Math.round((tierCount("PARTIAL") / ok.length) * 1000) / 10,
      miniPct: Math.round((tierCount("MINI") / ok.length) * 1000) / 10,
      stubPct: Math.round((tierCount("STUB") / ok.length) * 1000) / 10,
    },
    trackCount: {
      mean: ok.length ? Math.round((tracks.reduce((a, b) => a + b, 0) / tracks.length) * 10) / 10 : null,
      median: percentile(tracks, 50),
      p10: percentile(tracks, 10),
      p25: percentile(tracks, 25),
      p75: percentile(tracks, 75),
      p90: percentile(tracks, 90),
      min: tracks[0] ?? null,
      max: tracks[tracks.length - 1] ?? null,
    },
    categoryStats,
  };
}

async function main() {
  const { limit, resume } = parseArgs();
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { detectListenabilityFailures } = await import("../dist/core/editorial/human-curation-sequencer.js");

  const corpus = loadCorpus();
  const selected = corpus.slice(0, Math.min(limit, corpus.length));
  log(`Corpus ${corpus.length} unique prompts; running ${selected.length}`);

  let existing = { commit: null, startedAt: new Date().toISOString(), rows: [] };
  if (resume && existsSync(RESULTS_PATH)) {
    existing = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    log(`Resuming with ${existing.rows.length} completed`);
  }

  const doneIds = new Set(existing.rows.map((r) => r.id));
  const creds = await resolveLiveBenchmarkCredentials();
  log(`baseUrl=${creds.baseUrl} user=${creds.spotifyUserId}`);

  const rows = [...existing.rows];

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    if (doneIds.has(item.id)) continue;

    const t0 = Date.now();
    log(`[${i + 1}/${selected.length}] ${item.id}: ${item.prompt.slice(0, 60)}...`);

    let row = {
      id: item.id,
      prompt: item.prompt,
      category: item.category,
      source: item.source,
      timestamp: new Date().toISOString(),
      success: false,
      timeout: false,
      error: null,
      httpStatus: null,
      durationMs: 0,
      trackCount: 0,
      deliveryTier: null,
      hcs: 0,
      save: "NO",
      share: "NO",
      pressPlay: "NO",
      dimensions: null,
      opener: null,
      closer: null,
      artists: [],
      duplicateTracks: 0,
      duplicateArtists: 0,
      failureClassification: null,
      sequencingEvidence: [],
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
      const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-kwalify-evaluation-token": creds.token,
        },
        body: JSON.stringify({
          vibe: item.prompt,
          mode: "balanced",
          length: item.length ?? 25,
          varietyBoost: true,
          auditMode: true,
          spotifyUserId: creds.spotifyUserId,
          requestId: `v20-large-${item.id}`,
          seed: 42,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      row.httpStatus = res.status;
      const data = await res.json().catch(() => ({}));
      const tracks = data.tracks ?? data.playlist ?? [];
      row.trackCount = tracks.length;
      row.success = res.status === 200 && tracks.length >= 0;

      if (tracks.length > 0) {
        const score = evaluateHumanCurationScore(item.prompt, tracks);
        const failures = detectListenabilityFailures(tracks, item.prompt);
        row.hcs = score.totalScore;
        row.save = score.wouldSave;
        row.share = score.wouldShare;
        row.pressPlay = score.wouldPressPlay;
        row.deliveryTier = score.saveabilityDeliveryTier;
        row.dimensions = score.dimensions;
        row.sequencingEvidence = score.dimensions.sequencing.evidence;
        row.opener = `${tracks[0]?.artistName ?? "?"} — ${tracks[0]?.trackName ?? "?"}`;
        row.closer = `${tracks[tracks.length - 1]?.artistName ?? "?"} — ${tracks[tracks.length - 1]?.trackName ?? "?"}`;
        row.artists = [...new Set(tracks.map((t) => String(t.artistName ?? "").trim()).filter(Boolean))];
        const titles = tracks.map((t) => `${t.artistName}|${t.trackName}`.toLowerCase());
        row.duplicateTracks = titles.length - new Set(titles).size;
        row.failureClassification = classifyFailure(row, score);
        if (failures.some((f) => f.code === "obscure_opener")) row.openerFailure = true;
        if (failures.some((f) => f.code === "gym_ballad_midset")) row.balladMidset = true;
        if (failures.some((f) => f.code === "disco_thin_delivery")) row.thinDelivery = true;
      } else {
        row.failureClassification = "B_library_limitation";
      }
    } catch (err) {
      row.error = String(err?.message ?? err);
      row.timeout = err?.name === "AbortError";
      row.failureClassification = "E_infrastructure";
    }

    row.durationMs = Date.now() - t0;
    rows.push(row);
    doneIds.add(item.id);

    const payload = {
      ...existing,
      commit: existing.commit,
      corpusSize: corpus.length,
      runCount: rows.length,
      summary: summarize(rows),
      rows,
    };
    persist(payload);

    if (i + 1 < selected.length) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const finalPayload = {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    runCount: rows.length,
    summary: summarize(rows),
    rows,
  };
  persist(finalPayload);
  log(`Complete: ${rows.length} rows written to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
