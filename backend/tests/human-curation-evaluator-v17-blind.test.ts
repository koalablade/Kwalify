import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBlindHumanCuration,
  HUMAN_CURATION_EVALUATOR_V17_BLIND,
} from "../core/editorial/human-curation-evaluator-v17-blind";

describe("human-curation-evaluator-v17-blind", () => {
  it("exports stable evaluator version", () => {
    assert.equal(HUMAN_CURATION_EVALUATOR_V17_BLIND, "human-curation-evaluator-v17-blind");
  });

  it("Case A: slow ballads fail aggressive gym", () => {
    const result = evaluateBlindHumanCuration("aggressive gym workout", [
      { trackName: "Someone Like You", artistName: "Adele", energy: 0.3, popularity: 85 },
      { trackName: "Skinny Love", artistName: "Bon Iver", energy: 0.25, popularity: 70 },
      { trackName: "The Scientist", artistName: "Coldplay", energy: 0.35, popularity: 80 },
    ]);
    assert.equal(result.wouldPressPlay, "NO");
    assert.equal(result.wouldSave, "NO");
    assert.ok(result.dimensions.momentFit.score < 15);
    assert.ok(result.tracks.every((t) => t.songFit < 6));
  });

  it("Case B: cinematic synth motorway rain scores higher moment fit", () => {
    const result = evaluateBlindHumanCuration("empty motorway at midnight rain on the windscreen", [
      { trackName: "Midnight City", artistName: "M83", energy: 0.62, popularity: 75 },
      { trackName: "Blue Monday", artistName: "New Order", energy: 0.68, popularity: 80 },
      { trackName: "Enjoy the Silence", artistName: "Depeche Mode", energy: 0.55, popularity: 78 },
      { trackName: "A Forest", artistName: "The Cure", energy: 0.58, popularity: 72 },
    ]);
    assert.ok(result.dimensions.momentFit.score >= 14);
    assert.ok(result.wouldPressPlay !== "NO" || result.dimensions.momentFit.score >= 12);
  });

  it("Case C: Madchester Oasis cluster flags scene weakness", () => {
    const result = evaluateBlindHumanCuration("madchester pub walk", [
      { trackName: "Wonderwall", artistName: "Oasis", energy: 0.65, popularity: 90 },
      { trackName: "Champagne Supernova", artistName: "Oasis", energy: 0.58, popularity: 85 },
      { trackName: "Song 2", artistName: "Blur", energy: 0.92, popularity: 82 },
    ]);
    assert.ok(result.canonicalOmissions.length >= 1);
    assert.equal(result.wouldSave, "NO");
  });

  it("Case D: obscure gym opener flagged", () => {
    const result = evaluateBlindHumanCuration("no rap gym workout", [
      { trackName: "Rat Salad", artistName: "Black Sabbath", energy: 0.55, popularity: 12 },
      { trackName: "Iron Man", artistName: "Black Sabbath", energy: 0.85, popularity: 82 },
      { trackName: "Paranoid", artistName: "Black Sabbath", energy: 0.9, popularity: 85 },
    ]);
    assert.ok(result.dimensions.opener.score < 8);
    assert.ok(result.deepCutNotes.some((n) => n.includes("BAD_DEEP_CUT")));
    assert.equal(result.wouldPressPlay, "NO");
  });

  it("Case E: one odd transition can still feel human", () => {
    const result = evaluateBlindHumanCuration("dad rock BBQ with beers", [
      { trackName: "Back In Black", artistName: "AC/DC", energy: 0.85, popularity: 88 },
      { trackName: "Sweet Home Alabama", artistName: "Lynyrd Skynyrd", energy: 0.72, popularity: 85 },
      { trackName: "Don't Stop Believin'", artistName: "Journey", energy: 0.68, popularity: 80 },
      { trackName: "T.N.T.", artistName: "AC/DC", energy: 0.84, popularity: 85 },
      { trackName: "Born to Run", artistName: "Bruce Springsteen", energy: 0.78, popularity: 82 },
    ]);
    assert.ok(result.wouldBelieveHumanMade !== "NO" || result.dimensions.humanPlausibility.score >= 5);
    assert.ok(result.aggregateScore >= 40);
  });

  it("flags gym power ballads as song-fit not artist-fit failure", () => {
    const result = evaluateBlindHumanCuration("heavy gym workout aggressive", [
      { trackName: "T.N.T.", artistName: "AC/DC", energy: 0.84, popularity: 85 },
      { trackName: "Welcome To The Jungle", artistName: "Guns N' Roses", energy: 0.92, popularity: 82 },
      { trackName: "Back In Black", artistName: "AC/DC", energy: 0.85, popularity: 88 },
      { trackName: "Don't Cry", artistName: "Guns N' Roses", energy: 0.42, popularity: 80 },
      { trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", energy: 0.55, popularity: 85 },
    ]);
    const balladTracks = result.tracks.filter((t) => /don'?t cry|sweet child/i.test(t.trackName));
    assert.ok(balladTracks.length >= 2);
    assert.ok(balladTracks.every((t) => t.songFit < 6));
    assert.equal(result.wouldSave, "NO");
  });

  it("motorway Shout tail detected as jarring", () => {
    const result = evaluateBlindHumanCuration("empty motorway at midnight rain on the windscreen", [
      { trackName: "Blue Monday '88", artistName: "New Order", energy: 0.72, popularity: 80 },
      { trackName: "The Lovecats", artistName: "The Cure", energy: 0.55, popularity: 75 },
      { trackName: "Boys Don't Cry", artistName: "The Cure", energy: 0.58, popularity: 78 },
      { trackName: "Head Over Heels", artistName: "Tears For Fears", energy: 0.62, popularity: 72 },
      { trackName: "Shout", artistName: "Tears For Fears", energy: 0.88, popularity: 85 },
    ]);
    assert.ok(result.transitions.some((t) => t.quality === "JARRING" && /shout/i.test(t.to)));
    assert.equal(result.wouldSave, "NO");
  });
});
