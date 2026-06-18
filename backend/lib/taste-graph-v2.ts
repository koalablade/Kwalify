/**
 * Taste graph v2 (Q6) — persisted nodes/edges + collaborative genre similarity.
 */

import { db, userTasteGraphTable } from "../db";
import { eq, sql } from "drizzle-orm";
import type { FeedbackMemory } from "./feedback-memory";
import { buildTasteMemoryGraph, tasteGraphRetrievalBoost, type TasteMemoryGraph } from "./taste-memory-graph";

export type TasteGraphNode = {
  id: string;
  type: "genre" | "artist" | "scene";
  label: string;
  weight: number;
};

export type TasteGraphEdge = {
  from: string;
  to: string;
  weight: number;
};

export type TasteGraphV2 = {
  nodes: TasteGraphNode[];
  edges: TasteGraphEdge[];
  genreWeights: Record<string, number>;
  memoryGraph: TasteMemoryGraph;
  collaborativeBoost: Record<string, number>;
};

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

export function buildTasteGraphV2(opts: {
  userId: string;
  feedbackMemory?: FeedbackMemory | null;
  likedGenreFamilies?: string[];
  likedArtists?: string[];
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
}): TasteGraphV2 {
  const memoryGraph = buildTasteMemoryGraph({
    feedbackMemory: opts.feedbackMemory,
    sceneAliases: opts.sceneAliases,
    scenePrediction: opts.scenePrediction,
    likedGenreFamilies: opts.likedGenreFamilies,
  });

  const nodes: TasteGraphNode[] = [];
  const edges: TasteGraphEdge[] = [];
  const genreWeights: Record<string, number> = { ...memoryGraph.genreAffinity };

  for (const family of opts.likedGenreFamilies ?? []) {
    const id = `genre:${normalizeId(family)}`;
    const weight = genreWeights[normalizeId(family)] ?? 0.35;
    genreWeights[normalizeId(family)] = weight;
    nodes.push({ id, type: "genre", label: family, weight });
  }

  for (const artist of (opts.likedArtists ?? []).slice(0, 40)) {
    const id = `artist:${normalizeId(artist)}`;
    const weight = memoryGraph.artistAffinity[artist] ?? 0.25;
    nodes.push({ id, type: "artist", label: artist, weight });
    for (const family of opts.likedGenreFamilies ?? []) {
      edges.push({
        from: id,
        to: `genre:${normalizeId(family)}`,
        weight: 0.15,
      });
    }
  }

  for (const alias of opts.sceneAliases ?? []) {
    const id = `scene:${normalizeId(alias)}`;
    nodes.push({
      id,
      type: "scene",
      label: alias,
      weight: memoryGraph.sceneAffinity[alias] ?? 0.3,
    });
  }

  return {
    nodes: nodes.slice(0, 120),
    edges: edges.slice(0, 200),
    genreWeights,
    memoryGraph,
    collaborativeBoost: {},
  };
}

export async function persistTasteGraphV2(userId: string, graph: TasteGraphV2): Promise<void> {
  await db
    .insert(userTasteGraphTable)
    .values({
      userId,
      nodes: graph.nodes,
      edges: graph.edges,
      genreWeights: graph.genreWeights,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userTasteGraphTable.userId,
      set: {
        nodes: graph.nodes,
        edges: graph.edges,
        genreWeights: graph.genreWeights,
        updatedAt: new Date(),
      },
    });
}

export async function loadTasteGraphV2(userId: string): Promise<TasteGraphV2 | null> {
  const [row] = await db
    .select()
    .from(userTasteGraphTable)
    .where(eq(userTasteGraphTable.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    nodes: Array.isArray(row.nodes) ? row.nodes as TasteGraphNode[] : [],
    edges: Array.isArray(row.edges) ? row.edges as TasteGraphEdge[] : [],
    genreWeights: (row.genreWeights ?? {}) as Record<string, number>,
    memoryGraph: buildTasteMemoryGraph({}),
    collaborativeBoost: {},
  };
}

/** Lite collaborative filtering — boost genres popular among similar users. */
export async function collaborativeGenreBoost(
  userId: string,
  genreWeights: Record<string, number>,
): Promise<Record<string, number>> {
  const keys = Object.keys(genreWeights);
  if (keys.length === 0) return {};

  const rows = await db
    .select({ userId: userTasteGraphTable.userId, genreWeights: userTasteGraphTable.genreWeights })
    .from(userTasteGraphTable)
    .where(sql`${userTasteGraphTable.userId} <> ${userId}`)
    .limit(50);

  const boosts: Record<string, number> = {};
  for (const row of rows) {
    const other = (row.genreWeights ?? {}) as Record<string, number>;
    const otherKeys = Object.keys(other);
    if (otherKeys.length === 0) continue;
    const intersection = keys.filter((k) => otherKeys.includes(k)).length;
    const union = new Set([...keys, ...otherKeys]).size || 1;
    const similarity = intersection / union;
    if (similarity < 0.15) continue;
    for (const [genre, weight] of Object.entries(other)) {
      boosts[genre] = (boosts[genre] ?? 0) + weight * similarity * 0.08;
    }
  }
  return boosts;
}

export function tasteGraphV2RetrievalBoost(
  track: { genreFamily?: string | null; genrePrimary?: string | null; genres?: string[] | null; artistName?: string | null },
  graph: TasteGraphV2,
): number {
  let boost = tasteGraphRetrievalBoost(track, graph.memoryGraph);
  const families = [
    track.genreFamily,
    track.genrePrimary,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter((v): v is string => typeof v === "string");

  for (const family of families) {
    const key = normalizeId(family);
    const collab = graph.collaborativeBoost[key] ?? 0;
    const persisted = graph.genreWeights[key] ?? 0;
    boost += Math.min(0.15, collab + persisted * 0.03);
  }
  return Math.round(boost * 1000) / 1000;
}
