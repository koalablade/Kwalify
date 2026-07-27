import emotionsData from "../../data/world-knowledge/emotions.json";
import activitiesData from "../../data/world-knowledge/activities.json";
import locationsData from "../../data/world-knowledge/locations.json";
import weatherData from "../../data/world-knowledge/weather.json";
import relationshipsData from "../../data/world-knowledge/relationships.json";
import lifeEventsData from "../../data/world-knowledge/life_events.json";
import timeContextsData from "../../data/world-knowledge/time_contexts.json";
import objectsData from "../../data/world-knowledge/objects.json";
import phrasesData from "../../data/world-knowledge/phrases.json";
import scenesData from "../../data/world-knowledge/scenes.json";
import musicBehavioursData from "../../data/world-knowledge/music_behaviours.json";
import fuzzyConceptsData from "../../data/world-knowledge/fuzzy_concepts.json";
import type { ConceptCategory, KnowledgeConcept } from "./types";

type ConceptFile = { concepts: KnowledgeConcept[] };

const CATEGORY_FILES: Record<ConceptCategory, ConceptFile> = {
  emotion: emotionsData as ConceptFile,
  activity: activitiesData as ConceptFile,
  environment: locationsData as ConceptFile,
  social: relationshipsData as ConceptFile,
  lifeContext: lifeEventsData as ConceptFile,
  sensory: objectsData as ConceptFile,
};

export const WEATHER_CONCEPTS = (weatherData as ConceptFile).concepts;
export const TIME_CONCEPTS = (timeContextsData as ConceptFile).concepts;
export const PHRASES = phrasesData.phrases;
export const IDIOMS = phrasesData.idioms;
export const SLANG = phrasesData.slang;
export const SCENE_TEMPLATES = scenesData.scenes;
export const MUSIC_BEHAVIOURS = musicBehavioursData.behaviours;
export const FUZZY_EXPANSIONS = fuzzyConceptsData.expansions;
export const PARAPHRASE_CLUSTERS = fuzzyConceptsData.paraphraseClusters;

export interface IndexedCue {
  category: ConceptCategory | "weather" | "time";
  conceptId: string;
  label: string;
  cue: string;
  cueLength: number;
}

function indexConcepts(
  category: ConceptCategory | "weather" | "time",
  concepts: KnowledgeConcept[],
): IndexedCue[] {
  const out: IndexedCue[] = [];
  for (const concept of concepts) {
    for (const synonym of concept.synonyms) {
      out.push({
        category,
        conceptId: concept.id,
        label: concept.label,
        cue: synonym.toLowerCase(),
        cueLength: synonym.length,
      });
    }
    out.push({
      category,
      conceptId: concept.id,
      label: concept.label,
      cue: concept.label.toLowerCase(),
      cueLength: concept.label.length,
    });
  }
  return out;
}

const ALL_INDEXED_CUES: IndexedCue[] = [
  ...Object.entries(CATEGORY_FILES).flatMap(([category, file]) =>
    indexConcepts(category as ConceptCategory, file.concepts),
  ),
  ...indexConcepts("weather", WEATHER_CONCEPTS),
  ...indexConcepts("time", TIME_CONCEPTS),
].sort((a, b) => b.cueLength - a.cueLength);

const NEGATION_BEFORE_RE =
  /\b(?:not|no|never|wasn'?t|weren'?t|isn'?t|aren'?t|don'?t|didn'?t|can'?t|won'?t|hardly|barely)\s+$/i;

function isNegatedCue(lower: string, idx: number): boolean {
  const prefix = lower.slice(Math.max(0, idx - 24), idx);
  return NEGATION_BEFORE_RE.test(prefix);
}

export function matchIndexedCues(text: string): Array<{
  category: ConceptCategory | "weather" | "time";
  conceptId: string;
  label: string;
  cue: string;
}> {
  const lower = text.toLowerCase();
  const matched: Array<{
    category: ConceptCategory | "weather" | "time";
    conceptId: string;
    label: string;
    cue: string;
  }> = [];
  const usedSpans: Array<[number, number]> = [];

  for (const entry of ALL_INDEXED_CUES) {
    const idx = lower.indexOf(entry.cue);
    if (idx < 0) continue;
    if (isNegatedCue(lower, idx)) continue;
    const end = idx + entry.cue.length;
    const overlaps = usedSpans.some(([s, e]) => !(end <= s || idx >= e));
    if (overlaps) continue;
    usedSpans.push([idx, end]);
    matched.push({
      category: entry.category,
      conceptId: entry.conceptId,
      label: entry.label,
      cue: entry.cue,
    });
  }
  return matched;
}

export function getConceptLabel(
  category: ConceptCategory | "weather" | "time",
  id: string,
): string {
  const lists: Record<string, KnowledgeConcept[]> = {
    ...Object.fromEntries(
      Object.entries(CATEGORY_FILES).map(([k, v]) => [k, v.concepts]),
    ),
    weather: WEATHER_CONCEPTS,
    time: TIME_CONCEPTS,
  };
  const concept = lists[category]?.find((c) => c.id === id);
  return concept?.label ?? id.replace(/_/g, " ");
}
