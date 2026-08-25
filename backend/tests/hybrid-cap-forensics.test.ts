import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyHybridCapDrop,
  countByDropReason,
  numericDistribution,
  intersectIds,
  setDiff,
} from "../lib/hybrid-cap-forensics";
import { capTracksForHybridScoring } from "../core/scoring-engine/scoring-pool-cap";
import type { TrackGenreClassification } from "../lib/genre-taxonomy";
import type { EmotionProfile } from "../lib/emotion";

const NEUTRAL = {
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.1,
  tempo: 110,
  labels: [],
} as unknown as EmotionProfile;

function classification(family: string): TrackGenreClassification {
  return {
    genreFamily: family,
    genrePrimary: family,
    primarySubgenre: family,
    secondarySubgenre: null,
    subGenres: [family],
    confidence: 1,
  } as unknown as TrackGenreClassification;
}

test("classifyHybridCapDrop distinguishes input miss from cap drop", () => {
  assert.equal(classifyHybridCapDrop({ inInput: false, survived: false }), "NOT_IN_HYBRID_INPUT");
  assert.equal(classifyHybridCapDrop({ inInput: true, survived: false }), "DROPPED_BY_HYBRID_CAP");
  assert.equal(classifyHybridCapDrop({ inInput: true, survived: true }), "SURVIVED_HYBRID_CAP");
});

test("hybrid-cap forensics does not change selected pool membership", () => {
  const tracks = Array.from({ length: 600 }, (_, i) => ({
    trackId: `id${String(i).padStart(4, "0")}xxxx`,
    trackName: `Track ${i}`,
    artistName: `Artist ${i % 40}`,
    albumName: "Album",
    energy: 0.4 + (i % 10) * 0.03,
    valence: 0.3 + (i % 7) * 0.04,
    acousticness: 0.2,
    releaseYear: 2000 + (i % 10),
  }));
  const classifications = new Map(
    tracks.map((t, i) => [t.trackId, classification(i % 3 === 0 ? "indie" : "pop")]),
  );
  const watch = new Set(tracks.slice(0, 20).map((t) => t.trackId));

  const without = capTracksForHybridScoring(tracks, {
    emotionProfile: NEUTRAL,
    vibeKind: "neutral" as never,
    classifications,
    librarySize: tracks.length,
    vibe: "2000s indie",
    promptWordCount: 2,
    seedMs: 42,
  });
  const withForensics = capTracksForHybridScoring(tracks, {
    emotionProfile: NEUTRAL,
    vibeKind: "neutral" as never,
    classifications,
    librarySize: tracks.length,
    vibe: "2000s indie",
    promptWordCount: 2,
    seedMs: 42,
    forensicsWatchIds: watch,
  });

  assert.equal(without.pool.length, withForensics.pool.length);
  assert.deepEqual(
    without.pool.map((t) => t.trackId),
    withForensics.pool.map((t) => t.trackId),
  );
  assert.equal(without.poolCapped, withForensics.poolCapped);
  assert.ok(withForensics.forensics);
  assert.equal(withForensics.forensics?.observational, true);
  assert.equal(withForensics.forensics?.watchIdsRequested, 20);
  assert.equal(withForensics.forensics?.compoundPrompt, true);
  assert.deepEqual(withForensics.forensics?.explicitEra, { start: 2000, end: 2009 });
  assert.ok((withForensics.forensics?.explicitFamilies ?? []).includes("indie"));
});

test("numericDistribution and set helpers are selection-neutral", () => {
  assert.deepEqual(numericDistribution([]).n, 0);
  assert.equal(numericDistribution([1, 2, 3, 4]).median, 2.5);
  assert.deepEqual(intersectIds(["a", "b"], ["b", "c"]), ["b"]);
  assert.deepEqual(setDiff(["a", "b"], ["b"]), ["a"]);
  assert.deepEqual(
    countByDropReason([{ dropReason: "DROPPED_BY_HYBRID_CAP" }, { dropReason: "DROPPED_BY_HYBRID_CAP" }]),
    { DROPPED_BY_HYBRID_CAP: 2 },
  );
});
