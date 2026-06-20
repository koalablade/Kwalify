/**
 * Live trend ingestion (Q11) — fetch public charts + cache snapshots.
 */

import { db, trendSnapshotsTable } from "../db";
import { desc } from "drizzle-orm";
import { loadTrendHints, type TrendHint } from "./trend-ingestion";
import { logger } from "./logger";

export type LiveTrend = {
  term: string;
  genreFamilies: string[];
  weight: number;
  source: string;
};

const CACHE_MS = 6 * 60 * 60 * 1000;
let cachedLiveTrends: LiveTrend[] | null = null;
let cachedAt = 0;

async function fetchItunesTopTrends(): Promise<LiveTrend[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://itunes.apple.com/us/rss/topalbums/limit=25/json", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const data = await response.json() as {
      feed?: { entry?: Array<{ "im:name"?: { label?: string }; category?: { attributes?: { label?: string } } }> };
    };
    const entries = data.feed?.entry ?? [];
    return entries.slice(0, 15).map((entry, index) => {
      const genre = entry.category?.attributes?.label?.toLowerCase() ?? "pop";
      const families = genre.includes("hip") ? ["hip_hop", "rap", "pop"]
        : genre.includes("rock") ? ["rock", "indie", "alternative"]
          : genre.includes("country") ? ["country", "americana"]
            : genre.includes("electronic") ? ["electronic", "dance"]
              : ["pop", "rnb"];
      return {
        term: entry["im:name"]?.label?.toLowerCase() ?? `chart-${index}`,
        genreFamilies: families,
        weight: Math.max(0.08, 0.2 - index * 0.01),
        source: "itunes_rss",
      };
    });
  } catch (err) {
    logger.warn({ err }, "iTunes trend fetch failed");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function loadLatestSnapshot(): Promise<LiveTrend[]> {
  const [row] = await db
    .select()
    .from(trendSnapshotsTable)
    .orderBy(desc(trendSnapshotsTable.fetchedAt))
    .limit(1);
  if (!row || !Array.isArray(row.trends)) return [];
  return row.trends as LiveTrend[];
}

async function persistTrendSnapshot(source: string, trends: LiveTrend[]): Promise<void> {
  if (trends.length === 0) return;
  await db.insert(trendSnapshotsTable).values({
    source,
    trends,
    fetchedAt: new Date(),
  });
}

export async function refreshLiveTrends(force = false): Promise<LiveTrend[]> {
  if (!force && cachedLiveTrends && Date.now() - cachedAt < CACHE_MS) {
    return cachedLiveTrends;
  }

  const live = await fetchItunesTopTrends();
  const staticHints: LiveTrend[] = loadTrendHints().flatMap((hint: TrendHint) =>
    hint.terms.map((term) => ({
      term,
      genreFamilies: hint.genreFamilies,
      weight: hint.weight,
      source: "static_hints",
    })),
  );

  const merged = [...staticHints, ...live].slice(0, 40);
  if (live.length > 0) {
    await persistTrendSnapshot("itunes_rss", live);
  }

  cachedLiveTrends = merged.length > 0 ? merged : await loadLatestSnapshot();
  cachedAt = Date.now();
  return cachedLiveTrends;
}

export function matchLiveTrends(prompt: string, trends: LiveTrend[]): LiveTrend[] {
  const lower = prompt.toLowerCase();
  return trends.filter((trend) =>
    lower.includes(trend.term) ||
    trend.genreFamilies.some((genre) => lower.includes(genre.replace("_", " "))),
  );
}

export function liveTrendSceneAliases(prompt: string, trends: LiveTrend[]): string[] {
  const matches = matchLiveTrends(prompt, trends);
  return matches.map((match) => match.term.replace(/\s+/g, "-")).slice(0, 4);
}

export function liveTrendBoost(prompt: string, trends: LiveTrend[]): number {
  const matches = matchLiveTrends(prompt, trends);
  if (matches.length === 0) return 0;
  return Math.min(0.15, matches.reduce((sum, m) => sum + m.weight, 0));
}
