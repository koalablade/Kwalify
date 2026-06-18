/**
 * Soft retrieval boost when track genre families align with scene alias predictions.
 */

export type SceneAliasBoostTrack = {
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
};

function normalizeGenre(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

function trackGenreFamilies(track: SceneAliasBoostTrack): string[] {
  const families = new Set<string>();
  if (track.genreFamily) families.add(normalizeGenre(track.genreFamily));
  if (track.genrePrimary) families.add(normalizeGenre(track.genrePrimary));
  if (Array.isArray(track.genres)) {
    for (const genre of track.genres) {
      if (typeof genre === "string" && genre.trim()) families.add(normalizeGenre(genre));
    }
  }
  return [...families];
}

export function computeSceneAliasRetrievalBoost(
  track: SceneAliasBoostTrack,
  sceneAliases: string[],
  scenePrediction: Record<string, number>,
): number {
  if (sceneAliases.length === 0) return 0;
  const families = trackGenreFamilies(track);
  if (families.length === 0) return 0;

  let boost = 0;
  for (const alias of sceneAliases) {
    const normalizedAlias = normalizeGenre(alias);
    const weight = scenePrediction[alias] ?? scenePrediction[normalizedAlias] ?? 0.12;
    if (families.some((family) => family === normalizedAlias || family.includes(normalizedAlias) || normalizedAlias.includes(family))) {
      boost += weight * 0.22;
    }
  }
  return Math.min(0.28, Math.round(boost * 1000) / 1000);
}
