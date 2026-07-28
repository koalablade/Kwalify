import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePsychIndieOpenerChain,
  maxPsychIndieOpenersForWorlds,
  countOpenerFillerPatternMatches,
  OPENER_FILLER_PATTERN,
} from "../core/editorial/opener-hygiene";

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
