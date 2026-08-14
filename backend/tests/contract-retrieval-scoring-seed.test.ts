/**
 * V41 — contract retrieval preservation through hybrid scoring and post-score seeding.
 * Run: npm run build && node --test backend/dist/tests/contract-retrieval-scoring-seed.test.js
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ContractCompositionMeta } from "../core/playlist-contract/contract-composition-types";
import {
  buildContractMetaLookup,
  mergeContractRetrievalUniverse,
  seedContractRetrievalIntoScoredPool,
} from "../core/playlist-contract/contract-retrieval-scoring-seed";
import type { PlaylistContract } from "../core/playlist-contract/types";
import { capTracksForHybridScoring } from "../core/scoring-engine/scoring-pool-cap";
import type { ScoredLibraryTrack } from "../core/scoring-engine/types";
import { classifyTrack } from "../lib/genre-taxonomy";

function tensionContract(axes: [string, string]): PlaylistContract {
  return {
    version: "playlist-contract-v1",
    prompt: "synthetic tension",
    must: { genres: [], eras: [], activities: [] },
    prefer: { energy: [], moods: [], scenes: [] },
    mustNot: [],
    context: { activity: null, scene: null, setting: null, timeOfDay: null },
    tension: [
      {
        axes,
        description: "preserve both axes",
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
    buildSignature: "seed-test",
  };
}

type SeedTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  tempo: number | null;
  acousticness: number | null;
  contractCompositionMeta?: ContractCompositionMeta;
};

function scored(track: SeedTrack, score: number): ScoredLibraryTrack<SeedTrack> {
  return {
    ...track,
    score,
    rediscoveryScore: 0,
    scoringDebug: {
      trackId: track.trackId,
      sceneScore: score,
      libraryFitScore: score,
      genreBalanceScore: 0.5,
      sceneMatch: 0.5,
      emotionMatch: 0.5,
      genreMatch: 0.5,
      memoryMatch: 0.5,
      noveltyScore: 0,
      seasonalMatch: 0.5,
      moodPurity: 0.5,
      genrePrimary: "pop",
      genreConfidence: 0.5,
      genreLocked: false,
      excludedBy: null,
      finalScore: score,
    },
  };
}

test("capTracksForHybridScoring preserves contract retrieval pool without emotion trim", () => {
  const tracks = Array.from({ length: 280 }, (_, i) => ({
    trackId: `t-${i}`,
    trackName: `Track ${i}`,
    artistName: `Artist ${i}`,
    albumName: "Album",
    energy: i % 3 === 0 ? 0.82 : 0.35,
    valence: 0.5,
    tempo: 120,
    danceability: i % 3 === 0 ? 0.72 : 0.4,
    acousticness: 0.2,
  }));

  const capped = capTracksForHybridScoring(tracks, {
    emotionProfile: {
      energy: 0.25,
      valence: 0.35,
      tension: 0.4,
      nostalgia: 0.2,
      calm: 0.5,
      environment: null,
      timeOfDay: null,
      motionState: null,
    },
    vibeKind: "neutral",
    classifications: new Map(),
    librarySize: tracks.length,
    vibe: "sad party bangers",
    promptWordCount: 3,
    preserveContractRetrievalPool: true,
  });

  assert.equal(capped.poolCapped, false);
  assert.equal(capped.pool.length, 280);
  assert.equal(capped.intentPreservedCount, 280);
});

test("seedContractRetrievalIntoScoredPool prepends missing contract tracks with axis meta", () => {
  const contract = tensionContract(["party_energy", "melancholy"]);
  const classMap = new Map([
    ["party-sad-1", classifyTrack({
      trackName: "Party Sad",
      artistName: "Artist A",
      albumName: "Album",
      energy: 0.78,
      valence: 0.28,
    })],
  ]);

  const highEnergySad: SeedTrack = {
    trackId: "party-sad-1",
    trackName: "Party Sad",
    artistName: "Artist A",
    albumName: "Album",
    energy: 0.78,
    valence: 0.28,
    danceability: 0.68,
    tempo: 128,
    acousticness: 0.12,
    contractCompositionMeta: {
      contractScore: 0.72,
      admissible: true,
      axisScores: { party_energy: 0.82, melancholy: 0.71 },
      axesActive: ["party_energy", "melancholy"],
      intersectionStrength: 0.76,
      mustMatches: [],
      preferMatches: [],
      violations: [],
    },
  };

  const lowEnergyIndie = scored(
    {
      trackId: "indie-1",
      trackName: "Indie",
      artistName: "Artist B",
      albumName: "Album",
      energy: 0.32,
      valence: 0.55,
      danceability: 0.4,
      tempo: 98,
      acousticness: 0.72,
    },
    0.95,
  );

  const scoring = {
    sorted: [lowEnergyIndie],
    scored: [lowEnergyIndie],
  };

  const diagnostics = seedContractRetrievalIntoScoredPool(
    scoring,
    [highEnergySad],
    contract,
    classMap,
  );

  assert.equal(diagnostics.retrievalPoolCount, 1);
  assert.equal(diagnostics.seededNew, 1);
  assert.equal(diagnostics.admissibleCount, 1);
  assert.equal(scoring.sorted.length, 2);
  assert.equal(scoring.sorted[0]?.trackId, "party-sad-1");
  assert.ok((scoring.sorted[0]?.contractCompositionMeta?.axisScores.party_energy ?? 0) >= 0.42);
  assert.ok((diagnostics.dimensionCoverage.party_energy ?? 0) >= 1);
});

test("seedContractRetrievalIntoScoredPool keeps enriched tracks ahead of emotion-ranked remainder", () => {
  const contract = tensionContract(["high_energy", "not_cheesy"]);
  const classMap = new Map([
    ["energetic-1", classifyTrack({
      trackName: "Energetic",
      artistName: "Artist C",
      albumName: "Album",
      energy: 0.81,
      valence: 0.58,
    })],
  ]);

  const contractTrack: SeedTrack = {
    trackId: "energetic-1",
    trackName: "Energetic",
    artistName: "Artist C",
    albumName: "Album",
    energy: 0.81,
    valence: 0.58,
    danceability: 0.62,
    tempo: 132,
    acousticness: 0.08,
    contractCompositionMeta: {
      contractScore: 0.7,
      admissible: true,
      axisScores: { high_energy: 0.84, not_cheesy: 0.66 },
      axesActive: ["high_energy", "not_cheesy"],
      intersectionStrength: 0.74,
      mustMatches: [],
      preferMatches: [],
      violations: [],
    },
  };

  const filler = Array.from({ length: 5 }, (_, i) =>
    scored(
      {
        trackId: `filler-${i}`,
        trackName: `Filler ${i}`,
        artistName: `Artist ${i}`,
        albumName: "Album",
        energy: 0.25,
        valence: 0.7,
        danceability: 0.35,
        tempo: 90,
        acousticness: 0.8,
      },
      0.9 - i * 0.01,
    ),
  );

  const scoring = { sorted: [...filler], scored: [...filler] };
  seedContractRetrievalIntoScoredPool(scoring, [contractTrack], contract, classMap);

  assert.equal(scoring.sorted[0]?.trackId, "energetic-1");
  assert.ok(scoring.sorted.some((t) => t.trackId === "energetic-1"));
  assert.ok(
    scoring.sorted.filter((t) => (t.contractCompositionMeta?.axisScores.high_energy ?? 0) >= 0.42).length >= 1,
  );
});

test("mergeContractRetrievalUniverse preserves V40 axis meta on scored shapes", () => {
  const contract = tensionContract(["party_energy", "melancholy"]);
  const v40Meta = {
    contractScore: 0.72,
    admissible: true,
    axisScores: { party_energy: 0.82, melancholy: 0.71 },
    axesActive: ["party_energy", "melancholy"],
    intersectionStrength: 0.76,
    mustMatches: [] as string[],
    preferMatches: [] as string[],
    violations: [] as string[],
  };
  const retrievalTrack: SeedTrack = {
    trackId: "party-sad-1",
    trackName: "Party Sad",
    artistName: "Artist A",
    albumName: "Album",
    energy: 0.78,
    valence: 0.28,
    danceability: 0.68,
    tempo: 128,
    acousticness: 0.12,
    contractCompositionMeta: v40Meta,
  };
  const emotionRanked = scored(
    {
      trackId: "party-sad-1",
      trackName: "Party Sad",
      artistName: "Artist A",
      albumName: "Album",
      energy: 0.78,
      valence: 0.28,
      danceability: 0.68,
      tempo: 128,
      acousticness: 0.12,
    },
    0.12,
  );
  delete emotionRanked.contractCompositionMeta;

  const merged = mergeContractRetrievalUniverse([emotionRanked], [retrievalTrack as SeedTrack & typeof emotionRanked]);
  assert.equal(merged.length, 1);
  assert.ok((merged[0]?.contractCompositionMeta?.axisScores.party_energy ?? 0) >= 0.42);

  const lookup = buildContractMetaLookup([retrievalTrack]);
  assert.ok((lookup.get("party-sad-1")?.axisScores.party_energy ?? 0) >= 0.42);
});
