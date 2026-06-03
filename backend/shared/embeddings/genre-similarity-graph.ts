/**
 * Lightweight genre adjacency graph (no ML) — fills long-tail and related genres.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";

export interface GenreNeighbor {
  genre: RootGenre;
  weight: number;
}

const ADJACENCY: Partial<Record<RootGenre, GenreNeighbor[]>> = {
  country: [
    { genre: "folk", weight: 0.82 },
    { genre: "rock", weight: 0.45 },
    { genre: "blues", weight: 0.5 },
  ],
  folk: [
    { genre: "country", weight: 0.82 },
    { genre: "indie", weight: 0.55 },
  ],
  hip_hop: [
    { genre: "rnb", weight: 0.78 },
    { genre: "pop", weight: 0.55 },
  ],
  electronic: [
    { genre: "pop", weight: 0.68 },
    { genre: "rock", weight: 0.4 },
  ],
  rock: [
    { genre: "indie", weight: 0.75 },
    { genre: "metal", weight: 0.8 },
    { genre: "folk", weight: 0.5 },
  ],
  jazz: [
    { genre: "soul", weight: 0.72 },
    { genre: "blues", weight: 0.7 },
    { genre: "rnb", weight: 0.55 },
  ],
  soul: [
    { genre: "rnb", weight: 0.88 },
    { genre: "jazz", weight: 0.65 },
    { genre: "blues", weight: 0.6 },
  ],
  blues: [
    { genre: "rock", weight: 0.6 },
    { genre: "jazz", weight: 0.7 },
    { genre: "country", weight: 0.5 },
  ],
  metal: [
    { genre: "rock", weight: 0.85 },
  ],
  latin: [
    { genre: "reggae", weight: 0.55 },
    { genre: "world", weight: 0.6 },
  ],
  world: [
    { genre: "latin", weight: 0.6 },
    { genre: "reggae", weight: 0.5 },
  ],
  reggae: [
    { genre: "latin", weight: 0.55 },
    { genre: "world", weight: 0.5 },
  ],
  rnb: [
    { genre: "soul", weight: 0.85 },
    { genre: "hip_hop", weight: 0.72 },
  ],
  indie: [
    { genre: "rock", weight: 0.75 },
    { genre: "folk", weight: 0.7 },
  ],
  pop: [
    { genre: "electronic", weight: 0.65 },
    { genre: "rnb", weight: 0.55 },
  ],
};

export function neighborsOf(genre: RootGenre): GenreNeighbor[] {
  return ADJACENCY[genre] ?? [];
}

export function similarityFillBoost(
  trackGenre: RootGenre,
  underrepresented: RootGenre[]
): number {
  if (underrepresented.length === 0) return 0;
  let boost = 0;
  for (const target of underrepresented) {
    if (trackGenre === target) {
      boost += 0.14;
      continue;
    }
    const edge = neighborsOf(target).find((n) => n.genre === trackGenre);
    if (edge) boost += edge.weight * 0.1;
  }
  return Math.min(0.22, boost);
}

export function graphRelatedGenres(genre: RootGenre, depth = 1): RootGenre[] {
  const out = new Set<RootGenre>([genre]);
  const queue = [genre];
  for (let d = 0; d < depth && queue.length; d++) {
    const next: RootGenre[] = [];
    for (const g of queue) {
      for (const n of neighborsOf(g)) {
        if (!out.has(n.genre)) {
          out.add(n.genre);
          next.push(n.genre);
        }
      }
    }
    queue.length = 0;
    queue.push(...next);
  }
  return [...out];
}
