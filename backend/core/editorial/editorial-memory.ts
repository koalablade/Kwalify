/**
 * Editorial memory — proven playlist structures for similar prompts.
 * Uses cross-session DB when available and an in-process LRU cache.
 */

import {
  loadPromptSceneMemory,
  recordPromptSceneMemory,
  type PromptSceneMemory,
} from "../../lib/cross-session-memory";
import type { EditorialIntentVector } from "./intent-collapse-layer";

export type EditorialStructureMemory = {
  promptHash: string;
  editorialWorldTag: string;
  preferredArchetypeId: string | null;
  laneMix: Record<string, number>;
  energyArc: "rise" | "flat" | "wave" | "cooldown";
  openingClusterId: string | null;
  avgCuratorScore: number;
  avgWouldSaveScore: number;
  successCount: number;
};

const memoryCache = new Map<string, EditorialStructureMemory>();
const MAX_CACHE = 500;

function hashPrompt(prompt: string): string {
  let hash = 0;
  const normalized = prompt.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `p${Math.abs(hash).toString(36)}`;
}

function cacheKey(userId: string, prompt: string): string {
  return `${userId}:${hashPrompt(prompt)}`;
}

function promptSceneToEditorial(row: PromptSceneMemory): EditorialStructureMemory {
  return {
    promptHash: row.promptHash,
    editorialWorldTag: row.sceneKey ?? "indie_balanced_default",
    preferredArchetypeId: row.sceneKey,
    laneMix: {},
    energyArc: "wave",
    openingClusterId: null,
    avgCuratorScore: row.coherenceScore ?? 0.75,
    avgWouldSaveScore: row.coherenceScore ?? 0.75,
    successCount: row.generationCount,
  };
}

export async function loadEditorialMemory(
  userId: string | null | undefined,
  prompt: string,
): Promise<EditorialStructureMemory | null> {
  if (!userId) return null;
  const key = cacheKey(userId, prompt);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  try {
    const row = await loadPromptSceneMemory(userId, prompt);
    if (!row || row.generationCount < 1) return null;
    const memory = promptSceneToEditorial(row);
    memoryCache.set(key, memory);
    if (memoryCache.size > MAX_CACHE) {
      const first = memoryCache.keys().next().value;
      if (first) memoryCache.delete(first);
    }
    return memory;
  } catch {
    return null;
  }
}

export function applyEditorialMemoryToIntent(
  intent: EditorialIntentVector,
  memory: EditorialStructureMemory,
): EditorialIntentVector {
  if (memory.editorialWorldTag && memory.editorialWorldTag !== intent.editorialWorldTag) {
    return {
      ...intent,
      editorialWorldTag: memory.editorialWorldTag,
    };
  }
  return intent;
}

export function resolveArchetypeFromMemory(
  detectedArchetypeId: string | null,
  memory: EditorialStructureMemory | null,
): string | null {
  if (!memory?.preferredArchetypeId) return detectedArchetypeId;
  if (memory.successCount >= 2 && memory.avgWouldSaveScore >= 0.72) {
    return memory.preferredArchetypeId;
  }
  return detectedArchetypeId;
}

export function seedOffsetFromMemory(
  memory: EditorialStructureMemory | null,
  baseOffset: number,
): number {
  if (!memory) return baseOffset;
  const arcOffsets: Record<EditorialStructureMemory["energyArc"], number> = {
    rise: 0,
    flat: 4111,
    wave: 8237,
    cooldown: 12457,
  };
  return baseOffset + (arcOffsets[memory.energyArc] ?? 0);
}

export async function recordEditorialMemory(opts: {
  userId: string;
  prompt: string;
  editorialWorldTag: string;
  preferredArchetypeId?: string | null;
  laneMix?: Record<string, number>;
  energyArc?: EditorialStructureMemory["energyArc"];
  openingClusterId?: string | null;
  curatorScore: number;
  wouldSaveScore: number;
  humanSaveable: boolean;
}): Promise<void> {
  const key = cacheKey(opts.userId, opts.prompt);
  const existing = memoryCache.get(key);
  const successCount = (existing?.successCount ?? 0) + (opts.humanSaveable ? 1 : 0);
  const avgCurator = existing
    ? (existing.avgCuratorScore * existing.successCount + opts.curatorScore) / Math.max(1, successCount)
    : opts.curatorScore;
  const avgWouldSave = existing
    ? (existing.avgWouldSaveScore * existing.successCount + opts.wouldSaveScore) / Math.max(1, successCount)
    : opts.wouldSaveScore;

  const memory: EditorialStructureMemory = {
    promptHash: hashPrompt(opts.prompt),
    editorialWorldTag: opts.editorialWorldTag,
    preferredArchetypeId: opts.preferredArchetypeId ?? opts.editorialWorldTag,
    laneMix: opts.laneMix ?? existing?.laneMix ?? {},
    energyArc: opts.energyArc ?? existing?.energyArc ?? "wave",
    openingClusterId: opts.openingClusterId ?? existing?.openingClusterId ?? null,
    avgCuratorScore: avgCurator,
    avgWouldSaveScore: avgWouldSave,
    successCount,
  };
  memoryCache.set(key, memory);

  if (opts.humanSaveable) {
    await recordPromptSceneMemory({
      userId: opts.userId,
      prompt: opts.prompt,
      sceneKey: opts.preferredArchetypeId ?? opts.editorialWorldTag,
      genreFamilies: [],
      coherenceScore: avgWouldSave,
    });
  }
}
