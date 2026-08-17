import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFromApiResponse, resolveRequestedTrackCount } from "../lib/human-quality-evaluator/evidence-ingest";
import {
  BENCHMARK100_PLAYLIST_LENGTH,
  evaluateRecordFromResponse,
} from "../lib/human-quality-evaluator/benchmark-100";
import {
  classifyRecord,
  detectDefaultCluster,
  diagnose100GenerationRecords,
} from "../lib/human-quality-evaluator/forensic-analysis";
import type { QaLibrarySnapshot } from "../lib/human-quality-evaluator/library-opportunity";
import { mergeGoldSet, loadGoldSetSync, type GoldLabel } from "../lib/human-quality-evaluator/gold-set";
import { assembleCandidateFunnel } from "../lib/candidate-funnel-trace";
import { engineChangeThreshold, investigate } from "../lib/human-quality-evaluator/investigation";
import type { Benchmark100GenerationRecord as Rec } from "../lib/human-quality-evaluator/benchmark-100";
import { matchingWorlds } from "../lib/human-quality-evaluator/world-evidence";

function rec(partial: {
  promptId: string;
  prompt: string;
  category: Rec["runItem"]["category"];
  requestId?: string;
  tracks: Array<{ name: string; artist: string; year?: number; id?: string }>;
  httpStatus?: number;
  error?: string | null;
  path?: string;
  hcs?: number;
  verifier?: string;
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
    benchmarkRunId: "test",
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
        executionPath: partial.path ?? "gate_failure",
        humanSaveable: false,
        curatorScore: 0.2,
        rejectionReasons: ["curatorScore 0.2 < 0.86"],
        stageAttribution: {
          retrieval: { status: "skipped" },
          scene_world: { status: "skipped" },
          sampler: { status: "skipped" },
        },
        trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: tracks.length },
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
        hcs: {
          totalScore: partial.hcs ?? 91,
          wouldPressPlay: "YES",
          wouldSave: "YES",
          wouldShare: "MAYBE",
          aiObviousness: "LOW",
        },
        independentVerifier: {
          playlistVerdict: partial.verifier ?? "strong",
          misfitCount: 0,
          failureReasons: [],
          topRoiFailures: [],
        },
        constraints: [],
        segments: [],
        outliers: [],
        artistDiversity: { uniqueArtists: 1, maxPerArtist: 1, repeatedArtists: [], suspiciousRepetition: false },
        underfill: { requested: tracks.length, delivered: tracks.length, honestPartial: false, outcome: "success" },
        failureClasses: [],
        signalProvenance: { direct: [], inferred: [], proxy: [], unavailable: [] },
      },
      humanReview: null,
      calibration: { agreement: "no_human" },
    },
  };
}

test("requested length is never inferred from delivered count", () => {
  const { requested, known } = resolveRequestedTrackCount({ length: 8 }, 8);
  assert.equal(known, false);
  const evaluated = evaluateFromApiResponse({
    requestId: "x",
    vibe: "indie rock",
    tracks: [
      { id: "a", name: "A", artist: "A" },
      { id: "b", name: "B", artist: "B" },
    ],
    length: 2,
  });
  assert.equal(evaluated.automated.underfill.outcome, "unknown_request_length");
  assert.match(evaluated.automated.underfill.note ?? "", /unknown/i);
});

test("evaluateRecordFromResponse uses benchmark requested length 25", () => {
  const evaluated = evaluateRecordFromResponse(
    {
      runIndex: 0,
      seed: 1,
      promptId: "x",
      prompt: "indie",
      category: "genre",
      difficulty: "easy",
      requestId: "r1",
    },
    {
      vibe: "indie",
      tracks: [
        { id: "a", name: "A", artist: "A" },
        { id: "b", name: "B", artist: "B" },
      ],
      length: 2,
    },
    200,
  );
  assert.equal(evaluated.automated.underfill.requested, BENCHMARK100_PLAYLIST_LENGTH);
  assert.equal(evaluated.automated.underfill.delivered, 2);
  assert.equal(evaluated.automated.underfill.outcome, "partial");
});

test("shoegaze + AC/DC is CLEARLY_BAD severe world mismatch", () => {
  const r = rec({
    promptId: "genre-shoegaze",
    prompt: "shoegaze",
    category: "genre",
    tracks: [
      { name: "Back In Black", artist: "AC/DC", year: 1980 },
      { name: "Paradise City", artist: "Guns N' Roses", year: 1987 },
      { name: "Stairway to Heaven", artist: "Led Zeppelin", year: 1971 },
    ],
    hcs: 70,
    verifier: "strong",
  });
  const f = classifyRecord(r, new Set(), null, 25);
  assert.equal(f.delivery, "partial");
  assert.equal(f.requested, 25);
  assert.equal(f.delivered, 3);
  assert.equal(f.underfillMissing, 22);
  assert.equal(f.bucket, "CLEARLY_BAD");
  assert.ok(f.failureClasses.some((x) => x.class === "SEVERE_WORLD_MISMATCH"));
  assert.equal(f.dimensions.PROMPT_FIT, "FAIL");
  assert.equal(f.evaluatorConflict, "verifier_optimistic");
});

test("80s synthpop with 2010s indie is ERA_FAILURE", () => {
  assert.ok(matchingWorlds("80s synthpop").some((w) => w.id === "80s_synthpop"));
  const r = rec({
    promptId: "era-80s",
    prompt: "80s synthpop",
    category: "era",
    tracks: [
      { name: "About You", artist: "The 1975", year: 2022 },
      { name: "Remember When", artist: "Wallows", year: 2019 },
      { name: "I Hear a Symphony", artist: "Cody Fry", year: 2017 },
    ],
    hcs: 91,
    verifier: "weak",
  });
  const f = classifyRecord(r, new Set(), null, 25);
  assert.equal(f.bucket, "CLEARLY_BAD");
  assert.ok(f.failureClasses.some((x) => x.class === "ERA_FAILURE"));
  assert.equal(f.evaluatorConflict, "hcs_optimistic");
});

test("detectDefaultCluster finds cross-category repeats", () => {
  const records: Rec[] = [
    rec({ promptId: "a", prompt: "sad", category: "mood", tracks: [{ name: "Temporary Bliss", artist: "The Cab", id: "cab" }] }),
    rec({ promptId: "b", prompt: "indie rock", category: "genre", tracks: [{ name: "Temporary Bliss", artist: "The Cab", id: "cab" }] }),
    rec({ promptId: "c", prompt: "rainy Sunday", category: "atmosphere", tracks: [{ name: "Temporary Bliss", artist: "The Cab", id: "cab" }] }),
  ];
  const cluster = detectDefaultCluster(records, { minPlaylists: 3, minCategories: 3 });
  assert.equal(cluster.length, 1);
  assert.equal(cluster[0]?.artist, "The Cab");
});

test("gym 422 is TECHNICAL_FAILURE not a scored playlist", () => {
  const r = rec({
    promptId: "act-gym",
    prompt: "gym workout",
    category: "activity",
    tracks: [],
    httpStatus: 422,
    error: "This playlist would not pass a human save/replay test",
    path: "unknown_exit",
  });
  const f = classifyRecord(r, new Set(), null, 25);
  assert.equal(f.delivery, "refused");
  assert.equal(f.bucket, "TECHNICAL_FAILURE");
});

test("shortlist stays small and covers distinct questions", () => {
  const records = [
    rec({
      promptId: "act-cooking",
      prompt: "cooking dinner",
      category: "activity",
      tracks: Array.from({ length: 25 }, (_, i) => ({ name: `T${i}`, artist: `A${i}`, year: 2010 + (i % 10) })),
      path: "full_pipeline",
      hcs: 89,
    }),
    rec({
      promptId: "genre-shoegaze",
      prompt: "shoegaze",
      category: "genre",
      tracks: [
        { name: "Back In Black", artist: "AC/DC", year: 1980 },
        { name: "TNT", artist: "AC/DC", year: 1976 },
      ],
    }),
    rec({
      promptId: "era-80s",
      prompt: "80s synthpop",
      category: "era",
      tracks: [{ name: "About You", artist: "The 1975", year: 2022 }],
      hcs: 91,
      verifier: "weak",
    }),
    rec({
      promptId: "act-gym",
      prompt: "gym workout",
      category: "activity",
      tracks: [],
      httpStatus: 422,
      error: "HUMAN_QUALITY_GATE_REFUSED",
    }),
    rec({
      promptId: "neg-no-mainstream",
      prompt: "indie vibes no mainstream hits",
      category: "negative_constraint",
      tracks: [{ name: "About You", artist: "The 1975", year: 2022 }],
    }),
    rec({
      promptId: "cmp-cozy-upbeat",
      prompt: "cozy but upbeat",
      category: "compound",
      tracks: [
        { name: "Time Flies - Acoustic", artist: "Ryan Robinson", year: 2020 },
        { name: "Social Sites - Acoustic", artist: "Cosmo Pyke", year: 2016 },
      ],
    }),
    rec({
      promptId: "mood-sad",
      prompt: "sad",
      category: "natural",
      tracks: Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, artist: `B${i}` })),
    }),
    rec({
      promptId: "era-2000s",
      prompt: "2000s indie",
      category: "era",
      tracks: [
        { name: "Skinny Love", artist: "Bon Iver", year: 2007 },
        { name: "For Emma", artist: "Bon Iver", year: 2008 },
      ],
    }),
  ];
  const diagnosis = diagnose100GenerationRecords(records as unknown as Rec[], 25);
  assert.ok(diagnosis.shortlist.length >= 6 && diagnosis.shortlist.length <= 15);
  assert.ok(diagnosis.delivery.partial + diagnosis.delivery.refused + diagnosis.delivery.full === records.length);
  const ids = new Set(diagnosis.shortlist.map((s) => s.promptId.replace(/-r[12]$/, "")));
  assert.equal(ids.size, diagnosis.shortlist.length);
});

test("compound cozy but upbeat reports dimensions independently", () => {
  const f = classifyRecord(
    rec({
      promptId: "cmp-cozy-upbeat",
      prompt: "cozy but upbeat",
      category: "compound",
      tracks: [
        { name: "Time Flies - Acoustic", artist: "Ryan Robinson" },
        { name: "Social Sites - Acoustic", artist: "Cosmo Pyke" },
        { name: "Quiet Acoustic", artist: "Someone" },
        { name: "Soft Acoustic", artist: "Else" },
      ],
    }),
    new Set(),
    null,
    25,
  );
  assert.match(f.dimensionEvidence.COMPOUND_FIT ?? "", /cozy:/);
  assert.match(f.dimensionEvidence.COMPOUND_FIT ?? "", /upbeat:/);
  assert.equal(f.dimensions.COMPOUND_FIT, "FAIL");
  assert.ok(f.failureClasses.some((x) => x.class === "COMPOUND_INTENT_COLLAPSE"));
});

test("negative not-cheesy is HUMAN REVIEW not automatic PASS", () => {
  const f = classifyRecord(
    rec({
      promptId: "neg-not-cheesy",
      prompt: "chill party music but not cheesy",
      category: "negative_constraint",
      tracks: [
        { name: "Song", artist: "Unknown Act" },
        { name: "Other", artist: "Other Act" },
      ],
    }),
    new Set(),
    null,
    25,
  );
  assert.equal(f.dimensions.NEGATIVE_CONSTRAINT_FIT, "UNKNOWN");
  assert.match(f.dimensionEvidence.NEGATIVE_CONSTRAINT_FIT ?? "", /not cheesy/);
  assert.notEqual(f.bucket, "CLEARLY_GOOD");
});

test("no mainstream with obvious hit artist is NEGATIVE_CONSTRAINT_RISK", () => {
  const f = classifyRecord(
    rec({
      promptId: "neg-no-mainstream",
      prompt: "indie vibes no mainstream",
      category: "negative_constraint",
      tracks: [{ name: "About You", artist: "The 1975", year: 2022 }],
    }),
    new Set(),
    null,
    25,
  );
  assert.equal(f.dimensions.NEGATIVE_CONSTRAINT_FIT, "FAIL");
  assert.ok(f.failureClasses.some((x) => x.class === "NEGATIVE_CONSTRAINT_RISK"));
});

test("skipped funnel with delivered tracks is INCOMPLETE_TRACE not retrieved=0", () => {
  const f = classifyRecord(
    rec({
      promptId: "genre-indie-rock",
      prompt: "indie rock",
      category: "genre",
      tracks: [
        { name: "A", artist: "A1" },
        { name: "B", artist: "B1" },
      ],
    }),
    new Set(),
    null,
    25,
  );
  assert.ok(f.failureClasses.some((x) => x.class === "INCOMPLETE_TRACE"));
  assert.equal(f.delivered, 2);
  assert.notEqual(f.bucket, "TECHNICAL_FAILURE");
});

test("identical sibling runs are REPLAY_LOW_VARIATION", () => {
  const tracks = [
    { name: "Same", artist: "Band", id: "same-1" },
    { name: "Also", artist: "Band2", id: "same-2" },
    { name: "Again", artist: "Band3", id: "same-3" },
    { name: "More", artist: "Band4", id: "same-4" },
    { name: "Still", artist: "Band5", id: "same-5" },
    { name: "Clone", artist: "Band6", id: "same-6" },
  ];
  const diagnosis = diagnose100GenerationRecords(
    [
      rec({ promptId: "genre-indie-rock", prompt: "indie rock", category: "genre", requestId: "a", tracks }),
      rec({ promptId: "genre-indie-rock-r1", prompt: "indie rock", category: "genre", requestId: "b", tracks }),
    ],
    25,
  );
  assert.ok(diagnosis.playlists.every((p) => p.failureClasses.some((f) => f.class === "REPLAY_LOW_VARIATION")));
  assert.ok((diagnosis.playlists[0]?.replayJaccard ?? 0) >= 0.95);
});

const INDIE_ARTISTS = [
  "Arctic Monkeys", "The Strokes", "Interpol", "Yeah Yeah Yeahs", "Vampire Weekend",
  "The National", "LCD Soundsystem", "MGMT", "The Smiths", "Florence",
  "Wallows", "The 1975", "The Jungle Giants", "The National",
];

function indieSnapshot(n: number): QaLibrarySnapshot {
  return {
    userId: "test",
    loadedAt: new Date().toISOString(),
    librarySize: n,
    tracks: Array.from({ length: n }, (_, i) => ({
      trackId: `lib-${i}`,
      trackName: `Liked indie ${i}`,
      artistName: `Library Indie ${i}`,
      albumName: "LP",
      releaseYear: 2012,
      genreFamily: "indie",
      primarySubgenre: "indie_rock",
      subGenres: ["indie_rock"],
    })),
  };
}

function indie14() {
  return rec({
    promptId: "genre-indie-rock",
    prompt: "indie rock",
    category: "genre",
    requestId: "hq100-genre-indie-rock-s1-0b9bcb5b",
    tracks: INDIE_ARTISTS.map((artist, i) => ({ name: `Track ${i}`, artist, year: 2014, id: `indie-${i}` })),
    path: "full_pipeline",
    hcs: 88,
  });
}

test("indie rock 14/25 is not CLEARLY_GOOD from coherence alone", () => {
  const f = classifyRecord(indie14(), new Set(), null, 25, null);
  assert.equal(f.delivered, 14);
  assert.equal(f.requested, 25);
  assert.equal(f.fillSeverity, "partial");
  assert.notEqual(f.bucket, "CLEARLY_GOOD");
  assert.equal(f.responseQuality, "CORRECT_PROMPT_BUT_UNDERFILLED");
});

test("high library opportunity + 14-track indie is UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY", () => {
  const f = classifyRecord(indie14(), new Set(), null, 25, indieSnapshot(1847));
  assert.equal(f.library?.opportunity, "VERY_HIGH");
  assert.equal(f.library?.strongRelevantCount, 1847);
  assert.ok(f.failureClasses.some((x) => x.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY"));
  assert.equal(f.library?.underfillVsOpportunity, "suspicious");
  assert.notEqual(f.bucket, "CLEARLY_GOOD");
  assert.equal(f.bucket, "MIXED");
});

test("low library opportunity + underfill is SPARSE_LIBRARY not admission failure", () => {
  const f = classifyRecord(
    rec({
      promptId: "genre-shoegaze",
      prompt: "shoegaze",
      category: "genre",
      tracks: [
        { name: "When the Sun Hits", artist: "Slowdive", year: 1993 },
        { name: "Only Shallow", artist: "My Bloody Valentine", year: 1991 },
        { name: "Vapour Trail", artist: "Ride", year: 1990 },
      ],
    }),
    new Set(),
    null,
    25,
    {
      userId: "test",
      loadedAt: new Date().toISOString(),
      librarySize: 6,
      tracks: [
        { trackId: "1", trackName: "When the Sun Hits", artistName: "Slowdive", albumName: "Souvlaki", releaseYear: 1993, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
        { trackId: "2", trackName: "Only Shallow", artistName: "My Bloody Valentine", albumName: "Loveless", releaseYear: 1991, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
        { trackId: "3", trackName: "Vapour Trail", artistName: "Ride", albumName: "Nowhere", releaseYear: 1990, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
        { trackId: "4", trackName: "Alison", artistName: "Slowdive", albumName: "Souvlaki", releaseYear: 1993, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
        { trackId: "5", trackName: "Soon", artistName: "My Bloody Valentine", albumName: "Loveless", releaseYear: 1991, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
        { trackId: "6", trackName: "Leave Them All Behind", artistName: "Ride", albumName: "Going Blank Again", releaseYear: 1992, genreFamily: "rock", primarySubgenre: "shoegaze", subGenres: ["shoegaze"] },
      ],
    },
  );
  assert.ok(["LOW", "VERY_LOW"].includes(f.library?.opportunity ?? ""));
  assert.ok(f.failureClasses.some((x) => x.class === "SPARSE_LIBRARY"));
  assert.equal(f.failureClasses.some((x) => x.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY"), false);
});

test("keyword-only neon opening is KEYWORD_LITERAL_OPENING", () => {
  const f = classifyRecord(
    rec({
      promptId: "atm-neon",
      prompt: "neon city night",
      category: "atmosphere",
      tracks: [
        { name: "Sleeping with a Friend", artist: "Neon Trees", year: 2014 },
        { name: "Neon Waves", artist: "Neon Waves", year: 2020 },
        { name: "City Lights", artist: "Someone", year: 2018 },
      ],
    }),
    new Set(),
    null,
    25,
  );
  assert.ok(f.failureClasses.some((x) => x.class === "KEYWORD_LITERAL_OPENING"));
});

test("shortlist includes indie rock underfill case", () => {
  const diagnosis = diagnose100GenerationRecords(
    [
      indie14(),
      rec({
        promptId: "genre-shoegaze",
        prompt: "shoegaze",
        category: "genre",
        tracks: [
          { name: "Back In Black", artist: "AC/DC", year: 1980 },
          { name: "TNT", artist: "AC/DC", year: 1976 },
        ],
      }),
      rec({
        promptId: "mood-melancholic",
        prompt: "melancholic",
        category: "mood",
        tracks: Array.from({ length: 24 }, (_, i) => ({ name: `M${i}`, artist: `A${i}` })),
        path: "full_pipeline",
      }),
    ],
    25,
    indieSnapshot(900),
  );
  assert.ok(diagnosis.shortlist.some((s) => s.requestId === "hq100-genre-indie-rock-s1-0b9bcb5b"));
  const indie = diagnosis.playlists.find((p) => p.requestId === "hq100-genre-indie-rock-s1-0b9bcb5b");
  assert.notEqual(indie?.bucket, "CLEARLY_GOOD");
});

test("2000s indie 3-track one-artist is severe underfill + clustering", () => {
  const f = classifyRecord(
    rec({
      promptId: "era-2000s",
      prompt: "2000s indie",
      category: "era",
      requestId: "hq100-era-2000s-s1-41638fc8",
      tracks: [
        { name: "Skinny Love", artist: "Bon Iver", year: 2007, id: "a" },
        { name: "Beach Baby", artist: "Bon Iver", year: 2009, id: "b" },
        { name: "For Emma", artist: "Bon Iver", year: 2008, id: "c" },
      ],
    }),
    new Set(),
    null,
    25,
    indieSnapshot(357),
  );
  assert.equal(f.delivered, 3);
  assert.equal(f.fillSeverity, "severely_underfilled");
  assert.ok(f.failureClasses.some((x) => x.class === "ARTIST_CLUSTERING"));
  assert.ok(f.failureClasses.some((x) => x.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY"));
  assert.notEqual(f.bucket, "CLEARLY_GOOD");
});

test("gold set never silently overwrites a human label", () => {
  const existing: GoldLabel = {
    requestId: "x",
    prompt: "indie rock",
    benchmarkRunId: "hq",
    verdict: "YES",
    tags: ["too short"],
    humanClass: "CORRECT_WORLD_UNDERFILL",
    protect: false,
    opinion: "keep me",
    reviewedAt: "2026-08-17",
  };
  const { gold, skipped, added } = mergeGoldSet(
    { version: 1, updatedAt: "", labels: [existing] },
    [{ ...existing, verdict: "NO", opinion: "overwrite?" }],
  );
  assert.equal(skipped, 1);
  assert.equal(added, 0);
  assert.equal(gold.labels[0]?.verdict, "YES");
  assert.equal(gold.labels[0]?.opinion, "keep me");
});

test("engine change is blocked until traces identify the subsystem", () => {
  const gate = engineChangeThreshold({
    humanConfirmedRepeatedUnderfill: true,
    subsystemIdentified: false,
    tracesComplete: false,
    protectedNamed: true,
  });
  assert.equal(gate.met, false);
  assert.ok(gate.blockers.some((b) => /INCOMPLETE_TRACE/i.test(b)));
});

test("investigation next action is FIX OBSERVABILITY not V56", () => {
  const diagnosis = diagnose100GenerationRecords(
    [
      indie14(),
      rec({
        promptId: "era-2000s",
        prompt: "2000s indie",
        category: "era",
        requestId: "hq100-era-2000s-s1-41638fc8",
        tracks: [
          { name: "Skinny Love", artist: "Bon Iver", year: 2007, id: "a" },
          { name: "Beach Baby", artist: "Bon Iver", year: 2009, id: "b" },
          { name: "For Emma", artist: "Bon Iver", year: 2008, id: "c" },
        ],
      }),
      rec({
        promptId: "genre-90s-alt",
        prompt: "90s alternative rock",
        category: "genre",
        requestId: "hq100-genre-90s-alt-s1-df2fd5ca",
        tracks: [
          { name: "The Lamp Is Low", artist: "Laurindo Almeida", year: 1969 },
          { name: "Temporary Bliss", artist: "The Cab", year: 2011 },
        ],
      }),
    ],
    25,
    indieSnapshot(439),
  );
  const inv = investigate(diagnosis, {
    version: 1,
    updatedAt: "",
    labels: [
      {
        requestId: "hq100-genre-indie-rock-s1-0b9bcb5b",
        prompt: "indie rock",
        benchmarkRunId: "test",
        verdict: "YES",
        tags: ["too short", "genuinely good"],
        humanClass: "CORRECT_WORLD_UNDERFILL",
        protect: false,
        opinion: "",
        reviewedAt: "",
      },
      {
        requestId: "hq100-era-2000s-s1-41638fc8",
        prompt: "2000s indie",
        benchmarkRunId: "test",
        verdict: "NO",
        tags: ["too short", "repetitive"],
        humanClass: "SEVERE_UNDERFILL_REPETITION",
        protect: false,
        opinion: "",
        reviewedAt: "",
      },
    ],
  });
  assert.equal(inv.engineChange.met, false);
  assert.equal(inv.nextAction, "FIX OBSERVABILITY");
  assert.equal(inv.engineFrozen, "V55");
});

function attachFunnel(record: Rec, funnel: ReturnType<typeof assembleCandidateFunnel>): Rec {
  return {
    ...record,
    evaluated: record.evaluated
      ? { ...record.evaluated, pipeline: { ...record.evaluated.pipeline, candidateFunnel: funnel } }
      : record.evaluated,
  };
}

function completeFunnel() {
  return assembleCandidateFunnel({
    requestedLength: 25,
    deliveredLength: 14,
    librarySize: 9665,
    retrieved: 80,
    relevantToPrompt: 439,
    worldAdmitted: 40,
    artistCapRemovals: 4,
    duplicateRemovals: 0,
    eraMismatchRemovals: 0,
    worldMismatchRemovals: 2,
    negativeConstraintRemovals: 0,
    compositionCandidates: 22,
    refillAttempts: 1,
    refillAdded: 0,
    finalTrackUris: ["spotify:track:a"],
  });
}

function alt90sSnapshot(n: number): QaLibrarySnapshot {
  return {
    userId: "test",
    loadedAt: new Date().toISOString(),
    librarySize: n,
    tracks: Array.from({ length: n }, (_, i) => ({
      trackId: `alt-${i}`,
      trackName: `90s alt ${i}`,
      artistName: `Alt Band ${i}`,
      albumName: "LP",
      releaseYear: 1995,
      genreFamily: "rock",
      primarySubgenre: "alt_rock",
      subGenres: ["alt_rock"],
    })),
  };
}

test("complete candidateFunnel is not INCOMPLETE_TRACE even if stages are skipped", () => {
  const f = classifyRecord(attachFunnel(indie14(), completeFunnel()), new Set(), null, 25, indieSnapshot(439));
  assert.equal(f.traceIncomplete, false);
  assert.equal(f.failureClasses.some((x) => x.class === "INCOMPLETE_TRACE"), false);
  assert.equal(f.candidateFunnel?.completeness, "complete");
  assert.ok(f.dropStage);
});

test("incomplete candidateFunnel stays explicitly incomplete", () => {
  const incomplete = assembleCandidateFunnel({ requestedLength: 25, deliveredLength: 14 });
  const f = classifyRecord(attachFunnel(indie14(), incomplete), new Set(), null, 25, indieSnapshot(439));
  assert.equal(f.traceIncomplete, true);
  assert.ok(f.failureClasses.some((x) => x.class === "INCOMPLETE_TRACE"));
  assert.equal(f.candidateFunnel?.retrieved.status, "unknown");
  assert.equal(f.dropStage?.primary, "unknown");
});

test("wrong-world 90s alt with large relevant library is MISSED_LIBRARY_OPPORTUNITY", () => {
  const f = classifyRecord(
    rec({
      promptId: "genre-90s-alt",
      prompt: "90s alternative rock",
      category: "genre",
      requestId: "hq100-genre-90s-alt-s1-df2fd5ca",
      tracks: [
        { name: "The Lamp Is Low", artist: "Laurindo Almeida", year: 1969 },
        { name: "Temporary Bliss", artist: "The Cab", year: 2011 },
        { name: "I Hear a Symphony", artist: "Cody Fry", year: 2017 },
      ],
    }),
    new Set(),
    null,
    25,
    alt90sSnapshot(735),
  );
  assert.equal(f.library?.opportunity, "VERY_HIGH");
  assert.ok(f.failureClasses.some((x) => x.class === "SEVERE_WORLD_MISMATCH" || x.class === "ERA_FAILURE"));
  assert.ok(f.failureClasses.some((x) => x.class === "MISSED_LIBRARY_OPPORTUNITY"));
  assert.notEqual(f.bucket, "CLEARLY_GOOD");
});

test("persisted human gold labels cannot be overwritten", () => {
  const gold = loadGoldSetSync();
  const ids = [
    "hq100-mood-melancholic-s1-b25ff699",
    "hq100-mood-nostalgic-s1-adaf25dc",
    "hq100-genre-indie-rock-s1-0b9bcb5b",
    "hq100-era-2000s-s1-41638fc8",
    "hq100-genre-90s-alt-s1-df2fd5ca",
  ];
  for (const id of ids) {
    assert.ok(gold.labels.some((l) => l.requestId === id), `missing gold ${id}`);
  }
  const { skipped, added, gold: merged } = mergeGoldSet(
    gold,
    gold.labels.map((l) => ({ ...l, verdict: "MAYBE" as const, opinion: "overwrite?" })),
  );
  assert.equal(added, 0);
  assert.equal(skipped, gold.labels.length);
  assert.equal(merged.labels.find((l) => l.requestId === ids[0])?.verdict, "YES");
  assert.equal(merged.labels.find((l) => l.requestId === ids[1])?.verdict, "NO");
  assert.equal(merged.labels.find((l) => l.requestId === ids[2])?.verdict, "YES");
  assert.equal(merged.labels.find((l) => l.requestId === ids[3])?.verdict, "NO");
  assert.equal(merged.labels.find((l) => l.requestId === ids[4])?.verdict, "NO");
});

test("misleading persisted worldAdmitted is rebuilt from raw traces", () => {
  const record = rec({
    promptId: "genre-90s-alt",
    prompt: "90s alternative rock",
    category: "genre",
    requestId: "hq100-genre-90s-alt-s1-96ef56e6",
    path: "gate_failure",
    tracks: [
      { name: "The Lamp Is Low", artist: "Laurindo Almeida", year: 1969 },
      { name: "Temporary Bliss", artist: "The Cab", year: 2011 },
      { name: "I Hear a Symphony", artist: "Cody Fry", year: 2017 },
      { name: "Stripped Sunset", artist: "Harlem", year: 2010 },
      { name: "Be My Mistake", artist: "The 1975", year: 2018 },
      { name: "About You", artist: "The 1975", year: 2022 },
      { name: "Bad Dream", artist: "The Jungle Giants", year: 2017 },
      { name: "Pleaser", artist: "Wallows", year: 2017 },
    ],
  });
  const misleading = assembleCandidateFunnel({
    requestedLength: 25,
    deliveredLength: 8,
    librarySize: 9658,
    retrieved: 1665,
    relevantToPrompt: 45,
    worldAdmitted: 9205,
    artistCapRemovals: 0,
    compositionCandidates: 25,
    refillAttempts: 2,
    refillAdded: 0,
  });
  record.rawResponse = {
    candidateFunnel: misleading,
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
    puritySubFunnel: { hardRejectOffWorldCount: 6, removedReasons: [], checkpointRemovedReasons: [] },
  };
  const f = classifyRecord(record, new Set(), null, 25, alt90sSnapshot(735));
  assert.equal(f.candidateFunnel?.worldAdmitted.status, "unknown");
  assert.equal(f.candidateFunnel?.worldFilterDropped?.value, 0);
  assert.equal(f.candidateFunnel?.v3PreFilter?.value, 187);
  assert.notEqual(f.dropStage?.primary, "composition");
  assert.equal(f.dropStage?.primary, "world_filter_noop");
});

