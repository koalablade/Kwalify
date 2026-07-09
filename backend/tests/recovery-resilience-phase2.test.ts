import test from "node:test";
import assert from "node:assert/strict";
import { buildBlendedIntentPool, isCompoundPromptIntent, strictSupplyStarved } from "../lib/blended-intent-pool";
import { buildConstraintRelaxationPlan } from "../core/v3/constraint-relaxation";
import { evaluatePlaylistIdentity, recoveryPreservesIdentity } from "../lib/playlist-identity-guard";
import { playlistFrequencyMultiplier, applyFrequencyPenaltyToScore } from "../lib/playlist-frequency-penalty";
import { filterEmbarrassingTracks } from "../lib/human-embarrassment-filter";
import { buildFallbackUxPayload } from "../lib/fallback-ux-payload";
import { recoveryStageAllowedForTier } from "../lib/recovery-tier-policy";
import type { LockedIntent } from "../controllers/generation/generation-types";
import type { CuratorIdentity } from "../lib/curator-identity";
import type { EmotionProfile } from "../lib/emotion";

const baseIntent: LockedIntent = {
  genreFamilies: ["disco"],
  primaryGenres: ["disco"],
  primaryGenre: "disco",
  primarySubgenre: null,
  secondarySubgenre: null,
  subgenreTerms: [],
  mood: ["party"],
  activity: "party",
  energy: "high",
  energyLevel: "high",
  eraRange: { start: 1975, end: 1979 },
  eraStart: 1975,
  eraEnd: 1979,
};

const classMap = new Map([
  ["d1", { genrePrimary: "disco", genreFamily: "disco", primarySubgenre: "disco", secondarySubgenre: null, subGenres: ["disco"] }],
  ["p1", { genrePrimary: "pop", genreFamily: "pop", primarySubgenre: "pop", secondarySubgenre: null, subGenres: ["pop"] }],
]);

test("isCompoundPromptIntent detects era+genre+activity compounds", () => {
  assert.equal(isCompoundPromptIntent(baseIntent), true);
  assert.equal(isCompoundPromptIntent({ genreFamilies: ["pop"], mood: ["happy"] }), true);
  assert.equal(isCompoundPromptIntent({ genreFamilies: ["garage"], activity: "party", mood: ["summer"] }), true);
  assert.equal(isCompoundPromptIntent({ mood: ["happy"] }), false);
});

test("strict compound prompts retain stacked relaxation ladder through genre_adjacent", () => {
  const compoundPlan = buildConstraintRelaxationPlan(baseIntent, "strict");
  assert.ok(compoundPlan.length >= 3, `expected stacked ladder, got ${compoundPlan.length}`);
  assert.equal(compoundPlan[0]?.id, "strict");
  assert.ok(compoundPlan.some((step) => step.id === "relax_era"));
  assert.ok(compoundPlan.some((step) => step.id === "relax_genre_adjacent"));
  assert.equal(compoundPlan.some((step) => step.id === "relax_genre"), false);

  const simplePlan = buildConstraintRelaxationPlan(
    {
      ...baseIntent,
      eraRange: null,
      activity: null,
      mood: [],
    },
    "strict",
  );
  assert.equal(simplePlan.length, 1);
  assert.equal(simplePlan[0]?.id, "strict");
});

test("strictSupplyStarved flags zero strict supply for length 30", () => {
  assert.equal(strictSupplyStarved(0, 30), true);
  assert.equal(strictSupplyStarved(20, 30), false);
});

test("buildBlendedIntentPool combines lanes for thin disco supply", () => {
  const tracks = [
    { trackId: "d1", artistName: "Chic", trackName: "Le Freak", energy: 0.8, valence: 0.7, releaseYear: 1978, rediscoveryScore: 0.6 },
    { trackId: "p1", artistName: "Wham!", trackName: "Last Christmas", energy: 0.5, valence: 0.6, releaseYear: 1984, popularity: 90 },
    { trackId: "f1", artistName: "Funk Band", trackName: "Groove", energy: 0.75, valence: 0.65, releaseYear: 1977, rediscoveryScore: 0.5 },
  ];
  const result = buildBlendedIntentPool({
    tracks,
    vibe: "70s disco party",
    intent: baseIntent,
    emotionProfile: { energy: 0.75, valence: 0.7, tension: 0.2, nostalgia: 0.6, calm: 0.2, environment: "party", timeOfDay: null, motionState: null },
    classMap: new Map([
      ...classMap,
      ["f1", { genrePrimary: "funk", genreFamily: "funk", primarySubgenre: "funk", secondarySubgenre: null, subGenres: ["funk"] }],
    ]),
    requestedLength: 30,
  });
  assert.ok(result.tracks.length >= 2);
  assert.ok(result.diagnostics.outputCount >= 2);
  assert.equal(result.tracks.some((t) => t.trackId === "d1"), true);
});

test("evaluatePlaylistIdentity rejects Wham for 70s disco party", () => {
  const curatorIdentity: CuratorIdentity = {
    type: "party_social",
    summary: "70s disco party",
    energyBias: 0.75,
    familiarityBias: 0.6,
    repetitionTolerance: 0.4,
    repetitionPenalty: 0.5,
    eraDrift: 0.2,
    chaosAllowance: 0.3,
    forbiddenPatterns: ["generic_pop"],
  };
  const verdict = evaluatePlaylistIdentity(
    [
      { trackId: "p1", trackName: "Last Christmas", artistName: "Wham!", releaseYear: 1984, energy: 0.5, valence: 0.6 },
    ],
    {
      vibe: "70s disco party",
      lockedIntent: baseIntent,
      curatorIdentity,
      classMap,
    },
  );
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.includes("genre_identity_lost") || verdict.failures.includes("era_identity_lost"));
});

test("recoveryPreservesIdentity blocks identity collapse", () => {
  const before = { passed: true, score: 0.62, identityMatch: 0.6, activityMatch: 0.55, genreEvidenceRatio: 0.5, eraEvidenceRatio: 0.5, failures: [] as string[] };
  const after = { passed: false, score: 0.3, identityMatch: 0.2, activityMatch: 0.2, genreEvidenceRatio: 0.1, eraEvidenceRatio: 0.1, failures: ["genre_identity_lost"] };
  assert.equal(recoveryPreservesIdentity(before, after), false);
});

test("playlistFrequencyMultiplier penalizes overused tracks", () => {
  assert.equal(playlistFrequencyMultiplier(1), 0.92);
  assert.ok(playlistFrequencyMultiplier(20) < playlistFrequencyMultiplier(5));
  assert.equal(applyFrequencyPenaltyToScore(1, "x", new Map([["x", 0.28]])), 0.28);
});

test("filterEmbarrassingTracks removes holiday mismatch", () => {
  const { tracks, removed } = filterEmbarrassingTracks(
    [{ trackId: "p1", trackName: "Last Christmas", artistName: "Wham!", releaseYear: 1984 }],
    { vibe: "70s disco party", eraRange: { start: 1975, end: 1979 }, minKeep: 0 },
  );
  assert.equal(tracks.length, 0);
  assert.ok(removed.some((r) => r.reason === "seasonal_mismatch" || r.reason === "wrong_era"));
});

test("buildFallbackUxPayload blocks silent generic fallback", () => {
  const payload = buildFallbackUxPayload({
    vibe: "70s disco party",
    lockedIntent: baseIntent,
    limitingFactors: ["insufficient_strict_valid_candidates"],
    genreLabel: "disco",
  });
  assert.equal(payload.silentFallbackBlocked, true);
  assert.ok(payload.options.length >= 3);
  assert.match(payload.message, /limited/i);
});

test("recoveryStageAllowedForTier gates global behind tier 3", () => {
  assert.equal(recoveryStageAllowedForTier(1, "global"), false);
  assert.equal(recoveryStageAllowedForTier(2, "global"), false);
  assert.equal(recoveryStageAllowedForTier(3, "global"), true);
});
