import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyTerminalOpenerGuard,
  guardDeepCutOpener,
} from "../core/editorial/human-curation-sequencer";

type T = {
  trackName: string;
  artistName: string;
  energy?: number | null;
  popularity?: number | null;
};

function tr(name: string, artist: string, energy: number, popularity?: number | null): T {
  return { trackName: name, artistName: artist, energy, popularity: popularity ?? null };
}

describe("v19 terminal opener guard", () => {
  it("Test 1: deep-cut opener with better-fit alternative wins when popularity is equal/default", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55),
      tr("Paranoid", "Black Sabbath", 0.78),
      tr("Iron Man", "Black Sabbath", 0.85),
      tr("Fear of the Dark", "Iron Maiden", 0.82),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, true);
    assert.notEqual(result.tracks[0]!.trackName, "Rat Salad");
    assert.ok(
      ["Iron Man", "Paranoid"].includes(result.tracks[0]!.trackName),
      "best-fit gym opener should win over Rat Salad",
    );
  });

  it("Test 2: popularity tie does not block materially better-fit opener", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 50),
      tr("Iron Man", "Black Sabbath", 0.85, 50),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, true);
    assert.equal(result.tracks[0]!.trackName, "Iron Man");
  });

  it("Test 3: higher popularity but materially worse opener fit loses", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 90),
      tr("Intro", "Black Sabbath", 0.35, 95),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, false);
    assert.equal(result.tracks[0]!.trackName, "Rat Salad");
  });

  it("Test 4: already-good opener remains unchanged", () => {
    const tracks = [
      tr("Back In Black", "AC/DC", 0.85, 88),
      tr("T.N.T.", "AC/DC", 0.82, 80),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, false);
    assert.equal(result.tracks[0]!.trackName, "Back In Black");
  });

  it("Test 5: no suitable alternative — opener stays when all candidates fail fit gate", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 12),
      tr("Intro", "Black Sabbath", 0.35, 10),
      tr("Movement I", "Black Sabbath", 0.3, 8),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, false);
    assert.equal(result.tracks[0]!.trackName, "Rat Salad");
  });

  it("Test 6: hard opener failure swaps despite preserveThesisOpener semantics", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 50),
      tr("Iron Man", "Black Sabbath", 0.85, 50),
    ];
    const result = guardDeepCutOpener(tracks, "gym", true);
    assert.equal(result.swapped, true);
    assert.equal(result.tracks[0]!.trackName, "Iron Man");
  });

  it("Test 7: applyTerminalOpenerGuard uses prompt activity generically", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55),
      tr("Iron Man", "Black Sabbath", 0.85),
    ];
    const result = applyTerminalOpenerGuard(tracks, "no rap gym workout");
    assert.equal(result.swapped, true);
    assert.equal(result.tracks[0]!.trackName, "Iron Man");
    assert.match(String(result.newOpener), /Iron Man/i);
  });
});
