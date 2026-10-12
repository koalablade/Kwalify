import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { resolveVagueWorldCommit } from "../lib/vague-world-commit";
import { statesNightTime, statesNonNightTime } from "../lib/emotion-scene-layers";
import { filterHitsByStatedTime } from "../lib/world-understanding/situation-world-router";
import { createPipelineAuthoritySession, createPipelineDeliveryBuffer } from "../lib/pipeline-authority/index.js";

// "empty motorway at sunrise" was routed to the night-drive world by every routing layer and came
// back as Eazy-E, a freestyle and title puns.

test("a stated time of day is read as night or not night", () => {
  for (const p of ["empty motorway at sunrise", "empty motorway at dawn", "early morning motorway", "motorway at 7am", "drive at sunset"]) {
    assert.equal(statesNonNightTime(p), true, p);
  }
  for (const p of ["lonely motorway at 2am", "empty motorway at night", "midnight drive"]) {
    assert.equal(statesNightTime(p), true, p);
    assert.equal(statesNonNightTime(p), false, p);
  }
  assert.equal(statesNonNightTime("empty motorway"), false);
});

test("an empty motorway at sunrise is not a night drive", () => {
  for (const p of ["empty motorway at sunrise", "empty motorway at dawn", "early morning empty motorway", "empty motorway at 6am"]) {
    assert.notEqual(resolveCommittedWorld({ prompt: p })?.id, "night_drive_world", p);
    assert.equal(inferWorldIdentityIdsFromPrompt(p).includes("night_drive_world"), false, p);
    assert.notEqual(resolveVagueWorldCommit(p).worldId, "night_drive_world", p);
  }
});

test("night prompts keep the night-drive world", () => {
  for (const p of ["empty motorway", "empty motorway at night", "night drive", "late night drive", "midnight drive"]) {
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "night_drive_world", p);
  }
  assert.equal(resolveCommittedWorld({ prompt: "lonely motorway at 2am" })?.id, "late_night_calm_world");
});

test("atlas situations whose time contradicts the stated time are dropped", () => {
  const hits = [
    { entryId: "motorway_at_night", domain: "transport", matchScore: 0.8 },
    { entryId: "empty_motorway", domain: "transport", matchScore: 0.7 },
  ];
  assert.deepEqual(filterHitsByStatedTime(hits, "empty motorway at sunrise").map((h) => h.entryId), ["empty_motorway"]);
  assert.deepEqual(filterHitsByStatedTime(hits, "empty motorway at 2am").map((h) => h.entryId), ["motorway_at_night", "empty_motorway"]);
  assert.deepEqual(filterHitsByStatedTime(hits, "empty motorway").map((h) => h.entryId), ["motorway_at_night", "empty_motorway"]);
});

type T = { trackId: string; artistName: string };
const t = (id: string): T => ({ trackId: id, artistName: id.toUpperCase() });

test("refill stages cannot re-add a song a guard rejected; guards and re-evaluators can", () => {
  const delivery = createPipelineDeliveryBuffer<T>(createPipelineAuthoritySession(), {
    guardStages: ["human_quality_gate", "world_identity_strip"],
    reEvaluatorStages: ["world_purity_gate"],
  });
  delivery.init("v3_handoff", "init", [t("a"), t("b"), t("c"), t("d")]);
  delivery.replaceTracks("human_quality_gate", "reject b", [t("a"), t("c"), t("d")]);
  delivery.replaceTracks("world_identity_strip", "off-world c", [t("a"), t("d")]);
  delivery.replaceTracks("genre_consistency_cap", "positional cap", [t("a")]);

  // Completion restores the capped song (d) but not the rejected ones (b, c).
  delivery.replaceTracks("final_response_completion", "complete", [t("a"), t("b"), t("c"), t("d"), t("e")]);
  assert.deepEqual(delivery.tracks.map((x) => x.trackId), ["a", "d", "e"]);
  assert.deepEqual(
    delivery.blockedGuardReAdds().map((x) => [x.stage, x.trackId, x.removedBy.join(",")]),
    [["final_response_completion", "b", "human_quality_gate"], ["final_response_completion", "c", "world_identity_strip"]],
  );

  // The world purity gate re-checks world fit itself, so it may re-admit an identity-stripped song.
  delivery.replaceTracks("world_purity_gate", "re-check", [t("a"), t("d"), t("e"), t("c")]);
  assert.deepEqual(delivery.tracks.map((x) => x.trackId), ["a", "d", "e", "c"]);
});

test("a buffer without guard stages behaves as before", () => {
  const delivery = createPipelineDeliveryBuffer<T>(createPipelineAuthoritySession());
  delivery.init("v3_handoff", "init", [t("a"), t("b")]);
  delivery.replaceTracks("human_quality_gate", "reject b", [t("a")]);
  delivery.replaceTracks("final_response_completion", "complete", [t("a"), t("b")]);
  assert.deepEqual(delivery.tracks.map((x) => x.trackId), ["a", "b"]);
});
