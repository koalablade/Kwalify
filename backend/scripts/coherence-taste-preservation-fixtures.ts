/**
 * Library-first scene alias merge fixtures.
 *
 * Usage: npm run coherence:taste-preservation
 */

import { mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";
import { buildDominantIntentContract } from "../core/dominant-intent-contract";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { decomposeIntent } from "../core/intent-decomposer";

function main(): void {
  const ukLibrary = ["electronic", "hip_hop"];
  const agathaAliases = buildIntentPipelineContext("Reading Agatha Christie", "balanced").sceneAliases;

  const emptyMerge = mergeSceneAliasesIntoGenres([], agathaAliases);
  const libraryMerge = mergeSceneAliasesIntoGenres(["electronic"], agathaAliases, {
    libraryGenreFamilies: ukLibrary,
  });
  const blockedMerge = mergeSceneAliasesIntoGenres(["electronic"], agathaAliases, {
    libraryGenreFamilies: ["rock"],
  });

  const decomposed = decomposeIntent("Reading Agatha Christie");
  const contract = buildDominantIntentContract({
    prompt: "Reading Agatha Christie",
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: decomposed.inferredActivity,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
  });

  const checks = [
    { id: "empty-base-no-injection", pass: emptyMerge.length === 0 },
    { id: "library-intersection-only", pass: libraryMerge.every((g) => ukLibrary.includes(g) || g === "electronic") && !libraryMerge.includes("jazz") },
    { id: "no-classical-without-library", pass: !blockedMerge.includes("classical") && !blockedMerge.includes("jazz") },
    { id: "contract-no-cultural-genres", pass: contract.genreFamilies.length === 0 },
    { id: "contract-no-cultural-era", pass: contract.eraRange == null },
    { id: "contract-atmosphere-enriched", pass: contract.scene.atmosphere.length >= 2 },
  ];

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }
  if (failed > 0) {
    console.error(`coherence taste preservation failed: ${failed}/${checks.length}`);
    process.exit(1);
  }
  console.log(`coherence taste preservation passed (${checks.length} checks)`);
}

main();
