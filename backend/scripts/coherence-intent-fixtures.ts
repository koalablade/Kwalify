/**
 * Coherence intent regression — validates scene aliases, locks, and decomposition
 * for cultural prompts without a full Spotify generate.
 *
 * Usage: npm run coherence:intent
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";

type Fixture = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  expectAliases: string[];
  expectSceneLock?: boolean;
  minConfidence?: number;
};

const FIXTURES: Fixture[] = [
  {
    id: "volvo-garage",
    prompt: "music for working on my volvo in the garage late at night",
    mode: "balanced",
    expectAliases: ["blues", "indie", "rock"],
    expectSceneLock: true,
    minConfidence: 0.4,
  },
  {
    id: "kerrang-alt",
    prompt: "kerrang era alt rock and emo from my teenage years",
    mode: "strict",
    expectAliases: ["rock", "metal", "indie"],
    minConfidence: 0.45,
  },
  {
    id: "nfs-drive",
    prompt: "need for speed underground driving playlist high energy",
    mode: "chaotic",
    expectAliases: ["rock", "electronic"],
    minConfidence: 0.4,
  },
  {
    id: "rainy-night-drive",
    prompt: "rainy night drive alone through the city",
    mode: "balanced",
    expectAliases: ["indie", "electronic"],
    minConfidence: 0.35,
  },
];

function main(): void {
  const results = FIXTURES.map((fixture) => {
    const ctx = buildIntentPipelineContext(fixture.prompt, fixture.mode);
    const aliasHits = fixture.expectAliases.filter((alias) =>
      ctx.sceneAliases.includes(alias),
    );
    const aliasPass = aliasHits.length >= Math.min(2, fixture.expectAliases.length);
    const lockPass = fixture.expectSceneLock == null || ctx.sceneLockStatus.active === fixture.expectSceneLock;
    const confidencePass = fixture.minConfidence == null || ctx.decomposedIntent.confidence >= fixture.minConfidence;
    const predictionPass = Object.keys(ctx.scenePrediction).length > 0;
    const pass = aliasPass && lockPass && confidencePass && predictionPass;
    return {
      id: fixture.id,
      pass,
      sceneAliases: ctx.sceneAliases,
      sceneLock: ctx.sceneLockStatus.active,
      confidence: ctx.decomposedIntent.confidence,
      familiarityMode: ctx.familiarityMode,
      scenePrediction: ctx.scenePrediction,
      checks: { aliasPass, lockPass, confidencePass, predictionPass },
    };
  });

  const failed = results.filter((row) => !row.pass);
  process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, results }, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main();
