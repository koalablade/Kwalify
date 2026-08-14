/**
 * V41 contract composition selection — synthetic axis coverage tests.
 * Run: npm run build && node --test backend/dist/tests/contract-composition-select.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ContractCompositionMeta } from "../core/playlist-contract/contract-composition-types";
import type { PlaylistContract } from "../core/playlist-contract/types";
import {
  marginalContractValue,
  rebalancePlaylistForContractCoverage,
  selectContractCoveragePreservingPool,
} from "../core/playlist-contract/contract-composition-select";

function syntheticContract(): PlaylistContract {
  return {
    version: "playlist-contract-v1",
    prompt: "synthetic tension probe",
    must: { genres: [], eras: [], activities: [] },
    prefer: { energy: [], moods: [], scenes: [] },
    mustNot: [],
    context: { activity: null, scene: null, setting: null, timeOfDay: null },
    tension: [
      {
        axes: ["axisA", "axisB"],
        description: "preserve axisA and axisB",
        resolution: "preserve_both",
      },
    ],
    unknown: { tokens: [], dimensions: [] },
    worldHypothesis: {
      id: null,
      hardLock: false,
      confidence: 0.4,
      source: "synthetic",
    },
    confidence: { overall: 0.7, dimensions: {} },
    buildSignature: "synthetic-test",
  };
}

function meta(partial: Partial<ContractCompositionMeta>): ContractCompositionMeta {
  return {
    contractScore: 0.6,
    admissible: true,
    axisScores: { axisA: 0.2, axisB: 0.2 },
    axesActive: [],
    intersectionStrength: 0.2,
    mustMatches: [],
    preferMatches: [],
    violations: [],
    ...partial,
  };
}

type SyntheticTrack = {
  trackId: string;
  artistName: string;
  contractCompositionMeta?: ContractCompositionMeta;
};

function track(id: string, artist: string, compositionMeta: ContractCompositionMeta): SyntheticTrack {
  return { trackId: id, artistName: artist, contractCompositionMeta: compositionMeta };
}

test("selectContractCoveragePreservingPool reserves intersection and axis coverage", () => {
  const contract = syntheticContract();
  const pool: SyntheticTrack[] = [
    track("a-only-1", "artist-a", meta({ axisScores: { axisA: 0.85, axisB: 0.1 }, intersectionStrength: 0.05 })),
    track("a-only-2", "artist-b", meta({ axisScores: { axisA: 0.8, axisB: 0.12 }, intersectionStrength: 0.08 })),
    track("b-only-1", "artist-c", meta({ axisScores: { axisA: 0.1, axisB: 0.82 }, intersectionStrength: 0.06 })),
    track("b-only-2", "artist-d", meta({ axisScores: { axisA: 0.15, axisB: 0.78 }, intersectionStrength: 0.07 })),
    track("both-1", "artist-e", meta({ axisScores: { axisA: 0.72, axisB: 0.68 }, intersectionStrength: 0.7 })),
    track("both-2", "artist-f", meta({ axisScores: { axisA: 0.66, axisB: 0.64 }, intersectionStrength: 0.62 })),
    track("weak-1", "artist-g", meta({ axisScores: { axisA: 0.25, axisB: 0.22 }, intersectionStrength: 0.1, admissible: false })),
  ];

  const { tracks, diagnostics } = selectContractCoveragePreservingPool(pool, contract, 6);

  assert.equal(tracks.length, 6);
  assert.ok(tracks.some((t) => t.trackId.startsWith("both-")));
  assert.ok(tracks.filter((t) => (t.contractCompositionMeta?.axisScores.axisA ?? 0) >= 0.42).length >= 2);
  assert.ok(tracks.filter((t) => (t.contractCompositionMeta?.axisScores.axisB ?? 0) >= 0.42).length >= 2);
  assert.ok((diagnostics.intersectionCandidates ?? 0) >= 1);
  assert.deepEqual(diagnostics.requiredDimensions.sort(), ["axisA", "axisB"]);
});

test("marginalContractValue prefers under-covered dimensions", () => {
  const contract = syntheticContract();
  const covered = new Map<string, number>([
    ["axisA", 4],
    ["axisB", 0],
    ["__intersection", 0],
  ]);
  const axisBMeta = meta({
    axisScores: { axisA: 0.2, axisB: 0.75 },
    intersectionStrength: 0.15,
    axesActive: ["axisB"],
  });
  const intersectionMeta = meta({
    axisScores: { axisA: 0.7, axisB: 0.68 },
    intersectionStrength: 0.72,
    axesActive: ["axisA", "axisB"],
  });
  const axisBValue = marginalContractValue(axisBMeta, contract, covered, 20);
  const intersectionValue = marginalContractValue(intersectionMeta, contract, covered, 20);
  assert.ok(axisBValue > 0);
  assert.ok(intersectionValue > axisBValue);
});

test("rebalancePlaylistForContractCoverage increases intersection coverage", () => {
  const contract = syntheticContract();
  const pool: SyntheticTrack[] = [
    track("a-1", "artist-a", meta({ axisScores: { axisA: 0.9, axisB: 0.1 }, intersectionStrength: 0.05 })),
    track("a-2", "artist-b", meta({ axisScores: { axisA: 0.88, axisB: 0.08 }, intersectionStrength: 0.04 })),
    track("b-1", "artist-c", meta({ axisScores: { axisA: 0.1, axisB: 0.9 }, intersectionStrength: 0.05 })),
    track("both-1", "artist-d", meta({ axisScores: { axisA: 0.7, axisB: 0.68 }, intersectionStrength: 0.72 })),
    track("both-2", "artist-e", meta({ axisScores: { axisA: 0.66, axisB: 0.64 }, intersectionStrength: 0.65 })),
  ];
  const collapsed = pool.filter((t) => t.trackId.startsWith("a-"));

  const { tracks, diagnostics } = rebalancePlaylistForContractCoverage(
    collapsed,
    pool,
    contract,
    4,
    2,
  );

  assert.equal(tracks.length, 4);
  assert.equal((diagnostics as { rebalanced?: boolean }).rebalanced, true);
  assert.ok(
    tracks.filter((t) => (t.contractCompositionMeta?.intersectionStrength ?? 0) >= 0.32).length >= 1,
  );
});

test("rebalancePlaylistForContractCoverage injects missing axis when V3 output is single-sided", () => {
  const contract: PlaylistContract = {
    ...syntheticContract(),
    tension: [
      {
        axes: ["party_energy", "melancholy"],
        description: "preserve party_energy and melancholy",
        resolution: "preserve_both",
      },
    ],
  };
  const pool: SyntheticTrack[] = [
    ...Array.from({ length: 8 }, (_, i) =>
      track(`sad-${i}`, `sad-artist-${i}`, meta({
        axisScores: { party_energy: 0.1, melancholy: 0.88 },
        axesActive: ["melancholy"],
        intersectionStrength: 0.05,
      })),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      track(`party-${i}`, `party-artist-${i}`, meta({
        axisScores: { party_energy: 0.82, melancholy: 0.12 },
        axesActive: ["party_energy"],
        intersectionStrength: 0.06,
      })),
    ),
    track("both-1", "both-artist-1", meta({
      axisScores: { party_energy: 0.7, melancholy: 0.68 },
      axesActive: ["party_energy", "melancholy"],
      intersectionStrength: 0.72,
    })),
  ];
  const v3Collapsed = pool.filter((t) => t.trackId.startsWith("sad-"));

  const { tracks, diagnostics } = rebalancePlaylistForContractCoverage(
    v3Collapsed,
    pool,
    contract,
    10,
    2,
  );

  const dimCoverage = (diagnostics as { dimensionCoverage?: Record<string, number> }).dimensionCoverage ?? {};
  assert.ok((dimCoverage.party_energy ?? 0) >= 2, "party_energy should appear in final rebalance");
  assert.ok((dimCoverage.melancholy ?? 0) >= 2, "melancholy should remain represented");
  assert.ok(
    tracks.filter((t) => (t.contractCompositionMeta?.axisScores.party_energy ?? 0) >= 0.42).length >= 2,
  );
});
