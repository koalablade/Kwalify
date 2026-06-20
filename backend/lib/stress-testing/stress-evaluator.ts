/**
 * Offline stress evaluator — runs prompt through intent/scene/manifold pipeline.
 */

import { buildDominantIntentContract } from "../../core/dominant-intent-contract";
import { decomposeIntent } from "../../core/intent-decomposer";
import { expandCulturalReferences, partitionExpansionGenreHints } from "../cultural-reference-expansion";
import {
  anchorSceneContextToManifold,
  buildIntentPipelineContext,
  mergeSceneAliasesIntoGenres,
} from "../intent-pipeline-orchestrator";
import { buildPromptSceneProfile } from "../scene-semantic-retrieval";
import {
  buildUserTasteManifold,
  projectSceneOntoManifold,
  type ManifoldTrackInput,
} from "../user-taste-manifold";
import { buildSceneModifier } from "../scene-modifier";
import { buildStressEvaluation, type RawStressSignals } from "./collapse-classifier";
import {
  buildTasteBaseline,
  measureIdentityDrift,
  projectedTextureShiftFromScene,
} from "./identity-envelope";
import type { AdversarialCategory, StressEvaluation } from "./types";

const CONTRADICTION_RE = /\bbut\b|\bnot\b|\bno\b|\bwithout\b|\bopposite\b|\bhowever\b/i;
const MULTI_SCENE_RE = /\bthen\b|\bwhile\b|\bbut also\b|\s\/\s|\s\+\s| meets /i;

export type EvaluateStressOpts = {
  prompt: string;
  libraryId: string;
  tracks: ManifoldTrackInput[];
  coldStart?: boolean;
  category?: AdversarialCategory;
  signatureIndex?: Map<string, string[]>;
};

export function evaluatePromptStress(opts: EvaluateStressOpts): StressEvaluation {
  const { prompt, libraryId, tracks, coldStart = false, category } = opts;
  const manifold = tracks.length > 0 ? buildUserTasteManifold(tracks) : null;
  const baseline = buildTasteBaseline(manifold);
  const libraryFamilies = manifold ? Object.keys(manifold.genreSupport) : [];

  const expansion = expandCulturalReferences(prompt);
  const sceneProfile = buildPromptSceneProfile(prompt);
  const pipeline = buildIntentPipelineContext(prompt, "balanced");
  const decomposed = decomposeIntent(prompt);
  const contract = buildDominantIntentContract({
    prompt,
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: decomposed.inferredActivity,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
    noLibraryMode: coldStart || tracks.length === 0,
  });

  const projection = manifold
    ? projectSceneOntoManifold(
      [...expansion.atmospheres, ...expansion.scene.atmospheres],
      expansion.culturalTags,
      expansion.sceneId,
      manifold,
    )
    : null;

  const anchored = anchorSceneContextToManifold(
    pipeline.sceneAliases,
    pipeline.scenePrediction,
    manifold,
    projection,
  );

  const genrePartition = partitionExpansionGenreHints(expansion, manifold);
  const sceneModifier = buildSceneModifier({
    prompt,
    expansion,
    manifold,
    scenePrediction: anchored.scenePrediction,
  });
  void sceneModifier;

  const mergedGenresEmptyBase = mergeSceneAliasesIntoGenres([], pipeline.sceneAliases);
  const mergedGenresWithLibrary = mergeSceneAliasesIntoGenres(
    libraryFamilies.slice(0, 1),
    anchored.sceneAliases,
    { libraryGenreFamilies: libraryFamilies },
  );

  const atmospheres = [...new Set([...sceneProfile.atmospheres, ...expansion.atmospheres])];
  const sceneAtmosphereDetected =
    atmospheres.length >= 1
    || expansion.sceneId != null
    || sceneProfile.times.length >= 1
    || sceneProfile.activities.length >= 1;

  const identityDrift = measureIdentityDrift(
    manifold,
    baseline,
    {
      projectedGenreWeights: projection?.projectedGenreWeights ?? {},
      anchoredAliases: anchored.sceneAliases,
      mergedGenres: mergedGenresWithLibrary,
    },
    manifold && projection
      ? projectedTextureShiftFromScene(manifold, projection.projectedGenreWeights)
      : undefined,
  );

  const signatureKey = sceneProfile.retrievalSignature;
  let signatureCollision = false;
  if (opts.signatureIndex) {
    const existing = opts.signatureIndex.get(signatureKey) ?? [];
    if (existing.length > 0 && !existing.includes(prompt)) signatureCollision = true;
    existing.push(prompt);
    opts.signatureIndex.set(signatureKey, existing);
  }

  const genericFallbackRisk =
    (coldStart || tracks.length === 0)
    && (mergedGenresEmptyBase.length > 0 || contract.genreFamilies.length > 0);

  const signals: RawStressSignals = {
    prompt,
    libraryId,
    coldStart: coldStart || tracks.length === 0,
    sceneId: expansion.sceneId,
    atmospheres,
    retrievalSignature: sceneProfile.retrievalSignature,
    intentSignature: contract.intentSignature,
    anchoredAliases: anchored.sceneAliases,
    blockedExternalGenres: genrePartition.diagnosticOnlyHints,
    filteredExternalGenres: projection?.filteredExternalGenres ?? [],
    mergedGenresWithLibrary,
    mergedGenresEmptyBase,
    expansionGenreHints: expansion.genreFamilies,
    hasContradiction: CONTRADICTION_RE.test(prompt),
    multiSceneDetected: MULTI_SCENE_RE.test(prompt),
    signatureCollision,
    foreignGenresInjected: identityDrift.foreignGenresInjected,
    identityWithinEnvelope: identityDrift.withinEnvelope,
    sceneAtmosphereDetected,
    genericFallbackRisk,
    focusCollapseRisk: contract.activity === "focus" && atmospheres.length === 0,
    identityDriftSeverity: Math.max(
      identityDrift.genreDelta,
      identityDrift.tasteCentroidDrift,
      identityDrift.emotionalDrift,
    ),
  };

  return buildStressEvaluation(signals, {
    category,
    identityDrift,
  });
}

export function summarizeStressResults(results: StressEvaluation[]): {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  collapseCounts: Record<string, number>;
  stageCounts: Record<string, number>;
  weakest: StressEvaluation[];
} {
  const failed = results.filter((r) => !r.passed);
  const collapseCounts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  for (const row of failed) {
    collapseCounts[row.collapseType] = (collapseCounts[row.collapseType] ?? 0) + 1;
    stageCounts[row.responsibleStage] = (stageCounts[row.responsibleStage] ?? 0) + 1;
  }
  const sorted = [...results].sort((a, b) => b.severity - a.severity);
  const weakestCount = Math.max(1, Math.ceil(results.length * 0.1));
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    passRate: Math.round(((results.length - failed.length) / Math.max(1, results.length)) * 1000) / 10,
    collapseCounts,
    stageCounts,
    weakest: sorted.slice(0, weakestCount),
  };
}
