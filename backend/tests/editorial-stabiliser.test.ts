/**
 * Unit tests for editorial consistency stabiliser.
 *
 * Run: npm run test:editorial-stabiliser
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHumanSaveabilityStabiliser,
  editorialStabilityScore,
  opening10EditorialStabilityPass,
  repetitionHardClamp,
  computeEditorialIdentitySignature,
} from "../core/editorial/human-saveability-stabiliser";
import type { SceneWorldContext } from "../core/scene-world-layer";
import { OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY, openingDominantClusterPurity } from "../core/scene-cohesion-clusters";

type TestTrack = {
  trackId: string;
  artistName: string;
  genreFamily: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
  clusterId: string;
};

function makeContext(trackIds: string[], dominantId = "cluster-a"): SceneWorldContext {
  const trackToClusterId = new Map<string, string>();
  for (const id of trackIds) {
    trackToClusterId.set(id, id.startsWith("b") ? "cluster-b" : dominantId);
  }
  return {
    active: true,
    strictMode: true,
    descriptor: { setting: "test", energy: "balanced", socialContext: "personal", season: null, timeOfDay: null },
    archetype: {
      id: "indie",
      label: "indie editorial",
      curatorVoice: "warm",
      genreFamilies: ["indie"],
      secondaryFamilies: [],
      texture: "balanced",
      energyArc: "rise",
      tempoBand: "mid",
      valenceBand: "neutral",
    },
    candidateArchetypes: [],
    anchors: [],
    anchorStats: { count: 0, meanEnergy: 0.5, meanValence: 0.5, meanDanceability: 0.5, meanAcousticness: 0.5 },
    sceneClusters: {
      dominantClusterId: dominantId,
      dominantCluster: { id: dominantId, label: "dominant", trackIds: new Set(trackIds), centroid: null },
      clusters: new Map([[dominantId, { id: dominantId, label: "dominant", trackIds: new Set(trackIds), centroid: null }]]),
      trackToClusterId,
      clusterPurity: 1,
      adjacencyEdgeCount: 0,
      coOccurrenceEdgeCount: 0,
    },
  } as unknown as SceneWorldContext;
}

function buildUnstableOpening(count: number): TestTrack[] {
  const tracks: TestTrack[] = [];
  for (let i = 0; i < count; i++) {
    const repeatArtist = i < 3 || i === 4;
    tracks.push({
      trackId: `a${i}`,
      artistName: repeatArtist ? "Repeat Artist" : `Artist ${i}`,
      genreFamily: "indie",
      energy: i % 5 === 0 ? 0.82 : i % 3 === 0 ? 0.28 : 0.52,
      valence: i < 5 ? 0.35 : 0.72,
      danceability: 0.5,
      acousticness: i % 4 === 0 ? 0.75 : 0.2,
      tempo: 110,
      clusterId: "cluster-a",
    });
  }
  return tracks;
}

function countArtistFirst15(tracks: TestTrack[], artist: string): number {
  const needle = artist.toLowerCase();
  return tracks.slice(0, 15).filter((t) => t.artistName.toLowerCase() === needle).length;
}

describe("editorial consistency stabiliser", () => {
  it("preserves opening-10 membership and cluster purity", () => {
    const tracks = buildUnstableOpening(22);
    const context = makeContext(tracks.map((t) => t.trackId));
    const beforeOpening = tracks.slice(0, 10).map((t) => t.trackId).sort();
    const result = applyHumanSaveabilityStabiliser({ tracks, context });
    const afterOpening = result.tracks.slice(0, 10).map((t) => t.trackId).sort();
    assert.deepEqual(afterOpening, beforeOpening);
    assert.ok(
      openingDominantClusterPurity(result.tracks, context, 10) >= OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
    );
  });

  it("reduces or maintains repetition in first 15", () => {
    const tracks = buildUnstableOpening(24);
    const context = makeContext(tracks.map((t) => t.trackId));
    const before = countArtistFirst15(tracks, "Repeat Artist");
    const result = applyHumanSaveabilityStabiliser({ tracks, context });
    const after = countArtistFirst15(result.tracks, "Repeat Artist");
    assert.ok(after <= before);
  });

  it("does not introduce cross-cluster contamination", () => {
    const tracks = buildUnstableOpening(18);
    tracks[17] = {
      ...tracks[17]!,
      trackId: "b17",
      clusterId: "cluster-b",
      artistName: "Cluster B Artist",
    };
    const context = makeContext(tracks.map((t) => t.trackId));
    const result = applyHumanSaveabilityStabiliser({ tracks, context });
    const beforeIds = new Set(tracks.map((t) => t.trackId));
    const afterIds = new Set(result.tracks.map((t) => t.trackId));
    assert.deepEqual(afterIds, beforeIds);
    for (const track of result.tracks) {
      const expected = track.trackId === "b17" ? "cluster-b" : "cluster-a";
      assert.equal(context.sceneClusters!.trackToClusterId.get(track.trackId), expected);
    }
  });

  it("emits editorial stability scores", () => {
    const tracks = buildUnstableOpening(20);
    const context = makeContext(tracks.map((t) => t.trackId));
    const signature = computeEditorialIdentitySignature(tracks, context);
    assert.ok(signature);
    const scores = editorialStabilityScore(tracks, context, signature);
    assert.ok(scores.identityDriftScore >= 0 && scores.identityDriftScore <= 1);
    assert.ok(scores.repetitionRiskScore >= 0 && scores.repetitionRiskScore <= 1);
    assert.ok(scores.arcStabilityScore >= 0 && scores.arcStabilityScore <= 1);
    assert.ok(scores.openingIntegrityScore >= 0 && scores.openingIntegrityScore <= 1);
  });

  it("rolls back when opening stability cannot improve", () => {
    const tracks = buildUnstableOpening(10);
    const context = makeContext(tracks.map((t) => t.trackId));
    const signature = computeEditorialIdentitySignature(tracks, context)!;
    const pass = opening10EditorialStabilityPass({ tracks, context, signature });
    assert.equal(pass.tracks.length, 10);
    const clamp = repetitionHardClamp({ tracks: pass.tracks, context });
    assert.equal(clamp.tracks.length, 10);
  });
});
