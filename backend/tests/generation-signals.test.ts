import test from "node:test";
import assert from "node:assert/strict";

import { projectGenerationSignalRow, EXPECTATION_VERSION } from "../lib/generation-signals";

/** A representative `humanExpectation` diagnostics object (mirrors the live shape). */
const HX = {
  mode: "shadow",
  interpretedMoment: {
    candidates: [
      { label: "Nostalgia night driving", confidence: 0.393, characteristics: ["nostalgia", "night"] },
    ],
    novelPrompt: false,
  },
  expectedAtmosphere: {
    atmosphere: ["nostalgia", "loneliness"],
    avoid: ["aggressive"],
  },
  detectedRisks: [{ mode: "ENERGY_MISMATCH", severity: "low", detail: "x", count: 1 }],
  critique: { overallFit: 87, verdict: "publish" },
  repair: { applied: false, removed: 2, added: 2 },
  retrievalRerank: {
    applied: false,
    avgAdmissibilityBefore: 0.983,
    avgAdmissibilityAfter: 0.981,
    promoted: [{ trackId: "a" }, { trackId: "b" }],
    demoted: [{ trackId: "c" }],
    pool: { size: 294, admissibleRate: 0.97 },
  },
};

test("projectGenerationSignalRow maps the diagnostics into a persistable row", () => {
  const row = projectGenerationSignalRow({
    generationId: "req-123",
    prompt: "Late Night Drive",
    userId: "user-xyz",
    mode: "shadow",
    humanExpectation: HX,
    generationTimeMs: 57000,
    publishDecision: "published",
  });

  assert.equal(row.generationId, "req-123");
  assert.equal(row.mode, "shadow");
  assert.equal(row.shadowOrEnforce, "shadow");
  // PII is hashed, never stored raw.
  assert.notEqual(row.userIdHash, "user-xyz");
  assert.equal(row.userIdHash?.length, 32);
  assert.equal(row.promptHash.length, 32);
  // prompt hash is case/space-insensitive (stable grouping key).
  assert.equal(
    row.promptHash,
    projectGenerationSignalRow({ generationId: "x", prompt: "  late night drive  ", mode: "shadow", humanExpectation: {} }).promptHash,
  );

  assert.equal(row.groundedConfidence, 0.393);
  assert.equal(row.novelPrompt, false);
  assert.equal(row.candidateCount, 294);
  assert.equal(row.candidatePoolAdmissibleRate, 0.97);
  assert.equal(row.rerankPromotions, 2);
  assert.equal(row.rerankDemotions, 1);
  assert.equal(row.avgFitBefore, 0.983);
  assert.equal(row.avgFitAfter, 0.981);
  assert.equal(row.criticScore, 87);
  assert.equal(row.criticVerdict, "publish");
  assert.equal(row.repairCount, 2);
  assert.equal(row.publishDecision, "published");
  assert.equal(row.generationTimeMs, 57000);
  assert.equal(row.expectationVersion, EXPECTATION_VERSION);
  assert.deepEqual(row.failureModes, HX.detectedRisks);
  assert.equal(row.userFeedback, null);
});

test("projectGenerationSignalRow is fully defensive with empty diagnostics", () => {
  const row = projectGenerationSignalRow({
    generationId: "req-empty",
    prompt: "x",
    mode: "shadow",
    humanExpectation: null,
  });
  assert.equal(row.groundedConfidence, null);
  assert.equal(row.novelPrompt, null);
  assert.equal(row.candidateCount, null);
  assert.equal(row.rerankPromotions, 0);
  assert.equal(row.rerankDemotions, 0);
  assert.equal(row.criticScore, null);
  assert.equal(row.repairCount, 0);
  assert.equal(row.userIdHash, null);
  assert.deepEqual(row.failureModes, []);
});
