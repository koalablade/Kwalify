/**
 * 3-layer genre intelligence stack orchestrator.
 * A: Ontology | B: Embeddings | C: Clustering + living graph
 */

import { buildGenreOntology, ontologyStats } from "./genre-ontology";
import {
  combineTrackEmbedding,
  EMBEDDING_VERSION,
  type TrackEmbeddingInput,
} from "./genre-embeddings";
import { discoverMicroGenres, enforceClusterDiversityCap, type MicroGenre } from "./genre-clustering";
import {
  addCoOccurrenceEdges,
  addTransitionEdges,
  buildGenreGraph,
  buildUserGenreLayer,
  type GenreGraph,
  type UserGenreLayer,
} from "./genre-graph";
import { buildSeedEmbeddingFromVibe, similarityBoostForPool } from "./genre-similarity-engine";
import type { UserGenreProfile } from "./user-genre-profile";
import type { RootGenre } from "./genre-taxonomy";
import { profileToClassification } from "./genre-taxonomy";

export interface GenreIntelligenceStack {
  ontology: ReturnType<typeof buildGenreOntology>;
  graph: GenreGraph;
  microGenres: MicroGenre[];
  trackEmbeddings: Map<string, number[]>;
  trackInputs: Map<string, TrackEmbeddingInput>;
  userLayer: UserGenreLayer;
  seedEmbedding: number[];
  stats: {
    ontologyNodes: number;
    ontologyEdges: number;
    microGenreCount: number;
    embeddingVersion: string;
    topMicroLabels: string[];
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

  const graph = buildGenreGraph([...trackInputs.values()]);

  const trackFamily = new Map<string, RootGenre>();
  for (const [id, input] of trackInputs) {
    const fam = input.classification?.genreFamily;
    if (fam) trackFamily.set(id, fam);
  }

  if (opts.recentPlaylistTrackIds?.length) {
    addCoOccurrenceEdges(graph, opts.recentPlaylistTrackIds, trackFamily);
    addTransitionEdges(graph, opts.recentPlaylistTrackIds, trackFamily);
  }

  const microGenres = discoverMicroGenres([...trackInputs.values()]);
  const userLayer = buildUserGenreLayer(opts.userProfile.vector, graph);
  const seedEmbedding = buildSeedEmbeddingFromVibe(
    [...trackInputs.values()],
    opts.vibe,
    opts.userProfile.vector
  );

  const oStats = ontologyStats();

  return {
    ontology: buildGenreOntology(),
    graph,
    microGenres,
    trackEmbeddings,
    trackInputs,
    userLayer,
    seedEmbedding,
    stats: {
      ontologyNodes: oStats.nodeCount,
      ontologyEdges: oStats.edgeCount,
      microGenreCount: microGenres.length,
      embeddingVersion: EMBEDDING_VERSION,
      topMicroLabels: microGenres.slice(0, 5).flatMap((m) => m.discoveredLabels),
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
  return enforceClusterDiversityCap(
    finalTracks,
    stack.trackEmbeddings,
    stack.microGenres,
    0.32
  );
}
