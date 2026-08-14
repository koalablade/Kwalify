#!/usr/bin/env node
/**
 * V22 Controlled Corrective Experiment — rescore V21 tracklists with V22 evaluator/world resolution.
 * Does NOT regenerate playlists unless --regen flag and API available.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation/v22-controlled-corrective");
const BASELINE_PATH = resolve(OUT_DIR, "v21-baseline-snapshot.json");
const BENCH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const G_REVIEW = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-set.json");
const G_LISTEN = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-listen-scores.json");

const CRITICAL = ["G-016", "G-030", "G-032", "G-036"];
const REGRESSION = ["G-023", "G-027"];
const TEMPLATE_ARTISTS = ["jungle giants", "wallows", "the 1975"];

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function normalizeTracks(tracklist) {
  return (tracklist ?? []).map((t) => ({
    artistName: t.artistName ?? t.artist ?? "?",
    trackName: t.trackName ?? t.name ?? "?",
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    popularity: typeof t.popularity === "number" ? t.popularity : null,
    acousticness: typeof t.acousticness === "number" ? t.acousticness : null,
  }));
}

function summarizeScored(rows) {
  const hcs = rows.map((r) => r.hcs).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const count = (field, val) => rows.filter((r) => r[field] === val).length;
  return {
    n: rows.length,
    hcsMean: hcs.length ? Math.round((hcs.reduce((a, b) => a + b, 0) / hcs.length) * 10) / 10 : null,
    hcsMedian: percentile(hcs, 50),
    saveYes: count("wouldSave", "YES"),
    shareYes: count("wouldShare", "YES"),
    shareMaybe: count("wouldShare", "MAYBE"),
    shareNo: count("wouldShare", "NO"),
    avgCohesion:
      rows.length > 0
        ? Math.round((rows.reduce((s, r) => s + (r.cohesion ?? 0), 0) / rows.length) * 10) / 10
        : null,
  };
}

function templateRecurrenceFromTracklists(tracklists) {
  const counts = Object.fromEntries(TEMPLATE_ARTISTS.map((a) => [a, 0]));
  let playlistsWithNucleus = 0;
  for (const pl of tracklists) {
    let has = false;
    for (const t of pl.tracklist ?? pl.tracks ?? []) {
      const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
      for (const a of TEMPLATE_ARTISTS) {
        if (artist.includes(a)) {
          counts[a] += 1;
          has = true;
        }
      }
    }
    if (has) playlistsWithNucleus += 1;
  }
  return { artistCounts: counts, playlistsWithNucleus, playlistCount: tracklists.length };
}

function scorePlaylist({ resolveCommittedWorld, getCulturalProfileForCommitted, evaluateHumanCurationScore, resolveCulturalProfileForCommitted }) {
  return function rescore(prompt, tracklist) {
    const tracks = normalizeTracks(tracklist);
    const committed = resolveCommittedWorld({ prompt });
    const profile = resolveCulturalProfileForCommitted(committed);
    const evalResult = evaluateHumanCurationScore(prompt, tracks);
    return {
      prompt,
      committedWorld: committed
        ? {
            id: committed.id,
            musicalWorldId: committed.musicalWorldId ?? null,
            activityWorldId: committed.activityWorldId ?? null,
            activityContext: committed.activityContext ?? null,
            source: committed.source,
            hardLock: committed.hardLock,
            reason: committed.reason,
          }
        : null,
      culturalProfile: profile?.worldId ?? getCulturalProfileForCommitted(committed)?.worldId ?? null,
      hcs: evalResult.totalScore,
      wouldSave: evalResult.wouldSave,
      wouldShare: evalResult.wouldShare,
      cohesion: evalResult.dimensions.cohesion.score,
      cohesionEvidence: evalResult.dimensions.cohesion.evidence,
      moment: evalResult.dimensions.momentUnderstanding.score,
      sequencing: evalResult.dimensions.sequencing.score,
      plausibility: evalResult.dimensions.humanPlausibility.score,
    };
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const {
    resolveCommittedWorld,
    getCulturalProfileForCommitted,
    hasExplicitMusicalHardLock,
  } = await import("../dist/core/committed-world.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { resolveCulturalProfileForCommitted } = await import("../dist/core/editorial/world-identity-score.js");

  const rescore = scorePlaylist({
    resolveCommittedWorld,
    getCulturalProfileForCommitted,
    evaluateHumanCurationScore,
    resolveCulturalProfileForCommitted,
  });

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
  const gReview = existsSync(G_REVIEW) ? JSON.parse(readFileSync(G_REVIEW, "utf8")) : null;
  const gListen = existsSync(G_LISTEN) ? JSON.parse(readFileSync(G_LISTEN, "utf8")) : null;
  const bench = existsSync(BENCH) ? JSON.parse(readFileSync(BENCH, "utf8")) : null;

  const criticalResults = {};
  for (const id of [...CRITICAL, ...REGRESSION]) {
    const pl = gReview?.playlists?.find((p) => p.reviewId === id);
    if (!pl) continue;
    const v22 = rescore(pl.prompt, pl.tracklist);
    const v21 = baseline?.criticalCases?.[id]?.stored ?? pl._evaluator ?? null;
    criticalResults[id] = { v21, v22, prompt: pl.prompt };
  }

  const gRescored = [];
  if (gReview?.playlists) {
    for (const pl of gReview.playlists) {
      gRescored.push({ reviewId: pl.reviewId, ...rescore(pl.prompt, pl.tracklist) });
    }
  }

  const benchRescored = [];
  if (bench?.rows) {
    for (const row of bench.rows) {
      if (!row.success || !row.tracks?.length) continue;
      benchRescored.push({
        id: row.id,
        prompt: row.prompt,
        ...rescore(row.prompt, row.tracks),
      });
    }
  }

  const worldResolutionChecks = [
    { id: "G-016", prompt: "late night uk garage drive", expectId: "uk_garage_world" },
    { id: "G-030", prompt: "hard techno gym", expectId: "gym_energy_world" },
    { id: "G-032", prompt: "2000s pop punk gym workout", expectId: "pop_punk_world" },
    { id: "G-036", prompt: "2000s pop punk gym workout with no pop music", expectId: "pop_punk_world" },
    { id: "G-023", prompt: "rain on the windscreen empty motorway at midnight", expectId: "rainy_motorway_world" },
    { id: "G-027", prompt: "dad rock BBQ with beers", expectId: "dad_rock_world" },
  ].map((row) => {
    const w = resolveCommittedWorld({ prompt: row.prompt });
    const profile = getCulturalProfileForCommitted(w);
    return {
      ...row,
      resolvedId: w?.id ?? null,
      musicalWorldId: w?.musicalWorldId ?? null,
      activityContext: w?.activityContext ?? null,
      hasProfile: profile != null,
      explicitMusicalLock: hasExplicitMusicalHardLock(w),
      pass: w?.id === row.expectId,
    };
  });

  const v22Summary = {
    gCases: summarizeScored(gRescored),
    experimentF: summarizeScored(benchRescored),
  };

  const limitations = [
    "V22 rescores frozen V21 tracklists — playlist content unchanged unless live regen run separately.",
    "Retrieval/world-preserving fallback effects require live generation to observe in tracklists.",
    "Template artist recurrence measured on unchanged V21 tracklists (world resolution + cohesion rescoring only).",
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    experiment: "v22-controlled-corrective",
    commit: getHeadCommit(),
    method: "rescore_v21_tracklists",
    limitations,
    baselineRef: "reports/playlist-evaluation/v22-controlled-corrective/v21-baseline-snapshot.json",
    v21BenchmarkSummary: baseline?.v21Benchmark?.summary ?? null,
    v22Summary,
    worldResolutionChecks,
    criticalResults,
    templateRecurrence: {
      v21: baseline?.templateRecurrence ?? null,
      v22RescoreSameTracklists: templateRecurrenceFromTracklists(gReview?.playlists ?? []),
      note: "Tracklists unchanged — artist recurrence identical until live regen",
    },
    profileCoverage: {
      uk_garage_world: Boolean(getCulturalProfileForCommitted(resolveCommittedWorld({ prompt: "uk garage drive" }))),
      pop_punk_world: Boolean(getCulturalProfileForCommitted(resolveCommittedWorld({ prompt: "pop punk workout" }))),
    },
    gListenHumanScores: gListen?.scores?.length ?? 0,
  };

  writeFileSync(resolve(OUT_DIR, "v22-rescore-results.json"), JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(
    resolve(ROOT, "reports/playlist-evaluation/v22-controlled-corrective-experiment.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );

  console.log("V22 rescore complete");
  console.log(JSON.stringify({ v22Summary, worldResolutionChecks, criticalResults }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
