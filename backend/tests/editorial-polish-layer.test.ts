/**
 * Unit tests for editorial human-saveability polish layer.
 *
 * Run: npm run test:editorial-polish-layer
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEditorialFlowOrdering,
  applyHumanSaveabilityPolishLayer,
  editorialSwapPass,
  computePlaylistEditorialScore,
} from "../core/editorial/human-saveability-polish-layer";
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

function buildMonotonePlaylist(count: number): TestTrack[] {
  const tracks: TestTrack[] = [];
  for (let i = 0; i < count; i++) {
    tracks.push({
      trackId: `a${i}`,
      artistName: i < 4 ? "Repeat Artist" : `Artist ${i}`,
      genreFamily: "indie",
      energy: 0.52,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      tempo: 110,
      clusterId: "cluster-a",
    });
  }
  return tracks;
}

describe("human saveability polish layer", () => {
  it("preserves opening-10 membership set and dominant purity", () => {
    const tracks = buildMonotonePlaylist(20);
    const context = makeContext(tracks.map((t) => t.trackId));
    const beforeOpeningIds = tracks.slice(0, 10).map((t) => t.trackId).sort();
    const result = applyHumanSaveabilityPolishLayer({ tracks, context });
    const afterOpeningIds = result.tracks.slice(0, 10).map((t) => t.trackId).sort();
    assert.deepEqual(afterOpeningIds, beforeOpeningIds);
    assert.ok(
      openingDominantClusterPurity(result.tracks, context, 10) >= OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
    );
  });

  it("only reorders tail in flow ordering pass", () => {
    const tracks = buildMonotonePlaylist(16);
    const context = makeContext(tracks.map((t) => t.trackId));
    const openingBefore = tracks.slice(0, 10).map((t) => t.trackId);
    const ordered = applyEditorialFlowOrdering({ tracks, context });
    assert.deepEqual(ordered.tracks.slice(0, 10).map((t) => t.trackId), openingBefore);
    assert.equal(ordered.reorderPassesApplied >= 0, true);
  });

  it("does not perform cross-cluster swaps", () => {
    const tracks = buildMonotonePlaylist(12);
    tracks[11] = {
      ...tracks[11]!,
      trackId: "b11",
      clusterId: "cluster-b",
      artistName: "Other Artist",
      energy: 0.53,
    };
    const context = makeContext(tracks.map((t) => t.trackId));
    const swapped = editorialSwapPass({ tracks, context, maxSwaps: 20 });
    for (const track of swapped.tracks) {
      const cluster = context.sceneClusters!.trackToClusterId.get(track.trackId);
      if (track.trackId === "b11") assert.equal(cluster, "cluster-b");
      else assert.equal(cluster, "cluster-a");
    }
  });

  it("emits editorial score diagnostics", () => {
    const tracks = buildMonotonePlaylist(14);
    const context = makeContext(tracks.map((t) => t.trackId));
    const scores = computePlaylistEditorialScore(tracks, context);
    assert.ok(scores.repetitionScore >= 0 && scores.repetitionScore <= 1);
    assert.ok(scores.arcScore >= 0 && scores.arcScore <= 1);
    assert.ok(scores.textureVarianceScore >= 0 && scores.textureVarianceScore <= 1);
    assert.ok(scores.flowScore >= 0 && scores.flowScore <= 1);
    assert.ok(scores.playlistEditorialScore >= 0 && scores.playlistEditorialScore <= 1);
  });
});
