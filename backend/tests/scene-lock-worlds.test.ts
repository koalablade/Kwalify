import assert from "node:assert/strict";
import test from "node:test";
import { resolveSceneLock } from "../core/scene-lock-mode";
import type { IntentState } from "../core/intent-state-engine";

const emptyIntent = {} as IntentState;

test("resolveSceneLock locks goth away from reggae/hip-hop", () => {
  const lock = resolveSceneLock(emptyIntent, "goth darkwave night playlist");
  assert.equal(lock.active, true);
  assert.ok(lock.anchors.includes("goth_world"));
  assert.ok(lock.offSceneGenreFamilies.includes("reggae"));
  assert.ok(lock.offSceneGenreFamilies.includes("hip_hop"));
  assert.ok(lock.allowedGenreFamilies.includes("rock"));
});

test("resolveSceneLock locks lofi away from arena rock/metal", () => {
  const lock = resolveSceneLock(emptyIntent, "lofi study beats for homework");
  assert.equal(lock.active, true);
  assert.ok(lock.anchors.includes("lofi_world"));
  assert.ok(lock.offSceneGenreFamilies.includes("rock"));
  assert.ok(lock.offSceneGenreFamilies.includes("metal"));
});

test("resolveSceneLock locks boss fight to high-drive families", () => {
  const lock = resolveSceneLock(emptyIntent, "final boss fight soundtrack energy");
  assert.equal(lock.active, true);
  assert.ok(lock.anchors.includes("boss_fight"));
  assert.ok(lock.allowedGenreFamilies.includes("metal") || lock.allowedGenreFamilies.includes("electronic"));
  assert.ok(lock.offSceneGenreFamilies.includes("country"));
  assert.ok(lock.offSceneGenreFamilies.includes("folk"));
});

test("resolveSceneLock does not fire neon lock on bare neon alone", () => {
  const lock = resolveSceneLock(emptyIntent, "neon lights pop party");
  assert.equal(lock.anchors.includes("neon_tek_drive"), false);
});

test("resolveSceneLock locks neon tek drive electronic world", () => {
  const lock = resolveSceneLock(emptyIntent, "neon tek night drive synthwave");
  assert.equal(lock.active, true);
  assert.ok(lock.anchors.includes("neon_tek_drive"));
  assert.equal(lock.anchors.includes("rainy_night_drive"), false);
  assert.ok(lock.allowedGenreFamilies.includes("electronic"));
  assert.ok(lock.offSceneGenreFamilies.includes("hip_hop"));
});

test("resolveSceneLock locks gym rock / angry rock / pop punk / classic rock worlds", () => {
  const gym = resolveSceneLock(emptyIntent, "gym rock");
  assert.equal(gym.active, true);
  assert.ok(gym.anchors.includes("gym_rock_world"));
  assert.ok(gym.offSceneGenreFamilies.includes("electronic"));

  const angry = resolveSceneLock(emptyIntent, "angry rock workout");
  assert.equal(angry.active, true);
  assert.ok(angry.anchors.includes("angry_rock_world"));

  const popPunk = resolveSceneLock(emptyIntent, "2000s pop punk");
  assert.equal(popPunk.active, true);
  assert.ok(popPunk.anchors.includes("pop_punk_world"));

  const classic = resolveSceneLock(emptyIntent, "70s rock evening");
  assert.equal(classic.active, true);
  assert.ok(classic.anchors.includes("classic_rock_world"));
});
