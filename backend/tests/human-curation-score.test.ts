import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHumanCurationScore } from "../core/editorial/human-curation-score";

describe("human curation score", () => {
  it("scores empty playlist at zero", () => {
    const result = evaluateHumanCurationScore("gym workout", []);
    assert.equal(result.totalScore, 0);
    assert.equal(result.wouldSave, "NO");
    assert.equal(result.wouldPressPlay, "NO");
  });

  it("penalises three-in-a-row artist runs in sequencing dimension", () => {
    const tracks = Array.from({ length: 8 }, (_, i) => ({
      trackName: `Track ${i + 1}`,
      artistName: i < 3 ? "AC/DC" : `Artist ${i}`,
      energy: 0.75,
      popularity: 70,
    }));
    const result = evaluateHumanCurationScore("dad rock BBQ with beers", tracks);
    assert.ok(result.dimensions.sequencing.score < 20);
    assert.ok(result.dimensions.sequencing.evidence.some((e) => e.includes("consecutive")));
  });

  it("rewards coherent gym playlist with high moment score", () => {
    const tracks = [
      { trackName: "Enter Sandman", artistName: "Metallica", energy: 0.88, popularity: 82 },
      { trackName: "Back in Black", artistName: "AC/DC", energy: 0.85, popularity: 88 },
      { trackName: "Kickstart My Heart", artistName: "Mötley Crüe", energy: 0.9, popularity: 75 },
      { trackName: "Welcome to the Jungle", artistName: "Guns N' Roses", energy: 0.92, popularity: 80 },
      { trackName: "Break Stuff", artistName: "Limp Bizkit", energy: 0.87, popularity: 70 },
      { trackName: "Killing in the Name", artistName: "Rage Against the Machine", energy: 0.91, popularity: 78 },
    ];
    const result = evaluateHumanCurationScore("heavy gym workout aggressive", tracks);
    assert.ok(result.totalScore >= 50);
    assert.ok(result.dimensions.momentUnderstanding.score >= 15);
    assert.ok(result.trackDiagnostics.length === 6);
  });

  it("flags obscure opener in sequencing evidence", () => {
    const tracks = [
      { trackName: "Rat Salad", artistName: "Black Sabbath", energy: 0.55, popularity: 12 },
      { trackName: "Back in Black", artistName: "AC/DC", energy: 0.85, popularity: 88 },
      { trackName: "Enter Sandman", artistName: "Metallica", energy: 0.9, popularity: 82 },
    ];
    const result = evaluateHumanCurationScore("no rap gym workout", tracks);
    assert.ok(
      result.dimensions.sequencing.evidence.some((e) => e.toLowerCase().includes("obscure") || e.toLowerCase().includes("deep cut")),
    );
  });
});
