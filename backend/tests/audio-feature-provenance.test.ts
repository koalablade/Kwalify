import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectAudioFeatureSource, inferMetadataAudioFeatures } from "../lib/metadata-audio-feature-inference";
import { summariseAudioFeatureProvenance } from "../lib/audio-feature-provenance";

const ROOT = path.resolve(__dirname, "../../..");
const CONTROLLER = path.join(ROOT, "backend/controllers/generation.controller.ts");

// Stored in Postgres as float4 ("real"), so round-trip through Float32 like the DB does.
const f32 = (n: number) => Math.fround(n);

const INFERRED_INPUTS = [
  { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "Midnight City", artistName: "M83", albumName: "Hurry Up, We're Dreaming" },
  { trackId: "3n3Ppam7vgaVa1iaRUc9Lp", trackName: "Mr. Brightside", artistName: "The Killers", albumName: "Hot Fuss", popularity: 88 },
  { trackId: "1aaaaaaaaaaaaaaaaaaaaa", trackName: "Slow Ballad - Acoustic", artistName: "Unknown Band", albumName: "Live at Home", durationMs: 330_000 },
  { trackId: "2bbbbbbbbbbbbbbbbbbbbb", trackName: "Banger (Club Mix) - Remix", artistName: "DJ Someone", albumName: "Workout Hype", durationMs: 120_000 },
  { trackId: "5ccccccccccccccccccccc", trackName: "Nocturne", artistName: "Orchestra", albumName: "Sonata Suite", spotifyArtistGenres: ["classical"] },
  { trackId: "6ddddddddddddddddddddd", trackName: "Some Song", artistName: "Headie One", albumName: "Drill Tape" },
];

test("rows written by inferMetadataAudioFeatures are detected as inferred", () => {
  for (const input of INFERRED_INPUTS) {
    const f = inferMetadataAudioFeatures(input);
    const row = {
      trackId: input.trackId,
      energy: f32(f.energy),
      valence: f32(f.valence),
      tempo: f32(f.tempo),
      loudness: f32(f.loudness),
    };
    assert.equal(detectAudioFeatureSource(row), "inferred", input.trackName);
  }
});

test("detection does not depend on the genre classification used at write time", () => {
  // Same track, classified differently (artist genres added later): still inferred.
  const base = INFERRED_INPUTS[0]!;
  const f = inferMetadataAudioFeatures({ ...base, spotifyArtistGenres: ["death metal"] });
  assert.equal(
    detectAudioFeatureSource({ trackId: base.trackId, energy: f32(f.energy), valence: f32(f.valence), tempo: f32(f.tempo), loudness: f32(f.loudness) }),
    "inferred",
  );
});

test("real Spotify measurements are detected as spotify; empty rows as missing", () => {
  const real = [
    { trackId: "4uLU6hMCjMI75M1A2tKUQC", energy: 0.714, valence: 0.32, tempo: 105.009, loudness: -5.399 },
    { trackId: "3n3Ppam7vgaVa1iaRUc9Lp", energy: 0.918, valence: 0.236, tempo: 148.033, loudness: -3.659 },
    { trackId: "7ccccccccccccccccccccc", energy: 0.0263, valence: 0.0371, tempo: 67.5, loudness: -28.1 },
  ];
  for (const r of real) assert.equal(detectAudioFeatureSource({ ...r, valence: f32(r.valence) }), "spotify");
  assert.equal(detectAudioFeatureSource({ trackId: "x", energy: null, valence: null }), "missing");
});

test("summary counts real, inferred and missing rows", () => {
  const f = inferMetadataAudioFeatures(INFERRED_INPUTS[1]!);
  const inferredRow = { trackId: INFERRED_INPUTS[1]!.trackId, energy: f32(f.energy), valence: f32(f.valence), tempo: f32(f.tempo), loudness: f32(f.loudness) };
  const realRow = { trackId: "real0000000000", energy: 0.91, valence: 0.12, tempo: 172.4, loudness: -4.2 };
  const missingRow = { trackId: "none0000000000", energy: null, valence: null };
  assert.deepEqual(summariseAudioFeatureProvenance([inferredRow, realRow, missingRow]), {
    total: 3, spotify: 1, inferred: 1, missing: 1,
  });
});

test("generation controller reports audio-feature provenance in audit responses", () => {
  const src = readFileSync(CONTROLLER, "utf8");
  assert.match(src, /audioFeatureProvenance = summariseAudioFeatureProvenance\(likedSongs\)/);
  assert.match(src, /\.\.\.\(audioFeatureProvenance \? \{ audioFeatureProvenance \} : \{\}\)/);
});
