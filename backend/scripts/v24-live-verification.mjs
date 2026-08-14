#!/usr/bin/env node
/**
 * V24 Generator Corrective — live verification vs V23 baseline.
 *
 * Usage: node backend/scripts/v24-live-verification.mjs [--resume]
 * Output:
 *   reports/playlist-evaluation/v24-generator-corrective.json
 *   reports/playlist-evaluation/V24_GENERATOR_CORRECTIVE.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { normalizeBenchmarkTracks } from "./lib/benchmark-track-normalizer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_JSON = resolve(ROOT, "reports/playlist-evaluation/v24-generator-corrective.json");
const OUT_MD = resolve(ROOT, "reports/playlist-evaluation/V24_GENERATOR_CORRECTIVE.md");
const OUT_LOG = resolve(ROOT, "reports/playlist-evaluation/v24-live-verification.log");
const V23_BASELINE = resolve(ROOT, "reports/playlist-evaluation/v23-live-verification.json");

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DELAY_MS = 1500;
const SEED = 42;

const CASES = [
  { id: "G-030", kind: "critical", expectWorldId: "gym_energy_world", prompt: "hard techno gym", musicExpect: "techno_not_rock" },
  { id: "G-034", kind: "critical", expectWorldId: "pop_punk_world", prompt: "pop punk cardio playlist with no Blink-182", musicExpect: "pop_punk_no_blink" },
  { id: "G-016", kind: "regression", expectWorldId: "uk_garage_world", prompt: "late night uk garage drive", musicExpect: "uk_garage_world" },
  { id: "G-032", kind: "regression", expectWorldId: "pop_punk_world", prompt: "2000s pop punk gym workout", musicExpect: "pop_punk" },
  { id: "G-036", kind: "regression", expectWorldId: "pop_punk_world", prompt: "2000s pop punk gym workout with no pop music", musicExpect: "pop_punk_no_pop" },
];

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(dirname(OUT_LOG), { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function loadV23Baseline() {
  if (!existsSync(V23_BASELINE)) return {};
  const v23 = JSON.parse(readFileSync(V23_BASELINE, "utf8"));
  const out = {};
  for (const row of v23.results ?? []) {
    out[row.id] = {
      prompt: row.prompt,
      hcs: row.v22?.hcs ?? null,
      share: row.v22?.share ?? null,
      trackCount: row.v22?.trackCount ?? 0,
      worldFixed: row.worldFixed ?? false,
      musicFixed: row.musicFixed ?? false,
      verdict: row.verdict ?? null,
      artists: row.v22?.music?.artists ?? [],
      tracks: row.v22?.tracks ?? [],
      retrieval: row.v22?.retrieval ?? null,
      committedWorld: row.v22?.committedWorld ?? null,
    };
  }
  return out;
}

function extractRetrievalDiagnostics(data) {
  const gen = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const funnel = data.retrievalFunnel ?? gen.retrievalFunnel ?? null;
  const pools = v3.retrievalPoolsDetailed ?? null;
  const fallback = v3.fallback ?? gen.fallback ?? null;

  let worldPreservingFallback = null;
  const search = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 6) return;
    if (typeof obj.fallback === "string" && obj.fallback.includes("world_preserving")) {
      worldPreservingFallback = obj.fallback;
    }
    for (const v of Object.values(obj)) search(v, depth + 1);
  };
  search(gen);
  search(v3);
  search(funnel);

  return {
    retrievalFunnel: funnel,
    retrievalPoolsDetailed: pools,
    fallback,
    worldPreservingFallbackActivated: worldPreservingFallback != null,
    worldPreservingFallback,
    retrievalStrategy: gen.retrievalStrategy ?? gen.candidateRetrieval ?? pools?.strategy ?? null,
  };
}

function assessMusic(caseDef, tracks, helpers) {
  const { getCulturalProfile, scoreTrackWorldIdentity } = helpers;
  const profile = getCulturalProfile(caseDef.expectWorldId);
  const artistList = tracks.map((t) => t.artistName ?? t.artist).filter(Boolean);
  const lowerArtists = artistList.map((a) => String(a).toLowerCase());

  const rockBetrayal = ["ac/dc", "guns n' roses", "metallica", "led zeppelin", "journey"];
  const popBetrayal = ["taylor swift", "ariana grande", "dua lipa", "ed sheeran", "katy perry"];
  const hasRockBetrayal = rockBetrayal.some((r) => lowerArtists.some((a) => a.includes(r)));
  const hasPopBetrayal = popBetrayal.some((p) => lowerArtists.some((a) => a.includes(p)));
  const hasBlink = lowerArtists.some((a) => a.includes("blink-182") || a.includes("blink 182"));

  let worldScores = [];
  if (profile) {
    worldScores = tracks.map((t) =>
      scoreTrackWorldIdentity(
        {
          artistName: t.artistName ?? t.artist,
          trackName: t.trackName ?? t.name,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
        },
        profile,
      ),
    );
  }
  const meanWorldScore = worldScores.length
    ? worldScores.reduce((a, b) => a + b, 0) / worldScores.length
    : null;
  const strongBelonging = worldScores.filter((s) => s >= 0.8).length;

  let musicOk = false;
  let musicNote = "";
  switch (caseDef.musicExpect ?? caseDef.expectWorldId) {
    case "techno_not_rock":
      musicOk = !hasRockBetrayal && (strongBelonging >= Math.max(2, Math.ceil(tracks.length * 0.4)) || meanWorldScore >= 0.55);
      musicNote = hasRockBetrayal ? "Rock betrayal (AC/DC/GNR/etc)" : musicOk ? "Techno/electronic gym fit" : "Weak techno world fit";
      break;
    case "pop_punk_no_blink":
      musicOk = !hasBlink && strongBelonging >= Math.max(2, Math.ceil(tracks.length * 0.4));
      musicNote = hasBlink ? "Blink-182 present (negation violated)" : musicOk ? "Pop-punk without Blink" : "Weak pop-punk fit";
      break;
    case "pop_punk":
      musicOk = strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5)) && !hasRockBetrayal;
      musicNote = musicOk ? "Pop-punk anchors present" : "Insufficient pop-punk identity";
      break;
    case "pop_punk_no_pop":
      musicOk = strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5)) && !hasPopBetrayal;
      musicNote = hasPopBetrayal ? "Pop artist leakage" : musicOk ? "Pop-punk without pop leakage" : "Weak pop-punk fit";
      break;
    case "uk_garage_world":
      musicOk = strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5));
      musicNote = musicOk ? "UK garage identity" : "Weak UK garage fit";
      break;
    default:
      musicOk = meanWorldScore != null ? meanWorldScore >= 0.55 : tracks.length >= 5;
      musicNote = musicOk ? "Acceptable world fit" : "Weak world fit";
  }

  return { musicOk, musicNote, meanWorldScore, strongBelonging, hasRockBetrayal, hasPopBetrayal, hasBlink, artists: artistList };
}

function classifyVerdict(caseDef, v23, v24, worldFixed, musicFixed) {
  const v23MusicBad =
    (caseDef.musicExpect === "techno_not_rock" && v23?.artists?.some((a) => /ac\/dc|guns n/i.test(a))) ||
    (caseDef.musicExpect === "pop_punk_no_blink" && v23?.artists?.some((a) => /blink/i.test(a)));

  if (caseDef.kind === "regression") {
    if (v23?.musicFixed && !musicFixed) return { verdict: "REGRESSION", reason: "V23-good regression case degraded" };
    if (musicFixed && worldFixed) return { verdict: "PRESERVED", reason: "Regression case preserved" };
    return { verdict: musicFixed ? "PARTIALLY FIXED" : "NOT FIXED", reason: "Regression case mixed" };
  }

  if (worldFixed && musicFixed) return { verdict: "FIXED", reason: "World and music both corrected vs V23" };
  if (worldFixed && !musicFixed) return { verdict: "PARTIALLY FIXED", reason: "World ok; music still wrong" };
  if (!v23MusicBad && !musicFixed) return { verdict: "NOT FIXED", reason: "No improvement vs V23" };
  if (musicFixed && !v23?.musicFixed) return { verdict: "FIXED", reason: "Music corrected vs V23 failure" };
  return { verdict: "PARTIALLY FIXED", reason: "Mixed vs V23" };
}

function renderMarkdown(payload) {
  const lines = [];
  lines.push("# V24 Generator Corrective Experiment");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Commit: \`${payload.commit}\``);
  lines.push(`Base URL: ${payload.baseUrl}`);
  lines.push(`Baseline: v23-live-verification.json`);
  lines.push("");
  lines.push("## Verdict table");
  lines.push("");
  lines.push("| Case | V23 music | V24 music | World | Verdict |");
  lines.push("|------|-----------|-----------|-------|---------|");
  for (const r of payload.results) {
    lines.push(
      `| ${r.id} | ${r.v23?.musicFixed ? "OK" : "FAIL"} (${r.v23?.trackCount ?? 0} tracks) | ${r.musicFixed ? "OK" : "FAIL"} (${r.v24?.trackCount ?? 0}) | ${r.worldFixed ? "OK" : "FAIL"} | **${r.verdict}** |`,
    );
  }
  lines.push("");
  lines.push("## Root causes addressed");
  lines.push("");
  for (const rc of payload.rootCauses) lines.push(`- ${rc}`);
  lines.push("");
  lines.push("## Files changed");
  lines.push("");
  for (const f of payload.filesChanged) lines.push(`- \`${f}\``);
  lines.push("");
  lines.push("## Human listen recommendation");
  lines.push("");
  lines.push(payload.humanListenRecommendation);
  lines.push("");
  for (const r of payload.results) {
    lines.push(`### ${r.id} — ${r.prompt}`);
    lines.push("");
    lines.push(`- **V23 note:** ${r.v23?.music?.musicNote ?? r.v23?.tracks?.slice(0, 5).map((t) => t.artist).join(", ") ?? "—"}`);
    lines.push(`- **V24 note:** ${r.v24?.music?.musicNote ?? "—"}`);
    lines.push(`- **Retrieval fallback:** ${typeof (r.v24?.retrieval?.worldPreservingFallback ?? r.v24?.retrieval?.fallback) === "string" ? (r.v24?.retrieval?.worldPreservingFallback ?? r.v24?.retrieval?.fallback) : JSON.stringify(r.v24?.retrieval?.fallback ?? r.v24?.retrieval?.worldPreservingFallback ?? "—")}`);
    lines.push(`- **Verdict:** ${r.verdict} — ${r.verdictReason}`);
    lines.push("");
    if (r.v24?.tracks?.length) {
      lines.push("<details><summary>V24 tracklist</summary>");
      lines.push("");
      for (const [i, t] of r.v24.tracks.entries()) lines.push(`${i + 1}. ${t.artist} — ${t.track}`);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }
  if (payload.blockers?.length) {
    lines.push("## Blockers");
    lines.push("");
    for (const b of payload.blockers) lines.push(`- ${b}`);
  }
  return lines.join("\n");
}

async function generateOne(creds, prompt, requestId) {
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
        spotifyUserId: creds.spotifyUserId,
        requestId,
        seed: SEED,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const resume = process.argv.includes("--resume");
  mkdirSync(dirname(OUT_JSON), { recursive: true });

  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");
  const { getCulturalProfile } = await import("../dist/core/editorial/cultural-identity-profile.js");
  const { scoreTrackWorldIdentity } = await import("../dist/core/editorial/world-identity-score.js");

  const creds = await resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
  });

  const v23Baseline = loadV23Baseline();
  let existing = { results: [], blockers: [] };
  if (resume && existsSync(OUT_JSON)) {
    existing = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    log(`Resuming — ${existing.results?.length ?? 0} cases done`);
  }

  const doneIds = new Set((existing.results ?? []).map((r) => r.id));
  const results = [...(existing.results ?? [])];
  const blockers = [...(existing.blockers ?? [])];

  log(`V24 live verification starting commit=${getHeadCommit()} baseUrl=${creds.baseUrl}`);

  try {
    const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
      headers: { "x-kwalify-evaluation-token": creds.token },
    });
    if (!ping.ok) blockers.push(`eval/ping returned ${ping.status}`);
  } catch (err) {
    blockers.push(`API unreachable at ${creds.baseUrl}: ${err.message}`);
    log(`BLOCKER: ${blockers[blockers.length - 1]}`);
  }

  for (const caseDef of CASES) {
    if (doneIds.has(caseDef.id)) continue;
    log(`[${caseDef.id}] generating: ${caseDef.prompt}`);

    const row = {
      id: caseDef.id,
      kind: caseDef.kind,
      prompt: caseDef.prompt,
      expectWorldId: caseDef.expectWorldId,
      v23: v23Baseline[caseDef.id] ?? null,
      v24: null,
      worldFixed: false,
      musicFixed: false,
      verdict: "NOT FIXED",
      verdictReason: "",
      success: false,
      error: null,
    };

    try {
      const t0 = Date.now();
      const { httpStatus, data } = await generateOne(creds, caseDef.prompt, `v24-${caseDef.id}`);
      const rawTracks = data.tracks ?? data.playlist ?? [];
      const normalized = normalizeBenchmarkTracks(rawTracks);
      const score = evaluateHumanCurationScore(caseDef.prompt, normalized);
      const committedWorld = {
        resolved: resolveCommittedWorld({ prompt: caseDef.prompt }),
      };
      const retrieval = extractRetrievalDiagnostics(data);
      const music = assessMusic(caseDef, normalized, { getCulturalProfile, scoreTrackWorldIdentity });

      row.worldFixed = committedWorld.resolved?.id === caseDef.expectWorldId;
      row.musicFixed = music.musicOk;
      row.success = httpStatus === 200 && rawTracks.length > 0;

      row.v24 = {
        httpStatus,
        durationMs: Date.now() - t0,
        trackCount: rawTracks.length,
        hcs: score.totalScore,
        share: score.wouldShare,
        committedWorld,
        retrieval,
        music,
        tracks: normalized.map((t) => ({ artist: t.artistName, track: t.trackName })),
      };

      const { verdict, reason } = classifyVerdict(caseDef, row.v23, row.v24, row.worldFixed, row.musicFixed);
      row.verdict = verdict;
      row.verdictReason = reason;
      log(`  done ${row.v24.durationMs}ms tracks=${rawTracks.length} verdict=${verdict}`);
    } catch (err) {
      row.error = String(err?.message ?? err);
      row.verdictReason = row.error;
      log(`  ERROR: ${row.error}`);
    }

    results.push(row);
    doneIds.add(caseDef.id);
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          experiment: "v24-generator-corrective",
          commit: getHeadCommit(),
          baseUrl: creds.baseUrl,
          seed: SEED,
          results,
          blockers,
        },
        null,
        2,
      ),
      "utf8",
    );
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const criticalFixed = results.filter((r) => r.kind === "critical").every((r) => r.verdict === "FIXED");
  const regressions = results.filter((r) => r.verdict === "REGRESSION");

  const payload = {
    generatedAt: new Date().toISOString(),
    experiment: "v24-generator-corrective",
    commit: getHeadCommit(),
    baseUrl: creds.baseUrl,
    seed: SEED,
    baseline: "v23-live-verification.json",
    generationSucceeded: results.every((r) => r.success),
    results,
    blockers,
    rootCauses: [
      "gym_rock_world leaked into retrieval world ids alongside gym_energy_world for gym prompts",
      "activity_ranked_full_library fallback substituted rock gym pool when world-preserving pool was thin",
      "gym_energy_world lacked cultural profile — world scoring could not reject classic rock",
      "no <artist> exclusions were not enforced in retrieval prefilter or thesis opener promotion",
    ],
    filesChanged: [
      "backend/lib/prompt-negation-enforcement.ts",
      "backend/lib/candidate-retrieval-pipeline.ts",
      "backend/core/committed-world.ts",
      "backend/core/editorial/cultural-identity-profile.ts",
      "backend/core/editorial/world-identity-gate.ts",
      "backend/core/editorial/thesis-opener-gate.ts",
      "backend/core/v3/v3-pipeline.ts",
      "backend/controllers/generation.controller.ts",
      "backend/tests/v24-generator-corrective.test.ts",
    ],
    humanListenRecommendation: criticalFixed && regressions.length === 0
      ? "Both critical cases (G-030, G-034) fixed with no regressions — proceed to human listening on G-030, G-034, G-016."
      : regressions.length > 0
        ? "Regressions detected — fix before human listening."
        : "Critical cases not fully fixed — inspect remaining failures before human listening.",
    conclusion: {
      criticalFixed,
      regressions: regressions.map((r) => r.id),
      g030Fixed: results.find((r) => r.id === "G-030")?.musicFixed ?? false,
      g034Fixed: results.find((r) => r.id === "G-034")?.musicFixed ?? false,
    },
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMarkdown(payload), "utf8");
  log(`Complete → ${OUT_JSON}`);
  console.log(JSON.stringify(payload.conclusion, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
