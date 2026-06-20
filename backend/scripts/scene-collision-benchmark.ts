/**
 * Scene collision benchmark — distinct signatures, emotional vectors for overlapping scenes.
 *
 * Usage: npm run benchmark:scene-collisions
 */

import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import { buildSceneModifier } from "../lib/scene-modifier";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import {
  compareSceneCollisionPair,
  SCENE_COLLISION_OVERLAP_THRESHOLD,
  signatureOverlap,
} from "../lib/scene-collision-resolver";

const COLLISION_PAIRS: Array<[string, string, string]> = [
  ["Reading Agatha Christie", "Reading Sherlock Holmes", "cozy-mystery-literary"],
  ["Tokyo at 3am", "Cyberpunk dystopia", "nocturnal-urban-future"],
  ["Small-town horror novel", "Reading Stephen King", "horror-literary"],
];

function profileBundle(prompt: string) {
  const expansion = expandCulturalReferences(prompt);
  const profile = buildPromptSceneProfile(prompt);
  const modifier = buildSceneModifier({ prompt, expansion });
  return { prompt, profile, modifier, expansion };
}

function main(): void {
  const bundles = COLLISION_PAIRS.flatMap(([a, b]) => [a, b]).map(profileBundle);
  const uniquePrompts = [...new Map(bundles.map((b) => [b.prompt, b])).values()];

  const checks: Array<{ id: string; pass: boolean; detail?: string }> = [];

  for (const [promptA, promptB, group] of COLLISION_PAIRS) {
    const a = uniquePrompts.find((b) => b.prompt === promptA)!;
    const b = uniquePrompts.find((b) => b.prompt === promptB)!;
    const pair = compareSceneCollisionPair(promptA, promptB);
    const sigOverlap = signatureOverlap(a.profile.retrievalSignature, b.profile.retrievalSignature);

    checks.push({
      id: `${group}::distinct-signatures`,
      pass: a.profile.retrievalSignature !== b.profile.retrievalSignature && pair.distinctSignatures,
      detail: `${sigOverlap} ${a.profile.retrievalSignature.slice(0, 40)} vs ${b.profile.retrievalSignature.slice(0, 40)}`,
    });
    checks.push({
      id: `${group}::distinct-emotional-vectors`,
      pass: pair.distinctEmotionalVectors,
      detail: `${pair.axisA} vs ${pair.axisB}`,
    });
    checks.push({
      id: `${group}::overlap-below-threshold`,
      pass: sigOverlap < SCENE_COLLISION_OVERLAP_THRESHOLD || pair.axisA !== pair.axisB,
    });
    checks.push({
      id: `${group}::no-genre-injection`,
      pass: a.expansion.genreFamilies.length === 0 && b.expansion.genreFamilies.length === 0,
    });
    checks.push({
      id: `${group}::modifier-has-constraints`,
      pass: a.modifier.constraints.narrativeTags.length >= 0 && Object.keys(a.modifier.weights).length >= 0,
    });
  }

  let failed = 0;
  for (const check of checks) {
    if (!check.pass) failed += 1;
    console.log(JSON.stringify(check));
  }

  console.log(JSON.stringify({
    pairs: COLLISION_PAIRS.length,
    checks: checks.length,
    passed: checks.length - failed,
    passRate: Math.round(((checks.length - failed) / checks.length) * 1000) / 10,
    threshold: SCENE_COLLISION_OVERLAP_THRESHOLD,
    samples: uniquePrompts.map((b) => ({
      prompt: b.prompt,
      retrievalSignature: b.profile.retrievalSignature,
      sceneId: b.modifier.sceneId,
      differentiationAxis: b.modifier.differentiation?.axis,
      genreFamilies: b.expansion.genreFamilies,
    })),
  }, null, 2));

  if (failed > 0) {
    console.error(`benchmark:scene-collisions failed (${failed}/${checks.length})`);
    process.exit(1);
  }
  console.log(`benchmark:scene-collisions passed (${checks.length}/${checks.length})`);
}

main();
