/**
 * Playlist compiler (Q12) — full compile-to-publish DSL assembly.
 */

import { buildIntentPipelineContext, anchorSceneContextToManifold } from "../lib/intent-pipeline-orchestrator";
import {
  buildUserTasteManifold,
  projectSceneOntoManifold,
  type ManifoldTrackInput,
  type UserTasteManifold,
} from "../lib/user-taste-manifold";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import { buildTasteGraphV2, collaborativeGenreBoost, persistTasteGraphV2, type TasteGraphV2 } from "../lib/taste-graph-v2";
import { cultureSceneAliasesForPrompt, matchCultureEntities, warmSceneCultureCache } from "../lib/scene-culture-graph";
import { refreshLiveTrends, liveTrendSceneAliases, type LiveTrend } from "../lib/trend-ingestion-live";
import { buildAdaptivePlaylistProfile } from "../lib/adaptive-playlist-engine";
import { buildAdaptiveMorphPlan } from "../lib/adaptive-playlist-morph";
import { loadPromptSceneMemory, mergeCrossSessionSceneAliases } from "../lib/cross-session-memory";
import {
  loadGlobalTasteProfile,
  mergeGlobalTasteIntoSceneAliases,
  refreshGlobalTasteProfile,
  type GlobalTasteProfile,
} from "../lib/global-taste-profile";
import { mergeScenePredictions } from "../lib/scene-alias-graph";
import type { FamiliarityMode } from "../lib/familiarity-controller";
import type { FeedbackMemory } from "../lib/feedback-memory";
import { buildSegmentPlaylistPlan } from "../core/segment-playlist-planner";
import { buildMultiObjectPlan } from "../lib/multi-object-planner";
import { buildCompilePlanDSL, type CompilePlanDSL } from "./compile-plan-dsl";
import { logger } from "../lib/logger";

export type CompiledPlaylistContext = {
  compilePlan: CompilePlanDSL;
  intentPipeline: ReturnType<typeof buildIntentPipelineContext>;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  tasteGraphV2: TasteGraphV2;
  globalTaste: GlobalTasteProfile | null;
  tasteManifold: UserTasteManifold | null;
  adaptiveProfile: ReturnType<typeof buildAdaptivePlaylistProfile>;
  crossSessionMemory: Awaited<ReturnType<typeof loadPromptSceneMemory>>;
  trendAliases: string[];
  partialStages: string[];
};

export async function compilePlaylistContext(opts: {
  prompt: string;
  userId: string;
  mode: "strict" | "balanced" | "chaotic";
  familiarityOverride?: FamiliarityMode | null;
  length: number;
  feedbackMemory?: FeedbackMemory | null;
  likedGenreFamilies?: string[];
  likedArtists?: string[];
  manifoldTracks?: ManifoldTrackInput[];
  samePromptRegenerate?: boolean;
}): Promise<CompiledPlaylistContext> {
  const partialStages: string[] = [];
  const intentPipeline = buildIntentPipelineContext(
    opts.prompt,
    opts.mode,
    opts.familiarityOverride ?? null,
  );

  let sceneAliases = [...intentPipeline.sceneAliases];
  let scenePrediction = { ...intentPipeline.scenePrediction };
  let crossSessionMemory: Awaited<ReturnType<typeof loadPromptSceneMemory>> = null;
  let globalTasteLoaded: GlobalTasteProfile | null = null;
  let liveTrends: LiveTrend[] = [];

  try {
    await warmSceneCultureCache();
  } catch (err) {
    partialStages.push("culture_cache_warm_failed");
    logger.warn({ err }, "Culture cache warm failed — continuing with intent-only aliases");
  }

  try {
    crossSessionMemory = await loadPromptSceneMemory(opts.userId, opts.prompt);
  } catch (err) {
    partialStages.push("cross_session_load_failed");
    logger.warn({ err }, "Cross-session memory load failed");
  }

  try {
    globalTasteLoaded = await loadGlobalTasteProfile(opts.userId);
  } catch (err) {
    partialStages.push("global_taste_load_failed");
    logger.warn({ err }, "Global taste load failed");
  }

  try {
    liveTrends = await refreshLiveTrends(false);
  } catch (err) {
    partialStages.push("live_trends_failed");
    logger.warn({ err }, "Live trend refresh failed — using static hints only");
    liveTrends = [];
  }

  let tasteManifold: UserTasteManifold | null = null;
  if ((opts.manifoldTracks?.length ?? 0) > 0) {
    tasteManifold = buildUserTasteManifold(opts.manifoldTracks!);
  } else if ((opts.likedGenreFamilies?.length ?? 0) > 0) {
    tasteManifold = buildUserTasteManifold(
      (opts.likedGenreFamilies ?? []).flatMap((family, index) =>
        Array.from({ length: Math.max(3, 12 - index * 2) }, (_, i) => ({
          trackId: `${family}-${i}`,
          genreFamily: family,
          genrePrimary: family,
        })),
      ),
    );
  }

  try {
    const cultureAliases = cultureSceneAliasesForPrompt(opts.prompt);
    const trendAliases = liveTrendSceneAliases(opts.prompt, liveTrends);
    sceneAliases = mergeCrossSessionSceneAliases(
      [...new Set([...intentPipeline.sceneAliases, ...cultureAliases, ...trendAliases])],
      crossSessionMemory,
    );
    sceneAliases = mergeGlobalTasteIntoSceneAliases(sceneAliases, globalTasteLoaded);
    scenePrediction = mergeScenePredictions(
      intentPipeline.scenePrediction,
      Object.fromEntries(sceneAliases.map((alias: string, index: number) => [alias, Math.max(0.05, 0.22 - index * 0.03)])),
    );

    const expansion = expandCulturalReferences(opts.prompt);
    const projection = tasteManifold
      ? projectSceneOntoManifold(
        [...expansion.atmospheres, ...expansion.scene.atmospheres],
        expansion.culturalTags,
        expansion.sceneId,
        tasteManifold,
      )
      : null;
    const anchored = anchorSceneContextToManifold(sceneAliases, scenePrediction, tasteManifold, projection);
    sceneAliases = anchored.sceneAliases;
    scenePrediction = anchored.scenePrediction;
  } catch (err) {
    partialStages.push("scene_alias_merge_failed");
    logger.warn({ err }, "Scene alias merge failed — using base intent aliases");
  }

  let tasteGraphV2 = buildTasteGraphV2({
    userId: opts.userId,
    feedbackMemory: opts.feedbackMemory,
    likedGenreFamilies: opts.likedGenreFamilies,
    likedArtists: opts.likedArtists,
    sceneAliases,
    scenePrediction,
  });

  try {
    tasteGraphV2.collaborativeBoost = await collaborativeGenreBoost(opts.userId, tasteGraphV2.genreWeights);
    void persistTasteGraphV2(opts.userId, tasteGraphV2).catch(() => undefined);
  } catch (err) {
    partialStages.push("taste_graph_persist_failed");
    logger.warn({ err }, "Taste graph collaborative boost failed — using memory graph only");
  }

  let globalTaste: GlobalTasteProfile | null = globalTasteLoaded;
  try {
    globalTaste = globalTasteLoaded ?? await refreshGlobalTasteProfile(opts.userId);
  } catch (err) {
    partialStages.push("global_taste_refresh_failed");
    logger.warn({ err }, "Global taste refresh failed");
  }

  const adaptiveProfile = buildAdaptivePlaylistProfile({
    requestedLength: opts.length,
    familiarityMode: intentPipeline.familiarityMode,
    crossSession: crossSessionMemory,
    priorCoherence: crossSessionMemory?.coherenceScore ?? globalTaste?.avgCoherence ?? null,
    mode: opts.mode,
  });

  const morphPlan = buildAdaptiveMorphPlan({
    samePromptRegenerate: !!opts.samePromptRegenerate,
    priorCoherence: crossSessionMemory?.coherenceScore ?? globalTaste?.avgCoherence ?? null,
    crossSession: crossSessionMemory,
    globalTaste,
    mode: opts.mode,
    familiarityMode: adaptiveProfile.familiarityMode,
  });

  const effectiveLength = Math.max(20, Math.min(60, adaptiveProfile.length + morphPlan.morph.lengthDelta));
  const segmentPlan = buildSegmentPlaylistPlan(intentPipeline.decomposedIntent, effectiveLength, sceneAliases);
  const multiObjectPlan = buildMultiObjectPlan(segmentPlan);

  let cultureMatches: string[] = [];
  try {
    cultureMatches = matchCultureEntities(opts.prompt).map((m) => m.entity.entityKey);
  } catch (err) {
    partialStages.push("culture_match_failed");
    logger.warn({ err }, "Culture entity match failed");
  }

  const trendAliases = liveTrendSceneAliases(opts.prompt, liveTrends);

  const compilePlan = buildCompilePlanDSL({
    prompt: opts.prompt,
    mode: opts.mode,
    length: effectiveLength,
    familiarityMode: morphPlan.morph.familiarityShift ?? adaptiveProfile.familiarityMode,
    sceneAliases,
    scenePrediction,
    segmentPlan,
    multiObjectPlan,
    adaptiveProfile,
    morphPlan,
    tasteGraphV2,
    globalTaste,
    cultureMatches,
    liveTrends: liveTrends.map((t) => t.term).slice(0, 8),
  });

  return {
    compilePlan,
    intentPipeline: {
      ...intentPipeline,
      sceneAliases,
      scenePrediction,
      familiarityMode: morphPlan.morph.familiarityShift ?? adaptiveProfile.familiarityMode,
    },
    sceneAliases,
    scenePrediction,
    tasteGraphV2,
    globalTaste,
    tasteManifold,
    adaptiveProfile,
    crossSessionMemory,
    trendAliases,
    partialStages,
  };
}

// Re-export for backwards compatibility
export type { CompilePlanDSL };

