/**
 * Playlist genome fitting and runtime scoring.
 *
 * Run: npm run test:playlist-genome
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fitPlaylistGenomeFromCorpus,
  scoreFeaturesAgainstGenome,
} from "../core/editorial/playlist-genome";
import {
  computeHumanPlaylistFeatures,
  scoreAgainstHumanPlaylistPatterns,
} from "../core/editorial/human-playlist-patterns";

function syntheticPlaylist(seed: number, length = 24) {
  return {
    tracks: Array.from({ length }, (_, i) => ({
      trackId: `t${seed}_${i}`,
      trackName: `Track ${i}`,
      artistName: `Artist ${Math.floor(i / 4) + seed}`,
      energy: 0.42 + (i / length) * 0.22,
      valence: 0.55,
      danceability: 0.52,
      acousticness: 0.4,
      popularity: 70 - (i % 6) * 8,
      releaseYear: 2010 + (i % 5),
      rediscoveryScore: i % 5 === 0 ? 0.7 : 0.3,
    })),
  };
}

describe("playlist genome", () => {
  it("fits measured distributions from a synthetic corpus", () => {
    const corpus = Array.from({ length: 12 }, (_, i) => syntheticPlaylist(i + 1));
    const genome = fitPlaylistGenomeFromCorpus(corpus);
    assert.equal(genome.corpusSize, 12);
    assert.ok(genome.distributions.artistSpacingMedian.p50 > 0);
    assert.ok(genome.scoringWeights.artistSpacing > 0);
    assert.ok(Math.abs(
      genome.scoringWeights.artistSpacing +
      genome.scoringWeights.artistDiversity +
      genome.scoringWeights.discoveryRatio +
      genome.scoringWeights.energyArc +
      genome.scoringWeights.transitions +
      genome.scoringWeights.energyJumps +
      genome.scoringWeights.popularityCurve +
      genome.scoringWeights.decadeBalance +
      genome.scoringWeights.tempoDrift -
      1,
    ) < 0.001);
    assert.ok(genome.energyArcMix.rise + genome.energyArcMix.flat + genome.energyArcMix.wave + genome.energyArcMix.cooldown > 0.99);
  });

  it("scores playlists using genome weights instead of fixed heuristics", () => {
    const corpus = Array.from({ length: 12 }, (_, i) => syntheticPlaylist(i + 1));
    const genome = fitPlaylistGenomeFromCorpus(corpus);
    const coherent = syntheticPlaylist(99, 24);
    const salad = {
      tracks: [
        ...coherent.tracks.slice(0, 10),
        { ...coherent.tracks[10]!, artistName: "Metal Band", genreFamily: "metal", energy: 0.95 },
        { ...coherent.tracks[11]!, artistName: "Country Star", genreFamily: "country", energy: 0.4 },
        ...coherent.tracks.slice(12),
      ],
    };
    const coherentFeatures = computeHumanPlaylistFeatures(coherent.tracks);
    const saladFeatures = computeHumanPlaylistFeatures(salad.tracks);
    const coherentScore = scoreFeaturesAgainstGenome(coherentFeatures, genome).score;
    const saladScore = scoreFeaturesAgainstGenome(saladFeatures, genome).score;
    assert.ok(coherentScore >= saladScore);
  });

  it("routes scoreAgainstHumanPlaylistPatterns through fitted genome at runtime", () => {
    const coherent = syntheticPlaylist(42, 20);
    const scored = scoreAgainstHumanPlaylistPatterns(coherent.tracks);
    assert.ok(scored.score > 0.4);
    assert.ok(scored.breakdown.artistSpacing != null);
  });
});
