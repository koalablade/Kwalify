/**
 * Live pairwise human benchmark — generate Kwalify playlists on production,
 * build blind A/B pairs vs editorial reference playlists, export for human rating.
 *
 * Automated pairwise proxy scores are included for engineering signal ONLY.
 * North-star metric = human blind win rate (not gate pass rate).
 *
 * Usage:
 *   $env:KWALIFY_BENCHMARK_BASE_URL="https://kwalify.net"
 *   node scripts/run-pairwise-human-benchmark-live.mjs
 *   node scripts/run-pairwise-human-benchmark-live.mjs --limit 4
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { normalizeEvalToken } = require("../backend/dist/lib/eval-token-normalize");
const { readLocalDotEnvValue } = require("../backend/dist/lib/benchmark-env-dotenv");
const { buildBlindPairwiseHumanBenchmarkPair, comparePlaylistsPairwise } = require("../backend/dist/core/editorial/pairwise-playlist-judge");
const { evaluateWouldISave } = require("../backend/dist/core/editorial/would-i-save-evaluator");

const PROMPTS_PATH = path.resolve("data/corpus/pairwise-benchmark-prompts.json");
const REPORT_PATH = path.resolve("reports/pairwise-human-benchmark-live.json");
const BLIND_PATH = path.resolve("reports/pairwise-human-benchmark-pairs.json");
const GENERATE_TIMEOUT_MS = 180_000;

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
  let limit = 15;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i], 10);
  }
  return { limit };
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

function buildCandidate(label, tracks, prompt, qualityOverall = 0.5) {
  const wouldISave = evaluateWouldISave({
    prompt,
    tracks,
    context: null,
    lockedIntent: lockedIntentStub(),
  });
  return {
    label,
    tracks,
    wouldISave,
    qualityOverall,
    context: null,
    scalarTotal: wouldISave.combinedScore,
  };
}

async function generateKwalify(creds, token, prompt, promptId, cookie) {
  const useLiveAuth = !!cookie;
  const url = useLiveAuth ? `${creds.baseUrl}/api/generate` : `${creds.baseUrl}/api/generate?audit=1`;
  const headers = useLiveAuth
    ? { "Content-Type": "application/json", Cookie: cookie }
    : { "Content-Type": "application/json", "x-kwalify-evaluation-token": token };
  const body = useLiveAuth
    ? { vibe: prompt, mode: "balanced", length: 25, varietyBoost: true, seed: 1, requestId: `pairwise-bench-${promptId}` }
    : {
      vibe: prompt,
      mode: "balanced",
      length: 25,
      spotifyUserId: creds.spotifyUserId,
      seed: 1,
      auditMode: true,
      requestId: `pairwise-bench-${promptId}`,
    };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
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
  const { limit } = parseArgs();
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

  const corpus = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  const prompts = corpus.slice(0, limit);

  process.stderr.write(`[pairwise-live] deploy=${readyData.commit?.slice(0, 7)} mode=${mode} prompts=${prompts.length}\n`);

  const results = [];
  for (const row of prompts) {
    const started = Date.now();
    process.stderr.write(`[pairwise-live] generating ${row.id}...\n`);
    let gen;
    try {
      gen = await generateKwalify(creds, token, row.prompt, row.id, cookie);
    } catch (err) {
      gen = { httpStatus: 0, data: { error: String(err) } };
    }

    const data = gen.data ?? {};
    const trace = data.playlistExecutionTrace ?? {};
    const gate = data.humanSaveabilityGate ?? {};
    const kwalifyTracks = (Array.isArray(data.tracks) ? data.tracks : []).map((t) => toPatternTrack({
      trackName: t.trackName ?? t.name ?? "?",
      artistName: t.artistName ?? t.artist ?? "?",
      genreFamily: t.genreFamily ?? null,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
    }));

    const refTracks = (row.referenceTracks ?? []).map(toPatternTrack);
    const humanCandidate = buildCandidate("human_reference", refTracks, row.prompt, 0.72);
    const kwalifyCandidate = buildCandidate("kwalify_generated", kwalifyTracks, row.prompt, 0.5);

    let automatedProxy = null;
    if (kwalifyTracks.length >= 8 && refTracks.length >= 5) {
      const cmp = comparePlaylistsPairwise(humanCandidate, kwalifyCandidate);
      automatedProxy = {
        winner: cmp.winner === "a" ? "human_reference" : "kwalify_generated",
        confidence: cmp.confidence,
        reasons: cmp.reasons,
        dimensions: cmp.dimensions,
        disclaimer: "NOT human judgement — internal pairwise judge only",
      };
    }

    const blind = buildBlindPairwiseHumanBenchmarkPair({
      prompt: row.prompt,
      playlistA: { label: "human_reference", tracks: refTracks.map(({ trackName, artistName }) => ({ trackName, artistName })) },
      playlistB: { label: "kwalify_generated", tracks: kwalifyTracks.map(({ trackName, artistName }) => ({ trackName, artistName })) },
      seed: results.length + 1,
    });

    results.push({
      id: row.id,
      prompt: row.prompt,
      durationMs: Date.now() - started,
      generation: {
        httpStatus: gen.httpStatus,
        trackCount: kwalifyTracks.length,
        executionPath: trace.executionPath ?? null,
        humanSaveable: trace.humanSaveable === true || gate.humanSaveable === true,
        gateExecuted: trace.debugFlags?.gateExecuted === true || gate.humanSaveable != null,
        samplerExecuted: (trace.trackCounts?.after_sampler ?? 0) > 0 || trace.stageAttribution?.sampler?.status === "completed",
        pairwiseSelection: data.v3Diagnostics?.controlledGeneration?.pairwiseSelection ?? null,
        candidateSelectionMethod: data.v3Diagnostics?.controlledGeneration?.candidateSelectionMethod ?? null,
        error: data.error ?? data.message ?? null,
        opening10: kwalifyTracks.slice(0, 10).map((t) => `${t.artistName} — ${t.trackName}`),
      },
      blindPairForHumans: blind,
      automatedProxy,
      referenceTrackCount: refTracks.length,
    });

    process.stderr.write(
      `[pairwise-live] ${row.id} → ${gen.httpStatus} tracks=${kwalifyTracks.length} proxy=${automatedProxy?.winner ?? "n/a"}\n`,
    );
  }

  const withProxy = results.filter((r) => r.automatedProxy);
  const kwalifyProxyWins = withProxy.filter((r) => r.automatedProxy.winner === "kwalify_generated").length;
  const humanProxyWins = withProxy.filter((r) => r.automatedProxy.winner === "human_reference").length;

  const payload = {
    generatedAt: new Date().toISOString(),
    productionCommit: readyData.commit ?? null,
    baseUrl: creds.baseUrl,
    mode,
    northStarMetric: "human_blind_win_rate_vs_reference (requires external raters)",
    automatedProxyDisclaimer: "automatedProxy is internal judge only — do not treat as human benchmark",
    summary: {
      promptCount: results.length,
      http200: results.filter((r) => r.generation.httpStatus === 200).length,
      http422: results.filter((r) => r.generation.httpStatus === 422).length,
      withTracks20Plus: results.filter((r) => r.generation.trackCount >= 20).length,
      samplerExecuted: results.filter((r) => r.generation.samplerExecuted).length,
      humanSaveableGate: results.filter((r) => r.generation.humanSaveable).length,
      automatedProxyKwalifyWins: kwalifyProxyWins,
      automatedProxyHumanWins: humanProxyWins,
      automatedProxyKwalifyWinRate: withProxy.length ? kwalifyProxyWins / withProxy.length : null,
    },
    humanRatingQuestions: [
      "Which playlist feels more intentional?",
      "Which would you save?",
      "Which has the better opening?",
      "Which would you replay next week?",
      "Which feels like Spotify editorial?",
    ],
    results,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2));
  await writeFile(BLIND_PATH, JSON.stringify({
    generatedAt: payload.generatedAt,
    productionCommit: payload.productionCommit,
    pairs: results.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      ...r.blindPairForHumans,
      instructions: [
        "Hide source labels from raters — use sideA/sideB only.",
        "Record A, B, or tie for each question.",
        "Aggregate win rate vs human_reference is the north-star metric.",
      ],
    })),
  }, null, 2));

  console.log(JSON.stringify({
    report: REPORT_PATH,
    blindPairs: BLIND_PATH,
    summary: payload.summary,
    commit: payload.productionCommit,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
