/**
 * Opening-five curation — humans front-load familiar, intentional openers.
 * Runs once after local search; reorder-only within the playlist.
 */

import {
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import { humanPlausibilityScore } from "./playlist-local-search";

export type OpeningCuratorResult<T extends PatternScoringTrack> = {
  tracks: T[];
  scoreBefore: number;
  scoreAfter: number;
  swaps: number;
};

function artistKey(track: PatternScoringTrack): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

function openingScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length === 0) return 0;
  const slice = tracks.slice(0, Math.min(5, tracks.length));
  const pattern = scoreAgainstHumanPlaylistPatterns(slice).score;
  const plausibility = humanPlausibilityScore(slice);
  return pattern * 0.55 + plausibility * 0.45;
}

function hookScore(track: PatternScoringTrack, position: number): number {
  const pop = typeof track.popularity === "number"
    ? Math.max(0, Math.min(1, track.popularity / 100))
    : typeof track.rediscoveryScore === "number"
      ? Math.max(0, Math.min(1, 1 - track.rediscoveryScore))
      : 0.5;
  const hookWeight = position <= 1 ? 0.35 : position <= 2 ? 0.2 : 0.05;
  return pop * hookWeight;
}

function openingValid(opening: PatternScoringTrack[]): boolean {
  const artists = opening.map(artistKey);
  return new Set(artists).size === artists.length;
}

/**
 * Optimize the first five tracks for editorial hook + pattern fit.
 * Only reorders existing members — no pool injection.
 */
export function curatePlaylistOpening<T extends PatternScoringTrack>(
  playlist: T[],
  openingSize = 5,
): OpeningCuratorResult<T> {
  if (playlist.length <= openingSize) {
    const score = openingScore(playlist);
    return { tracks: playlist.slice(), scoreBefore: score, scoreAfter: score, swaps: 0 };
  }

  const size = Math.min(openingSize, 5);
  let current = playlist.slice();
  const scoreBefore = openingScore(current);
  let swaps = 0;

  const tailStart = size;
  for (let pass = 0; pass < size * 2; pass += 1) {
    let improved = false;
    for (let i = 0; i < size; i += 1) {
      for (let j = tailStart; j < current.length; j += 1) {
        if (artistKey(current[j]!) === artistKey(current[i]!)) continue;
        const trial = current.slice();
        const tmp = trial[i]!;
        trial[i] = trial[j]!;
        trial[j] = tmp;
        if (!openingValid(trial.slice(0, size))) continue;
        const before = openingScore(current) + hookScore(current[i]!, i);
        const after = openingScore(trial) + hookScore(trial[i]!, i);
        if (after > before + 0.008) {
          current = trial;
          swaps += 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  for (let i = 0; i < size - 1; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const trial = current.slice();
      const tmp = trial[i]!;
      trial[i] = trial[j]!;
      trial[j] = tmp;
      if (!openingValid(trial.slice(0, size))) continue;
      if (openingScore(trial) > openingScore(current) + 0.006) {
        current = trial;
        swaps += 1;
      }
    }
  }

  const scoreAfter = openingScore(current);
  return { tracks: current, scoreBefore, scoreAfter, swaps };
}
