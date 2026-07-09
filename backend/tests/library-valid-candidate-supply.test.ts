import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estimateValidCandidateSupply,
  minRequiredValidCandidates,
  rankSupplyAwareRecoveryCandidates,
  trackPassesRecoveryActivity,
} from "../lib/library-valid-candidate-supply";
import type { RetrievalTrackInput } from "../lib/candidate-retrieval-pipeline";

function track(id: string, overrides: Partial<RetrievalTrackInput> = {}): RetrievalTrackInput {
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

const emotionProfile = {
  energy: 0.82,
  valence: 0.7,
  tension: 0.4,
  nostalgia: 0.2,
  calm: 0.1,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

test("minRequiredValidCandidates scales with playlist length", () => {
  assert.equal(minRequiredValidCandidates(25), 10);
  assert.equal(minRequiredValidCandidates(30), 12);
});

test("estimateValidCandidateSupply detects gym-capable library slices", () => {
  const gymTracks = Array.from({ length: 80 }, (_, i) =>
    track(`gym-${i}`, {
      energy: i % 3 === 0 ? 0.62 : 0.76,
      tempo: 128,
      danceability: 0.72,
      releaseYear: 2008,
    }),
  );
  const supply = estimateValidCandidateSupply({
    tracks: gymTracks,
    vibe: "2000s pop punk gym workout",
    intent: {
      activity: "gym",
      primaryGenres: ["rock"],
      eraRange: { start: 1998, end: 2012 },
    },
    emotionProfile,
    classMap: new Map(),
    requestedLength: 30,
  });
  assert.ok(supply.relaxedValidCount >= supply.minRequired);
  assert.ok(supply.recoveryValidCount >= supply.minRequired);
});

test("estimateValidCandidateSupply flags truly weak gym libraries", () => {
  const weak = Array.from({ length: 80 }, (_, i) =>
    track(`weak-${i}`, { energy: 0.18, tempo: 70, danceability: 0.2 }),
  );
  const supply = estimateValidCandidateSupply({
    tracks: weak,
    vibe: "gym workout lifting cardio",
    intent: { activity: "gym" },
    emotionProfile,
    classMap: new Map(),
    requestedLength: 25,
  });
  assert.equal(supply.sufficient, false);
  assert.ok(supply.limitingDimensions.includes("insufficient_relaxed_valid_candidates"));
});

test("trackPassesRecoveryActivity accepts moderate-energy gym tracks", () => {
  assert.equal(
    trackPassesRecoveryActivity(track("mid", { energy: 0.55, tempo: 112 }), { activity: "gym" }),
    true,
  );
});

test("rankSupplyAwareRecoveryCandidates prefers higher-energy gym tracks", () => {
  const ranked = rankSupplyAwareRecoveryCandidates(
    [
      { ...track("low", { energy: 0.5, tempo: 100 }), score: 0.9 },
      { ...track("high", { energy: 0.78, tempo: 132 }), score: 0.4 },
    ],
    {
      tracks: [],
      vibe: "gym workout",
      intent: { activity: "gym" },
      emotionProfile,
      classMap: new Map(),
      requestedLength: 25,
    },
  );
  assert.equal(ranked[0]?.trackId, "high");
});
