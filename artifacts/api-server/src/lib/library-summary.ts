/**
 * Lightweight library stats for the UI health card (post-sync).
 */

import { classifyTrack } from "./genre-taxonomy";

export interface LibrarySummary {
  trackCount: number;
  artistCount: number;
  genreFamilyCount: number;
  topDecade: string | null;
  oldestLikedYear: number | null;
  newestLikedYear: number | null;
}

type Row = {
  trackName: string;
  artistName: string;
  albumName: string;
  addedAt: Date | null;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
  instrumentalness: number | null;
  speechiness: number | null;
  tempo: number | null;
};

export function computeLibrarySummary(rows: Row[]): LibrarySummary {
  const trackCount = rows.length;
  const artists = new Set<string>();
  const decades = new Map<string, number>();
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const r of rows) {
    artists.add(r.artistName.toLowerCase());
    if (r.addedAt) {
      const y = r.addedAt.getFullYear();
      if (oldest === null || y < oldest) oldest = y;
      if (newest === null || y > newest) newest = y;
      const decade = `${Math.floor(y / 10) * 10}s`;
      decades.set(decade, (decades.get(decade) ?? 0) + 1);
    }
  }

  let topDecade: string | null = null;
  let topCount = 0;
  for (const [d, c] of decades) {
    if (c > topCount) {
      topCount = c;
      topDecade = d;
    }
  }

  const families = new Set<string>();
  const step = Math.max(1, Math.floor(rows.length / 280));
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i]!;
    const c = classifyTrack(r);
    if (c.genreFamily) families.add(c.genreFamily);
    if (families.size >= 48) break;
  }

  return {
    trackCount,
    artistCount: artists.size,
    genreFamilyCount: families.size,
    topDecade,
    oldestLikedYear: oldest,
    newestLikedYear: newest,
  };
}
