/**
 * Living genre graph — ontology + embeddings + edges (similarity, co-occurrence, transitions).
 */

import { buildGenreOntology, type OntologyEdge, type OntologyNode } from "./genre-ontology";
import {
  buildGenreCentroids,
  cosineSimilarity,
  embeddingForOntologyNode,
  type GenreNodeEmbedding,
  type TrackEmbeddingInput,
} from "./genre-embeddings";
import type { RootGenre } from "./genre-taxonomy";

export interface GenreEdge {
  from: string;
  to: string;
  type: "parent" | "similarity" | "co_occurrence" | "transition";
  weight: number;
}

export interface GenreGraph {
  nodes: OntologyNode[];
  edges: GenreEdge[];
  centroids: Map<string, GenreNodeEmbedding>;
  embeddingVersion: string;
}

export interface UserGenreLayer {
  preferenceVector: Partial<Record<RootGenre, number>>;
  genreWeights: Partial<Record<string, number>>;
  strengthenedEdges: GenreEdge[];
}

export function buildGenreGraph(trackInputs: TrackEmbeddingInput[]): GenreGraph {
  const { nodes, edges: ontologyEdges } = buildGenreOntology();
  const centroids = buildGenreCentroids(trackInputs);

  const edges: GenreEdge[] = ontologyEdges.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type,
    weight: e.weight,
  }));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.family !== b.family) continue;
      const ea = embeddingForOntologyNode(a, centroids);
      const eb = embeddingForOntologyNode(b, centroids);
      const sim = cosineSimilarity(ea, eb);
      if (sim > 0.78) {
        edges.push({ from: a.id, to: b.id, type: "similarity", weight: sim });
      }
    }
  }

  return {
    nodes,
    edges,
    centroids,
    embeddingVersion: "deterministic-v1",
  };
}

/** Co-listening from recent playlists → co_occurrence edges */
export function addCoOccurrenceEdges(
  graph: GenreGraph,
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>
): void {
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

  for (const [key, count] of pairCounts) {
    if (count < 2) continue;
    const [a, b] = key.split("|") as [RootGenre, RootGenre];
    const w = Math.min(0.95, 0.4 + count * 0.05);
    graph.edges.push({
      from: `family:${a}`,
      to: `family:${b}`,
      type: "co_occurrence",
      weight: w,
    });
    graph.edges.push({
      from: `family:${b}`,
      to: `family:${a}`,
      type: "co_occurrence",
      weight: w,
    });
  }
}

/** Sequential transitions in playlist order */
export function addTransitionEdges(
  graph: GenreGraph,
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>
): void {
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

  for (const [key, count] of trans) {
    const [a, b] = key.split("->") as [RootGenre, RootGenre];
    graph.edges.push({
      from: `family:${a}`,
      to: `family:${b}`,
      type: "transition",
      weight: Math.min(0.9, 0.35 + count * 0.08),
    });
  }
}

export function buildUserGenreLayer(
  preferenceVector: Partial<Record<RootGenre, number>>,
  graph: GenreGraph
): UserGenreLayer {
  const genreWeights: Partial<Record<string, number>> = {};
  for (const n of graph.nodes) {
    genreWeights[n.id] = (preferenceVector[n.family] ?? 0) * n.weight;
  }

  const strengthenedEdges = graph.edges
    .filter((e) => e.type === "co_occurrence" || e.type === "transition")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  return { preferenceVector, genreWeights, strengthenedEdges };
}
