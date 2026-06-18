/**
 * Scene alias graph — weak cultural scene → genre cluster mappings (Q3 foundation).
 * Used for retrieval boosts and coherence scoring, NOT hard taxonomy.
 */

import type { DecomposedIntent } from "../core/intent-decomposer";
import { getRuntimePromotedAliases } from "./harvested-alias-runtime";

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
  "gta-driving": ["hip_hop", "electronic", "rock", "rnb"],
  "grand-theft-auto": ["hip_hop", "electronic", "rock", "rnb"],
  "cyberpunk-night": ["electronic", "synth", "industrial", "rock"],
  "blade-runner": ["electronic", "ambient", "synth", "jazz"],
  "drive-movie": ["synth", "electronic", "pop", "indie"],
  "john-wick": ["electronic", "rock", "metal", "hip_hop"],
  "stranger-things": ["synth", "electronic", "pop", "rock"],
  "interstellar": ["orchestral", "ambient", "electronic", "classical"],
  "fight-club": ["rock", "electronic", "industrial", "metal"],
  "euphoria": ["rnb", "pop", "electronic", "indie"],
  "skyrim": ["orchestral", "ambient", "folk", "classical"],
  "minecraft": ["ambient", "electronic", "lofi", "indie"],
  "fifa-night": ["electronic", "hip_hop", "pop", "house"],
  "party-night": ["pop", "hip_hop", "electronic", "dance"],
};

const promotedGraphOverrides = new Map<string, string[]>();

export function registerPromotedGraphAliases(term: string, aliases: string[]): void {
  const key = term.toLowerCase().trim().replace(/\s+/g, "-");
  if (!key || aliases.length === 0) return;
  promotedGraphOverrides.set(key, aliases.slice(0, 8));
  SCENE_ALIAS_GRAPH[key] = aliases.slice(0, 8);
}

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
  "gta": ["hip_hop", "electronic", "rock"],
  "cyberpunk": ["electronic", "synth", "industrial"],
  "blade-runner": ["electronic", "ambient", "synth"],
  "john-wick": ["electronic", "rock", "metal"],
  "stranger-things": ["synth", "electronic", "pop"],
  "interstellar": ["orchestral", "ambient", "electronic"],
  "minecraft": ["ambient", "electronic", "lofi"],
  "fifa": ["electronic", "hip_hop", "pop"],
  "volvo": ["blues", "indie", "rock", "folk"],
  "saab": ["blues", "indie", "rock", "folk"],
  "e46": ["blues", "indie", "rock", "electronic"],
};

export function resolveSceneAliases(sceneKey: string): string[] {
  const normalized = sceneKey.toLowerCase().trim().replace(/\s+/g, "-");
  const promoted = getRuntimePromotedAliases(normalized);
  if (promoted && promoted.length > 0) return promoted;
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

/** Build weighted scene prediction map for coherence scoring and diagnostics. */
export function scenePredictionFromAliases(
  sceneAliases: string[],
  confidence = 0.5,
): Record<string, number> {
  if (sceneAliases.length === 0) return {};
  const base = Math.max(0.15, Math.min(0.45, confidence * 0.5));
  const entries = sceneAliases.map((alias, index) => {
    const weight = Math.max(0.05, base - index * 0.04);
    return [alias, Math.round(weight * 100) / 100] as const;
  });
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return Object.fromEntries(entries.map(([alias, weight]) => [alias, Math.round((weight / total) * 100) / 100]));
}

/** Merge alias prediction with semantic scene prediction (diagnostics + coherence). */
export function mergeScenePredictions(
  primary: Record<string, number>,
  aliasPrediction: Record<string, number>,
): Record<string, number> {
  const combined: Record<string, number> = { ...primary };
  for (const [key, weight] of Object.entries(aliasPrediction)) {
    combined[key] = Math.round(((combined[key] ?? 0) + weight * 0.65) * 100) / 100;
  }
  const entries = Object.entries(combined).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;
  return Object.fromEntries(entries.map(([k, w]) => [k, Math.round((w / total) * 100) / 100]));
}
