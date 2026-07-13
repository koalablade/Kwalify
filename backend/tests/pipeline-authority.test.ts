import assert from "node:assert/strict";
import test from "node:test";
import {
  PIPELINE_CHECKPOINT_ORDER,
  PIPELINE_RULE_OWNERSHIP,
  TERMINAL_DELIVERY_CONTRACT,
  createPipelineAuthoritySession,
  detectDuplicateRuleOwners,
  getRuleOwnership,
  validatePipelineState,
  PipelineAuthorityViolationError,
  TerminalDeliveryViolationError,
  PipelineAuthorityFrozenError,
} from "../lib/pipeline-authority/index.js";

test("PIPELINE_CHECKPOINT_ORDER defines five checkpoints", () => {
  assert.deepEqual(PIPELINE_CHECKPOINT_ORDER, [
    "post_v3",
    "post_recovery",
    "post_evidence",
    "post_refill",
    "pre_response",
  ]);
});

test("every pipeline rule has a single authoritative owner entry", () => {
  const rules = new Set(PIPELINE_RULE_OWNERSHIP.map((entry) => entry.rule));
  assert.equal(rules.size, PIPELINE_RULE_OWNERSHIP.length);
  assert.ok(getRuleOwnership("artist_cap"));
});

test("detectDuplicateRuleOwners reports known duplicate implementations", () => {
  const duplicates = detectDuplicateRuleOwners();
  assert.ok(duplicates.some((entry) => entry.startsWith("artist_cap:")));
  assert.ok(duplicates.some((entry) => entry.startsWith("recovery:")));
});

test("validatePipelineState fails artist cap at pre_response", () => {
  const tracks = Array.from({ length: 6 }, () => ({
    trackId: crypto.randomUUID(),
    artistName: "Paramore",
  }));
  const report = validatePipelineState({
    checkpoint: "pre_response",
    tracks,
    vibe: "gym pop punk",
    requestedLength: 20,
    maxPerArtist: 3,
    strictMode: false,
  });
  assert.equal(report.pass, false);
  assert.ok(report.violations.some((v) => v.id === "artist_cap"));
});

test("validatePipelineState passes clean playlist at pre_response", () => {
  const tracks = [
    { trackId: "a", artistName: "A", scoreChannels: { total: 1 } },
    { trackId: "b", artistName: "B", scoreChannels: { total: 1 } },
    { trackId: "c", artistName: "C", scoreChannels: { total: 1 } },
  ];
  const report = validatePipelineState({
    checkpoint: "pre_response",
    tracks,
    vibe: "focus ambient",
    requestedLength: 20,
    maxPerArtist: 3,
    requireTelemetry: true,
    confidence: { percent: 72 },
    strictMode: false,
  });
  assert.equal(report.pass, true);
});

test("mutation registry records stage and counts", () => {
  const session = createPipelineAuthoritySession();
  const before = [{ trackId: "1", artistName: "A" }];
  const after = [
    { trackId: "1", artistName: "A" },
    { trackId: "2", artistName: "B" },
  ];
  session.mutate("tier3_fill", "deterministic fill", before, after);
  const diagnostics = session.getDiagnostics();
  assert.equal(diagnostics.mutations.length, 1);
  assert.equal(diagnostics.mutations[0]?.stage, "tier3_fill");
  assert.equal(diagnostics.mutations[0]?.tracksAdded, 1);
  assert.equal(session.lastStage, "tier3_fill");
});

test("terminal delivery freeze blocks further mutations", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  session.freezeTerminal("terminal_delivery");
  assert.throws(
    () => session.mutate("late_stage", "forbidden", [], [{ trackId: "1" }]),
    PipelineAuthorityFrozenError,
  );
});

test("strict mode fails checkpoint on duplicate track ids", () => {
  const session = createPipelineAuthoritySession({ strictMode: true });
  assert.throws(
    () =>
      session.runCheckpoint({
        checkpoint: "pre_response",
        tracks: [
          { trackId: "dup", artistName: "A" },
          { trackId: "dup", artistName: "B" },
        ],
        vibe: "party",
        requestedLength: 20,
        maxPerArtist: 3,
        strictMode: true,
      }),
    PipelineAuthorityViolationError,
  );
});

test("checkpoint ordering is enforced in strict mode", () => {
  const session = createPipelineAuthoritySession({ strictMode: true });
  session.runCheckpoint({
    checkpoint: "post_v3",
    tracks: [{ trackId: "1", artistName: "A" }],
    vibe: "party",
    requestedLength: 20,
    maxPerArtist: 3,
    strictMode: true,
  });
  assert.throws(
    () =>
      session.runCheckpoint({
        checkpoint: "post_v3",
        tracks: [{ trackId: "1", artistName: "A" }],
        vibe: "party",
        requestedLength: 20,
        maxPerArtist: 3,
        strictMode: true,
      }),
    PipelineAuthorityViolationError,
  );
});

test("TERMINAL_DELIVERY_CONTRACT forbids post-terminal track mutations", () => {
  assert.ok(TERMINAL_DELIVERY_CONTRACT.forbiddenMutations.includes("track_add"));
  assert.ok(TERMINAL_DELIVERY_CONTRACT.allowedPostTerminalStages.includes("http_response"));
});
