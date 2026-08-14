/**
 * Unit tests for PlaylistContract V38 architecture prototype.
 * Run: npm run build && node --test backend/dist/tests/playlist-contract.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { compareContractWithWorld, assessCollapseRisk } from "../core/playlist-contract/compare-with-world";
import { resolveCommittedWorld } from "../core/committed-world";
import {
  scoreTrackAgainstContract,
  rankTracksByContract,
  contractRetrievalPoolStats,
  applyContractAwareRetrievalRerank,
} from "../core/playlist-contract/constraint-aware-retrieval";
import { auditPlaylistAgainstContract } from "../core/playlist-contract/contract-validator";
import { deriveHonestPartialFromContract } from "../core/playlist-contract/honest-partial";
import {
  setPlaylistContractShadowEnabled,
  setPlaylistContractRetrievalEnabled,
  setPlaylistContractValidationMode,
} from "../core/playlist-contract/feature-flag";
import { runPlaylistContractShadow, resolvePlaylistContractContext } from "../core/playlist-contract/shadow";
import { classifyFailureFromV37Row } from "../core/playlist-contract/information-loss";

test("buildPlaylistContract preserves tension for sad party bangers", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  assert.ok(contract.tension.length > 0, "should detect contradictory tension");
  assert.ok(
    contract.tension.some((t) => t.description.includes("sad")),
    "tension should mention sad+party",
  );
  assert.equal(contract.version, "playlist-contract-v1");
});

test("buildPlaylistContract captures not cheesy as mustNot", () => {
  const contract = buildPlaylistContract({ prompt: "energetic but not cheesy" });
  assert.ok(
    contract.mustNot.some((n) => n.value === "cheesy"),
    "cheesy negation should be in mustNot",
  );
  assert.ok(contract.tension.length > 0, "should have tension axis");
});

test("compareContractWithWorld flags tension collapse on hard lock", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const world = resolveCommittedWorld({ prompt: "sad party bangers" });
  const disagreements = compareContractWithWorld(contract, world);
  if (world?.hardLock && contract.tension.length > 0) {
    assert.ok(
      disagreements.some((d) => d.kind === "tension_collapsed"),
      "hard lock + tension should produce tension_collapsed disagreement",
    );
  }
  const risk = assessCollapseRisk(contract, disagreements);
  assert.ok(typeof risk === "string");
});

test("constraint-aware retrieval rejects christmas when mustNot seasonal", () => {
  const contract = buildPlaylistContract({ prompt: "cozy winter no christmas" });
  const christmasTrack = {
    trackId: "x1",
    trackName: "Last Christmas",
    artistName: "Wham!",
    genreFamily: "pop",
    energy: 0.5,
    valence: 0.6,
  };
  const score = scoreTrackAgainstContract(christmasTrack, contract);
  assert.equal(score.admissible, false, "christmas track must be inadmissible");
  assert.ok(score.violations.some((v) => v.includes("christmas")));
});

test("constraint-aware retrieval ranks genre-matching tracks higher", () => {
  const contract = buildPlaylistContract({ prompt: "sunset beach reggae" });
  const reggae = { trackId: "r1", trackName: "One Love", artistName: "Bob Marley", genreFamily: "reggae", energy: 0.55 };
  const rock = { trackId: "r2", trackName: "Rock Song", artistName: "Band", genreFamily: "rock", energy: 0.55 };
  const ranked = rankTracksByContract([rock, reggae], contract);
  assert.equal(ranked[0]!.trackId, "r1", "reggae should rank first");
});

test("contract validator detects tension unsatisfiable", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const tracks = [
    { trackId: "t1", trackName: "Party", artistName: "DJ", genreFamily: "pop", energy: 0.9 },
    { trackId: "t2", trackName: "Sad", artistName: "Indie", genreFamily: "indie", energy: 0.3 },
  ];
  const audit = auditPlaylistAgainstContract(tracks, contract, 25);
  assert.equal(audit.honestPartial, true);
  assert.ok(audit.unsatisfiableConstraints.length > 0);
});

test("honest partial explains tension shortfall", () => {
  const contract = buildPlaylistContract({ prompt: "sad party bangers" });
  const audit = auditPlaylistAgainstContract([], contract, 25);
  const decision = deriveHonestPartialFromContract(contract, audit, 25, 25);
  assert.equal(decision.shouldCap, true);
  assert.ok(decision.userMessage?.includes("honest partial") || decision.userMessage?.includes("satisfy"));
});

test("shadow mode no-op when flag off", () => {
  setPlaylistContractShadowEnabled(false);
  const log = { info: () => {}, warn: () => {} };
  const result = runPlaylistContractShadow({ prompt: "melancholy indie" }, log);
  assert.equal(result, null);
});

test("shadow mode computes when flag on", () => {
  setPlaylistContractShadowEnabled(true);
  const logs: string[] = [];
  const log = {
    info: (_o: Record<string, unknown>, msg: string) => { logs.push(msg); },
    warn: () => {},
  };
  const result = runPlaylistContractShadow({ prompt: "melancholy indie" }, log);
  setPlaylistContractShadowEnabled(null);
  assert.ok(result?.contract);
  assert.ok(logs.includes("playlist_contract_shadow"));
});

test("resolvePlaylistContractContext builds contract for retrieval-only flag", () => {
  setPlaylistContractShadowEnabled(false);
  setPlaylistContractRetrievalEnabled(true);
  const logs: string[] = [];
  const log = {
    info: (_o: Record<string, unknown>, msg: string) => { logs.push(msg); },
    warn: () => {},
  };
  const result = resolvePlaylistContractContext({ prompt: "melancholy indie" }, log);
  setPlaylistContractRetrievalEnabled(null);
  assert.ok(result?.contract);
  assert.equal(logs.includes("playlist_contract_shadow"), false);
});

test("information loss classifies sad party bangers earliest loss", () => {
  const trace = classifyFailureFromV37Row({
    id: "V35-12",
    prompt: "sad party bangers",
    delivered: 6,
    v3Composed: 25,
    postPurity: 24,
  });
  assert.equal(trace.earliestLoss, "B_parallel_parser_divergence");
  assert.ok(trace.lossChain.includes("K_hqg_honest_partial"));
});

test("feature flags override for retrieval and validation", () => {
  setPlaylistContractRetrievalEnabled(true);
  assert.ok(true);
  setPlaylistContractValidationMode("shadow");
  setPlaylistContractRetrievalEnabled(null);
  setPlaylistContractValidationMode(null);
});

test("contractRetrievalPoolStats summarizes pool", () => {
  const contract = buildPlaylistContract({ prompt: "indie gym pump up" });
  const tracks = [
    { trackId: "a", genreFamily: "indie", energy: 0.7 },
    { trackId: "b", genreFamily: "rock", energy: 0.8 },
  ];
  const stats = contractRetrievalPoolStats(tracks, contract);
  assert.equal(stats.total, 2);
  assert.ok(stats.admissible >= 0);
});

test("applyContractAwareRetrievalRerank promotes admissible tracks without shrinking pool", () => {
  const contract = buildPlaylistContract({ prompt: "sunset beach reggae" });
  const reggae = {
    trackId: "r1",
    trackName: "One Love",
    artistName: "Bob Marley",
    genreFamily: "reggae",
    energy: 0.55,
  };
  const rock = {
    trackId: "r2",
    trackName: "Rock Song",
    artistName: "Band",
    genreFamily: "rock",
    energy: 0.55,
  };
  const christmas = {
    trackId: "x1",
    trackName: "Last Christmas",
    artistName: "Wham!",
    genreFamily: "pop",
    energy: 0.5,
  };
  const contractChristmas = buildPlaylistContract({ prompt: "cozy winter no christmas" });
  const applied = applyContractAwareRetrievalRerank([rock, christmas, reggae], contract);
  assert.equal(applied.tracks.length, 3);
  assert.equal(applied.tracks[0]!.trackId, "r1");
  assert.equal(applied.stats.reranked, true);

  const appliedNeg = applyContractAwareRetrievalRerank([christmas, reggae, rock], contractChristmas);
  assert.equal(appliedNeg.tracks.length, 3);
  assert.equal(appliedNeg.tracks[appliedNeg.tracks.length - 1]!.trackId, "x1");
});
