/**
 * Unified GenreGraph — ontology + vector stores + clusters + user profile.
 */

import { buildGenreOntology, ontologyStats, type GenreNode } from "./genre-ontology";
import {
  buildGenreCentroids,
  combineTrackEmbedding,
  embeddingForOntologyNode,
  EMBEDDING_VERSION,
  type TrackEmbeddingInput,
} from "./genre-embeddings";
import { VectorStore } from "./genre-vector-store";
import type { MicroGenre } from "./genre-clustering";
import {
  coOccurrenceEdges,
  intraFamilySimilarityEdges,
  mergeEdges,
  parentEdges,
  similarityBridgeEdges,
  transitionEdges,
  type GenreEdge,
} from "./genre-graph-edges";
import type { RootGenre } from "./genre-taxonomy";
import type { UserGenreVector } from "./user-genre-profile";

export type { GenreEdge };

export interface GenreGraphEmbeddings {
  genreSpace: VectorStore;
  trackSpace: VectorStore;
  clusterSpace: VectorStore;
}

export interface GenreGraph {
  nodes: GenreNode[];
  edges: GenreEdge[];
  embeddings: GenreGraphEmbeddings;
  clusters: MicroGenre[];
  userProfile: UserGenreVector;
  centroids: ReturnType<typeof buildGenreCentroids>;
  embeddingVersion: string;
}

export interface UserGenreLayer {
  preferenceVector: Partial<Record<RootGenre, number>>;
  genreWeights: Partial<Record<string, number>>;
  strengthenedEdges: GenreEdge[];
}

export interface BuildGenreGraphOpts {
  trackInputs: TrackEmbeddingInput[];
  userProfile: UserGenreVector;
  clusters: MicroGenre[];
  recentPlaylistTrackIds?: string[][];
}

export function buildUnifiedGenreGraph(opts: BuildGenreGraphOpts): GenreGraph {
  const { nodes } = buildGenreOntology();
  const centroids = buildGenreCentroids(opts.trackInputs);

  const genreSpace = new VectorStore();
  for (const node of nodes) {
    const emb = embeddingForOntologyNode(node, centroids);
    node.embedding = emb;
    genreSpace.upsert(node.id, emb, { family: node.family, level: node.level });
  }

  const trackSpace = new VectorStore();
  for (const t of opts.trackInputs) {
    const emb = combineTrackEmbedding(t);
    trackSpace.upsert(t.trackId, emb, {
      family: t.classification?.genreFamily,
      artist: t.artistName,
    });
  }

  const clusterSpace = new VectorStore();
  for (const c of opts.clusters) {
    clusterSpace.upsert(c.id, c.centroid, { labels: c.discoveredLabels, size: c.size });
  }

  const trackFamily = new Map<string, RootGenre>();
  for (const t of opts.trackInputs) {
    const fam = t.classification?.genreFamily;
    if (fam) trackFamily.set(t.trackId, fam);
  }

  const edges = mergeEdges(
    parentEdges(nodes),
    similarityBridgeEdges(),
    intraFamilySimilarityEdges(nodes, centroids, 0.78),
    opts.recentPlaylistTrackIds?.length
      ? coOccurrenceEdges(opts.recentPlaylistTrackIds, trackFamily)
      : [],
    opts.recentPlaylistTrackIds?.length
      ? transitionEdges(opts.recentPlaylistTrackIds, trackFamily)
      : []
  );

  return {
    nodes,
    edges,
    embeddings: { genreSpace, trackSpace, clusterSpace },
    clusters: opts.clusters,
    userProfile: opts.userProfile,
    centroids,
    embeddingVersion: EMBEDDING_VERSION,
  };
}

/** @deprecated use buildUnifiedGenreGraph */
export function buildGenreGraph(trackInputs: TrackEmbeddingInput[]): GenreGraph {
  return buildUnifiedGenreGraph({
    trackInputs,
    userProfile: {},
    clusters: [],
  });
}

export function addCoOccurrenceEdges(
  graph: GenreGraph,
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>
): void {
  graph.edges.push(...coOccurrenceEdges(recentPlaylistTrackIds, trackFamily));
}

export function addTransitionEdges(
  graph: GenreGraph,
  recentPlaylistTrackIds: string[][],
  trackFamily: Map<string, RootGenre>
): void {
  graph.edges.push(...transitionEdges(recentPlaylistTrackIds, trackFamily));
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
    .slice(0, 32);

  return { preferenceVector, genreWeights, strengthenedEdges };
}

export function graphOntologyMeta(): { nodeCount: number; targetMet: boolean } {
  const s = ontologyStats();
  return { nodeCount: s.nodeCount, targetMet: s.targetMet };
}
