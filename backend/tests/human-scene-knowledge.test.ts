import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import {
  humanSceneCount,
  resolveHumanScene,
} from "../lib/human-scene-knowledge";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";

describe("human scene knowledge", () => {
  it("catalogues a substantial reusable set of concepts", () => {
    assert.ok(humanSceneCount() >= 50);
  });

  it("reads rave comedown as aftermath, not peak rave", () => {
    const reading = resolveHumanScene("rave comedown bus home");
    assert.equal(reading.primary?.id, "rave_comedown");
    assert.equal(reading.energy, "low");
    assert.equal(reading.demotePartyActivity, true);
    assert.equal(reading.phase, "aftermath");

    const locked = buildLockedIntent("rave comedown bus home");
    assert.equal(locked.energy, "low");
    assert.notEqual(locked.activity, "party");

    const profile = analyzeVibe("rave comedown bus home");
    assert.ok(profile.energy < 0.5, `expected low energy, got ${profile.energy}`);

    const semantic = resolveSemanticScene("rave comedown bus home", profile);
    assert.equal(semantic.matchedId, "AFTERPARTY_COMEDOWN");
  });

  it("disambiguates holiday as vacation aftermath, not Christmas", () => {
    const reading = resolveHumanScene("back home the day after a holiday ends");
    assert.ok(
      reading.primary?.id === "after_holiday" || reading.senses.includes("holiday.after"),
      `unexpected primary=${reading.primary?.id} senses=${reading.senses.join(",")}`,
    );
    assert.equal(reading.suppressChristmas, true);
    assert.equal(reading.energy, "low");

    const locked = buildLockedIntent("back home the day after a holiday ends");
    assert.ok(!locked.genreFamilies.includes("christmas"));
    assert.equal(locked.energy, "low");
  });

  it("still recognises explicit Christmas holiday", () => {
    const reading = resolveHumanScene("christmas holiday playlist with festive songs");
    assert.equal(reading.suppressChristmas, false);
    assert.ok(
      reading.primary?.id === "christmas_holiday" || reading.senses.includes("holiday.christmas"),
    );
  });

  it("keeps peak gym high-energy", () => {
    const locked = buildLockedIntent("heavy lifting gym pump aggressive");
    assert.equal(locked.energy, "high");
    const profile = analyzeVibe("heavy lifting gym pump aggressive");
    assert.ok(profile.energy > 0.55);
  });

  it("reads failed interview as deflation", () => {
    const reading = resolveHumanScene("walking home after failing a job interview");
    assert.ok(
      reading.primary?.id === "failed_interview" || reading.energy === "low",
      reading.primary?.id,
    );
    const locked = buildLockedIntent("walking home after failing a job interview");
    assert.equal(locked.energy, "low");
  });

  it("keeps euphoric summer evening high-energy capable", () => {
    const locked = buildLockedIntent("euphoric summer evening");
    assert.notEqual(locked.energy, "low");
    const profile = analyzeVibe("euphoric summer evening");
    assert.ok(profile.energy > 0.45, `expected not-dampened energy, got ${profile.energy}`);
  });

  it("keeps gym+drive compounds high", () => {
    const locked = buildLockedIntent("long drive gym momentum");
    assert.equal(locked.energy, "high");
    assert.equal(locked.activity, "gym");
  });
});
