/**
 * Invariant tests for playlist execution trace observability.
 *
 * Run: npm run test:observability-invariants
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExecutionTraceInvariants,
  buildFallbackExecutionTraceDraft,
  buildGateFailureExecutionTraceDraft,
  buildV3PipelineExecutionTraceDraft,
  finalizeExecutionTrace,
  inferRejectionReasons,
  type PlaylistExecutionTrace,
} from "../core/observability/playlist-execution-trace";

function baseDraft() {
  return buildFallbackExecutionTraceDraft({
    requestId: "req-1",
    prompt: "rainy walk",
    seed: 2,
    executionPath: "timeout_fallback",
    failureDetail: "cancelled_timeout_fallback",
    finalTrackCount: 25,
    timeoutOccurred: true,
  });
}

describe("playlist execution trace invariants", () => {
  it("never allows empty rejectionReasons", () => {
    const trace = finalizeExecutionTrace({
      ...baseDraft(),
      rejectionReasons: [],
    });
    assert.ok(trace.rejectionReasons.length > 0);
    assertExecutionTraceInvariants(trace);
  });

  it("never allows unspecified rejection reason", () => {
    const trace = finalizeExecutionTrace({
      ...baseDraft(),
      rejectionReasons: ["unspecified"],
    });
    assert.ok(!trace.rejectionReasons.includes("unspecified"));
    assertExecutionTraceInvariants(trace);
  });

  it("always sets executionPath", () => {
    const trace = finalizeExecutionTrace(baseDraft());
    assert.ok(trace.executionPath);
    assertExecutionTraceInvariants(trace);
  });

  it("infers funnel collapse on gate failure drafts", () => {
    const trace = finalizeExecutionTrace(
      buildGateFailureExecutionTraceDraft({
        requestId: "req-gate",
        prompt: "cozy sunday",
        seed: 1,
        gate: {
          rejectionReasons: [],
          curatorScore: null,
          attribution: {
            stageResponsible: "sampler",
            sceneClusterFunnel: {
              earliestCollapseStage: "opening5_pre_interleaver",
              dominantClusterLabel: "feist / beach house · indie",
              counts: { retrieval: 50, world_layer: 40, sampler_pool: 20 },
            },
          },
        },
      }),
    );
    assert.equal(trace.funnelCollapseStage, "opening5_pre_interleaver");
    assert.ok(trace.rejectionReasons.length > 0);
    assert.ok(!trace.rejectionReasons.includes("unspecified"));
    assertExecutionTraceInvariants(trace);
  });

  it("marks success with explicit pass reason", () => {
    const trace = finalizeExecutionTrace(
      buildV3PipelineExecutionTraceDraft({
        requestId: "req-ok",
        prompt: "summer morning",
        seed: 3,
        humanSaveable: true,
        gateExecuted: true,
        humanSaveabilityGate: {
          humanSaveable: true,
          passed: true,
          curatorScore: 0.91,
          rejectionReasons: [],
        },
        sceneClusterFunnel: null,
        openingTenDominantCluster: { trace: [] },
        retrievedCount: 100,
        finalTrackCount: 25,
      }),
    );
    assert.equal(trace.humanSaveable, true);
    assert.ok(trace.rejectionReasons.includes("human_saveable:passed"));
    assertExecutionTraceInvariants(trace);
  });

  it("inferRejectionReasons never returns unspecified", () => {
    const trace: PlaylistExecutionTrace = finalizeExecutionTrace({
      requestId: "x",
      prompt: "p",
      executionPath: "partial_pipeline",
      humanSaveable: false,
      rejectionReasons: [],
      debugFlags: { gateExecuted: false, gateBypassed: true, timeoutOccurred: false },
    });
    const reasons = inferRejectionReasons(trace);
    assert.ok(reasons.length > 0);
    assert.ok(!reasons.includes("unspecified"));
  });
});
