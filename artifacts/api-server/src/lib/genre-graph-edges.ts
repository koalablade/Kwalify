/**
 * Genre graph edges — similarity, co-occurrence, transition (living graph).
 */

import type { RootGenre } from "./genre-taxonomy";
export interface GenreEdge {
  from: string;
  to: string;
  type: "parent" | "similarity" | "co_occurrence" | "transition";
  weight: number;
}
import type { GenreNode } from "./genre-ontology";
import {
  cosineSimilarity,
  embeddingForOntologyNode,
  type GenreNodeEmbedding,
} from "./genre-embeddings";

export type EdgeType = GenreEdge["type"];

export function parentEdges(nodes: GenreNode[]): GenreEdge[] {
  const edges: GenreEdge[] = [];
  for (const n of nodes) {
    if (n.parent) {
      edges.push({ from: n.parent, to: n.id, type: "parent", weight: 1 });
    }
  }
  return edges;
}

export function similarityBridgeEdges(): GenreEdge[] {
  const bridges: [RootGenre, RootGenre, number][] = [
    ["country", "folk", 0.82],
    ["country", "rock", 0.55],
    ["soul", "rnb", 0.88],
    ["soul", "jazz", 0.65],
    ["indie", "rock", 0.75],
    ["indie", "folk", 0.7],
    ["electronic", "pop", 0.68],
    ["hip_hop", "rnb", 0.72],
    ["metal", "rock", 0.8],
    ["blues", "rock", 0.6],
    ["reggae", "latin", 0.55],
    ["jazz", "blues", 0.7],
    ["classical", "soundtrack", 0.6],
    ["world", "latin", 0.5],
  ];
  const edges: GenreEdge[] = [];
  for (const [a, b, w] of bridges) {
    edges.push({ from: `family:${a}`, to: `family:${b}`, type: "similarity", weight: w });
    edges.push({ from: `family:${b}`, to: `family:${a}`, type: "similarity", weight: w });
  }
  return edges;
}

export function intraFamilySimilarityEdges(
  nodes: GenreNode[],
  centroids: Map<string, GenreNodeEmbedding>,
  minSim = 0.76
): GenreEdge[] {
  const edges: GenreEdge[] = [];
  const byFamily = new Map<RootGenre, GenreNode[]>();
  for (const n of nodes) {
    const list = byFamily.get(n.family) ?? [];
    list.push(n);
    byFamily.set(n.family, list);
  }

  for (const list of byFamily.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const ea = embeddingForOntologyNode(a, centroids);
        const eb = embeddingForOntologyNode(b, centroids);
        const sim = cosineSimilarity(ea, eb);
        if (sim >= minSim) {
          edges.push({ from: a.id, to: b.id, type: "similarity", weight: sim });
        }
      }
    }
  }
  return edges;
}

export function coOccurrenceEdges(
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>,
  minCount = 2
): GenreEdge[] {
  const pairCounts = new Map<string, number>();

  for (const playlist of recentPlaylistTrackIds) {
    const families = playlist
      .map((id) => trackFamily.get(id))
      .filter((f): f is RootGenre => !!f && f !== "unknown");
    for (let i = 0; i < families.length; i++) {
      for (let j = i + 1; j < families.length; j++) {
        const a = families[i]!;
        const b = families[j]!;
        if (a === b) continue;
        const key = [a, b].sort().join("|");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: GenreEdge[] = [];
  for (const [key, count] of pairCounts) {
    if (count < minCount) continue;
    const [a, b] = key.split("|") as [RootGenre, RootGenre];
    const w = Math.min(0.95, 0.4 + count * 0.05);
    edges.push({ from: `family:${a}`, to: `family:${b}`, type: "co_occurrence", weight: w });
    edges.push({ from: `family:${b}`, to: `family:${a}`, type: "co_occurrence", weight: w });
  }
  return edges;
}

export function transitionEdges(
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>
): GenreEdge[] {
  const trans = new Map<string, number>();

  for (const playlist of recentPlaylistTrackIds) {
    for (let i = 0; i < playlist.length - 1; i++) {
      const a = trackFamily.get(playlist[i]!);
      const b = trackFamily.get(playlist[i + 1]!);
      if (!a || !b || a === "unknown" || b === "unknown" || a === b) continue;
      const key = `${a}->${b}`;
      trans.set(key, (trans.get(key) ?? 0) + 1);
    }
  }

  const edges: GenreEdge[] = [];
  for (const [key, count] of trans) {
    const [a, b] = key.split("->") as [RootGenre, RootGenre];
    edges.push({
      from: `family:${a}`,
      to: `family:${b}`,
      type: "transition",
      weight: Math.min(0.9, 0.35 + count * 0.08),
    });
  }
  return edges;
}

export function mergeEdges(...lists: GenreEdge[]): GenreEdge[] {
  const key = (e: GenreEdge) => `${e.from}|${e.to}|${e.type}`;
  const map = new Map<string, GenreEdge>();
  for (const e of lists) {
    const k = key(e);
    const prev = map.get(k);
    if (!prev || e.weight > prev.weight) map.set(k, e);
  }
  return [...map.values()];
}
