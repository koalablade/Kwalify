import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  verifyIndependentHumanQuality,
  parsePromptExpectation,
  INDEPENDENT_HUMAN_QUALITY_VERIFIER,
} from "../core/editorial/independent-human-quality-verifier";

describe("independent human quality verifier", () => {
  it("exports v49 verifier version", () => {
    assert.equal(INDEPENDENT_HUMAN_QUALITY_VERIFIER, "v49-independent-human-quality");
  });

  it("parses compound sad party bangers expectation", () => {
    const exp = parsePromptExpectation("sad party bangers");
    assert.ok(exp.compoundAxes.some((a) => a.label.includes("sad party")));
  });

  it("parses party but not cheesy negation", () => {
    const exp = parsePromptExpectation("party but not cheesy");
    assert.ok(exp.negations.includes("cheesy"));
    assert.ok(exp.compoundAxes.some((a) => a.positive === "party_energy"));
  });

  it("flags techno spam on sad party bangers", () => {
    const result = verifyIndependentHumanQuality("sad party bangers", [
      {
        artistName: "DJ Spam",
        trackName: "Stutter Techno VIP Mix",
        energy: 0.9,
        valence: 0.3,
        danceability: 0.8,
      },
      {
        artistName: "The Weeknd",
        trackName: "Blinding Lights",
        energy: 0.73,
        valence: 0.33,
        danceability: 0.51,
      },
    ]);
    const spam = result.tracks.find((t) => t.trackName.includes("Techno"));
    assert.ok(spam);
    assert.equal(spam.flag, "misfit");
    assert.ok(spam.signals.spamSuspect);
    assert.ok(result.roiFailures.some((r) => r.code === "spam_suspect"));
  });

  it("marks coherent compound tracks on melancholic and danceable", () => {
    const result = verifyIndependentHumanQuality("melancholic and danceable", [
      { artistName: "Robyn", trackName: "Dancing On My Own", energy: 0.78, valence: 0.42, danceability: 0.68 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.72, valence: 0.38, danceability: 0.72 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.65, valence: 0.35, danceability: 0.55 },
      { artistName: "CHVRCHES", trackName: "The Mother We Share", energy: 0.68, valence: 0.4, danceability: 0.62 },
      { artistName: "M83", trackName: "Midnight City", energy: 0.75, valence: 0.45, danceability: 0.58 },
    ]);
    const misfitCount = result.tracks.filter((t) => t.flag === "misfit").length;
    assert.ok(misfitCount <= 1);
    assert.ok(result.playlistVerdict !== "weak");
    assert.ok(result.compoundSummary.isCompound);
  });

  it("detects artist clustering as ROI failure", () => {
    const tracks = Array.from({ length: 6 }, (_, i) => ({
      artistName: i < 3 ? "Same Artist" : `Artist ${i}`,
      trackName: `Track ${i + 1}`,
      energy: 0.7,
      valence: 0.5,
      danceability: 0.6,
    }));
    const result = verifyIndependentHumanQuality("party but restrained", tracks);
    assert.ok(result.roiFailures.some((r) => r.code === "artist_clustering"));
  });

  it("returns weak for empty playlist", () => {
    const result = verifyIndependentHumanQuality("late night drive", []);
    assert.equal(result.trackCount, 0);
    assert.equal(result.playlistVerdict, "weak");
  });
});
