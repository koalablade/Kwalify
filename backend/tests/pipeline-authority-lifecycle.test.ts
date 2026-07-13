import assert from "node:assert/strict";
import test from "node:test";
import {
  createPipelineAuthoritySession,
  createPipelineDeliveryBuffer,
  validatePlaylistQuality,
  validatePipelineAuthority,
  PIPELINE_CHECKPOINT_ORDER,
} from "../lib/pipeline-authority/index.js";

test("terminal authority validation passes after freeze with clean registry", () => {
  const session = createPipelineAuthoritySession();
  const delivery = createPipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "init", [{ trackId: "1", artistName: "A" }]);

  const ctx = {
    tracks: delivery.getTracks(),
    vibe: "party",
    requestedLength: 20,
    maxPerArtist: 5,
    promptCentralArtists: new Set<string>(),
  };

  for (const checkpoint of PIPELINE_CHECKPOINT_ORDER) {
    session.runCheckpoint({ checkpoint, ...ctx });
  }
  session.freezeTerminal("terminal_delivery");
  const authority = session.runTerminalAuthorityValidation();
  assert.equal(authority.pass, true);
  assert.equal(authority.terminalFrozen, true);
  assert.equal(session.getDiagnostics().authorityValidation?.pass, true);
});

test("quality failure does not fail terminal authority validation", () => {
  const session = createPipelineAuthoritySession();
  const delivery = createPipelineDeliveryBuffer(session);
  const dupTracks = [
    { trackId: "dup", artistName: "A" },
    { trackId: "dup", artistName: "B" },
  ];
  delivery.init("v3_handoff", "init", dupTracks);

  const ctx = {
    tracks: delivery.getTracks(),
    vibe: "party",
    requestedLength: 20,
    maxPerArtist: 5,
    promptCentralArtists: new Set<string>(),
  };

  for (const checkpoint of PIPELINE_CHECKPOINT_ORDER) {
    session.runCheckpoint({ checkpoint, ...ctx });
  }

  const quality = validatePlaylistQuality({
    checkpoint: "pre_response",
    ...ctx,
    tracks: dupTracks,
  });
  assert.equal(quality.pass, false);
  assert.ok(quality.violations.some((v) => v.id === "duplicate_track_ids"));

  session.freezeTerminal("terminal_delivery");
  const authority = session.runTerminalAuthorityValidation();
  assert.equal(authority.pass, true);
  assert.ok(!authority.violations.some((v) => v.id === "duplicate_track_ids"));
});

test("authority validation fails when freeze has not occurred", () => {
  const session = createPipelineAuthoritySession();
  const report = validatePipelineAuthority({
    mutations: [],
    checkpoints: [],
    terminalFrozen: false,
    terminalFrozenAt: null,
  });
  assert.equal(report.pass, false);
  assert.ok(report.violations.some((v) => v.id === "terminal_frozen"));
});

test("validatePlaylistQuality does not include authority invariants", () => {
  const report = validatePlaylistQuality({
    checkpoint: "pre_response",
    tracks: [{ trackId: "1", artistName: "A" }],
    vibe: "party",
    requestedLength: 20,
    maxPerArtist: 3,
    sessionAudit: {
      mutations: [],
      checkpoints: [],
      terminalFrozen: false,
      terminalFrozenAt: null,
    },
  });
  assert.ok(!report.invariants.some((i) => i.id === "terminal_frozen"));
  assert.ok(!report.invariants.some((i) => i.id === "checkpoint_order"));
});
