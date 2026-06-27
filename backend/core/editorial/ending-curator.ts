/**
 * Ending curation — humans land playlists with cooldown, discovery tail, and closure.
 * Reorder-only pass after opening curator / local search.
 */

import {
  loadHumanPlaylistPatternProfile,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import { humanPlausibilityScore } from "./playlist-local-search";

export type EndingCuratorResult<T extends PatternScoringTrack> = {
  tracks: T[];
  scoreBefore: number;
  scoreAfter: number;
  swaps: number;
};

function artistKey(track: PatternScoringTrack): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

function endingScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length === 0) return 0;
  const tailSize = Math.min(8, Math.max(4, Math.floor(tracks.length * 0.22)));
  const slice = tracks.slice(-tailSize);
  const pattern = scoreAgainstHumanPlaylistPatterns(slice).score;
  const plausibility = humanPlausibilityScore(slice);
  return pattern * 0.5 + plausibility * 0.5;
}

function tailDiscoveryScore(track: PatternScoringTrack): number {
  if (typeof track.rediscoveryScore === "number") return track.rediscoveryScore;
  if (typeof track.popularity === "number") return Math.max(0, Math.min(1, 1 - track.popularity / 100));
  return 0.4;
}

function tailEnergyScore(track: PatternScoringTrack, profile: ReturnType<typeof loadHumanPlaylistPatternProfile>): number {
  const energy = track.energy ?? 0.5;
  const target = 0.42 - profile.energyArcCooldownWeight * 0.12;
  return Math.max(0, 1 - Math.abs(energy - target) * 2.2);
}

function endingValid(tail: PatternScoringTrack[]): boolean {
  const artists = tail.map(artistKey);
  return new Set(artists).size === artists.length;
}

export function curatePlaylistEnding<T extends PatternScoringTrack>(
  playlist: T[],
  endingSize = 6,
): EndingCuratorResult<T> {
  if (playlist.length <= endingSize + 5) {
    const score = endingScore(playlist);
    return { tracks: playlist.slice(), scoreBefore: score, scoreAfter: score, swaps: 0 };
  }

  const profile = loadHumanPlaylistPatternProfile();
  const size = Math.min(endingSize, 8);
  const tailStart = playlist.length - size;
  let current = playlist.slice();
  const scoreBefore = endingScore(current);
  let swaps = 0;

  for (let pass = 0; pass < size * 2; pass += 1) {
    let improved = false;
    for (let i = tailStart; i < current.length; i += 1) {
      for (let j = tailStart; j < current.length; j += 1) {
        if (i === j) continue;
        if (artistKey(current[i]!) === artistKey(current[j]!)) continue;
        const trial = current.slice();
        const tmp = trial[i]!;
        trial[i] = trial[j]!;
        trial[j] = tmp;
        const tail = trial.slice(tailStart);
        if (!endingValid(tail)) continue;
        const posInTail = i - tailStart;
        const before =
          endingScore(current) +
          tailDiscoveryScore(current[i]!) * (posInTail >= size - 2 ? 0.12 : 0.04) +
          tailEnergyScore(current[i]!, profile) * (posInTail >= size - 3 ? 0.1 : 0.03);
        const after =
          endingScore(trial) +
          tailDiscoveryScore(trial[i]!) * (posInTail >= size - 2 ? 0.12 : 0.04) +
          tailEnergyScore(trial[i]!, profile) * (posInTail >= size - 3 ? 0.1 : 0.03);
        if (after > before + 0.007) {
          current = trial;
          swaps += 1;
          improved = true;
        }
      }
      for (let j = Math.max(0, tailStart - 10); j < tailStart; j += 1) {
        if (artistKey(current[j]!) === artistKey(current[i]!)) continue;
        const trial = current.slice();
        const tmp = trial[i]!;
        trial[i] = trial[j]!;
        trial[j] = tmp;
        if (!endingValid(trial.slice(tailStart))) continue;
        if (endingScore(trial) > endingScore(current) + 0.008) {
          current = trial;
          swaps += 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return {
    tracks: current,
    scoreBefore,
    scoreAfter: endingScore(current),
    swaps,
  };
}
