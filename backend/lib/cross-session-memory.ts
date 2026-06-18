/**
 * Cross-session prompt memory (Q10) — recall scene/genre preferences per user + prompt.
 */

import { db, promptSceneMemoryTable } from "../db";
import { eq, and } from "drizzle-orm";

export type PromptSceneMemory = {
  promptHash: string;
  sceneKey: string | null;
  genreFamilies: string[];
  coherenceScore: number | null;
  familiarityMode: string | null;
  generationCount: number;
};

function hashPrompt(prompt: string): string {
  let hash = 0;
  const normalized = prompt.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `p${Math.abs(hash).toString(36)}`;
}

export async function loadPromptSceneMemory(
  userId: string,
  prompt: string,
): Promise<PromptSceneMemory | null> {
  const promptHash = hashPrompt(prompt);
  const [row] = await db
    .select()
    .from(promptSceneMemoryTable)
    .where(and(
      eq(promptSceneMemoryTable.userId, userId),
      eq(promptSceneMemoryTable.promptHash, promptHash),
    ))
    .limit(1);

  if (!row) return null;
  return {
    promptHash: row.promptHash,
    sceneKey: row.sceneKey,
    genreFamilies: Array.isArray(row.genreFamilies) ? row.genreFamilies as string[] : [],
    coherenceScore: row.coherenceScore,
    familiarityMode: row.familiarityMode,
    generationCount: row.generationCount,
  };
}

export async function recordPromptSceneMemory(opts: {
  userId: string;
  prompt: string;
  sceneKey?: string | null;
  genreFamilies?: string[];
  coherenceScore?: number | null;
  familiarityMode?: string | null;
}): Promise<void> {
  const promptHash = hashPrompt(opts.prompt);
  const genreFamilies = (opts.genreFamilies ?? []).slice(0, 8);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(promptSceneMemoryTable)
    .where(and(
      eq(promptSceneMemoryTable.userId, opts.userId),
      eq(promptSceneMemoryTable.promptHash, promptHash),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(promptSceneMemoryTable)
      .set({
        sceneKey: opts.sceneKey ?? existing.sceneKey,
        genreFamilies: genreFamilies.length > 0 ? genreFamilies : existing.genreFamilies,
        coherenceScore: opts.coherenceScore ?? existing.coherenceScore,
        familiarityMode: opts.familiarityMode ?? existing.familiarityMode,
        generationCount: existing.generationCount + 1,
        updatedAt: now,
      })
      .where(eq(promptSceneMemoryTable.id, existing.id));
    return;
  }

  await db.insert(promptSceneMemoryTable).values({
    userId: opts.userId,
    promptHash,
    promptSample: opts.prompt.slice(0, 200),
    sceneKey: opts.sceneKey ?? null,
    genreFamilies,
    coherenceScore: opts.coherenceScore ?? null,
    familiarityMode: opts.familiarityMode ?? null,
    generationCount: 1,
    updatedAt: now,
  });
}

export function mergeCrossSessionSceneAliases(
  sceneAliases: string[],
  memory: PromptSceneMemory | null,
): string[] {
  if (!memory) return sceneAliases;
  const merged = [...sceneAliases];
  if (memory.sceneKey && !merged.includes(memory.sceneKey)) {
    merged.unshift(memory.sceneKey);
  }
  for (const family of memory.genreFamilies) {
    if (!merged.includes(family)) merged.push(family);
  }
  return merged.slice(0, 8);
}
