import commonLanguageData from "../../data/world-knowledge/common-language.json";
import emotionsLibraryData from "../../data/world-knowledge/emotions.json";
import weatherContextsData from "../../data/world-knowledge/weather-contexts.json";
import placesData from "../../data/world-knowledge/places.json";
import activitiesLibraryData from "../../data/world-knowledge/activities.json";
import timeContextsData from "../../data/world-knowledge/time-contexts.json";
import socialContextsData from "../../data/world-knowledge/social-contexts.json";
import movementData from "../../data/world-knowledge/movement.json";
import sensoryLanguageData from "../../data/world-knowledge/sensory-language.json";
import musicDescriptorsData from "../../data/world-knowledge/music-descriptors.json";
import ukContextData from "../../data/world-knowledge/uk-context.json";
import type { WorldConceptTaxonomy } from "./types";

export type MusicDirection = {
  energy: string;
  tempo: string;
  texture: string;
  genres?: string[];
};

export type UniversalEntry = {
  id: string;
  cues: string[];
  meaning?: string;
  emotions?: string[];
  emotion?: string[];
  situations?: string[];
  music?: MusicDirection;
  music_direction?: MusicDirection;
  music_translation?: MusicDirection;
  music_style?: MusicDirection;
  typical_music?: MusicDirection;
  concepts?: string[];
  atmosphere?: string[];
  emotional_links?: string[];
  emotional_association?: string[];
  emotional_meaning?: string[];
  associated_scenes?: string[];
  name?: string;
  phrase?: string;
  activity?: string;
  movement?: string;
  event?: string;
  time?: string;
  weather?: string;
  family?: string;
  sense?: string;
  description?: string;
};

export const COMMON_LANGUAGE = (commonLanguageData as { phrases: UniversalEntry[] }).phrases;
export const EMOTION_LIBRARY = (
  emotionsLibraryData as { emotions?: UniversalEntry[] }
).emotions ?? [];
export const WEATHER_CONTEXTS = (weatherContextsData as { entries: UniversalEntry[] }).entries;
export const PLACES = (placesData as { places: UniversalEntry[] }).places;
export const ACTIVITY_LIBRARY = (
  activitiesLibraryData as { library?: UniversalEntry[] }
).library ?? [];
export const TIME_CONTEXTS = (timeContextsData as { contexts: UniversalEntry[] }).contexts;
export const SOCIAL_CONTEXTS = (socialContextsData as { contexts: UniversalEntry[] }).contexts;
export const MOVEMENTS = (movementData as { movements: UniversalEntry[] }).movements;
export const SENSORY_LANGUAGE = (sensoryLanguageData as { entries: UniversalEntry[] }).entries;
export const MUSIC_DESCRIPTORS = (musicDescriptorsData as { descriptors: UniversalEntry[] }).descriptors;
export const UK_CONTEXT = (ukContextData as { entries: UniversalEntry[] }).entries;

export interface UniversalMatch {
  source: string;
  entry: UniversalEntry;
  matchedCue: string;
  score: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchEntries(
  text: string,
  entries: UniversalEntry[],
  source: string,
  limit = 6,
): UniversalMatch[] {
  const lower = normalize(text);
  const matches: UniversalMatch[] = [];
  for (const entry of entries) {
    const cues = [...(entry.cues ?? [])].sort((a, b) => b.length - a.length);
    for (const cue of cues) {
      const needle = cue.toLowerCase();
      if (!needle || !lower.includes(needle)) continue;
      matches.push({
        source,
        entry,
        matchedCue: cue,
        score: needle.length + (needle.includes(" ") ? 14 : 0),
      });
      break;
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function matchUniversalKnowledge(text: string): UniversalMatch[] {
  return [
    ...matchEntries(text, COMMON_LANGUAGE, "language", 4),
    ...matchEntries(text, EMOTION_LIBRARY, "emotion_lib", 6),
    ...matchEntries(text, WEATHER_CONTEXTS, "weather_ctx", 4),
    ...matchEntries(text, PLACES, "place", 5),
    ...matchEntries(text, ACTIVITY_LIBRARY, "activity_lib", 5),
    ...matchEntries(text, TIME_CONTEXTS, "time_ctx", 4),
    ...matchEntries(text, SOCIAL_CONTEXTS, "social_ctx", 4),
    ...matchEntries(text, MOVEMENTS, "movement", 5),
    ...matchEntries(text, SENSORY_LANGUAGE, "sensory_lang", 5),
    ...matchEntries(text, MUSIC_DESCRIPTORS, "music_desc", 3),
    ...matchEntries(text, UK_CONTEXT, "uk_ctx", 4),
  ].sort((a, b) => b.score - a.score);
}

export function getEntryEmotions(entry: UniversalEntry): string[] {
  return (
    entry.emotions ??
    entry.emotion ??
    entry.emotional_association ??
    entry.emotional_links ??
    entry.emotional_meaning ??
    []
  );
}

export function getEntryMeaning(entry: UniversalEntry): string | undefined {
  return entry.meaning ?? entry.description;
}

export function getEntryLabel(entry: UniversalEntry): string {
  return (
    entry.phrase ??
    entry.name ??
    entry.activity ??
    entry.movement ??
    entry.event ??
    entry.time ??
    entry.weather ??
    entry.description ??
    entry.id
  );
}

export function buildHumanMeanings(matches: UniversalMatch[]): string[] {
  const meanings: string[] = [];
  for (const hit of matches) {
    const meaning = getEntryMeaning(hit.entry);
    if (meaning && !meanings.includes(meaning)) meanings.push(meaning);
  }
  return meanings.slice(0, 4);
}

export function applyUniversalMatchesToTaxonomy(
  matches: UniversalMatch[],
  taxonomy: WorldConceptTaxonomy,
): { taxonomy: WorldConceptTaxonomy; matchedConcepts: string[]; sceneHints: string[] } {
  const next: WorldConceptTaxonomy = {
    environment: [...taxonomy.environment],
    activity: [...taxonomy.activity],
    social: [...taxonomy.social],
    emotion: [...taxonomy.emotion],
    lifeContext: [...taxonomy.lifeContext],
    sensory: [...taxonomy.sensory],
  };
  const matchedConcepts: string[] = [];
  const sceneHints: string[] = [];

  const pushUnique = (arr: string[], values: string[]) => {
    for (const v of values) {
      const label = v.replace(/_/g, " ");
      if (!arr.includes(label)) arr.push(label);
    }
  };

  for (const hit of matches) {
    const { entry, source } = hit;
    matchedConcepts.push(`${source}:${entry.id}`);
    pushUnique(next.emotion, getEntryEmotions(entry));
    pushUnique(next.sensory, entry.atmosphere ?? entry.emotional_links ?? []);
    pushUnique(next.environment, entry.concepts ?? []);
    if (entry.family) pushUnique(next.environment, [entry.family]);
    if (entry.activity) pushUnique(next.activity, [entry.activity]);
    if (entry.movement) pushUnique(next.activity, [entry.movement]);
    if (entry.event) pushUnique(next.social, [entry.event]);
    if (entry.time) pushUnique(next.environment, [entry.time]);
    if (entry.weather) pushUnique(next.environment, [entry.weather]);
    if (entry.sense) pushUnique(next.sensory, [entry.sense]);
    if (entry.associated_scenes?.length) sceneHints.push(entry.associated_scenes[0]);
  }

  for (const key of Object.keys(next) as (keyof WorldConceptTaxonomy)[]) {
    next[key] = next[key].slice(0, 12);
  }

  return { taxonomy: next, matchedConcepts, sceneHints };
}
