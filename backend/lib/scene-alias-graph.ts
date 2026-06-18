/**
 * Scene alias graph — weak cultural scene → genre cluster mappings (Q3 foundation).
 * Used for retrieval boosts and coherence scoring, NOT hard taxonomy.
 */

import type { DecomposedIntent } from "../core/intent-decomposer";

const SCENE_ALIAS_GRAPH: Record<string, string[]> = {
  "alt-rock-scene": ["rock", "metal", "indie", "punk"],
  "kerrang": ["rock", "metal", "indie", "punk"],
  "skate-punk-scene": ["punk", "rock", "indie"],
  "tony-hawk": ["punk", "rock", "indie"],
  "driving-electronic-rock": ["rock", "electronic", "metal", "hip_hop"],
  "need-for-speed": ["rock", "electronic", "metal", "hip_hop"],
  "forza-horizon": ["electronic", "rock", "hip_hop", "pop"],
  "driving-rock": ["rock", "electronic", "indie"],
  "top-gear": ["rock", "electronic", "indie"],
  "garage-repair": ["blues", "indie", "rock", "folk", "country"],
  "garage-workshop": ["blues", "indie", "rock", "folk"],
  "project-car": ["blues", "indie", "rock", "folk", "country"],
  "rainy-night-drive": ["indie", "electronic", "rock", "rnb"],
  "rainy-night-drive-scene": ["indie", "electronic", "rock", "rnb"],
};

const CULTURAL_REF_ALIASES: Record<string, string[]> = {
  "kerrang": ["rock", "metal", "indie", "punk"],
  "tony-hawk": ["punk", "rock", "indie"],
  "need-for-speed": ["rock", "electronic", "metal"],
  "forza-horizon": ["electronic", "rock", "hip_hop"],
  "top-gear": ["rock", "electronic", "indie"],
  "project-car": ["blues", "indie", "rock", "folk"],
  "garage-workshop": ["blues", "indie", "rock", "folk"],
  "garage-work": ["blues", "indie", "rock", "folk"],
  "rainy-night-drive": ["indie", "electronic", "rock", "rnb"],
};

export function resolveSceneAliases(sceneKey: string): string[] {
  const normalized = sceneKey.toLowerCase().trim().replace(/\s+/g, "-");
  return SCENE_ALIAS_GRAPH[normalized] ?? CULTURAL_REF_ALIASES[normalized] ?? [normalized];
}

export function resolveDecomposedSceneAliases(intent: DecomposedIntent): string[] {
  const keys = [
    intent.scene,
    ...intent.culturalRefs,
  ].filter((value): value is string => !!value);

  const families = new Set<string>();
  for (const key of keys) {
    for (const alias of resolveSceneAliases(key)) {
      families.add(alias);
    }
  }
  return [...families];
}

export function sceneAliasBoostWeight(termFrequency = 1): number {
  return Math.min(0.35, 0.08 + termFrequency * 0.02);
}
