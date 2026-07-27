import test from "node:test";
import assert from "node:assert/strict";
import { resolveSceneBus, resolveSemanticFromBus } from "../lib/scene-resolution-bus";
import { analyzeVibe } from "../lib/emotion";

test("scene bus resolves rain windscreen compound prompt", () => {
  const prompt = "Empty motorway at midnight, rain on the windscreen";
  const bus = resolveSceneBus(prompt);
  assert.equal(bus.sceneId, "rain_windscreen_night_drive");
  assert.equal(bus.semanticSceneId, "LATE_NIGHT_DRIVE");
  assert.ok(bus.confidence >= 0.9);
});

test("scene bus semantic commit aligns with canonical for motorway rain", () => {
  const prompt = "Empty motorway at midnight, rain on the windscreen";
  const bus = resolveSceneBus(prompt);
  const profile = analyzeVibe(prompt);
  const semantic = resolveSemanticFromBus(prompt, profile, bus);
  assert.equal(semantic.matchedId, "LATE_NIGHT_DRIVE");
  assert.equal(semantic.confidence, 0.82);
});
