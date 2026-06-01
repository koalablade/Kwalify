/**
 * Layer B — Embedding space (v0 deterministic; swap provider for OpenAI / music models).
 */

import type { RootGenre } from "./genre-taxonomy";
import type { TrackGenreClassification } from "./genre-taxonomy";
import { buildGenreOntology, type OntologyNode } from "./genre-ontology";

export const EMBEDDING_DIM = 384;
export const EMBEDDING_VERSION = "deterministic-v1";

export interface TrackEmbeddingInput {
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
  classification?: TrackGenreClassification;
  userGenreWeight?: number;
}

export interface GenreNodeEmbedding {
  nodeId: string;
  embedding: number[];
  sampleTrackIds: string[];
}

/** Seeded hash → stable pseudo-random projection */
function hashToUnit(s: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

function audioBlock(t: TrackEmbeddingInput): number[] {
  const tempoN = t.tempo != null ? (t.tempo - 60) / 140 : 0.5;
  return [
    t.energy ?? 0.5,
    t.valence ?? 0.5,
    tempoN,
    t.danceability ?? 0.5,
    t.acousticness ?? 0.5,
    t.instrumentalness ?? 0.1,
    t.speechiness ?? 0.2,
    1 - (t.energy ?? 0.5),
    t.valence ?? 0.5 - 0.5,
  ];
}

function projectTo384(features: number[], salt: string): number[] {
  const out = new Array<number>(EMBEDDING_DIM).fill(0);
  for (let d = 0; d < EMBEDDING_DIM; d++) {
    let v = 0;
    for (let f = 0; f < features.length; f++) {
      v += features[f]! * hashToUnit(`${salt}:${f}`, d + f * 17);
    }
    out[d] = v;
  }
  return normalize(out);
}

export function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

export function combineTrackEmbedding(t: TrackEmbeddingInput): number[] {
  const audio = audioBlock(t);
  const fam = t.classification?.genreFamily ?? "unknown";
  const sub = t.classification?.primarySubgenre ?? "unknown";
  const genreHints = [
    fam === "unknown" ? 0 : 1,
    t.classification?.confidenceScore ?? 0.3,
    t.userGenreWeight ?? 0.1,
  ];
  const textBlob = `${t.artistName} ${t.trackName}`.toLowerCase();
  const textFeat = Array.from({ length: 16 }, (_, i) => hashToUnit(textBlob, i * 7 + 3));

  const combined = [...audio, ...genreHints, ...textFeat];
  return projectTo384(combined, `track:${t.trackId}:${sub}`);
}

export function meanEmbedding(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  const sum = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i]! += v[i] ?? 0;
  }
  return normalize(sum.map((x) => x / vectors.length));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i]! * b[i]!;
  return dot;
}

export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

export function buildGenreCentroids(
  tracks: TrackEmbeddingInput[]
): Map<string, GenreNodeEmbedding> {
  const ontology = buildGenreOntology();
  const byNode = new Map<string, number[][]>();
  const samples = new Map<string, string[]>();

  for (const t of tracks) {
    const emb = combineTrackEmbedding(t);
    const c = t.classification;
    if (!c || c.genrePrimary === "unknown") continue;

    const nodeIds = [
      `family:${c.genreFamily}`,
      `sub:${c.genreFamily}:${c.primarySubgenre}`,
    ];
    if (c.microStyle) {
      nodeIds.push(`micro:${c.genreFamily}:${c.primarySubgenre}:${slug(c.microStyle)}`);
    }

    for (const nid of nodeIds) {
      if (!ontology.nodes.find((n) => n.id === nid)) continue;
      const list = byNode.get(nid) ?? [];
      list.push(emb);
      byNode.set(nid, list);
      const s = samples.get(nid) ?? [];
      if (s.length < 8) s.push(t.trackId);
      samples.set(nid, s);
    }
  }

  const out = new Map<string, GenreNodeEmbedding>();
  for (const [nodeId, vecs] of byNode) {
    out.set(nodeId, {
      nodeId,
      embedding: meanEmbedding(vecs),
      sampleTrackIds: samples.get(nodeId) ?? [],
    });
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

export function embeddingForOntologyNode(node: OntologyNode, centroids: Map<string, GenreNodeEmbedding>): number[] {
  const c = centroids.get(node.id);
  if (c) return c.embedding;
  const keywords = node.keywords.join(" ");
  return projectTo384([node.weight, hashToUnit(keywords, 1), hashToUnit(node.family, 2)], node.id);
}
