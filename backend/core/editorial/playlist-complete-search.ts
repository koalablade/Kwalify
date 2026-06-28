/**
 * Complete playlist search — explore many full playlists, optimise the whole object.
 *
 * Scored by playlist-level human curation (preference model), not lane rank.
 */

import { incrementalPlaylistShapeMultiplier } from "./human-playlist-patterns";
import type { PatternScoringTrack } from "./human-playlist-patterns";
import { scorePlaylistForCuration } from "./playlist-preference-model";
import type { PlaylistCurationScoringContext } from "./would-i-save-evaluator";
import { playlistBelievabilityScore } from "./would-i-save-evaluator";

export type CompletePlaylistSearchStrategy =
  | "seed"
  | "beam_shape"
  | "beam_energy_arc"
  | "beam_discovery"
  | "section_permutation";

export type CompletePlaylistSearchResult<T extends PatternScoringTrack> = {
  tracks: T[];
  scoreBefore: number;
  scoreAfter: number;
  selectedStrategy: CompletePlaylistSearchStrategy;
  candidatesExplored: number;
  beamWidth: number;
  candidateScores: Array<{ strategy: CompletePlaylistSearchStrategy; score: number }>;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function seededUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function artistSpacingAllows(
  selected: PatternScoringTrack[],
  candidate: PatternScoringTrack,
  minGap = 3,
): boolean {
  const artist = (candidate.artistName ?? "unknown").toLowerCase();
  for (let i = Math.max(0, selected.length - minGap); i < selected.length; i += 1) {
    if ((selected[i]!.artistName ?? "unknown").toLowerCase() === artist) return false;
  }
  return true;
}

/** Whole-playlist objective — aligned with candidate tournament selection. */
export function wholePlaylistObjectiveScore(tracks: PatternScoringTrack[]): number {
  return scorePlaylistForCuration(tracks);
}

type PoolOrder = "shape" | "energy_arc" | "discovery";

function orderPool<T extends PatternScoringTrack>(
  pool: T[],
  strategy: PoolOrder,
  seed: string,
): T[] {
  const out = pool.slice();
  if (strategy === "shape") {
    out.sort((a, b) => seededUnit(`${seed}:${a.trackId}`) - seededUnit(`${seed}:${b.trackId}`));
    return out;
  }
  if (strategy === "energy_arc") {
    out.sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
    return out;
  }
  out.sort((a, b) => {
    const da = a.rediscoveryScore ?? (100 - (a.popularity ?? 50)) / 100;
    const db = b.rediscoveryScore ?? (100 - (b.popularity ?? 50)) / 100;
    return db - da;
  });
  return out;
}

function rankShapeExtensions<T extends PatternScoringTrack>(
  selected: T[],
  pool: T[],
  limit: number,
): T[] {
  const used = new Set(selected.map((track) => track.trackId));
  return pool
    .filter((track) => track.trackId && !used.has(track.trackId) && artistSpacingAllows(selected, track))
    .map((track) => ({
      track,
      fit: incrementalPlaylistShapeMultiplier(selected, track),
    }))
    .sort((a, b) => b.fit - a.fit || seededUnit(b.track.trackId) - seededUnit(a.track.trackId))
    .slice(0, limit)
    .map((row) => row.track);
}

function scorePartialPlaylist(selected: PatternScoringTrack[], targetLength: number): number {
  if (selected.length === 0) return 0;
  const shape = wholePlaylistObjectiveScore(selected);
  const fillRatio = selected.length / Math.max(1, targetLength);
  const fillBonus = Math.min(0.06, fillRatio * 0.06);
  return clamp01(shape * (0.92 + fillBonus * 0.08) + fillBonus * 0.5);
}

function beamSearchCompletePlaylist<T extends PatternScoringTrack>(opts: {
  pool: T[];
  targetLength: number;
  beamWidth: number;
  poolOrder: PoolOrder;
  seed?: string;
  maxExtensionsPerState?: number;
}): T[] {
  const {
    pool,
    targetLength,
    beamWidth,
    poolOrder,
    seed = "beam",
    maxExtensionsPerState = 32,
  } = opts;
  if (pool.length === 0 || targetLength <= 0) return [];

  const orderedPool = orderPool(pool, poolOrder, seed).slice(0, Math.max(targetLength * 3, 56));
  type BeamState = { tracks: T[]; score: number };
  let beam: BeamState[] = [{ tracks: [], score: 0 }];

  for (let position = 0; position < targetLength; position += 1) {
    const next: BeamState[] = [];
    for (const state of beam) {
      const extensions = rankShapeExtensions(state.tracks, orderedPool, maxExtensionsPerState);
      for (const candidate of extensions) {
        const extended = [...state.tracks, candidate];
        const score =
          scorePartialPlaylist(extended, targetLength) +
          seededUnit(`${seed}:${candidate.trackId}:${position}`) * 0.0005;
        next.push({ tracks: extended, score });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, beamWidth);
  }

  const best = beam.sort((a, b) => b.score - a.score)[0];
  if (!best || best.tracks.length === 0) return [];
  return best.tracks.length >= targetLength
    ? best.tracks.slice(0, targetLength)
    : best.tracks;
}

function sectionPermutationCandidate<T extends PatternScoringTrack>(
  seedPlaylist: T[],
  seed: string,
): T[] {
  if (seedPlaylist.length < 9) return seedPlaylist.slice();
  const third = Math.floor(seedPlaylist.length / 3);
  const opening = seedPlaylist.slice(0, third);
  const middle = seedPlaylist.slice(third, third * 2);
  const ending = seedPlaylist.slice(third * 2);
  const swapMiddle = seededUnit(`${seed}:mid`) > 0.5;
  const reordered = swapMiddle
    ? [...opening, ...middle.slice().reverse(), ...ending]
    : [...opening.slice().reverse(), ...middle, ...ending];
  return reordered.slice(0, seedPlaylist.length);
}

function dedupePool<T extends PatternScoringTrack>(pool: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const track of pool) {
    if (!track.trackId || seen.has(track.trackId)) continue;
    seen.add(track.trackId);
    out.push(track);
  }
  return out;
}

/**
 * Explore multiple complete playlists and return the highest whole-playlist score.
 */
export function searchOptimalCompletePlaylist<T extends PatternScoringTrack>(opts: {
  seedPlaylist: T[];
  pool: T[];
  targetLength?: number;
  beamWidth?: number;
  maxPoolTracks?: number;
  seed?: string;
  scoringContext?: PlaylistCurationScoringContext | null;
}): CompletePlaylistSearchResult<T> {
  const targetLength = opts.targetLength ?? opts.seedPlaylist.length;
  const beamWidth = opts.beamWidth ?? 4;
  const seed = opts.seed ?? "complete-search";
  const mergedPool = dedupePool([
    ...opts.seedPlaylist,
    ...opts.pool,
  ]).slice(0, opts.maxPoolTracks ?? 96);

  const scoreBefore = wholePlaylistObjectiveScore(opts.seedPlaylist);
  const candidates: Array<{ strategy: CompletePlaylistSearchStrategy; tracks: T[] }> = [
    { strategy: "seed", tracks: opts.seedPlaylist.slice(0, targetLength) },
  ];

  const beamRuns: Array<{ strategy: CompletePlaylistSearchStrategy; order: PoolOrder }> = [
    { strategy: "beam_shape", order: "shape" },
    { strategy: "beam_energy_arc", order: "energy_arc" },
    { strategy: "beam_discovery", order: "discovery" },
  ];
  for (const run of beamRuns) {
    const built = beamSearchCompletePlaylist({
      pool: mergedPool,
      targetLength,
      beamWidth,
      poolOrder: run.order,
      seed: `${seed}:${run.strategy}`,
    });
    if (built.length >= Math.min(targetLength, Math.max(8, Math.floor(targetLength * 0.7)))) {
      candidates.push({ strategy: run.strategy, tracks: built });
    }
  }

  const permuted = sectionPermutationCandidate(opts.seedPlaylist, seed);
  if (permuted.length > 0) {
    candidates.push({ strategy: "section_permutation", tracks: permuted.slice(0, targetLength) });
  }

  const candidateScores = candidates.map((candidate) => ({
    strategy: candidate.strategy,
    score: opts.scoringContext
      ? playlistBelievabilityScore(candidate.tracks, opts.scoringContext)
      : wholePlaylistObjectiveScore(candidate.tracks),
  }));
  candidateScores.sort((a, b) => b.score - a.score);
  const winner = candidateScores[0]!;
  const winningTracks = candidates.find((candidate) => candidate.strategy === winner.strategy)?.tracks
    ?? opts.seedPlaylist;

  return {
    tracks: winningTracks.slice(0, targetLength),
    scoreBefore,
    scoreAfter: winner.score,
    selectedStrategy: winner.strategy,
    candidatesExplored: candidates.length,
    beamWidth,
    candidateScores,
  };
}
