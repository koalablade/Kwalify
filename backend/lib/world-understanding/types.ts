/**
 * World Understanding Layer — human meaning between prompt and scoring.
 */

export type ConceptCategory =
  | "environment"
  | "activity"
  | "social"
  | "emotion"
  | "lifeContext"
  | "sensory";

export interface WorldConceptTaxonomy {
  environment: string[];
  activity: string[];
  social: string[];
  emotion: string[];
  lifeContext: string[];
  sensory: string[];
}

export interface PhraseMatch {
  id: string;
  phrase: string;
  notLiteral?: string;
  meaning: Partial<Record<ConceptCategory | "weather" | "time", string[]>>;
  music?: {
    energy?: number;
    tempoBpm?: [number, number];
    textures?: string[];
    genres?: string[];
  };
}

export interface ComposedScene {
  id: string;
  label: string;
  humanSummary: string;
  score: number;
  properties: {
    environment: string[];
    emotion: string[];
    musicBehaviourId: string;
  };
}

export interface MusicBehaviourModel {
  id: string;
  energy: number;
  tempoBpm: [number, number];
  preferredGenres: string[];
  avoidGenres: string[];
  textures: string[];
  arrangement: string[];
  sequence: {
    beginning: string;
    middle: string;
    ending: string;
  };
}

export interface FuzzyExpansion {
  id: string;
  matchedTrigger: string;
  concepts: Partial<Record<ConceptCategory | "weather" | "time", string[]>>;
  sceneHint?: string;
}

export interface WorldUnderstandingResult {
  prompt: string;
  taxonomy: WorldConceptTaxonomy;
  scene: ComposedScene;
  sceneGraph: import("./scene-graph").EmotionalSceneGraph;
  musicBehaviour: MusicBehaviourModel;
  matchedPhrases: PhraseMatch[];
  fuzzyExpansions: FuzzyExpansion[];
  humanNarrative: string;
  humanMeanings: string[];
  confidence: number;
  debug: {
    matchedConceptIds: Record<string, string[]>;
    paraphraseCluster?: string;
    matchedConcepts: string[];
    graphExperiences?: string[];
    graphMatches?: Array<{ id: string; domain: string; cue: string }>;
  };
}

export interface KnowledgeConcept {
  id: string;
  label: string;
  synonyms: string[];
}
