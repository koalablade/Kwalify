import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecoveryDiagnostics,
  classifyRecoveryRelaxation,
  partitionRecoveryRelaxations,
  shouldMarkRecoveryTriggered,
} from "../lib/recovery-diagnostics";

test("classifyRecoveryRelaxation separates pipeline annotations from material recovery", () => {
  assert.equal(classifyRecoveryRelaxation("segment_playlist_planning"), "pipeline_annotation");
  assert.equal(classifyRecoveryRelaxation("opening_window_locked_through_arc"), "pipeline_annotation");
  assert.equal(classifyRecoveryRelaxation("genre_evidence_partial_constrained_prefix"), "material");
  assert.equal(classifyRecoveryRelaxation("intent_pool_emergency_continue_12"), "material");
});

test("shouldMarkRecoveryTriggered is false for arc ordering only", () => {
  const diagnostics = buildRecoveryDiagnostics({
    recoveryRelaxations: ["segment_playlist_planning", "opening_window_locked_through_arc"],
    fallbackLevel: "none",
    finalTrackCount: 30,
    requestedLength: 30,
  });
  assert.equal(diagnostics.materialRecovery, false);
  assert.equal(shouldMarkRecoveryTriggered(diagnostics), false);
  assert.equal(diagnostics.tier, "none");
});

test("shouldMarkRecoveryTriggered is true for evidence guard relaxation", () => {
  const diagnostics = buildRecoveryDiagnostics({
    recoveryRelaxations: ["genre_evidence_partial_constrained_prefix"],
    fallbackLevel: "none",
    finalTrackCount: 28,
    requestedLength: 30,
  });
  assert.equal(diagnostics.materialRecovery, true);
  assert.equal(shouldMarkRecoveryTriggered(diagnostics), true);
  assert.equal(diagnostics.triggerReason, "evidence_guard_relaxation");
});

test("shouldMarkRecoveryTriggered is false for underfill without material relaxations", () => {
  const diagnostics = buildRecoveryDiagnostics({
    recoveryRelaxations: [],
    fallbackLevel: "none",
    finalTrackCount: 18,
    requestedLength: 30,
  });
  assert.equal(diagnostics.materialRecovery, false);
  assert.equal(shouldMarkRecoveryTriggered(diagnostics), false);
});

test("partitionRecoveryRelaxations buckets mixed relaxations", () => {
  const partitioned = partitionRecoveryRelaxations([
    "segment_playlist_planning",
    "era_evidence_relaxed_to_compatible_unknowns",
    "emotional_arc_ordering",
  ]);
  assert.deepEqual(partitioned.pipelineAnnotations, ["segment_playlist_planning", "emotional_arc_ordering"]);
  assert.equal(partitioned.material.length, 1);
});
