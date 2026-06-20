/**
 * Identity preservation stress test — pre/post scene drift per prompt × library.
 *
 * Hard rule: scene must NOT move user outside identity envelope.
 *
 * Usage: npm run stress:identity-preservation
 */

import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import {
  anchorSceneContextToManifold,
  buildIntentPipelineContext,
  mergeSceneAliasesIntoGenres,
} from "../lib/intent-pipeline-orchestrator";
import {
  buildUserTasteManifold,
  projectSceneOntoManifold,
} from "../lib/user-taste-manifold";
import {
  buildTasteBaseline,
  IDENTITY_THRESHOLDS,
  measureIdentityDrift,
  projectedTextureShiftFromScene,
} from "../lib/stress-testing/identity-envelope";
import { ROBUSTNESS_SCENE_PROMPTS, SYNTHETIC_LIBRARIES } from "../lib/stress-testing/synthetic-libraries";
import type { IdentityDriftMetrics } from "../lib/stress-testing/types";

type IdentityCase = {
  libraryId: string;
  prompt: string;
  pass: boolean;
  responsibleStage: string;
  drift: IdentityDriftMetrics;
  thresholds: typeof IDENTITY_THRESHOLDS;
};

function traceResponsibleStage(drift: IdentityDriftMetrics): string {
  if (drift.foreignGenresInjected.length > 0) return "alias_merge|manifold_projection";
  if (drift.genreDelta > IDENTITY_THRESHOLDS.maxGenreDelta) return "manifold_projection";
  if (drift.emotionalDrift > IDENTITY_THRESHOLDS.maxEmotionalDrift) return "cultural_expansion";
  if (drift.sonicTextureDrift > IDENTITY_THRESHOLDS.maxTextureDrift) return "scene_profile";
  if (drift.tasteCentroidDrift > IDENTITY_THRESHOLDS.maxTasteCentroidDrift) return "retrieval_boost";
  return "unknown";
}

function evaluateIdentity(libraryId: string, prompt: string, tracks: typeof SYNTHETIC_LIBRARIES[number]["tracks"]): IdentityCase {
  const manifold = tracks.length > 0 ? buildUserTasteManifold(tracks) : null;
  const baseline = buildTasteBaseline(manifold);
  const libraryFamilies = manifold ? Object.keys(manifold.genreSupport) : [];

  const expansion = expandCulturalReferences(prompt);
  const pipeline = buildIntentPipelineContext(prompt, "balanced");
  const projection = manifold
    ? projectSceneOntoManifold(
      [...expansion.atmospheres, ...expansion.scene.atmospheres],
      expansion.culturalTags,
      expansion.sceneId,
      manifold,
    )
    : null;
  const anchored = anchorSceneContextToManifold(pipeline.sceneAliases, pipeline.scenePrediction, manifold, projection);
  const mergedGenres = mergeSceneAliasesIntoGenres(
    libraryFamilies.slice(0, 1),
    anchored.sceneAliases,
    { libraryGenreFamilies: libraryFamilies },
  );

  const drift = measureIdentityDrift(
    manifold,
    baseline,
    {
      projectedGenreWeights: projection?.projectedGenreWeights ?? {},
      anchoredAliases: anchored.sceneAliases,
      mergedGenres,
    },
    manifold && projection
      ? projectedTextureShiftFromScene(manifold, projection.projectedGenreWeights)
      : undefined,
  );

  return {
    libraryId,
    prompt,
    pass: drift.withinEnvelope,
    responsibleStage: traceResponsibleStage(drift),
    drift,
    thresholds: IDENTITY_THRESHOLDS,
  };
}

function main(): void {
  const libraries = SYNTHETIC_LIBRARIES.filter((l) => !l.coldStart);
  const results: IdentityCase[] = [];

  for (const library of libraries) {
    for (const prompt of ROBUSTNESS_SCENE_PROMPTS) {
      results.push(evaluateIdentity(library.id, prompt, library.tracks));
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);

  for (const row of failures.slice(0, 25)) {
    console.log(JSON.stringify({
      id: `${row.libraryId}::${row.prompt.slice(0, 45)}`,
      pass: false,
      stage: row.responsibleStage,
      genreDelta: row.drift.genreDelta,
      tasteDrift: row.drift.tasteCentroidDrift,
      emotionalDrift: row.drift.emotionalDrift,
      textureDrift: row.drift.sonicTextureDrift,
      foreign: row.drift.foreignGenresInjected,
      pre: row.drift.preDominantGenres,
      post: row.drift.postDominantGenres,
    }));
  }

  const stageFailures = new Map<string, number>();
  for (const f of failures) {
    stageFailures.set(f.responsibleStage, (stageFailures.get(f.responsibleStage) ?? 0) + 1);
  }

  console.log(JSON.stringify({
    libraries: libraries.length,
    prompts: ROBUSTNESS_SCENE_PROMPTS.length,
    cases: results.length,
    passed,
    passRate: Math.round((passed / results.length) * 1000) / 10,
    thresholds: IDENTITY_THRESHOLDS,
    stageFailures: Object.fromEntries(stageFailures),
    sampleFailures: failures.slice(0, 6).map((f) => ({
      libraryId: f.libraryId,
      prompt: f.prompt,
      drift: f.drift,
      stage: f.responsibleStage,
    })),
  }, null, 2));

  if (failures.length > 0) {
    console.error(`stress:identity-preservation failed (${passed}/${results.length})`);
    process.exit(1);
  }
  console.log(`stress:identity-preservation passed (${passed}/${results.length})`);
}

main();
