import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySubSceneRetrievalTexture,
  buildSubSceneRetrievalPlan,
  detectSubSceneRetrievalKind,
  mergeSubSceneIntoSamplerSelection,
  preferSubSceneSoftUniverse,
  selectSubSceneNeighbourhood,
} from "../core/v3/subscene-retrieval";
import { buildLockedIntent } from "../core/v3/intent";
import {
  enrichIntentCollapseTrack,
  type EditorialIntentVector,
  type IntentCollapseTrack,
} from "../core/editorial/intent-collapse-layer";

function track(partial: Partial<IntentCollapseTrack> & { trackId: string }): IntentCollapseTrack {
  return enrichIntentCollapseTrack({
    trackId: partial.trackId,
    artistName: partial.artistName ?? "Artist",
    energy: partial.energy ?? 0.4,
    valence: partial.valence ?? 0.4,
    danceability: partial.danceability ?? 0.55,
    acousticness: partial.acousticness ?? 0.15,
    tempo: partial.tempo ?? 120,
    instrumentalness: partial.instrumentalness ?? 0.4,
    genreFamily: partial.genreFamily ?? "electronic",
    genrePrimary: partial.genrePrimary ?? "electronic",
  });
}

const baseIntent: EditorialIntentVector = {
  primaryMood: "reflective",
  energyRange: [0.22, 0.48],
  valenceTarget: -0.1,
  rhythmDensityCap: 0.42,
  vocalPresenceTarget: 0.55,
  nostalgiaBias: 0.35,
  sonicAggressionCeiling: 0.28,
  sceneType: "study",
  editorialWorldTag: "focus_study",
  allowedMicroClusters: ["electronic:balanced", "indie:balanced"],
};

describe("subscene-retrieval", () => {
  it("detects soft electronic aftermath for rave comedown", () => {
    const locked = buildLockedIntent("rave comedown bus home");
    assert.equal(detectSubSceneRetrievalKind("rave comedown bus home", locked), "soft_electronic_aftermath");
  });

  it("does not activate for gym peak prompts", () => {
    const locked = buildLockedIntent("heavy lifting gym pump aggressive");
    assert.equal(detectSubSceneRetrievalKind("heavy lifting gym pump aggressive", locked), "none");
  });

  it("raises texture caps and injects soft-remnant electronic neighbourhood", () => {
    const library = [
      track({ trackId: "e1", energy: 0.58, genreFamily: "electronic", danceability: 0.66, acousticness: 0.1 }),
      track({ trackId: "e2", energy: 0.61, genreFamily: "electronic", danceability: 0.63, acousticness: 0.12 }),
      track({ trackId: "e3", energy: 0.78, genreFamily: "electronic", danceability: 0.7, acousticness: 0.08 }),
      track({
        trackId: "i1",
        energy: 0.3,
        genreFamily: "indie",
        danceability: 0.4,
        acousticness: 0.7,
        instrumentalness: 0,
      }),
      track({
        trackId: "i2",
        energy: 0.36,
        genreFamily: "indie",
        danceability: 0.55,
        acousticness: 0.22,
        instrumentalness: 0.35,
      }),
    ];
    const locked = buildLockedIntent("rave comedown bus home");
    const plan = buildSubSceneRetrievalPlan({
      vibe: "rave comedown bus home",
      lockedIntent: locked,
      libraryTracks: library,
      targetCount: 25,
    });
    assert.equal(plan.kind, "soft_electronic_aftermath");
    assert.ok((plan.energyHi ?? 0) > 0.52);
    assert.ok((plan.energyHi ?? 1) <= 0.62);
    assert.ok((plan.sonicAggressionCeiling ?? 0) >= 0.5);

    const textured = applySubSceneRetrievalTexture(baseIntent, plan);
    assert.ok(textured.sonicAggressionCeiling >= 0.52);
    assert.ok(textured.rhythmDensityCap >= 0.62);
    assert.ok(textured.energyRange[1] >= (plan.energyHi ?? 0));

    const neighbourhood = selectSubSceneNeighbourhood(library, textured, plan);
    assert.ok(neighbourhood.some((t) => t.trackId === "e1"));
    assert.ok(neighbourhood.some((t) => t.trackId === "i2"));
    assert.ok(!neighbourhood.some((t) => t.trackId === "e3"));
    assert.ok(!neighbourhood.some((t) => t.trackId === "i1"));

    const merged = mergeSubSceneIntoSamplerSelection(
      {
        selected: [library[3]!],
        scores: new Map([["i1", 0.8]]),
        avgScore: 0.8,
        minScoreUsed: 0.8,
        rankedTotal: 1,
      },
      neighbourhood,
      textured,
      plan,
    );
    assert.ok(merged.selected.some((t) => t.trackId === "e1"));
    assert.ok(merged.selected.some((t) => t.trackId === "i2"));

    const preferred = preferSubSceneSoftUniverse(merged, plan, 25);
    assert.ok(preferred.selected.some((t) => t.trackId === "e1"));
    assert.ok(preferred.selected.some((t) => t.trackId === "i2"));
    assert.ok(!preferred.selected.some((t) => t.trackId === "e3"));
  });

  it("does not open peak electronic energyHi when soft supply is empty", () => {
    const library = Array.from({ length: 20 }, (_, i) =>
      track({
        trackId: `peak-${i}`,
        energy: 0.68 + i * 0.01,
        genreFamily: "electronic",
        danceability: 0.72,
        acousticness: 0.1,
      }),
    );
    const locked = buildLockedIntent("rave comedown bus home");
    const plan = buildSubSceneRetrievalPlan({
      vibe: "rave comedown bus home",
      lockedIntent: locked,
      libraryTracks: library,
      targetCount: 25,
    });
    assert.equal(plan.kind, "soft_electronic_aftermath");
    assert.ok((plan.energyHi ?? 1) <= 0.62);
  });
});
