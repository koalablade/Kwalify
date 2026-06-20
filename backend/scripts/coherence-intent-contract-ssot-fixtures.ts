/**
 * Authoritative intent contract SSOT gate — linear pipeline + priority conflict resolution.
 *
 * Usage: npm run coherence:intent-contract-ssot
 */

import {
  buildAuthoritativeIntentContract,
  validateAuthoritativeIntentContract,
  resolveIntentConflicts,
} from "../core/authoritative-intent-contract";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { buildUnifiedIntentContext, resolveUnifiedIntent, unifiedIntentFromLockedIntent } from "../core/unified-intent";
import { decomposeIntent as decomposeIntentV1 } from "../core/intent-decomposer";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";

const PROMPTS = [
  "Reading Agatha Christie",
  "uk garage workout",
  "Tokyo at 3am",
  "sad indie driving at night",
  "no rap please",
  "Reading Tolkien by the fire",
];

function main(): void {
  let failed = 0;

  for (const prompt of PROMPTS) {
    const authoritative = buildAuthoritativeIntentContract({ prompt, mode: "balanced" });
    const validation = validateAuthoritativeIntentContract(authoritative);
    const pipeline = buildIntentPipelineContext(prompt, "balanced");
    const unified = buildUnifiedIntentContext(prompt);

    const checks = [
      {
        id: `${prompt}::validation`,
        pass: validation.valid,
        detail: validation.errors,
      },
      {
        id: `${prompt}::single-decompose`,
        pass: pipeline.decomposedIntent.raw === authoritative.decomposedIntent.raw,
      },
      {
        id: `${prompt}::pipeline-uses-authoritative`,
        pass: pipeline.authoritativeIntent.buildSignature === authoritative.buildSignature,
      },
      {
        id: `${prompt}::unified-uses-authoritative`,
        pass:
          unified.authoritativeIntent.prompt === authoritative.prompt &&
          unified.authoritativeIntent.culturalScene.sceneId === authoritative.culturalScene.sceneId &&
          unified.authoritativeIntent.genre.families.join(",") === authoritative.genre.families.join(","),
      },
      {
        id: `${prompt}::cultural-scene-ssot`,
        pass: authoritative.culturalScene.sceneId === expandCulturalReferences(prompt).sceneId,
      },
      {
        id: `${prompt}::no-parallel-v1-drift`,
        pass: decomposeIntentV1(prompt).raw === authoritative.decomposedIntent.raw,
      },
      {
        id: `${prompt}::priority-resolver-not-blended`,
        pass: resolveUnifiedIntent([
          unifiedIntentFromLockedIntent(authoritative.lockedIntent),
          { source: "v11", confidence: 0.2, intent: unified.unifiedIntent },
        ]).resolver.source === "v3_locked",
      },
      {
        id: `${prompt}::genre-never-from-cultural-alone`,
        pass: authoritative.genre.families.length === 0 ||
          authoritative.genre.source !== "cultural_expansion" ||
          authoritative.lockedIntent.genreFamilies.length > 0,
      },
    ];

    for (const check of checks) {
      if (!check.pass) failed += 1;
      console.log(JSON.stringify(check));
    }

    if (authoritative.conflicts.length > 0) {
      console.log(JSON.stringify({
        id: `${prompt}::conflicts-resolved`,
        count: authoritative.conflicts.length,
        sample: authoritative.conflicts.slice(0, 2),
      }));
    }
  }

  const agatha = buildAuthoritativeIntentContract({ prompt: "Reading Agatha Christie", mode: "balanced" });
  const conflictDemo = resolveIntentConflicts({
    prompt: agatha.prompt,
    lockedIntent: agatha.lockedIntent,
    decomposedIntent: agatha.decomposedIntent,
    culturalExpansion: agatha.culturalExpansion,
    dominantContract: agatha.dominantContract,
  });
  const agathaChecks = [
    {
      id: "agatha-cultural-scene-wins",
      pass: conflictDemo.culturalScene.sceneId === "cozy-mystery",
    },
    {
      id: "agatha-no-cultural-genre-injection",
      pass: conflictDemo.genre.families.length === 0,
    },
    {
      id: "agatha-atmosphere-present",
      pass: conflictDemo.culturalScene.atmospheres.some((a) => a.includes("mystery") || a === "mystery"),
    },
  ];
  for (const check of agathaChecks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }

  if (failed > 0) {
    console.error(`coherence intent contract ssot failed: ${failed} checks`);
    process.exit(1);
  }
  console.log(`coherence intent contract ssot passed (${PROMPTS.length * 8 + agathaChecks.length} checks)`);
}

main();
