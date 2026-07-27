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
import { detectEra, hasEraSignal, type EraContext } from "./era-detection";
import { propagateGraph, type GraphApplyResult } from "./knowledge-graph";
import {
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
import { interpretSemantics, type SemanticInterpretation } from "./semantic-interpreter";
import { resolveSceneBus } from "./scene-resolution-bus";
import {
  applyWorldUnderstandingToProfile,
  interpretWorld,
  type WorldUnderstandingResult,
} from "./world-understanding";

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
  eraContext: EraContext;
  semanticInterpretation: SemanticInterpretation;
  worldUnderstanding: WorldUnderstandingResult;
  pipelineSummary: Record<string, unknown>;
}

export interface MomentPipelineOptions {
  /** When set, force canonical scene from an explicit mood id. */
  moodSceneId?: string | null;
}

/** Blend semantic emotion delta into a base profile by weight (0–1). */
function blendSemanticDelta(
  base: EmotionProfile,
  delta: Partial<EmotionProfile>,
  weight: number
): EmotionProfile {
  const w = Math.min(weight, 0.55); // never let semantic fully override keyword layer
  const lerp = (a: number, b: number) => a * (1 - w) + b * w;
  return {
    energy: lerp(base.energy, delta.energy ?? base.energy),
    valence: lerp(base.valence, delta.valence ?? base.valence),
    tension: lerp(base.tension, delta.tension ?? base.tension),
    nostalgia: lerp(base.nostalgia, delta.nostalgia ?? base.nostalgia),
    calm: lerp(base.calm, delta.calm ?? base.calm),
    environment: delta.environment ?? base.environment,
    timeOfDay: delta.timeOfDay ?? base.timeOfDay,
    motionState: delta.motionState ?? base.motionState,
  };
}

export function analyzeMomentPipeline(
  vibe: string,
  opts?: MomentPipelineOptions
): MomentPipelineResult {
  const text = vibe.toLowerCase().trim();

  // 0. Semantic interpretation — handles ANY phrase including abstract/creative inputs
  const semantic = interpretSemantics(vibe);

  // 0b. World understanding — human meaning layer (moments, not keywords)
  const worldUnderstanding = interpretWorld(vibe);

  // 1. Intent (before everything else)
  const intent = decodeIntent(vibe);

  // 2. Canonical scene — explicit mood id wins over vibe text
  const resolvedBus = resolveSceneBus(vibe, { moodSceneId: opts?.moodSceneId });
  let canonical = resolvedBus.canonical;

  const prototype = canonicalToPrototype(canonical);

  // 3. Base profile — keyword layer only when canonical is weak (anti tag-soup)
  const keywordProfile = analyzeVibe(vibe);
  let profile = profileFromCanonical(canonical, keywordProfile);

  // 3a. World understanding blend — nudges profile toward human scene meaning
  if (worldUnderstanding.confidence >= 0.35) {
    const worldWeight = canonical && canonical.confidence >= 0.72 ? 0.18 : 0.34;
    profile = applyWorldUnderstandingToProfile(profile, worldUnderstanding, worldWeight);
  }

  // 3b. Semantic blend — applies when canonical is weak or absent (handles ANY phrase)
  const canonicalIsWeak = !canonical || canonical.confidence < 0.62;
  if (canonicalIsWeak && semantic.confidence > 0.18) {
    const blendWeight = semantic.confidence * 0.5;
    profile = blendSemanticDelta(profile, semantic.emotionDelta, blendWeight);
    // Fill scene context gaps from semantic
    if (!profile.environment && semantic.sceneContext.environment) {
      profile = { ...profile, environment: semantic.sceneContext.environment };
    }
    if (!profile.timeOfDay && semantic.sceneContext.timeOfDay) {
      profile = { ...profile, timeOfDay: semantic.sceneContext.timeOfDay };
    }
    if (!profile.motionState && semantic.sceneContext.motionState) {
      profile = { ...profile, motionState: semantic.sceneContext.motionState };
    }
  }

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

  // 10. Era layer — treat decade keywords as sonic aesthetic universes, not date filters
  const eraContext = detectEra(vibe);
  if (hasEraSignal(eraContext)) {
    profile = {
      ...profile,
      nostalgia: Math.min(1, profile.nostalgia + eraContext.nostalgiaBoost),
      energy: Math.min(1, Math.max(0, profile.energy + eraContext.energyDelta * 0.5)),
    };
  }

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
    sceneBusSource: resolvedBus.source,
    semanticSceneId: resolvedBus.semanticSceneId,
    prototype: prototype?.id ?? null,
    emotionTrajectory: physics.emotionTrajectory,
    emotionVector: physics.vector,
    forces: physics.forces,
    graphActive: graph.activeConcepts,
    graphHops: graph.propagationPath.slice(0, 8),
    usedKeywordSoup: !canonical || canonical.confidence < 0.62,
    era: eraContext.decade
      ? { decade: eraContext.decade, confidence: eraContext.eraConfidence, aesthetic: eraContext.sonicAesthetic }
      : null,
    semantic: {
      primaryCluster: semantic.primaryCluster,
      secondaryCluster: semantic.secondaryCluster,
      confidence: semantic.confidence,
      isAbstract: semantic.isAbstract,
      hasContrast: semantic.hasContrast,
      narrativeType: semantic.narrativeType,
      aestheticTags: semantic.aestheticTags.slice(0, 6),
      summary: semantic.summary,
    },
    worldUnderstanding: {
      sceneId: worldUnderstanding.scene.id,
      sceneLabel: worldUnderstanding.scene.label,
      humanSummary: worldUnderstanding.scene.humanSummary,
      confidence: worldUnderstanding.confidence,
      emotions: worldUnderstanding.taxonomy.emotion.slice(0, 6),
      environment: worldUnderstanding.taxonomy.environment.slice(0, 6),
      musicEnergy: worldUnderstanding.musicBehaviour.energy,
      preferredGenres: worldUnderstanding.musicBehaviour.preferredGenres.slice(0, 5),
      semanticMoment: {
        activity: worldUnderstanding.semanticMoment.activity.values.slice(0, 4),
        movement: worldUnderstanding.semanticMoment.movement.values.slice(0, 4),
        weather: worldUnderstanding.semanticMoment.weather.values.slice(0, 4),
        emotionalGoal: worldUnderstanding.semanticMoment.emotionalGoal,
        fingerprintConfidence: worldUnderstanding.semanticMoment.confidence,
      },
    },
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
    eraContext,
    semanticInterpretation: semantic,
    worldUnderstanding,
    pipelineSummary,
  };
}
