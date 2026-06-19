/**
 * Scene knowledge types — reusable semantic framework for prompts.
 */

import type { DominantEmotion } from "../../core/dominant-intent-contract";

export type AtmosphereDimension =
  | "mystery"
  | "suspense"
  | "melancholy"
  | "nostalgia"
  | "wonder"
  | "adventure"
  | "urban"
  | "rural"
  | "industrial"
  | "futuristic"
  | "vintage"
  | "romantic"
  | "lonely"
  | "reflective"
  | "cinematic"
  | "intellectual"
  | "dreamlike"
  | "nocturnal"
  | "epic"
  | "uncanny"
  | "cozy"
  | "foreboding";

export type SceneKnowledgeCategory =
  | "author"
  | "book"
  | "universe"
  | "period"
  | "literary-genre"
  | "country"
  | "region"
  | "city"
  | "location"
  | "concept"
  | "film"
  | "television"
  | "game"
  | "era"
  | "life-moment"
  | "weather"
  | "transport"
  | "object"
  | "job"
  | "hobby"
  | "subculture";

export type SceneKnowledgeEntry = {
  id: string;
  category: SceneKnowledgeCategory;
  patterns: RegExp[];
  sceneId: string;
  atmospheres: AtmosphereDimension[];
  themes: string[];
  sceneConcepts: string[];
  culturalTags: string[];
  visual?: string[];
  places?: string[];
  times?: string[];
  weather?: string[];
  genreFamilies: string[];
  eraRange?: { start: number; end: number };
  dominantEmotion?: DominantEmotion;
  atmosphereOverActivity?: boolean;
  /** Weak signals (countries/regions) must not override genre/emotion/taste. Default 1. */
  signalWeight?: number;
};

export function kb(
  id: string,
  category: SceneKnowledgeCategory,
  patterns: RegExp[],
  sceneId: string,
  atmospheres: AtmosphereDimension[],
  culturalTags: string[],
  genreFamilies: string[],
  opts: Partial<Omit<SceneKnowledgeEntry, "id" | "category" | "patterns" | "sceneId" | "atmospheres" | "culturalTags" | "genreFamilies">> = {},
): SceneKnowledgeEntry {
  return {
    id,
    category,
    patterns,
    sceneId,
    atmospheres,
    themes: opts.themes ?? [],
    sceneConcepts: opts.sceneConcepts ?? [],
    culturalTags,
    genreFamilies,
    visual: opts.visual,
    places: opts.places,
    times: opts.times,
    weather: opts.weather,
    eraRange: opts.eraRange,
    dominantEmotion: opts.dominantEmotion,
    atmosphereOverActivity: opts.atmosphereOverActivity ?? (category !== "country" && category !== "region"),
    signalWeight: opts.signalWeight ?? (category === "country" || category === "region" ? 0.35 : 1),
  };
}
