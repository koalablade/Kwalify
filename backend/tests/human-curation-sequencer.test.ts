import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyHumanCurationSequencing,
  breakConsecutiveArtistRuns,
  guardDeepCutOpener,
  isObscureDeepCutOpener,
  scorePositionFit,
} from "../core/editorial/human-curation-sequencer";

type T = {
  trackName: string;
  artistName: string;
  energy?: number | null;
  popularity?: number | null;
  acousticness?: number | null;
  valence?: number | null;
};

function tr(
  name: string,
  artist: string,
  energy: number,
  popularity = 60,
  acousticness = 0.2,
): T {
  return { trackName: name, artistName: artist, energy, popularity, acousticness };
}

describe("human curation sequencer", () => {
  it("breaks three consecutive same-artist runs", () => {
    const tracks = [
      tr("a1", "Zach Bryan", 0.6),
      tr("a2", "Zach Bryan", 0.62),
      tr("a3", "Zach Bryan", 0.61),
      tr("b1", "Luke Combs", 0.58),
      tr("c1", "Chris Stapleton", 0.55),
    ];
    const result = breakConsecutiveArtistRuns(tracks, { maxRun: 2, preserveIndex0: true });
    const artists = result.tracks.map((t) => t.artistName);
    assert.ok(result.swaps >= 1);
    assert.notDeepEqual(artists.slice(0, 3), ["Zach Bryan", "Zach Bryan", "Zach Bryan"]);
  });

  it("penalises power ballad mid-gym position", () => {
    const ballad = tr("Don't Cry", "Guns N' Roses", 0.42, 85, 0.55);
    const banger = tr("Enter Sandman", "Metallica", 0.88, 80, 0.1);
    const midBallad = scorePositionFit(ballad, 8, 20, "gym");
    const midBanger = scorePositionFit(banger, 8, 20, "gym");
    assert.ok(midBanger > midBallad, "high-energy track should fit mid-gym better than ballad");
  });

  it("penalises slow epic early in BBQ set", () => {
    const stairway = tr("Stairway to Heaven", "Led Zeppelin", 0.35, 90, 0.4);
    const acdc = tr("Back in Black", "AC/DC", 0.78, 85, 0.15);
    const earlyStairway = scorePositionFit(stairway, 2, 20, "bbq");
    const earlyAcdc = scorePositionFit(acdc, 2, 20, "bbq");
    assert.ok(earlyAcdc > earlyStairway);
  });

  it("guards obscure deep cut opener", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 12),
      tr("Back in Black", "AC/DC", 0.85, 88),
      tr("Enter Sandman", "Metallica", 0.9, 82),
    ];
    assert.equal(isObscureDeepCutOpener(tracks[0]!, 0), true);
    const guarded = guardDeepCutOpener(tracks, "gym");
    assert.equal(guarded.swapped, true);
    assert.notEqual(guarded.tracks[0]!.trackName, "Rat Salad");
  });

  it("applyHumanCurationSequencing reduces AC/DC clustering in dad rock", () => {
    const tracks = [
      tr("Highway", "AC/DC", 0.75, 80),
      tr("Thunder", "AC/DC", 0.78, 78),
      tr("Back in Black", "AC/DC", 0.82, 85),
      tr("Sweet Emotion", "Aerosmith", 0.7, 75),
      tr("Born to Run", "Bruce Springsteen", 0.72, 70),
    ];
    const result = applyHumanCurationSequencing(tracks, {
      prompt: "dad rock BBQ with beers",
      preserveThesisOpener: true,
    });
    const run = result.tracks.filter((t) => t.artistName === "AC/DC").length;
    assert.ok(run <= 3);
    let maxConsec = 1;
    let cur = 1;
    for (let i = 1; i < result.tracks.length; i += 1) {
      if (result.tracks[i]!.artistName === result.tracks[i - 1]!.artistName) {
        cur += 1;
        maxConsec = Math.max(maxConsec, cur);
      } else {
        cur = 1;
      }
    }
    assert.ok(maxConsec <= 2, `max consecutive should be ≤2, got ${maxConsec}`);
  });
});
