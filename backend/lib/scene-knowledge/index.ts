import { COUNTRY_REGION_ENTRIES, CITY_ENTRIES } from "./entries-countries-cities";
import { AUTHOR_ENTRIES, FILM_TV_ENTRIES, GAME_ENTRIES } from "./entries-authors-media";
import {
  ERA_ENTRIES,
  LIFE_MOMENT_ENTRIES,
  WEATHER_ENTRIES,
  TRANSPORT_OBJECT_ENTRIES,
  HOBBY_JOB_SUBCULTURE_ENTRIES,
} from "./entries-life-context";
import { MISC_CONTEXT_ENTRIES } from "./entries-misc-context";
import type { SceneKnowledgeEntry } from "./types";

export type { AtmosphereDimension, SceneKnowledgeCategory, SceneKnowledgeEntry } from "./types";
export { kb } from "./types";

export const SCENE_KNOWLEDGE_ENTRIES: SceneKnowledgeEntry[] = [
  ...AUTHOR_ENTRIES,
  ...COUNTRY_REGION_ENTRIES,
  ...CITY_ENTRIES,
  ...FILM_TV_ENTRIES,
  ...GAME_ENTRIES,
  ...ERA_ENTRIES,
  ...LIFE_MOMENT_ENTRIES,
  ...WEATHER_ENTRIES,
  ...TRANSPORT_OBJECT_ENTRIES,
  ...HOBBY_JOB_SUBCULTURE_ENTRIES,
  ...MISC_CONTEXT_ENTRIES,
];

export function sceneKnowledgeEntryIds(): string[] {
  return SCENE_KNOWLEDGE_ENTRIES.map((e) => e.id);
}

export function findSceneKnowledgeById(id: string): SceneKnowledgeEntry | undefined {
  return SCENE_KNOWLEDGE_ENTRIES.find((e) => e.id === id);
}

/** Terms in prompt not covered by any KB pattern — for harvest review. */
export function uncoveredPromptTerms(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const tokens = (lower.match(/[a-z0-9][a-z0-9'-]*/gi) ?? []).filter((t) => t.length > 2);
  const covered = new Set<string>();
  for (const entry of SCENE_KNOWLEDGE_ENTRIES) {
    for (const pattern of entry.patterns) {
      if (pattern.test(prompt)) {
        covered.add(entry.id);
        for (const tag of [...entry.culturalTags, entry.sceneId, entry.id]) covered.add(tag);
      }
    }
  }
  return tokens.filter((t) => ![...covered].some((c) => c.includes(t) || t.includes(c)));
}
