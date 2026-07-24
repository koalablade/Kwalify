import assert from "node:assert/strict";
import test from "node:test";
import { pickDiverseWorldSalvageTracks } from "../lib/world-salvage-pick";

test("salvage picker diversifies artists instead of first-N library order", () => {
  const pool = [
    { trackId: "1", artistName: "Tame Impala" },
    { trackId: "2", artistName: "Tame Impala" },
    { trackId: "3", artistName: "Kasabian" },
    { trackId: "4", artistName: "Q Lazzarus" },
    { trackId: "5", artistName: "Bon Iver" },
    { trackId: "6", artistName: "Feist" },
  ];
  const picked = pickDiverseWorldSalvageTracks(pool, {
    cap: 4,
    seed: "test",
    isEligible: () => true,
  });
  assert.equal(picked.length, 4);
  const artists = new Set(picked.map((t) => t.artistName));
  assert.equal(artists.size, 4);
});
