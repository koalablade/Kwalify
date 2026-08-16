/**
 * V44 — semantic contract axis scoring tests.
 * Run: npm run build && node --test backend/dist/tests/contract-axis-scoring.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { scoreContractDimension } from "../core/playlist-contract/contract-axis-scoring";

test("V44 not_cheesy penalizes novelty/spam titles over raw energy", () => {
  const technoSpam = {
    trackId: "1",
    trackName: "TECHNO - VIP",
    artistName: "ZAPRAVKA",
    energy: 0.9,
    valence: 0.55,
    danceability: 0.8,
    genreFamily: "electronic",
  };
  const credible = {
    trackId: "2",
    trackName: "Feel It Still",
    artistName: "Portugal. The Man",
    energy: 0.72,
    valence: 0.62,
    danceability: 0.68,
    genreFamily: "indie",
  };
  const spamScore = scoreContractDimension(technoSpam, "not_cheesy", { genreFamily: "electronic" });
  const credibleScore = scoreContractDimension(credible, "not_cheesy", { genreFamily: "indie" });
  assert.ok(credibleScore > spamScore, `expected credible ${credibleScore} > spam ${spamScore}`);
});

test("V44 not_boring rejects flat low-interest tracks", () => {
  const flat = {
    trackId: "1",
    trackName: "Ambient Drone",
    artistName: "Sleep",
    energy: 0.18,
    valence: 0.22,
    danceability: 0.12,
    genreFamily: "ambient",
  };
  const interesting = {
    trackId: "2",
    trackName: "Slow Hands",
    artistName: "Interpol",
    energy: 0.48,
    valence: 0.44,
    danceability: 0.52,
    genreFamily: "indie",
  };
  assert.ok(
    scoreContractDimension(interesting, "not_boring", { genreFamily: "indie" }) >
      scoreContractDimension(flat, "not_boring", { genreFamily: "ambient" }),
  );
});
