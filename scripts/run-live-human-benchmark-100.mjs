/**
 * Live human-saveability benchmark — audit mode with Spotify user library.
 * Generates 100-track playlists, scores human saveability + human-likeness vs reference.
 *
 * Usage:
 *   $env:KWALIFY_BENCHMARK_BASE_URL="https://kwalify.net"
 *   $env:PLAYLIST_EVAL_TOKEN="<token>"
 *   $env:SMOKE_SPOTIFY_USER_ID="koalablade"
 *   node scripts/run-live-human-benchmark-100.mjs
 *
 * Options:
 *   --length 100          Track count per playlist (default 100)
 *   --budget-ms 7200000   Stop after wall-clock budget (default 2h)
 *   --timeout-ms 600000   Per-request timeout (default 10m)
 *   --delay-ms 8000       Delay between requests
 *   --limit N             Max prompts (default: all in corpus)
 *   --resume              Skip prompts already in output file
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { normalizeEvalToken } = require("../backend/dist/lib/eval-token-normalize");
const { readLocalDotEnvValue } = require("../backend/dist/lib/benchmark-env-dotenv");
const { comparePlaylistsPairwise } = require("../backend/dist/core/editorial/pairwise-playlist-judge");
const { evaluateWouldISave } = require("../backend/dist/core/editorial/would-i-save-evaluator");

const PROMPTS_PATH = path.resolve("data/corpus/pairwise-benchmark-prompts.json");
const BASELINE_PATH = path.resolve("data/corpus/human-benchmark-baseline-pre-fix.json");
const REPORT_PATH = path.resolve("reports/live-human-benchmark-100.json");
const COMPARE_PATH = path.resolve("reports/live-human-benchmark-100-comparison.md");

function authCookie() {
  const raw =
    process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim()
    || process.env.COOKIE_VALUE?.trim()
    || readLocalDotEnvValue("PLAYLIST_BENCHMARK_AUTH_COOKIE")
    || readLocalDotEnvValue("COOKIE_VALUE");
  if (!raw) return null;
  if (raw.includes("=")) return raw;
  return `connect.sid=${raw}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    length: Number.parseInt(get("--length", "100"), 10),
    budgetMs: Number.parseInt(get("--budget-ms", String(2 * 60 * 60 * 1000)), 10),
    timeoutMs: Number.parseInt(get("--timeout-ms", "600000"), 10),
    delayMs: Number.parseInt(get("--delay-ms", "8000"), 10),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "15"), 10) : null,
    resume: args.includes("--resume"),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lockedIntentStub() {
  return {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: null,
    energy: null,
  };
}

function toPatternTrack(row) {
  return {
    trackId: `${row.artistName}-${row.trackName}`.toLowerCase().replace(/\s+/g, "-"),
    trackName: row.trackName,
    artistName: row.artistName,
    genreFamily: row.genreFamily ?? null,
    energy: row.energy ?? null,
    valence: row.valence ?? null,
    danceability: row.danceability ?? null,
    acousticness: row.acousticness ?? null,
    rediscoveryScore: row.rediscoveryScore ?? 0.4,
  };
}

function extractRun(data, httpStatus) {
  const trace = data.playlistExecutionTrace ?? {};
  const gate = data.humanSaveabilityGate ?? {};
  const intent = data.intentCollapseLayer ?? trace.intentCollapseLayer ?? null;
  const counts = trace.trackCounts ?? {};
  const stage = trace.stageAttribution ?? {};
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const samplerRan = stage.sampler?.status === "completed" || (counts.after_sampler ?? 0) > 0;
  const gateExecuted = trace.debugFlags?.gateExecuted === true || gate.humanSaveable != null;
  const humanSaveable = trace.humanSaveable === true || gate.humanSaveable === true;
  return {
    httpStatus,
    executionPath: trace.executionPath ?? null,
    editorialWorldTag: intent?.editorialWorldTag ?? null,
    retrievalCount: counts.retrieved ?? intent?.preFilterCount ?? null,
    postFilterCount: intent?.postFilterCount ?? null,
    samplerCount: counts.after_sampler ?? null,
    samplerExecuted: samplerRan,
    gateResult: {
      executed: gateExecuted,
      humanSaveable,
      bypassed: trace.debugFlags?.gateBypassed === true,
      bypassReason: trace.rejectionReasons?.find((r) => r.includes("timeout_fallback")) ?? null,
    },
    curatorScore: trace.curatorScore ?? gate.curatorScore ?? null,
    rejectionReasons: trace.rejectionReasons ?? [],
    error: data.error ?? data.message ?? null,
    trackCount: tracks.length,
    spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.playlistUrl ?? null,
    funnelCollapseStage: trace.funnelCollapseStage ?? null,
    pairwiseSelection: data.v3Diagnostics?.controlledGeneration?.pairwiseSelection ?? null,
    candidateSelectionMethod: data.v3Diagnostics?.controlledGeneration?.candidateSelectionMethod ?? null,
    tracks,
    firstTen: tracks.slice(0, 10).map((t) =>
      `${t.artistName ?? t.artist ?? "?"} — ${t.trackName ?? t.name ?? "?"}`,
    ),
  };
}

function buildCandidate(label, tracks, prompt, qualityOverall = 0.5) {
  const wouldISave = evaluateWouldISave({
    prompt,
    tracks,
    context: null,
    lockedIntent: lockedIntentStub(),
  });
  return { label, tracks, wouldISave, qualityOverall, context: null, scalarTotal: wouldISave.combinedScore };
}

function summarizeResults(results) {
  const n = results.length || 1;
  const http200 = results.filter((r) => r.httpStatus === 200);
  const withProxy = results.filter((r) => r.humanLikeness?.pairwiseWinner);
  const kwalifyWins = withProxy.filter((r) => r.humanLikeness.pairwiseWinner === "kwalify_generated").length;
  const humanWins = withProxy.filter((r) => r.humanLikeness.pairwiseWinner === "human_reference").length;
  const wouldSaveScores = results
    .map((r) => r.wouldISave?.combinedScore)
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  const humanPatternScores = results
    .map((r) => r.wouldISave?.humanPatternScore)
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  return {
    promptCount: results.length,
    http200: http200.length,
    http422: results.filter((r) => r.httpStatus === 422).length,
    http200Rate: http200.length / n,
    http422Rate: results.filter((r) => r.httpStatus === 422).length / n,
    trackCount90Plus: results.filter((r) => r.trackCount >= 90).length,
    trackCount80Plus: results.filter((r) => r.trackCount >= 80).length,
    samplerExecuted: results.filter((r) => r.samplerExecuted).length,
    samplerExecutedRate: results.filter((r) => r.samplerExecuted).length / n,
    humanSaveable: results.filter((r) => r.gateResult.humanSaveable).length,
    humanSaveableRate: results.filter((r) => r.gateResult.humanSaveable).length / n,
    gateBypassed: results.filter((r) => r.gateResult.bypassed).length,
    timeoutFallback: results.filter((r) => r.executionPath === "timeout_fallback").length,
    avgWouldSaveScore: wouldSaveScores.length
      ? wouldSaveScores.reduce((a, b) => a + b, 0) / wouldSaveScores.length
      : null,
    avgHumanPatternScore: humanPatternScores.length
      ? humanPatternScores.reduce((a, b) => a + b, 0) / humanPatternScores.length
      : null,
    pairwiseComparable: withProxy.length,
    pairwiseKwalifyWins: kwalifyWins,
    pairwiseHumanWins: humanWins,
    pairwiseKwalifyWinRate: withProxy.length ? kwalifyWins / withProxy.length : null,
    avgCuratorScore: (() => {
      const scores = results.map((r) => r.curatorScore).filter((s) => typeof s === "number" && Number.isFinite(s));
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    })(),
  };
}

function buildComparisonMarkdown(payload, baseline) {
  const s = payload.summary;
  const b = baseline?.metrics ?? {};
  const lines = [
    "# Live Human Benchmark — 100-track comparison",
    "",
    `Generated: ${payload.generatedAt}`,
    `Deploy: \`${payload.productionCommit?.slice(0, 7) ?? "unknown"}\``,
    `Mode: ${payload.mode} | User: ${payload.spotifyUserId} | Length: ${payload.playlistLength}`,
    `Wall-clock: ${Math.round(payload.elapsedMs / 60000)} min (budget ${Math.round(payload.budgetMs / 60000)} min)`,
    "",
    "## North-star: human-likeness vs editorial reference",
    "",
    "| Metric | This run | Pre-fix baseline |",
    "|--------|----------|------------------|",
    `| Pairwise win rate (Kwalify vs human ref) | ${pct(s.pairwiseKwalifyWinRate)} | ${pct(baseline?.humanLikeness?.pairwiseWinRateVsReference)} |`,
    `| Avg would-save score | ${num(s.avgWouldSaveScore)} | — |`,
    `| Avg human-pattern score | ${num(s.avgHumanPatternScore)} | — |`,
    "",
    "## Human saveability (diagnostic — not north-star)",
    "",
    "| Metric | This run | Pre-fix baseline |",
    "|--------|----------|------------------|",
    `| humanSaveable gate pass rate | ${pct(s.humanSaveableRate)} (${s.humanSaveable}/${s.promptCount}) | ${b.humanSaveableRate != null ? pct(b.humanSaveableRate) : "unknown"} |`,
    `| HTTP 200 rate | ${pct(s.http200Rate)} | — |`,
    `| HTTP 422 rate | ${pct(s.http422Rate)} | ${pct(b.http422Rate)} |`,
    `| Sampler executed rate | ${pct(s.samplerExecutedRate)} | ${pct(b.samplerExecutedRate)} |`,
    `| Timeout fallback count | ${s.timeoutFallback} | high |`,
    `| Gate bypassed count | ${s.gateBypassed} | — |`,
    `| Avg curator score | ${num(s.avgCuratorScore)} | — |`,
    `| Playlists ≥90 tracks | ${s.trackCount90Plus}/${s.promptCount} | — |`,
    "",
    "## Per-prompt",
    "",
  ];
  for (const r of payload.results) {
    const proxy = r.humanLikeness?.pairwiseWinner ?? "n/a";
    lines.push(
      `- **${r.id}** — HTTP ${r.httpStatus}, tracks=${r.trackCount}, humanSaveable=${r.gateResult.humanSaveable}, sampler=${r.samplerExecuted}, pairwise=${proxy}, wouldSave=${num(r.wouldISave?.combinedScore)}`,
    );
  }
  lines.push("", "## Notes", "", "- `pairwise*` uses internal judge only — blind human rating is ground truth.", "- Pre-fix baseline from documented live evidence before b6f109b editorial fixes.", "");
  return lines.join("\n");
}

function pct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 1000) / 10}%`;
}

function num(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(Math.round(v * 1000) / 1000);
}

async function generateOne(creds, token, cookie, row, config) {
  const useLiveAuth = !!cookie;
  const url = useLiveAuth ? `${creds.baseUrl}/api/generate` : `${creds.baseUrl}/api/generate?audit=1`;
  const headers = useLiveAuth
    ? { "Content-Type": "application/json", Cookie: cookie }
    : { "Content-Type": "application/json", "x-kwalify-evaluation-token": token };
  const body = useLiveAuth
    ? {
      vibe: row.prompt,
      mode: "balanced",
      length: config.length,
      varietyBoost: true,
      seed: 1,
      requestId: `live-human-100-${row.id}`,
    }
    : {
      vibe: row.prompt,
      mode: "balanced",
      length: config.length,
      spotifyUserId: creds.spotifyUserId,
      seed: 1,
      auditMode: true,
      requestId: `live-human-100-${row.id}`,
    };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const config = parseArgs();
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  const cookie = authCookie();
  const mode = cookie ? "live-auth" : "audit";

  const ready = await fetch(`${creds.baseUrl}/api/readyz`);
  const readyData = await ready.json();

  const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
    method: "POST",
    headers: { "x-kwalify-evaluation-token": token },
  });
  if (!ping.ok) throw new Error(`Eval ping failed (${ping.status})`);

  if (cookie) {
    const meRes = await fetch(`${creds.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    const me = await meRes.json();
    if (!meRes.ok) throw new Error(`Auth preflight failed: ${me.error ?? me.message}`);
    process.stderr.write(`[live-100] live auth as ${me.id ?? me.spotifyUserId ?? "unknown"}\n`);
  } else {
    process.stderr.write(`[live-100] audit mode spotifyUserId=${creds.spotifyUserId}\n`);
  }

  const corpus = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  const prompts = config.limit ? corpus.slice(0, config.limit) : corpus;

  let baseline = null;
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  } catch {
    baseline = null;
  }

  let existing = [];
  if (config.resume) {
    try {
      await access(REPORT_PATH);
      const prev = JSON.parse(await readFile(REPORT_PATH, "utf8"));
      existing = prev.results ?? [];
    } catch {
      existing = [];
    }
  }
  const doneIds = new Set(existing.map((r) => r.id));

  process.stderr.write(
    `[live-100] deploy=${readyData.commit?.slice(0, 7)} length=${config.length} budget=${Math.round(config.budgetMs / 60000)}min prompts=${prompts.length}\n`,
  );

  const startedAt = Date.now();
  const results = [...existing];

  for (const row of prompts) {
    if (Date.now() - startedAt >= config.budgetMs) {
      process.stderr.write("[live-100] budget exhausted, stopping\n");
      break;
    }
    if (doneIds.has(row.id)) {
      process.stderr.write(`[live-100] skip ${row.id} (resume)\n`);
      continue;
    }

    const t0 = Date.now();
    process.stderr.write(`[live-100] generating ${row.id} (${config.length} tracks)...\n`);
    let gen;
    try {
      gen = await generateOne(creds, token, cookie, row, config);
    } catch (err) {
      gen = { httpStatus: 0, data: { error: String(err) } };
    }

    const run = extractRun(gen.data ?? {}, gen.httpStatus);
    const kwalifyTracks = run.tracks.map((t) => toPatternTrack({
      trackName: t.trackName ?? t.name ?? "?",
      artistName: t.artistName ?? t.artist ?? "?",
      genreFamily: t.genreFamily ?? null,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
    }));
    const refTracks = (row.referenceTracks ?? []).map(toPatternTrack);
    const kwalifyCandidate = buildCandidate("kwalify_generated", kwalifyTracks, row.prompt, 0.5);
    const humanCandidate = buildCandidate("human_reference", refTracks, row.prompt, 0.72);

    let humanLikeness = null;
    if (kwalifyTracks.length >= 8 && refTracks.length >= 5) {
      const cmp = comparePlaylistsPairwise(humanCandidate, kwalifyCandidate);
      humanLikeness = {
        pairwiseWinner: cmp.winner === "a" ? "human_reference" : "kwalify_generated",
        confidence: cmp.confidence,
        reasons: cmp.reasons,
        dimensions: cmp.dimensions,
        disclaimer: "Internal pairwise judge — not blind human rating",
      };
    }

    results.push({
      id: row.id,
      prompt: row.prompt,
      durationMs: Date.now() - t0,
      httpStatus: run.httpStatus,
      trackCount: run.trackCount,
      executionPath: run.executionPath,
      samplerExecuted: run.samplerExecuted,
      gateResult: run.gateResult,
      curatorScore: run.curatorScore,
      rejectionReasons: run.rejectionReasons,
      error: run.error,
      editorialWorldTag: run.editorialWorldTag,
      retrievalCount: run.retrievalCount,
      postFilterCount: run.postFilterCount,
      samplerCount: run.samplerCount,
      pairwiseSelection: run.pairwiseSelection,
      candidateSelectionMethod: run.candidateSelectionMethod,
      spotifyPlaylistUrl: run.spotifyPlaylistUrl,
      firstTen: run.firstTen,
      wouldISave: kwalifyCandidate.wouldISave,
      humanLikeness,
      referenceTrackCount: refTracks.length,
    });

    process.stderr.write(
      `[live-100] ${row.id} → ${run.httpStatus} tracks=${run.trackCount} humanSaveable=${run.gateResult.humanSaveable} pairwise=${humanLikeness?.pairwiseWinner ?? "n/a"}\n`,
    );

    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    const partial = {
      generatedAt: new Date().toISOString(),
      productionCommit: readyData.commit ?? null,
      baseUrl: creds.baseUrl,
      mode,
      spotifyUserId: creds.spotifyUserId,
      playlistLength: config.length,
      budgetMs: config.budgetMs,
      elapsedMs: Date.now() - startedAt,
      baselineLabel: baseline?.label ?? null,
      summary: summarizeResults(results),
      results,
    };
    await writeFile(REPORT_PATH, JSON.stringify(partial, null, 2));

    if (Date.now() - startedAt < config.budgetMs) await sleep(config.delayMs);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    productionCommit: readyData.commit ?? null,
    baseUrl: creds.baseUrl,
    mode,
    spotifyUserId: creds.spotifyUserId,
    playlistLength: config.length,
    budgetMs: config.budgetMs,
    elapsedMs: Date.now() - startedAt,
    baselineLabel: baseline?.label ?? null,
    baseline,
    northStarMetric: "pairwise win rate vs human editorial reference (blind rating is ground truth)",
    summary: summarizeResults(results),
    results,
  };

  await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2));
  await writeFile(COMPARE_PATH, buildComparisonMarkdown(payload, baseline));

  console.log(JSON.stringify({
    report: REPORT_PATH,
    comparison: COMPARE_PATH,
    summary: payload.summary,
    commit: payload.productionCommit,
    elapsedMin: Math.round(payload.elapsedMs / 60000),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
