import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHumanCurationScore } from "../core/editorial/human-curation-score";
import {
  deriveWouldShareVerdict,
  hasMajorSequencingShareBlocker,
  legacyFlatSequencingWouldShare,
} from "../core/editorial/shareability-verdict";
import { legacyFlatLengthWouldSave } from "../core/editorial/saveability-verdict";
import {
  guardDeepCutOpener,
  ejectOrReplaceBadMomentTracks,
} from "../core/editorial/human-curation-sequencer";

const V19_C = {
  no_rap_gym: {
    prompt: "no rap gym workout",
    tracks: [
      { artistName: "Black Sabbath", trackName: "Paranoid", energy: 0.78, popularity: 70 },
      { artistName: "Black Sabbath", trackName: "Rat Salad", energy: 0.55, popularity: 12 },
      { artistName: "Iron Maiden", trackName: "Fear of the Dark", energy: 0.82, popularity: 75 },
      { artistName: "Nirvana", trackName: "In Bloom", energy: 0.85, popularity: 80 },
      { artistName: "Black Sabbath", trackName: "Iron Man", energy: 0.85, popularity: 78 },
    ],
  },
  motorway: {
    prompt: "empty motorway at midnight rain on the windscreen",
    tracks: [
      { artistName: "New Order", trackName: "Blue Monday '88", energy: 0.62, popularity: 75 },
      { artistName: "Chromatics", trackName: "Cherry", energy: 0.55, popularity: 45 },
      { artistName: "The Cure", trackName: "The Lovecats", energy: 0.58, popularity: 70 },
      { artistName: "The Cure", trackName: "Boys Don't Cry", energy: 0.65, popularity: 72 },
      { artistName: "Tears For Fears", trackName: "Head Over Heels", energy: 0.68, popularity: 68 },
    ],
  },
};

describe("v19 shareability tier (Experiment E)", () => {
  it("1. genuinely poor playlist → Share NO", () => {
    const tracks = Array.from({ length: 8 }, () => ({
      trackName: "Ballad",
      artistName: "Slow Artist",
      energy: 0.2,
      popularity: 20,
    }));
    const result = evaluateHumanCurationScore("heavy gym workout aggressive", tracks);
    assert.equal(result.wouldShare, "NO");
  });

  it("2. genuinely strong full playlist → Share YES", () => {
    const tracks = [
      { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.85, popularity: 70 },
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 88 },
      { artistName: "Fleetwood Mac", trackName: "Silver Springs - 2004 Remaster", energy: 0.55, popularity: 65 },
      { artistName: "AC/DC", trackName: "It's a Long Way to the Top (If You Wanna Rock 'N' Roll)", energy: 0.88, popularity: 72 },
      { artistName: "Fleetwood Mac", trackName: "Hypnotized", energy: 0.5, popularity: 55 },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Breakdown - Remastered", energy: 0.65, popularity: 68 },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Into The Great Wide Open", energy: 0.62, popularity: 70 },
      { artistName: "Led Zeppelin", trackName: "Tangerine - Remaster", energy: 0.45, popularity: 60 },
      { artistName: "Led Zeppelin", trackName: "Immigrant Song - Remaster", energy: 0.82, popularity: 78 },
    ];
    const result = evaluateHumanCurationScore("dad rock BBQ with beers", tracks);
    assert.ok(result.totalScore >= 85);
    assert.equal(result.wouldShare, "YES");
  });

  it("3. borderline sequencing (9/20) → Share MAYBE not YES", () => {
    assert.equal(
      deriveWouldShareVerdict({
        totalScore: 84,
        trackCount: 4,
        sequencingScore: 9,
        momentScore: 25,
        cohesionScore: 20,
        plausibilityScore: 15,
        deliveryTier: "MINI",
      }),
      "MAYBE",
    );
    assert.equal(hasMajorSequencingShareBlocker(9), true);
  });

  it("4. routine 13/20 sequencing with strong HCS → Share YES", () => {
    const { prompt, tracks } = V19_C.motorway;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.dimensions.sequencing.score, 13);
    assert.equal(legacyFlatSequencingWouldShare(result.totalScore, result.dimensions.sequencing.score), "MAYBE");
    assert.equal(result.wouldShare, "YES");
  });

  it("5. 14/20 boundary — legacy YES, new architecture also YES when core strong", () => {
    assert.equal(legacyFlatSequencingWouldShare(90, 14), "YES");
    assert.equal(
      deriveWouldShareVerdict({
        totalScore: 90,
        trackCount: 8,
        sequencingScore: 14,
        momentScore: 22,
        cohesionScore: 18,
        plausibilityScore: 12,
        deliveryTier: "FULL",
      }),
      "YES",
    );
  });

  it("6. MINI delivery with excellence → Share YES", () => {
    const { prompt, tracks } = V19_C.no_rap_gym;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.saveabilityDeliveryTier, "MINI");
    assert.equal(result.totalScore, 93);
    assert.equal(result.wouldShare, "YES");
  });

  it("7. PARTIAL delivery → Share YES when HCS strong", () => {
    const tracks = [
      { artistName: "The Cure", trackName: "The Lovecats", energy: 0.58, popularity: 70 },
      { artistName: "Tears For Fears", trackName: "Everybody Wants To Rule The World", energy: 0.65, popularity: 85 },
      { artistName: "Gary Numan", trackName: "Cars", energy: 0.62, popularity: 78 },
      { artistName: "The Human League", trackName: "Don't You Want Me", energy: 0.7, popularity: 80 },
      { artistName: "Tears For Fears", trackName: "Head Over Heels", energy: 0.68, popularity: 68 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls - 2001 Remaster", energy: 0.6, popularity: 75 },
      { artistName: "Gary Numan", trackName: "We Are Glass", energy: 0.65, popularity: 55 },
    ];
    const result = evaluateHumanCurationScore("80s night drive", tracks);
    assert.equal(result.saveabilityDeliveryTier, "PARTIAL");
    assert.ok(result.totalScore >= 85);
    assert.equal(result.wouldShare, "YES");
  });

  it("8. FULL delivery → Share YES", () => {
    const tracks = [
      { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.85, popularity: 70 },
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 88 },
      { artistName: "Fleetwood Mac", trackName: "Silver Springs - 2004 Remaster", energy: 0.55, popularity: 65 },
      { artistName: "AC/DC", trackName: "It's a Long Way to the Top (If You Wanna Rock 'N' Roll)", energy: 0.88, popularity: 72 },
      { artistName: "Fleetwood Mac", trackName: "Hypnotized", energy: 0.5, popularity: 55 },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Breakdown - Remastered", energy: 0.65, popularity: 68 },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Into The Great Wide Open", energy: 0.62, popularity: 70 },
      { artistName: "Led Zeppelin", trackName: "Tangerine - Remaster", energy: 0.45, popularity: 60 },
      { artistName: "Led Zeppelin", trackName: "Immigrant Song - Remaster", energy: 0.82, popularity: 78 },
    ];
    const result = evaluateHumanCurationScore("dad rock BBQ with beers", tracks);
    assert.equal(result.saveabilityDeliveryTier, "FULL");
    assert.equal(result.wouldShare, "YES");
  });

  it("9. Save verdict unchanged from Experiment D", () => {
    const { prompt, tracks } = V19_C.no_rap_gym;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.wouldSave, "YES");
    assert.equal(legacyFlatLengthWouldSave(result.totalScore, tracks.length), "MAYBE");
  });

  it("10. HCS total unchanged — only Share wiring differs", () => {
    const { prompt, tracks } = V19_C.motorway;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.totalScore, 93);
    assert.equal(result.dimensions.momentUnderstanding.score, 25);
    assert.equal(result.dimensions.sequencing.score, 13);
  });

  it("11. Experiment A cross-pool replacement still works", () => {
    const pool = [
      { trackName: "Enter Sandman", artistName: "Metallica", energy: 0.9 },
      { trackName: "Back In Black", artistName: "AC/DC", energy: 0.85 },
    ];
    const tracks = [
      { trackName: "Rat Salad", artistName: "Black Sabbath", energy: 0.55 },
      { trackName: "Paranoid", artistName: "Black Sabbath", energy: 0.78 },
    ];
    const result = ejectOrReplaceBadMomentTracks(tracks, "gym", {
      replacementPool: pool,
      prompt: "heavy gym workout aggressive",
    });
    assert.ok(result.tracks.length >= 1);
    assert.notEqual(result.tracks[0]!.trackName, "Rat Salad");
  });

  it("12. Experiment C opener guard still swaps Rat Salad", () => {
    const tracks = [
      { trackName: "Rat Salad", artistName: "Black Sabbath", energy: 0.55, popularity: 50 },
      { trackName: "Paranoid", artistName: "Black Sabbath", energy: 0.78, popularity: 50 },
    ];
    const result = guardDeepCutOpener(tracks, "gym");
    assert.equal(result.swapped, true);
    assert.equal(result.tracks[0]!.trackName, "Paranoid");
  });

  it("STUB tier never Share YES", () => {
    const tracks = [
      { trackName: "Rock with You", artistName: "Michael Jackson", energy: 0.72, popularity: 85 },
      { trackName: "Gimme! Gimme! Gimme!", artistName: "ABBA", energy: 0.78, popularity: 82 },
    ];
    const result = evaluateHumanCurationScore("disco rooftop party 1978", tracks);
    assert.equal(result.saveabilityDeliveryTier, "STUB");
    assert.notEqual(result.wouldShare, "YES");
  });
});
