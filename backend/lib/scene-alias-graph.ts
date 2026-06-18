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
  "uk-grime": ["hip_hop"],
  "uk-rap": ["hip_hop"],
  "uk-drill": ["hip_hop"],
  "uk-garage-grime": ["hip_hop", "electronic"],
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

/** Build weighted scene prediction map — dominant scene wins, not flat average. */
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
  const dominantKey = entries[0]?.[0];
  const boosted = Object.fromEntries(
    entries.map(([alias, weight], index) => {
      const scaled = index === 0 ? weight * 2.1 : weight * 0.42;
      return [alias, scaled] as const;
    }),
  );
  const total = Object.values(boosted).reduce((sum, weight) => sum + weight, 0) || 1;
  const normalized = Object.fromEntries(
    Object.entries(boosted).map(([alias, weight]) => [alias, Math.round((weight / total) * 100) / 100]),
  );
  if (dominantKey && (normalized[dominantKey] ?? 0) < 0.38) {
    normalized[dominantKey] = 0.42;
    const tail = Object.entries(normalized).filter(([key]) => key !== dominantKey);
    const tailTotal = tail.reduce((sum, [, w]) => sum + w, 0) || 1;
    for (const [key, weight] of tail) {
      normalized[key] = Math.round((weight / tailTotal) * 0.58 * 100) / 100;
    }
  }
  return normalized;
}

/** Merge alias prediction with semantic scene prediction — dominant scene wins, not average. */
export function mergeScenePredictions(
  primary: Record<string, number>,
  aliasPrediction: Record<string, number>,
): Record<string, number> {
  const combined: Record<string, number> = { ...primary };
  for (const [key, weight] of Object.entries(aliasPrediction)) {
    combined[key] = Math.round(((combined[key] ?? 0) + weight * 0.65) * 100) / 100;
  }
  const sorted = Object.entries(combined).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sorted.length === 0) return {};

  const [dominantKey, dominantWeight] = sorted[0]!;
  const boosted = Object.fromEntries(
    sorted.map(([key, weight]) => {
      const scaled = key === dominantKey ? dominantWeight * 2.2 : weight * 0.38;
      return [key, scaled] as const;
    }),
  );
  const total = Object.values(boosted).reduce((sum, w) => sum + w, 0) || 1;
  const normalized = Object.fromEntries(
    Object.entries(boosted).map(([k, w]) => [k, Math.round((w / total) * 100) / 100]),
  );
  if (dominantKey && (normalized[dominantKey] ?? 0) < 0.38) {
    const remainder = Object.entries(normalized).filter(([k]) => k !== dominantKey);
    const dominantShare = 0.42;
    const tailTotal = remainder.reduce((sum, [, w]) => sum + w, 0) || 1;
    normalized[dominantKey] = dominantShare;
    for (const [key, weight] of remainder) {
      normalized[key] = Math.round((weight / tailTotal) * (1 - dominantShare) * 100) / 100;
    }
  }
  return normalized;
}
