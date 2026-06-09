/**
 * Spotify-scale genre intelligence — unified GenreGraph orchestrator.
 */

import { buildGenreOntology, ontologyStats } from "./genre-ontology";
import {
  combineTrackEmbedding,
  EMBEDDING_DIM,
  EMBEDDING_VERSION,
  type TrackEmbeddingInput,
} from "./genre-embeddings";
import { discoverMicroGenres, enforceClusterDiversityCap, type MicroGenre } from "./genre-clustering";
import {
  buildUnifiedGenreGraph,
  buildUserGenreLayer,
  type GenreGraph,
  type UserGenreLayer,
} from "./genre-graph";
import { buildSeedEmbeddingFromVibe, similarityBoostForPool } from "./genre-similarity-engine";
import type { UserGenreProfile } from "./user-genre-profile";
import type { RootGenre } from "./genre-taxonomy";
import { profileToClassification } from "./genre-taxonomy";
import { parentEdges, similarityBridgeEdges, mergeEdges } from "./genre-graph-edges";
import { VectorStore } from "./genre-vector-store";
import { embeddingForOntologyNode, buildGenreCentroids } from "./genre-embeddings";

export interface GenreIntelligenceStack {
  graph: GenreGraph;
  microGenres: MicroGenre[];
  trackEmbeddings: Map<string, number[]>;
  trackInputs: Map<string, TrackEmbeddingInput>;
  userLayer: UserGenreLayer;
  seedEmbedding: number[];
  stats: {
    ontologyNodes: number;
    ontologyTargetMet: boolean;
    ontologyEdges: number;
    microGenreCount: number;
    embeddingVersion: string;
    topMicroLabels: string[];
    vectorStoreSizes: { genre: number; track: number; cluster: number };
  };
}

import { MINIMAL_GENRE_STACK_THRESHOLD } from "./production-limits";

const MINIMAL_STACK_THRESHOLD = MINIMAL_GENRE_STACK_THRESHOLD;

/** Skips O(n²) ontology similarity + per-track embedding graph (critical for 5k+ libraries). */
function buildMinimalGenreIntelligenceStack(
  userProfile: UserGenreProfile,
  vibe: string
): GenreIntelligenceStack {
  const { nodes } = buildGenreOntology();
  const centroids = buildGenreCentroids([]);
  const genreSpace = new VectorStore();

  for (const node of nodes) {
    if (node.level !== "family") continue;
    const emb = embeddingForOntologyNode(node, centroids);
    node.embedding = emb;
    genreSpace.upsert(node.id, emb, { family: node.family, level: node.level });
  }

  const edges = mergeEdges(parentEdges(nodes), similarityBridgeEdges());
  const graph: GenreGraph = {
    nodes,
    edges,
    embeddings: {
      genreSpace,
      trackSpace: new VectorStore(),
      clusterSpace: new VectorStore(),
    },
    clusters: [],
    userProfile: userProfile.vector,
    centroids,
    embeddingVersion: EMBEDDING_VERSION,
  };

  const userLayer = buildUserGenreLayer(userProfile.vector, graph);
  const seedEmbedding = new Array(EMBEDDING_DIM).fill(0);
  const top = (Object.entries(userProfile.vector) as [RootGenre, number][])
    .filter(([, v]) => (v ?? 0) > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (let i = 0; i < top.length; i++) {
    seedEmbedding[i % EMBEDDING_DIM] = top[i]![1];
  }

  const oStats = ontologyStats();
  return {
    graph,
    microGenres: [],
    trackEmbeddings: new Map(),
    trackInputs: new Map(),
    userLayer,
    seedEmbedding,
    stats: {
      ontologyNodes: oStats.nodeCount,
      ontologyTargetMet: oStats.targetMet,
      ontologyEdges: edges.length,
      microGenreCount: 0,
      embeddingVersion: EMBEDDING_VERSION,
      topMicroLabels: [],
      vectorStoreSizes: { genre: genreSpace.size(), track: 0, cluster: 0 },
    },
  };
}

export function buildGenreIntelligenceStack(opts: {
  /** When set, used for minimal-vs-full decision (generate passes library size, not empty tracks[]). */
  librarySize?: number;
  tracks: {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    energy: number | null;
    valence: number | null;
    tempo: number | null;
    danceability: number | null;
    acousticness: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
  }[];
  userProfile: UserGenreProfile;
  vibe: string;
  recentPlaylistTrackIds?: string[][];
}): GenreIntelligenceStack {
  const t0 = Date.now();
  const libSize = opts.librarySize ?? opts.tracks.length;
  if (libSize >= MINIMAL_STACK_THRESHOLD) {
    const stack = buildMinimalGenreIntelligenceStack(opts.userProfile, opts.vibe);
    console.info("[generate-timing] buildGenreIntelligenceStack", {
      ms: Date.now() - t0,
      trackCount: opts.tracks.length,
      minimal: true,
    });
    return stack;
  }

  const trackInputs = new Map<string, TrackEmbeddingInput>();
  const trackEmbeddings = new Map<string, number[]>();

  for (const t of opts.tracks) {
    const profile = opts.userProfile.genreProfiles.get(t.trackId);
    const classification = profile
      ? profileToClassification(profile)
      : opts.userProfile.trackClassifications.get(t.trackId);

    const input: TrackEmbeddingInput = {
      ...t,
      classification,
      userGenreWeight: classification
        ? opts.userProfile.vector[classification.genreFamily] ?? 0.05
        : 0.05,
    };
    trackInputs.set(t.trackId, input);
    trackEmbeddings.set(t.trackId, combineTrackEmbedding(input));
  }

  const microGenres = discoverMicroGenres([...trackInputs.values()]);

  const graph = buildUnifiedGenreGraph({
    trackInputs: [...trackInputs.values()],
    userProfile: opts.userProfile.vector,
    clusters: microGenres,
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,
  });

  const userLayer = buildUserGenreLayer(opts.userProfile.vector, graph);
  const seedEmbedding = buildSeedEmbeddingFromVibe(
    [...trackInputs.values()],
    opts.vibe,
    opts.userProfile.vector
  );

  const oStats = ontologyStats();

  const stack = {
    graph,
    microGenres,
    trackEmbeddings,
    trackInputs,
    userLayer,
    seedEmbedding,
    stats: {
      ontologyNodes: oStats.nodeCount,
      ontologyTargetMet: oStats.targetMet,
      ontologyEdges: oStats.edgeCount,
      microGenreCount: microGenres.length,
      embeddingVersion: EMBEDDING_VERSION,
      topMicroLabels: microGenres.slice(0, 8).flatMap((m) => m.labels),
      vectorStoreSizes: {
        genre: graph.embeddings.genreSpace.size(),
        track: graph.embeddings.trackSpace.size(),
        cluster: graph.embeddings.clusterSpace.size(),
      },
    },
  };
  console.info("[generate-timing] buildGenreIntelligenceStack", {
    ms: Date.now() - t0,
    trackCount: opts.tracks.length,
    minimal: false,
  });
  return stack;
}

export function applyStackToScoredPool<T extends { trackId: string; score: number }>(
  pool: T[],
  stack: GenreIntelligenceStack
): T[] {
  if (stack.trackInputs.size === 0) return pool;
  return similarityBoostForPool(pool, stack.trackInputs, stack.seedEmbedding, 0.1);
}

export function applyStackToFinalTracks<T extends { trackId: string }>(
  finalTracks: T[],
  stack: GenreIntelligenceStack
): { tracks: T[]; clusterCapped: string | null } {
  if (stack.trackEmbeddings.size === 0) {
    return { tracks: finalTracks, clusterCapped: null };
  }
  const { tracks, capped } = enforceClusterDiversityCap(
    finalTracks,
    stack.trackEmbeddings,
    stack.microGenres,
    0.32
  );
  return { tracks, clusterCapped: capped };
}
