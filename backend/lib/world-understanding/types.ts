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

export type PlaylistIntent =
  | "escape"
  | "celebrate"
  | "recover"
  | "focus"
  | "cry"
  | "remember"
  | "heal"
  | "drive"
  | "relax"
  | "process"
  | "transition"
  | "nostalgia"
  | "unknown";

export interface AtlasConsultation {
  entryId: string;
  label: string;
  domain: string;
  matchScore: number;
  reason: string;
}

export interface SemanticFingerprint {
  themes: string[];
  physicalContext: string[];
  emotionalSignals: string[];
  temporalSignals: string[];
  relationalSignals: string[];
  sensorySignals: string[];
  narrativeFrame: string | null;
  energyImplied: "low" | "medium" | "high" | null;
  confidence: number;
}

export interface HumanExperience {
  inferredQualities: string[];
  sharedMemories: string[];
  playlistIntent: PlaylistIntent;
  playlistIntentConfidence: number;
  musicalBehaviours: string[];
  narrative: string;
  emotionalArcSummary: string;
  atlasConsultations: AtlasConsultation[];
  semanticFingerprint: SemanticFingerprint;
  interpretationReasons: string[];
}

export interface EmotionalArcPhase {
  label: string;
  emotion: string;
  weight: number;
}

export interface EmotionalArc {
  phases: EmotionalArcPhase[];
  summary: string;
}

export interface WorldUnderstandingResult {
  prompt: string;
  taxonomy: WorldConceptTaxonomy;
  /** Multi-dimensional semantic fingerprint — primary moment representation */
  semanticMoment: import("./moment-representation").SemanticMomentFingerprint;
  scene: ComposedScene;
  sceneGraph: import("./scene-graph").EmotionalSceneGraph;
  musicBehaviour: MusicBehaviourModel;
  matchedPhrases: PhraseMatch[];
  fuzzyExpansions: FuzzyExpansion[];
  humanNarrative: string;
  humanMeanings: string[];
  confidence: number;
  humanExperience: HumanExperience;
  emotionalArc: EmotionalArc;
  debug: {
    matchedConceptIds: Record<string, string[]>;
    paraphraseCluster?: string;
    matchedConcepts: string[];
    graphExperiences?: string[];
    graphMatches?: Array<{ id: string; domain: string; cue: string }>;
    intent?: { kind: string; confidence: number; trigger?: string };
    sceneCandidates?: Array<{
      id: string;
      label: string;
      humanMoment: string;
      score: number;
      momentReasons?: string[];
    }>;
    momentInterpretation?: {
      dominantStory: string | null;
      narrativeDominance: number;
      weatherIsSecondary: boolean;
      primaryConcepts: Array<{
        label: string;
        category: string;
        physical: number;
        emotional: number;
        narrative: number;
      }>;
      lifeEvents: Array<{ category: string; trigger: string }>;
      temporal: Array<{ phase: string; trigger: string }>;
    };
    sceneConfidence?: {
      detectedMoment: { id: string; label: string; humanMoment: string; score: number };
      positiveSignals: string[];
      rejectedAlternatives: Array<{
        id: string;
        label: string;
        score: number;
        gap: number;
        reasons: string[];
      }>;
      conceptPriority: Array<{
        label: string;
        category: string;
        role: "primary" | "secondary" | "ambient";
        weights: { physical: number; emotional: number; narrative: number };
      }>;
      lifeEvents: string[];
      temporalPhases: string[];
      narrativeOverPhysical: boolean;
    };
    humanExperience?: {
      inferredQualities: string[];
      sharedMemories: string[];
      playlistIntent: PlaylistIntent;
      musicalBehaviours: string[];
      narrative: string;
      emotionalArcSummary: string;
      atlasConsultations: AtlasConsultation[];
      interpretationReasons: string[];
    };
    experienceReasoning?: {
      chains: Array<{ id: string; phase: string; experiences: string[] }>;
      hops: string[];
      prioritizedConcepts: Array<{ label: string; category: string; score: number; role: string }>;
      alternativeInterpretations: string[];
      confidence: number;
    };
    semanticFingerprint?: SemanticFingerprint;
    emotionalArc?: EmotionalArc;
  };
}

export interface KnowledgeConcept {
  id: string;
  label: string;
  synonyms: string[];
}
