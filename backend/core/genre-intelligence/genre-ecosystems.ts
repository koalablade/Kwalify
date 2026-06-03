/**
 * Genre ecosystems — prevent single-ecosystem collapse in playlists.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";

export type GenreEcosystem =
  | "acoustic"
  | "electronic"
  | "urban"
  | "rock"
  | "cinematic"
  | "regional";

export const GENRE_TO_ECOSYSTEM: Partial<Record<RootGenre, GenreEcosystem>> = {
  country: "acoustic",
  folk: "acoustic",
  blues: "acoustic",
  jazz: "acoustic",
  classical: "cinematic",
  soundtrack: "cinematic",
  electronic: "electronic",
  pop: "electronic",
  hip_hop: "urban",
  rnb: "urban",
  soul: "urban",
  rock: "rock",
  metal: "rock",
  indie: "rock",
  latin: "regional",
  reggae: "regional",
  world: "regional",
};

export function ecosystemOf(genre: RootGenre): GenreEcosystem | null {
  return GENRE_TO_ECOSYSTEM[genre] ?? null;
}

export function ecosystemDistribution(
  dist: Record<string, number>
): Record<GenreEcosystem, number> {
  const out: Partial<Record<GenreEcosystem, number>> = {};
  for (const [genre, share] of Object.entries(dist)) {
    const eco = ecosystemOf(genre as RootGenre);
    if (!eco) continue;
    out[eco] = (out[eco] ?? 0) + share;
  }
  return out as Record<GenreEcosystem, number>;
}

/** 0–1 — higher when multiple ecosystems represented evenly */
export function ecosystemBalanceScore(dist: Record<string, number>): number {
  const eco = ecosystemDistribution(dist);
  const values = Object.values(eco).filter((v) => v > 0);
  if (values.length <= 1) return values.length === 1 ? 0.4 : 0;
  const max = Math.max(...values);
  if (max > 0.65) return Math.max(0.2, 1 - (max - 0.5) * 1.4);
  const h = values.reduce((s, p) => s - p * Math.log2(p), 0);
  return Math.min(1, h / Math.log2(values.length));
}

export function ecosystemsInLibrary(userVector: Partial<Record<RootGenre, number>>): GenreEcosystem[] {
  const set = new Set<GenreEcosystem>();
  for (const [g, v] of Object.entries(userVector) as [RootGenre, number][]) {
    if ((v ?? 0) < 0.03) continue;
    const eco = ecosystemOf(g);
    if (eco) set.add(eco);
  }
  return [...set];
}
