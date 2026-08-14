/**
 * Unit tests for V39 contract-gated world commitment.
 * Run: npm run build && node --test backend/dist/tests/world-gate.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommittedWorld } from "../core/committed-world";
import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { compareContractWithWorld } from "../core/playlist-contract/compare-with-world";
import {
  setPlaylistContractWorldGateEnabled,
} from "../core/playlist-contract/feature-flag";
import { resolveWorldGateContext } from "../core/playlist-contract/world-gate-context";
import {
  evaluateWorldGate,
  genreAlignsWithWorld,
  isVagueDefaultWorld,
} from "../core/playlist-contract/world-gate";

function gate(prompt: string) {
  const world = resolveCommittedWorld({ prompt });
  const contract = buildPlaylistContract({ prompt, committedWorld: world });
  const disagreements = compareContractWithWorld(contract, world);
  return evaluateWorldGate({ contract, world, disagreements });
}

test("explicit dad rock BBQ stays hard lock", () => {
  setPlaylistContractWorldGateEnabled(true);
  const decision = gate("dad rock BBQ");
  assert.equal(decision.deferHardLock, false);
  assert.equal(decision.mode, "hard_lock");
  setPlaylistContractWorldGateEnabled(null);
});

test("2000s pop punk gym workout stays hard lock (musical not gym)", () => {
  setPlaylistContractWorldGateEnabled(true);
  const decision = gate("2000s pop punk gym workout");
  assert.equal(decision.deferHardLock, false);
  assert.equal(decision.effectiveWorld?.id, "pop_punk_world");
  assert.equal(decision.effectiveWorld?.hardLock, true);
  setPlaylistContractWorldGateEnabled(null);
});

test("UK grime workout stays hard lock", () => {
  const decision = gate("UK grime workout");
  assert.equal(decision.deferHardLock, false);
});

test("sad party bangers defers hard lock", () => {
  const decision = gate("sad party bangers");
  assert.equal(decision.deferHardLock, true);
  assert.equal(decision.mode, "soft_hypothesis");
  assert.equal(decision.effectiveWorld?.hardLock, false);
  assert.ok(decision.reasons.some((r) => r.includes("tension")));
});

test("energetic but not cheesy defers hard lock", () => {
  const decision = gate("energetic but not cheesy");
  assert.equal(decision.deferHardLock, true);
});

test("deep house afterparty defers on genre/world mismatch or vague fallback", () => {
  const decision = gate("deep house afterparty");
  assert.equal(decision.deferHardLock, true);
});

test("sunset beach reggae stays hard lock", () => {
  const decision = gate("sunset beach reggae");
  assert.equal(decision.deferHardLock, false);
});

test("negation alone does not force defer when world aligns", () => {
  const decision = gate("feel-good soul no rap");
  assert.equal(decision.deferHardLock, false);
});

test("isVagueDefaultWorld detects sunday_chill on non-sunday prompt", () => {
  const world = resolveCommittedWorld({ prompt: "sad party bangers" });
  assert.ok(world);
  assert.equal(isVagueDefaultWorld(world, "sad party bangers"), true);
});

test("genreAlignsWithWorld rejects deep_house vs sunday_chill", () => {
  const world = resolveCommittedWorld({ prompt: "deep house afterparty" })!;
  assert.equal(genreAlignsWithWorld({ value: "deep_house", source: "test", confidence: 0.8 }, world), false);
});

test("world gate off leaves effective world unchanged", () => {
  setPlaylistContractWorldGateEnabled(false);
  const ctx = resolveWorldGateContext({ prompt: "sad party bangers" });
  assert.equal(ctx.gateDecision, null);
  assert.equal(ctx.effectiveWorld?.hardLock, true);
  setPlaylistContractWorldGateEnabled(null);
});

test("world gate on softens sad party bangers", () => {
  setPlaylistContractWorldGateEnabled(true);
  const ctx = resolveWorldGateContext({ prompt: "sad party bangers" });
  assert.equal(ctx.gateDecision?.deferHardLock, true);
  assert.equal(ctx.effectiveWorld?.hardLock, false);
  assert.ok(ctx.diagnostics?.deferReasons.length);
  setPlaylistContractWorldGateEnabled(null);
});

test("late night UK garage drive stays hard lock", () => {
  const decision = gate("late night UK garage drive");
  assert.equal(decision.deferHardLock, false);
});

test("lo-fi study focus stays hard lock when world matches", () => {
  const decision = gate("lo-fi study focus");
  assert.equal(decision.deferHardLock, false);
});
