import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateHumanQualityGate,
  HumanQualityGateError,
} from "../core/editorial/human-quality-gate";
import {
  promptSuppressesChristmas,
  resolveHumanScene,
} from "../lib/human-scene-knowledge";
import { parsePromptNegatives } from "../lib/prompt-negatives";
import { buildLockedIntent } from "../core/v3/intent";
import { detectSubSceneRetrievalKind } from "../core/v3/subscene-retrieval";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import { analyzeVibe } from "../lib/emotion";

describe("human-quality-gate", () => {
    it("refuses empty and stub underfills", () => {
    const empty = evaluateHumanQualityGate({
      trackCount: 0,
      requestedLength: 30,
      holidayRequested: false,
    });
    assert.equal(empty.action, "refuse");
    assert.ok(empty.reasons.includes("empty_playlist"));

    const stub = evaluateHumanQualityGate({
      trackCount: 2,
      requestedLength: 30,
      wouldSpotifyMakeThis: true,
    });
    assert.equal(stub.action, "refuse");
    assert.ok(stub.reasons.includes("stub_underfill"));

    const midStub = evaluateHumanQualityGate({
      trackCount: 5,
      requestedLength: 30,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.8,
    });
    assert.equal(midStub.action, "honest_partial");
    assert.equal(midStub.salvageableCount, 5);
  });

  it("refuses wanted christmas with empty supply", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 0,
      requestedLength: 30,
      holidayRequested: true,
    });
    assert.equal(result.action, "refuse");
    assert.ok(result.reasons.includes("holiday_requested_empty_supply") || result.reasons.includes("empty_playlist"));
    assert.ok(/christmas|holiday|Discovery/i.test(result.userMessage ?? ""));
  });

  it("honest-partials salvageable underfills", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 10,
      requestedLength: 30,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.7,
    });
    assert.equal(result.action, "honest_partial");
    assert.equal(result.salvageableCount, 10);
    assert.ok(result.userMessage);
  });

  it("passes healthy playlists", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 28,
      requestedLength: 30,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.8,
      humanSavePassed: true,
    });
    assert.equal(result.action, "pass");
  });

  it("refuses when psych-indie opener chain survives sanitize", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 25,
      requestedLength: 25,
      psychIndieOpenerFillers: 3,
      dominantWorldDensity: 0.8,
    });
    assert.equal(result.action, "refuse");
    assert.ok(result.reasons.includes("psych_indie_opener_chain"));
  });

  it("throws HumanQualityGateError with result payload", () => {
    const result = evaluateHumanQualityGate({ trackCount: 1, requestedLength: 25 });
    const err = new HumanQualityGateError(result);
    assert.equal(err.code, "HUMAN_QUALITY_GATE_REFUSED");
    assert.equal(err.result.action, "refuse");

    const hardLockThin = evaluateHumanQualityGate({
      trackCount: 2,
      requestedLength: 25,
      committedWorldHardLock: true,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.8,
    });
    assert.equal(hardLockThin.action, "honest_partial");
    assert.ok(hardLockThin.reasons.includes("v15_minimum_delivery"));
  });
});

describe("christmas negation", () => {
  it("treats non christmas / no christmas as hard suppress", () => {
    assert.equal(promptSuppressesChristmas("winter non christmas study"), true);
    assert.equal(promptSuppressesChristmas("winter but no christmas obviously"), true);
    assert.equal(promptSuppressesChristmas("xmas party"), false);
    assert.equal(resolveHumanScene("winter non christmas study").suppressChristmas, true);
    assert.notEqual(resolveHumanScene("winter non christmas study").primary?.id, "christmas_holiday");
    const negatives = parsePromptNegatives("winter non christmas study session");
    assert.ok(negatives.exclusionTags.includes("christmas_holiday"));
  });
});

describe("coding sprint is focus not gym", () => {
  it("locks coding sprint work flow away from gym activity", () => {
    const locked = buildLockedIntent("coding sprint work flow");
    assert.equal(locked.activity, "focus");
    assert.notEqual(locked.activity, "gym");
    const kind = detectSubSceneRetrievalKind("coding sprint work flow", locked);
    assert.equal(kind, "soft_focus_concentration");
    const profile = analyzeVibe("coding sprint work flow");
    const semantic = resolveSemanticScene("coding sprint work flow", profile);
    assert.notEqual(semantic.matchedId, "WORKOUT_INTENSITY");
  });
});
