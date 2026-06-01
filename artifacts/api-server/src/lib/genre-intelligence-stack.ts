/**
 * Spotify-scale genre intelligence — unified GenreGraph orchestrator.
 */

import { buildGenreOntology, ontologyStats } from "./genre-ontology";
import {
  combineTrackEmbedding,
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

const LIGHT_STACK_TRACK_THRESHOLD = 1800;

type StackTrack = {
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
};

/** Fast path for large libraries — skips micro-clustering and full track vector graph. */
function buildLightGenreIntelligenceStack(opts: {
  tracks: StackTrack[];
  userProfile: UserGenreProfile;
  vibe: string;
}): GenreIntelligenceStack {
  const { nodes } = buildGenreOntology();
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
  }

  const graph = buildUnifiedGenreGraph({
    trackInputs: [],
    userProfile: opts.userProfile.vector,
    clusters: [],
    recentPlaylistTrackIds: undefined,
  });

  const userLayer = buildUserGenreLayer(opts.userProfile.vector, graph);
  const seedEmbedding = buildSeedEmbeddingFromVibe(
    [...trackInputs.values()].slice(0, 400),
    opts.vibe,
    opts.userProfile.vector
  );
  const oStats = ontologyStats();

  return {
    graph,
    microGenres: [],
    trackEmbeddings,
    trackInputs,
    userLayer,
    seedEmbedding,
    stats: {
      ontologyNodes: oStats.nodeCount,
      ontologyTargetMet: oStats.targetMet,
      ontologyEdges: graph.edges.length,
      microGenreCount: 0,
      embeddingVersion: EMBEDDING_VERSION,
      topMicroLabels: [],
      vectorStoreSizes: {
        genre: graph.embeddings.genreSpace.size(),
        track: 0,
        cluster: 0,
      },
    },
  };
}

export function buildGenreIntelligenceStack(opts: {
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
  if (opts.tracks.length >= LIGHT_STACK_TRACK_THRESHOLD) {
    return buildLightGenreIntelligenceStack(opts);
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

  return {
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
}

export function applyStackToScoredPool<T extends { trackId: string; score: number }>(
  pool: T[],
  stack: GenreIntelligenceStack
): T[] {
  return similarityBoostForPool(pool, stack.trackInputs, stack.seedEmbedding, 0.1);
}

export function applyStackToFinalTracks<T extends { trackId: string }>(
  finalTracks: T[],
  stack: GenreIntelligenceStack
): { tracks: T[]; clusterCapped: string | null } {
  const { tracks, capped } = enforceClusterDiversityCap(
    finalTracks,
    stack.trackEmbeddings,
    stack.microGenres,
    0.32
  );
  return { tracks, clusterCapped: capped };
}
