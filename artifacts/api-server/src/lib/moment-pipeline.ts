/**
 * Unified pre-scoring pipeline (deterministic, explainable, layered).
 *
 * Order:
 * 1. intent-decoder
 * 2. scene-canonicalizer
 * 3. scene-prototype
 * 4. minimal keyword base (only when canonical weak)
 * 5. knowledge graph 2-hop
 * 6. emotional physics
 * 7. sonic mapping
 * 8. experience scene (secondary, no duplicate if canonical strong)
 */

import { analyzeVibe, type EmotionProfile } from "./emotion";
import { parseEmotionalDestination, type JourneyArc } from "./emotion-destination";
import { propagateGraph, type GraphApplyResult } from "./knowledge-graph";
import {
  resolveCanonicalSceneFull,
  resolveMoodSceneById,
  canonicalToPrototype,
  profileFromCanonical,
  type CanonicalSceneResult,
} from "./scene-canonicalizer";
import type { ScenePrototype } from "./scene-prototypes";
import {
  getSonicProfile,
  applySonicProfileToEmotion,
  type SonicProfile,
} from "./scene-sonic-map";
import { decodeIntent, applyIntentToProfile, type IntentDecodeResult } from "./intent-decoder";
import {
  computeTrajectory,
  applyPhysicsToProfile,
  type EmotionalTrajectory,
} from "./emotional-physics";
import {
  matchExperienceScene,
  describeSceneMatch,
  getSceneJourneyArc,
} from "./scene-intelligence";

export interface MomentPipelineResult {
  profile: EmotionProfile;
  experienceScene: ReturnType<typeof describeSceneMatch>;
  journeyArc: JourneyArc;
  canonicalScene: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  sonicProfile: SonicProfile | null;
  intent: IntentDecodeResult;
  physics: EmotionalTrajectory;
  graph: GraphApplyResult;
  pipelineSummary: Record<string, unknown>;
}

export interface MomentPipelineOptions {
  /** When set (Emotion Grid tap), force canonical scene from UI mood id. */
  moodSceneId?: string | null;
}

export function analyzeMomentPipeline(
  vibe: string,
  opts?: MomentPipelineOptions
): MomentPipelineResult {
  const text = vibe.toLowerCase().trim();

  // 1. Intent (before everything else)
  const intent = decodeIntent(vibe);

  // 2. Canonical scene — UI mood id wins over vibe text
  const moodCanonical = opts?.moodSceneId ? resolveMoodSceneById(opts.moodSceneId) : null;
  const canonical = moodCanonical ?? resolveCanonicalSceneFull(text);
  const prototype = canonicalToPrototype(canonical);

  // 3. Base profile — keyword layer only when canonical is weak (anti tag-soup)
  const keywordProfile = analyzeVibe(vibe);
  let profile = profileFromCanonical(canonical, keywordProfile);

  // 4. Prototype structure on layers
  if (prototype) {
    if (prototype.motion && !profile.motionState) profile.motionState = prototype.motion;
    if (prototype.timeBias && !profile.timeOfDay) profile.timeOfDay = prototype.timeBias;
    if (prototype.environment && !profile.environment) profile.environment = prototype.environment;
  }

  // 5. Knowledge graph — 2-hop weighted propagation
  const graph = propagateGraph(profile, text, 2);
  profile = graph.profile;

  // 6. Destination + journey hints
  const destParse = parseEmotionalDestination(text);
  let journeyArc: JourneyArc = "default";
  if (destParse.journeyArc !== "default") journeyArc = destParse.journeyArc;
  else if (graph.suggestedJourneyArc) journeyArc = graph.suggestedJourneyArc;
  else if (prototype?.journeyArc) journeyArc = prototype.journeyArc;

  // 7. Emotional physics
  const physics = computeTrajectory(profile, journeyArc);
  profile = applyPhysicsToProfile(profile, physics, 0.28);
  if (physics.suggestedArc !== "default" && journeyArc === "default") {
    journeyArc = physics.suggestedArc;
  }

  // 8. Sonic mapping
  const sonic = getSonicProfile(canonical?.sceneId ?? null);
  if (sonic) {
    profile = applySonicProfileToEmotion(profile, sonic, 0.42);
  }

  // 9. Intent override (final profile nudge)
  applyIntentToProfile(profile, intent);

  // Experience scene — secondary when canonical confidence high
  const experienceMatch =
    canonical && canonical.confidence >= 0.65
      ? null
      : matchExperienceScene(text);
  if (experienceMatch && !canonical) {
    const sceneArc = getSceneJourneyArc(text, experienceMatch);
    if (sceneArc && journeyArc === "default") journeyArc = sceneArc;
  }

  const pipelineSummary = {
    intent: intent.intent,
    intentConfidence: intent.confidence,
    canonicalScene: canonical?.sceneId ?? null,
    canonicalConfidence: canonical?.confidence ?? 0,
    prototype: prototype?.id ?? null,
    emotionTrajectory: physics.emotionTrajectory,
    emotionVector: physics.vector,
    forces: physics.forces,
    graphActive: graph.activeConcepts,
    graphHops: graph.propagationPath.slice(0, 8),
    usedKeywordSoup: !canonical || canonical.confidence < 0.62,
  };

  return {
    profile,
    experienceScene: describeSceneMatch(experienceMatch),
    journeyArc,
    canonicalScene: canonical,
    prototype,
    sonicProfile: sonic,
    intent,
    physics,
    graph,
    pipelineSummary,
  };
}
