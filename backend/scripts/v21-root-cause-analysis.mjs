/**
 * V21 root-cause analysis — read-only counterfactual on benchmark artifact.
 * Does NOT modify production code.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BENCH = resolve(ROOT, "reports/playlist-evaluation/v20-large-real-benchmark.json");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v21-root-cause-analysis.json");

function mapTrack(t) {
  return {
    trackName: t.trackName ?? t.name,
    artistName: t.artistName ?? t.artist,
    energy: t.energy ?? null,
    popularity: t.popularity ?? null,
    valence: t.valence ?? null,
    acousticness: t.acousticness ?? null,
  };
}

function stats(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const p = (q) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  return {
    n: s.length,
    mean: s.length ? Math.round((sum / s.length) * 10) / 10 : null,
    median: p(0.5),
    p10: p(0.1),
    p90: p(0.9),
    min: s[0],
    max: s[s.length - 1],
  };
}

function hcsBand(h) {
  if (h <= 55) return "A_<=";
  if (h <= 60) return "B_56-60";
  if (h <= 65) return "C_61-65";
  if (h <= 70) return "D_66-70";
  return "E_71+";
}

function promptSpecificity(prompt) {
  const p = prompt.toLowerCase();
  let score = 0;
  if (/\b(?:no |without |non-)\w/.test(p)) score += 2;
  if (/\b(?:80s|90s|70s|madchester|grunge|country|disco|gym|motorway)\b/.test(p)) score += 2;
  if (/\b(?:rap|metal|christmas|ballad)\b/.test(p)) score += 1;
  if (p.split(/\s+/).length >= 6) score += 1;
  if (score >= 4) return "hard_lock_like";
  if (score >= 2) return "specific";
  return "vague";
}

async function main() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");
  const { inferHumanCurationActivity } = await import("../dist/core/editorial/human-curation-sequencer.js");

  const data = JSON.parse(readFileSync(BENCH, "utf8"));
  const rows = data.rows;

  const instrumentation = {
    missingArtistMetadata: rows.filter((r) => r.opener === "? — ?" || (r.artists?.length ?? 0) === 0).length,
    sequencingZero: rows.filter((r) => r.dimensions?.sequencing?.score === 0).length,
    undefinedTransitionEvidence: rows.filter((r) =>
      (r.sequencingEvidence ?? []).some((e) => e.includes("undefined")),
    ).length,
    duplicateTracksFromEmptyKeys: rows.filter((r) => r.duplicateTracks > 0 && (r.artists?.length ?? 0) === 0).length,
  };

  const ok = rows.filter((r) => r.success && r.trackCount > 0 && r.dimensions);
  const dims = [
    "momentUnderstanding",
    "cohesion",
    "sequencing",
    "humanPlausibility",
    "variety",
    "canonicalAnchors",
    "interestingChoices",
  ];
  const dimStats = {};
  for (const d of dims) dimStats[d] = stats(ok.map((r) => r.dimensions[d].score));

  const bands = {};
  for (const r of ok) {
    const b = hcsBand(r.hcs);
    bands[b] = (bands[b] ?? 0) + 1;
  }

  const specificity = { hard_lock_like: [], specific: [], vague: [] };
  for (const r of ok) {
    specificity[promptSpecificity(r.prompt)].push(r.hcs);
  }
  const specificityStats = Object.fromEntries(
    Object.entries(specificity).map(([k, v]) => [k, stats(v)]),
  );

  const activityProfile = { withActivity: [], noActivity: [] };
  for (const r of ok) {
    const act = inferHumanCurationActivity(r.prompt);
    (act ? activityProfile.withActivity : activityProfile.noActivity).push(r.hcs);
  }

  const committedProfile = { hardWorld: [], noWorld: [] };
  for (const r of ok) {
    const cw = resolveCommittedWorld({ prompt: r.prompt });
    (cw?.worldId ? committedProfile.hardWorld : committedProfile.noWorld).push(r.hcs);
  }

  const failures422 = rows.filter((r) => r.httpStatus === 422);
  const stubs = ok.filter((r) => r.deliveryTier === "STUB");

  const worst50 = [...ok].sort((a, b) => a.hcs - b.hcs).slice(0, 50);
  const best50 = [...ok].sort((a, b) => b.hcs - a.hcs).slice(0, 50);

  // Protected 8 offline (from v19-e log tracklists with mapping)
  const protectedPrompts = [
    {
      id: "country",
      prompt: "country cowboy road trip",
      tracks: [
        { artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.6, popularity: 85 },
        { artistName: "Luke Combs", trackName: "Beautiful Crazy", energy: 0.55, popularity: 80 },
        { artistName: "Zach Bryan", trackName: "Oklahoma Smokeshow", energy: 0.5, popularity: 75 },
        { artistName: "Johnny Cash", trackName: "Jackson", energy: 0.55, popularity: 78 },
        { artistName: "Zach Bryan", trackName: "Pink Skies", energy: 0.48, popularity: 70 },
        { artistName: "Zach Bryan", trackName: "Condemned", energy: 0.45, popularity: 65 },
        { artistName: "Morgan Wallen", trackName: "Livin' The Dream", energy: 0.52, popularity: 72 },
        { artistName: "Waylon Jennings", trackName: "Mammas Don't Let Your Babies Grow up to Be Cowboys", energy: 0.5, popularity: 70 },
      ],
    },
    {
      id: "gym",
      prompt: "heavy gym workout aggressive",
      tracks: [
        { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 88 },
        { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.85, popularity: 70 },
        { artistName: "Guns N' Roses", trackName: "Welcome To The Jungle", energy: 0.92, popularity: 80 },
      ],
    },
  ];

  const protectedCompare = protectedPrompts.map((pl) => {
    const fixed = evaluateHumanCurationScore(pl.prompt, pl.tracks);
    const broken = evaluateHumanCurationScore(
      pl.prompt,
      pl.tracks.map((t) => ({ trackName: t.trackName })),
    );
    return { id: pl.id, fixed: fixed.totalScore, broken: broken.totalScore, fixedSeq: fixed.dimensions.sequencing.score, brokenSeq: broken.dimensions.sequencing.score };
  });

  // Simulate broken API shape on synthetic diverse playlist
  const synthetic = [
    { name: "Song A", artist: "Artist One", energy: 0.7, popularity: 70 },
    { name: "Song B", artist: "Artist Two", energy: 0.65, popularity: 65 },
    { name: "Song C", artist: "Artist Three", energy: 0.72, popularity: 68 },
    { name: "Song D", artist: "Artist Four", energy: 0.68, popularity: 72 },
    { name: "Song E", artist: "Artist Five", energy: 0.75, popularity: 75 },
    { name: "Song F", artist: "Artist Six", energy: 0.7, popularity: 70 },
    { name: "Song G", artist: "Artist Seven", energy: 0.66, popularity: 66 },
  ];
  const synthPrompt = "cozy rainy night chill";
  const synthFixed = evaluateHumanCurationScore(synthPrompt, synthetic.map(mapTrack));
  const synthBroken = evaluateHumanCurationScore(synthPrompt, synthetic);

  const payload = {
    generatedAt: new Date().toISOString(),
    instrumentation,
    dimStats,
    bands,
    specificityStats,
    activityProfile: {
      withActivity: stats(activityProfile.withActivity),
      noActivity: stats(activityProfile.noActivity),
    },
    committedProfile: {
      hardWorld: stats(committedProfile.hardWorld),
      noWorld: stats(committedProfile.noWorld),
    },
    failures422: failures422.map((r) => ({ id: r.id, prompt: r.prompt, httpStatus: r.httpStatus, trackCount: r.trackCount })),
    stubs: stubs.map((r) => ({ id: r.id, prompt: r.prompt, trackCount: r.trackCount, hcs: r.hcs, tier: r.deliveryTier })),
    protectedCompare,
    syntheticCounterfactual: {
      prompt: synthPrompt,
      fixedHcs: synthFixed.totalScore,
      brokenHcs: synthBroken.totalScore,
      fixedSeq: synthFixed.dimensions.sequencing.score,
      brokenSeq: synthBroken.dimensions.sequencing.score,
    },
    worst50Sample: worst50.slice(0, 10).map((r) => ({
      prompt: r.prompt,
      hcs: r.hcs,
      tier: r.deliveryTier,
      pressPlay: r.pressPlay,
      seq: r.dimensions.sequencing.score,
      cohesionEvidence: r.dimensions.cohesion.evidence,
    })),
    best50Sample: best50.slice(0, 10).map((r) => ({
      prompt: r.prompt,
      hcs: r.hcs,
      tracks: r.trackCount,
      tier: r.deliveryTier,
      seq: r.dimensions.sequencing.score,
    })),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
