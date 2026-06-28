import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  comparePlaylistSequences,
  createGoodPlaylistRefinementTelemetry,
  isGenuinelyUsablePlaylist,
  minUsableTrackCount,
  rollupRefinementObservability,
} from "../lib/good-playlist-refinement-telemetry";
import type { PlaylistCurationScoringContext } from "../core/editorial/would-i-save-evaluator";

const scoringContext: PlaylistCurationScoringContext = {
  prompt: "rainy night walk",
  lockedIntent: {
    genreFamilies: ["indie"],
    primaryGenre: "indie",
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: ["melancholic"],
    activity: null,
    energy: null,
  },
  context: null,
  targetLength: 30,
};

const tracks = (ids: string[]) => ids.map((trackId) => ({
  trackId,
  artistName: "Artist",
  energy: 0.5,
  valence: 0.4,
  danceability: 0.5,
  acousticness: 0.3,
  score: 0.6,
}));

describe("good playlist refinement telemetry", () => {
  it("defines genuinely usable playlists at the delivery floor", () => {
    assert.equal(minUsableTrackCount(30), 22);
    assert.equal(isGenuinelyUsablePlaylist(22, 30), true);
    assert.equal(isGenuinelyUsablePlaylist(10, 30), false);
  });

  it("captures refinement deltas without changing playlists", () => {
    const start = Date.now() - 15_000;
    const telemetry = createGoodPlaylistRefinementTelemetry(start, 30);
    telemetry.captureGoodPlaylistReady(tracks(["a", "b", "c"]), scoringContext);
    const report = telemetry.finalize(tracks(["a", "x", "c"]), 0.71);
    assert.equal(report.goodPlaylistReadyReached, true);
    assert.ok((report.goodPlaylistReadyElapsedMs ?? 0) >= 14_000);
    assert.equal(report.trackCountAtGoodPlaylistReady, 3);
    assert.equal(report.tracksChangedByRefinement, 2);
    assert.equal(report.finalWinnerDiffersFromInitial, true);
    assert.ok(typeof report.averageConfidenceAtGoodPlaylistReady === "number");
    assert.ok(typeof report.confidenceAfterRefinement === "number");
  });

  it("rolls up benchmark refinement observability", () => {
    const rollup = rollupRefinementObservability([
      {
        goodPlaylistReadyReached: true,
        goodPlaylistReadyElapsedMs: 18_000,
        trackCountAtGoodPlaylistReady: 30,
        averageConfidenceAtGoodPlaylistReady: 0.62,
        averageTrackScoreAtGoodPlaylistReady: 0.55,
        genuinelyUsableAtGoodPlaylistReady: true,
        confidenceAfterRefinement: 0.66,
        averageTrackScoreAfterRefinement: 0.57,
        believabilityAfterRefinement: 0.66,
        confidenceImprovement: 0.04,
        believabilityImprovement: 0.04,
        tracksChangedByRefinement: 4,
        positionsChangedByRefinement: 2,
        finalWinnerDiffersFromInitial: true,
      },
      {
        goodPlaylistReadyReached: false,
        goodPlaylistReadyElapsedMs: null,
        trackCountAtGoodPlaylistReady: null,
        averageConfidenceAtGoodPlaylistReady: null,
        averageTrackScoreAtGoodPlaylistReady: null,
        genuinelyUsableAtGoodPlaylistReady: null,
        confidenceAfterRefinement: null,
        averageTrackScoreAfterRefinement: null,
        believabilityAfterRefinement: null,
        confidenceImprovement: null,
        believabilityImprovement: null,
        tracksChangedByRefinement: null,
        positionsChangedByRefinement: null,
        finalWinnerDiffersFromInitial: null,
      },
    ]);
    assert.equal(rollup.goodPlaylistReadyReachRate, 50);
    assert.equal(rollup.medianGoodPlaylistReadyElapsedMs, 18_000);
    assert.equal(rollup.averageConfidenceImprovement, 0.04);
    assert.equal(rollup.averageTracksChangedByRefinement, 4);
    assert.equal(rollup.finalWinnerDiffersRate, 100);
  });

  it("compares playlist sequences", () => {
    const diff = comparePlaylistSequences(["a", "b", "c"], ["a", "x", "c", "d"]);
    assert.equal(diff.tracksChangedByRefinement, 3);
    assert.equal(diff.positionsChanged, 2);
    assert.equal(diff.finalWinnerDiffersFromInitial, true);
  });
});
