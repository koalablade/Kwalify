import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBenchmarkTrack,
  normalizeBenchmarkTracks,
  protectedBenchmarkMapTrack,
  validateBenchmarkTrackNormalization,
  normalizedTracksEquivalent,
  extractRawArtistKey,
} from "../scripts/lib/benchmark-track-normalizer.mjs";

describe("benchmark-track-normalizer", () => {
  it("maps API artist/name fields to evaluator shape", () => {
    const raw = {
      name: "Track",
      artist: "Artist",
      energy: 0.8,
      popularity: 50,
      valence: 0.6,
      acousticness: 0.2,
    };
    const norm = normalizeBenchmarkTrack(raw);
    assert.equal(norm.trackName, "Track");
    assert.equal(norm.artistName, "Artist");
    assert.equal(norm.energy, 0.8);
    assert.equal(norm.popularity, 50);
    assert.equal(norm.valence, 0.6);
    assert.equal(norm.acousticness, 0.2);
  });

  it("preserves canonical trackName/artistName fields", () => {
    const raw = { trackName: "Track", artistName: "Artist", energy: 0.5 };
    const norm = normalizeBenchmarkTrack(raw);
    assert.equal(norm.trackName, "Track");
    assert.equal(norm.artistName, "Artist");
  });

  it("handles mixed shapes and missing optional metadata", () => {
    const raw = [
      { trackName: "A", artistName: "One" },
      { name: "B", artist: "Two", popularity: 70 },
      { name: "C", artists: [{ name: "Three" }] },
      { trackName: "D", artist: "Four", energy: null },
    ];
    const norm = normalizeBenchmarkTracks(raw);
    assert.equal(norm[0].artistName, "One");
    assert.equal(norm[1].trackName, "B");
    assert.equal(norm[2].artistName, "Three");
    assert.equal(norm[3].energy, null);
  });

  it("does not produce undefined artistName when artist is available", () => {
    const norm = normalizeBenchmarkTrack({ name: "Song", artist: "Band" });
    assert.notEqual(norm.artistName, undefined);
    assert.equal(norm.artistName, "Band");
  });

  it("matches protected benchmark inline mapping", () => {
    const samples = [
      { name: "T1", artist: "A1", energy: 0.7 },
      { trackName: "T2", artistName: "A2", popularity: 55 },
      { name: "T3", artist: "A3", valence: 0.4, acousticness: 0.1 },
    ];
    for (const s of samples) {
      const a = normalizeBenchmarkTrack(s);
      const b = protectedBenchmarkMapTrack(s);
      assert.deepEqual(a, b);
    }
  });

  it("detects normalization collapse when raw has multiple artists", () => {
    const raw = [
      { artist: "A", name: "1" },
      { artist: "B", name: "2" },
      { artist: "C", name: "3" },
    ];
    const badNorm = raw.map(() => ({ trackName: "x", artistName: null, energy: null, popularity: null, valence: null, acousticness: null }));
    const result = validateBenchmarkTrackNormalization(raw, badNorm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("collapse") || e.includes("missing artist")));
  });

  it("allows genuine single-artist playlist", () => {
    const raw = [
      { artist: "Same", name: "1" },
      { artist: "Same", name: "2" },
    ];
    const norm = normalizeBenchmarkTracks(raw);
    const result = validateBenchmarkTrackNormalization(raw, norm);
    assert.equal(result.ok, true);
    assert.equal(extractRawArtistKey(raw[0]), "same");
  });
});

describe("benchmark-track-normalizer equivalence", () => {
  it("protected and canonical normalizers produce identical arrays", () => {
    const raw = [
      { name: "Back In Black", artist: "AC/DC", energy: 0.85, popularity: 88 },
      { trackName: "T.N.T.", artistName: "AC/DC", energy: 0.85, popularity: 70 },
      { name: "Welcome To The Jungle", artist: "Guns N' Roses", energy: 0.92, popularity: 80 },
    ];
    const canonical = normalizeBenchmarkTracks(raw);
    const protectedMap = raw.map(protectedBenchmarkMapTrack);
    assert.ok(normalizedTracksEquivalent(canonical, protectedMap));
  });
});
