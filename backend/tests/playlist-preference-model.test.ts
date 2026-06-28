/**
 * Preference learning from pairwise human choices.
 *
 * Run: npm run test:playlist-preference-model
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  comparePlaylistsForSelection,
  defaultPreferenceModel,
  extractPairwiseDimensionScores,
  fitPreferenceModelFromBootstrap,
  fitPreferenceModelFromHumanLabels,
  mergePreferenceModels,
  playlistPreferenceUtility,
  type PairwisePlaylistCandidate,
} from "../core/editorial/playlist-preference-model";

function playlist(seed: number, messy = false) {
  const tracks = Array.from({ length: 20 }, (_, i) => ({
    trackId: `t${seed}_${i}`,
    trackName: `Track ${i}`,
    artistName: messy ? `Artist ${i}` : `Artist ${Math.floor(i / 4)}`,
    energy: messy ? (i % 2 === 0 ? 0.9 : 0.2) : 0.45 + (i / 20) * 0.2,
    valence: 0.55,
    danceability: 0.52,
    acousticness: 0.4,
    popularity: 70 - (i % 5) * 6,
    releaseYear: 2012,
    rediscoveryScore: i % 4 === 0 ? 0.65 : 0.3,
  }));
  return tracks;
}

function candidate(label: string, tracks: ReturnType<typeof playlist>, saveable = true): PairwisePlaylistCandidate {
  return {
    label,
    tracks,
    wouldISave: {
      wouldSaveScore: saveable ? 0.82 : 0.55,
      humanPatternScore: saveable ? 0.75 : 0.42,
      gateCuratorScore: saveable ? 0.88 : 0.62,
      combinedScore: saveable ? 0.82 : 0.55,
      humanSaveable: saveable,
      strictMode: true,
      humanPatternBreakdown: {},
      gateRejectionReasons: [],
    },
    context: null,
  };
}

describe("playlist preference model", () => {
  it("cold start keeps heuristic selection mode", () => {
    const model = defaultPreferenceModel();
    const result = comparePlaylistsForSelection(
      candidate("good", playlist(1)),
      candidate("bad", playlist(2, true), false),
      model,
    );
    assert.equal(result.selectionMode, "heuristic");
    assert.equal(result.winner, "a");
  });

  it("bootstrap fit produces non-zero blend weight", () => {
    const corpus = Array.from({ length: 8 }, (_, i) => ({ tracks: playlist(i + 10) }));
    const model = fitPreferenceModelFromBootstrap(corpus);
    assert.ok(model.pairCount > 0);
    assert.ok(model.blendWeight > 0);
    assert.ok(model.dimensionWeights.human_saveable > 0);
  });

  it("human labels shift utility toward the labelled winner", () => {
    const good = playlist(3);
    const bad = playlist(4, true);
    const labels = Array.from({ length: 12 }, (_, i) => ({
      winner: "a" as const,
      playlistA_tracks: good,
      playlistB_tracks: bad,
      rater_id: `r${i}`,
      questions: ["Which would you save?"],
    }));
    const human = fitPreferenceModelFromHumanLabels(labels, new Map());
    assert.ok(human);
    assert.equal(human!.source, "human_labels");
    assert.ok(human!.blendWeight >= 0.55);
    const utilityGood = playlistPreferenceUtility(candidate("good", good), human!);
    const utilityBad = playlistPreferenceUtility(candidate("bad", bad, false), human!);
    assert.ok(utilityGood > utilityBad);
    const pick = comparePlaylistsForSelection(
      candidate("good", good),
      candidate("bad", bad, false),
      human!,
    );
    assert.equal(pick.winner, "a");
  });

  it("merge combines bootstrap and human models", () => {
    const bootstrap = fitPreferenceModelFromBootstrap([{ tracks: playlist(5) }, { tracks: playlist(6) }]);
    const human = fitPreferenceModelFromHumanLabels([
      {
        winner: "a",
        playlistA_tracks: playlist(7),
        playlistB_tracks: playlist(8, true),
      },
      {
        winner: "a",
        playlistA_tracks: playlist(7),
        playlistB_tracks: playlist(8, true),
      },
      {
        winner: "a",
        playlistA_tracks: playlist(7),
        playlistB_tracks: playlist(8, true),
      },
    ], new Map());
    const merged = mergePreferenceModels(bootstrap, human);
    assert.ok(merged.pairCount >= bootstrap.pairCount);
    assert.ok(merged.blendWeight >= bootstrap.blendWeight);
  });

  it("extracts stable dimension feature vectors", () => {
    const scores = extractPairwiseDimensionScores(candidate("x", playlist(9)));
    assert.ok(scores.full_playlist_shape > 0);
    assert.ok(scores.human_saveable > 0);
  });
});
