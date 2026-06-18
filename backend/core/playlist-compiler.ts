/**
 * Playlist compiler (Q12) — unified pre-generation context assembly.
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { buildTasteMemoryGraph, type TasteMemoryGraph } from "../lib/taste-memory-graph";
import { trendSceneAliasesForPrompt } from "../lib/trend-ingestion";
import { buildAdaptivePlaylistProfile, type AdaptivePlaylistProfile } from "../lib/adaptive-playlist-engine";
import {
  loadPromptSceneMemory,
  mergeCrossSessionSceneAliases,
  type PromptSceneMemory,
} from "../lib/cross-session-memory";
import { mergeScenePredictions } from "../lib/scene-alias-graph";
import type { FamiliarityMode } from "../lib/familiarity-controller";
import type { FeedbackMemory } from "../lib/feedback-memory";

export type CompiledPlaylistContext = {
  intentPipeline: ReturnType<typeof buildIntentPipelineContext>;
  sceneAliases: string[];
  scenePrediction: Record<string, number>;
  tasteGraph: TasteMemoryGraph;
  adaptiveProfile: AdaptivePlaylistProfile;
  crossSessionMemory: PromptSceneMemory | null;
  trendAliases: string[];
};

export async function compilePlaylistContext(opts: {
  prompt: string;
  userId: string;
  mode: "strict" | "balanced" | "chaotic";
  familiarityOverride?: FamiliarityMode | null;
  length: number;
  feedbackMemory?: FeedbackMemory | null;
  likedGenreFamilies?: string[];
}): Promise<CompiledPlaylistContext> {
  const crossSessionMemory = await loadPromptSceneMemory(opts.userId, opts.prompt);
  const intentPipeline = buildIntentPipelineContext(
    opts.prompt,
    opts.mode,
    opts.familiarityOverride ?? null,
  );

  const trendAliases = trendSceneAliasesForPrompt(opts.prompt);
  const sceneAliases = mergeCrossSessionSceneAliases(
    [...new Set([...intentPipeline.sceneAliases, ...trendAliases])],
    crossSessionMemory,
  );

  const scenePrediction = mergeScenePredictions(
    intentPipeline.scenePrediction,
    Object.fromEntries(sceneAliases.map((alias: string, index: number) => [alias, Math.max(0.05, 0.22 - index * 0.03)])),
  );

  const tasteGraph = buildTasteMemoryGraph({
    feedbackMemory: opts.feedbackMemory,
    sceneAliases,
    scenePrediction,
    likedGenreFamilies: opts.likedGenreFamilies,
  });

  const adaptiveProfile = buildAdaptivePlaylistProfile({
    requestedLength: opts.length,
    familiarityMode: intentPipeline.familiarityMode,
    crossSession: crossSessionMemory,
    priorCoherence: crossSessionMemory?.coherenceScore ?? null,
    mode: opts.mode,
  });

  return {
    intentPipeline: {
      ...intentPipeline,
      sceneAliases,
      scenePrediction,
      familiarityMode: adaptiveProfile.familiarityMode,
    },
    sceneAliases,
    scenePrediction,
    tasteGraph,
    adaptiveProfile,
    crossSessionMemory,
    trendAliases,
  };
}
