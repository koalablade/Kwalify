/**
 * Electronic subgenre retrieval fixtures — D&B, techno, industrial starvation guards.
 *
 * Usage: npm run coherence:electronic-subgenres
 */

import { adaptiveRetrievalThresholds, assessCandidatePoolHealth, electronicSubgenreGuard } from "../core/dominant-intent-contract";

const PROMPTS = [
  "D&B rollers for night driving",
  "Industrial techno warehouse rave",
  "Fast driving backroad tekk",
];

function main(): void {
  let failed = 0;
  for (const prompt of PROMPTS) {
    const librarySize = 4200;
    const playlistLength = 25;
    const thresholds = adaptiveRetrievalThresholds(librarySize, playlistLength);
    const health = assessCandidatePoolHealth(18, playlistLength, "related_subgenre");
    const guard = electronicSubgenreGuard(["electronic"], "hard_techno");
    const ok = thresholds.strictMinimum < 40 && health.score > 0 && guard;
    if (!ok) failed += 1;
    console.log(JSON.stringify({ prompt, thresholds, health, guard, ok }));
  }
  if (failed > 0) {
    console.error(`electronic subgenre fixtures failed: ${failed}`);
    process.exit(1);
  }
  console.log("electronic subgenre fixtures passed");
}

main();
