import assert from "node:assert/strict";
import test from "node:test";

import { interpretMoment } from "../core/expectation/moment-space";
import { deriveExpectationContract } from "../core/expectation/expectation-contract";
import { rerankByExpectation, type RerankCandidate } from "../core/expectation/expectation-rerank";

function contractFor(vibe: string) {
  return deriveExpectationContract(interpretMoment(vibe));
}

let seq = 0;
function mk(o: Partial<RerankCandidate> & { id?: string } = {}): RerankCandidate {
  const id = o.id ?? `t${seq++}`;
  return {
    trackId: id,
    trackName: o.trackName ?? `Song ${id}`,
    artistName: o.artistName ?? `Artist ${id}`,
    releaseYear: 2019,
    energy: o.energy ?? 0.5,
    valence: o.valence ?? 0.5,
    tempo: o.tempo ?? 110,
    acousticness: o.acousticness ?? 0.5,
    instrumentalness: o.instrumentalness ?? 0.2,
    score: o.score ?? 0.6,
  };
}

const calm = (id: string, artist?: string, score = 0.6) =>
  mk({ id, artistName: artist ?? `Calm ${id}`, energy: 0.15, valence: 0.4, tempo: 68, acousticness: 0.85, instrumentalness: 0.6, score });
const rave = (id: string, score = 0.95) =>
  mk({ id, artistName: `Rave ${id}`, energy: 0.97, valence: 0.85, tempo: 150, acousticness: 0.02, score });

test("shadow mode computes diagnostics but never mutates the selection", () => {
  const contract = contractFor("ambient music for falling asleep");
  const selected = [rave("r1"), rave("r2"), calm("c1"), calm("c2"), calm("c3")];
  const pool = [...selected, ...Array.from({ length: 8 }, (_, i) => calm(`p${i}`, `Pool ${i}`))];
  const res = rerankByExpectation(selected, pool, contract, { playlistLength: 5, mode: "shadow" });
  assert.equal(res.diagnostics.applied, false);
  assert.deepEqual(res.tracks.map((t) => t.trackId), selected.map((t) => t.trackId));
  // It still *reports* what it would do.
  assert.ok(res.diagnostics.demoted.length > 0 || res.diagnostics.promoted.length > 0);
});

test("reports candidate-pool recall + diversity signals (P3/P7)", () => {
  const contract = contractFor("ambient music for falling asleep");
  const selected = [rave("r1"), calm("c1"), calm("c2")];
  const pool = [...selected, ...Array.from({ length: 6 }, (_, i) => calm(`p${i}`, `Pool ${i}`))];
  const res = rerankByExpectation(selected, pool, contract, { playlistLength: 3, mode: "shadow" });
  const p = res.diagnostics.pool;
  assert.equal(p.size, 9, "union of selected + pool, de-duplicated");
  assert.ok(p.admissibleCount >= 8, "most calm tracks admissible for a sleep contract");
  assert.ok(p.admissibleRate > 0 && p.admissibleRate <= 1);
  assert.ok(p.distinctArtists >= 7, "artist variety counted");
  assert.ok(p.eraSpreadYears >= 0);
  assert.ok(p.energySpread >= 0);
});

test("enforce demotes mood inversions and promotes admissible pool tracks", () => {
  const contract = contractFor("ambient music for falling asleep");
  const selected = [rave("r1"), rave("r2"), calm("c1"), calm("c2"), calm("c3")];
  const pool = [...selected, ...Array.from({ length: 10 }, (_, i) => calm(`p${i}`, `Pool ${i}`))];
  const res = rerankByExpectation(selected, pool, contract, { playlistLength: 5, mode: "enforce" });
  assert.equal(res.diagnostics.applied, true);
  const ids = res.tracks.map((t) => t.trackId);
  assert.ok(!ids.includes("r1") && !ids.includes("r2"), "rave tracks removed from selection");
  assert.equal(res.tracks.length, 5, "length preserved");
  assert.ok(res.diagnostics.avgAdmissibilityAfter >= res.diagnostics.avgAdmissibilityBefore);
  assert.ok(res.diagnostics.promoted.length >= 2);
});

test("never imports an inversion, and holds when it cannot improve", () => {
  const contract = contractFor("ambient music for falling asleep");
  // Selection already clean; pool offers only high-score rave tracks.
  const selected = Array.from({ length: 5 }, (_, i) => calm(`c${i}`, `Calm ${i}`));
  const pool = [...selected, rave("r1", 1.2), rave("r2", 1.2)];
  const res = rerankByExpectation(selected, pool, contract, { playlistLength: 5, mode: "enforce" });
  assert.equal(res.diagnostics.applied, false, "no change when nothing better exists");
  const ids = res.tracks.map((t) => t.trackId);
  assert.ok(!ids.includes("r1") && !ids.includes("r2"), "inadmissible pool tracks never imported");
});

test("respects the artist cap during re-selection", () => {
  const contract = contractFor("ambient music for falling asleep");
  const selected = [rave("r1"), calm("c1", "Solo"), calm("c2", "Solo"), calm("c3", "Solo"), calm("c4", "Solo")];
  const pool = [...selected, ...Array.from({ length: 10 }, (_, i) => calm(`p${i}`, `Pool ${i}`))];
  const res = rerankByExpectation(selected, pool, contract, { playlistLength: 5, maxPerArtist: 2, mode: "enforce" });
  const counts = new Map<string, number>();
  for (const t of res.tracks) counts.set(t.artistName ?? "", (counts.get(t.artistName ?? "") ?? 0) + 1);
  assert.ok((counts.get("Solo") ?? 0) <= 2, "artist cap enforced");
});

test("is deterministic", () => {
  const contract = contractFor("late night city drive");
  const selected = [rave("r1"), calm("c1"), calm("c2"), calm("c3"), calm("c4")];
  const pool = [...selected, ...Array.from({ length: 8 }, (_, i) => calm(`p${i}`, `Pool ${i}`))];
  const a = rerankByExpectation(selected, pool, contract, { playlistLength: 5, mode: "enforce" });
  const b = rerankByExpectation(selected, pool, contract, { playlistLength: 5, mode: "enforce" });
  assert.deepEqual(a.tracks.map((t) => t.trackId), b.tracks.map((t) => t.trackId));
});
