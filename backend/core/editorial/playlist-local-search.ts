/**
 * True playlist search — treat the playlist as one object.
 * Mutate via swaps, reorders, and replacements; accept moves that improve human pattern score.
 */

import {
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";

export type PlaylistSearchMove =
  | "adjacent_swap"
  | "section_reorder"
  | "pool_replace"
  | "discovery_insert"
  | "character_pick";

export type PlaylistSearchResult<T extends PatternScoringTrack> = {
  tracks: T[];
  scoreBefore: number;
  scoreAfter: number;
  iterations: number;
  moves: Array<{ type: PlaylistSearchMove; detail: string; delta: number }>;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function artistKey(track: PatternScoringTrack): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

function playlistScore(tracks: PatternScoringTrack[]): number {
  return scoreAgainstHumanPlaylistPatterns(tracks).score;
}

function artistSpacingOk(tracks: PatternScoringTrack[], index: number, candidate: PatternScoringTrack): boolean {
  const artist = artistKey(candidate);
  for (let i = Math.max(0, index - 3); i < tracks.length; i++) {
    if (i === index) continue;
    if (artistKey(tracks[i]!) === artist) return false;
  }
  return true;
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const out = arr.slice();
  const tmp = out[i]!;
  out[i] = out[j]!;
  out[j] = tmp;
  return out;
}

function moveTrack<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  const [item] = out.splice(from, 1);
  if (!item) return arr;
  out.splice(to, 0, item);
  return out;
}

/**
 * Local search over playlist order and membership.
 * Does not add pipeline stages — runs once after interleaver on final candidate.
 */
export function improvePlaylistByLocalSearch<T extends PatternScoringTrack>(
  playlist: T[],
  alternatePool: T[],
  opts: {
    maxIterations?: number;
    seed?: string;
    allowCharacterPick?: boolean;
  } = {},
): PlaylistSearchResult<T> {
  const maxIterations = opts.maxIterations ?? 48;
  const allowCharacter = opts.allowCharacterPick !== false;
  const playlistIds = new Set(playlist.map((t) => t.trackId));
  const pool = alternatePool.filter((t) => t.trackId && !playlistIds.has(t.trackId));

  let current = playlist.slice();
  let score = playlistScore(current);
  const scoreBefore = score;
  const moves: PlaylistSearchResult<T>["moves"] = [];
  let iterations = 0;
  let characterPickUsed = false;

  for (let pass = 0; pass < maxIterations; pass += 1) {
    iterations = pass + 1;
    let bestNext: T[] | null = null;
    let bestScore = score;
    let bestMove: PlaylistSearchResult<T>["moves"][number] | null = null;

    for (let i = 0; i < current.length - 1; i += 1) {
      const swapped = swap(current, i, i + 1);
      const swappedScore = playlistScore(swapped);
      if (swappedScore > bestScore + 0.004) {
        bestScore = swappedScore;
        bestNext = swapped;
        bestMove = { type: "adjacent_swap", detail: `${i}<->${i + 1}`, delta: swappedScore - score };
      }
    }

    const midStart = Math.floor(current.length * 0.3);
    const midEnd = Math.floor(current.length * 0.7);
    for (let i = midStart; i < Math.min(midEnd, current.length - 1); i += 1) {
      for (const j of [i - 2, i + 2, i + 3]) {
        if (j < 0 || j >= current.length || j === i) continue;
        const reordered = moveTrack(current, i, j);
        const reorderedScore = playlistScore(reordered);
        if (reorderedScore > bestScore + 0.005) {
          bestScore = reorderedScore;
          bestNext = reordered;
          bestMove = { type: "section_reorder", detail: `${i}->${j}`, delta: reorderedScore - score };
        }
      }
    }

    for (let i = 1; i < current.length - 1; i += 3) {
      for (const candidate of pool.slice(0, 40)) {
        if (!artistSpacingOk(current, i, candidate)) continue;
        const replaced = current.slice();
        replaced[i] = candidate as T;
        const replaceScore = playlistScore(replaced);
        if (replaceScore > bestScore + 0.006) {
          bestScore = replaceScore;
          bestNext = replaced;
          bestMove = { type: "pool_replace", detail: `pos${i}:${candidate.trackId}`, delta: replaceScore - score };
        }
      }
    }

    const tailStart = Math.floor(current.length * 0.65);
    for (let i = tailStart; i < current.length; i += 2) {
      for (const candidate of pool) {
        const pop = candidate.popularity ?? 50;
        const discovery = candidate.rediscoveryScore ?? (100 - pop) / 100;
        if (discovery < 0.45) continue;
        if (!artistSpacingOk(current, i, candidate)) continue;
        const replaced = current.slice();
        replaced[i] = candidate as T;
        const discoveryScore = playlistScore(replaced);
        if (discoveryScore > bestScore + 0.005) {
          bestScore = discoveryScore;
          bestNext = replaced;
          bestMove = { type: "discovery_insert", detail: `tail${i}`, delta: discoveryScore - score };
        }
      }
    }

    if (allowCharacter && !characterPickUsed && current.length >= 12) {
      const slot = Math.floor(current.length * 0.55);
      for (const candidate of pool.slice(0, 25)) {
        if (!artistSpacingOk(current, slot, candidate)) continue;
        const replaced = current.slice();
        replaced[slot] = candidate as T;
        const charScore = playlistScore(replaced);
        if (charScore >= score + 0.002 && charScore > bestScore - 0.001) {
          bestScore = charScore;
          bestNext = replaced;
          bestMove = { type: "character_pick", detail: `slot${slot}`, delta: charScore - score };
          characterPickUsed = true;
        }
      }
    }

    if (!bestNext || !bestMove) break;
    current = bestNext;
    moves.push(bestMove);
    score = bestScore;
  }

  return {
    tracks: current,
    scoreBefore,
    scoreAfter: score,
    iterations,
    moves,
  };
}

export function humanPlausibilityScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length === 0) return 0;
  const full = playlistScore(tracks);
  const opening = tracks.length >= 5 ? playlistScore(tracks.slice(0, 5)) : full;
  const ending = tracks.length >= 8 ? playlistScore(tracks.slice(-Math.min(8, tracks.length))) : full;
  return clamp01(full * 0.5 + opening * 0.28 + ending * 0.22);
}
