import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  persistGoodPlaylistDeliverySnapshot,
  resolveTimeoutFallbackDeliverableTracks,
  type GoodPlaylistDeliverySnapshotStore,
} from "../lib/good-playlist-delivery-snapshot";
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

const deliverableTracks = (ids: string[]) => ids.map((trackId) => ({
  trackId,
  trackName: `Song ${trackId}`,
  artistName: "Artist",
  albumName: "Album",
  energy: 0.5,
  valence: 0.4,
}));

describe("good playlist delivery snapshot", () => {
  it("persists an immutable snapshot only once", () => {
    const store: GoodPlaylistDeliverySnapshotStore = {};
    const first = persistGoodPlaylistDeliverySnapshot(store, {
      readyAtMs: 1_000,
      elapsedMs: 12_000,
      deliverableTracks: deliverableTracks(["a", "b", "c"]),
      scoringContext,
      targetLength: 30,
    });
    const second = persistGoodPlaylistDeliverySnapshot(store, {
      readyAtMs: 2_000,
      elapsedMs: 20_000,
      deliverableTracks: deliverableTracks(["x", "y"]),
      scoringContext,
      targetLength: 30,
    });
    assert.ok(first);
    assert.equal(second, first);
    assert.deepEqual([...first!.trackIds], ["a", "b", "c"]);
    assert.equal(first!.tracks[0]?.trackId, "a");
  });

  it("prefers good playlist snapshot over finalized tracks for timeout fallback", () => {
    const ctx = {
      goodPlaylistDeliverySnapshot: persistGoodPlaylistDeliverySnapshot({}, {
        readyAtMs: 1_000,
        elapsedMs: 15_000,
        deliverableTracks: deliverableTracks(["good-1", "good-2"]),
        scoringContext,
        targetLength: 30,
      }),
      finalTracks: deliverableTracks(["final-1"]),
    };
    const resolved = resolveTimeoutFallbackDeliverableTracks(ctx);
    assert.equal(resolved?.source, "good_playlist_snapshot");
    assert.deepEqual(resolved?.tracks.map((track) => track.trackId), ["good-1", "good-2"]);
  });

  it("falls back to finalized playlist when snapshot is absent", () => {
    const resolved = resolveTimeoutFallbackDeliverableTracks({
      finalTracks: deliverableTracks(["final-1", "final-2"]),
    });
    assert.equal(resolved?.source, "finalized_playlist");
    assert.equal(resolved?.tracks.length, 2);
  });
});
