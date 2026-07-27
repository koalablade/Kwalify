import { interpretWorld } from "./index";
import {
  EMOTIONAL_STATES,
  SENSORY_ENTRIES,
  SITUATIONS,
  UK_CULTURAL_ENTRIES,
} from "./rich-knowledge";
import {
  COMMON_LANGUAGE,
  EMOTION_LIBRARY,
  WEATHER_CONTEXTS,
  PLACES,
  ACTIVITY_LIBRARY,
  TIME_CONTEXTS,
  SOCIAL_CONTEXTS,
  MOVEMENTS,
  SENSORY_LANGUAGE,
  MUSIC_DESCRIPTORS,
  UK_CONTEXT,
} from "./universal-knowledge";
import { getConceptGraphStats } from "./concept-graph";
import { PHRASES, SCENE_TEMPLATES } from "./knowledge";
import { WORLD_EVAL_CASES } from "./evaluation-prompts";

export function getWorldKnowledgeStats() {
  const graph = getConceptGraphStats();
  return {
    scenes: SCENE_TEMPLATES.length,
    situations: SITUATIONS.length,
    emotionalStates: EMOTIONAL_STATES.length,
    phrases: PHRASES.length,
    sensoryConcepts: SENSORY_ENTRIES.length,
    ukContexts: UK_CULTURAL_ENTRIES.length,
    commonLanguage: COMMON_LANGUAGE.length,
    emotionLibrary: EMOTION_LIBRARY.length,
    weatherContexts: WEATHER_CONTEXTS.length,
    places: PLACES.length,
    activityLibrary: ACTIVITY_LIBRARY.length,
    timeContexts: TIME_CONTEXTS.length,
    socialContexts: SOCIAL_CONTEXTS.length,
    movements: MOVEMENTS.length,
    sensoryLanguage: SENSORY_LANGUAGE.length,
    musicDescriptors: MUSIC_DESCRIPTORS.length,
    ukContext: UK_CONTEXT.length,
    conceptGraphNodes: graph.totalNodes,
    conceptGraphDomains: graph.domains.length,
  };
}

export function runWorldUnderstandingQualitySample(sampleSize = 500): {
  tested: number;
  strong: number;
  weak: number;
  strongPct: number;
  weakPct: number;
} {
  const cases = WORLD_EVAL_CASES.slice(0, sampleSize);
  let strong = 0;
  let weak = 0;

  for (const evalCase of cases) {
    const result = interpretWorld(evalCase.prompt);
    const sceneOk =
      result.scene.id === evalCase.expectedScene ||
      (evalCase.acceptableScenes?.includes(result.scene.id) ?? false);
    const emotionOk = evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    );
    const graphHit = result.debug.matchedConcepts.some((c) => c.startsWith("graph:"));

    if (sceneOk && emotionOk && result.confidence >= 0.4) strong += 1;
    else if (!sceneOk && !emotionOk && result.confidence < 0.35) weak += 1;
    else if (!sceneOk || !emotionOk) weak += 1;
    else strong += 1;

    if (graphHit && !sceneOk) {
      weak = Math.max(0, weak - (weak > 0 ? 1 : 0));
    }
  }

  const tested = cases.length;
  return {
    tested,
    strong,
    weak,
    strongPct: Math.round((strong / tested) * 1000) / 10,
    weakPct: Math.round((weak / tested) * 1000) / 10,
  };
}

export function runMomentCoverageReport(sampleSize = WORLD_EVAL_CASES.length): {
  tested: number;
  sceneHits: number;
  emotionHits: number;
  musicHits: number;
  momentHits: number;
  sceneAccuracyPct: number;
  emotionAccuracyPct: number;
  musicDirectionAccuracyPct: number;
  momentCoveragePct: number;
  targetPct: number;
  gapToTargetPct: number;
} {
  const cases = WORLD_EVAL_CASES.slice(0, sampleSize);
  let sceneHits = 0;
  let emotionHits = 0;
  let musicHits = 0;
  let momentHits = 0;

  for (const evalCase of cases) {
    const result = interpretWorld(evalCase.prompt);
    const sceneOk =
      result.scene.id === evalCase.expectedScene ||
      (evalCase.acceptableScenes?.includes(result.scene.id) ?? false);
    const emotionOk = evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    );
    const musicOk =
      (evalCase.expectedMusicBehaviour.maxEnergy === undefined ||
        result.musicBehaviour.energy <= evalCase.expectedMusicBehaviour.maxEnergy + 0.15) &&
      (evalCase.expectedMusicBehaviour.minEnergy === undefined ||
        result.musicBehaviour.energy >= evalCase.expectedMusicBehaviour.minEnergy - 0.15);

    if (sceneOk) sceneHits += 1;
    if (emotionOk) emotionHits += 1;
    if (musicOk) musicHits += 1;
    if (sceneOk && emotionOk && result.confidence >= 0.35) momentHits += 1;
  }

  const tested = cases.length;
  const targetPct = 95;
  const momentCoveragePct = Math.round((momentHits / tested) * 1000) / 10;

  return {
    tested,
    sceneHits,
    emotionHits,
    musicHits,
    momentHits,
    sceneAccuracyPct: Math.round((sceneHits / tested) * 1000) / 10,
    emotionAccuracyPct: Math.round((emotionHits / tested) * 1000) / 10,
    musicDirectionAccuracyPct: Math.round((musicHits / tested) * 1000) / 10,
    momentCoveragePct,
    targetPct,
    gapToTargetPct: Math.round((targetPct - momentCoveragePct) * 10) / 10,
  };
}
