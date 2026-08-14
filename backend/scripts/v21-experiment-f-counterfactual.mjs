/**
 * V21 Experiment F — counterfactual equivalence proof.
 * Scores sample playlists via protected inline mapping vs canonical normalizer.
 */
import assert from "node:assert/strict";
import {
  normalizeBenchmarkTracks,
  protectedBenchmarkMapTracks,
  normalizedTracksEquivalent,
} from "./lib/benchmark-track-normalizer.mjs";

const COUNTRY = [
  { artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.6, popularity: 85 },
  { artistName: "Luke Combs", trackName: "Beautiful Crazy", energy: 0.55, popularity: 80 },
  { artistName: "Zach Bryan", trackName: "Oklahoma Smokeshow", energy: 0.5, popularity: 75 },
  { artistName: "Johnny Cash", trackName: "Jackson", energy: 0.55, popularity: 78 },
  { artistName: "Zach Bryan", trackName: "Pink Skies", energy: 0.48, popularity: 70 },
  { artistName: "Zach Bryan", trackName: "Condemned", energy: 0.45, popularity: 65 },
  { artistName: "Morgan Wallen", trackName: "Livin' The Dream", energy: 0.52, popularity: 72 },
  { artistName: "Waylon Jennings", trackName: "Mammas Don't Let Your Babies Grow up to Be Cowboys", energy: 0.5, popularity: 70 },
];

const GYM = [
  { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 88 },
  { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.85, popularity: 70 },
  { artistName: "Guns N' Roses", trackName: "Welcome To The Jungle", energy: 0.92, popularity: 80 },
];

const CHILL_API = [
  { name: "Song A", artist: "Artist One", energy: 0.7, popularity: 70, valence: 0.5, acousticness: 0.3 },
  { name: "Song B", artist: "Artist Two", energy: 0.65, popularity: 65, valence: 0.55, acousticness: 0.35 },
  { name: "Song C", artist: "Artist Three", energy: 0.72, popularity: 68, valence: 0.6, acousticness: 0.25 },
  { name: "Song D", artist: "Artist Four", energy: 0.68, popularity: 72, valence: 0.58, acousticness: 0.28 },
  { name: "Song E", artist: "Artist Five", energy: 0.75, popularity: 75, valence: 0.62, acousticness: 0.22 },
  { name: "Song F", artist: "Artist Six", energy: 0.7, popularity: 70, valence: 0.57, acousticness: 0.3 },
  { name: "Song G", artist: "Artist Seven", energy: 0.66, popularity: 66, valence: 0.54, acousticness: 0.32 },
];

function scorePair(evaluateHumanCurationScore, prompt, rawTracks) {
  const canonical = normalizeBenchmarkTracks(rawTracks);
  const protectedMap = protectedBenchmarkMapTracks(rawTracks);
  assert.ok(normalizedTracksEquivalent(canonical, protectedMap), "normalizer must match protected benchmark");

  const fixed = evaluateHumanCurationScore(prompt, canonical);
  const broken = evaluateHumanCurationScore(
    prompt,
    rawTracks.map((t) => ({ trackName: t.trackName ?? t.name })),
  );
  const protectedScore = evaluateHumanCurationScore(prompt, protectedMap);

  assert.deepEqual(
    { hcs: fixed.totalScore, dims: fixed.dimensions, save: fixed.wouldSave, share: fixed.wouldShare },
    { hcs: protectedScore.totalScore, dims: protectedScore.dimensions, save: protectedScore.wouldSave, share: protectedScore.wouldShare },
    "canonical must match protected inline mapping scores",
  );

  return { prompt, fixed, broken, protectedScore };
}

async function main() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");

  const results = [
    scorePair(evaluateHumanCurationScore, "country cowboy road trip", COUNTRY),
    scorePair(evaluateHumanCurationScore, "heavy gym workout aggressive", GYM),
    scorePair(evaluateHumanCurationScore, "cozy rainy night chill", CHILL_API),
  ];

  let pass = true;
  for (const r of results) {
    const fixedHcs = r.fixed.totalScore;
    const brokenHcs = r.broken.totalScore;
    const seqFixed = r.fixed.dimensions.sequencing.score;
    const seqBroken = r.broken.dimensions.sequencing.score;
    console.log(
      JSON.stringify({
        prompt: r.prompt,
        fixedHcs,
        brokenHcs,
        delta: fixedHcs - brokenHcs,
        seqFixed,
        seqBroken,
        save: r.fixed.wouldSave,
        share: r.fixed.wouldShare,
      }),
    );
    if (seqFixed <= 0 && r.prompt !== "heavy gym workout aggressive") pass = false;
    if (fixedHcs <= brokenHcs) pass = false;
  }

  if (!pass) {
    console.error("COUNTERFACTUAL FAIL");
    process.exit(1);
  }
  console.log("COUNTERFACTUAL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
