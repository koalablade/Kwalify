import test from "node:test";
import assert from "node:assert/strict";

import { assessConfidence, LOW_CONFIDENCE_THRESHOLD } from "../core/expectation/confidence";

const strong = {
  peakSalience: 0.7,
  novelPrompt: false,
  candidatePoolSize: 120,
  targetLength: 25,
  poolDiversity: 0.8,
  avgCandidateFit: 0.85,
  criticFit: 88,
  repairApplied: false,
  unresolvedHighRisks: 0,
};

test("a well-grounded, well-supplied generation reads high confidence", () => {
  const c = assessConfidence(strong);
  assert.ok(c.overall > 0.75, `overall ${c.overall}`);
  assert.equal(c.lowConfidence, false);
  assert.equal(c.recommendedActions.length, 0);
});

test("a starved retrieval pool drags overall down and recommends broadening", () => {
  const c = assessConfidence({ ...strong, candidatePoolSize: 8, poolDiversity: 0.2 });
  assert.equal(c.weakestStage, "retrieval");
  assert.ok(c.overall < LOW_CONFIDENCE_THRESHOLD, `overall ${c.overall}`);
  assert.ok(c.recommendedActions.some((a) => /broaden retrieval/.test(a)));
});

test("a novel/ungrounded prompt cannot masquerade as certain", () => {
  const grounded = assessConfidence({ ...strong, peakSalience: 0.2, novelPrompt: true });
  const confident = assessConfidence(strong);
  assert.ok(grounded.stages.interpretation < confident.stages.interpretation);
  assert.ok(grounded.stages.interpretation < 0.5);
});

test("overall is only as strong as the weakest link (min-weighted)", () => {
  // Every stage strong except one catastrophic stage.
  const c = assessConfidence({ ...strong, criticFit: 5 });
  assert.equal(c.weakestStage, "critic");
  assert.ok(c.overall < 0.6, `weak critic should pull overall below a naive mean (${c.overall})`);
});

test("all stage confidences stay within [0,1]", () => {
  for (const inp of [strong, { ...strong, candidatePoolSize: 0, targetLength: 0 }]) {
    const c = assessConfidence(inp);
    for (const v of Object.values(c.stages)) {
      assert.ok(v >= 0 && v <= 1, `stage confidence out of range: ${v}`);
    }
    assert.ok(c.overall >= 0 && c.overall <= 1);
  }
});
