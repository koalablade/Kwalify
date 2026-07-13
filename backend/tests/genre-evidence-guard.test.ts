import test from "node:test";
import assert from "node:assert/strict";
import type { LockedIntent } from "../controllers/generation/generation-types";
import {
  adjacentExplicitSubgenreTerms,
  assessConfidenceAwarePublication,
  buildHonestConstrainedPlaylist,
  computeAdaptiveGenreEvidenceRequiredCount,
  computeAdaptivePartialPublishLimit,
  computePartialGenreVerificationScore,
  fillVerifiedPlaylistFromV3Output,
  publishConfidenceAwarePlaylist,
  publishHonestConstrainedPlaylist,
  publishVerifiedV3OutputPlaylist,
  repairGenreAwarePlaylistFromV3,
  resolveGenreEvidencePublication,
  resolveEffectiveGenreVerifiedSupply,
  resolveGenreEvidenceVerifiedPrefix,
  shouldPreferHonestConstrainedPublish,
  shouldPublishConfidenceAwareOutput,
  shouldPublishVerifiedV3Output,
  shouldUseBlindConstrainedReplacement,
  trackMatchesAdjacentExplicitSubgenre,
  trackMatchesExplicitSubgenreEvidence,
} from "../lib/genre-evidence-guard";

const discoIntent: LockedIntent = {
  genreFamilies: ["soul"],
  primaryGenres: ["soul"],
  primaryGenre: "soul",
  primarySubgenre: "disco",
  secondarySubgenre: null,
  subgenreTerms: ["disco"],
  mood: ["party"],
  activity: "party",
  energy: "high",
  energyLevel: "high",
  eraRange: { start: 1970, end: 1979 },
  eraStart: 1970,
  eraEnd: 1979,
};

const soulClassMap = new Map([
  ["disco1", { genrePrimary: "soul", genreFamily: "soul", primarySubgenre: "disco", secondarySubgenre: null, subGenres: ["disco"] }],
  ["funk1", { genrePrimary: "soul", genreFamily: "soul", primarySubgenre: "funk", secondarySubgenre: null, subGenres: ["funk"] }],
  ["motown1", { genrePrimary: "soul", genreFamily: "soul", primarySubgenre: "motown", secondarySubgenre: null, subGenres: ["motown"] }],
  ["pop1", { genrePrimary: "pop", genreFamily: "pop", primarySubgenre: "pop", secondarySubgenre: null, subGenres: ["pop"] }],
]);

test("adjacentExplicitSubgenreTerms includes funk and motown for disco intent", () => {
  const adjacent = adjacentExplicitSubgenreTerms("disco");
  assert.equal(adjacent.includes("funk"), true);
  assert.equal(adjacent.includes("motown"), true);
});

test("trackMatchesExplicitSubgenreEvidence rejects funk without adjacent allowance", () => {
  const track = { trackId: "funk1", artistName: "Funkadelic", trackName: "Can You Get To That" };
  assert.equal(trackMatchesExplicitSubgenreEvidence(track, discoIntent, soulClassMap), false);
});

test("trackMatchesExplicitSubgenreEvidence accepts funk with adjacent allowance and soul family", () => {
  const track = { trackId: "funk1", artistName: "Funkadelic", trackName: "Can You Get To That" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, discoIntent, soulClassMap, { allowIntentAdjacentSubgenres: true }),
    true,
  );
});

test("trackMatchesAdjacentExplicitSubgenre rejects pop for disco intent", () => {
  const track = { trackId: "pop1", artistName: "Wham!", trackName: "Last Christmas" };
  assert.equal(trackMatchesAdjacentExplicitSubgenre(track, discoIntent, soulClassMap), false);
});

test("fillVerifiedPlaylistFromV3Output preserves verified then fills from V3 order", () => {
  const verified = [
    { trackId: "disco1", artistName: "Chic", trackName: "Le Freak" },
    { trackId: "disco2", artistName: "Donna Summer", trackName: "Hot Stuff" },
  ];
  const v3Tracks = [
    ...verified,
    { trackId: "funk1", artistName: "Funkadelic", trackName: "Can You Get To That" },
    { trackId: "motown1", artistName: "Al Green", trackName: "Let's Stay Together" },
    { trackId: "pop1", artistName: "Wham!", trackName: "Last Christmas" },
  ];
  const result = fillVerifiedPlaylistFromV3Output({
    verified,
    v3Tracks,
    targetLength: 4,
    isCompatibleFill: (track) => track.trackId !== "pop1",
  });
  assert.equal(result.tracks.length, 4);
  assert.equal(result.filledFromV3Count, 2);
  assert.equal(result.verifiedPreservedCount, 2);
  assert.deepEqual(result.tracks.map((track) => track.trackId), ["disco1", "disco2", "funk1", "motown1"]);
});

test("fillVerifiedPlaylistFromV3Output does not exceed target length", () => {
  const verified = [{ trackId: "disco1", artistName: "Chic", trackName: "Le Freak" }];
  const v3Tracks = [
    ...verified,
    { trackId: "funk1", artistName: "Funkadelic", trackName: "Groove" },
    { trackId: "motown1", artistName: "Al Green", trackName: "Love" },
  ];
  const result = fillVerifiedPlaylistFromV3Output({
    verified,
    v3Tracks,
    targetLength: 2,
    isCompatibleFill: () => true,
  });
  assert.equal(result.tracks.length, 2);
  assert.equal(result.filledFromV3Count, 1);
  assert.equal(result.verifiedPreservedCount, 1);
});

test("computeAdaptiveGenreEvidenceRequiredCount caps required by V3 verified supply", () => {
  const adaptive = computeAdaptiveGenreEvidenceRequiredCount({
    evidenceBasisCount: 25,
    targetLength: 25,
    baseRatio: 0.85,
    availableVerifiedSupply: 11,
    strictValidSupply: 88,
  });
  assert.equal(adaptive.baseRequiredCount, 22);
  assert.equal(adaptive.requiredCount, 10);
  assert.equal(adaptive.supplyCapped, true);
});

test("computePartialGenreVerificationScore passes when supply exhausted", () => {
  const partial = computePartialGenreVerificationScore({
    verifiedCount: 11,
    requiredCount: 22,
    availableVerifiedSupply: 11,
  });
  assert.equal(partial.supplyExhausted, true);
  assert.equal(partial.passes, true);
  assert.equal(partial.reason, "supply_exhausted");
});

test("computePartialGenreVerificationScore passes gym pop punk partial ratio", () => {
  const partial = computePartialGenreVerificationScore({
    verifiedCount: 17,
    requiredCount: 18,
    availableVerifiedSupply: 21,
  });
  assert.equal(partial.passes, true);
  assert.equal(partial.reason, "partial_ratio_pass");
});

test("repairGenreAwarePlaylistFromV3 preserves verified and caps by supply", () => {
  const verified = [
    { trackId: "disco1", artistName: "Chic", trackName: "Le Freak" },
    { trackId: "disco2", artistName: "Donna Summer", trackName: "Hot Stuff" },
  ];
  const v3Tracks = [
    ...verified,
    { trackId: "funk1", artistName: "Funkadelic", trackName: "Groove" },
    { trackId: "motown1", artistName: "Al Green", trackName: "Love" },
    { trackId: "pop1", artistName: "Wham!", trackName: "Last Christmas" },
  ];
  const genreOk = new Set(["disco1", "disco2", "funk1", "motown1"]);
  const result = repairGenreAwarePlaylistFromV3({
    verifiedPrefix: verified,
    v3Tracks,
    requestedLength: 30,
    availableGenreVerifiedSupply: 4,
    isGenreVerified: (t) => genreOk.has(t.trackId),
    passesHardConstraints: (t) => t.trackId !== "pop1",
  });
  assert.equal(result.verifiedPreservedCount, 2);
  assert.equal(result.filledFromV3Count, 2);
  assert.equal(result.tracks.length, 4);
  assert.equal(result.repairTargetLength, 4);
  assert.equal(result.supplyCapped, true);
  assert.equal(result.postRepairVerifiedCount, 4);
  assert.equal(result.highConfidenceFillCount, 0);
});

test("repairGenreAwarePlaylistFromV3 prefers high-confidence fills when ranking enabled", () => {
  const verified = [{ trackId: "disco1", artistName: "Chic", trackName: "Le Freak" }];
  const v3Tracks = [
    ...verified,
    { trackId: "low1", artistName: "A", trackName: "Low" },
    { trackId: "high1", artistName: "B", trackName: "High" },
  ];
  const genreOk = new Set(["disco1", "low1", "high1"]);
  const confidenceById: Record<string, number> = { disco1: 0.92, low1: 0.62, high1: 0.92 };
  const result = repairGenreAwarePlaylistFromV3({
    verifiedPrefix: verified,
    v3Tracks,
    requestedLength: 3,
    availableGenreVerifiedSupply: 3,
    isGenreVerified: (t) => genreOk.has(t.trackId),
    passesHardConstraints: () => true,
    genreEvidenceConfidence: (t) => ({ confidence: confidenceById[t.trackId] ?? 0.5, tier: "taxonomy" }),
  });
  assert.deepEqual(result.tracks.map((track) => track.trackId), ["disco1", "high1", "low1"]);
  assert.equal(result.highConfidenceFillCount, 1);
  assert.equal(result.minConfidenceFillCount, 1);
});

test("computePartialGenreVerificationScore passes confidence weighted near-miss", () => {
  const partial = computePartialGenreVerificationScore({
    verifiedCount: 17,
    requiredCount: 18,
    availableVerifiedSupply: 21,
    verifiedConfidences: Array.from({ length: 17 }, () => 0.78),
  });
  assert.equal(partial.passes, true);
  assert.equal(partial.reason, "partial_ratio_pass");
  assert.ok(partial.confidenceWeightedScore >= 0.65);
});

test("computeAdaptivePartialPublishLimit publishes thin library honestly", () => {
  const partial = computeAdaptivePartialPublishLimit({
    requestedLength: 30,
    publishedTrackCount: 3,
    verifiedCount: 3,
    availableVerifiedSupply: 3,
    supplyCapped: true,
  });
  assert.equal(partial.limit, 3);
  assert.equal(partial.honestPartial, true);
  assert.equal(partial.reason, "supply_ceiling");
});

test("computeAdaptivePartialPublishLimit publishes supply-capped garage partial", () => {
  const partial = computeAdaptivePartialPublishLimit({
    requestedLength: 25,
    publishedTrackCount: 25,
    verifiedCount: 16,
    availableVerifiedSupply: 16,
    repairTargetLength: 16,
    supplyCapped: true,
    partialVerificationPasses: true,
  });
  assert.equal(partial.limit, 16);
  assert.equal(partial.honestPartial, true);
  assert.equal(partial.reason, "supply_ceiling");
});

test("computeAdaptivePartialPublishLimit publishes full length when verified", () => {
  const partial = computeAdaptivePartialPublishLimit({
    requestedLength: 30,
    publishedTrackCount: 30,
    verifiedCount: 30,
    availableVerifiedSupply: 30,
    partialVerificationPasses: true,
  });
  assert.equal(partial.limit, 30);
  assert.equal(partial.honestPartial, false);
  assert.equal(partial.reason, "full_length");
});

test("assessConfidenceAwarePublication passes on confidence weighted near-miss", () => {
  const assessment = assessConfidenceAwarePublication({
    active: true,
    verifiedCount: 17,
    requiredCount: 18,
    availableVerifiedSupply: 21,
    confidenceQualifiedSupply: 19,
    verifiedConfidences: Array.from({ length: 17 }, () => 0.78),
    partialVerificationPasses: false,
    rejectedCount: 3,
    publishedTrackCount: 21,
    requestedLength: 30,
  });
  assert.equal(assessment.passes, true);
  assert.equal(assessment.partialVerificationReason, "partial_ratio_pass");
  assert.equal(assessment.publishReason, "publish_confidence_aware_partial");
  assert.equal(shouldPublishConfidenceAwareOutput(assessment), true);
});

test("shouldPublishVerifiedV3Output accepts confidence-aware pass", () => {
  assert.equal(shouldPublishVerifiedV3Output({
    active: true,
    verifiedCount: 17,
    rejectedCount: 0,
    partialVerificationPasses: false,
    publishedTrackCount: 30,
    requestedLength: 30,
    confidenceAwarePasses: true,
  }), true);
});

test("resolveGenreEvidencePublication publishes confidence-aware when borderline", () => {
  const decision = resolveGenreEvidencePublication({
    active: true,
    repairedFromV3: false,
    postRepairPartialPasses: false,
    initialPartialPasses: false,
    verifiedCount: 17,
    postRepairVerifiedCount: 17,
    publishedTrackCount: 21,
    requestedLength: 30,
    availableVerifiedSupply: 21,
    confidenceQualifiedSupply: 19,
    confidenceAwarePasses: true,
    confidencePublicationReason: "publish_confidence_aware_weighted",
  });
  assert.equal(decision.action, "publish_confidence_aware");
  assert.equal(decision.skipConstrainedPrefix, true);
  assert.equal(decision.confidenceAwarePublished, true);
});

test("publishConfidenceAwarePlaylist uses confidence-ranked repair", () => {
  const verified = [{ trackId: "a", artistName: "A", trackName: "One" }];
  const v3Tracks = [
    ...verified,
    { trackId: "b", artistName: "B", trackName: "Two" },
    { trackId: "c", artistName: "C", trackName: "Three" },
  ];
  const ok = new Set(["a", "b", "c"]);
  const assessment = assessConfidenceAwarePublication({
    active: true,
    verifiedCount: 1,
    requiredCount: 3,
    availableVerifiedSupply: 3,
    confidenceQualifiedSupply: 3,
    verifiedConfidences: [0.92],
    partialVerificationPasses: true,
    rejectedCount: 0,
    publishedTrackCount: 3,
    requestedLength: 3,
  });
  const pub = publishConfidenceAwarePlaylist({
    verifiedPrefix: verified,
    v3Tracks,
    requestedLength: 3,
    availableGenreVerifiedSupply: 3,
    isGenreVerified: (t) => ok.has(t.trackId),
    passesHardConstraints: () => true,
    genreEvidenceConfidence: (t) => ({
      confidence: t.trackId === "c" ? 0.62 : 0.92,
      tier: "taxonomy",
    }),
  }, assessment);
  assert.equal(pub.published, true);
  assert.equal(pub.confidenceAware, true);
  assert.equal(pub.reason, assessment.publishReason);
});

test("resolveGenreEvidencePublication uses adaptive partial limit for degraded fallback", () => {
  const decision = resolveGenreEvidencePublication({
    active: true,
    repairedFromV3: false,
    postRepairPartialPasses: false,
    initialPartialPasses: false,
    verifiedCount: 11,
    postRepairVerifiedCount: 11,
    publishedTrackCount: 25,
    requestedLength: 25,
    availableVerifiedSupply: 11,
    supplyCapped: true,
  });
  assert.equal(decision.action, "publish_honest_constrained");
  assert.equal(decision.partialPublishLimit, 11);
  assert.equal(decision.honestPartialPublished, true);
  assert.equal(decision.skipConstrainedPrefix, true);
  assert.equal(decision.adaptivePartialPublishReason, "supply_ceiling");
});

test("buildHonestConstrainedPlaylist preserves verified and avoids blind replacement", () => {
  const verified = [
    { trackId: "v1", artistName: "A", trackName: "One" },
    { trackId: "v2", artistName: "B", trackName: "Two" },
  ];
  const v3Tracks = [
    ...verified,
    { trackId: "v3", artistName: "C", trackName: "Three" },
    { trackId: "bad", artistName: "D", trackName: "Four" },
  ];
  const ok = new Set(["v1", "v2", "v3"]);
  const result = buildHonestConstrainedPlaylist({
    verifiedPrefix: verified,
    v3Tracks,
    recoveryPool: [{ trackId: "r1", artistName: "R", trackName: "Recovery" }],
    requestedLength: 25,
    availableVerifiedSupply: 3,
    supplyCapped: true,
    isGenreVerified: (t) => ok.has(t.trackId),
    passesHardConstraints: () => true,
  });
  assert.equal(result.tracks.map((t) => t.trackId).join(","), "v1,v2,v3");
  assert.equal(result.recoveryFillCount, 0);
  assert.equal(result.usedBlindRecoveryReplacement, false);
  assert.equal(result.reason, "honest_constrained_verified_plus_v3");
});

test("shouldPreferHonestConstrainedPublish prefers verified floor over blind recovery", () => {
  assert.equal(shouldPreferHonestConstrainedPublish({ verifiedCount: 11 }), true);
  assert.equal(shouldPreferHonestConstrainedPublish({ verifiedCount: 2 }), false);
  assert.equal(shouldPreferHonestConstrainedPublish({ verifiedCount: 2, partialVerificationPasses: true }), true);
});

test("shouldUseBlindConstrainedReplacement only when honest path is empty and no verified tracks", () => {
  assert.equal(shouldUseBlindConstrainedReplacement({
    verifiedCount: 0,
    honestConstrainedDelivered: 0,
    recoveryPoolSize: 8,
  }), true);
  assert.equal(shouldUseBlindConstrainedReplacement({
    verifiedCount: 2,
    honestConstrainedDelivered: 0,
    recoveryPoolSize: 8,
  }), false);
  assert.equal(shouldUseBlindConstrainedReplacement({
    verifiedCount: 11,
    honestConstrainedDelivered: 0,
    recoveryPoolSize: 8,
  }), false);
  assert.equal(shouldUseBlindConstrainedReplacement({
    verifiedCount: 2,
    honestConstrainedDelivered: 2,
    recoveryPoolSize: 8,
  }), false);
});

test("publishHonestConstrainedPlaylist publishes thin library honestly", () => {
  const pub = publishHonestConstrainedPlaylist({
    verifiedPrefix: [{ trackId: "latin1", artistName: "A", trackName: "Cumbia" }],
    v3Tracks: [{ trackId: "latin1", artistName: "A", trackName: "Cumbia" }],
    recoveryPool: [
      { trackId: "latin1", artistName: "A", trackName: "Cumbia" },
      { trackId: "pop1", artistName: "B", trackName: "Pop" },
    ],
    requestedLength: 30,
    availableVerifiedSupply: 1,
    supplyCapped: true,
    isGenreVerified: (t) => t.trackId === "latin1",
    passesHardConstraints: () => true,
  });
  assert.equal(pub.published, true);
  assert.equal(pub.result.tracks.length, 1);
  assert.equal(pub.result.publishLimit, 1);
});

test("resolveGenreEvidencePublication publishes verified v3 on partial pass", () => {
  const decision = resolveGenreEvidencePublication({
    active: true,
    repairedFromV3: false,
    postRepairPartialPasses: true,
    initialPartialPasses: false,
    verifiedCount: 17,
    postRepairVerifiedCount: 21,
    publishedTrackCount: 21,
    requestedLength: 30,
  });
  assert.equal(decision.skipConstrainedPrefix, true);
  assert.equal(decision.skipGenreLeakStrip, true);
  assert.equal(decision.publishReason, "publish_verified_v3_output");
});

test("shouldPublishVerifiedV3Output triggers on genre leaks", () => {
  assert.equal(shouldPublishVerifiedV3Output({
    active: true,
    verifiedCount: 17,
    rejectedCount: 4,
    partialVerificationPasses: true,
    publishedTrackCount: 21,
    requestedLength: 30,
  }), true);
});

test("publishVerifiedV3OutputPlaylist builds from V3 order", () => {
  const v3Tracks = [
    { trackId: "a", artistName: "A", trackName: "One" },
    { trackId: "b", artistName: "B", trackName: "Two" },
    { trackId: "c", artistName: "C", trackName: "Three" },
  ];
  const ok = new Set(["a", "b", "c"]);
  const pub = publishVerifiedV3OutputPlaylist({
    verifiedPrefix: [{ trackId: "a", artistName: "A", trackName: "One" }],
    v3Tracks,
    requestedLength: 3,
    availableGenreVerifiedSupply: 3,
    isGenreVerified: (t) => ok.has(t.trackId),
    passesHardConstraints: () => true,
  });
  assert.equal(pub.published, true);
  assert.deepEqual(pub.result.tracks.map((t) => t.trackId), ["a", "b", "c"]);
  assert.equal(pub.reason, "publish_verified_v3_output");
});

test("resolveGenreEvidencePublication falls back when verification fails", () => {
  const decision = resolveGenreEvidencePublication({
    active: true,
    repairedFromV3: false,
    postRepairPartialPasses: false,
    initialPartialPasses: false,
    verifiedCount: 2,
    postRepairVerifiedCount: 2,
    publishedTrackCount: 25,
    requestedLength: 25,
  });
  assert.equal(decision.action, "fallback_constrained");
  assert.equal(decision.skipConstrainedPrefix, false);
});

const garageIntent: LockedIntent = {
  genreFamilies: ["electronic"],
  primaryGenres: ["electronic"],
  primaryGenre: "electronic",
  primarySubgenre: "uk_garage",
  secondarySubgenre: null,
  subgenreTerms: ["uk_garage"],
  mood: ["drive"],
  activity: "drive",
  energy: "high",
  energyLevel: "high",
  eraRange: { start: 1998, end: 2006 },
  eraStart: 1998,
  eraEnd: 2006,
};

const electronicClassMap = new Map([
  ["ukg1", { genrePrimary: "electronic", genreFamily: "electronic", primarySubgenre: "uk_garage", secondarySubgenre: null, subGenres: ["uk_garage"] }],
  ["2step1", { genrePrimary: "electronic", genreFamily: "electronic", primarySubgenre: "2_step", secondarySubgenre: null, subGenres: ["2_step"] }],
  ["house1", { genrePrimary: "electronic", genreFamily: "electronic", primarySubgenre: "house", secondarySubgenre: null, subGenres: ["house"] }],
  ["rock1", { genrePrimary: "rock", genreFamily: "rock", primarySubgenre: "classic_rock", secondarySubgenre: null, subGenres: ["classic_rock"] }],
]);

test("uk_garage accepts 2_step adjacent with family evidence", () => {
  const track = { trackId: "2step1", artistName: "Artful Dodger", trackName: "Re-Rewind" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, garageIntent, electronicClassMap, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["electronic"],
    }),
    true,
  );
});

test("uk_garage rejects unrelated rock even with adjacent allowance", () => {
  const track = { trackId: "rock1", artistName: "Led Zeppelin", trackName: "Rock and Roll" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, garageIntent, electronicClassMap, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["electronic"],
    }),
    false,
  );
});

const popPunkIntent: LockedIntent = {
  genreFamilies: ["rock"],
  primaryGenres: ["rock"],
  primaryGenre: "rock",
  primarySubgenre: "pop_punk",
  secondarySubgenre: null,
  subgenreTerms: ["pop_punk"],
  mood: ["gym"],
  activity: "gym",
  energy: "high",
  energyLevel: "high",
  eraRange: { start: 2000, end: 2009 },
  eraStart: 2000,
  eraEnd: 2009,
};

const rockClassMap = new Map([
  ["pp1", { genrePrimary: "rock", genreFamily: "rock", primarySubgenre: "pop_punk", secondarySubgenre: null, subGenres: ["pop_punk"] }],
  ["emo1", { genrePrimary: "rock", genreFamily: "rock", primarySubgenre: "emo", secondarySubgenre: null, subGenres: ["emo"] }],
  ["country1", { genrePrimary: "country", genreFamily: "country", primarySubgenre: "modern_country", secondarySubgenre: null, subGenres: ["modern_country"] }],
]);

const raveIntent: LockedIntent = {
  genreFamilies: ["electronic"],
  primaryGenres: ["electronic"],
  primaryGenre: "electronic",
  primarySubgenre: "rave",
  secondarySubgenre: null,
  subgenreTerms: ["rave"],
  mood: ["party"],
  activity: "party",
  energy: "high",
  energyLevel: "high",
  eraRange: { start: 1990, end: 1999 },
  eraStart: 1990,
  eraEnd: 1999,
};

test("pop_punk accepts emo adjacent with family evidence", () => {
  const track = { trackId: "emo1", artistName: "Fall Out Boy", trackName: "Sugar, We're Goin Down" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, popPunkIntent, rockClassMap, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["rock"],
    }),
    true,
  );
});

test("rave accepts hard_techno adjacent with family evidence", () => {
  const raveClassMap = new Map([
    ["ht1", { genrePrimary: "electronic", genreFamily: "electronic", primarySubgenre: "hard_techno", secondarySubgenre: null, subGenres: ["hard_techno"] }],
    ["pop1", { genrePrimary: "pop", genreFamily: "pop", primarySubgenre: "pop", secondarySubgenre: null, subGenres: ["pop"] }],
  ]);
  const track = { trackId: "ht1", artistName: "Hardfloor", trackName: "Acperience" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, raveIntent, raveClassMap, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["electronic"],
    }),
    true,
  );
});

test("pop_punk rejects country even with adjacent allowance", () => {
  const track = { trackId: "country1", artistName: "Luke Combs", trackName: "Beer Never Broke My Heart" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, popPunkIntent, rockClassMap, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["rock"],
    }),
    false,
  );
});

test("pop_punk accepts punk_rock adjacent with family evidence", () => {
  const map = new Map([
    ["pr1", { genrePrimary: "rock", genreFamily: "rock", primarySubgenre: "punk_rock", secondarySubgenre: null, subGenres: ["punk_rock"] }],
  ]);
  const track = { trackId: "pr1", artistName: "The Offspring", trackName: "Self Esteem" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, popPunkIntent, map, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["rock"],
    }),
    true,
  );
});

test("uk_garage accepts breakbeat adjacent with family evidence", () => {
  const map = new Map([
    ["bb1", { genrePrimary: "electronic", genreFamily: "electronic", primarySubgenre: "breakbeat", secondarySubgenre: null, subGenres: ["breakbeat"] }],
  ]);
  const track = { trackId: "bb1", artistName: "The Prodigy", trackName: "Charly" };
  assert.equal(
    trackMatchesExplicitSubgenreEvidence(track, garageIntent, map, {
      allowIntentAdjacentSubgenres: true,
      genreFamilies: ["electronic"],
    }),
    true,
  );
});

test("resolveEffectiveGenreVerifiedSupply prefers V3 verified over low confidence-qualified count", () => {
  assert.equal(
    resolveEffectiveGenreVerifiedSupply({
      confidenceQualifiedSupply: 1,
      v3VerifiedSupply: 14,
      verifiedCount: 14,
    }),
    14,
  );
});

test("resolveGenreEvidenceVerifiedPrefix prefers V3 pool when finals collapsed", () => {
  const verified = (id: string) => ({ trackId: id, artistName: "A", trackName: id });
  const isOk = (track: { trackId: string }) => track.trackId.startsWith("v");
  const prefix = resolveGenreEvidenceVerifiedPrefix(
    [verified("final-1")],
    [verified("v1"), verified("v2"), verified("v3")],
    isOk,
    () => true,
  );
  assert.equal(prefix.length, 3);
});

test("adaptive partial publish uses aligned supply for era-thin calibration", () => {
  const aligned = resolveEffectiveGenreVerifiedSupply({
    confidenceQualifiedSupply: 1,
    v3VerifiedSupply: 14,
    verifiedCount: 14,
  });
  assert.equal(aligned, 14);
  const partial = computeAdaptivePartialPublishLimit({
    requestedLength: 30,
    publishedTrackCount: 14,
    verifiedCount: 14,
    postRepairVerifiedCount: 14,
    availableVerifiedSupply: aligned,
    partialVerificationPasses: true,
  });
  assert.equal(partial.limit, 14);
});
