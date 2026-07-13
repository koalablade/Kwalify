/**
 * Pipeline Authority Final Verification — Phases 3, 4, 5
 * Runtime proof: freeze attacks, bypass attacks, property-based mutation sequences.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PipelineAuthorityFrozenError,
  PipelineDeliveryBuffer,
  createPipelineAuthoritySession,
  PIPELINE_CHECKPOINT_ORDER,
  DELIVERY_OWNER,
  SCORING_OWNER,
} from "../lib/pipeline-authority/index.js";
import {
  proveCheckpointOrder,
} from "../lib/pipeline-authority/verification.js";
import type { DeliveryTrack, PipelineValidationReport } from "../lib/pipeline-authority/types.js";

type Track = DeliveryTrack & { trackId: string };

function makeTrack(id: string, artist = "Artist"): Track {
  return { trackId: id, artistName: artist };
}

function seedDelivery(delivery: PipelineDeliveryBuffer<Track>, count = 5): void {
  delivery.init(
    "v3_handoff",
    "seed",
    Array.from({ length: count }, (_, i) => makeTrack(`t${i}`, `A${i % 3}`)),
  );
}

function freezeSession(session: ReturnType<typeof createPipelineAuthoritySession>): void {
  session.freezeTerminal("terminal_delivery");
}

// ─── Phase 3: Freeze attack tests ───────────────────────────────────────────

const FREEZE_METHODS = [
  {
    name: "replaceTracks",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.replaceTracks("attack", "replace", [makeTrack("x")]),
  },
  {
    name: "appendTracks",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.appendTracks("attack", "append", [makeTrack("x")]),
  },
  {
    name: "filterTracks",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.filterTracks("attack", "filter", () => true),
  },
  {
    name: "reorderTracks",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.reorderTracks("attack", "reorder", (a, b) => a.trackId.localeCompare(b.trackId)),
  },
  {
    name: "truncateTracks",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.truncateTracks("attack", "truncate", 1),
  },
  {
    name: "init",
    run: (d: PipelineDeliveryBuffer<Track>) =>
      d.init("attack", "init", [makeTrack("x")]),
  },
] as const;

for (const method of FREEZE_METHODS) {
  test(`Phase 3 freeze attack: ${method.name} throws after freeze`, () => {
    const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
    const delivery = new PipelineDeliveryBuffer<Track>(session);
    seedDelivery(delivery);
    freezeSession(session);
    assert.throws(() => method.run(delivery), PipelineAuthorityFrozenError);
    assert.equal(delivery.trackCount, 5);
  });
}

test("Phase 3 freeze attack: session.recordMutation throws after freeze", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  freezeSession(session);
  assert.throws(
    () =>
      session.recordMutation({
        stage: "rogue",
        reason: "direct",
        owner: "attacker",
        mutationType: "replace",
        before: delivery.getTracks(),
        after: [makeTrack("rogue")],
      }),
    PipelineAuthorityFrozenError,
  );
});

test("Phase 3 freeze attack: alias reference cannot mutate after freeze", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const alias = delivery;
  freezeSession(session);
  assert.throws(
    () => alias.appendTracks("alias", "attack", [makeTrack("rogue")]),
    PipelineAuthorityFrozenError,
  );
});

test("Phase 3 freeze attack: closure captured before freeze cannot mutate after", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const mutateLater = () => delivery.replaceTracks("closure", "attack", [makeTrack("rogue")]);
  freezeSession(session);
  assert.throws(mutateLater, PipelineAuthorityFrozenError);
});

test("Phase 3 freeze attack: async continuation cannot mutate after freeze", async () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  freezeSession(session);
  await assert.rejects(
    async () => {
      await Promise.resolve();
      delivery.appendTracks("async", "attack", [makeTrack("rogue")]);
    },
    PipelineAuthorityFrozenError,
  );
});

test("Phase 3 freeze attack: tracks copy push throws after freeze", () => {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const copyBeforeFreeze = delivery.tracks;
  freezeSession(session);
  assert.throws(() => copyBeforeFreeze.push(makeTrack("rogue")), /not extensible/i);
  assert.equal(delivery.trackCount, 5);
});

// ─── Phase 4: Bypass attack tests ───────────────────────────────────────────

test("Phase 4 bypass: delivery.tracks.push throws on frozen copy", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const copy = delivery.tracks;
  assert.throws(() => copy.push(makeTrack("bypass")), /not extensible/i);
  assert.equal(delivery.trackCount, 5);
});

test("Phase 4 bypass: spread copy mutation is harmless", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const spread = [...delivery.tracks, makeTrack("bypass")];
  spread.sort((a, b) => a.trackId.localeCompare(b.trackId));
  assert.equal(delivery.trackCount, 5);
});

test("Phase 4 bypass: Object.assign on copy is harmless", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const copy = delivery.tracks;
  Object.assign(copy, { 0: makeTrack("bypass") });
  assert.equal(delivery.getTracks()[0]!.trackId, "t0");
});

test("Phase 4 bypass: nested helper using copy cannot affect delivery", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  function nestedBypass(buf: PipelineDeliveryBuffer<Track>): void {
    const tracks = buf.tracks;
    assert.throws(() => tracks.push(makeTrack("nested")), /not extensible/i);
  }
  nestedBypass(delivery);
  assert.equal(delivery.trackCount, 5);
});

test("Phase 4 bypass: promise chain on copy cannot mutate", async () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  await assert.rejects(
    async () => {
      await Promise.resolve(delivery.tracks).then((tracks) => {
        tracks.push(makeTrack("chain"));
      });
    },
    /not extensible/i,
  );
  assert.equal(delivery.trackCount, 5);
});

test("Phase 4 bypass: returned track object mutation is blocked", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  seedDelivery(delivery);
  const copy = delivery.getTracks();
  assert.throws(() => {
    (copy[0] as { trackId: string }).trackId = "rogue";
  }, /Cannot assign|read only|read-only/i);
  assert.equal(delivery.getTracks()[0]!.trackId, "t0");
});

// ─── Phase 2 + 5: Checkpoint proof + property-based sequences ───────────────

const MUTATION_OPS = [
  (d: PipelineDeliveryBuffer<Track>, i: number) =>
    d.appendTracks(`stage_${i}`, "append", [makeTrack(`new_${i}`, `B${i % 2}`)]),
  (d: PipelineDeliveryBuffer<Track>, i: number) =>
    d.filterTracks(`stage_${i}`, "filter", (_, idx) => idx % 2 === 0),
  (d: PipelineDeliveryBuffer<Track>, i: number) =>
    d.truncateTracks(`stage_${i}`, "truncate", Math.max(1, 3 - (i % 3))),
  (d: PipelineDeliveryBuffer<Track>, i: number) =>
    d.reorderTracks(`stage_${i}`, "reorder", (a, b) => b.trackId.localeCompare(a.trackId)),
  (d: PipelineDeliveryBuffer<Track>, i: number) =>
    d.replaceTracks(`stage_${i}`, "replace", d.getTracks().slice(0, Math.max(1, d.trackCount - 1))),
] as const;

function runRandomSequence(seed: number, steps: number): {
  session: ReturnType<typeof createPipelineAuthoritySession>;
  delivery: PipelineDeliveryBuffer<Track>;
} {
  const session = createPipelineAuthoritySession({ enforceTerminalImmutability: true });
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  delivery.init("v3_handoff", "init", [
    makeTrack("a1", "A"),
    makeTrack("a2", "A"),
    makeTrack("b1", "B"),
    makeTrack("c1", "C"),
  ]);
  let rng = seed;
  for (let step = 0; step < steps; step += 1) {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    const op = MUTATION_OPS[rng % MUTATION_OPS.length]!;
    op(delivery, step);
  }
  return { session, delivery };
}

function minimalReport(checkpoint: (typeof PIPELINE_CHECKPOINT_ORDER)[number], pass = true): PipelineValidationReport {
  return {
    checkpoint,
    pass,
    trackCount: 4,
    invariants: [],
    violations: [],
    ownership: {
      scoringOwner: SCORING_OWNER,
      deliveryOwner: DELIVERY_OWNER,
      lastMutationStage: null,
    },
    executedAt: new Date().toISOString(),
  };
}

function runFullCheckpointChain(
  session: ReturnType<typeof createPipelineAuthoritySession>,
  delivery: PipelineDeliveryBuffer<Track>,
  requestedLength = 20,
): void {
  const tracks = delivery.getTracks();
  for (const checkpoint of PIPELINE_CHECKPOINT_ORDER) {
    session.runCheckpoint({
      checkpoint,
      tracks,
      vibe: "party",
      requestedLength,
      maxPerArtist: 10,
      promptCentralArtists: new Set(),
    });
  }
  session.freezeTerminal("terminal_delivery");
  session.runTerminalAuthorityValidation();
}

for (let seed = 0; seed < 200; seed += 1) {
  test(`Phase 5 property: random mutation sequence seed=${seed}`, () => {
    const steps = 3 + (seed % 8);
    const { session, delivery } = runRandomSequence(seed, steps);
    runFullCheckpointChain(session, delivery);

    const diagnostics = session.getDiagnostics();
    const checkpointProof = proveCheckpointOrder(diagnostics.checkpoints);
    assert.equal(checkpointProof.pass, true, checkpointProof.details.join("; "));

    assert.equal(diagnostics.terminalFrozen, true);
    assert.ok(diagnostics.mutations.some((m) => m.mutationType === "freeze"));
    assert.equal(diagnostics.authorityValidation?.pass, true);

    const contentMutations = diagnostics.mutations.filter((m) => m.mutationType !== "freeze");
    assert.equal(contentMutations.length, session.getMutationCount());

    for (let i = 1; i < contentMutations.length; i += 1) {
      assert.ok(contentMutations[i]!.order > contentMutations[i - 1]!.order);
    }

    const ids = delivery.getTracks().map((t) => t.trackId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "duplicate track ids in delivery");

    const preResponse = diagnostics.checkpoints.find((c) => c.checkpoint === "pre_response");
    assert.ok(preResponse, "quality pre_response checkpoint should exist");

    assert.throws(
      () => delivery.appendTracks("post_freeze", "forbidden", [makeTrack("z")]),
      PipelineAuthorityFrozenError,
    );
  });
}

test("Phase 2: checkpoint order proof rejects duplicates and gaps", () => {
  const good = proveCheckpointOrder(PIPELINE_CHECKPOINT_ORDER.map((cp) => minimalReport(cp)));
  assert.equal(good.pass, true);

  const missing = proveCheckpointOrder([
    minimalReport("post_v3"),
    minimalReport("pre_response"),
  ]);
  assert.equal(missing.pass, false);
  assert.ok(missing.missing.length > 0);

  const dup = proveCheckpointOrder([
    minimalReport("post_v3"),
    minimalReport("post_v3"),
    minimalReport("post_recovery"),
    minimalReport("post_evidence"),
    minimalReport("post_refill"),
    minimalReport("pre_response"),
  ]);
  assert.equal(dup.pass, false);
  assert.ok(dup.duplicates.includes("post_v3"));
});

test("Phase 1 registry: every buffer mutation appears exactly once in registry", () => {
  const session = createPipelineAuthoritySession();
  const delivery = new PipelineDeliveryBuffer<Track>(session);
  delivery.init("v3_handoff", "init", [makeTrack("1")]);
  delivery.appendTracks("recovery", "append", [makeTrack("2")]);
  delivery.filterTracks("evidence", "filter", () => true);
  delivery.truncateTracks("refill", "truncate", 2);
  const mutations = session.getDiagnostics().mutations;
  assert.equal(mutations.length, 4);
  const orders = mutations.map((m) => m.order);
  assert.deepEqual(orders, [1, 2, 3, 4]);
});
