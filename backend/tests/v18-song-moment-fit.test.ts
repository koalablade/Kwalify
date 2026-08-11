import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyHumanCurationSequencing,
  ejectOrReplaceBadMomentTracks,
  guardDeepCutOpener,
  guardWeakCloser,
} from "../core/editorial/human-curation-sequencer";
import { momentRejectSeverity, scoreSongMomentFit, passesMomentFitForRefill } from "../core/editorial/song-moment-fit";

type T = {
  trackName: string;
  artistName: string;
  energy?: number | null;
  popularity?: number | null;
};

function tr(name: string, artist: string, energy: number, pop = 60): T {
  return { trackName: name, artistName: artist, energy, popularity: pop };
}

describe("v18 song moment fit", () => {
  it("Test A: gym ballads score lower than anthems", () => {
    const ballad = scoreSongMomentFit(tr("Don't Cry", "Guns N' Roses", 0.42, 80), "gym");
    const banger = scoreSongMomentFit(tr("Welcome To The Jungle", "Guns N' Roses", 0.92, 82), "gym");
    assert.ok(banger > ballad);
    assert.equal(momentRejectSeverity(tr("Don't Cry", "Guns N' Roses", 0.42, 80), "gym", 3, 5), "hard");
  });

  it("Test B: motorway Shout closer is hard reject", () => {
    assert.equal(
      momentRejectSeverity(tr("Shout", "Tears For Fears", 0.88, 85), "motorway_rain", 4, 5),
      "hard",
    );
  });

  it("Test C: Rat Salad opener swapped for Iron Man", () => {
    const tracks = [
      tr("Rat Salad", "Black Sabbath", 0.55, 12),
      tr("Iron Man", "Black Sabbath", 0.85, 82),
      tr("Paranoid", "Black Sabbath", 0.9, 85),
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, true);
    assert.ok(/iron man|paranoid/i.test(result.tracks[0]!.trackName));
  });

  it("Test F: gym V16 set ejects ballads", () => {
    const v16Gym = [
      tr("T.N.T.", "AC/DC", 0.84, 85),
      tr("Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("Back In Black", "AC/DC", 0.85, 88),
      tr("Don't Cry (Original)", "Guns N' Roses", 0.42, 80),
      tr("Sweet Child O' Mine", "Guns N' Roses", 0.55, 85),
    ];
    const eject = ejectOrReplaceBadMomentTracks(v16Gym, "gym");
    const titles = eject.tracks.map((t) => t.trackName.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("don't cry")));
    assert.ok(!titles.some((t) => t.includes("sweet child")));
    assert.ok(eject.tracks.length >= 3);
  });

  it("Test H: motorway Shout removed or demoted from closer", () => {
    const v16Motorway = [
      tr("Blue Monday '88", "New Order", 0.72, 80),
      tr("The Lovecats", "The Cure", 0.55, 75),
      tr("Boys Don't Cry", "The Cure", 0.58, 78),
      tr("Head Over Heels", "Tears For Fears", 0.62, 72),
      tr("Shout", "Tears For Fears", 0.88, 85),
    ];
    const seq = applyHumanCurationSequencing(v16Motorway, {
      prompt: "empty motorway at midnight rain on the windscreen",
    });
    const closer = seq.tracks[seq.tracks.length - 1]!;
    assert.ok(!/shout/i.test(closer.trackName));
  });

  it("Test E: disco off-moment tracks fail refill gate", () => {
    assert.equal(
      passesMomentFitForRefill(tr("Regulate", "Warren G", 0.7, 80), "disco rooftop party 1978"),
      false,
    );
    assert.equal(
      passesMomentFitForRefill(tr("Rock with You", "Michael Jackson", 0.72, 85), "disco rooftop party 1978"),
      true,
    );
  });

  it("guardWeakCloser removes Shout when no swap helps", () => {
    const tracks = [
      tr("Blue Monday", "New Order", 0.72, 80),
      tr("Shout", "Tears For Fears", 0.88, 85),
    ];
    const result = guardWeakCloser(tracks, "motorway_rain");
    assert.ok(result.changed);
    assert.ok(!/shout/i.test(result.tracks[result.tracks.length - 1]!.trackName));
  });
});
