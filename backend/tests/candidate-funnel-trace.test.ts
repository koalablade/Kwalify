import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleCandidateFunnel,
  buildCandidateFunnelFromGenerationAudit,
  createCandidateFunnelObserver,
  funnelIsIncomplete,
  inferFunnelDropStage,
  playlistUrisFromTracks,
} from "../lib/candidate-funnel-trace";
import { applyDeliveryPerPlaylistArtistCap } from "../lib/playlist-artist-cap";
import { evaluateFromApiResponse } from "../lib/human-quality-evaluator/evidence-ingest";

function completeSources(overrides: Record<string, unknown> = {}) {
  return {
    requestedLength: 25,
    deliveredLength: 14,
    librarySize: 9665,
    retrieved: 80,
    relevantToPrompt: 439,
    worldAdmitted: 40,
    artistCapRemovals: 0,
    duplicateRemovals: 0,
    eraMismatchRemovals: 0,
    worldMismatchRemovals: 0,
    negativeConstraintRemovals: 0,
    compositionCandidates: 22,
    refillAttempts: 0,
    refillAdded: 0,
    finalTrackUris: ["spotify:track:aaa", "spotify:track:bbb"],
    ...overrides,
  };
}

test("instrumentation copies URIs and does not mutate the selected-track array", () => {
  const tracks = Object.freeze([
    { id: "aaa", name: "A", artist: "One" },
    { id: "bbb", name: "B", artist: "Two" },
  ]);
  const uris = playlistUrisFromTracks(tracks);
  const funnel = assembleCandidateFunnel(completeSources({ finalTrackUris: uris }));
  uris.push("spotify:track:mutated");
  assert.deepEqual(funnel.finalTrackUris, ["spotify:track:aaa", "spotify:track:bbb"]);
  assert.deepEqual(tracks.map((t) => t.id), ["aaa", "bbb"]);
});

test("observing artist-cap dropped counts does not change selected tracks", () => {
  const tracks = [
    { trackId: "1", artistName: "Bon Iver" },
    { trackId: "2", artistName: "Bon Iver" },
    { trackId: "3", artistName: "Bon Iver" },
    { trackId: "4", artistName: "The National" },
  ];
  const without = applyDeliveryPerPlaylistArtistCap(tracks, {
    vibe: "2000s indie",
    playlistSize: 25,
    defaultCap: 2,
  });
  const observer = createCandidateFunnelObserver();
  const withObs = applyDeliveryPerPlaylistArtistCap(tracks, {
    vibe: "2000s indie",
    playlistSize: 25,
    defaultCap: 2,
  });
  observer.recordArtistCap(withObs.diagnostics.dropped);
  assert.deepEqual(
    withObs.tracks.map((t) => t.trackId),
    without.tracks.map((t) => t.trackId),
  );
  assert.equal(observer.artistCapRemovals, withObs.diagnostics.dropped);
  assert.ok(withObs.diagnostics.dropped >= 1);
});

test("retrieved vs admitted vs rejected are distinct actual counts", () => {
  const funnel = assembleCandidateFunnel(completeSources({
    retrieved: 100,
    worldAdmitted: 40,
  }));
  assert.equal(funnel.retrieved.status, "actual");
  assert.equal(funnel.retrieved.value, 100);
  assert.equal(funnel.worldAdmitted.status, "actual");
  assert.equal(funnel.worldAdmitted.value, 40);
  assert.equal(funnel.rejected.status, "actual");
  assert.equal(funnel.rejected.value, 60);
  assert.equal(funnel.completeness, "complete");
});

test("missing sources stay unknown rather than 0", () => {
  const funnel = assembleCandidateFunnel({
    requestedLength: 25,
    deliveredLength: 14,
  });
  assert.equal(funnel.retrieved.status, "unknown");
  assert.equal(funnel.retrieved.value, null);
  assert.notEqual(funnel.retrieved.value, 0);
  assert.equal(funnelIsIncomplete(funnel), true);
  assert.ok(funnel.missingFields.includes("retrieved"));
});

test("artist-cap rejection is visible separately from refill failure", () => {
  const capFunnel = assembleCandidateFunnel(completeSources({
    retrieved: 80,
    relevantToPrompt: 80,
    worldAdmitted: 70,
    compositionCandidates: 40,
    deliveredLength: 14,
    artistCapRemovals: 26,
    refillAttempts: 0,
    refillAdded: 0,
  }));
  assert.equal(capFunnel.artistCapRemovals.value, 26);
  assert.equal(capFunnel.refillAttempts.value, 0);
  assert.equal(inferFunnelDropStage(capFunnel).primary, "artist_cap");

  const refillFunnel = assembleCandidateFunnel(completeSources({
    retrieved: 80,
    relevantToPrompt: 80,
    worldAdmitted: 70,
    compositionCandidates: 70,
    deliveredLength: 14,
    artistCapRemovals: 0,
    refillAttempts: 3,
    refillAdded: 0,
  }));
  assert.equal(refillFunnel.artistCapRemovals.value, 0);
  assert.equal(refillFunnel.refillAttempts.value, 3);
  assert.equal(refillFunnel.refillAdded.value, 0);
  assert.equal(inferFunnelDropStage(refillFunnel).primary, "refill_failed");
});

test("library-wide world filter is not treated as retrieval-pool admission", () => {
  const funnel = buildCandidateFunnelFromGenerationAudit({
    requestedLength: 25,
    deliveredLength: 8,
    librarySize: 9658,
    retrievalFunnel: {
      stages: {
        totalLibrary: 9658,
        afterGenreFilter: 9205,
        afterArtistIdentityFilter: 9205,
        afterWorldFilter: 9205,
        afterScoring: 1665,
        afterFinalGate: 1665,
      },
    },
    deliveryLossFunnel: {
      orchestratorFinal: 1665,
      v3PreFilterSurvivors: 187,
      v3Composed: 25,
      postPurity: 17,
      postTerminal: 10,
    },
    validCandidateSupply: { strictValidCount: 45 },
    observerActive: true,
    observer: createCandidateFunnelObserver(),
    finalTrackUris: ["spotify:track:aaa"],
  });
  assert.equal(funnel.retrieved.value, 1665);
  assert.equal(funnel.worldAdmitted.status, "unknown");
  assert.equal(funnel.worldFilterDropped.status, "actual");
  assert.equal(funnel.worldFilterDropped.value, 0);
  assert.equal(funnel.v3PreFilter.value, 187);
  assert.equal(inferFunnelDropStage(funnel).primary, "world_filter_noop");
});

test("zero retrieval counts with delivered tracks are marked unknown", () => {
  const funnel = buildCandidateFunnelFromGenerationAudit({
    requestedLength: 25,
    deliveredLength: 14,
    librarySize: 9665,
    retrievalFunnel: {
      stages: {
        totalLibrary: 9665,
        afterGenreFilter: 0,
        afterArtistIdentityFilter: 0,
        afterWorldFilter: 0,
        afterScoring: 0,
        afterFinalGate: 0,
      },
    },
    deliveryLossFunnel: { orchestratorFinal: 0, v3Composed: 0 },
    validCandidateSupply: { strictValidCount: 439 },
    observerActive: true,
    observer: createCandidateFunnelObserver(),
    finalTrackUris: ["spotify:track:aaa"],
  });
  assert.equal(funnel.retrieved.status, "unknown");
  assert.equal(funnel.completeness !== "complete", true);
  assert.equal(inferFunnelDropStage(funnel).primary, "unknown");
});

test("evaluateFromApiResponse keeps selected track ids when funnel is attached", () => {
  const funnel = assembleCandidateFunnel(completeSources({
    finalTrackUris: ["spotify:track:keep-1", "spotify:track:keep-2"],
  }));
  const evaluated = evaluateFromApiResponse({
    requestId: "obs-1",
    vibe: "indie rock",
    length: 25,
    tracks: [
      { id: "keep-1", name: "Song 1", artist: "A" },
      { id: "keep-2", name: "Song 2", artist: "B" },
    ],
    playlistExecutionTrace: {
      executionPath: "gate_failure",
      stageAttribution: { retrieval: { status: "skipped" }, scene_world: { status: "skipped" } },
      trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: 2 },
    },
    candidateFunnel: funnel,
  });
  assert.deepEqual(evaluated.tracks.map((t) => t.spotifyId), ["keep-1", "keep-2"]);
  assert.equal((evaluated.pipeline as { candidateFunnel?: { version: number } }).candidateFunnel?.version, 1);
});

test("2000s indie length collapse is v3 prefilter, not artist-cap or world admission", () => {
  const funnel = buildCandidateFunnelFromGenerationAudit({
    requestedLength: 25,
    deliveredLength: 3,
    librarySize: 9658,
    retrievalFunnel: {
      stages: {
        totalLibrary: 9658,
        afterGenreFilter: 9205,
        afterArtistIdentityFilter: 9205,
        afterWorldFilter: 9205,
        afterScoring: 1665,
        afterFinalGate: 1665,
      },
    },
    deliveryLossFunnel: {
      orchestratorFinal: 1665,
      v3PreFilterSurvivors: 20,
      v3Composed: 25,
      postPurity: 5,
      postTerminal: 3,
    },
    validCandidateSupply: { strictValidCount: 130 },
    observerActive: true,
    observer: createCandidateFunnelObserver(),
    finalTrackUris: ["spotify:track:aaa"],
  });
  assert.equal(funnel.worldAdmitted.status, "unknown");
  assert.equal(funnel.worldFilterDropped.value, 0);
  assert.equal(funnel.v3PreFilter.value, 20);
  assert.equal(funnel.artistCapRemovals.value, 0);
  assert.equal(inferFunnelDropStage(funnel).primary, "v3_prefilter");
});

test("indie rock 25 composed to 14 delivered is post-composition trim", () => {
  const observer = createCandidateFunnelObserver();
  observer.recordRefill(true, 10);
  const funnel = buildCandidateFunnelFromGenerationAudit({
    requestedLength: 25,
    deliveredLength: 14,
    librarySize: 9658,
    retrievedFallback: 1665,
    deliveryLossFunnel: {
      orchestratorFinal: 1665,
      v3PreFilterSurvivors: 250,
      v3Composed: 25,
      postPurity: 25,
      postTerminal: 25,
    },
    validCandidateSupply: { strictValidCount: 460 },
    observerActive: true,
    observer,
    finalTrackUris: ["spotify:track:aaa"],
  });
  assert.equal(funnel.completeness, "complete");
  assert.equal(funnel.compositionCandidates.value, 25);
  assert.equal(funnel.artistCapRemovals.value, 0);
  assert.equal(funnel.refillAdded.value, 10);
  assert.equal(inferFunnelDropStage(funnel).primary, "post_composition_trim");
});

test("library-wide relevant count does not classify a near-full playlist as retrieval starvation", () => {
  const funnel = assembleCandidateFunnel(completeSources({
    retrieved: 555,
    relevantToPrompt: 9658,
    librarySize: 9658,
    worldAdmitted: 40,
    compositionCandidates: 25,
    deliveredLength: 23,
    artistCapRemovals: 0,
    refillAttempts: 0,
    refillAdded: 0,
  }));
  assert.notEqual(inferFunnelDropStage(funnel).primary, "library_never_retrieved");
});
