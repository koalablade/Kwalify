/**
 * Validate a candidate playlist genome against the committed one, honestly.
 *
 * The committed offline quality gate does NOT consult the genome (replay-based),
 * so it cannot validate a refit. This script measures the genome's actual job:
 * discriminating a coherent ordering from a degraded (shuffled) one, and reports
 * the concrete distribution deltas. It adopts nothing — it only produces evidence.
 *
 *   node scripts/validate-genome-refit.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { scoreFeaturesAgainstGenome } = require(path.join(REPO, "backend/dist/core/editorial/playlist-genome.js"));
const { computeHumanPlaylistFeatures } = require(path.join(REPO, "backend/dist/core/editorial/human-playlist-patterns.js"));

function load(p) {
  return JSON.parse(readFileSync(path.join(REPO, p), "utf8"));
}

function shuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function discrimination(genome, corpus) {
  let wins = 0;
  let total = 0;
  let realSum = 0;
  let shufSum = 0;
  for (const pl of corpus) {
    const tracks = pl.tracks ?? [];
    if (tracks.length < 10) continue;
    const real = scoreFeaturesAgainstGenome(computeHumanPlaylistFeatures(tracks), genome).score;
    let shufScores = [];
    for (let k = 0; k < 5; k++) {
      shufScores.push(scoreFeaturesAgainstGenome(computeHumanPlaylistFeatures(shuffle(tracks, k * 7 + 3)), genome).score);
    }
    const meanShuf = shufScores.reduce((s, x) => s + x, 0) / shufScores.length;
    realSum += real;
    shufSum += meanShuf;
    if (real > meanShuf) wins += 1;
    total += 1;
  }
  return {
    playlists: total,
    realOrderWinRate: total ? wins / total : 0,
    avgRealScore: total ? realSum / total : 0,
    avgShuffledScore: total ? shufSum / total : 0,
  };
}

function main() {
  const committed = load("backend/data/playlist-genome.json");
  const candidate = load("backend/data/playlist-genome.candidate.json");
  // Test corpus = the enriched (feature-complete) candidate corpus. Note: the
  // committed genome was NOT fit on this corpus, so this is not a home-field test
  // for the candidate; it measures grip given real features.
  const corpus = load("data/corpus/human-playlists.candidate.json");

  const c = discrimination(committed, corpus);
  const n = discrimination(candidate, corpus);

  const round = (x) => Math.round(x * 1000) / 1000;
  const pct = (x) => `${Math.round(x * 100)}%`;

  console.log("\n=== Genome refit validation (shuffle discrimination) ===");
  console.log(`Test corpus: ${corpus.length} feature-complete pseudo-playlists\n`);
  console.log("                         committed        candidate");
  console.log(`real-order win rate      ${pct(c.realOrderWinRate).padEnd(16)} ${pct(n.realOrderWinRate)}`);
  console.log(`avg real score           ${round(c.avgRealScore).toString().padEnd(16)} ${round(n.avgRealScore)}`);
  console.log(`avg shuffled score       ${round(c.avgShuffledScore).toString().padEnd(16)} ${round(n.avgShuffledScore)}`);
  console.log(`real−shuffle separation  ${round(c.avgRealScore - c.avgShuffledScore).toString().padEnd(16)} ${round(n.avgRealScore - n.avgShuffledScore)}`);

  console.log("\n=== energyArcMix ===");
  console.log("committed:", JSON.stringify(committed.energyArcMix));
  console.log("candidate:", JSON.stringify(candidate.energyArcMix));

  const eDist = (g) => g.distributions?.avgEnergyJump ?? {};
  console.log("\n=== avgEnergyJump distribution (p10/p50/p90) ===");
  const c2 = eDist(committed);
  const n2 = eDist(candidate);
  console.log(`committed: ${round(c2.p10)}/${round(c2.p50)}/${round(c2.p90)}`);
  console.log(`candidate: ${round(n2.p10)}/${round(n2.p50)}/${round(n2.p90)}`);
  console.log("");
}

main();
