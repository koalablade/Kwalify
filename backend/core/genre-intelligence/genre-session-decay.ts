/**
 * Session anti-collapse — decay overused genres across recent playlists.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import { computeGenreDistribution } from "../../lib/genre-coverage-enforcement";

export function dominantGenresFromRecentPlaylists(
  recentPlaylistTrackIds: string[][],
  classifications: Map<string, TrackGenreClassification>,
  topN = 5
): RootGenre[] {
  const counts: Partial<Record<RootGenre, number>> = {};
  for (const playlist of recentPlaylistTrackIds) {
    const dist = computeGenreDistribution(playlist, classifications);
    for (const [g, share] of Object.entries(dist) as [RootGenre, number][]) {
      if (share >= 0.28) counts[g] = (counts[g] ?? 0) + 1;
    }
  }
  return (Object.entries(counts) as [RootGenre, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([g]) => g);
}

export function countGenreSetRepeats(
  recentPlaylistTrackIds: string[][],
  classifications: Map<string, TrackGenreClassification>
): number {
  if (recentPlaylistTrackIds.length < 2) return 0;
  const signatures = recentPlaylistTrackIds.slice(0, 8).map((ids) => {
    const top = Object.entries(computeGenreDistribution(ids, classifications))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g)
      .sort()
      .join("|");
    return top;
  });
  const first = signatures[0];
  return signatures.filter((s) => s === first).length;
}
