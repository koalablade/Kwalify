import test from "node:test";
import assert from "node:assert/strict";
import { applyPostScoreModifiers } from "../core/scoring-engine/post-score-modifiers";
import { REFINE_AFTER_HYBRID_SCALE } from "../core/scoring-engine/post-score-modifiers";
import { summarizeScoreChannels, buildRecoveryScoreBreakdown } from "../core/scoring-engine/score-breakdown";
import { buildFreshnessStats } from "../lib/playlist-freshness";
import { rediscoveryScoreBoost, MAX_REDISCOVERY_SCORE_BOOST } from "../lib/forgotten-favourites";
import { refineSongScore } from "../lib/emotion";
import {
  buildQueryEmbedding,
  buildIntentConditionedQueryEmbedding,
  cosineSimilarity,
  buildTrackEmbedding,
} from "../shared/embeddings/track-embeddings";
import { SCORING_WEIGHTS } from "../core/genre-intelligence/genre-constraints";
import type { EmotionProfile } from "../lib/emotion";
import type { SemanticSceneVector } from "../lib/semantic-scene-engine";
import type { LibrarySignals } from "../lib/library-signals";

const calmProfile: EmotionProfile = {
  energy: 0.35,
  valence: 0.4,
  calm: 0.7,
  nostalgia: 0.2,
  tension: 0.1,
  timeOfDay: "late_night",
  environment: "indoor",
  motionState: null,
};

const song = {
  trackId: "repeat-track",
  artistName: "Laurindo Almeida",
  albumName: "Album",
  trackName: "The Lamp Is Low",
  energy: 0.32,
  valence: 0.38,
  tempo: 90,
  danceability: 0.35,
  acousticness: 0.72,
};

const hybridDebug = {
  trackId: song.trackId,
  sceneScore: 0.5,
  libraryFitScore: 0.4,
  genreBalanceScore: 0.3,
  sceneMatch: 0.5,
  emotionMatch: 0.7,
  genreMatch: 0.3,
  memoryMatch: 0.4,
  noveltyScore: 0.2,
  seasonalMatch: 0.5,
  moodPurity: 0.6,
  genrePrimary: "jazz",
  genreConfidence: 0.6,
  genreLocked: false,
  excludedBy: null,
  finalScore: 0.7,
  embeddingSimilarity: 0.82,
  hybridChannelEmbedding: 0.49,
  hybridChannelUserTaste: 0.06,
  hybridChannelNovelty: 0.02,
  hybridChannelEmotion: 0.07,
  hybridChannelScene: 0.025,
};

const emptySignals = {
  tracks: new Map(),
  artistPlaylistCounts: new Map(),
  artistLibraryCounts: new Map(),
  recentJourneyArcs: [],
  playlistsScanned: 0,
} satisfies LibrarySignals;

test("refineSongScore runs before novelty penalty (penalty is not undone by refine)", () => {
  const stats = buildFreshnessStats([
    { vibe: "focus", trackIds: [song.trackId] },
    { vibe: "study", trackIds: [song.trackId] },
  ]);
  const [scored] = applyPostScoreModifiers({
    hybridResults: [{ track: song, score: 0.7, debug: hybridDebug, passed: true }],
    referenceFingerprint: null,
    mode: "balanced",
    memoryWeight: 0.3,
    librarySignals: emptySignals,
    emotionProfile: calmProfile,
    rediscoveryMode: "balanced",
    archaeology: null,
    chapterMatch: null,
    startMs: 42,
    promptConfidenceMultiplier: 1,
    journeyArcMultiplier: 1,
    freshness: {
      stats,
      artistAppearances: new Map(),
      albumAppearances: new Map(),
      globalCloneMultiplier: 1,
    },
    vibe: "calm focus",
    crossPlaylistNovelty: {
      enabled: true,
      stats,
      previousPlaylistCount: 2,
    },
  });

  assert.ok(scored!.scoreBreakdown);
  assert.ok(scored!.scoreBreakdown!.refineAdjust !== 0 || scored!.scoreBreakdown!.noveltyPenalty > 0);
  assert.ok(scored!.scoreBreakdown!.noveltyPenalty > 0);
  const channels = summarizeScoreChannels(scored!.scoreBreakdown!);
  assert.ok(channels.embedding > 0);
  assert.ok(channels.emotion > 0);
  assert.ok(channels.novelty < 0);
  assert.equal(channels.final, scored!.scoreBreakdown!.finalScore);
  const withoutNovelty = scored!.scoreBreakdown!.hybridBase
    + scored!.scoreBreakdown!.refineAdjust
    + scored!.scoreBreakdown!.rediscoveryBoost;
  assert.ok(scored!.score < withoutNovelty + 0.01);
});

test("scoreChannels summary exposes measured hybrid and post-hybrid contributions", () => {
  const summary = summarizeScoreChannels({
    hybridBase: 0.7,
    hybridEmbedding: 0.42,
    hybridUserTaste: 0.11,
    hybridNovelty: 0.07,
    hybridEmotion: 0.07,
    hybridScene: 0.03,
    rediscoveryBoost: 0.12,
    refineAdjust: 0.05,
    freshnessMultiplier: 0.96,
    noveltyPenalty: 0.09,
    contextualPenalty: 0,
    finalScore: 0.83,
  });
  assert.equal(summary.embedding, 0.42);
  assert.equal(summary.userTaste, 0.11);
  assert.equal(summary.rediscovery, 0.12);
  assert.equal(summary.refine, 0.05);
  assert.equal(summary.novelty, -0.09);
  assert.equal(summary.final, 0.83);
});

test("Stage 3 rebalance weights reduce embedding dominance", () => {
  assert.equal(SCORING_WEIGHTS.semantic, 0.5);
  assert.equal(SCORING_WEIGHTS.emotion, 0.15);
  assert.equal(SCORING_WEIGHTS.scene, 0.1);
});

test("rediscovery boost is capped", () => {
  const boost = rediscoveryScoreBoost(1, 1, "deep_cuts");
  assert.ok(boost <= MAX_REDISCOVERY_SCORE_BOOST);
  assert.equal(MAX_REDISCOVERY_SCORE_BOOST, 0.15);
});

test("refineSongScore scales when hybrid already scored emotion", () => {
  const song = {
    energy: 0.85,
    valence: 0.85,
    danceability: 0.8,
    acousticness: 0.1,
    tempo: 128,
  };
  const profile: EmotionProfile = {
    energy: 0.85,
    valence: 0.85,
    calm: 0.2,
    nostalgia: 0.1,
    tension: 0.2,
    timeOfDay: "evening",
    environment: "indoor",
    motionState: null,
  };
  const full = refineSongScore(0.8, song, profile);
  const scaled = refineSongScore(0.8, song, profile, { moodAdjustScale: REFINE_AFTER_HYBRID_SCALE });
  assert.ok(Math.abs(scaled - 0.8) < Math.abs(full - 0.8));
});

test("intent-conditioned query embedding differs from raw emotion query", () => {
  const profile: EmotionProfile = {
    energy: 0.35,
    valence: 0.4,
    calm: 0.7,
    nostalgia: 0.2,
    tension: 0.1,
    timeOfDay: "late_night",
    environment: "indoor",
    motionState: null,
  };
  const scene: SemanticSceneVector = {
    id: "GYM_BEAST",
    label: "Gym",
    emotions: ["energised"],
    energy: { min: 0.7, max: 0.95, target: 0.88 },
    genreEcosystem: [{ genre: "rock", weight: 0.5 }],
    ecosystemFloor: 0.7,
    antiGenres: [],
    aesthetics: ["uplifting"],
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.2, otherMax: 0.1 },
    flowPhases: { intro: "", core: "", peak: "", cooldown: "" },
  };
  const raw = buildQueryEmbedding(profile);
  const conditioned = buildIntentConditionedQueryEmbedding(profile, scene);
  assert.notDeepEqual(raw, conditioned);
  const track = buildTrackEmbedding({ energy: 0.9, valence: 0.7, danceability: 0.7, acousticness: 0.1, tempo: 140 });
  assert.ok(cosineSimilarity(track, conditioned) !== cosineSimilarity(track, raw));
});

test("recovery score breakdown tags unattributed filler tracks", () => {
  const breakdown = buildRecoveryScoreBreakdown(0.7);
  assert.equal(breakdown.hybridEmbedding, 0);
  assert.equal(breakdown.finalScore, 0.7);
  const channels = summarizeScoreChannels(breakdown);
  assert.equal(channels.embedding, 0);
  assert.equal(channels.final, 0.7);
  assert.equal(breakdown.attributionSource, "recovery");
});

test("primary path tags attributionSource on scoreBreakdown", () => {
  const [scored] = applyPostScoreModifiers({
    hybridResults: [{ track: song, score: 0.7, debug: hybridDebug, passed: true }],
    referenceFingerprint: null,
    mode: "balanced",
    memoryWeight: 0.3,
    librarySignals: emptySignals,
    emotionProfile: calmProfile,
    rediscoveryMode: "balanced",
    archaeology: null,
    chapterMatch: null,
    startMs: 42,
    promptConfidenceMultiplier: 1,
    journeyArcMultiplier: 1,
    freshness: {
      stats: buildFreshnessStats([]),
      artistAppearances: new Map(),
      albumAppearances: new Map(),
      globalCloneMultiplier: 1,
    },
    vibe: "calm focus",
  });
  assert.equal(scored!.scoreBreakdown?.attributionSource, "primary");
  assert.equal(summarizeScoreChannels(scored!.scoreBreakdown!).attributionSource, "primary");
});

test("rediscovery boost uses emotionMatch not full hybrid score", () => {
  const highEmbeddingDebug = { ...hybridDebug, emotionMatch: 0.55, embeddingSimilarity: 0.95, hybridChannelEmbedding: 0.58 };
  const lowEmbeddingDebug = { ...hybridDebug, emotionMatch: 0.55, embeddingSimilarity: 0.2, hybridChannelEmbedding: 0.12 };
  const signal = {
    trackId: song.trackId,
    artistKey: "laurindo almeida",
    albumKey: "album",
    dateLiked: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    lastSurfacedAt: null,
    daysSinceSurfaced: 90,
    playlistAppearances: 0,
    artistPlaylistAppearances: 0,
    artistLibraryCount: 1,
    artistUnderused: true,
  };
  const librarySignals = {
    ...emptySignals,
    tracks: new Map([[song.trackId, signal]]),
  };
  const baseInput = {
    referenceFingerprint: null,
    mode: "balanced" as const,
    memoryWeight: 0.3,
    librarySignals,
    emotionProfile: calmProfile,
    rediscoveryMode: "balanced" as const,
    archaeology: null,
    chapterMatch: null,
    startMs: 42,
    promptConfidenceMultiplier: 1,
    journeyArcMultiplier: 1,
    freshness: {
      stats: buildFreshnessStats([]),
      artistAppearances: new Map(),
      albumAppearances: new Map(),
      globalCloneMultiplier: 1,
    },
    vibe: "calm focus",
  };
  const [highEmb] = applyPostScoreModifiers({
    ...baseInput,
    hybridResults: [{ track: song, score: 0.92, debug: highEmbeddingDebug, passed: true }],
  });
  const [lowEmb] = applyPostScoreModifiers({
    ...baseInput,
    hybridResults: [{ track: song, score: 0.55, debug: lowEmbeddingDebug, passed: true }],
  });
  const highBoost = highEmb!.scoreBreakdown!.rediscoveryBoost;
  const lowBoost = lowEmb!.scoreBreakdown!.rediscoveryBoost;
  assert.ok(Math.abs(highBoost - lowBoost) < 0.02, `boost should not scale with embedding: ${highBoost} vs ${lowBoost}`);
});
