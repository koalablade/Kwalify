/**
 * V21 Experiment F — corrected large benchmark harness.
 *
 * Usage:
 *   node backend/scripts/v21-experiment-f-benchmark.mjs [--limit N] [--resume]
 *
 * Uses frozen corpus: reports/playlist-evaluation/v20-large-prompt-corpus.json
 * Output: reports/playlist-evaluation/v21-experiment-f-benchmark.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  normalizeBenchmarkTracks,
  validateBenchmarkTrackNormalization,
  playlistInstrumentationDiagnostics,
  extractRawArtistKey,
} from "./lib/benchmark-track-normalizer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const CORPUS_PATH = resolve(ROOT, "reports/playlist-evaluation/v20-large-prompt-corpus.json");
const CORPUS_COPY = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-prompt-corpus.json");
const RESULTS_PATH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const LOG_PATH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.log");

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DELAY_MS = 500;
const SEED = 42;

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
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, msg + "\n", "utf8");
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function getShortCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function sha256File(path) {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

function loadCorpus() {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  if (!existsSync(CORPUS_COPY)) {
    writeFileSync(CORPUS_COPY, JSON.stringify(corpus, null, 2));
  }
  return corpus.prompts ?? [];
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* wait */
  }
}

function persistAtomic(payload) {
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  const content = JSON.stringify(payload, null, 2);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileSync(RESULTS_PATH, content, "utf8");
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      sleepSync(200 + attempt * 200);
    }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(rows) {
  const ok = rows.filter((r) => r.success);
  const scored = ok.filter((r) => r.trackCount > 0 && r.hcs != null);
  const durations = ok.map((r) => r.durationMs).sort((a, b) => a - b);
  const hcs = scored.map((r) => r.hcs).sort((a, b) => a - b);
  const tracks = ok.map((r) => r.trackCount).sort((a, b) => a - b);

  const countVerdict = (field, val) => scored.filter((r) => r[field] === val).length;
  const tierCount = (tier) => scored.filter((r) => r.deliveryTier === tier).length;

  const dimNames = [
    "momentUnderstanding",
    "cohesion",
    "sequencing",
    "humanPlausibility",
    "variety",
    "canonicalAnchors",
    "interestingChoices",
  ];
  const dimensionStats = {};
  for (const dim of dimNames) {
    const vals = scored.map((r) => r.dimensions?.[dim]?.score).filter((v) => typeof v === "number");
    vals.sort((a, b) => a - b);
    dimensionStats[dim] = {
      mean: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
      median: percentile(vals, 50),
      p10: percentile(vals, 10),
      p90: percentile(vals, 90),
      min: vals[0] ?? null,
      max: vals[vals.length - 1] ?? null,
    };
  }

  const instrumentation = {
    pathologicalRows: scored.filter((r) => r.instrumentation?.pathological).length,
    sequencingZero: scored.filter((r) => r.dimensions?.sequencing?.score === 0).length,
    openerUnknown: scored.filter((r) => r.opener === "? — ?").length,
    undefinedTransitions: scored.filter((r) =>
      (r.sequencingEvidence ?? []).some((e) => String(e).includes("undefined")),
    ).length,
    normalizationErrors: rows.filter((r) => (r.normalizationErrors ?? []).length > 0).length,
  };

  return {
    total: rows.length,
    successful: ok.length,
    failed: rows.length - ok.length,
    scored: scored.length,
    http422: rows.filter((r) => r.httpStatus === 422).length,
    timeouts: rows.filter((r) => r.timeout).length,
    successPct: rows.length ? Math.round((ok.length / rows.length) * 1000) / 10 : null,
    durationMs: {
      median: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      max: durations[durations.length - 1] ?? null,
    },
    hcs: {
      mean: hcs.length ? Math.round((hcs.reduce((a, b) => a + b, 0) / hcs.length) * 10) / 10 : null,
      median: percentile(hcs, 50),
      p10: percentile(hcs, 10),
      p25: percentile(hcs, 25),
      p75: percentile(hcs, 75),
      p90: percentile(hcs, 90),
      min: hcs[0] ?? null,
      max: hcs[hcs.length - 1] ?? null,
      gte80Pct: hcs.length ? Math.round((scored.filter((r) => r.hcs >= 80).length / scored.length) * 1000) / 10 : null,
      gte85Pct: hcs.length ? Math.round((scored.filter((r) => r.hcs >= 85).length / scored.length) * 1000) / 10 : null,
      gte90Pct: hcs.length ? Math.round((scored.filter((r) => r.hcs >= 90).length / scored.length) * 1000) / 10 : null,
    },
    save: {
      YES: countVerdict("save", "YES"),
      MAYBE: countVerdict("save", "MAYBE"),
      NO: countVerdict("save", "NO"),
      yesPct: scored.length ? Math.round((countVerdict("save", "YES") / scored.length) * 1000) / 10 : null,
    },
    share: {
      YES: countVerdict("share", "YES"),
      MAYBE: countVerdict("share", "MAYBE"),
      NO: countVerdict("share", "NO"),
      yesPct: scored.length ? Math.round((countVerdict("share", "YES") / scored.length) * 1000) / 10 : null,
    },
    pressPlay: {
      YES: countVerdict("pressPlay", "YES"),
      MAYBE: countVerdict("pressPlay", "MAYBE"),
      NO: countVerdict("pressPlay", "NO"),
      yesPct: scored.length ? Math.round((countVerdict("pressPlay", "YES") / scored.length) * 1000) / 10 : null,
    },
    deliveryTier: {
      FULL: tierCount("FULL"),
      PARTIAL: tierCount("PARTIAL"),
      MINI: tierCount("MINI"),
      STUB: tierCount("STUB"),
      fullPartialPct: scored.length
        ? Math.round(
            ((tierCount("FULL") + tierCount("PARTIAL")) / scored.length) * 1000,
          ) / 10
        : null,
    },
    trackCount: {
      mean: ok.length ? Math.round((tracks.reduce((a, b) => a + b, 0) / tracks.length) * 10) / 10 : null,
      median: percentile(tracks, 50),
    },
    dimensionStats,
    instrumentation,
  };
}

function slimRawTrack(t) {
  return {
    trackName: t.trackName ?? t.name ?? null,
    artistName: t.artistName ?? t.artist ?? null,
    name: t.name ?? null,
    artist: t.artist ?? null,
    energy: t.energy ?? null,
    popularity: t.popularity ?? null,
    valence: t.valence ?? null,
    acousticness: t.acousticness ?? null,
  };
}

async function main() {
  const { limit, resume } = parseArgs();
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { detectListenabilityFailures } = await import("../dist/core/editorial/human-curation-sequencer.js");

  const corpus = loadCorpus();
  const selected = corpus.slice(0, Math.min(limit, corpus.length));
  const corpusHash = sha256File(CORPUS_PATH);

  log(`Experiment F benchmark starting`);
  log(`commit=${getShortCommit()} full=${getHeadCommit()}`);
  log(`corpus=${corpus.length} running=${selected.length} corpusHash=${corpusHash.slice(0, 16)}`);
  log(`results=${RESULTS_PATH}`);

  let existing = {
    experiment: "F",
    commit: getHeadCommit(),
    commitShort: getShortCommit(),
    corpusPath: CORPUS_PATH,
    corpusHash,
    seed: SEED,
    startedAt: new Date().toISOString(),
    rows: [],
  };

  if (resume && existsSync(RESULTS_PATH)) {
    existing = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    log(`Resuming with ${existing.rows.length} completed rows`);
  }

  const doneIds = new Set(existing.rows.map((r) => r.id));
  const creds = await resolveLiveBenchmarkCredentials();
  log(`baseUrl=${creds.baseUrl} user=${creds.spotifyUserId}`);

  const rows = [...existing.rows];

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    if (doneIds.has(item.id)) continue;

    const t0 = Date.now();
    log(`[${i + 1}/${selected.length}] ${item.id}: ${item.prompt.slice(0, 70)}`);

    const row = {
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
      rawTracks: [],
      normalizedTracks: [],
      tracks: [],
      deliveryTier: null,
      hcs: null,
      save: null,
      share: null,
      pressPlay: null,
      dimensions: null,
      trackDiagnostics: null,
      opener: null,
      closer: null,
      artists: [],
      sequencingEvidence: [],
      listenabilityFailures: [],
      normalizationErrors: [],
      normalizationWarnings: [],
      instrumentation: null,
      instrumentationError: null,
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
          requestId: `v21-f-${item.id}`,
          seed: SEED,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      row.httpStatus = res.status;
      const data = await res.json().catch(() => ({}));
      const rawTracks = data.tracks ?? data.playlist ?? [];
      row.rawTracks = rawTracks.map(slimRawTrack);
      row.trackCount = rawTracks.length;
      row.success = res.status === 200;

      if (rawTracks.length > 0) {
        const normalizedTracks = normalizeBenchmarkTracks(rawTracks);
        const validation = validateBenchmarkTrackNormalization(rawTracks, normalizedTracks);
        row.normalizationErrors = validation.errors;
        row.normalizationWarnings = validation.warnings;

        if (!validation.ok) {
          row.instrumentationError = validation.errors.join("; ");
          log(`WARN normalization failed for ${item.id}: ${row.instrumentationError}`);
        }

        const score = evaluateHumanCurationScore(item.prompt, normalizedTracks);
        const failures = detectListenabilityFailures(normalizedTracks, item.prompt);
        const diag = playlistInstrumentationDiagnostics(rawTracks, normalizedTracks, score);

        row.normalizedTracks = normalizedTracks;
        row.tracks = normalizedTracks;
        row.hcs = score.totalScore;
        row.save = score.wouldSave;
        row.share = score.wouldShare;
        row.pressPlay = score.wouldPressPlay;
        row.deliveryTier = score.saveabilityDeliveryTier;
        row.dimensions = score.dimensions;
        row.trackDiagnostics = score.trackDiagnostics;
        row.sequencingEvidence = score.dimensions.sequencing.evidence;
        row.listenabilityFailures = failures;
        row.instrumentation = diag;
        row.opener = `${normalizedTracks[0]?.artistName ?? "?"} — ${normalizedTracks[0]?.trackName ?? "?"}`;
        row.closer = `${normalizedTracks[normalizedTracks.length - 1]?.artistName ?? "?"} — ${normalizedTracks[normalizedTracks.length - 1]?.trackName ?? "?"}`;
        row.artists = [...new Set(normalizedTracks.map((t) => String(t.artistName ?? "").trim()).filter(Boolean))];

        if (diag.pathological && validation.ok === false) {
          row.instrumentationError = row.instrumentationError ?? "Pathological instrumentation signals detected";
        }
      } else if (res.status === 422) {
        row.error = data.message ?? data.error ?? "HTTP 422 refusal";
      }
    } catch (err) {
      row.error = String(err?.message ?? err);
      row.timeout = err?.name === "AbortError";
    }

    row.durationMs = Date.now() - t0;
    rows.push(row);
    doneIds.add(item.id);

    const payload = {
      ...existing,
      experiment: "F",
      commit: getHeadCommit(),
      commitShort: getShortCommit(),
      corpusPath: CORPUS_PATH,
      corpusHash,
      corpusSize: corpus.length,
      seed: SEED,
      runCount: rows.length,
      generatedAt: new Date().toISOString(),
      summary: summarize(rows),
      rows,
    };
    persistAtomic(payload);

    log(
      `  done ${row.durationMs}ms http=${row.httpStatus} tracks=${row.trackCount} hcs=${row.hcs ?? "—"} save=${row.save ?? "—"} tier=${row.deliveryTier ?? "—"}`,
    );

    if (i + 1 < selected.length) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const finalPayload = {
    ...existing,
    experiment: "F",
    commit: getHeadCommit(),
    commitShort: getShortCommit(),
    corpusPath: CORPUS_PATH,
    corpusHash,
    corpusSize: corpus.length,
    seed: SEED,
    runCount: rows.length,
    completedAt: new Date().toISOString(),
    summary: summarize(rows),
    rows,
  };
  persistAtomic(finalPayload);
  log(`Complete: ${rows.length}/${corpus.length} rows → ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
