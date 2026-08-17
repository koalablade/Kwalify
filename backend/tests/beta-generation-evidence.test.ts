import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  buildArtistDiversity,
  buildBetaGenerationEvidence,
  formatEvidenceMarkdown,
  mapApiTracksToEvidence,
  mapFeedbackTypeToVerdict,
} from "../lib/beta-generation-evidence";
import { captureBetaFailureEvidenceFromGenerateExit } from "../lib/beta-evidence-store";
import { initGenerateObs, updateGenerateObs } from "../lib/generate-complete-log";

test("mapApiTracksToEvidence preserves full ordered list", () => {
  const tracks = mapApiTracksToEvidence([
    { id: "a1", name: "Track One", artist: "Artist A", album: "Album A", durationMs: 200000, releaseYear: 2019 },
    { trackId: "b2", trackName: "Track Two", artistName: "Artist B", albumName: "Album B" },
  ]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0]?.position, 1);
  assert.equal(tracks[1]?.spotifyUri, "spotify:track:b2");
});

test("buildBetaGenerationEvidence is self-contained", () => {
  const record = buildBetaGenerationEvidence({
    requestId: "req-123",
    userTag: "sha256:abc123def456",
    prompt: "cozy sunday morning coffee",
    mode: "balanced",
    noLibraryMode: false,
    requestedTrackCount: 25,
    tracks: Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      name: `Song ${i}`,
      artist: i < 4 ? "Repeat Artist" : `Artist ${i}`,
      album: "Album",
    })),
    playlistTitle: "Sunday Coffee",
    honestPartial: true,
    interpretation: { worldId: "sunday_chill_world" },
    playlistExecutionTrace: {
      requestId: "req-123",
      prompt: "cozy sunday morning coffee",
      seed: null,
      executionPath: "full_pipeline",
      humanSaveable: true,
      stageAttribution: {} as never,
      dominantCluster: null,
      openingTenClusterTrace: [],
      rejectionReasons: [],
      funnelCollapseStage: null,
      fastFallbackUsed: false,
      curatorScore: null,
      editorialLayer: null,
      editorialStabiliser: null,
      intentCollapseLayer: null,
      trackCounts: { retrieved: 400, after_world: 80, after_sampler: 40, final: 12 },
      debugFlags: { gateExecuted: true, gateBypassed: false, timeoutOccurred: false },
    },
    appVersion: "1.0.0",
  });
  assert.equal(record.generationEvidenceId, "req-123");
  assert.equal(record.userTag, "sha256:abc123def456");
  assert.equal(record.tracks.length, 12);
  assert.equal(record.playlist.outcome, "partial");
  assert.ok(record.artistDiversity.repeatedArtists.some((r) => r.artist === "repeat artist"));
  const md = formatEvidenceMarkdown(record);
  assert.match(md, /cozy sunday morning coffee/);
  assert.match(md, /12\. Song 11/);
});

test("buildArtistDiversity counts repeats", () => {
  const diversity = buildArtistDiversity([
    { position: 1, name: "A", artists: ["X"], album: null, spotifyId: "1", spotifyUri: "spotify:track:1", durationMs: null, releaseYear: null },
    { position: 2, name: "B", artists: ["X"], album: null, spotifyId: "2", spotifyUri: "spotify:track:2", durationMs: null, releaseYear: null },
    { position: 3, name: "C", artists: ["Y"], album: null, spotifyId: "3", spotifyUri: "spotify:track:3", durationMs: null, releaseYear: null },
  ]);
  assert.equal(diversity.uniqueArtistCount, 2);
  assert.equal(diversity.maxTracksPerArtist, 2);
});

test("mapFeedbackTypeToVerdict maps captured/save/missed", () => {
  assert.equal(mapFeedbackTypeToVerdict("captured"), "good");
  assert.equal(mapFeedbackTypeToVerdict("save"), "good");
  assert.equal(mapFeedbackTypeToVerdict("missed"), "bad");
  assert.equal(mapFeedbackTypeToVerdict("skip"), null);
});

test("formatEvidenceMarkdown includes feedback verdict and reasons", () => {
  const record = buildBetaGenerationEvidence({
    requestId: "req-999",
    userTag: "sha256:feedface0001",
    prompt: "late night drive",
    mode: "balanced",
    noLibraryMode: false,
    requestedTrackCount: 20,
    tracks: [{ id: "t1", name: "Song", artist: "Artist", album: "Album" }],
  });
  const md = formatEvidenceMarkdown(record, {
    kind: "feedback",
    generationEvidenceId: "req-999",
    requestId: "req-999",
    recordedAt: "2026-08-17T10:00:00.000Z",
    verdict: "mixed",
    reasons: ["tail", "sequencing"],
    opinion: "Strong opener, weak finish.",
  });
  assert.match(md, /verdict: mixed/);
  assert.match(md, /reasons: tail, sequencing/);
  assert.match(md, /sha256:feedface0001/);
});

test("captureBetaFailureEvidenceFromGenerateExit falls back to generate obs context", async () => {
  process.env.BETA_EVIDENCE_CAPTURE = "1";
  process.env.BETA_EVIDENCE_DIR = "reports/beta-generations-test-unit";
  const req = { id: "req-fallback" } as Request;
  initGenerateObs(req, Date.now());
  updateGenerateObs(req, {
    requestId: "gen-req-fallback-001",
    prompt: "empty pool failure prompt",
    mode: "balanced",
    noLibraryMode: false,
    requestedLength: 25,
  });

  const { readFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = process.env.BETA_EVIDENCE_DIR!;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);

  captureBetaFailureEvidenceFromGenerateExit(req, {
    failureCode: "EMPTY_PLAYLIST",
    trace: {
      requestId: "unknown",
      prompt: "",
      seed: null,
      executionPath: "full_pipeline",
      humanSaveable: false,
      stageAttribution: {} as never,
      dominantCluster: null,
      openingTenClusterTrace: [],
      rejectionReasons: ["empty_final_pool"],
      funnelCollapseStage: "final_filter",
      fastFallbackUsed: false,
      curatorScore: null,
      editorialLayer: null,
      editorialStabiliser: null,
      intentCollapseLayer: null,
      trackCounts: { retrieved: 100, after_world: 20, after_sampler: 0, final: 0 },
      debugFlags: { gateExecuted: true, gateBypassed: false, timeoutOccurred: false },
    },
    userTag: "sha256:testuser01",
  });

  await new Promise((r) => setTimeout(r, 300));
  const raw = await readFile(join(dir, "evidence.jsonl"), "utf8");
  const row = JSON.parse(raw.trim().split(/\r?\n/).at(-1)!);
  assert.equal(row.requestId, "gen-req-fallback-001");
  assert.equal(row.prompt.raw, "empty pool failure prompt");
  assert.equal(row.playlist.outcome, "failure");
  assert.equal(row.pipeline.failureCode, "EMPTY_PLAYLIST");
});
