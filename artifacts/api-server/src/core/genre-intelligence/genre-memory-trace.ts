/**
 * Per-session genre memory — rotation and anti-repetition across generations.
 */

import type { RootGenre } from "../../lib/genre-taxonomy";
import { dominantGenresFromRecentPlaylists } from "./genre-session-decay";
import { useFrozenMemoryTrace } from "../debug/stability-config";

export interface GenreMemoryTrace {
  genresShownRecently: RootGenre[];
  genresSuppressedByCaps: RootGenre[];
  genresDominantInSession: RootGenre[];
  rotationBoost: Partial<Record<RootGenre, number>>;
}

export function buildGenreMemoryTrace(opts: {
  recentPlaylistTrackIds: string[][];
  classifications: Map<string, import("../../lib/genre-taxonomy").TrackGenreClassification>;
  suppressedGenres?: RootGenre[];
}): GenreMemoryTrace {
  const genresDominantInSession = dominantGenresFromRecentPlaylists(
    opts.recentPlaylistTrackIds,
    opts.classifications
  );

  const shownSet = new Set<RootGenre>();
  for (const playlist of opts.recentPlaylistTrackIds.slice(0, 8)) {
    for (const id of playlist) {
      const c = opts.classifications.get(id);
      if (c?.genreFamily && c.genreFamily !== "unknown") shownSet.add(c.genreFamily);
    }
  }

  const rotationBoost: Partial<Record<RootGenre, number>> = {};
  if (!useFrozenMemoryTrace()) {
    for (const g of shownSet) {
      if (!genresDominantInSession.includes(g)) {
        rotationBoost[g] = 0.06;
      }
    }
    for (const g of genresDominantInSession) {
      rotationBoost[g] = (rotationBoost[g] ?? 0) - 0.1;
    }
    for (const g of opts.suppressedGenres ?? []) {
      rotationBoost[g] = (rotationBoost[g] ?? 0) + 0.08;
    }
  }

  return {
    genresShownRecently: [...shownSet],
    genresSuppressedByCaps: opts.suppressedGenres ?? [],
    genresDominantInSession: genresDominantInSession,
    rotationBoost,
  };
}

export function memoryTraceBoost(genre: RootGenre, trace: GenreMemoryTrace): number {
  return trace.rotationBoost[genre] ?? 0;
}
