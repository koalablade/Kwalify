/**
 * Genre Bridge Logic (v2 spec — Expansion & Variation Layer)
 *
 * Only allows transitions between related genres. Prevents jarring genre jumps
 * in the final ordered playlist while permitting planned genre evolution chains.
 *
 * Example chains (from spec):
 *   synth-pop → dream pop → ambient synth
 *   disco → post-disco → early house
 *   indie rock → shoegaze → alternative ambient
 *
 * Mapped to RootGenre adjacency below.
 */

import type { RootGenre } from "./genre-taxonomy";

/**
 * Directed adjacency graph — each genre lists its compatible neighbours.
 * Compatibility is NOT symmetric (rock→folk may differ from folk→rock
 * in feel), but for scoring we treat it bidirectionally for simplicity.
 */
const BRIDGE_GRAPH: Partial<Record<RootGenre, RootGenre[]>> = {
  pop:        ["indie", "rock", "rnb", "electronic", "soul", "folk"],
  rock:       ["indie", "folk", "blues", "metal", "pop"],
  electronic: ["pop", "rnb", "indie", "soul", "soundtrack"],
  indie:      ["rock", "pop", "folk", "electronic", "blues"],
  rnb:        ["soul", "pop", "hip_hop", "blues", "jazz"],
  soul:       ["rnb", "blues", "jazz", "pop"],
  hip_hop:    ["rnb", "electronic", "pop", "soul"],
  folk:       ["country", "indie", "rock", "blues", "classical"],
  country:    ["folk", "rock", "pop", "blues"],
  jazz:       ["soul", "blues", "classical", "indie", "rnb"],
  blues:      ["soul", "rock", "jazz", "folk", "rnb"],
  metal:      ["rock"],
  classical:  ["jazz", "soundtrack", "folk"],
  soundtrack: ["classical", "electronic", "pop", "indie"],
  latin:      ["pop", "soul", "rnb", "world"],
  reggae:     ["soul", "pop", "world"],
  world:      ["folk", "latin", "reggae", "soul"],
  christmas:  ["pop", "classical"],
  unknown:    [],
};

/**
 * Returns a 0–1 transition compatibility score between two genres.
 *   1.0 = same genre (no transition cost)
 *   0.8 = direct neighbour (smooth)
 *   0.5 = 2-hop connection (acceptable bridge)
 *   0.15 = no known path (jarring jump — avoid unless forced)
 */
export function genreBridgeScore(from: RootGenre, to: RootGenre): number {
  if (from === to) return 1.0;
  if (from === "unknown" || to === "unknown") return 0.55;

  const direct = BRIDGE_GRAPH[from] ?? [];
  if (direct.includes(to)) return 0.8;

  // 2-hop
  for (const mid of direct) {
    const midNeighbours = BRIDGE_GRAPH[mid] ?? [];
    if (midNeighbours.includes(to)) return 0.5;
  }

  return 0.15;
}

/**
 * Scores how well an ordered sequence of tracks transitions genre-wise.
 * Returns the average bridge score across all adjacent pairs (0–1).
 */
export function sequenceGenreFlowScore(
  tracks: { genrePrimary?: RootGenre }[]
): number {
  if (tracks.length < 2) return 1;
  let total = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    const a = tracks[i]?.genrePrimary ?? "unknown";
    const b = tracks[i + 1]?.genrePrimary ?? "unknown";
    total += genreBridgeScore(a, b);
  }
  return total / (tracks.length - 1);
}

/**
 * Reorders an array of tracks to improve genre flow using a greedy nearest-
 * neighbour approach. Keeps the first track fixed (it's the intro anchor).
 *
 * Not exhaustive — O(n²) greedy, suitable for playlists up to ~100 tracks.
 */
export function smoothGenreTransitions<T extends { trackId: string; genrePrimary?: RootGenre }>(
  tracks: T[]
): T[] {
  if (tracks.length <= 3) return tracks;

  const remaining = [...tracks];
  const result: T[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const last = result[result.length - 1]!;
    const lastGenre = last.genrePrimary ?? "unknown";

    // Pick the remaining track with the best bridge score from the last track
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const s = genreBridgeScore(lastGenre, candidate.genrePrimary ?? "unknown");
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    const [chosen] = remaining.splice(bestIdx, 1);
    if (chosen) result.push(chosen);
  }

  return result;
}
