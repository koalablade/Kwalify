import test from "node:test";
import assert from "node:assert/strict";
import { getDiscoveryModeReadiness } from "../lib/discovery-mode";
import {
  noLibraryArtistSeedQueries,
  noLibrarySearchQueries,
} from "../controllers/generation/generation-no-library-retrieval";
import { buildLockedIntent } from "../core/v3/intent";

test("getDiscoveryModeReadiness rejects mood-only prompts", () => {
  const mood = getDiscoveryModeReadiness("rainy sunday alone feeling low");
  assert.equal(mood.ready, false);
  assert.equal(mood.genreFamilies.length, 0);
  assert.equal(mood.detectedLabel, null);
});

test("getDiscoveryModeReadiness accepts bluesy rock workshop prompts", () => {
  const prompt = "garage workshop fixing my car bluesy rock";
  const readiness = getDiscoveryModeReadiness(prompt);
  assert.equal(readiness.ready, true);
  assert.ok(readiness.genreFamilies.includes("rock"));
  assert.ok(readiness.detectedLabel?.includes("rock"));
  const locked = buildLockedIntent(prompt);
  assert.ok(locked.genreFamilies.includes("rock"));
});

test("getDiscoveryModeReadiness hints when garage is a place not a genre", () => {
  const readiness = getDiscoveryModeReadiness("fixing my car in the garage");
  assert.equal(readiness.ready, false);
  assert.match(readiness.hint ?? "", /music genre/i);
});

test("noLibrarySearchQueries prioritises blues rock compounds", () => {
  const queries = noLibrarySearchQueries(
    "garage workshop fixing my car bluesy rock",
    ["rock", "blues"],
    ["blues_rock"],
  );
  assert.ok(queries.some((q) => /blues rock/i.test(q)));
  assert.ok(queries[0]?.includes("garage workshop") || queries.includes("garage workshop fixing my car bluesy rock"));
});

test("noLibrarySearchQueries seeds UK garage artists and terms", () => {
  const queries = noLibrarySearchQueries(
    "late night UK garage rollers",
    ["electronic"],
    ["uk_garage"],
  );
  assert.ok(queries.some((q) => /uk garage/i.test(q)));
  assert.ok(queries.some((q) => /mj cole|so solid crew/i.test(q)));
});

test("noLibraryArtistSeedQueries prefers subgenre seeds", () => {
  const seeds = noLibraryArtistSeedQueries(["rock"], ["pop_punk"]);
  assert.ok(seeds.some((seed) => /blink-182|green day/i.test(seed)));
});

test("getDiscoveryModeReadiness accepts explicit UK garage music prompts", () => {
  const readiness = getDiscoveryModeReadiness("late night UK garage rollers");
  assert.equal(readiness.ready, true);
  assert.ok(readiness.genreFamilies.includes("electronic"));
  assert.ok(readiness.detectedLabel?.includes("garage"));
});

test("pop punk keeps rock family without generic pop bleed", () => {
  const locked = buildLockedIntent("pop punk driving fast");
  assert.ok(locked.genreFamilies.includes("rock"));
  assert.equal(locked.genreFamilies.includes("pop"), false);
});

test("noLibrarySearchQueries avoids generic popular music fallback terms", () => {
  const queries = noLibrarySearchQueries("afrobeats summer party", ["world"], ["afrobeats"]);
  assert.ok(queries.some((q) => /afrobeats|burna boy|wizkid/i.test(q)));
  assert.equal(queries.some((q) => /^popular music$/i.test(q)), false);
});
