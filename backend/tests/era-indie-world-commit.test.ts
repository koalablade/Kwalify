/**
 * Era/genre indie prompts must not vague-default to sunday_chill.
 * Melancholic stays on the chill/sad path (human gold YES).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld, hasExplicitMusicalHardLock } from "../core/committed-world";
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
} from "../core/editorial/world-identity-gate";
import { resolveVagueWorldCommit } from "../lib/vague-world-commit";
import { shouldSuppressVagueLandfillOpeners } from "../core/editorial/opener-hygiene";

test("2000s indie commits indie_dream + nostalgia, not sunday_chill", () => {
  const world = resolveCommittedWorld({ prompt: "2000s indie" })!;
  assert.equal(world.id, "indie_dream_world");
  assert.equal(world.musicalWorldId, "indie_dream_world");
  assert.equal(world.hardLock, true);
  assert.ok(hasExplicitMusicalHardLock(world));
  assert.ok(world.worldIds.includes("indie_dream_world"));
  assert.ok(world.worldIds.includes("nostalgia_warm_world"));
  assert.ok(!world.worldIds.includes("sunday_chill_world"));
  assert.equal(resolveVagueWorldCommit("2000s indie").action, "passthrough");
});

test("indie rock commits indie_dream, not sunday_chill", () => {
  const world = resolveCommittedWorld({ prompt: "indie rock" })!;
  assert.equal(world.id, "indie_dream_world");
  assert.equal(world.hardLock, true);
  assert.ok(!world.worldIds.includes("sunday_chill_world"));
});

test("90s alternative rock commits grunge (+ nostalgia + indie_dream), not sunday_chill", () => {
  const world = resolveCommittedWorld({ prompt: "90s alternative rock" })!;
  assert.equal(world.id, "grunge_world");
  assert.equal(world.hardLock, true);
  assert.ok(world.worldIds.includes("nostalgia_warm_world"));
  assert.ok(world.worldIds.includes("indie_dream_world"));
  assert.ok(!world.worldIds.includes("sunday_chill_world"));
});

test("melancholic still vague-defaults sunday_chill (gold YES path)", () => {
  const world = resolveCommittedWorld({ prompt: "melancholic" })!;
  assert.equal(world.id, "sunday_chill_world");
  assert.equal(world.hardLock, true);
  const vague = resolveVagueWorldCommit("melancholic", { tier: "low", promptConfidenceScore: 0.25 });
  assert.equal(vague.action, "commit");
  assert.equal(vague.worldId, "sunday_chill_world");
});

test("bare nostalgic commits nostalgia_warm, not sunday_chill", () => {
  const vague = resolveVagueWorldCommit("nostalgic", { tier: "low", promptConfidenceScore: 0.25 });
  assert.equal(vague.action, "commit");
  assert.equal(vague.worldId, "nostalgia_warm_world");
  const world = resolveCommittedWorld({ prompt: "nostalgic" })!;
  assert.equal(world.id, "nostalgia_warm_world");
  assert.ok(!world.worldIds.includes("sunday_chill_world"));
});

test("2000s indie safety blanket allows AM / Killers / Jake Bugg / Beach House", () => {
  const world = resolveCommittedWorld({ prompt: "2000s indie" })!;
  const ids = world.worldIds;
  for (const artist of ["Arctic Monkeys", "The Killers", "Jake Bugg", "Beach House"]) {
    assert.equal(
      isSafetyBlanketOutsideWorld(artist, ids),
      false,
      `${artist} should belong under ${ids.join(",")}`,
    );
  }
});

test("sunday chill still blankets Arctic Monkeys (unchanged filler guard)", () => {
  assert.equal(isSafetyBlanketOutsideWorld("Arctic Monkeys", ["sunday_chill_world"]), true);
});

test("named indie prompts do not suppress as vague landfill openers", () => {
  assert.equal(shouldSuppressVagueLandfillOpeners("2000s indie"), false);
  assert.equal(shouldSuppressVagueLandfillOpeners("indie rock"), false);
  assert.equal(shouldSuppressVagueLandfillOpeners("just vibes"), true);
});

test("inferWorldIdentityIdsFromPrompt mirrors era/indie commits", () => {
  const indie2000s = inferWorldIdentityIdsFromPrompt("2000s indie");
  assert.ok(indie2000s.includes("indie_dream_world"), String(indie2000s));
  assert.ok(indie2000s.includes("nostalgia_warm_world"), String(indie2000s));
  assert.ok(!indie2000s.includes("sunday_chill_world"), String(indie2000s));

  const indieRock = inferWorldIdentityIdsFromPrompt("indie rock");
  assert.ok(indieRock.includes("indie_dream_world"), String(indieRock));

  const alt90s = inferWorldIdentityIdsFromPrompt("90s alternative rock");
  assert.ok(alt90s.includes("grunge_world"), String(alt90s));
});
