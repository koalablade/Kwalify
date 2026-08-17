import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnose100GenerationRecords } from "../lib/human-quality-evaluator/forensic-analysis";
import type { Benchmark100GenerationRecord as Rec } from "../lib/human-quality-evaluator/benchmark-100";
import { createMockSpotifyQaAdapter } from "../lib/human-quality-evaluator/spotify-qa-adapter";
import {
  cleanupQaPlaylists,
  publishQaPlaylists,
  qaPlaylistDescription,
  qaPlaylistName,
} from "../lib/human-quality-evaluator/spotify-qa";
import { loadQaRegistry } from "../lib/human-quality-evaluator/spotify-qa-registry";
import { screenPlaylist } from "../lib/human-quality-evaluator/qa-screen";
import { formatHumanCalibration } from "../lib/human-quality-evaluator/spotify-qa";

function rec(partial: {
  promptId: string;
  prompt: string;
  category: Rec["runItem"]["category"];
  requestId?: string;
  tracks: Array<{ name: string; artist: string; year?: number; id?: string }>;
  httpStatus?: number;
  error?: string | null;
  path?: string;
}): Rec {
  const tracks = partial.tracks.map((t, i) => ({
    position: i + 1,
    name: t.name,
    artist: t.artist,
    album: null,
    spotifyId: t.id ?? `id-${partial.promptId}-${i}`,
    releaseYear: t.year ?? null,
  }));
  return {
    benchmarkRunId: "hq100-test",
    runItem: {
      runIndex: 0,
      seed: 1,
      promptId: partial.promptId,
      prompt: partial.prompt,
      category: partial.category,
      difficulty: "normal",
      requestId: partial.requestId ?? `req-${partial.promptId}`,
    },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    httpStatus: partial.httpStatus ?? 200,
    success: tracks.length > 0,
    error: partial.error ?? null,
    commit: "test",
    rawResponse: null,
    evaluated: {
      source: "api_response",
      requestId: partial.requestId ?? `req-${partial.promptId}`,
      prompt: partial.prompt,
      commit: "test",
      capturedAt: null,
      mode: "balanced",
      interpretation: {},
      pipeline: {
        executionPath: partial.path ?? "full_pipeline",
        humanSaveable: true,
        curatorScore: 1,
        rejectionReasons: [],
        stageAttribution: { retrieval: { status: "skipped" } },
        trackCounts: { retrieved: 0, final: tracks.length },
      },
      tracks,
      userFeedback: null,
      automated: {
        evaluatorVersion: "human-quality-evaluator-v1",
        auditedAt: new Date().toISOString(),
        automatedHypothesis: {
          humanQuality: "strong",
          momentFidelity: "strong",
          musicalCoherence: "strong",
          taste: "strong",
          sequencing: "mixed",
          reliability: "strong",
        },
        hcs: { totalScore: 85, wouldPressPlay: "YES", wouldSave: "YES", wouldShare: "MAYBE", aiObviousness: "LOW" },
        independentVerifier: { playlistVerdict: "strong", misfitCount: 0, failureReasons: [], topRoiFailures: [] },
        constraints: [],
        segments: [],
        outliers: [],
        artistDiversity: { uniqueArtists: 1, maxPerArtist: 1, repeatedArtists: [], suspiciousRepetition: false },
        underfill: { requested: 25, delivered: tracks.length, honestPartial: tracks.length < 25, outcome: tracks.length ? "partial" : "failure" },
        failureClasses: [],
        signalProvenance: { direct: [], inferred: [], proxy: [], unavailable: [] },
      },
      humanReview: null,
      calibration: { agreement: "no_human" },
    },
  };
}

function fixtureRecords(): Rec[] {
  return [
    rec({
      promptId: "genre-shoegaze",
      prompt: "shoegaze",
      category: "genre",
      tracks: [
        { name: "Back In Black", artist: "AC/DC", year: 1980, id: "acdc1" },
        { name: "Paradise City", artist: "Guns N' Roses", year: 1987, id: "gnr1" },
      ],
    }),
    rec({
      promptId: "act-gym",
      prompt: "gym workout",
      category: "activity",
      tracks: [],
      httpStatus: 422,
      error: "HUMAN_QUALITY_GATE_REFUSED",
      path: "unknown_exit",
    }),
    rec({
      promptId: "mood-melancholic",
      prompt: "melancholic",
      category: "mood",
      tracks: Array.from({ length: 24 }, (_, i) => ({ name: `M${i}`, artist: `A${i}`, id: `m${i}` })),
    }),
  ];
}

test("QA tooling source does not import generation engine modules", () => {
  const files = [
    "backend/lib/human-quality-evaluator/spotify-qa.ts",
    "backend/lib/human-quality-evaluator/spotify-qa-adapter.ts",
    "backend/lib/human-quality-evaluator/spotify-qa-live.ts",
    "backend/lib/human-quality-evaluator/spotify-qa-registry.ts",
    "backend/lib/human-quality-evaluator/qa-screen.ts",
    "backend/lib/human-quality-evaluator/library-opportunity.ts",
    "backend/lib/human-quality-evaluator/library-snapshot.ts",
    "backend/lib/human-quality-evaluator/gold-set.ts",
    "backend/lib/human-quality-evaluator/investigation.ts",
  ];
  const forbidden = [
    "generation.controller",
    "playlist-pipeline",
    "world-gate",
    "human-quality-gate",
    "constraint-aware-retrieval",
  ];
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    for (const needle of forbidden) {
      assert.equal(src.includes(needle), false, `${file} must not import ${needle}`);
    }
  }
});

test("dry-run creates no Spotify playlist ids", async () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const adapter = createMockSpotifyQaAdapter();
  const outDir = await mkdtemp(join(tmpdir(), "kwalify-qa-"));
  const result = await publishQaPlaylists({
    diagnosis,
    adapter,
    outDir,
    dryRun: true,
    force: false,
    limit: 12,
    commit: "abc",
  });
  assert.equal(result.created, 0);
  assert.equal(result.dryRun, true);
  assert.ok(result.registry.playlists.every((p) => p.spotifyPlaylistId == null));
  assert.ok(result.registry.playlists.every((p) => p.status === "dry_run" || p.status === "skipped_empty"));
});

test("mock create preserves exact URI order and records add failures", async () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const failUri = "spotify:track:acdc1";
  const adapter = createMockSpotifyQaAdapter({ failUris: [failUri] });
  const outDir = await mkdtemp(join(tmpdir(), "kwalify-qa-"));
  const result = await publishQaPlaylists({
    diagnosis,
    adapter,
    outDir,
    dryRun: false,
    force: false,
    limit: 12,
  });
  const shoegaze = result.registry.playlists.find((p) => p.prompt === "shoegaze");
  assert.ok(shoegaze);
  assert.equal(shoegaze!.addFailures.length, 1);
  assert.equal(shoegaze!.addFailures[0]?.uri, failUri);
  assert.equal(shoegaze!.tracksAdded, 1);
  assert.equal(shoegaze!.tracksRequested, 2);
  const gym = result.registry.playlists.find((p) => p.prompt === "gym workout");
  assert.equal(gym?.status, "skipped_empty");
});

test("idempotent publish reuses existing QA playlist", async () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const adapter = createMockSpotifyQaAdapter();
  const outDir = await mkdtemp(join(tmpdir(), "kwalify-qa-"));
  const first = await publishQaPlaylists({ diagnosis, adapter, outDir, dryRun: false, force: false });
  const second = await publishQaPlaylists({ diagnosis, adapter, outDir, dryRun: false, force: false });
  assert.ok(first.created >= 1);
  assert.equal(second.created, 0);
  assert.ok(second.reused >= 1);
});

test("cleanup unfollows only registered QA playlists", async () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const adapter = createMockSpotifyQaAdapter();
  const outDir = await mkdtemp(join(tmpdir(), "kwalify-qa-"));
  const published = await publishQaPlaylists({ diagnosis, adapter, outDir, dryRun: false, force: false });
  const n = await cleanupQaPlaylists(adapter, published.registry);
  assert.ok(n >= 1);
  assert.ok(published.registry.playlists.filter((p) => p.spotifyPlaylistId).every((p) => p.status === "deleted"));
  await assert.rejects(() => adapter.unfollowPlaylist("not-a-qa-playlist"));
});

test("playlist name and description stay within Spotify limits and contain no tokens", () => {
  const name = qaPlaylistName({
    requestId: "hq100-genre-shoegaze-s1-ca3ceff4",
    promptId: "genre-shoegaze",
    prompt: "shoegaze",
    category: "genre",
    delivered: 23,
    requested: 25,
    bucket: "CLEARLY_BAD",
    automatedVerdict: "CLEARLY_BAD",
    whySelected: "wrong world",
    humanQuestion: "is it bad?",
    tracks: [],
    uris: [],
    failureClasses: ["SEVERE_WORLD_MISMATCH"],
  });
  assert.ok(name.startsWith("Kwalify QA |"));
  assert.ok(name.length <= 100);
  const desc = qaPlaylistDescription({
    requestId: "hq100-x",
    promptId: "x",
    prompt: "80s synthpop",
    category: "era",
    delivered: 6,
    requested: 25,
    bucket: "CLEARLY_BAD",
    automatedVerdict: "CLEARLY_BAD",
    whySelected: "era fail",
    humanQuestion: "listen",
    tracks: [],
    uris: [],
    failureClasses: ["ERA_FAILURE"],
  }, "1c61a61deadbeef");
  assert.ok(desc.length <= 300);
  assert.ok(desc.includes("Kwalify Human QA"));
  assert.equal(/accessToken|Bearer|refresh/i.test(desc), false);
});

test("screen labels HCS as proxy and recommends review only for shortlist", () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const bad = diagnosis.playlists.find((p) => p.prompt === "shoegaze")!;
  const screen = screenPlaylist(bad, true);
  assert.equal(screen.hcsDisclaimer, "AUTOMATED PROXY — NOT HUMAN VERIFICATION");
  assert.equal(screen.humanReviewRecommended, true);
  assert.equal(screen.overall, "CLEARLY_BAD");
  const notShort = screenPlaylist(bad, false);
  assert.equal(notShort.humanReviewRecommended, false);
});

test("registry file round-trips", async () => {
  const diagnosis = diagnose100GenerationRecords(fixtureRecords(), 25);
  const adapter = createMockSpotifyQaAdapter();
  const outDir = await mkdtemp(join(tmpdir(), "kwalify-qa-"));
  await publishQaPlaylists({ diagnosis, adapter, outDir, dryRun: false, force: false });
  const loaded = await loadQaRegistry(join(outDir, "playlist-registry.json"), "hq100-test");
  assert.equal(loaded.marker, "Kwalify Human QA");
  assert.ok(loaded.playlists.length >= 1);
  const raw = await readFile(join(outDir, "playlist-registry.json"), "utf8");
  assert.equal(/accessToken|SPOTIFY_REFRESH/i.test(raw), false);
});

test("human calibration flags automated blind spot vs false alarm", () => {
  const registry = {
    version: 1 as const,
    marker: "Kwalify Human QA" as const,
    benchmarkRunId: "hq100-test",
    updatedAt: new Date().toISOString(),
    playlists: [
      {
        benchmarkRunId: "hq100-test",
        requestId: "a",
        promptId: "genre-indie-rock",
        prompt: "indie rock",
        category: "genre",
        generationCommit: null,
        engine: "V55" as const,
        automatedVerdict: "CLEARLY_GOOD",
        whySelected: "x",
        humanQuestion: "y",
        spotifyPlaylistId: "p1",
        spotifyUrl: "https://open.spotify.com/playlist/p1",
        spotifyUri: "spotify:playlist:p1",
        createdAt: new Date().toISOString(),
        status: "created" as const,
        tracksRequested: 14,
        tracksAdded: 14,
        addFailures: [],
        humanReviewStatus: "reviewed" as const,
      },
      {
        benchmarkRunId: "hq100-test",
        requestId: "b",
        promptId: "genre-shoegaze",
        prompt: "shoegaze",
        category: "genre",
        generationCommit: null,
        engine: "V55" as const,
        automatedVerdict: "CLEARLY_BAD",
        whySelected: "x",
        humanQuestion: "y",
        spotifyPlaylistId: "p2",
        spotifyUrl: "https://open.spotify.com/playlist/p2",
        spotifyUri: "spotify:playlist:p2",
        createdAt: new Date().toISOString(),
        status: "created" as const,
        tracksRequested: 8,
        tracksAdded: 8,
        addFailures: [],
        humanReviewStatus: "reviewed" as const,
      },
    ],
  };
  const md = formatHumanCalibration(
    [
      { requestId: "a", verdict: "NO" },
      { requestId: "b", verdict: "YES" },
    ],
    registry,
  );
  assert.match(md, /AUTOMATED_BLIND_SPOT/);
  assert.match(md, /AUTOMATED_FALSE_ALARM/);
});
