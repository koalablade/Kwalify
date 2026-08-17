/**
 * V53 atmospheric context scoring tests.
 * Run: npm run build && node --test backend/dist/tests/atmospheric-context-scoring.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  atmosphericLexicalHackPenalty,
  isAtmosphericLexicalHack,
  resolveAtmosphericContext,
  scoreAtmosphericContextFit,
} from "../core/editorial/atmospheric-context-scoring";

test("resolveAtmosphericContext maps world ids generically", () => {
  assert.equal(resolveAtmosphericContext("night_drive_world"), "night_drive");
  assert.equal(resolveAtmosphericContext("sunday_chill_world"), "cozy_morning");
  assert.equal(resolveAtmosphericContext("lofi_world"), "lofi_focus");
  assert.equal(resolveAtmosphericContext("party_prep_world"), null);
});

test("night_drive prefers cinematic mid-energy over stadium anthems", () => {
  const cinematic = {
    trackName: "Red Eyes",
    artistName: "The War on Drugs",
    energy: 0.55,
    valence: 0.42,
    danceability: 0.48,
    genreFamily: "indie",
  };
  const anthem = {
    trackName: "Don't Stop Believin'",
    artistName: "Journey",
    energy: 0.89,
    valence: 0.82,
    danceability: 0.72,
    genreFamily: "rock",
  };
  assert.ok(
    scoreAtmosphericContextFit(cinematic, "night_drive") >
      scoreAtmosphericContextFit(anthem, "night_drive"),
  );
});

test("cozy_morning prefers warm acoustic mellow over live-radio energy", () => {
  const cozy = {
    trackName: "Holocene",
    artistName: "Bon Iver",
    energy: 0.38,
    valence: 0.52,
    acousticness: 0.62,
    danceability: 0.38,
    genreFamily: "indie",
  };
  const live = {
    trackName: "Lights & Music - triple j Like A Version",
    artistName: "The Jungle Giants",
    energy: 0.68,
    valence: 0.74,
    acousticness: 0.22,
    danceability: 0.66,
    genreFamily: "indie",
  };
  assert.ok(
    scoreAtmosphericContextFit(cozy, "cozy_morning") >
      scoreAtmosphericContextFit(live, "cozy_morning"),
  );
  assert.ok(isAtmosphericLexicalHack(live, "cozy_morning"));
});

test("lofi_focus prefers low-energy instrumental over title-only lofi claims", () => {
  const focus = {
    trackName: "Daylight",
    artistName: "Bonobo",
    energy: 0.32,
    valence: 0.44,
    danceability: 0.42,
    instrumentalness: 0.72,
    speechiness: 0.04,
    genreFamily: "electronic",
  };
  const lexical = {
    trackName: "Lost In You - Lofi",
    artistName: "ChillHop Beats",
    energy: 0.62,
    valence: 0.58,
    danceability: 0.64,
    instrumentalness: 0.05,
    speechiness: 0.18,
    genreFamily: "electronic",
  };
  assert.ok(
    scoreAtmosphericContextFit(focus, "lofi_focus") >
      scoreAtmosphericContextFit(lexical, "lofi_focus"),
  );
  assert.ok(atmosphericLexicalHackPenalty(lexical, "lofi_focus") >= 0.42);
  assert.ok(!isAtmosphericLexicalHack(focus, "lofi_focus"));
});

test("lexical hack penalty ignores credible non-title sonic matches", () => {
  const credible = {
    trackName: "Tailwhip Revisited",
    artistName: "Men I Trust",
    energy: 0.36,
    valence: 0.48,
    danceability: 0.44,
    instrumentalness: 0.12,
    speechiness: 0.06,
    genreFamily: "indie",
  };
  assert.equal(atmosphericLexicalHackPenalty(credible, "lofi_focus"), 0);
});
