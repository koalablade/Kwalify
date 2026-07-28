import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginRetrievalFunnelTrace,
  recordFunnelStage,
  finalizeRetrievalFunnel,
  markFunnelRecovery,
} from "../core/editorial/retrieval-funnel-trace";
import { resolveWorldSearchKeywords, isUnknownGenreMetadata } from "../core/editorial/world-search-keywords";
import { computeRetrievalConfidence } from "../core/editorial/world-coverage";
import { getCulturalProfile, resolveCommittedWorld } from "../core/committed-world";
import {
  runLayeredWorldRetrieval,
  runNonePlaylistRecovery,
} from "../core/editorial/layered-world-retrieval";
import { retrieveScoringCandidates } from "../lib/candidate-retrieval-pipeline";
import type { EmotionProfile } from "../lib/emotion";

const emotionProfile: EmotionProfile = {
  energy: 0.6,
  valence: 0.5,
  tension: 0.4,
  nostalgia: 0.3,
  calm: 0.4,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

describe("V15 retrieval funnel", () => {
  it("funnel trace records stages", () => {
    beginRetrievalFunnelTrace(9000);
    recordFunnelStage("afterGenreFilter", 8200);
    recordFunnelStage("afterArtistIdentityFilter", 7800);
    recordFunnelStage("afterWorldFilter", 420);
    recordFunnelStage("afterScoring", 280);
    markFunnelRecovery("recovery_identity");
    const funnel = finalizeRetrievalFunnel(18);

    assert.ok(funnel);
    assert.equal(funnel!.stages.totalLibrary, 9000);
    assert.equal(funnel!.stages.afterGenreFilter, 8200);
    assert.equal(funnel!.stages.afterArtistIdentityFilter, 7800);
    assert.equal(funnel!.stages.afterWorldFilter, 420);
    assert.equal(funnel!.stages.afterScoring, 280);
    assert.equal(funnel!.stages.afterFinalGate, 18);
    assert.equal(funnel!.recoveryTriggered, true);
    assert.equal(funnel!.recoveryLayer, "recovery_identity");
  });

  it("motorway rain uses world keywords not emotion", () => {
    const keywords = resolveWorldSearchKeywords(
      "empty motorway at midnight rain on the windscreen",
      "rainy_motorway_world",
    );
    assert.ok(keywords.includes("night drive"));
    assert.ok(keywords.includes("synth") || keywords.includes("new wave"));
    assert.ok(!keywords.includes("sad"));
    assert.ok(!keywords.includes("chill"));
    assert.ok(!keywords.includes("indie"));
  });

  it("gym aggressive uses metal/rock keywords not emotion", () => {
    const keywords = resolveWorldSearchKeywords("heavy gym workout aggressive", "gym_rock_world");
    assert.ok(keywords.includes("metal") || keywords.includes("hard rock"));
    assert.ok(!keywords.includes("high energy"));
    assert.ok(!keywords.includes("sad"));
  });

  it("unknown genre is not treated as indie", () => {
    assert.equal(isUnknownGenreMetadata(null, null), true);
    assert.equal(isUnknownGenreMetadata("unknown", null), true);
    assert.equal(isUnknownGenreMetadata("indie", "alternative"), false);
  });

  it("retrievalConfidence tiers map to candidate counts", () => {
    const profile = getCulturalProfile("dad_rock_world")!;
    const strongPool = Array.from({ length: 22 }, (_, i) => ({
      artistName: i < 10 ? "Queen" : "Tom Petty",
      trackName: `Track ${i + 1}`,
      energy: 0.72,
    }));
    const strong = computeRetrievalConfidence(strongPool, profile);
    assert.ok(strong.score >= 70);
    assert.equal(strong.tier, "HIGH");
    assert.equal(strong.refuse, false);

    const partialPool = Array.from({ length: 8 }, (_, i) => ({
      artistName: "Queen",
      trackName: `Partial ${i + 1}`,
      energy: 0.7,
    }));
    const partial = computeRetrievalConfidence(partialPool, profile);
    assert.ok(partial.score >= 40);
    assert.equal(partial.tier, "LOW");

    const empty = computeRetrievalConfidence([], profile);
    assert.equal(empty.tier, "NONE");
    assert.equal(empty.refuse, true);
  });

  it("layered retrieval finds anchors from mock library", () => {
    const world = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    const profile = getCulturalProfile(world.id)!;
    const library = [
      { trackId: "t0", artistName: "Queen", trackName: "Song", albumName: "Album", energy: 0.7 },
      { trackId: "t1", artistName: "Tom Petty", trackName: "Song", albumName: "Album", energy: 0.7 },
      { trackId: "t2", artistName: "Bon Iver", trackName: "Song", albumName: "Album", energy: 0.4 },
    ];
    const result = runLayeredWorldRetrieval({
      prompt: "dad rock BBQ with beers",
      userLibrary: library,
      culturalProfile: profile,
      committedWorld: world,
    });
    assert.ok(result.tracks.length >= 2);
    assert.ok(result.tracks.some((t) => t.artistName === "Queen"));
    assert.ok(!result.tracks.some((t) => t.artistName === "Bon Iver"));
  });

  it("none recovery runs before empty return", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile(world.id)!;
    const library = [
      { trackId: "t0", artistName: "The Cure", trackName: "Heaven", albumName: "Album", energy: 0.6 },
      { trackId: "t1", artistName: "Pet Shop Boys", trackName: "West End", albumName: "Album", energy: 0.6 },
    ];
    const recovery = runNonePlaylistRecovery({
      prompt: "80s night drive",
      userLibrary: library,
      culturalProfile: profile,
      committedWorld: world,
    });
    assert.ok(recovery.tracks.length >= 2);
    assert.equal(recovery.recoveryUsed, true);
  });

  it("unknown genre artist retained in retrieval pipeline", () => {
    const world = resolveCommittedWorld({ prompt: "madchester pub walk" })!;
    const tracks = [{
      trackId: "oasis1",
      trackName: "Wonderwall",
      artistName: "Oasis",
      albumName: "Album",
      energy: 0.7,
      valence: 0.5,
      danceability: 0.5,
    }];
    const classMap = new Map([
      ["oasis1", { genrePrimary: "unknown", genreFamily: "unknown", primarySubgenre: "", secondarySubgenre: null, subGenres: [] }],
    ]);
    const result = retrieveScoringCandidates({
      tracks,
      vibe: "madchester pub walk",
      intent: { genreFamilies: [], primaryGenres: [], mood: [] },
      emotionProfile,
      classMap,
      requestedLength: 25,
      sceneActive: true,
      activeWorldIds: world.worldIds,
    });
    assert.ok(result.tracks.length >= 1);
    assert.equal(result.tracks[0]!.artistName, "Oasis");
  });
});
