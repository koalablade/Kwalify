/**
 * Scene filter-not-generator fixtures — scenes emit modifiers, not genres.
 *
 * Usage: npm run coherence:scene-filter
 */

import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import { buildIntentPipelineContext, mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";
import { buildSceneModifier } from "../lib/scene-modifier";
import { resolveDecomposedSceneAliases } from "../lib/scene-alias-graph";

function main(): void {
  const prompts = [
    "Reading Agatha Christie",
    "Tokyo at 3am",
    "Warehouse rave at midnight",
  ];

  const checks: Array<{ id: string; pass: boolean }> = [];

  for (const prompt of prompts) {
    const expansion = expandCulturalReferences(prompt);
    const pipeline = buildIntentPipelineContext(prompt, "balanced");
    const modifier = buildSceneModifier({ prompt, expansion });
    const merged = mergeSceneAliasesIntoGenres([], ["jazz", "classical", "ambient"]);
    const aliases = resolveDecomposedSceneAliases(pipeline.decomposedIntent);

    checks.push({ id: `${prompt}::expansion-no-genres`, pass: expansion.genreFamilies.length === 0 });
    checks.push({ id: `${prompt}::aliases-empty`, pass: aliases.length === 0 });
    checks.push({ id: `${prompt}::merge-no-injection`, pass: merged.length === 0 });
    checks.push({ id: `${prompt}::modifier-version`, pass: modifier.version === "scene-filter-v1" });
    checks.push({ id: `${prompt}::modifier-has-constraints`, pass: modifier.constraints.constraintSignature.length > 0 });
    checks.push({
      id: `${prompt}::authoritative-no-cultural-genres`,
      pass: pipeline.authoritativeIntent.genre.families.every(
        (g) => !expansion.genreFamilies.includes(g),
      ),
    });
  }

  const ssot = buildIntentPipelineContext("Reading Agatha Christie", "balanced").authoritativeIntent;
  checks.push({
    id: "ssot-genre-not-from-scene",
    pass: ssot.genre.families.length === 0 || !ssot.genre.families.includes("jazz"),
  });

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }

  if (failed > 0) {
    console.error(`coherence scene filter failed (${failed}/${checks.length})`);
    process.exit(1);
  }
  console.log(`coherence scene filter passed (${checks.length} checks)`);
}

main();
