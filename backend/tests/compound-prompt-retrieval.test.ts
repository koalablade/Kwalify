import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCompoundPrompt,
  parseCompoundPromptConstraints,
  scoreCompoundPromptFit,
} from "../lib/compound-prompt-retrieval";
import type { RetrievalTrackInput } from "../lib/candidate-retrieval-pipeline";
import { applyRetrievalTrackCooldown } from "../lib/playlist-freshness";

const emotionProfile = {
  energy: 0.72,
  valence: 0.62,
  tension: 0.3,
  nostalgia: 0.35,
  calm: 0.25,
  environment: null,
  timeOfDay: "evening" as const,
  motionState: null,
};

test("parseCompoundPromptConstraints detects latin summer party", () => {
  const constraints = parseCompoundPromptConstraints(
    "latin summer beach party reggaeton",
    { activity: "party" },
    emotionProfile,
  );
  assert.ok(constraints.genres.includes("latin"));
  assert.ok(constraints.sceneTags.includes("party"));
});

test("scoreCompoundPromptFit rewards latin genre evidence", () => {
  const constraints = parseCompoundPromptConstraints(
    "latin summer beach party",
    { activity: "party", primaryGenres: ["latin"] },
    emotionProfile,
  );
  const classMap = new Map([
    ["latin", { genrePrimary: "latin", genreFamily: "latin", primarySubgenre: "reggaeton", secondarySubgenre: null, subGenres: [] }],
    ["pop", { genrePrimary: "pop", genreFamily: "pop", primarySubgenre: "dance_pop", secondarySubgenre: null, subGenres: [] }],
  ]);
  const latinTrack: RetrievalTrackInput = {
    trackId: "latin",
    trackName: "Baila Reggaeton",
    artistName: "Latin Artist",
    albumName: "Summer",
    energy: 0.78,
    valence: 0.72,
    tempo: 102,
    danceability: 0.82,
    acousticness: 0.1,
    instrumentalness: 0.01,
    speechiness: 0.08,
    popularity: 55,
    releaseYear: 2019,
  };
  const popTrack: RetrievalTrackInput = {
    ...latinTrack,
    trackId: "pop",
    trackName: "Generic Pop",
    artistName: "Pop Artist",
    releaseYear: 2019,
    energy: 0.78,
    danceability: 0.82,
  };
  const latinScore = scoreCompoundPromptFit(latinTrack, classMap.get("latin") ?? null, constraints, "latin summer beach party", emotionProfile);
  const popScore = scoreCompoundPromptFit(popTrack, classMap.get("pop") ?? null, constraints, "latin summer beach party", emotionProfile);
  assert.ok(latinScore > popScore);
});

test("parseCompoundPromptConstraints detects era + genre + activity", () => {
  const constraints = parseCompoundPromptConstraints(
    "70s disco party dancefloor",
    { activity: "party", genreFamilies: ["soul"] },
    emotionProfile,
  );
  assert.ok(isCompoundPrompt(constraints));
  assert.ok(constraints.era);
  assert.ok(constraints.genres.includes("soul"));
  assert.equal(constraints.activity, "party");
});

test("scoreCompoundPromptFit rewards era and genre together", () => {
  const constraints = parseCompoundPromptConstraints(
    "2000s pop punk gym workout",
    { activity: "gym", primaryGenres: ["rock"] },
    { ...emotionProfile, energy: 0.85 },
  );
  const classMap = new Map([
    ["a", { genrePrimary: "pop_punk", genreFamily: "rock", primarySubgenre: "pop_punk", secondarySubgenre: null, subGenres: [] }],
  ]);
  const good: RetrievalTrackInput = {
    trackId: "a",
    trackName: "All The Small Things",
    artistName: "Blink-182",
    albumName: "Album",
    energy: 0.86,
    valence: 0.7,
    tempo: 148,
    danceability: 0.62,
    acousticness: 0.08,
    instrumentalness: 0.01,
    speechiness: 0.05,
    popularity: 78,
    releaseYear: 1999,
  };
  const weak: RetrievalTrackInput = {
    ...good,
    trackId: "b",
    releaseYear: 2018,
    energy: 0.42,
    tempo: 92,
  };
  const goodScore = scoreCompoundPromptFit(good, classMap.get("a") ?? null, constraints, "2000s pop punk gym workout", emotionProfile);
  const weakScore = scoreCompoundPromptFit(weak, classMap.get("a") ?? null, constraints, "2000s pop punk gym workout", emotionProfile);
  assert.ok(goodScore > weakScore);
});

test("applyRetrievalTrackCooldown downranks recently used tracks", () => {
  const fresh = applyRetrievalTrackCooldown(0.8, undefined);
  const cooled = applyRetrievalTrackCooldown(0.8, 0.55);
  assert.ok(cooled < fresh);
  assert.ok(cooled >= 0.28);
});
