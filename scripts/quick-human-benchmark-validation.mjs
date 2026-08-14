/**
 * Quick validation on worst-failing human benchmark prompts.
 * Usage: node scripts/quick-human-benchmark-validation.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");

const QUICK_IDS = [
  "neg-no-rap-gym",
  "gym/-gym-workout-training-session-029",
  "uk-madchester",
  "genre-grunge",
  "genre-metal",
  "val_gym_but_not_edm",
  "hof_gym_boost",
  "oc2_gravity_gym_indie_library",
  "neg-no-guitar",
  "hof_road_trip",
  "stress_vague_vibes",
  "oc2_func_gym_motivation",
];

const BENCH_DIR = path.resolve("reports/playlist-evaluation/human-benchmark-2026-07-28");
const PROMPTS_PATH = path.join(BENCH_DIR, "prompts.json");
const BEFORE_PATH = path.join(BENCH_DIR, "raw-results.json");
const OUT_PATH = path.resolve("reports/playlist-evaluation/quick-validation-2026-07-28.json");

const LANDFILL =
  /\b(bon iver|clairo|noah kahan|dayglow|gregory alan isakov|badbadnotgood|phoebe bridgers|sufjan|mitski|beach house|jake bugg)\b/i;

function trackLine(t) {
  const artist = t.artistName ?? t.artist ?? t.artist_name ?? "?";
  const name = t.trackName ?? t.name ?? t.title ?? "?";
  return `${artist} — ${name}`;
}

function scoreHumanExpectation(tracks, spec, meta) {
  const lines = tracks.map(trackLine);
  const first3 = lines.slice(0, 3);
  const first10 = lines.slice(0, 10);
  const forbidden = spec.forbidden ? new RegExp(spec.forbidden, "i") : /$^/;
  const prefer = spec.prefer ? new RegExp(spec.prefer, "i") : /./;
  const f3bad = first3.filter((line) => forbidden.test(line) || LANDFILL.test(line));
  const f10bad = first10.filter((line) => forbidden.test(line) || LANDFILL.test(line));
  const f3good = first3.filter((line) => prefer.test(line.toLowerCase()));
  const first3World = tracks.length > 0 && f3bad.length === 0 && (f3good.length >= 1 || tracks.length <= 3);
  const hqgPass = meta.humanSaveable === true || meta.humanQualityGate === "pass";
  let verdict = "MAYBE";
  if (tracks.length < 6 || meta.httpStatus !== 200) verdict = "DROP";
  else if (f10bad.length >= 3 || f3bad.length >= 2) verdict = "DROP";
  else if (f10bad.length === 0 && f3good.length >= 2 && tracks.length >= 8 && first3World && hqgPass) verdict = "KEEP";
  else if (!first3World || f10bad.length >= 1) verdict = "DROP";
  else if (first3World && hqgPass) verdict = "MAYBE";
  else verdict = "MAYBE";
  return { verdict, first3, forbiddenInFirst10: f10bad, first3World, hqgPass };
}

async function generateOne(creds, baseUrl, spec) {
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": creds.token,
    },
    body: JSON.stringify({
      vibe: spec.prompt,
      length: spec.length ?? 25,
      mode: spec.mode ?? "balanced",
      seed: 42,
      spotifyUserId: creds.spotifyUserId,
      auditMode: true,
      allowDbWrites: false,
      allowSpotifyCreate: false,
      evaluationPromptId: `quick-val-${spec.id}`,
      evaluationCategory: "quick_validation_2026_07_28",
      evaluationTimeoutMs: 240_000,
    }),
  });
  const data = await res.json();
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const meta = {
    httpStatus: res.status,
    humanSaveable:
      data.humanSaveabilityGate?.humanSaveable ??
      data.playlistExecutionTrace?.humanSaveable ??
      null,
    humanQualityGate:
      data.humanQualityGate?.action ??
      data.playlistExecutionTrace?.humanQualityGate?.action ??
      null,
    error: res.status !== 200 ? (data.message ?? data.error ?? `HTTP ${res.status}`) : null,
  };
  return {
    id: spec.id,
    prompt: spec.prompt,
    trackCount: tracks.length,
    ...meta,
    ...scoreHumanExpectation(tracks, spec, meta),
  };
}

async function main() {
  const creds = await resolveVerifiedProductionCredentials();
  const baseUrl = (creds.baseUrl || "https://kwalify.net").replace(/\/$/, "");
  const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const corpus = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  const allPrompts = corpus.prompts ?? corpus;
  const specs = QUICK_IDS.map((id) => allPrompts.find((p) => p.id === id)).filter(Boolean);
  const beforeRaw = JSON.parse(await readFile(BEFORE_PATH, "utf8"));
  const beforeById = new Map((beforeRaw.results ?? []).map((r) => [r.id, r]));

  console.log(`Quick validation: ${specs.length} prompts @ ${baseUrl} (commit ${commit.slice(0, 7)})`);
  const after = [];
  for (const spec of specs) {
    const row = await generateOne(creds, baseUrl, spec);
    const before = beforeById.get(spec.id);
    after.push({ ...row, before });
    console.log(
      `${row.id}: ${before?.verdict ?? "?"} -> ${row.verdict} | tracks ${before?.trackCount ?? "?"} -> ${row.trackCount} | HQG ${before?.humanSaveable ?? "?"} -> ${row.humanSaveable} | opener landfill ${(before?.forbiddenInFirst10 ?? []).length} -> ${row.forbiddenInFirst10.length}`,
    );
    if (row.first3?.length) console.log(`  first3: ${row.first3.join(" | ")}`);
  }

  const summary = {
    at: new Date().toISOString(),
    commit,
    baseUrl,
    promptIds: QUICK_IDS,
    before: {
      keep: after.filter((r) => r.before?.verdict === "KEEP").length,
      maybe: after.filter((r) => r.before?.verdict === "MAYBE").length,
      drop: after.filter((r) => r.before?.verdict === "DROP").length,
      hqgPass: after.filter((r) => r.before?.humanSaveable === true).length,
      landfillOpeners: after.filter((r) => (r.before?.forbiddenInFirst10 ?? []).length > 0).length,
    },
    after: {
      keep: after.filter((r) => r.verdict === "KEEP").length,
      maybe: after.filter((r) => r.verdict === "MAYBE").length,
      drop: after.filter((r) => r.verdict === "DROP").length,
      hqgPass: after.filter((r) => r.humanSaveable === true).length,
      landfillOpeners: after.filter((r) => r.forbiddenInFirst10.length > 0).length,
    },
    rows: after,
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log("\nSummary written:", OUT_PATH);
  console.log("Before:", summary.before);
  console.log("After:", summary.after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
