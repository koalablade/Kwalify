import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeLibraryCapability,
  electHumanOpener,
  evaluateCandidateSufficiency,
  orchestratePlaylistRetrieval,
  selectRetrievalStrategy,
} from "../lib/playlist-retrieval-orchestrator";
import type { RetrievalTrackInput } from "../lib/candidate-retrieval-pipeline";

function track(
  id: string,
  overrides: Partial<RetrievalTrackInput> = {},
): RetrievalTrackInput {
  return {
    trackId: id,
    trackName: `Track ${id}`,
    artistName: `Artist ${id}`,
    albumName: "Album",
    energy: 0.5,
    valence: 0.5,
    tempo: 110,
    danceability: 0.5,
    acousticness: 0.3,
    instrumentalness: 0.2,
    speechiness: 0.05,
    popularity: 50,
    ...overrides,
  };
}

const classMap = new Map([
  ["focus-1", { genrePrimary: "ambient", genreFamily: "electronic", primarySubgenre: "ambient", secondarySubgenre: null, subGenres: [] }],
  ["focus-2", { genrePrimary: "classical", genreFamily: "classical", primarySubgenre: "piano", secondarySubgenre: null, subGenres: [] }],
  ["gym-1", { genrePrimary: "hip_hop", genreFamily: "hip_hop", primarySubgenre: "rap", secondarySubgenre: null, subGenres: [] }],
]);

test("analyzeLibraryCapability scores functional pools", () => {
  const focusTracks = Array.from({ length: 60 }, (_, i) =>
    track(`focus-${i % 2 === 0 ? 1 : 2}`, {
      energy: 0.28,
      tempo: 90,
      instrumentalness: 0.7,
      speechiness: 0.04,
    }),
  );
  const capability = analyzeLibraryCapability({
    tracks: focusTracks,
    vibe: "focus coding deep work",
    intent: { activity: "focus" },
    emotionProfile: { energy: 0.3, valence: 0.5, tension: 0.2, nostalgia: 0.2, calm: 0.7, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
  });
  assert.ok(capability.score >= 45);
  assert.ok(capability.activityScore >= 40);
});

test("selectRetrievalStrategy never auto-selects discovery mode", () => {
  const plan = selectRetrievalStrategy(
    { score: 20, activityScore: 15, genreScore: 10, energyScore: 12, sonicScore: 10, promptFitScore: 12, openerScore: 8, diversityScore: 30, limitingFactors: ["low_activity_match"] },
    {
      activity: "gym",
      activityConfidence: 0.9,
      sceneTags: [],
      sceneConfidence: 0,
      emotionalIntent: [],
      genreExpectations: [],
      genreConfidence: 0,
      activityProfile: null,
      libraryGravityWeight: 0.12,
      highConfidenceActivity: true,
      sourceQuotas: {
        activity_match: 0.45,
        emotional_match: 0.12,
        genre_match: 0.22,
        favourite_artists: 0.05,
        exploratory: 0.16,
        forgotten_favourites: 0,
        sonic_match: 0,
      },
      dominantLibraryFamilies: [],
      ukHipHopScene: null,
      committedWorldId: null,
    },
    { functionalPrompt: true },
  );
  assert.notEqual(plan.strategy, "D_spotify_catalogue");
});

test("orchestratePlaylistRetrieval fails gracefully for insufficient gym library", () => {
  const weakGym = Array.from({ length: 80 }, (_, i) =>
    track(`weak-${i}`, {
      energy: 0.2,
      tempo: 70,
      valence: 0.3,
      danceability: 0.2,
      acousticness: 0.8,
    }),
  );
  const result = orchestratePlaylistRetrieval({
    tracks: weakGym,
    vibe: "gym workout lifting cardio",
    intent: { activity: "gym" },
    emotionProfile: { energy: 0.82, valence: 0.7, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap: new Map(),
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: false,
    noLibraryMode: false,
  });
  assert.ok(result.failure);
  assert.equal(result.failure?.code, "LIBRARY_INSUFFICIENT_FOR_PROMPT");
  assert.ok(result.diagnostics.validCandidateSupply.relaxedValidCount < result.diagnostics.validCandidateSupply.minRequired);
});

test("orchestratePlaylistRetrieval proceeds when gym library has relaxed supply", () => {
  const mixedGym = Array.from({ length: 100 }, (_, i) =>
    track(`mix-${i}`, {
      energy: i < 40 ? 0.78 : 0.35,
      tempo: i < 40 ? 128 : 85,
      danceability: i < 40 ? 0.72 : 0.35,
    }),
  );
  const result = orchestratePlaylistRetrieval({
    tracks: mixedGym,
    vibe: "gym workout cardio pump",
    intent: { activity: "gym" },
    emotionProfile: { energy: 0.82, valence: 0.7, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap: new Map(),
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: false,
    noLibraryMode: false,
  });
  assert.equal(result.failure, undefined);
  assert.ok(result.tracks.length > 0);
  assert.ok(result.diagnostics.validCandidateSupply.relaxedValidCount >= result.diagnostics.validCandidateSupply.minRequired);
});

test("electHumanOpener prefers activity-fit opener", () => {
  const pool = [
    track("weak", { energy: 0.85, tempo: 140, popularity: 90 }),
    track("focus-1", { energy: 0.3, tempo: 95, instrumentalness: 0.8, speechiness: 0.03, popularity: 40 }),
    track("focus-2", { energy: 0.32, tempo: 100, instrumentalness: 0.75, speechiness: 0.04, popularity: 35 }),
  ];
  const opener = electHumanOpener(pool, {
    vibe: "focus coding",
    intent: { activity: "focus" },
    emotionProfile: { energy: 0.3, valence: 0.5, tension: 0.2, nostalgia: 0.2, calm: 0.7, environment: null, timeOfDay: null, motionState: null },
    classMap,
  });
  assert.ok(opener.trackId === "focus-1" || opener.trackId === "focus-2");
  assert.ok(opener.confidence > 0.4);
});

test("orchestratePlaylistRetrieval trusts retrieval pool over era-starved supply heuristics", () => {
  const classMap = new Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>();
  const artists = ["Taylor Swift", "Drake", "The Weeknd", "Ed Sheeran"];
  const library = Array.from({ length: 200 }, (_, i) => {
    const trackId = `disco-${i}`;
    classMap.set(trackId, {
      genrePrimary: "unknown",
      genreFamily: "unknown",
      primarySubgenre: "unknown",
      secondarySubgenre: null,
      subGenres: [],
    });
    return track(`disco-${i}`, {
      artistName: artists[i % artists.length]!,
      energy: 0.72,
      danceability: 0.68,
      releaseYear: 2018,
    });
  });
  const result = orchestratePlaylistRetrieval({
    tracks: library,
    vibe: "disco rooftop party 1978",
    intent: { activity: "party", mood: [], genreFamilies: [], primaryGenres: [] },
    emotionProfile: { energy: 0.8, valence: 0.75, tension: 0.2, nostalgia: 0.3, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap,
    requestedLength: 25,
    sceneActive: true,
    debugRetrieval: false,
    noLibraryMode: false,
  });
  assert.equal(result.failure, undefined, "should not discard a non-empty retrieval pool");
  assert.ok(result.tracks.length >= 25);
});

test("evaluateCandidateSufficiency scores weak gym pool low", () => {
  const weak = Array.from({ length: 40 }, (_, i) =>
    track(`w-${i}`, { energy: 0.15, tempo: 60, valence: 0.2 }),
  );
  const sufficiency = evaluateCandidateSufficiency(weak, {
    vibe: "gym workout",
    intent: { activity: "gym" },
    emotionProfile: { energy: 0.85, valence: 0.7, tension: 0.4, nostalgia: 0.2, calm: 0.1, environment: null, timeOfDay: null, motionState: null },
    classMap: new Map(),
  });
  assert.ok(sufficiency.score < 45);
});
