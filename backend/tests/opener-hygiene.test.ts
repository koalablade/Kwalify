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
import {
  applyFinalApiOpenerHygiene,
  demoteOpenerFillerTracks,
  inferWorldIdentityIdsFromPrompt,
  stripRetrievalFillerTracks,
} from "../core/editorial/world-identity-gate";

test("maxPsychIndieOpenersForWorlds is zero for film-ending and dad-secret worlds", () => {
  assert.equal(maxPsychIndieOpenersForWorlds(["film_ending_world"]), 0);
  assert.equal(maxPsychIndieOpenersForWorlds(["dad_secret_world"]), 0);
  assert.equal(maxPsychIndieOpenersForWorlds(["indie_dream_world"]), 3);
  assert.equal(maxPsychIndieOpenersForWorlds(["grunge_world", "nostalgia_warm_world"]), 3);
  assert.equal(maxPsychIndieOpenersForWorlds(["grunge_world"]), 0);
});

test("sanitizePsychIndieOpenerChain clears hard landfill from openers", () => {
  const tracks = [
    { artist: "Tame Impala" },
    { artist: "Kasabian" },
    { artist: "Q Lazzarus" },
    { artist: "Franz Ferdinand" },
    { artist: "Interpol" },
    { artist: "LCD Soundsystem" },
  ];
  const out = sanitizePsychIndieOpenerChain(tracks, 3, 1);
  const openers = out.tracks.slice(0, 3).map((t) => String(t.artist)).join(" ");
  assert.equal(countOpenerFillerPatternMatches(out.tracks, 3), 0);
  assert.ok(!/kasabian|q lazzarus|tame impala/i.test(openers));
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

test("indie belonging worlds keep Arctic Monkeys openers; hard landfill still demoted", () => {
  const tracks = [
    { artist: "Arctic Monkeys" },
    { artist: "The Killers" },
    { artist: "Jake Bugg" },
    { artist: "Kasabian" },
    { artist: "Franz Ferdinand" },
  ];
  const max = maxPsychIndieOpenersForWorlds(["indie_dream_world", "nostalgia_warm_world"]);
  const out = sanitizePsychIndieOpenerChain(tracks, 3, max);
  const openers = out.tracks.slice(0, 3).map((t) => String(t.artist));
  assert.ok(openers.includes("Arctic Monkeys"));
  assert.ok(openers.includes("The Killers"));
  assert.ok(!openers.includes("Kasabian"));
});

test("shouldSuppressVagueLandfillOpeners blocks landfill on lifestyle prompts without sad mood", () => {
  assert.equal(shouldSuppressVagueLandfillOpeners("just vibes"), true);
  // A recognised situation (road trip) lets its committed world decide instead of a blanket strip.
  assert.equal(shouldSuppressVagueLandfillOpeners("windows-down road trip singalong energy"), false);
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

test("recognised situations keep artists that belong to their world and strip ones that do not", () => {
  const strip = (prompt: string, artists: string[]) =>
    stripRetrievalFillerTracks(
      artists.map((artist) => ({ artist })),
      inferWorldIdentityIdsFromPrompt(prompt),
      { prompt, minKeep: 0 },
    ).tracks.map((t) => t.artist);

  // Funeral → soft_sad_world: Bon Iver / Sufjan / Mitski are the world, not landfill.
  assert.deepEqual(
    strip("going to a funeral", ["Bon Iver", "Sufjan Stevens", "Mitski"]),
    ["Bon Iver", "Sufjan Stevens", "Mitski"],
  );
  // Road trip singalong keeps Arctic Monkeys but still strips Bon Iver.
  assert.deepEqual(strip("road trip with old mates", ["Arctic Monkeys", "Bon Iver"]), ["Arctic Monkeys"]);
  // Unrecognised vague prompts keep the blanket landfill suppression.
  assert.deepEqual(strip("just vibes", ["Bon Iver", "Arctic Monkeys"]), []);
});
