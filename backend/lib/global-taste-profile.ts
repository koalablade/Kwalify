/**
 * Global taste profile (Q10) — cross-session aggregate per user.
 */

import { db, userGlobalTasteTable, promptSceneMemoryTable, playlistHistoryTable } from "../db";
import { eq, desc } from "drizzle-orm";

export type GlobalTasteProfile = {
  userId: string;
  genreWeights: Record<string, number>;
  sceneWeights: Record<string, number>;
  artistWeights: Record<string, number>;
  generationCount: number;
  avgCoherence: number | null;
};

function bump(weights: Record<string, number>, key: string, delta: number): void {
  if (!key) return;
  weights[key] = Math.round(((weights[key] ?? 0) + delta) * 1000) / 1000;
}

export async function loadGlobalTasteProfile(userId: string): Promise<GlobalTasteProfile | null> {
  const [row] = await db
    .select()
    .from(userGlobalTasteTable)
    .where(eq(userGlobalTasteTable.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    genreWeights: (row.genreWeights ?? {}) as Record<string, number>,
    sceneWeights: (row.sceneWeights ?? {}) as Record<string, number>,
    artistWeights: (row.artistWeights ?? {}) as Record<string, number>,
    generationCount: row.generationCount,
    avgCoherence: row.avgCoherence,
  };
}

export async function refreshGlobalTasteProfile(userId: string): Promise<GlobalTasteProfile> {
  const genreWeights: Record<string, number> = {};
  const sceneWeights: Record<string, number> = {};
  let generationCount = 0;
  let coherenceSum = 0;
  let coherenceCount = 0;

  const promptRows = await db
    .select()
    .from(promptSceneMemoryTable)
    .where(eq(promptSceneMemoryTable.userId, userId))
    .limit(200);

  for (const row of promptRows) {
    generationCount += row.generationCount;
    if (row.sceneKey) bump(sceneWeights, row.sceneKey, 0.2 * row.generationCount);
    const families = Array.isArray(row.genreFamilies) ? row.genreFamilies as string[] : [];
    for (const family of families) bump(genreWeights, family, 0.15);
    if (typeof row.coherenceScore === "number") {
      coherenceSum += row.coherenceScore;
      coherenceCount += 1;
    }
  }

  const history = await db
    .select()
    .from(playlistHistoryTable)
    .where(eq(playlistHistoryTable.spotifyUserId, userId))
    .orderBy(desc(playlistHistoryTable.createdAt))
    .limit(50);

  generationCount = Math.max(generationCount, history.length);

  const profile: GlobalTasteProfile = {
    userId,
    genreWeights,
    sceneWeights,
    artistWeights: {},
    generationCount,
    avgCoherence: coherenceCount > 0 ? Math.round((coherenceSum / coherenceCount) * 100) / 100 : null,
  };

  await db
    .insert(userGlobalTasteTable)
    .values({
      userId,
      genreWeights: profile.genreWeights,
      sceneWeights: profile.sceneWeights,
      artistWeights: profile.artistWeights,
      generationCount: profile.generationCount,
      avgCoherence: profile.avgCoherence,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userGlobalTasteTable.userId,
      set: {
        genreWeights: profile.genreWeights,
        sceneWeights: profile.sceneWeights,
        artistWeights: profile.artistWeights,
        generationCount: profile.generationCount,
        avgCoherence: profile.avgCoherence,
        updatedAt: new Date(),
      },
    });

  return profile;
}

export function mergeGlobalTasteIntoSceneAliases(
  sceneAliases: string[],
  global: GlobalTasteProfile | null,
): string[] {
  if (!global) return sceneAliases;
  const merged = [...sceneAliases];
  const topScenes = Object.entries(global.sceneWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => key);
  for (const scene of topScenes) {
    if (!merged.includes(scene)) merged.unshift(scene);
  }
  const topGenres = Object.entries(global.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => key);
  for (const genre of topGenres) {
    if (!merged.includes(genre)) merged.push(genre);
  }
  return merged.slice(0, 8);
}

export function globalTasteRetrievalBoost(
  genreFamily: string | null | undefined,
  global: GlobalTasteProfile | null,
): number {
  if (!global || !genreFamily) return 0;
  const genre = global.genreWeights[genreFamily] ?? 0;
  const scene = global.sceneWeights[genreFamily] ?? 0;
  return Math.min(0.18, (genre + scene) * 0.06);
}
