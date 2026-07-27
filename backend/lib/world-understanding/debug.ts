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
  situationMatches: string[];
  matchedPhrases: Array<{ phrase: string; notLiteral?: string }>;
  fuzzyExpansions: Array<{ id: string; trigger: string }>;
  matchedConcepts: string[];
  musicDirection: {
    energy: number;
    energyLabel: string;
    tempoBpm: [number, number];
    tempoLabel: string;
    preferredGenres: string[];
    avoidGenres: string[];
    textures: string[];
    progression: string;
    sequence: { beginning: string; middle: string; ending: string };
  };
  humanNarrative: string;
  humanMeanings: string[];
  graphExperiences: string[];
  graphMatches: Array<{ id: string; domain: string; cue: string }>;
  intent: { kind: string; confidence: number; trigger?: string };
  sceneCandidates: Array<{ rank: number; id: string; label: string; humanMoment: string; score: number }>;
  confidence: number;
  momentInterpretation?: WorldUnderstandingResult["debug"]["momentInterpretation"];
  sceneConfidence?: WorldUnderstandingResult["debug"]["sceneConfidence"];
  humanExperience?: WorldUnderstandingResult["humanExperience"];
  emotionalArc?: WorldUnderstandingResult["emotionalArc"];
  semanticFingerprint?: WorldUnderstandingResult["debug"]["semanticFingerprint"];
  semanticMoment?: WorldUnderstandingResult["semanticMoment"];
  experienceReasoning?: WorldUnderstandingResult["debug"]["experienceReasoning"];
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
    situationMatches: result.debug.matchedConcepts
      .filter((c) => c.startsWith("situation:"))
      .map((c) => c.replace("situation:", "")),
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
      tempoLabel: `${result.musicBehaviour.tempoBpm[0]}-${result.musicBehaviour.tempoBpm[1]} BPM`,
      preferredGenres: result.musicBehaviour.preferredGenres,
      avoidGenres: result.musicBehaviour.avoidGenres,
      textures: result.musicBehaviour.textures,
      progression: result.sceneGraph.music.progression,
      sequence: result.musicBehaviour.sequence,
    },
    humanNarrative: result.humanNarrative,
    humanMeanings: result.humanMeanings,
    graphExperiences: result.debug.graphExperiences ?? [],
    graphMatches: result.debug.graphMatches ?? [],
    intent: result.debug.intent ?? { kind: "unknown", confidence: 0 },
    sceneCandidates: (result.debug.sceneCandidates ?? []).map((c, i) => ({
      rank: i + 1,
      id: c.id,
      label: c.label,
      humanMoment: c.humanMoment,
      score: c.score,
    })),
    confidence: result.confidence,
    momentInterpretation: result.debug.momentInterpretation,
    sceneConfidence: result.debug.sceneConfidence,
    humanExperience: result.humanExperience,
    emotionalArc: result.emotionalArc,
    semanticFingerprint: result.debug.semanticFingerprint,
    semanticMoment: result.semanticMoment,
    experienceReasoning: result.debug.experienceReasoning,
  };
}
