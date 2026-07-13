import assert from "node:assert/strict";
import test from "node:test";
import {
  PipelineAuthorityFrozenError,
  PipelineDeliveryBuffer,
  createPipelineAuthoritySession,
  validatePipelineAuthority,
  PIPELINE_CHECKPOINT_ORDER,
} from "../lib/pipeline-authority/index.js";

test("PipelineDeliveryBuffer is the only mutation path", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "hydrate", [{ trackId: "1", artistName: "A" }]);
  delivery.appendTracks("tier3_fill", "fill", [{ trackId: "2", artistName: "B" }]);
  assert.equal(delivery.trackCount, 2);
  assert.equal(session.getMutationCount(), 2);
});

test("mutations on returned tracks copy throw on sealed snapshot", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "hydrate", [{ trackId: "1" }]);
  const copy = delivery.tracks;
  assert.throws(() => copy.push({ trackId: "rogue" }), /not extensible/i);
  assert.equal(delivery.trackCount, 1);
  assert.equal(session.getMutationCount(), 1);
});

test("freeze throws PipelineAuthorityFrozenError", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "hydrate", [{ trackId: "1" }]);
  session.freezeTerminal("terminal_delivery");
  assert.throws(
    () => delivery.replaceTracks("late", "forbidden", [{ trackId: "2" }]),
    PipelineAuthorityFrozenError,
  );
});

test("validatePipelineAuthority detects skipped checkpoints after freeze", () => {
  const session = createPipelineAuthoritySession();
  session.recordMutation({
    stage: "v3_handoff",
    reason: "hydrate",
    owner: "controller.delivery",
    mutationType: "replace",
    before: [],
    after: [{ trackId: "1", artistName: "A" }],
  });
  session.freezeTerminal("terminal_delivery");
  const report = validatePipelineAuthority({
    mutations: session.getDiagnostics().mutations,
    checkpoints: [],
    terminalFrozen: true,
    terminalFrozenAt: new Date().toISOString(),
  });
  assert.equal(report.pass, false);
  assert.ok(report.violations.some((v) => v.id === "no_checkpoint_skipped"));
});

test("mutation registry records mutationType and order", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer(session);
  delivery.init("a", "init", [{ trackId: "1" }]);
  delivery.truncateTracks("b", "truncate", 1);
  const mutations = session.getDiagnostics().mutations;
  assert.equal(mutations[0]?.mutationType, "replace");
  assert.equal(mutations[1]?.mutationType, "truncate");
  assert.equal(mutations[0]?.order, 1);
  assert.equal(mutations[1]?.order, 2);
});

test("nested scoreChannels on returned copy cannot mutate", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "hydrate", [{
    trackId: "1",
    scoreChannels: { total: 1, genre: 0.5 },
  }]);
  const copy = delivery.getTracks();
  assert.throws(() => {
    (copy[0]!.scoreChannels as { total: number }).total = 999;
  }, /Cannot assign|read only|read-only/i);
  assert.equal((delivery.getTracks()[0]!.scoreChannels as { total: number }).total, 1);
});
