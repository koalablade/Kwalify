/**
 * Unit tests for intent collapse pre-generation layer.
 *
 * Run: npm run test:intent-collapse-layer
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseIntent,
  filterCandidatesByIntentVector,
  minimumIntentPoolSize,
  selectEditorialWorld,
  selectRankedCandidatesForSampler,
  trackMatchesEditorialIntent,
  trackMicroCluster,
  enrichIntentCollapseTrack,
  calibrateIntentVectorForRetrievalPool,
  diagnoseIntentFilterRejectionCounts,
  validateDominantClusterAlignment,
} from "../core/editorial/intent-collapse-layer";
import type { LockedIntent } from "../core/v3/intent";
import type { EmotionProfile } from "../lib/emotion";

type TestTrack = {
  trackId: string;
  genreFamily: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
};

const baseProfile: EmotionProfile = {
  energy: 0.45,
  valence: 0.42,
  tension: 0.3,
  nostalgia: 0.4,
  calm: 0.55,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

const rainyWalkIntent: LockedIntent = {
  genreFamilies: ["indie", "folk"],
  primaryGenre: "indie",
  primarySubgenre: null,
  secondarySubgenre: null,
  subgenreTerms: [],
  eraRange: null,
  mood: ["reflective"],
  activity: "walk",
  energy: "low",
};

function buildRainWalkTracks(count: number): TestTrack[] {
  const tracks: TestTrack[] = [];
  for (let i = 0; i < count; i++) {
    tracks.push({
      trackId: `t${i}`,
      genreFamily: i % 3 === 0 ? "folk" : "indie",
      energy: 0.38 + (i % 4) * 0.03,
      valence: 0.36 + (i % 3) * 0.04,
      danceability: 0.38,
      acousticness: 0.58,
      tempo: 102,
    });
  }
  return tracks;
}

describe("intent collapse layer", () => {
  it("collapses rainy walk prompt into a single editorial world", () => {
    const collapsed = collapseIntent({
      vibe: "rainy city walk reflective",
      lockedIntent: rainyWalkIntent,
      profile: baseProfile,
      strictMode: true,
    });
    assert.equal(collapsed.intent.sceneType, "walk");
    assert.ok(collapsed.intent.editorialWorldTag.includes("rain") || collapsed.intent.editorialWorldTag.includes("folk"));
    assert.ok(collapsed.intent.allowedMicroClusters.length > 0);
    assert.ok(collapsed.collapseConfidenceScore >= 0.5);
  });

  it("selects highest-cohesion world on ambiguity", () => {
    const world = selectEditorialWorld({
      vibe: "cozy sunday morning soft indie",
      lockedIntent: { ...rainyWalkIntent, mood: ["comfort"], activity: null, energy: "low" },
      profile: { ...baseProfile, valence: 0.58 },
      primaryMood: "comfort",
      sceneType: "sunday",
      strictMode: true,
    });
    assert.ok(world.cohesionScore >= 0.86);
    assert.equal(world.primaryFamilies.includes("indie"), true);
  });

  it("hard-filters incompatible candidates by intent vector", () => {
    const collapsed = collapseIntent({
      vibe: "rainy city walk reflective",
      lockedIntent: rainyWalkIntent,
      profile: baseProfile,
      strictMode: true,
    });
    const compatible = buildRainWalkTracks(20);
    const incompatible = buildRainWalkTracks(5).map((track, idx) => ({
      ...track,
      trackId: `x${idx}`,
      genreFamily: "metal",
      energy: 0.9,
      valence: 0.8,
      acousticness: 0.1,
      danceability: 0.9,
    }));
    const filtered = filterCandidatesByIntentVector([...compatible, ...incompatible], collapsed.intent);
    assert.equal(filtered.length, compatible.length);
    assert.ok(filtered.every((track) => trackMatchesEditorialIntent(track, collapsed.intent)));
  });

  it("derives deterministic micro clusters", () => {
    const micro = trackMicroCluster({
      trackId: "a",
      genreFamily: "indie",
      energy: 0.4,
      valence: 0.4,
      danceability: 0.4,
      acousticness: 0.62,
      tempo: 100,
    });
    assert.equal(micro, "indie:acoustic");
  });

  it("defines strict minimum pool size before sampler", () => {
    assert.equal(minimumIntentPoolSize(25, true), 50);
    assert.ok(minimumIntentPoolSize(25, false) >= 18);
  });

  it("does not reject tracks with missing audio features when family and micro cluster match", () => {
    const collapsed = collapseIntent({
      vibe: "rainy city walk reflective",
      lockedIntent: rainyWalkIntent,
      profile: baseProfile,
      strictMode: true,
    });
    const compatible = buildRainWalkTracks(10).map((track) => ({
      ...track,
      energy: null as unknown as number,
      valence: null as unknown as number,
      danceability: null as unknown as number,
      acousticness: null as unknown as number,
      tempo: null as unknown as number,
    }));
    const filtered = filterCandidatesByIntentVector(compatible, collapsed.intent);
    assert.equal(filtered.length, compatible.length);
  });

  it("selects editorial world compatible with locked scene archetype", () => {
    const library = buildRainWalkTracks(80);
    const world = selectEditorialWorld({
      vibe: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.",
      lockedIntent: { ...rainyWalkIntent, mood: ["uplift"], activity: "commute", energy: "high", genreFamilies: [] },
      profile: { ...baseProfile, valence: 0.68, energy: 0.62 },
      primaryMood: "uplift",
      sceneType: "commute",
      strictMode: true,
      libraryTracks: library,
      targetCount: 25,
      sceneArchetypeId: "indie_pop_sunshine_commute",
    });
    assert.equal(world.tag, "indie_pop_sunshine_commute");
  });

  it("calibrates micro-clusters from retrieval pool so family-matched tracks survive", () => {
    const collapsed = collapseIntent({
      vibe: "driving at sunset with open windows and golden light",
      lockedIntent: rainyWalkIntent,
      profile: baseProfile,
      strictMode: true,
      sceneArchetypeId: "sunset_indie_drive",
    });
    const pool = Array.from({ length: 40 }, (_, i) => ({
      trackId: `s${i}`,
      genreFamily: "indie",
      energy: 0.74,
      valence: 0.52,
      danceability: 0.68,
      acousticness: 0.22,
      tempo: 128,
    }));
    const calibrated = calibrateIntentVectorForRetrievalPool(pool, collapsed.intent, { targetCount: 25, strictMode: true });
    const filtered = filterCandidatesByIntentVector(pool, calibrated);
    assert.ok(filtered.length >= 20);
  });

  it("aligns dominant cluster genres with editorial world families", () => {
    const ok = validateDominantClusterAlignment(
      "emotional_alt_pop",
      "bon iver / wallows · soundtrack",
      ["indie", "folk"],
    );
    assert.equal(ok.aligned, true);
  });

  it("enriches genre family from classification map when track metadata is sparse", () => {
    const track = enrichIntentCollapseTrack(
      { trackId: "a", genrePrimary: null, genreFamily: null },
      { genreFamily: "indie", genrePrimary: "indie rock" },
    );
    assert.equal(track.genreFamily, "indie");
    const collapsed = collapseIntent({
      vibe: "rainy city walk reflective",
      lockedIntent: rainyWalkIntent,
      profile: baseProfile,
      strictMode: true,
    });
    assert.equal(trackMatchesEditorialIntent(track, collapsed.intent), true);
  });

  it("relaxes dominant valence rejection until pool survives calibration", () => {
    const collapsed = collapseIntent({
      vibe: "Feel-good summer morning music to hype yourself up for the day",
      lockedIntent: { ...rainyWalkIntent, mood: ["uplift"], activity: "commute", energy: "high", genreFamilies: [] },
      profile: { ...baseProfile, valence: 0.68, energy: 0.62 },
      strictMode: true,
      sceneArchetypeId: "indie_pop_sunshine_commute",
    });
    const pool = Array.from({ length: 50 }, (_, i) => ({
      trackId: `v${i}`,
      genreFamily: "indie",
      energy: 0.58,
      valence: 0.72,
      danceability: 0.55,
      acousticness: 0.35,
      tempo: 118,
    }));
    const calibrated = calibrateIntentVectorForRetrievalPool(pool, collapsed.intent, { targetCount: 25, strictMode: true });
    const counts = diagnoseIntentFilterRejectionCounts(pool, calibrated);
    const filtered = filterCandidatesByIntentVector(pool, calibrated);
    assert.ok(filtered.length >= 18);
    assert.ok((counts.passed ?? 0) >= 18);
  });

  it("selects ranked candidates without widening genre-family gate", () => {
    const collapsed = collapseIntent({
      vibe: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.",
      lockedIntent: { ...rainyWalkIntent, mood: ["uplift"], activity: "commute", energy: "high", genreFamilies: [] },
      profile: { ...baseProfile, valence: 0.68, energy: 0.62 },
      strictMode: true,
      sceneArchetypeId: "indie_pop_sunshine_commute",
    });
    const pool = [
      ...Array.from({ length: 28 }, (_, i) => ({
        trackId: `indie${i}`,
        genreFamily: "indie",
        energy: 0.58,
        valence: 0.62,
        danceability: 0.55,
        acousticness: 0.35,
        tempo: 118,
      })),
      ...Array.from({ length: 178 }, (_, i) => ({
        trackId: `other${i}`,
        genreFamily: i % 2 === 0 ? "rock" : "hip_hop",
        energy: 0.58,
        valence: 0.62,
        danceability: 0.55,
        acousticness: 0.35,
        tempo: 118,
      })),
    ];
    const calibrated = calibrateIntentVectorForRetrievalPool(pool, collapsed.intent, { targetCount: 25, strictMode: true });
    const ranked = selectRankedCandidatesForSampler(pool, calibrated, { targetCount: 25, strictMode: true });
    assert.equal(calibrated.relaxGenreFamilyFilter, undefined);
    assert.ok(ranked.selected.length >= minimumIntentPoolSize(25, true));
    const headSize = minimumIntentPoolSize(25, true);
    const head = ranked.selected.slice(0, headSize);
    const indieShare = head.filter((track) => track.genreFamily === "indie").length / head.length;
    assert.ok(indieShare >= 0.35);
    assert.ok(ranked.selected.length <= 300);
  });

  it("routes genre-locked prompts to matching editorial worlds", () => {
    const world = selectEditorialWorld({
      vibe: "classic country road trip singalong",
      lockedIntent: { ...rainyWalkIntent, genreFamilies: ["country"], mood: ["nostalgic"], energy: "medium" },
      profile: baseProfile,
      primaryMood: "nostalgic",
      sceneType: "drive",
    });
    assert.equal(world.tag, "country_open_road");
  });
});
