/**
 * Pipeline hygiene integration — pre-freeze opener sync, HQG world signals, response metrics shape.
 *
 * Offline unit coverage for /api/generate terminal hygiene without a live library.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHumanQualityGate } from "../core/editorial/human-quality-gate";
import {
  committedWorldQualitySignals,
  gymLaneFamiliesForPrompt,
  LANE_PURITY_WORLD_IDS,
  scoreCommittedWorldLanePurity,
} from "../core/editorial/world-coherence-score";
import {
  applyPreFreezeOpenerHygieneToDelivery,
  buildOpenerHygieneMetrics,
  inferWorldIdentityIdsFromPrompt,
} from "../core/editorial/world-identity-gate";

test("vague MAYBE prompts route to committed everyday worlds", () => {
  const cases: Array<[string, string]> = [
    ["upbeat stuff for a morning walk", "upbeat_chore_world"],
    ["happy vibes", "feel_good_world"],
    ["pre drinks before we go out", "party_prep_world"],
    ["hype night out", "party_prep_world"],
    ["got a promotion let's go", "feel_good_world"],
    ["ignore them and lift on my ex's birthday", "gym_energy_world"],
  ];
  for (const [prompt, world] of cases) {
    const ids = inferWorldIdentityIdsFromPrompt(prompt);
    assert.ok(ids.includes(world), `${prompt} -> ${ids.join(",")}`);
    assert.ok(LANE_PURITY_WORLD_IDS.has(world), world);
  }
});

test("pre-freeze opener hygiene reorders pipeline delivery before freeze", () => {
  const tracks = [
    { trackId: "a", artistName: "Tame Impala" },
    { trackId: "b", artistName: "Kasabian" },
    { trackId: "c", artistName: "ABBA" },
    { trackId: "d", artistName: "Chic" },
  ];
  const result = applyPreFreezeOpenerHygieneToDelivery(tracks, ["party_prep_world"], { minKeep: 3 });
  assert.notEqual(result.tracks[0]?.trackId, "a");
  assert.equal(result.tracks[0]?.trackId, "c");
  const metrics = buildOpenerHygieneMetrics(result.diagnostics, {
    preFreezeApplied: true,
    postFreezeApplied: false,
    pipelineOpenerIds: result.tracks.slice(0, 3).map((t) => t.trackId),
    apiOpenerIds: result.tracks.slice(0, 3).map((t) => t.trackId),
  });
  assert.equal(metrics.preFreezeApplied, true);
  assert.equal(metrics.openerOrderAligned, true);
  assert.ok(typeof metrics.retrievalFillerStripped === "number" || typeof metrics.openerFillerDemoted === "number");
});

test("committed world quality signals detect lane mash for party prep", () => {
  const mashTracks = [
    { artistName: "Metallica", genreFamily: "metal", genrePrimary: "metal" },
    { artistName: "Fleetwood Mac", genreFamily: "rock", genrePrimary: "rock" },
    { artistName: "Blondie", genreFamily: "pop", genrePrimary: "pop" },
    { artistName: "Led Zeppelin", genreFamily: "rock", genrePrimary: "rock" },
    { artistName: "AC/DC", genreFamily: "rock", genrePrimary: "rock" },
    { artistName: "Queen", genreFamily: "rock", genrePrimary: "rock" },
  ];
  const signals = committedWorldQualitySignals("party_prep_world", mashTracks);
  assert.equal(signals.activeWorldId, "party_prep_world");
  assert.ok((signals.feelGoodLanePurity ?? 1) < 0.58);
  assert.ok((signals.uniqueGenreFamilies ?? 0) >= 2);

  const laneOk = scoreCommittedWorldLanePurity("party_prep_world", mashTracks).ok;
  const hqg = evaluateHumanQualityGate({
    trackCount: mashTracks.length,
    requestedLength: 20,
    promptLabel: "pre drinks",
    ...signals,
    committedWorldLaneOk: laneOk,
  });
  assert.equal(hqg.action, "honest_partial");
  assert.ok(hqg.reasons.includes("world_lane_mash"));
});

test("gym lane families exclude rock unless pump/punk prompt", () => {
  const generic = gymLaneFamiliesForPrompt("ex's birthday ignore them and lift");
  assert.equal(generic.has("rock"), false);
  const punk = gymLaneFamiliesForPrompt("2000s pop punk gym workout");
  assert.equal(punk.has("rock"), true);
});

test("production hygiene metrics shape is dashboard-ready", () => {
  const metrics = buildOpenerHygieneMetrics(
    { openerFillerDemoted: 2, psychIndieOpenerSanitized: 1, psychIndieOpenerMaxAllowed: 0 },
    {
      preFreezeApplied: true,
      postFreezeApplied: true,
      pipelineOpenerIds: ["c", "d", "e"],
      apiOpenerIds: ["c", "d", "e"],
    },
  );
  assert.equal(metrics.preFreezeApplied, true);
  assert.equal(metrics.postFreezeApplied, true);
  assert.equal(metrics.openerOrderAligned, true);
  assert.deepEqual(metrics.demotedArtists, []);
  assert.equal(metrics.psychIndieOpenerMaxAllowed, 0);
});
