import assert from "node:assert/strict";
import test from "node:test";

import { interpretMoment } from "../core/expectation/moment-space";
import { deriveExpectationContract } from "../core/expectation/expectation-contract";
import { evaluateTrackAdmissibility } from "../core/expectation/track-admissibility";
import { detectFailureModes } from "../core/expectation/failure-taxonomy";
import { critiquePlaylist } from "../core/expectation/playlist-critic";
import { repairPlaylist } from "../core/expectation/repair";
import { runPlaylistExpectation } from "../core/expectation/playlist-evaluation";
import { setHumanExpectationMode } from "../core/expectation/feature-flag";
import type { ExpectationTrack } from "../core/expectation/types";

function contractFor(vibe: string) {
  const interp = interpretMoment(vibe);
  return { interp, contract: deriveExpectationContract(interp) };
}

function track(id: string, o: Partial<ExpectationTrack> = {}): ExpectationTrack {
  return {
    trackId: id,
    trackName: o.trackName ?? `Song ${id}`,
    artistName: o.artistName ?? `Artist ${id}`,
    releaseYear: o.releaseYear ?? 2018,
    energy: o.energy ?? 0.5,
    valence: o.valence ?? 0.5,
    tempo: o.tempo ?? 110,
    acousticness: o.acousticness ?? 0.5,
    instrumentalness: o.instrumentalness ?? 0.2,
    genreFamily: o.genreFamily ?? null,
    genres: o.genres ?? null,
  };
}

// A calm/low-energy track suitable for ambient sleep / rainy cafe.
function calmTrack(id: string, artist?: string): ExpectationTrack {
  return track(id, { artistName: artist ?? `Calm ${id}`, energy: 0.15, valence: 0.4, tempo: 70, acousticness: 0.8, instrumentalness: 0.6 });
}
// A high-energy "rave" track.
function raveTrack(id: string): ExpectationTrack {
  return track(id, { artistName: `Rave ${id}`, energy: 0.97, valence: 0.8, tempo: 150, acousticness: 0.02, instrumentalness: 0.4 });
}

test("mood inversion: rave track is inadmissible for ambient sleep", () => {
  const { contract } = contractFor("ambient soundscape for falling asleep");
  const calm = evaluateTrackAdmissibility(calmTrack("c1"), contract);
  const rave = evaluateTrackAdmissibility(raveTrack("r1"), contract);
  assert.ok(calm.admissible, "calm track admissible for sleep");
  assert.ok(!rave.admissible, "rave track rejected for sleep");
  assert.ok(rave.score < calm.score, "rave scores below calm");
  assert.ok(rave.violations.some((v) => /energy too high/.test(v)));
});

test("first date does not admit aggressive high-energy tracks", () => {
  const { contract } = contractFor("nervous excited first date evening");
  const aggressive = evaluateTrackAdmissibility(
    track("a1", { energy: 0.98, valence: 0.15, tempo: 160 }),
    contract,
  );
  assert.ok(!aggressive.admissible, "aggressive track rejected for first date");
});

test("failure taxonomy flags energy mismatch and opening misrepresentation", () => {
  const { interp, contract } = contractFor("ambient soundscape for falling asleep");
  const tracks = [raveTrack("r1"), raveTrack("r2"), calmTrack("c1"), calmTrack("c2"), calmTrack("c3")];
  const findings = detectFailureModes(tracks, contract, interp);
  const modes = findings.map((f) => f.mode);
  assert.ok(modes.includes("ENERGY_MISMATCH"), "energy mismatch detected");
  assert.ok(modes.includes("OPENING_MISREPRESENTS"), "opening problem detected");
});

test("season mismatch: christmas track outside a holiday moment (non-December)", () => {
  const { interp, contract } = contractFor("late night drive through empty city streets");
  const july = new Date("2026-07-13T00:00:00Z");
  const tracks = [
    calmTrack("c1"),
    track("x1", { trackName: "Last Christmas", genres: ["christmas"] }),
    calmTrack("c2"),
  ];
  const findings = detectFailureModes(tracks, contract, interp, july);
  assert.ok(findings.some((f) => f.mode === "SEASON_MISMATCH"), "christmas leak flagged");
});

test("artist fatigue detected when one artist dominates", () => {
  const { interp, contract } = contractFor("rainy afternoon in a cozy coffee shop");
  const tracks = Array.from({ length: 10 }, (_, i) => calmTrack(`c${i}`, i < 5 ? "Same Artist" : `Other ${i}`));
  const findings = detectFailureModes(tracks, contract, interp);
  assert.ok(findings.some((f) => f.mode === "ARTIST_FATIGUE"), "artist fatigue flagged");
});

test("near-duplicate detected for same recording under different ids/versions", () => {
  const { interp, contract } = contractFor("rainy afternoon in a cozy coffee shop");
  const tracks = [
    track("d1", { trackName: "Holocene", artistName: "Bon Iver", energy: 0.3, valence: 0.4 }),
    track("d2", { trackName: "Holocene - Remastered", artistName: "Bon Iver", energy: 0.3, valence: 0.4 }),
    track("d3", { trackName: "Holocene (Live)", artistName: "Bon Iver", energy: 0.3, valence: 0.4 }),
    track("u1", { trackName: "Skinny Love", artistName: "Bon Iver", energy: 0.35, valence: 0.4 }),
  ];
  const findings = detectFailureModes(tracks, contract, interp);
  const nearDup = findings.find((f) => f.mode === "NEAR_DUPLICATE");
  assert.ok(nearDup, "near-duplicate flagged");
  assert.equal(nearDup!.trackIds.length, 2, "flags the two extra copies, keeps one");
});

test("critic: coherent calm playlist for sleep publishes with high fit", () => {
  const { interp, contract } = contractFor("ambient soundscape for falling asleep");
  const tracks = Array.from({ length: 12 }, (_, i) => calmTrack(`c${i}`, `Ambient ${i % 6}`));
  const c = critiquePlaylist(tracks, contract, interp);
  assert.ok(c.overallFit >= 70, `expected high fit, got ${c.overallFit}`);
  assert.equal(c.verdict, "publish");
  assert.ok(c.editorial.emotionalTruth.pass);
});

test("critic: inverted sleep playlist is not published", () => {
  const { interp, contract } = contractFor("ambient soundscape for falling asleep");
  const tracks = [raveTrack("r1"), raveTrack("r2"), raveTrack("r3"), calmTrack("c1"), calmTrack("c2")];
  const c = critiquePlaylist(tracks, contract, interp);
  assert.notEqual(c.verdict, "publish");
  assert.ok(c.overallFit < 70, `expected low fit, got ${c.overallFit}`);
});

test("repair removes rave tracks and backfills calm matches from reservoir", () => {
  const { interp, contract } = contractFor("ambient soundscape for falling asleep");
  const current = [
    raveTrack("r1"),
    raveTrack("r2"),
    ...Array.from({ length: 8 }, (_, i) => calmTrack(`c${i}`, `Ambient ${i}`)),
  ];
  const reservoir = Array.from({ length: 12 }, (_, i) => calmTrack(`res${i}`, `Reservoir ${i}`));
  const result = repairPlaylist(current, reservoir, contract, interp, { minLength: 8 });
  assert.ok(result.removedIds.includes("r1") && result.removedIds.includes("r2"), "rave tracks removed");
  assert.ok(result.addedIds.length >= 2, "backfilled from reservoir");
  assert.equal(result.orderedIds.length, current.length, "length preserved");
  // No rave track survives.
  assert.ok(!result.orderedIds.includes("r1") && !result.orderedIds.includes("r2"));
});

test("repair de-duplicates repeated track ids (thin-supply clone bug)", () => {
  const { interp, contract } = contractFor("slow sunday morning jazz and coffee");
  const dup = calmTrack("dup1", "Solo Artist");
  const current = [dup, dup, dup, calmTrack("c1"), calmTrack("c2")];
  const reservoir = Array.from({ length: 6 }, (_, i) => calmTrack(`res${i}`, `Res ${i}`));
  const result = repairPlaylist(current, reservoir, contract, interp, { minLength: 3 });
  const unique = new Set(result.orderedIds);
  assert.equal(unique.size, result.orderedIds.length, "no duplicate ids remain");
});

test("orchestrator applies repair only in enforce mode", () => {
  const { contract } = contractFor("ambient soundscape for falling asleep");
  void contract;
  const tracks = [raveTrack("r1"), raveTrack("r2"), ...Array.from({ length: 8 }, (_, i) => calmTrack(`c${i}`, `Ambient ${i}`))];
  const reservoir = Array.from({ length: 12 }, (_, i) => calmTrack(`res${i}`, `Reservoir ${i}`));
  const params = {
    vibe: "ambient soundscape for falling asleep",
    seed: {},
    tracks,
    reservoir,
    targetLength: 10,
    log: { info: () => {}, warn: () => {} },
  };

  setHumanExpectationMode("shadow");
  const shadow = runPlaylistExpectation(params);
  assert.ok(shadow, "shadow returns result");
  assert.equal(shadow!.applied, false, "shadow never mutates");

  setHumanExpectationMode("enforce");
  const enforce = runPlaylistExpectation(params);
  assert.ok(enforce, "enforce returns result");
  assert.equal(enforce!.applied, true, "enforce applies repair");
  assert.ok(!enforce!.orderedIds.includes("r1"), "off-vibe track removed under enforce");

  setHumanExpectationMode(null);
});

test("orchestrator is a no-op when flag is off", () => {
  setHumanExpectationMode(null);
  const result = runPlaylistExpectation({
    vibe: "late night drive",
    seed: {},
    tracks: [calmTrack("c1"), calmTrack("c2"), calmTrack("c3")],
    reservoir: [],
    targetLength: 3,
    log: { info: () => { throw new Error("should not log"); }, warn: () => {} },
  });
  assert.equal(result, null);
});
