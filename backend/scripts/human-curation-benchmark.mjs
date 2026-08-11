/**
 * V16 human curation benchmark — runs 8 prompts + Human Curation Score.
 * Usage: node backend/scripts/human-curation-benchmark.mjs [--log=path]
 */
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const BASELINE_HUMAN = {
  country_cowboy: 4,
  dad_rock_bbq: 3,
  motorway_rain: 3,
  gym: 2,
  no_rap_gym: 2,
  madchester: 1,
  disco: 1,
  "80s_night_drive": 0,
};

const PROMPTS = [
  { id: "country_cowboy", prompt: "country cowboy road trip" },
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers" },
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen" },
  { id: "gym", prompt: "heavy gym workout aggressive" },
  { id: "no_rap_gym", prompt: "no rap gym workout" },
  { id: "madchester", prompt: "madchester pub walk" },
  { id: "disco", prompt: "disco rooftop party 1978" },
  { id: "80s_night_drive", prompt: "80s night drive" },
];

async function loadModules() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore, summariseHumanCurationBenchmark } = await import(
    "../dist/core/editorial/human-curation-score.js"
  );
  const { parseHumanSaveabilityFromGenerateResponse } = await import(
    "../dist/lib/human-saveability-benchmark-parse.js"
  );
  return { resolveLiveBenchmarkCredentials, evaluateHumanCurationScore, summariseHumanCurationBenchmark, parseHumanSaveabilityFromGenerateResponse };
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

async function generatePlaylist(creds, prompt, requestId, onHeartbeat) {
  const url = `${creds.baseUrl}/api/generate?audit=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    onHeartbeat?.(`still waiting for generate response (${Math.round(PROMPT_TIMEOUT_MS / 60000)}m cap)`);
  }, HEARTBEAT_INTERVAL_MS);
  try {
    const res = await fetch(url, {
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
        spotifyUserId: creds.spotifyUserId,
        requestId,
        seed: 42,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    const tracks = data.tracks ?? data.playlist ?? [];
    return { httpStatus: res.status, tracks, data };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        `generate timed out after ${Math.round(PROMPT_TIMEOUT_MS / 60000)} minutes — server may be hung on large hard-lock pool`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

function trackAnalysis(tracks, scoreResult) {
  if (tracks.length === 0) {
    return {
      strongest: "—",
      weakest: "—",
      worstTransition: "—",
      biggestImprovement: "—",
      remainingProblem: "empty delivery",
    };
  }
  const diag = scoreResult.trackDiagnostics;
  const sorted = [...diag].sort((a, b) => b.contribution - a.contribution);
  const strongest = `${sorted[0]?.artistName} — ${sorted[0]?.trackName} (${sorted[0]?.contribution}/10)`;
  const weakest = `${sorted[sorted.length - 1]?.artistName} — ${sorted[sorted.length - 1]?.trackName}`;
  const seqEvidence = scoreResult.dimensions.sequencing.evidence.join("; ");
  return {
    strongest,
    weakest,
    worstTransition: seqEvidence.includes("transition") ? seqEvidence : "none flagged",
    biggestImprovement: scoreResult.dimensions.sequencing.score >= 16 ? "sequencing" : "cohesion/moment",
    remainingProblem: scoreResult.dimensions.momentUnderstanding.evidence[0] ?? "—",
  };
}

async function main() {
  const logArg = process.argv.find((a) => a.startsWith("--log="));
  const logPath = logArg
    ? resolve(ROOT, logArg.split("=")[1])
    : resolve(ROOT, "reports/playlist-evaluation/v16-human-curation-run.log");

  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", "utf8");

  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
    appendFileSync(logPath, s + "\n", "utf8");
  };

  log(`# V16 Human Curation Benchmark`);
  log(`commit: ${getHeadCommit()}`);
  log(`time: ${new Date().toISOString()}`);
  log("");

  const { resolveLiveBenchmarkCredentials, evaluateHumanCurationScore, summariseHumanCurationBenchmark } =
    await loadModules();
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: process.env.KWALIFY_BENCHMARK_BASE_URL ?? "http://127.0.0.1:5000",
  });
  const baseUrl = creds.baseUrl;
  log(`baseUrl: ${baseUrl}`);
  log(`token length: ${creds.token?.length ?? 0}`);
  log("");

  const results = [];
  const startedAt = Date.now();
  const total = PROMPTS.length;

  for (let i = 0; i < PROMPTS.length; i++) {
    const { id, prompt } = PROMPTS[i];
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    const progress = `[${i + 1}/${total}]`;
    log(`${progress} (${elapsedMin}m elapsed) — starting ${id}`);
    log(`## ${id}`);
    log(`prompt: ${prompt}`);
    try {
      const promptStarted = Date.now();
      const { httpStatus, tracks, data } = await generatePlaylist(
        creds,
        prompt,
        `v16-${id}`,
        (msg) => log(`${progress} ${id} — ${msg}`),
      );
      const promptSec = ((Date.now() - promptStarted) / 1000).toFixed(0);
      log(`${progress} ${id} done in ${promptSec}s — ${tracks.length} tracks`);
      const mapped = tracks.map((t) => ({
        trackName: t.trackName ?? t.name,
        artistName: t.artistName ?? t.artist,
        energy: t.energy ?? null,
        popularity: t.popularity ?? null,
        valence: t.valence ?? null,
        acousticness: t.acousticness ?? null,
      }));
      const score = evaluateHumanCurationScore(prompt, mapped);
      results.push({ id, score, trackCount: tracks.length, httpStatus, data });

      log(`tracks: ${tracks.length} | http: ${httpStatus}`);
      log(`Human Curation Score: ${score.totalScore}/100`);
      log(`Press Play: ${score.wouldPressPlay} | Save: ${score.wouldSave} | Share: ${score.wouldShare}`);
      log(`Human-made: ${score.wouldBelieveHumanMade} | AI obvious: ${score.aiObviousness}`);
      log(`Baseline human (0-5): ${BASELINE_HUMAN[id] ?? "?"}`);
      for (const [dim, val] of Object.entries(score.dimensions)) {
        log(`  ${dim}: ${val.score}/${val.max} — ${val.evidence.join("; ")}`);
      }
      if (tracks.length > 0) {
        log("tracklist:");
        tracks.slice(0, 15).forEach((t, i) => {
          log(`  ${i + 1}. ${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`);
        });
      }
      log("");
    } catch (err) {
      log(`ERROR: ${err.message}`);
      log("");
    }
  }

  const summary = summariseHumanCurationBenchmark(
    results.map((r) => ({ id: r.id, score: r.score, trackCount: r.trackCount })),
  );

  log("## KPI Dashboard");
  log(`Average Human Curation Score: ${summary.averageScore}/100`);
  log(`Human-level (≥80): ${summary.humanLevelCount}/8`);
  log(`Press Play YES: ${summary.pressPlayYes}/8`);
  log(`Save YES: ${summary.saveYes}/8`);
  log(`Share YES: ${summary.shareYes}/8`);
  log(`Human-made YES: ${summary.humanMadeYes}/8`);
  log(`Low AI: ${summary.lowAiCount}/8`);
  log("");
  log("## Before vs After");
  log("| Prompt | Old Human | New Score/100 | Save | Share | AI |");
  log("|--------|-----------|---------------|------|-------|-----|");
  for (const r of results) {
    log(
      `| ${r.id} | ${BASELINE_HUMAN[r.id] ?? "?"} | ${r.score.totalScore} | ${r.score.wouldSave} | ${r.score.wouldShare} | ${r.score.aiObviousness} |`,
    );
  }

  const totalMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  log(`\nBenchmark complete in ${totalMin} minutes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
