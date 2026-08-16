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

  it("marks warm and melancholic without false party-axis collapse", () => {
    const result = verifyIndependentHumanQuality("warm and melancholic", [
      { artistName: "Bon Iver", trackName: "Holocene", energy: 0.38, valence: 0.32, danceability: 0.42 },
      { artistName: "Iron & Wine", trackName: "Naked As We Came", energy: 0.35, valence: 0.38, danceability: 0.38 },
      { artistName: "Phoebe Bridgers", trackName: "Motion Sickness", energy: 0.52, valence: 0.35, danceability: 0.48 },
      { artistName: "The National", trackName: "Bloodbuzz Ohio", energy: 0.58, valence: 0.28, danceability: 0.42 },
      { artistName: "Fleet Foxes", trackName: "White Winter Hymnal", energy: 0.42, valence: 0.4, danceability: 0.35 },
    ]);
    const misfitCount = result.tracks.filter((t) => t.flag === "misfit").length;
    assert.ok(misfitCount <= 2, `expected <=2 misfits, got ${misfitCount}`);
    assert.ok(result.playlistVerdict !== "weak");
  });

  it("accepts driving playlists on nostalgic driving via audio driving signal", () => {
    const result = verifyIndependentHumanQuality("nostalgic driving", [
      { artistName: "The War on Drugs", trackName: "Red Eyes", energy: 0.68, valence: 0.42, danceability: 0.52, releaseYear: 2014 },
      { artistName: "M83", trackName: "Midnight City", energy: 0.72, valence: 0.45, danceability: 0.58, releaseYear: 2011 },
      { artistName: "Arcade Fire", trackName: "The Suburbs", energy: 0.62, valence: 0.38, danceability: 0.48, releaseYear: 2010 },
      { artistName: "Phoenix", trackName: "1901", energy: 0.74, valence: 0.55, danceability: 0.62, releaseYear: 2009 },
      { artistName: "Two Door Cinema Club", trackName: "What You Know", energy: 0.78, valence: 0.58, danceability: 0.68, releaseYear: 2010 },
    ]);
    const misfitCount = result.tracks.filter((t) => t.flag === "misfit").length;
    assert.ok(misfitCount <= 2, `expected <=2 misfits, got ${misfitCount}`);
    assert.ok(result.playlistVerdict !== "weak");
  });

  it("accepts cozy acoustic rainy Sunday playlists", () => {
    const result = verifyIndependentHumanQuality("rainy Sunday", [
      { artistName: "Big Thief", trackName: "Change", energy: 0.45, valence: 0.48, danceability: 0.42, acousticness: 0.55 },
      { artistName: "Adrianne Lenker", trackName: "anything", energy: 0.43, valence: 0.4, danceability: 0.38, acousticness: 0.62 },
      { artistName: "Tigers Jaw", trackName: "Safe In Your Skin", energy: 0.31, valence: 0.42, danceability: 0.35, acousticness: 0.58 },
      { artistName: "Iron & Wine", trackName: "Naked As We Came", energy: 0.35, valence: 0.38, danceability: 0.38, acousticness: 0.72 },
      { artistName: "SYML", trackName: "Where's My Love - Acoustic", energy: 0.42, valence: 0.53, danceability: 0.39, acousticness: 0.59 },
    ]);
    const misfitCount = result.tracks.filter((t) => t.flag === "misfit").length;
    assert.ok(misfitCount <= 2, `expected <=2 misfits, got ${misfitCount}`);
    assert.ok(result.playlistVerdict !== "weak");
    const exp = parsePromptExpectation("rainy Sunday");
    assert.equal(exp.worldHint, "sunday_chill_world");
  });

  it("returns weak for empty playlist", () => {
    const result = verifyIndependentHumanQuality("late night drive", []);
    assert.equal(result.trackCount, 0);
    assert.equal(result.playlistVerdict, "weak");
  });
});
