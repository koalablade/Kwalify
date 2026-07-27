import type { WorldUnderstandingResult } from "./types";

export interface WorldUnderstandingDebugView {
  originalPrompt: string;
  understoodAs: {
    environment: string[];
    activity: string[];
    social: string[];
    emotion: string[];
    lifeContext: string[];
    sensory: string[];
  };
  scene: {
    id: string;
    label: string;
    humanSummary: string;
  };
  sceneGraph: WorldUnderstandingResult["sceneGraph"];
  matchedPhrases: Array<{ phrase: string; notLiteral?: string }>;
  fuzzyExpansions: Array<{ id: string; trigger: string }>;
  matchedConcepts: string[];
  musicDirection: {
    energy: number;
    energyLabel: string;
    tempoBpm: [number, number];
    preferredGenres: string[];
    avoidGenres: string[];
    textures: string[];
    progression: string;
    sequence: { beginning: string; middle: string; ending: string };
  };
  humanNarrative: string;
  confidence: number;
}

export function buildWorldUnderstandingDebug(
  result: WorldUnderstandingResult,
): WorldUnderstandingDebugView {
  return {
    originalPrompt: result.prompt,
    understoodAs: {
      environment: result.taxonomy.environment,
      activity: result.taxonomy.activity,
      social: result.taxonomy.social,
      emotion: result.taxonomy.emotion,
      lifeContext: result.taxonomy.lifeContext,
      sensory: result.taxonomy.sensory,
    },
    scene: {
      id: result.scene.id,
      label: result.scene.label,
      humanSummary: result.scene.humanSummary,
    },
    sceneGraph: result.sceneGraph,
    matchedPhrases: result.matchedPhrases.map((p) => ({
      phrase: p.phrase,
      notLiteral: p.notLiteral,
    })),
    fuzzyExpansions: result.fuzzyExpansions.map((e) => ({
      id: e.id,
      trigger: e.matchedTrigger,
    })),
    matchedConcepts: result.debug.matchedConcepts,
    musicDirection: {
      energy: result.musicBehaviour.energy,
      energyLabel: result.sceneGraph.music.energyLabel,
      tempoBpm: result.musicBehaviour.tempoBpm,
      preferredGenres: result.musicBehaviour.preferredGenres,
      avoidGenres: result.musicBehaviour.avoidGenres,
      textures: result.musicBehaviour.textures,
      progression: result.sceneGraph.music.progression,
      sequence: result.musicBehaviour.sequence,
    },
    humanNarrative: result.humanNarrative,
    confidence: result.confidence,
  };
}
