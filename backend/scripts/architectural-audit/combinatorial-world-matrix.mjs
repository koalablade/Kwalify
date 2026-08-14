#!/usr/bin/env node
/**
 * Combinatorial world matrix v2 — expands dimensions + PlaylistContract completeness.
 * Run from repo root: npm run build && node backend/scripts/architectural-audit/combinatorial-world-matrix.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const require = createRequire(join(repoRoot, "backend", "package.json"));

const distCore = join(repoRoot, "backend", "dist", "core");
const distContract = join(distCore, "playlist-contract");

let resolveCommittedWorld, decomposeIntent, buildIntentState, buildPlaylistContract, compareContractWithWorld, assessCollapseRisk;

try {
  ({ resolveCommittedWorld } = require(join(distCore, "committed-world.js")));
  ({ decomposeIntent } = require(join(distCore, "intent-decomposer.js")));
  ({ buildIntentState } = require(join(distCore, "intent-state-engine.js")));
  ({ buildPlaylistContract } = require(join(distContract, "build-playlist-contract.js")));
  ({ compareContractWithWorld, assessCollapseRisk } = require(join(distContract, "compare-with-world.js")));
} catch (e) {
  console.error("Build required: npm run build (dist/core not found)");
  console.error(e.message);
  process.exit(1);
}

const MOODS = ["melancholy", "energetic", "chilled", "nostalgic", "dark"];
const ACTIVITIES = ["gym", "drive", "study", "party", "cooking"];
const ERAS = ["70s", "80s", "90s", "2000s", null];
const GENRES = ["indie", "techno", "soul", "reggae", "country", null];
const NEGATIONS = [null, "no rap", "no christmas", "not cheesy"];
const SCENES = [null, "night drive", "rainy motorway", "BBQ"];
const TENSIONS = [null, "but not cheesy", "but not boring", "sad but party"];

function synthesizePrompt(mood, activity, era, genre, negation, scene, tension) {
  const parts = [];
  if (era) parts.push(`${era}`);
  if (genre) parts.push(genre);
  if (mood) parts.push(mood);
  if (scene) parts.push(scene);
  else if (activity) parts.push(activity === "drive" ? "night drive" : activity);
  if (negation) parts.push(negation);
  if (tension && !negation) parts.push(tension);
  return parts.join(" ").trim() || "music";
}

function contractCompleteness(contract) {
  let filled = 0;
  let total = 7;
  if (contract.must.genres.length) filled++;
  if (contract.must.eras.length) filled++;
  if (contract.must.activities.length) filled++;
  if (contract.prefer.moods.length) filled++;
  if (contract.prefer.energy.length) filled++;
  if (contract.mustNot.length) filled++;
  if (contract.worldHypothesis.id) filled++;
  return Math.round((filled / total) * 100) / 100;
}

const SAMPLES = [];
for (const mood of MOODS) {
  for (const activity of ACTIVITIES.slice(0, 3)) {
    for (const era of [null, "90s"]) {
      for (const genre of [null, "indie"]) {
        for (const scene of [null]) {
          SAMPLES.push(synthesizePrompt(mood, activity, era, genre, null, scene, null));
        }
      }
    }
  }
}

for (const neg of NEGATIONS.filter(Boolean)) {
  SAMPLES.push(synthesizePrompt("energetic", "party", "2000s", "pop", neg, null, null));
}

for (const tension of TENSIONS.filter(Boolean)) {
  SAMPLES.push(synthesizePrompt("chilled", "study", null, null, null, null, tension));
}

const CATASTROPHIC = [
  "2000s pop punk gym workout",
  "sad party bangers",
  "energetic but not cheesy",
  "chilled but not boring",
  "UK grime workout",
  "indie gym pump up",
  "hard techno gym",
  "lo-fi study focus",
  "morning coffee jazz",
  "drum and bass night drive",
  "something nostalgic for driving",
  "rainy motorway night drive",
];

const allPrompts = [...new Set([...SAMPLES, ...CATASTROPHIC])];

const rows = allPrompts.map((prompt) => {
  const world = resolveCommittedWorld({ prompt, vibe: prompt });
  const decomposed = decomposeIntent(prompt);
  const intentState = buildIntentState(prompt, null);
  const contract = buildPlaylistContract({ prompt, committedWorld: world, decomposedIntent: decomposed, intentState });
  const disagreements = compareContractWithWorld(contract, world);
  const collapseRisk = assessCollapseRisk(contract, disagreements);
  const completeness = contractCompleteness(contract);

  const legacyCollapseRisk =
    !world && decomposed.unknownTokens.length > 2
      ? "no_world_many_unknowns"
      : world?.hardLock && decomposed.exclusions.length > 0
        ? "hard_lock_with_negation"
        : world?.activityContext && world?.musicalWorldId && world.activityContext !== world.musicalWorldId
          ? "musical_activity_tension"
          : decomposed.unknownTokens.length > 0
            ? "partial_parse"
            : "ok";

  return {
    prompt,
    committedWorld: world
      ? {
          id: world.id,
          hardLock: world.hardLock,
          source: world.source,
          confidence: world.confidence,
          musicalWorldId: world.musicalWorldId,
          activityContext: world.activityContext,
        }
      : null,
    contract: {
      completeness,
      confidence: contract.confidence.overall,
      mustGenres: contract.must.genres.map((g) => g.value),
      mustNot: contract.mustNot.map((n) => n.value),
      tensions: contract.tension.map((t) => t.description),
      unknownTokens: contract.unknown.tokens.slice(0, 6),
      worldHypothesis: contract.worldHypothesis.id,
    },
    disagreements: disagreements.map((d) => ({ kind: d.kind, severity: d.severity })),
    collapseRisk,
    legacyCollapseRisk,
    contractRicherThanWorld: completeness > 0.4 && (!world || disagreements.length > 0),
  };
});

const stats = {
  total: rows.length,
  nullWorld: rows.filter((r) => !r.committedWorld).length,
  hardLock: rows.filter((r) => r.committedWorld?.hardLock).length,
  avgContractCompleteness: rows.reduce((s, r) => s + r.contract.completeness, 0) / rows.length,
  withTension: rows.filter((r) => r.contract.tensions.length > 0).length,
  withDisagreements: rows.filter((r) => r.disagreements.length > 0).length,
  contractRicherThanWorld: rows.filter((r) => r.contractRicherThanWorld).length,
  collapseRiskCounts: {},
  disagreementKindCounts: {},
  uniqueWorldIds: [...new Set(rows.map((r) => r.committedWorld?.id).filter(Boolean))],
};

for (const r of rows) {
  stats.collapseRiskCounts[r.collapseRisk] = (stats.collapseRiskCounts[r.collapseRisk] ?? 0) + 1;
  for (const d of r.disagreements) {
    stats.disagreementKindCounts[d.kind] = (stats.disagreementKindCounts[d.kind] ?? 0) + 1;
  }
}

const outDir = join(repoRoot, "reports", "playlist-evaluation");
mkdirSync(outDir, { recursive: true });

const v1Path = join(outDir, "combinatorial-world-matrix.json");
const v2Path = join(outDir, "combinatorial-world-matrix-v2.json");

writeFileSync(v1Path, JSON.stringify({ generatedAt: new Date().toISOString(), stats: { ...stats, version: "v1-compat" }, rows }, null, 2));
writeFileSync(v2Path, JSON.stringify({ generatedAt: new Date().toISOString(), version: "v2", dimensions: { moods: MOODS.length, activities: ACTIVITIES.length, eras: ERAS.length, genres: GENRES.length, negations: NEGATIONS.length, scenes: SCENES.length, tensions: TENSIONS.length }, stats, rows }, null, 2));

console.log("Combinatorial world matrix v2 written:", v2Path);
console.log(JSON.stringify(stats, null, 2));
