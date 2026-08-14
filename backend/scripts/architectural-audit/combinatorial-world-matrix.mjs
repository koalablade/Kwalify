#!/usr/bin/env node
/**
 * READ-ONLY combinatorial prompt matrix — traces resolveCommittedWorld + intent decomposition
 * without modifying production. Run from repo root:
 *   node backend/scripts/architectural-audit/combinatorial-world-matrix.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const require = createRequire(join(repoRoot, "backend", "package.json"));

// Load compiled JS (run `npm run build` first) or fall back to ts-node-less direct import via dist
const distCore = join(repoRoot, "backend", "dist", "core");
let resolveCommittedWorld, decomposeIntent, buildIntentState;

try {
  ({ resolveCommittedWorld } = require(join(distCore, "committed-world.js")));
  ({ decomposeIntent } = require(join(distCore, "intent-decomposer.js")));
  ({ buildIntentState } = require(join(distCore, "intent-state-engine.js")));
} catch (e) {
  console.error("Build required: npm run build (dist/core not found)");
  console.error(e.message);
  process.exit(1);
}

const MOODS = ["melancholy", "energetic", "chilled", "nostalgic", "dark"];
const ACTIVITIES = ["gym", "drive", "study", "party", "cooking"];
const ERAS = ["80s", "90s", "2000s", "70s", null];
const GENRES = ["indie", "techno", "soul", "reggae", "country", null];
const NEGATIONS = [null, "no rap", "no christmas", "not cheesy"];

function synthesizePrompt(mood, activity, era, genre, negation) {
  const parts = [];
  if (era) parts.push(`${era}`);
  if (genre) parts.push(genre);
  if (mood) parts.push(mood);
  if (activity) parts.push(activity === "drive" ? "night drive" : activity);
  if (negation) parts.push(negation);
  return parts.join(" ").trim() || "music";
}

/** Sampled matrix — full cross product is 5×5×4×5×4 = 2000; sample strategically */
const SAMPLES = [];
for (const mood of MOODS) {
  for (const activity of ACTIVITIES.slice(0, 3)) {
    for (const era of [null, "90s"]) {
      for (const genre of [null, "indie"]) {
        SAMPLES.push(synthesizePrompt(mood, activity, era, genre, null));
      }
    }
  }
}
// Triple-constraint catastrophic combos
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
];

const allPrompts = [...new Set([...SAMPLES, ...CATASTROPHIC])];

const rows = allPrompts.map((prompt) => {
  const world = resolveCommittedWorld({ prompt, vibe: prompt });
  const decomposed = decomposeIntent(prompt);
  const intentState = buildIntentState(prompt, null);
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
          worldIds: world.worldIds,
        }
      : null,
    decomposed: {
      scene: decomposed.scene,
      emotion: decomposed.emotion,
      energy: decomposed.energy,
      inferredActivity: decomposed.inferredActivity,
      exclusions: decomposed.exclusions,
      unknownTokens: decomposed.unknownTokens.slice(0, 8),
      confidence: decomposed.confidence,
    },
    intentState: {
      activity: intentState.activity,
      emotion: intentState.emotion,
      energy: intentState.energy,
      era: intentState.era,
      scene: intentState.scene,
      unknownTokens: (intentState.unknownTokens ?? []).slice(0, 8),
      confidence: intentState.confidence,
    },
    collapseRisk:
      !world && decomposed.unknownTokens.length > 2
        ? "no_world_many_unknowns"
        : world?.hardLock && decomposed.exclusions.length > 0
          ? "hard_lock_with_negation"
          : world?.activityContext && world?.musicalWorldId && world.activityContext !== world.musicalWorldId
            ? "musical_activity_tension"
            : decomposed.unknownTokens.length > 0
              ? "partial_parse"
              : "ok",
  };
});

const stats = {
  total: rows.length,
  nullWorld: rows.filter((r) => !r.committedWorld).length,
  hardLock: rows.filter((r) => r.committedWorld?.hardLock).length,
  softOrVague: rows.filter((r) => r.committedWorld && !r.committedWorld.hardLock).length,
  collapseRiskCounts: {},
  uniqueWorldIds: [...new Set(rows.map((r) => r.committedWorld?.id).filter(Boolean))],
};
for (const r of rows) {
  stats.collapseRiskCounts[r.collapseRisk] = (stats.collapseRiskCounts[r.collapseRisk] ?? 0) + 1;
}

const outDir = join(repoRoot, "reports", "playlist-evaluation");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "combinatorial-world-matrix.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), stats, rows }, null, 2));

console.log("Combinatorial world matrix written:", outPath);
console.log(JSON.stringify(stats, null, 2));
