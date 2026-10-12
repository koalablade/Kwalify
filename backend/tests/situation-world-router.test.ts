import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSituationWorld,
  routeSituationFromAtlasHits,
} from "../lib/world-understanding/situation-world-router";
import { resolveVagueWorldCommit } from "../lib/vague-world-commit";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";

test("the defining situation outweighs the circumstance (life event > transport)", () => {
  const route = routeSituationFromAtlasHits([
    { entryId: "driving_home_after_work", domain: "transport", matchScore: 0.75 },
    { entryId: "grief_and_loss", domain: "life-events", matchScore: 0.68 },
  ]);
  assert.equal(route?.experienceId, "grief_and_loss");
  assert.equal(route?.worldId, "soft_sad_world");
});

test("an unmapped dominant situation never falls through to a weaker one", () => {
  const route = routeSituationFromAtlasHits([
    { entryId: "restoring_cars", domain: "activities", matchScore: 1.2 },
    { entryId: "pub_evening", domain: "activities", matchScore: 0.5 },
  ]);
  assert.equal(route, null);
});

test("weak situation matches do not choose the world", () => {
  assert.equal(
    routeSituationFromAtlasHits([{ entryId: "party_night", domain: "social", matchScore: 0.2 }]),
    null,
  );
});

// Real prompts from the context test set — the world must follow what the moment means.
const SITUATION_CASES: Array<[string, string]> = [
  ["going to a funeral", "soft_sad_world"],
  ["driving home from a funeral", "soft_sad_world"],
  ["finally getting good news", "feel_good_world"],
  ["having a beer with mates after work", "pub_singalong_world"],
  ["pre-drinks with friends", "party_prep_world"],
  ["getting ready for a night out", "party_prep_world"],
  ["driving home from work", "nostalgia_warm_world"],
  ["missing someone", "soft_sad_world"],
  ["Sunday anxiety", "indie_bedroom_world"],
];

test("context prompts commit the world of their situation", () => {
  for (const [prompt, world] of SITUATION_CASES) {
    const commit = resolveVagueWorldCommit(prompt);
    assert.equal(commit.action, "commit", prompt);
    assert.equal(commit.worldId, world, prompt);
    assert.match(commit.reason, /^situation_world:/, prompt);
  }
});

test("funeral / good news / beer with mates no longer share the sunday_chill default", () => {
  const worlds = ["going to a funeral", "finally getting good news", "having a beer with mates after work"]
    .map((p) => inferWorldIdentityIdsFromPrompt(p));
  for (const ids of worlds) assert.ok(!ids.includes("sunday_chill_world"), JSON.stringify(ids));
  assert.equal(new Set(worlds.map((ids) => ids[0])).size, 3);
});

test("driving home from work and from a funeral resolve to different worlds", () => {
  assert.notEqual(
    inferWorldIdentityIdsFromPrompt("driving home from work")[0],
    inferWorldIdentityIdsFromPrompt("driving home from a funeral")[0],
  );
});

test("named musical worlds are untouched by situation routing", () => {
  assert.equal(resolveVagueWorldCommit("90s grunge for a funeral").action, "passthrough");
  assert.equal(resolveSituationWorld(""), null);
});

test("a named genre keeps its world when a situation is added (emo → pop-punk)", () => {
  assert.equal(inferWorldIdentityIdsFromPrompt("2000s emo")[0], "pop_punk_world");
  assert.equal(inferWorldIdentityIdsFromPrompt("2000s emo for driving home at night")[0], "pop_punk_world");
  assert.equal(resolveVagueWorldCommit("2000s emo for driving home at night").action, "passthrough");
});
