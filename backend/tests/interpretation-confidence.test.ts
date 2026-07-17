/**
 * Unit tests for interpretation confidence.
 *
 * Run: npm run build && node --test backend/dist/tests/interpretation-confidence.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeVibe } from "../lib/emotion";
import { computeInterpretationConfidence } from "../lib/interpretation-confidence";

function confFor(prompt: string) {
  return computeInterpretationConfidence(prompt, analyzeVibe(prompt));
}

describe("interpretation confidence", () => {
  it("is high and certain for a decisively energetic prompt", () => {
    const c = confFor("heavy lifting gym pump aggressive");
    assert.ok(c.energy > 0.5, `expected decisive energy confidence, got ${c.energy}`);
    assert.equal(c.energyUncertain, false);
  });

  it("is high and certain for a decisively calm prompt", () => {
    const c = confFor("late night calm warm playlist");
    assert.ok(c.energy > 0.4, `expected calm decisiveness, got ${c.energy}`);
  });

  it("lowers confidence for explicitly contradictory prompts", () => {
    const decisive = confFor("heavy lifting gym pump aggressive").energy;
    const conflicted = confFor("happy but sad workout, kind of ish").energy;
    assert.ok(
      conflicted < decisive,
      `contradiction should reduce confidence (${conflicted} !< ${decisive})`,
    );
  });

  it("flags a neutral/ambiguous prompt as energy-uncertain", () => {
    const c = confFor("music");
    assert.equal(c.energyUncertain, true, `expected uncertainty for vague prompt, got ${c.energy}`);
  });

  it("raises socialness confidence when a social or solo cue is explicit", () => {
    const social = confFor("house party with friends everyone dancing").socialness;
    const neutral = confFor("some songs for later").socialness;
    assert.ok(social > neutral, `social cue should raise socialness (${social} !> ${neutral})`);
  });

  it("keeps every axis within [0,1]", () => {
    const c = confFor("nostalgic late night drive alone after a long week");
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === "number") {
        assert.ok(v >= 0 && v <= 1, `${k} out of range: ${v}`);
      }
    }
  });
});
