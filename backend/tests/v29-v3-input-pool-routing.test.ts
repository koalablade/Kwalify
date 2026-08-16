import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { applyMusicalWorldPreV3Sampling } from "../core/pre-v3-world-sampling";
import { resolveV3BuildInputPool } from "../core/v3-input-pool-routing";
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

function mergeUniverse<T extends { trackId: string }>(primary: T[], secondary: T[], cap = 400): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const push = (track: T) => {
    if (seen.has(track.trackId)) return;
    seen.add(track.trackId);
    out.push(track);
  };
  for (const track of primary) {
    if (out.length >= cap) break;
    push(track);
  }
  for (const track of secondary) {
    if (out.length >= cap) break;
    push(track);
  }
  return out;
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

function technoLibrary(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    trackId: `techno-${i}`,
    trackName: `Techno ${i}`,
    artistName: i % 2 === 0 ? "Charlotte de Witte" : "TECHNO N TEQUILLA",
    albumName: "Techno",
    energy: 0.9,
    valence: 0.45,
    score: 0.8 - i * 0.001,
  }));
}

function ukgLibrary(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    trackId: `ukg-${i}`,
    trackName: `Garage ${i}`,
    artistName: i % 3 === 0 ? "Conducta" : i % 3 === 1 ? "Craig David" : "Artful Dodger",
    albumName: "UKG",
    energy: 0.7,
    valence: 0.55,
    score: 0.68 - i * 0.001,
  }));
}

function popPunkLibrary(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    trackId: `pp-${i}`,
    trackName: `Punk ${i}`,
    artistName: i % 2 === 0 ? "Paramore" : "blink-182",
    albumName: "Punk",
    energy: 0.82,
    valence: 0.6,
    score: 0.75 - i * 0.001,
  }));
}

describe("v29 v3 input pool routing", () => {
  it("routes reggae expanded contract pool to V3 when safety path would use 17 tracks", () => {
    const prompt = "sunset beach reggae";
    assert.ok(resolveCommittedWorld({ prompt })?.musicalWorldId === "reggae_world");
    const worldBoundary = resolveWorldBoundary({ prompt });
    const reggae = reggaeLibrary(80);
    const indie = indieWrongWorld(20);
    const classMap = classMapFor([...reggae, ...indie]);
    const contractEvidence = reggae.slice(0, 17);
    const safetyRetrievalPool = contractEvidence;

    const sampling = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: contractEvidence,
      retrievalPool: reggae.slice(0, 60),
      libraryPool: reggae,
      classMap,
      worldBoundary,
      minTarget: 50,
      maxTarget: 200,
      contractEvidenceCount: contractEvidence.length,
    });

    assert.equal(sampling.diagnostics.applied, true);
    assert.ok(sampling.pool.length >= 50);

    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: true,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: sampling.pool,
      safetyRetrievalPool,
      candidatePool: safetyRetrievalPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "pre_v3_contract_universe_merge");
    assert.ok(
      resolved.inputPool.length > safetyRetrievalPool.length,
      `V3 input ${resolved.inputPool.length} should exceed safety pool ${safetyRetrievalPool.length}`,
    );
    assert.ok(resolved.inputPool.length >= 50);
    assert.ok(resolved.inputPool.every((t) => !/mgmt|wallows|the 1975/i.test(t.artistName ?? "")));
    assert.ok(resolved.inputPool.some((t) => /bob marley|shaggy|peter tosh/i.test(t.artistName ?? "")));
  });

  it("commits 90s indie road trip nostalgia to road_trip_singalong_world", () => {
    const world = resolveCommittedWorld({ prompt: "90s indie road trip nostalgia" });
    assert.equal(world?.musicalWorldId, "road_trip_singalong_world");
  });

  it("preserves hard_lock_verified path for worlds with verified supply", () => {
    const contractPool = technoLibrary(120);
    const verifiedPool = contractPool.slice(0, 10);
    const safetyPool = contractPool.slice(0, 40);

    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: verifiedPool,
      preV3WorldSamplingApplied: true,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: contractPool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "hard_lock_verified");
    assert.deepEqual(resolved.inputPool, verifiedPool);
  });

  it("does not merge when pre-V3 world sampling was not applied", () => {
    const safetyPool = reggaeLibrary(17);
    const contractPool = reggaeLibrary(200);

    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: false,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: contractPool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "candidate_pool");
    assert.equal(resolved.inputPool.length, 17);
  });

  it("hard techno gym keeps verified override over merge when supply exists", () => {
    const prompt = "hard techno gym";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = technoLibrary(65);
    const classMap = classMapFor(library);
    const sampling = applyMusicalWorldPreV3Sampling({
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
    assert.equal(sampling.diagnostics.applied, true);

    const verified = library.slice(0, 5);
    const safetyPool = library.slice(0, 40);
    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: verified,
      preV3WorldSamplingApplied: true,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: sampling.pool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "hard_lock_verified");
    assert.deepEqual(resolved.inputPool, verified);
  });

  it("late night UK garage uses merge when verified override absent", () => {
    const prompt = "late night UK garage drive";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = ukgLibrary(70);
    const classMap = classMapFor(library);
    const safetyPool = library.slice(0, 10);
    const sampling = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: safetyPool,
      retrievalPool: library.slice(0, 55),
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 40,
      maxTarget: 180,
      contractEvidenceCount: 10,
    });

    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: sampling.diagnostics.applied,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: sampling.pool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "pre_v3_contract_universe_merge");
    assert.ok(resolved.inputPool.length > safetyPool.length);
    assert.ok(resolved.inputPool.length >= 40);
  });

  it("2000s pop punk gym uses merge when verified override absent", () => {
    const prompt = "2000s pop punk gym workout";
    const worldBoundary = resolveWorldBoundary({ prompt });
    const library = popPunkLibrary(60);
    const classMap = classMapFor(library);
    const safetyPool = library.slice(0, 19);
    const sampling = applyMusicalWorldPreV3Sampling({
      prompt,
      currentPool: safetyPool,
      retrievalPool: library.slice(0, 45),
      libraryPool: library,
      classMap,
      worldBoundary,
      minTarget: 35,
      maxTarget: 150,
      contractEvidenceCount: 19,
    });

    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: sampling.diagnostics.applied,
      retrievalSafetyExpanded: true,
      contractGuardedScoredPool: sampling.pool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });

    assert.equal(resolved.routingReason, "pre_v3_contract_universe_merge");
    assert.ok(resolved.inputPool.length > safetyPool.length);
    assert.ok(resolved.inputPool.length >= 35);
  });

  it("routes contract composition authority to expanded contractGuardedScoredPool", () => {
    const contractPool = [{ trackId: "a" }, { trackId: "b" }, { trackId: "c" }];
    const safetyPool = [{ trackId: "x" }];
    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: false,
      retrievalSafetyExpanded: true,
      contractCompositionEnabled: true,
      contractGuardedScoredPool: contractPool,
      safetyRetrievalPool: safetyPool,
      candidatePool: safetyPool,
      capContractPool: (pool) => pool,
      mergeUniverse: (primary, secondary) => mergeUniverse(primary, secondary),
    });
    assert.equal(resolved.routingReason, "contract_composition_universe");
    assert.equal(resolved.inputPool.length, 3);
  });

  it("prefers contract universe over empty candidate pool for preserve_both tension", () => {
    const contractPool = Array.from({ length: 40 }, (_, i) => ({ trackId: `c${i}` }));
    const resolved = resolveV3BuildInputPool({
      hardLockVerifiedCandidatePool: null,
      preV3WorldSamplingApplied: false,
      retrievalSafetyExpanded: false,
      contractCompositionEnabled: true,
      contractGuardedScoredPool: contractPool,
      safetyRetrievalPool: [],
      candidatePool: [],
      capContractPool: (pool) => pool.slice(0, 30),
      mergeUniverse: (primary, secondary) => [...primary, ...secondary],
    });
    assert.equal(resolved.routingReason, "contract_composition_universe");
    assert.equal(resolved.inputPool.length, 30);
  });
});
