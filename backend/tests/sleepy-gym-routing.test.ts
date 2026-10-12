import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";

// "sleepy gym workout chill energy" matched the "gym workout" row and was hard-locked to heavy gym;
// the editorial layer then picked metal_intensity and the generation was refused (422).

test("a sleepy / chill gym session commits the sleepy gym world", () => {
  for (const prompt of ["sleepy gym workout chill energy", "sleepy gym", "chill gym session", "gym but low energy"]) {
    assert.equal(resolveCommittedWorld({ prompt })?.id, "sleepy_gym_world", prompt);
  }
});

test("ordinary and heavy gym prompts keep their worlds", () => {
  assert.equal(resolveCommittedWorld({ prompt: "gym workout" })?.id, "heavy_gym_world");
  assert.equal(resolveCommittedWorld({ prompt: "heavy gym" })?.id, "angry_rock_world");
  assert.equal(resolveCommittedWorld({ prompt: "metal for the gym" })?.id, "angry_rock_world");
  assert.equal(resolveCommittedWorld({ prompt: "gym" })?.id, "gym_rock_world");
});
