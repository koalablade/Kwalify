import assert from "node:assert/strict";
import test from "node:test";
import {
  measureSceneWorldLibrarySupply,
  resolveWorldGateContext,
} from "../core/playlist-contract/world-gate-context";
import { setPlaylistContractWorldGateEnabled } from "../core/playlist-contract/feature-flag";
import { resolveCommittedWorld } from "../core/committed-world";
import { SCENE_WORLD_OPENING_SUPPLY_MIN } from "../core/editorial/world-purity-gate";

// "night drive" on a real 9.7k-song library: no song reached the night-drive world's opening purity
// bar, so the hard lock stripped the playlist to 2 songs ("late night drive", "midnight drive" and
// "empty motorway at sunrise" were refused with a 422).

function song(i: number, artistName: string, genres: string[], energy = 0.55, valence = 0.4) {
  return {
    trackId: `t${i}`,
    trackName: `Song ${i}`,
    artistName,
    albumName: "",
    spotifyArtistGenres: genres,
    energy,
    valence,
    releaseYear: 2011,
  };
}

const genericLibrary = Array.from({ length: 40 }, (_, i) =>
  song(i, `Band ${i}`, ["indie rock", "dream pop", "synthpop"]),
);
const anchorLibrary = [
  ...genericLibrary,
  ...["M83", "Chromatics", "The War On Drugs", "Depeche Mode", "M83", "Chromatics"].map((artist, i) =>
    song(100 + i, artist, ["synthpop", "electronic", "dream pop"]),
  ),
];

function withWorldGate<T>(fn: () => T): T {
  setPlaylistContractWorldGateEnabled(true);
  try {
    return fn();
  } finally {
    setPlaylistContractWorldGateEnabled(null);
  }
}

test("a scene world the library cannot open is kept as a soft hypothesis", () => {
  withWorldGate(() => {
    const result = resolveWorldGateContext({ prompt: "night drive", library: genericLibrary });
    assert.equal(result.rawWorld?.id, "night_drive_world");
    assert.equal(result.rawWorld?.hardLock, true);
    assert.equal(result.librarySupply?.openingCapable, 0);
    assert.equal(result.gateDecision?.deferHardLock, true);
    assert.ok(result.gateDecision?.reasons.includes("library_cannot_supply_scene_world"));
    // The scene is still the hypothesis (its musical character still ranks); only the hard lock goes.
    assert.equal(result.effectiveWorld?.id, "night_drive_world");
    assert.equal(result.effectiveWorld?.hardLock, false);
  });
});

test("a scene world the library can open keeps its hard lock", () => {
  withWorldGate(() => {
    const result = resolveWorldGateContext({ prompt: "night drive", library: anchorLibrary });
    assert.ok((result.librarySupply?.openingCapable ?? 0) >= SCENE_WORLD_OPENING_SUPPLY_MIN);
    assert.equal(result.gateDecision?.deferHardLock, false);
    assert.equal(result.effectiveWorld?.hardLock, true);
  });
});

test("a genre the user named stays a hard lock however thin the library", () => {
  const emo = resolveCommittedWorld({ prompt: "2000s emo" });
  assert.equal(emo?.hardLock, true);
  assert.equal(measureSceneWorldLibrarySupply(emo, genericLibrary), null);
  withWorldGate(() => {
    const result = resolveWorldGateContext({ prompt: "2000s emo", library: genericLibrary });
    assert.equal(result.librarySupply, null);
    assert.equal(result.gateDecision?.reasons.includes("library_cannot_supply_scene_world"), false);
  });
});

test("no library (discovery mode) means no supply check", () => {
  const night = resolveCommittedWorld({ prompt: "night drive" });
  assert.equal(measureSceneWorldLibrarySupply(night, undefined), null);
  assert.equal(measureSceneWorldLibrarySupply(night, []), null);
});
