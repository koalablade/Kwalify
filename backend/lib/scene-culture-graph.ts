/**
 * Scene culture embedding graph (Q7) — games, films, culture with vector similarity.
 */

import { db, sceneCultureEmbeddingsTable } from "../db";
import { eq } from "drizzle-orm";
import { resolveSceneAliases } from "./scene-alias-graph";
import cultureSeed from "../data/scene-culture-entities.json";

export type CultureEntity = {
  entityKey: string;
  entityType: "game" | "film" | "culture" | "show";
  label: string;
  embedding: number[];
  genreFamilies: string[];
  metadata?: Record<string, unknown>;
};

export type CultureMatch = {
  entity: CultureEntity;
  score: number;
  genreFamilies: string[];
};

const entityCache = new Map<string, CultureEntity>();

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function promptEmbedding(prompt: string): number[] {
  const lower = prompt.toLowerCase();
  const dims = [0, 0, 0, 0, 0, 0, 0, 0];
  if (/\b(rock|metal|punk|guitar)\b/.test(lower)) dims[0] += 1;
  if (/\b(electronic|synth|edm|techno)\b/.test(lower)) dims[1] += 1;
  if (/\b(hip.?hop|rap|trap)\b/.test(lower)) dims[2] += 1;
  if (/\b(indie|folk|acoustic)\b/.test(lower)) dims[3] += 1;
  if (/\b(night|rain|sad|lonely|calm)\b/.test(lower)) dims[4] += 1;
  if (/\b(drive|car|race|speed|garage)\b/.test(lower)) dims[5] += 1;
  if (/\b(party|club|dance|gym|hype)\b/.test(lower)) dims[6] += 1;
  if (/\b(nostalgic|90s|00s|teen|memory)\b/.test(lower)) dims[7] += 1;
  const total = dims.reduce((s, v) => s + v, 0) || 1;
  return dims.map((v) => v / total);
}

export async function seedSceneCultureEmbeddings(): Promise<number> {
  const seed = cultureSeed as CultureEntity[];
  let count = 0;
  for (const entity of seed) {
    entityCache.set(entity.entityKey, entity);
    await db
      .insert(sceneCultureEmbeddingsTable)
      .values({
        entityKey: entity.entityKey,
        entityType: entity.entityType,
        label: entity.label,
        embedding: entity.embedding,
        genreFamilies: entity.genreFamilies,
        metadata: entity.metadata ?? {},
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sceneCultureEmbeddingsTable.entityKey,
        set: {
          entityType: entity.entityType,
          label: entity.label,
          embedding: entity.embedding,
          genreFamilies: entity.genreFamilies,
          metadata: entity.metadata ?? {},
          updatedAt: new Date(),
        },
      });
    count += 1;
  }
  return count;
}

export async function warmSceneCultureCache(): Promise<number> {
  if (entityCache.size > 0) return entityCache.size;
  const rows = await db.select().from(sceneCultureEmbeddingsTable).limit(500);
  for (const row of rows) {
    entityCache.set(row.entityKey, {
      entityKey: row.entityKey,
      entityType: row.entityType as CultureEntity["entityType"],
      label: row.label,
      embedding: Array.isArray(row.embedding) ? row.embedding as number[] : [],
      genreFamilies: Array.isArray(row.genreFamilies) ? row.genreFamilies as string[] : [],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    });
  }
  if (entityCache.size === 0) {
    await seedSceneCultureEmbeddings();
    return warmSceneCultureCache();
  }
  return entityCache.size;
}

export function matchCultureEntities(prompt: string, limit = 5): CultureMatch[] {
  const promptVec = promptEmbedding(prompt);
  const lower = prompt.toLowerCase();
  const matches: CultureMatch[] = [];

  for (const entity of entityCache.values()) {
    let score = cosineSimilarity(promptVec, entity.embedding);
    if (lower.includes(entity.entityKey.replace(/-/g, " ")) || lower.includes(entity.label.toLowerCase())) {
      score += 0.35;
    }
    for (const token of entity.entityKey.split("-")) {
      if (token.length >= 4 && lower.includes(token)) score += 0.12;
    }
    if (score > 0.2) {
      matches.push({ entity, score, genreFamilies: entity.genreFamilies });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function cultureSceneAliasesForPrompt(prompt: string): string[] {
  const matches = matchCultureEntities(prompt);
  return matches.map((match) => match.entity.entityKey).slice(0, 4);
}

export function cultureRetrievalBoost(prompt: string): number {
  const top = matchCultureEntities(prompt, 1)[0];
  return top ? Math.min(0.22, top.score * 0.25) : 0;
}

export async function getCultureEntity(entityKey: string): Promise<CultureEntity | null> {
  await warmSceneCultureCache();
  return entityCache.get(entityKey) ?? null;
}
