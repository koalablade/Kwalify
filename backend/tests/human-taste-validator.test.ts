import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  repairHumanTastePlaylist,
  validateHumanTastePlaylist,
  type HumanTasteTrack,
} from "../lib/human-taste-validator";

function track(
  id: string,
  artist: string,
  energy: number,
  score = 0.5,
): HumanTasteTrack {
  return {
    trackId: id,
    trackName: id,
    artistName: artist,
    energy,
    valence: 0.5,
    score,
  };
}

describe("human taste validator", () => {
  it("flags three-in-a-row artist runs", () => {
    const tracks = [
      track("a1", "Same Artist", 0.5),
      track("a2", "Same Artist", 0.52),
      track("a3", "Same Artist", 0.51),
      track("b1", "Other", 0.55),
    ];
    const result = validateHumanTastePlaylist({ tracks });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === "artist_run"));
  });

  it("swaps trust outliers from candidate pool", () => {
    const tracks = [
      track("1", "A", 0.5, 0.7),
      track("2", "B", 0.5, 0.7),
      track("3", "C", 0.5, 0.7),
      track("bad", "Outlier", 0.95, 0.1),
      track("5", "E", 0.5, 0.7),
      track("6", "F", 0.5, 0.7),
    ];
    const candidates = [
      track("fix", "Fix Artist", 0.52, 0.75),
      ...tracks,
    ];
    const scoreMomentFit = (t: HumanTasteTrack) => (t.trackId === "bad" ? -0.5 : 0.4);
    const validation = validateHumanTastePlaylist({ tracks, scoreMomentFit });
    assert.equal(validation.passed, false);

    const repaired = repairHumanTastePlaylist({
      tracks,
      candidates,
      scoreMomentFit,
      isCandidateSafe: () => true,
      maxSwaps: 2,
    });
    assert.ok(repaired.swappedCount >= 1);
    assert.ok(!repaired.tracks.some((t) => t.trackId === "bad"));
  });
});
