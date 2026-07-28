import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePsychIndieOpenerChain,
  maxPsychIndieOpenersForWorlds,
  countOpenerFillerPatternMatches,
  OPENER_FILLER_PATTERN,
  shouldSuppressVagueLandfillOpeners,
  demoteRemixBaitOpeners,
  hasExplicitSadIndieMood,
} from "../core/editorial/opener-hygiene";
import { applyFinalApiOpenerHygiene, demoteOpenerFillerTracks } from "../core/editorial/world-identity-gate";

test("maxPsychIndieOpenersForWorlds is zero for film-ending and dad-secret worlds", () => {
  assert.equal(maxPsychIndieOpenersForWorlds(["film_ending_world"]), 0);
  assert.equal(maxPsychIndieOpenersForWorlds(["dad_secret_world"]), 0);
  assert.equal(maxPsychIndieOpenersForWorlds(["indie_dream_world"]), 1);
});

test("sanitizePsychIndieOpenerChain caps opener psych-indie fillers to one", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Franz Ferdinand" },
    { artist: "Interpol" },
  ];
  const out = sanitizePsychIndieOpenerChain(tracks, 3, 1);
  assert.equal(countOpenerFillerPatternMatches(out.tracks, 3), 1);
  assert.ok(!/kasabian|q lazzarus/i.test(String(out.tracks[0]!.artist)));
});

test("sanitizePsychIndieOpenerChain removes all psych openers when max is zero", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Sigur Rós" },
    { artist: "Radiohead" },
    { artist: "Interpol" },
  ];
  const out = sanitizePsychIndieOpenerChain(tracks, 3, 0);
  assert.equal(countOpenerFillerPatternMatches(out.tracks, 3), 0);
  assert.ok(!OPENER_FILLER_PATTERN.test(String(out.tracks[0]!.artist)));
});

test("shouldSuppressVagueLandfillOpeners blocks landfill on lifestyle prompts without sad mood", () => {
  assert.equal(shouldSuppressVagueLandfillOpeners("just vibes"), true);
  assert.equal(shouldSuppressVagueLandfillOpeners("windows-down road trip singalong energy"), true);
  assert.equal(shouldSuppressVagueLandfillOpeners("90s grunge dark cloudy night"), false);
  assert.equal(shouldSuppressVagueLandfillOpeners("i just got dumped be gentle"), false);
  assert.ok(hasExplicitSadIndieMood("i just got dumped be gentle"));
});

test("demoteOpenerFillerTracks demotes Bon Iver on vague vibes prompt", () => {
  const tracks = [
    { artist: "Bon Iver" },
    { artist: "Dua Lipa" },
    { artist: "ABBA" },
    { artist: "Mark Ronson" },
    { artist: "Donna Summer" },
  ];
  const out = demoteOpenerFillerTracks(tracks, ["sunday_chill_world"], 3, "just vibes");
  assert.ok(!/bon iver/i.test(String(out.tracks[0]!.artist)));
  assert.ok(out.demoted.length >= 1);
});

test("demoteRemixBaitOpeners moves remix title out of madchester opener slots", () => {
  const tracks = [
    { artist: "The Stone Roses", trackName: "Fools Gold" },
    { artist: "Happy Mondays", trackName: "Step On - Remastered 2009 Remix" },
    { artist: "Oasis", trackName: "Supersonic" },
    { artist: "Blur", trackName: "Song 2" },
  ];
  const out = demoteRemixBaitOpeners(tracks, ["britpop_world"], 3);
  assert.ok(!/remix/i.test(String(out.tracks[1]!.trackName)));
  assert.ok(out.demoted.length >= 1);
});

test("applyFinalApiOpenerHygiene combines vague landfill and remix demotion", () => {
  const tracks = [
    { artistName: "Bon Iver", trackName: "Holocene" },
    { artistName: "Happy Mondays", trackName: "Hallelujah - Club Mix" },
    { artistName: "Oasis", trackName: "Live Forever" },
    { artistName: "Blur", trackName: "Parklife" },
    { artistName: "Pulp", trackName: "Common People" },
  ];
  const out = applyFinalApiOpenerHygiene(tracks, ["britpop_world"], {
    prompt: "madchester pub walk",
    minKeep: 3,
  });
  assert.ok(!/bon iver/i.test(String(out.tracks[0]!.artistName)));
  assert.ok(!/club mix/i.test(out.tracks.slice(0, 3).map((t) => t.trackName).join(" ")));
});
