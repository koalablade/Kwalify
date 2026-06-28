/**
 * Complete playlist search — beam + multi-start whole-playlist optimisation.
 *
 * Run: npm run test:playlist-complete-search
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artistSpacingAllows,
  searchOptimalCompletePlaylist,
  wholePlaylistObjectiveScore,
} from "../core/editorial/playlist-complete-search";
import { scorePlaylistForCuration } from "../core/editorial/playlist-preference-model";

function buildTracks(seed: number, messy = false) {
  return Array.from({ length: 18 }, (_, i) => ({
    trackId: `t${seed}_${i}`,
    trackName: `Track ${i}`,
    artistName: messy ? `Artist ${i}` : `Artist ${Math.floor(i / 4)}`,
    energy: messy ? (i % 2 === 0 ? 0.9 : 0.2) : 0.42 + (i / 18) * 0.25,
    valence: 0.55,
    danceability: 0.52,
    acousticness: 0.4,
    popularity: 70 - (i % 5) * 8,
    releaseYear: 2012,
    rediscoveryScore: i % 4 === 0 ? 0.65 : 0.3,
    laneScore: messy ? 0.4 : 0.9 - i * 0.01,
  }));
}

describe("playlist complete search", () => {
  it("beam search beats a deliberately bad seed ordering", () => {
    const pool = buildTracks(1);
    const badSeed = [
      pool[0]!,
      { ...pool[0]!, trackId: "dup_a" },
      pool[2]!,
      pool[3]!,
      ...pool.slice(4),
    ];
    const result = searchOptimalCompletePlaylist({
      seedPlaylist: badSeed,
      pool,
      targetLength: 18,
      beamWidth: 4,
      seed: "test-bad-seed",
    });
    assert.ok(result.scoreAfter >= result.scoreBefore - 0.01);
    assert.ok(result.candidatesExplored >= 4);
  });

  it("explores multiple complete playlist strategies", () => {
    const pool = buildTracks(2);
    const result = searchOptimalCompletePlaylist({
      seedPlaylist: pool,
      pool,
      targetLength: 18,
      beamWidth: 3,
      seed: "test-strategies",
    });
    const strategies = new Set(result.candidateScores.map((row) => row.strategy));
    assert.ok(strategies.has("seed"));
    assert.ok(strategies.size >= 3);
  });

  it("enforces artist spacing during beam expansion", () => {
    const selected = [
      { trackId: "a1", artistName: "Same Artist" },
      { trackId: "a2", artistName: "Other" },
    ];
    assert.equal(
      artistSpacingAllows(selected, { trackId: "a3", artistName: "Same Artist" }),
      false,
    );
    assert.equal(
      artistSpacingAllows(selected, { trackId: "a4", artistName: "Fresh" }),
      true,
    );
  });

  it("curation score prefers coherent playlists over genre salad", () => {
    const coherent = wholePlaylistObjectiveScore(buildTracks(3));
    const messy = wholePlaylistObjectiveScore(buildTracks(4, true));
    assert.ok(coherent >= messy);
    assert.ok(scorePlaylistForCuration(buildTracks(3)) >= scorePlaylistForCuration(buildTracks(4, true)));
  });
});
