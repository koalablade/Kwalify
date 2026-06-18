/**
 * Trend ingestion v1 (Q11) — lightweight cultural trend hints for retrieval boosts.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export type TrendHint = {
  id: string;
  terms: string[];
  genreFamilies: string[];
  sceneKeys: string[];
  weight: number;
};

const BUILTIN_TRENDS: TrendHint[] = [
  { id: "indie-sleaze-revival", terms: ["indie sleaze", "2024 indie", "tiktok indie"], genreFamilies: ["indie", "rock"], sceneKeys: ["alt-rock-scene"], weight: 0.18 },
  { id: "afrobeats-wave", terms: ["afrobeats", "amapiano", "nigerian"], genreFamilies: ["afrobeats", "hip_hop", "pop"], sceneKeys: ["party-night"], weight: 0.16 },
  { id: "slowcore-moment", terms: ["slowcore", "sad girl autumn", "bedroom"], genreFamilies: ["indie", "folk"], sceneKeys: ["rainy-night-drive"], weight: 0.14 },
];

let cachedTrends: TrendHint[] | null = null;

function trendFilePath(): string {
  return process.env.TREND_HINTS_PATH?.trim() ||
    path.join(process.cwd(), "backend", "data", "trend-hints.json");
}

export function loadTrendHints(): TrendHint[] {
  if (cachedTrends) return cachedTrends;

  const fromEnv = process.env.TREND_HINTS_JSON?.trim();
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as TrendHint[];
      cachedTrends = Array.isArray(parsed) ? parsed : BUILTIN_TRENDS;
      return cachedTrends;
    } catch {
      cachedTrends = BUILTIN_TRENDS;
      return cachedTrends;
    }
  }

  const file = trendFilePath();
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as TrendHint[];
      cachedTrends = Array.isArray(parsed) ? [...BUILTIN_TRENDS, ...parsed] : BUILTIN_TRENDS;
      return cachedTrends;
    } catch {
      cachedTrends = BUILTIN_TRENDS;
      return cachedTrends;
    }
  }

  cachedTrends = BUILTIN_TRENDS;
  return cachedTrends;
}

export function matchTrendHints(prompt: string): TrendHint[] {
  const lower = prompt.toLowerCase();
  return loadTrendHints().filter((hint) =>
    hint.terms.some((term) => lower.includes(term.toLowerCase())),
  );
}

export function trendSceneAliasesForPrompt(prompt: string): string[] {
  const matches = matchTrendHints(prompt);
  const families = new Set<string>();
  for (const hint of matches) {
    for (const family of hint.genreFamilies) families.add(family);
    for (const scene of hint.sceneKeys) families.add(scene);
  }
  return [...families];
}

export function trendRetrievalBoost(prompt: string): number {
  const matches = matchTrendHints(prompt);
  if (matches.length === 0) return 0;
  return Math.min(0.2, matches.reduce((sum, hint) => sum + hint.weight, 0));
}
