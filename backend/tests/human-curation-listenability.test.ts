import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectListenabilityFailures } from "../core/editorial/human-curation-sequencer";

describe("detectListenabilityFailures", () => {
  it("flags gym ballads and motorway shout tail", () => {
    const gymFails = detectListenabilityFailures(
      [
        { trackName: "T.N.T.", artistName: "AC/DC", energy: 0.84, popularity: 85 },
        { trackName: "Welcome To The Jungle", artistName: "Guns N' Roses", energy: 0.92, popularity: 82 },
        { trackName: "Don't Cry", artistName: "Guns N' Roses", energy: 0.42, popularity: 80 },
        { trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", energy: 0.55, popularity: 85 },
      ],
      "heavy gym workout aggressive",
    );
    assert.ok(gymFails.some((f) => f.code === "gym_ballad_midset"));

    const rainFails = detectListenabilityFailures(
      [
        { trackName: "Blue Monday", artistName: "New Order", energy: 0.72, popularity: 80 },
        { trackName: "Shout", artistName: "Tears For Fears", energy: 0.88, popularity: 85 },
      ],
      "empty motorway at midnight rain on the windscreen",
    );
    assert.ok(rainFails.some((f) => f.code === "motorway_anthem_tail"));
  });

  it("flags missing madchester canonical anchors", () => {
    const fails = detectListenabilityFailures(
      [
        { trackName: "Wonderwall", artistName: "Oasis", energy: 0.65, popularity: 90 },
        { trackName: "Champagne Supernova", artistName: "Oasis", energy: 0.58, popularity: 85 },
      ],
      "madchester pub walk",
    );
    assert.ok(fails.some((f) => f.code === "madchester_missing_canonical"));
  });
});
