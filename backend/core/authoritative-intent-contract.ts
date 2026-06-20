/**
 * Authoritative Intent Contract — single source of truth for the entire pipeline.
 *
 * Linear flow:
 *   prompt → buildAuthoritativeIntentContract() → all downstream systems
 *
 * Genre, emotion, activity, and cultural scene MUST derive from this structure.
 * When subsystems disagree, resolveIntentConflicts() applies priority rules — never averaging.
 */

import { buildDominantIntentContract, type DominantEmotion, type DominantIntentContract } from "./dominant-intent-contract";
import { decomposeIntent, type DecomposedIntent } from "./intent-decomposer";
import { buildIntentState, type IntentState } from "./intent-state-engine";
import { buildLockedIntent, completeLockedIntent, type LockedIntent, type LockedIntentFallbacks } from "./v3/intent";
import {
  expandCulturalReferences,
  type ExpandedCulturalContext,
} from "../lib/cultural-reference-expansion";
import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import type { PromptSceneProfile } from "../lib/track-semantic-types";
import type { EmotionProfile } from "../lib/emotion";

export const AUTHORITATIVE_INTENT_VERSION = "intent-ssot-v1";

export type IntentDimension = "genre" | "emotion" | "activity" | "scene" | "energy" | "era";

export type IntentConflictRecord = {
  dimension: IntentDimension;
  candidates: Array<{ source: string; value: string; priority: number }>;
  winner: { source: string; value: string };
  rule: string;
};

export type AuthoritativeGenreIntent = {
  families: string[];
  primarySubgenre: string | null;
  source: string;
};

export type AuthoritativeEmotionIntent = {
  dominant: DominantEmotion;
  explicit: boolean;
  moodTags: string[];
  source: string;
};

export type AuthoritativeActivityIntent = {
  value: string | null;
  priority: number;
  source: string;
};

export type AuthoritativeCulturalSceneIntent = {
  sceneId: string | null;
  atmospheres: string[];
  culturalTags: string[];
  themes: string[];
  sceneConcepts: string[];
  culturalDominance: number;
  atmosphereOverActivity: boolean;
  source: string;
};

export type AuthoritativeIntentContract = {
  version: typeof AUTHORITATIVE_INTENT_VERSION;
  prompt: string;
  lockedIntent: LockedIntent;
  decomposedIntent: DecomposedIntent;
  culturalExpansion: ExpandedCulturalContext;
  dominantContract: DominantIntentContract;
  intentState: IntentState;
  promptSceneProfile: PromptSceneProfile;
  genre: AuthoritativeGenreIntent;
  emotion: AuthoritativeEmotionIntent;
  activity: AuthoritativeActivityIntent;
  culturalScene: AuthoritativeCulturalSceneIntent;
  conflicts: IntentConflictRecord[];
  buildSignature: string;
};

/** Higher wins on conflict — explicit user signals beat inferred scene/cultural hints. */
export const INTENT_SOURCE_PRIORITY: Record<string, number> = {
  explicit_prompt: 100,
  locked_intent: 90,
  dominant_contract: 85,
  cultural_expansion: 70,
  decomposed_v1: 60,
  intent_state: 50,
  scene_profile: 45,
  inferred: 30,
};

const EXPLICIT_ACTIVITY_PATTERN = /\b(reading|studying|driving|running|gym|workout|sleep|coding|walking|commute)\b/i;

function signature(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("|");
}

export function resolveIntentConflicts(input: {
  prompt: string;
  lockedIntent: LockedIntent;
  decomposedIntent: DecomposedIntent;
  culturalExpansion: ExpandedCulturalContext;
  dominantContract: DominantIntentContract;
}): {
  genre: AuthoritativeGenreIntent;
  emotion: AuthoritativeEmotionIntent;
  activity: AuthoritativeActivityIntent;
  culturalScene: AuthoritativeCulturalSceneIntent;
  conflicts: IntentConflictRecord[];
} {
  const conflicts: IntentConflictRecord[] = [];

  const genreCandidates = [
    { source: "locked_intent", value: input.lockedIntent.genreFamilies.join(","), priority: INTENT_SOURCE_PRIORITY.locked_intent },
    { source: "dominant_contract", value: input.dominantContract.genreFamilies.join(","), priority: INTENT_SOURCE_PRIORITY.dominant_contract },
  ].filter((c) => c.value.length > 0);

  const genreWinner = genreCandidates.sort((a, b) => b.priority - a.priority)[0]
    ?? { source: "locked_intent", value: "", priority: INTENT_SOURCE_PRIORITY.locked_intent };
  if (genreCandidates.length > 1 && new Set(genreCandidates.map((c) => c.value)).size > 1) {
    conflicts.push({
      dimension: "genre",
      candidates: genreCandidates.map((c) => ({ ...c, value: c.value || "(empty)" })),
      winner: { source: genreWinner.source, value: genreWinner.value || "(empty)" },
      rule: "explicit_locked_genre_over_cultural_hints",
    });
  }
  const genreFamilies = input.dominantContract.genreFamilies.length > 0
    ? [...input.dominantContract.genreFamilies]
    : input.lockedIntent.genreFamilies.length > 0
      ? [...input.lockedIntent.genreFamilies]
      : [];

  const emotionCandidates = [
    {
      source: "dominant_contract",
      value: input.dominantContract.dominantEmotion ?? "",
      priority: input.dominantContract.dominantEmotionExplicit
        ? INTENT_SOURCE_PRIORITY.explicit_prompt
        : INTENT_SOURCE_PRIORITY.dominant_contract,
    },
    {
      source: "cultural_expansion",
      value: input.culturalExpansion.dominantEmotion ?? "",
      priority: INTENT_SOURCE_PRIORITY.cultural_expansion,
    },
    {
      source: "decomposed_v1",
      value: input.decomposedIntent.emotion ?? "",
      priority: INTENT_SOURCE_PRIORITY.decomposed_v1,
    },
    {
      source: "locked_intent",
      value: input.lockedIntent.mood[0] ?? "",
      priority: INTENT_SOURCE_PRIORITY.locked_intent,
    },
  ].filter((c) => c.value.length > 0);

  const emotionWinner = [...emotionCandidates].sort((a, b) => b.priority - a.priority)[0]
    ?? { source: "dominant_contract", value: "", priority: INTENT_SOURCE_PRIORITY.dominant_contract };
  if (emotionCandidates.length > 1 && new Set(emotionCandidates.map((c) => c.value)).size > 1) {
    conflicts.push({
      dimension: "emotion",
      candidates: emotionCandidates,
      winner: { source: emotionWinner.source, value: emotionWinner.value },
      rule: input.dominantContract.dominantEmotionExplicit
        ? "explicit_emotion_over_scene_inference"
        : "dominant_contract_over_cultural_emotion",
    });
  }

  const explicitActivity = EXPLICIT_ACTIVITY_PATTERN.test(input.prompt);
  const activityCandidates = [
    {
      source: explicitActivity ? "explicit_prompt" : "locked_intent",
      value: input.lockedIntent.activity ?? "",
      priority: explicitActivity ? INTENT_SOURCE_PRIORITY.explicit_prompt : INTENT_SOURCE_PRIORITY.locked_intent,
    },
    {
      source: "dominant_contract",
      value: input.dominantContract.activity ?? "",
      priority: INTENT_SOURCE_PRIORITY.dominant_contract,
    },
    {
      source: "decomposed_v1",
      value: input.decomposedIntent.inferredActivity ?? "",
      priority: INTENT_SOURCE_PRIORITY.decomposed_v1,
    },
  ].filter((c) => c.value.length > 0);

  if (input.culturalExpansion.atmosphereOverActivity && input.dominantContract.activity) {
    activityCandidates.push({
      source: "cultural_expansion",
      value: input.dominantContract.activity,
      priority: INTENT_SOURCE_PRIORITY.cultural_expansion,
    });
  }

  const activityWinner = [...activityCandidates].sort((a, b) => b.priority - a.priority)[0]
    ?? { source: "inferred", value: "", priority: INTENT_SOURCE_PRIORITY.inferred };
  if (activityCandidates.length > 1 && new Set(activityCandidates.map((c) => c.value)).size > 1) {
    conflicts.push({
      dimension: "activity",
      candidates: activityCandidates,
      winner: { source: activityWinner.source, value: activityWinner.value },
      rule: input.culturalExpansion.atmosphereOverActivity
        ? "cultural_atmosphere_preserves_resolved_activity"
        : "explicit_activity_over_inferred",
    });
  }

  const sceneCandidates = [
    {
      source: "cultural_expansion",
      value: input.culturalExpansion.sceneId ?? "",
      priority: input.culturalExpansion.culturalDominance >= 0.45
        ? INTENT_SOURCE_PRIORITY.cultural_expansion + 10
        : INTENT_SOURCE_PRIORITY.cultural_expansion,
    },
    {
      source: "decomposed_v1",
      value: input.decomposedIntent.scene ?? "",
      priority: INTENT_SOURCE_PRIORITY.decomposed_v1,
    },
    {
      source: "scene_profile",
      value: input.decomposedIntent.culturalRefs[0] ?? "",
      priority: INTENT_SOURCE_PRIORITY.scene_profile,
    },
  ].filter((c) => c.value.length > 0);

  const sceneWinner = [...sceneCandidates].sort((a, b) => b.priority - a.priority)[0]
    ?? { source: "cultural_expansion", value: "", priority: INTENT_SOURCE_PRIORITY.cultural_expansion };
  if (sceneCandidates.length > 1 && new Set(sceneCandidates.map((c) => c.value)).size > 1) {
    conflicts.push({
      dimension: "scene",
      candidates: sceneCandidates,
      winner: { source: sceneWinner.source, value: sceneWinner.value },
      rule: "cultural_kb_over_legacy_scene_labels",
    });
  }

  const atmospheres = [...new Set([
    ...input.culturalExpansion.atmospheres,
    ...input.culturalExpansion.scene.atmospheres,
    ...input.dominantContract.scene.atmosphere,
  ])];

  return {
    genre: {
      families: genreFamilies,
      primarySubgenre: input.dominantContract.primarySubgenre ?? input.lockedIntent.primarySubgenre,
      source: genreWinner.source,
    },
    emotion: {
      dominant: input.dominantContract.dominantEmotion,
      explicit: input.dominantContract.dominantEmotionExplicit,
      moodTags: [...input.lockedIntent.mood],
      source: emotionWinner.source,
    },
    activity: {
      value: input.dominantContract.activity,
      priority: input.dominantContract.activityPriority,
      source: activityWinner.source,
    },
    culturalScene: {
      sceneId: input.culturalExpansion.sceneId,
      atmospheres,
      culturalTags: input.culturalExpansion.culturalTags,
      themes: input.culturalExpansion.themes,
      sceneConcepts: input.culturalExpansion.sceneConcepts,
      culturalDominance: input.culturalExpansion.culturalDominance,
      atmosphereOverActivity: input.culturalExpansion.atmosphereOverActivity,
      source: sceneWinner.source,
    },
    conflicts,
  };
}

export function buildAuthoritativeIntentContract(opts: {
  prompt: string;
  mode?: "strict" | "balanced" | "chaotic";
  fallbacks?: LockedIntentFallbacks;
  emotionProfile?: EmotionProfile;
  noLibraryMode?: boolean;
}): AuthoritativeIntentContract {
  const prompt = opts.prompt.trim();
  const lockedIntent = completeLockedIntent(buildLockedIntent(prompt), opts.fallbacks ?? {});
  const decomposedIntent = decomposeIntent(prompt);
  const culturalExpansion = expandCulturalReferences(prompt);
  const promptSceneProfile = buildPromptSceneProfile(prompt);

  const dominantContract = buildDominantIntentContract({
    prompt,
    intentContract: {
      primarySubgenre: lockedIntent.primarySubgenre,
      genreFamilies: lockedIntent.genreFamilies,
      activity: lockedIntent.activity,
      places: [],
      eraRange: lockedIntent.eraRange,
      explicitDimensions: lockedIntent.interpretationBudget?.appliedDimensions ?? [],
    },
    lockedIntent,
    emotionProfile: opts.emotionProfile,
    mode: opts.mode ?? "balanced",
    noLibraryMode: opts.noLibraryMode ?? false,
  });

  const intentState = buildIntentState(prompt, {
    lockedIntent,
    decomposedIntent,
    culturalExpansion,
  });

  const resolved = resolveIntentConflicts({
    prompt,
    lockedIntent,
    decomposedIntent,
    culturalExpansion,
    dominantContract,
  });

  const buildSignature = signature([
    resolved.genre.families.sort().join(","),
    resolved.emotion.dominant,
    resolved.activity.value,
    resolved.culturalScene.sceneId,
    resolved.culturalScene.atmospheres.slice(0, 4).join(","),
    dominantContract.intentSignature,
  ]);

  return {
    version: AUTHORITATIVE_INTENT_VERSION,
    prompt,
    lockedIntent,
    decomposedIntent,
    culturalExpansion,
    dominantContract,
    intentState,
    promptSceneProfile,
    genre: resolved.genre,
    emotion: resolved.emotion,
    activity: resolved.activity,
    culturalScene: resolved.culturalScene,
    conflicts: resolved.conflicts,
    buildSignature,
  };
}

export function validateAuthoritativeIntentContract(contract: AuthoritativeIntentContract): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (contract.dominantContract.rawPrompt !== contract.prompt) {
    errors.push("dominant_contract_prompt_mismatch");
  }
  if (contract.decomposedIntent.raw !== contract.prompt) {
    errors.push("decomposed_intent_prompt_mismatch");
  }
  if (
    contract.genre.families.length > 0 &&
    contract.dominantContract.genreFamilies.length > 0 &&
    contract.genre.families.join(",") !== contract.dominantContract.genreFamilies.join(",")
  ) {
    errors.push("genre_slice_drift_from_dominant_contract");
  }
  if (
    contract.culturalScene.sceneId &&
    contract.culturalExpansion.sceneId &&
    contract.culturalScene.sceneId !== contract.culturalExpansion.sceneId
  ) {
    errors.push("cultural_scene_id_drift");
  }
  return { valid: errors.length === 0, errors };
}
