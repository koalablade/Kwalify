/**
 * Cultural reference expansion — data-driven scene knowledge layer.
 * KB lives in scene-knowledge/; this module handles matching, weighting, and merge.
 */

import type { DominantEmotion } from "../core/dominant-intent-contract";
import type { SceneDimensionProfile } from "./track-semantic-types";
import {
  SCENE_KNOWLEDGE_ENTRIES,
  type AtmosphereDimension,
  type SceneKnowledgeEntry,
} from "./scene-knowledge";

export type { AtmosphereDimension };

export type CulturalReferenceCategory = SceneKnowledgeEntry["category"];
export type CulturalReferenceEntry = SceneKnowledgeEntry;

export type ExpandedCulturalContext = {
  matchedIds: string[];
  culturalRefs: string[];
  sceneId: string | null;
  atmospheres: AtmosphereDimension[];
  themes: string[];
  sceneConcepts: string[];
  culturalTags: string[];
  scene: SceneDimensionProfile;
  /** Scene-genre hints for alias graph only — not hard intent contract genres. */
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  dominantEmotion: DominantEmotion;
  atmosphereOverActivity: boolean;
  culturalDominance: number;
  atmosphereSignature: string;
};

const SCENE_GENRE_ALIASES: Record<string, string[]> = {
  "cozy-mystery": ["jazz", "classical", "ambient", "folk", "soundtrack"],
  "victorian-detective": ["classical", "jazz", "ambient", "folk", "soundtrack"],
  "horror-suspense": ["ambient", "rock", "electronic", "classical", "soundtrack"],
  "cosmic-horror": ["ambient", "classical", "electronic", "metal", "soundtrack"],
  "epic-fantasy": ["orchestral", "folk", "ambient", "classical"],
  "desert-epic": ["orchestral", "ambient", "electronic", "world", "soundtrack"],
  "dystopian": ["electronic", "industrial", "ambient", "rock", "classical"],
  "neo-noir": ["jazz", "electronic", "ambient", "trip_hop", "soundtrack"],
  "tokyo-night": ["electronic", "ambient", "indie", "synth", "jazz"],
  "paris-cafe": ["jazz", "classical", "ambient", "indie", "folk"],
  "garage-midnight": ["blues", "indie", "rock", "folk", "ambient"],
  "literary-reading": ["ambient", "classical", "jazz", "folk"],
  "japan-atmosphere": ["electronic", "ambient", "indie", "jazz"],
  "france-atmosphere": ["jazz", "chanson", "classical", "folk"],
  "italy-atmosphere": ["classical", "folk", "jazz", "ambient"],
  "scandinavia-atmosphere": ["ambient", "electronic", "indie", "folk"],
  "uk-atmosphere": ["rock", "indie", "folk", "electronic"],
  "usa-atmosphere": ["rock", "country", "hip_hop", "indie"],
  "small-town-america": ["folk", "country", "indie", "rock"],
  "london-night": ["rock", "indie", "electronic", "jazz"],
  "berlin-warehouse": ["electronic", "techno", "ambient", "industrial"],
  "new-york-city": ["hip_hop", "jazz", "electronic", "indie"],
  "los-angeles": ["rock", "hip_hop", "electronic", "indie"],
  "manchester-night": ["rock", "indie", "electronic", "hip_hop"],
  "chicago-blues": ["blues", "jazz", "hip_hop", "soul"],
  "seoul-night": ["electronic", "pop", "hip_hop", "ambient"],
  "hong-kong-night": ["electronic", "jazz", "ambient", "soundtrack"],
  "amsterdam-canal": ["electronic", "indie", "jazz", "folk"],
  "lisbon-fado": ["folk", "jazz", "world", "ambient"],
  "sci-fi-future": ["electronic", "ambient", "orchestral", "classical"],
  "literary-adventure": ["jazz", "folk", "classical", "blues"],
  "desolate-americana": ["folk", "country", "ambient", "classical"],
  "cyberpunk-night": ["electronic", "ambient", "synth", "industrial"],
  "space-epic": ["orchestral", "ambient", "electronic", "classical"],
  "cyber-dystopia": ["electronic", "industrial", "rock", "metal"],
  "mafia-noir": ["classical", "jazz", "soundtrack", "orchestral"],
  "gotham-noir": ["orchestral", "electronic", "rock", "ambient"],
  "post-apocalyptic": ["ambient", "electronic", "folk", "rock"],
  "gta-driving": ["hip_hop", "electronic", "rock", "rnb"],
  "western-frontier": ["country", "folk", "ambient", "orchestral"],
  "minecraft-calm": ["ambient", "electronic", "lofi", "indie"],
  "dark-fantasy": ["orchestral", "ambient", "metal", "classical"],
  "jazz-age": ["jazz", "blues", "classical", "swing"],
  "post-war": ["jazz", "swing", "classical", "folk"],
  "seventies-retro": ["rock", "soul", "funk", "disco"],
  "eighties-retro": ["synth", "pop", "rock", "electronic"],
  "nineties-retro": ["rock", "hip_hop", "electronic", "indie"],
  "y2k-internet": ["electronic", "pop", "synth", "hip_hop"],
  "cold-war": ["electronic", "classical", "jazz", "ambient"],
  "life-transition": ["indie", "folk", "ambient", "pop"],
  "new-chapter": ["indie", "pop", "rock", "electronic"],
  "life-reflection": ["jazz", "classical", "folk", "ambient"],
  "heartbreak": ["indie", "rnb", "pop", "soul"],
  "road-trip": ["rock", "indie", "country", "electronic"],
  "night-shift": ["electronic", "ambient", "indie", "lofi"],
  "last-train": ["indie", "electronic", "ambient", "jazz"],
  "solo-travel": ["indie", "electronic", "folk", "ambient"],
  "maker-focus": ["electronic", "ambient", "indie", "rock"],
  "rainy-scene": ["indie", "electronic", "jazz", "ambient"],
  "storm-scene": ["rock", "electronic", "orchestral", "ambient"],
  "fog-scene": ["ambient", "classical", "electronic", "jazz"],
  "winter-scene": ["ambient", "classical", "indie", "folk"],
  "summer-heat": ["pop", "reggae", "electronic", "hip_hop"],
  "sunrise-scene": ["ambient", "electronic", "indie", "classical"],
  "sunset-scene": ["indie", "folk", "electronic", "jazz"],
  "motorbike-open-road": ["rock", "electronic", "indie", "metal"],
  "skate-punk-scene": ["punk", "rock", "indie", "hip_hop"],
};

function emptyScene(): SceneDimensionProfile {
  return { places: [], times: [], activities: [], weather: [], atmospheres: [] };
}

function mergeUnique<T extends string>(...lists: T[][]): T[] {
  return [...new Set(lists.flat())];
}

function entryWeight(entry: SceneKnowledgeEntry): number {
  return entry.signalWeight ?? 1;
}

function scoreEntry(prompt: string, entry: SceneKnowledgeEntry): number {
  let score = 0;
  for (const pattern of entry.patterns) {
    if (pattern.test(prompt)) score += 1;
  }
  return score * entryWeight(entry);
}

export function expandCulturalReferences(prompt: string): ExpandedCulturalContext {
  const trimmed = prompt.trim();
  const scene = emptyScene();
  if (!trimmed) {
    return {
      matchedIds: [],
      culturalRefs: [],
      sceneId: null,
      atmospheres: [],
      themes: [],
      sceneConcepts: [],
      culturalTags: [],
      scene,
      genreFamilies: [],
      eraRange: null,
      dominantEmotion: null,
      atmosphereOverActivity: false,
      culturalDominance: 0,
      atmosphereSignature: "",
    };
  }

  const matched = SCENE_KNOWLEDGE_ENTRIES
    .map((entry) => ({ entry, score: scoreEntry(trimmed, entry) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aAtmos = a.entry.atmosphereOverActivity ? 1 : 0;
      const bAtmos = b.entry.atmosphereOverActivity ? 1 : 0;
      if (bAtmos !== aAtmos) return bAtmos - aAtmos;
      return a.entry.id === "reading-context" ? 1 : b.entry.id === "reading-context" ? -1 : 0;
    });

  const primary = matched[0]?.entry ?? null;
  const secondary = matched
    .slice(1, 4)
    .map(({ entry }) => entry)
    .filter((entry) => entry.id !== "reading-context" || !primary || primary.id === "reading-context");

  const allEntries = primary ? [primary, ...secondary] : [];

  const atmospheres = mergeUnique(allEntries.flatMap((e) => e.atmospheres));
  const themes = mergeUnique(allEntries.flatMap((e) => e.themes));
  const sceneConcepts = mergeUnique(allEntries.flatMap((e) => e.sceneConcepts));
  const culturalTags = mergeUnique(allEntries.flatMap((e) => e.culturalTags));
  const genreFamilies = mergeUnique(
    allEntries
      .filter((e) => entryWeight(e) >= 0.5)
      .flatMap((e) => e.genreFamilies),
  ).slice(0, 8);

  scene.places = mergeUnique(allEntries.flatMap((e) => e.places ?? []));
  scene.times = mergeUnique(allEntries.flatMap((e) => e.times ?? []));
  scene.weather = mergeUnique(allEntries.flatMap((e) => e.weather ?? []));
  scene.atmospheres = mergeUnique(scene.atmospheres, allEntries.flatMap((e) => e.atmospheres));

  const eraRange = primary?.eraRange
    ?? allEntries.find((e) => e.eraRange)?.eraRange
    ?? null;

  const primaryWeight = primary ? entryWeight(primary) : 0;
  const culturalDominance = primary
    ? Math.min(1, (0.35 + matched[0]!.score * 0.18) * Math.max(0.35, primaryWeight))
    : 0;

  const atmosphereOverActivity = allEntries.some((e) => e.atmosphereOverActivity && entryWeight(e) >= 0.5)
    && culturalDominance >= 0.45
    && primary?.id !== "reading-context";

  const dominantEmotion = primary?.dominantEmotion ?? null;
  const matchedIds = allEntries.map((e) => e.id);
  const culturalRefs = mergeUnique(matchedIds, allEntries.map((e) => e.sceneId));

  const atmosphereSignature = mergeUnique(
    atmospheres,
    culturalTags.slice(0, 4),
    sceneConcepts.slice(0, 2),
  ).sort().join("|");

  return {
    matchedIds,
    culturalRefs,
    sceneId: primary?.sceneId ?? null,
    atmospheres,
    themes,
    sceneConcepts,
    culturalTags,
    scene,
    genreFamilies,
    eraRange,
    dominantEmotion,
    atmosphereOverActivity,
    culturalDominance,
    atmosphereSignature,
  };
}

export function getSceneGenreAliases(sceneId: string): string[] {
  return SCENE_GENRE_ALIASES[sceneId] ?? [];
}

export function mergeExpansionIntoSceneProfile(
  base: SceneDimensionProfile & {
    culturalTags?: string[];
    themes?: string[];
    sceneConcepts?: string[];
  },
  expansion: ExpandedCulturalContext,
): {
  places: string[];
  times: string[];
  activities: string[];
  weather: string[];
  atmospheres: string[];
  culturalTags: string[];
  themes: string[];
  sceneConcepts: string[];
} {
  return {
    places: mergeUnique(base.places ?? [], expansion.scene.places),
    times: mergeUnique(base.times ?? [], expansion.scene.times),
    activities: base.activities ?? [],
    weather: mergeUnique(base.weather ?? [], expansion.scene.weather),
    atmospheres: mergeUnique(base.atmospheres ?? [], expansion.scene.atmospheres, expansion.atmospheres),
    culturalTags: mergeUnique(base.culturalTags ?? [], expansion.culturalTags),
    themes: mergeUnique(base.themes ?? [], expansion.themes),
    sceneConcepts: mergeUnique(base.sceneConcepts ?? [], expansion.sceneConcepts),
  };
}

export function resolveActivityWithCulturalContext(
  activity: string | null,
  prompt: string,
  expansion: ExpandedCulturalContext,
): string | null {
  if (!expansion.atmosphereOverActivity) return activity;
  const lower = prompt.toLowerCase();
  const softActivities = new Set(["focus", "reading", "listening", "studying", "relaxing"]);
  if (activity && softActivities.has(activity)) {
    if (/\b(?:driv|gym|party|workout|run|sleep)\b/i.test(lower)) return activity;
    return "listening";
  }
  return activity;
}

export function listCulturalReferenceEntries(): ReadonlyArray<SceneKnowledgeEntry> {
  return SCENE_KNOWLEDGE_ENTRIES;
}

export function registerCulturalReferenceEntry(entry: SceneKnowledgeEntry): void {
  const exists = SCENE_KNOWLEDGE_ENTRIES.some((e) => e.id === entry.id);
  if (exists) return;
  SCENE_KNOWLEDGE_ENTRIES.push(entry);
  if (entry.genreFamilies.length > 0 && entryWeight(entry) >= 0.5) {
    SCENE_GENRE_ALIASES[entry.sceneId] = entry.genreFamilies;
  }
}
