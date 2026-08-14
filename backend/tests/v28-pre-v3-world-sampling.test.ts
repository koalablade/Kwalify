import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { applyMusicalWorldPreV3Sampling } from "../core/pre-v3-world-sampling";
import { resolveWorldBoundary } from "../core/world-boundary";
import { classifyTrack } from "../lib/genre-taxonomy";

function classMapFor(tracks: Array<{
  trackId: string;
  trackName: string;
  artistName: string;
  albumName?: string;
}>) {
  const map = new Map<string, ReturnType<typeof classifyTrack>>();
  for (const track of tracks) {
    map.set(track.trackId, classifyTrack({
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName ?? "",
      energy: 0.6,
      valence: 0.6,
    }));
  }
  return map;
}

function reggaeLibrary(count: number) {
  const artists = [
    "Bob Marley & The Wailers",
    "Peter Tosh",
    "Shaggy",
    "Sean Paul",
    "Gregory Isaacs",
  ];
  return Array.from({ length: count }, (_, i) => ({
    trackId: `reggae-${i}`,
    trackName: `Track ${i}`,
    artistName: artists[i % artists.length]!,
    albumName: "Legend",
    energy: 0.55,
    valence: 0.62,
    score: 0.7 - i * 0.001,
  }));
}

function indieWrongWorld(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    trackId: `indie-${i}`,
    trackName: `Indie ${i}`,
    artistName: i % 2 === 0 ? "MGMT" : "Wallows",
    albumName: "Indie",
    energy: 0.5,
    valence: 0.5,
    score: 0.8 - i * 0.001,
  }));
}

describe("v28 pre-V3 world sampling", () => {
  it("expands reggae_world pool beyond strict contract-evidence collapse", () => {
    const prompt = "sunset beach reggae";
    const committed = resolveCommittedWorld({ prompt });
    assert.ok(committed?.musicalWorldId === "reggae_world");
    const worldBoundary = resolveWorldBoundary({ prompt });
    const reggae = reggaeLibrary(80);
    const indie = indieWrongWorld(20);
    const classMap = classMapFor([...reggae, ...indie]);
    const contractEvidence = reggae.slice(0, 17);
    const retrievalPool = [...reggae.slice(0, 60), ...indie.slice(0, 5)];

    const result = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: contractEvidence,
      retrievalPool,
      libraryPool: reggae,
      classMap,
      worldBoundary,
      minTarget: 50,
      maxTarget: 200,
      contractEvidenceCount: contractEvidence.length,
    });

    assert.equal(result.diagnostics.applied, true);
    assert.ok(result.pool.length >= 50, `expected >=50 got ${result.pool.length}`);
    assert.ok(result.pool.every((t) => !/mgmt|wallows/i.test(t.artistName ?? "")));
    assert.ok(result.pool.some((t) => /bob marley|shaggy|sean paul/i.test(t.artistName ?? "")));
  });

  it("expands uk_garage_world without prompt hard-coding", () => {
    const prompt = "late night UK garage drive";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = Array.from({ length: 70 }, (_, i) => ({
      trackId: `ukg-${i}`,
      trackName: `Garage ${i}`,
      artistName: i % 3 === 0 ? "Conducta" : i % 3 === 1 ? "Craig David" : "Artful Dodger",
      albumName: "UKG",
      energy: 0.7,
      valence: 0.55,
      score: 0.68,
    }));
    const classMap = classMapFor(library);
    const result = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: library.slice(0, 12),
      retrievalPool: library.slice(0, 55),
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 40,
      maxTarget: 180,
      contractEvidenceCount: 12,
    });
    assert.equal(result.diagnostics.applied, true);
    assert.ok(result.pool.length >= 40);
  });

  it("expands pop_punk_world for gym compound prompt", () => {
    const prompt = "2000s pop punk gym workout";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = Array.from({ length: 60 }, (_, i) => ({
      trackId: `pp-${i}`,
      trackName: `Punk ${i}`,
      artistName: i % 2 === 0 ? "Paramore" : "blink-182",
      albumName: "Punk",
      energy: 0.82,
      valence: 0.6,
      score: 0.75,
    }));
    const classMap = classMapFor(library);
    const result = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: library.slice(0, 10),
      retrievalPool: library.slice(0, 45),
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 35,
      maxTarget: 150,
      contractEvidenceCount: 10,
    });
    assert.equal(result.diagnostics.applied, true);
    assert.ok(result.pool.length >= 35);
  });

  it("expands gym_energy_world for hard techno gym", () => {
    const prompt = "hard techno gym";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = Array.from({ length: 65 }, (_, i) => ({
      trackId: `techno-${i}`,
      trackName: `Techno ${i}`,
      artistName: i % 2 === 0 ? "Charlotte de Witte" : "TECHNO N TEQUILLA",
      albumName: "Techno",
      energy: 0.9,
      valence: 0.45,
      score: 0.8,
    }));
    const classMap = classMapFor(library);
    const result = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: library.slice(0, 8),
      retrievalPool: library.slice(0, 50),
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 30,
      maxTarget: 160,
      contractEvidenceCount: 8,
    });
    assert.equal(result.diagnostics.applied, true);
    assert.ok(result.pool.length >= 30);
  });

  it("does not expand when pool already meets minimum", () => {
    const prompt = "reggae";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = reggaeLibrary(60);
    const classMap = classMapFor(library);
    const result = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: library,
      retrievalPool: library,
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 30,
      maxTarget: 200,
      contractEvidenceCount: library.length,
    });
    assert.equal(result.diagnostics.applied, false);
    assert.equal(result.diagnostics.reason, "pool_already_sufficient");
  });
});
