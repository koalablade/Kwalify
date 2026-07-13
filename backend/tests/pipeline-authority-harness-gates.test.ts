import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePipelineAuthorityGate,
  analyzePipelineQualityGate,
} from "../lib/pipeline-authority/harness-gates.js";
import type { GenerationEvaluationResult } from "../lib/playlist-evaluation/metrics.js";
import { PIPELINE_CHECKPOINT_ORDER } from "../lib/pipeline-authority/types.js";

function mockResult(
  id: string,
  opts: {
    authorityPass?: boolean;
    qualityPass?: boolean;
    missingAuthority?: boolean;
  },
): GenerationEvaluationResult {
  const qualityPass = opts.qualityPass ?? true;
  const authorityPass = opts.authorityPass ?? true;
  const checkpoint = (pass: boolean) => ({
    checkpoint: "pre_response" as const,
    pass,
    violations: pass ? [] : [{ id: "genre_hard_constraints", severity: "error" }],
  });

  const checkpoints = PIPELINE_CHECKPOINT_ORDER.map((cp) => ({
    checkpoint: cp,
    pass: qualityPass,
    trackCount: 10,
    invariants: [],
    violations: qualityPass ? [] : [{ id: "genre_hard_constraints", severity: "error", pass: false, expected: 0, actual: 1 }],
    ownership: { scoringOwner: "v3_pipeline" as const, deliveryOwner: "controller.delivery" as const, lastMutationStage: null },
    executedAt: new Date().toISOString(),
  }));

  return {
    ok: true,
    status: 200,
    benchmark: { id, category: "gym", prompt: "test", mode: "balanced", length: 20 },
    response: opts.missingAuthority
      ? { success: true, finalization: {} }
      : {
          success: true,
          finalization: {
            pipelineAuthority: {
              scoringOwner: "v3_pipeline",
              deliveryOwner: "controller.delivery",
              mutations: [{ order: 1, stage: "v3_handoff", owner: "controller.delivery", reason: "init", mutationType: "replace", beforeCount: 0, afterCount: 1, tracksAdded: 1, tracksRemoved: 0, tracksReplaced: 0, timestamp: "", checkpointAfter: null }],
              checkpoints,
              terminalFrozen: true,
              terminalFrozenAt: new Date().toISOString(),
              duplicateRuleOwners: [],
              authorityValidation: authorityPass
                ? { pass: true, validatedAt: "", terminalFrozen: true, checkpointProof: { pass: true, expected: PIPELINE_CHECKPOINT_ORDER, observed: [...PIPELINE_CHECKPOINT_ORDER], missing: [], duplicates: [], outOfOrder: false }, invariants: [], violations: [] }
                : { pass: false, validatedAt: "", terminalFrozen: true, checkpointProof: { pass: false, expected: PIPELINE_CHECKPOINT_ORDER, observed: [], missing: [...PIPELINE_CHECKPOINT_ORDER], duplicates: [], outOfOrder: true }, invariants: [], violations: [{ id: "terminal_frozen", severity: "error", pass: false, expected: true, actual: false }] },
            },
            pipelineValidation: {
              preResponse: checkpoint(qualityPass),
            },
          },
        },
    tracks: [],
    elapsedMs: 1,
  } as unknown as GenerationEvaluationResult;
}

test("authority gate passes when quality fails but authority is valid", () => {
  const results = [mockResult("p1", { qualityPass: false, authorityPass: true })];
  const authority = analyzePipelineAuthorityGate(results);
  const quality = analyzePipelineQualityGate(results);
  assert.equal(authority.pass, true);
  assert.equal(quality.pass, false);
});

test("authority gate fails when pipelineAuthority missing", () => {
  const results = [mockResult("p1", { missingAuthority: true })];
  const authority = analyzePipelineAuthorityGate(results);
  assert.equal(authority.pass, false);
  assert.ok(authority.violationIds.includes("pipeline_authority_missing"));
});

test("authority gate fails when terminal authority validation fails", () => {
  const results = [mockResult("p1", { authorityPass: false, qualityPass: true })];
  const authority = analyzePipelineAuthorityGate(results);
  assert.equal(authority.pass, false);
});
