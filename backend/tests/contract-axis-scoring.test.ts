/**
 * V44 — semantic contract axis scoring tests.
 * Run: npm run build && node --test backend/dist/tests/contract-axis-scoring.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { driveMomentContextPenalty, isSemanticSpamTrack, scoreContractDimension } from "../core/playlist-contract/contract-axis-scoring";
import { requiredContractDimensions } from "../core/playlist-contract/contract-composition-types";

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

test("V50 isSemanticSpamTrack catches sp33d and sped-up title spam", () => {
  assert.equal(isSemanticSpamTrack({ artistName: "BLVTH", trackName: "NOBODYNOONE - BLVTH ON SP33D REMIX" }), true);
  assert.equal(
    isSemanticSpamTrack({ artistName: "DJ Fronteo", trackName: "Mary On A Cross (Sped Up) - Remix" }),
    true,
  );
  assert.equal(isSemanticSpamTrack({ artistName: "The War on Drugs", trackName: "Red Eyes" }), false);
});

test("V52 driveMomentContextPenalty penalises sped-up spam but not contextual remixes", () => {
  const prompt = "late night drive";
  assert.ok(
    driveMomentContextPenalty(prompt, { artistName: "DJ Fronteo", trackName: "Mary On A Cross (Sped Up) - Remix" }) >= 0.5,
  );
  assert.ok(
    driveMomentContextPenalty(prompt, { artistName: "Calvin Harris", trackName: "I'm Not Alone - CamelPhat Remix", energy: 0.69 }) <= 0,
  );
  assert.ok(
    driveMomentContextPenalty(prompt, { artistName: "Drake", trackName: "Jungle", energy: 0.65 }) <= 0,
  );
  assert.equal(driveMomentContextPenalty("cozy sunday", { artistName: "DJ Fronteo", trackName: "Sped Up" }), 0);
  assert.ok(
    driveMomentContextPenalty(prompt, {
      artistName: "Philip George",
      trackName: "Wish You Were Mine - Radio Edit",
      energy: 0.66,
    }) >= 0.45,
  );
});

test("V51 must:indie_general matches indie family prefix", () => {
  const indieTrack = {
    trackId: "1",
    trackName: "Remember When",
    artistName: "Wallows",
    releaseYear: 2019,
    genreFamily: "indie",
  };
  const score = scoreContractDimension(indieTrack, "must:indie_general", { genreFamily: "indie", genrePrimary: "indie_rock" });
  assert.ok(score >= 0.72, `expected indie family match, got ${score}`);
});

test("V51 must:era:90s scores release years in decade", () => {
  const nineties = {
    trackId: "1",
    trackName: "Song 2",
    artistName: "Blur",
    releaseYear: 1997,
    genreFamily: "indie",
  };
  const modern = {
    trackId: "2",
    trackName: "Remember When",
    artistName: "Wallows",
    releaseYear: 2019,
    genreFamily: "indie",
  };
  assert.ok(
    scoreContractDimension(nineties, "must:era:90s", { genreFamily: "indie" }) >
      scoreContractDimension(modern, "must:era:90s", { genreFamily: "indie" }),
  );
});

test("V51 must:era is scored but not a hard rebalance quota dimension", () => {
  const dims = requiredContractDimensions({
    tension: [],
    must: {
      genres: [{ value: "indie_general", confidence: 0.8 }],
      eras: [{ value: "90s", confidence: 0.8 }],
      activities: [],
    },
    prefer: {
      energy: [{ value: "medium", confidence: 0.7 }],
      moods: [],
      scenes: [],
    },
  } as unknown as import("../core/playlist-contract/types").PlaylistContract);
  assert.ok(dims.includes("must:indie_general"));
  assert.ok(!dims.includes("must:era:90s"), `era must not be required quota dim: ${dims.join(",")}`);
});

test("V52 riddim and squat rave titles are semantic spam", () => {
  assert.equal(isSemanticSpamTrack({ trackName: "Tekkers Riddim", artistName: "Grima x Azza" }), true);
  assert.equal(isSemanticSpamTrack({ trackName: "Squat Rave (Locked Off)", artistName: "Gray" }), true);
  assert.equal(isSemanticSpamTrack({ trackName: "Jungle", artistName: "Drake" }), false);
  assert.equal(isSemanticSpamTrack({ trackName: "I'm Not Alone - CamelPhat Remix", artistName: "Calvin Harris" }), false);
});
