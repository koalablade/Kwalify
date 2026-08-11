import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHumanCurationScore } from "../core/editorial/human-curation-score";
import {
  classifySaveabilityDeliveryTier,
  deriveWouldSaveVerdict,
  legacyFlatLengthWouldSave,
} from "../core/editorial/saveability-verdict";

/** Frozen V19-C deliveries (v19-experiment-c-run-v2.log). */
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
  disco: {
    prompt: "disco rooftop party 1978",
    tracks: [
      { artistName: "Michael Jackson", trackName: "Rock with You - Single Version", energy: 0.72, popularity: 85 },
      { artistName: "ABBA", trackName: "Gimme! Gimme! Gimme! (A Man After Midnight)", energy: 0.78, popularity: 82 },
    ],
  },
  motorway_rain: {
    prompt: "empty motorway at midnight rain on the windscreen",
    tracks: [
      { artistName: "New Order", trackName: "Blue Monday '88", energy: 0.62, popularity: 75 },
      { artistName: "Chromatics", trackName: "Cherry", energy: 0.55, popularity: 45 },
      { artistName: "The Cure", trackName: "The Lovecats", energy: 0.58, popularity: 70 },
      { artistName: "The Cure", trackName: "Boys Don't Cry", energy: 0.65, popularity: 72 },
      { artistName: "Tears For Fears", trackName: "Head Over Heels", energy: 0.68, popularity: 68 },
    ],
  },
  "80s_night_drive": {
    prompt: "80s night drive",
    tracks: [
      { artistName: "The Cure", trackName: "The Lovecats", energy: 0.58, popularity: 70 },
      { artistName: "Tears For Fears", trackName: "Everybody Wants To Rule The World", energy: 0.65, popularity: 85 },
      { artistName: "Tears For Fears", trackName: "Head Over Heels - Dave Bascombe 7\" N.Mix", energy: 0.68, popularity: 60 },
      { artistName: "Gary Numan", trackName: "Cars", energy: 0.62, popularity: 78 },
      { artistName: "The Human League", trackName: "Don't You Want Me", energy: 0.7, popularity: 80 },
      { artistName: "Tears For Fears", trackName: "Head Over Heels", energy: 0.68, popularity: 68 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls - 2001 Remaster", energy: 0.6, popularity: 75 },
    ],
  },
};

describe("v19 saveability tier (Experiment D)", () => {
  it("1. full high-quality playlist (8+ tracks) → Save YES", () => {
    const tracks = Array.from({ length: 9 }, (_, i) => ({
      trackName: `Track ${i + 1}`,
      artistName: `Artist ${i % 5}`,
      energy: 0.75,
      popularity: 70,
    }));
    const result = evaluateHumanCurationScore("dad rock BBQ with beers", tracks);
    assert.equal(result.saveabilityDeliveryTier, "FULL");
    assert.equal(result.wouldSave, "YES");
  });

  it("2. high-quality useful partial (7 tracks, HCS ≥80) → Save YES", () => {
    const tracks = Array.from({ length: 7 }, (_, i) => ({
      trackName: `Track ${i + 1}`,
      artistName: `Artist ${i % 4}`,
      energy: 0.7,
      popularity: 70,
    }));
    const result = evaluateHumanCurationScore("80s night drive", tracks);
    assert.equal(result.saveabilityDeliveryTier, "PARTIAL");
    assert.equal(legacyFlatLengthWouldSave(result.totalScore, tracks.length), "MAYBE");
    assert.equal(result.wouldSave, "YES");
  });

  it("3. very short mini below MINI YES bar → not Save YES", () => {
    const tracks = Array.from({ length: 4 }, (_, i) => ({
      trackName: `Track ${i + 1}`,
      artistName: `Artist ${i % 3}`,
      energy: 0.65,
      popularity: 70,
    }));
    const result = evaluateHumanCurationScore("madchester pub walk", tracks);
    assert.equal(result.saveabilityDeliveryTier, "MINI");
    assert.notEqual(result.wouldSave, "YES");
    assert.equal(result.wouldSave, "MAYBE");
  });

  it("4. stub delivery (<3 tracks) → never Save YES", () => {
    const tracks = [
      { trackName: "Rock with You", artistName: "Michael Jackson", energy: 0.72, popularity: 85 },
      { trackName: "Gimme! Gimme! Gimme!", artistName: "ABBA", energy: 0.78, popularity: 82 },
    ];
    const result = evaluateHumanCurationScore("disco rooftop party 1978", tracks);
    assert.equal(result.saveabilityDeliveryTier, "STUB");
    assert.notEqual(result.wouldSave, "YES");
  });

  it("5. low-quality long playlist → Save NO", () => {
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      trackName: `Ballad ${i + 1}`,
      artistName: "Slow Artist",
      energy: 0.2,
      popularity: 30,
    }));
    const result = evaluateHumanCurationScore("heavy gym workout aggressive", tracks);
    assert.equal(result.saveabilityDeliveryTier, "FULL");
    assert.equal(result.wouldSave, "NO");
  });

  it("6. intermediate HCS (60–79) stays MAYBE on full delivery", () => {
    assert.equal(
      deriveWouldSaveVerdict({
        totalScore: 72,
        trackCount: 10,
        momentScore: 18,
      }),
      "MAYBE",
    );
  });

  it("7. V19-C no_rap_gym (5 tracks / HCS 93) → Save YES", () => {
    const { prompt, tracks } = V19_C.no_rap_gym;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.totalScore, 93);
    assert.equal(result.saveabilityDeliveryTier, "MINI");
    assert.equal(legacyFlatLengthWouldSave(result.totalScore, tracks.length), "MAYBE");
    assert.equal(result.wouldSave, "YES");
  });

  it("8. V19-C disco (2 tracks / HCS 84) → not Save YES", () => {
    const { prompt, tracks } = V19_C.disco;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.totalScore, 84);
    assert.equal(result.saveabilityDeliveryTier, "STUB");
    assert.notEqual(result.wouldSave, "YES");
    assert.equal(result.wouldSave, "MAYBE");
  });

  it("9. V19-C motorway (5 tracks / HCS 93) → Save YES via MINI tier", () => {
    const { prompt, tracks } = V19_C.motorway_rain;
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.totalScore, 93);
    assert.equal(result.saveabilityDeliveryTier, "MINI");
    assert.equal(result.wouldSave, "YES");
  });

  it("10. V19-C 80s (7 tracks / HCS 93) → Save YES via PARTIAL tier", () => {
    const { prompt, tracks } = V19_C["80s_night_drive"];
    const result = evaluateHumanCurationScore(prompt, tracks);
    assert.equal(result.totalScore, 93);
    assert.equal(result.saveabilityDeliveryTier, "PARTIAL");
    assert.equal(result.wouldSave, "YES");
  });

  it("classifies delivery tiers from existing breakpoints", () => {
    assert.equal(classifySaveabilityDeliveryTier(9), "FULL");
    assert.equal(classifySaveabilityDeliveryTier(7), "PARTIAL");
    assert.equal(classifySaveabilityDeliveryTier(5), "MINI");
    assert.equal(classifySaveabilityDeliveryTier(2), "STUB");
  });
});
