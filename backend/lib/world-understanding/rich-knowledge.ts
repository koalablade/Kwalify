import situationsData from "../../data/world-knowledge/situations.json";
import emotionalStatesData from "../../data/world-knowledge/emotional-states.json";
import sensoryContextsData from "../../data/world-knowledge/sensory-contexts.json";
import ukCulturalData from "../../data/world-knowledge/uk-cultural-context.json";
import conceptRelationshipsData from "../../data/world-knowledge/concept-relationships.json";
import type { WorldConceptTaxonomy } from "./types";

export type SituationEntry = {
  id: string;
  name: string;
  family: string;
  cues: string[];
  emotional_meaning: string[];
  related_emotions: string[];
  scene_hint: string;
  music?: { energy: number; textures: string[]; genres: string[] };
};

export type EmotionalStateEntry = {
  id: string;
  name: string;
  description: string;
  cues: string[];
  related_emotions: string[];
  music: { energy: number; tempo: string; texture: string[]; genres: string[] };
};

export type SensoryEntry = {
  name: string;
  cues: string[];
  concepts: string[];
  sensory: string[];
  emotional_links: string[];
  music_direction: { energy: string; texture: string; tempo: string };
};

export type UkCulturalEntry = {
  name: string;
  cues?: string[];
  concepts: string[];
  emotion?: string[];
  music: { energy: string; texture: string; tempo: string; genres: string[] };
};

export type ConceptRelationship = {
  concept: string;
  parents?: string[];
  children?: string[];
  related_scenes?: string[];
  environment?: string[];
  emotional_links: string[];
  sensory: string[];
  music: { genres: string[]; energy: string; texture: string };
};

export const SITUATIONS = (situationsData as { situations: SituationEntry[] }).situations;
export const EMOTIONAL_STATES = (emotionalStatesData as { states: EmotionalStateEntry[] }).states;
export const SENSORY_ENTRIES = (sensoryContextsData as { entries: SensoryEntry[] }).entries;
export const UK_CULTURAL_ENTRIES = (ukCulturalData as { entries: UkCulturalEntry[] }).entries;
export const CONCEPT_RELATIONSHIPS = (
  conceptRelationshipsData as { relationships: ConceptRelationship[] }
).relationships;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface RichMatch<T> {
  entry: T;
  matchedCue: string;
  score: number;
}

function matchByCues<T>(
  text: string,
  entries: T[],
  cueSelector: (e: T) => string[] = (e) => (e as { cues: string[] }).cues,
): RichMatch<T>[] {
  const lower = normalize(text);
  const matches: RichMatch<T>[] = [];
  for (const entry of entries) {
    const cues = [...cueSelector(entry)].sort((a, b) => b.length - a.length);
    for (const cue of cues) {
      const needle = cue.toLowerCase();
      if (!lower.includes(needle)) continue;
      matches.push({ entry, matchedCue: cue, score: needle.length + (needle.includes(" ") ? 12 : 0) });
      break;
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

export function matchSituations(text: string): RichMatch<SituationEntry>[] {
  return matchByCues(text, SITUATIONS).slice(0, 6);
}

export function matchEmotionalStates(text: string): RichMatch<EmotionalStateEntry>[] {
  return matchByCues(text, EMOTIONAL_STATES).slice(0, 6);
}

export function matchSensoryContexts(text: string): RichMatch<SensoryEntry>[] {
  return matchByCues(text, SENSORY_ENTRIES).slice(0, 6);
}

export function matchUkCultural(text: string): RichMatch<UkCulturalEntry>[] {
  return matchByCues(text, UK_CULTURAL_ENTRIES, (e) => [
    ...(e.cues ?? []),
    e.name,
  ]).slice(0, 4);
}

export function propagateConceptRelationships(
  text: string,
  taxonomy: WorldConceptTaxonomy,
): { taxonomy: WorldConceptTaxonomy; matched: string[] } {
  const lower = normalize(text);
  const matched: string[] = [];
  const next: WorldConceptTaxonomy = {
    environment: [...taxonomy.environment],
    activity: [...taxonomy.activity],
    social: [...taxonomy.social],
    emotion: [...taxonomy.emotion],
    lifeContext: [...taxonomy.lifeContext],
    sensory: [...taxonomy.sensory],
  };

  const pushUnique = (arr: string[], values: string[]) => {
    for (const v of values) {
      const label = v.replace(/_/g, " ");
      if (!arr.includes(label)) arr.push(label);
    }
  };

  for (const rel of CONCEPT_RELATIONSHIPS) {
    if (!lower.includes(rel.concept)) continue;
    matched.push(`relationship:${rel.concept}`);
    pushUnique(next.emotion, rel.emotional_links);
    pushUnique(next.sensory, rel.sensory);
    if (rel.environment) pushUnique(next.environment, rel.environment);
  }

  return { taxonomy: next, matched };
}

