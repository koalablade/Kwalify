import test from "node:test";
import assert from "node:assert/strict";
import {
  auditFixture,
  auditPlaylistAutomated,
  buildHumanQualityReport,
  calibrateAutomatedVsHuman,
  clusterFailures,
  corpusByCategory,
  evaluateFromBetaEvidence,
  formatHumanReviewMarkdown,
  HUMAN_QUALITY_PROMPT_CORPUS,
  humanReviewTemplate,
  pilotPrompts,
} from "../lib/human-quality-evaluator";
import type { BetaGenerationEvidence } from "../lib/beta-generation-evidence";

const SAMPLE_TRACKS = [
  { position: 1, name: "Holocene", artist: "Bon Iver", spotifyId: "a1", album: "Bon Iver" },
  { position: 2, name: "Skinny Love", artist: "Bon Iver", spotifyId: "a2", album: "For Emma" },
  { position: 3, name: "Flume", artist: "Bon Iver", spotifyId: "a3", album: "For Emma" },
  { position: 4, name: "Re: Stacks", artist: "Bon Iver", spotifyId: "a4", album: "Bon Iver" },
  { position: 5, name: "Myth", artist: "Beach House", spotifyId: "b1", album: "Bloom" },
];

test("prompt corpus has breadth across categories", () => {
  assert.ok(HUMAN_QUALITY_PROMPT_CORPUS.length >= 40);
  const cats = corpusByCategory();
  assert.ok((cats.atmosphere ?? 0) >= 4);
  assert.ok((cats.compound ?? 0) >= 4);
  assert.ok(pilotPrompts().length === 12);
});

test("auditPlaylistAutomated returns hypothesis not numeric human score", () => {
  const audit = auditPlaylistAutomated({
    prompt: "cozy sunday morning coffee",
    tracks: SAMPLE_TRACKS,
    requestedCount: 25,
    deliveredCount: 5,
    honestPartial: true,
    outcome: "partial",
  });
  assert.ok(["strong", "mixed", "weak"].includes(audit.automatedHypothesis.humanQuality));
  assert.ok(audit.hcs.totalScore >= 0 && audit.hcs.totalScore <= 100);
  assert.ok(audit.signalProvenance.proxy.length > 0);
  assert.equal(audit.underfill.delivered, 5);
  assert.equal(audit.underfill.requested, 25);
});

test("empty playlist classified as failure/reliability", () => {
  const audit = auditFixture("late night drive", []);
  assert.equal(audit.underfill.outcome, "failure");
  assert.equal(audit.hcs.wouldSave, "NO");
  assert.ok(
    audit.failureClasses.some((f) => f.class === "reliability")
    || audit.automatedHypothesis.reliability === "weak",
  );
});

test("calibration detects automated vs human disagreement", () => {
  const audit = auditPlaylistAutomated({ prompt: "test", tracks: SAMPLE_TRACKS });
  const aligned = calibrateAutomatedVsHuman(audit, {
    humanSaveability: 4,
    momentFidelity: 4,
    musicalCoherence: 4,
    tasteFit: 4,
    openingQuality: 4,
    tailQuality: 4,
    discoveryQuality: 4,
    replayability: 4,
    overallHumanQuality: 4,
  });
  assert.ok(aligned?.agreement === "aligned" || aligned?.agreement === "mixed");

  const disagree = calibrateAutomatedVsHuman(audit, {
    humanSaveability: 1,
    momentFidelity: 1,
    musicalCoherence: 1,
    tasteFit: 1,
    openingQuality: 1,
    tailQuality: 1,
    discoveryQuality: 1,
    replayability: 1,
    overallHumanQuality: 1,
    opinion: "Crap — too upbeat",
  });
  assert.ok(
    disagree?.agreement === "automated_high_human_low" || disagree?.agreement === "mixed",
  );
});

test("evaluateFromBetaEvidence preserves track order", () => {
  const record: BetaGenerationEvidence = {
    kind: "generation",
    generationEvidenceId: "eval-test-1",
    requestId: "eval-test-1",
    userTag: "anon",
    capturedAt: new Date().toISOString(),
    kwalify: { version: "1.0.0", commit: "test", nodeEnv: "test", hostMode: "selfhost" },
    prompt: { raw: "cozy sunday morning coffee", length: 26, mode: "balanced", noLibraryMode: false },
    interpretation: { sceneId: "cozy" },
    playlist: {
      title: "Test",
      description: null,
      requestedTrackCount: 25,
      deliveredTrackCount: 2,
      honestPartial: true,
      outcome: "partial",
    },
    tracks: [
      { position: 1, name: "Feist - Mushaboom", artists: ["Feist"], album: "Let It Die", spotifyId: "t1", spotifyUri: "spotify:track:t1", durationMs: null, releaseYear: 2007 },
      { position: 2, name: "Holocene", artists: ["Bon Iver"], album: "Bon Iver", spotifyId: "t2", spotifyUri: "spotify:track:t2", durationMs: null, releaseYear: 2011 },
    ],
    artistDiversity: { uniqueArtistCount: 2, repeatedArtists: [], maxTracksPerArtist: 1 },
    pipeline: {},
    spotify: { playlistCreated: false, playlistId: null, playlistUrl: null, savedPlaylistId: null },
  };
  const evaluated = evaluateFromBetaEvidence(record, null);
  assert.equal(evaluated.tracks[0]?.name, "Feist - Mushaboom");
  assert.equal(evaluated.tracks[1]?.position, 2);
  assert.equal(evaluated.source, "beta_evidence");
});

test("failure clustering groups repeated classes", () => {
  const mk = (id: string, cls: string) => ({
    source: "beta_evidence" as const,
    requestId: id,
    prompt: "test",
    commit: null,
    capturedAt: null,
    mode: null,
    interpretation: {},
    pipeline: {},
    tracks: [],
    userFeedback: null,
    humanReview: null,
    calibration: { agreement: "no_human" as const },
    automated: {
      evaluatorVersion: "human-quality-evaluator-v1" as const,
      auditedAt: new Date().toISOString(),
      automatedHypothesis: {
        humanQuality: "weak" as const,
        momentFidelity: "weak" as const,
        musicalCoherence: "weak" as const,
        taste: "weak" as const,
        sequencing: "weak" as const,
        reliability: "weak" as const,
      },
      hcs: { totalScore: 40, wouldPressPlay: "NO", wouldSave: "NO", wouldShare: "NO", aiObviousness: "HIGH" },
      independentVerifier: { playlistVerdict: "weak", misfitCount: 3, failureReasons: [], topRoiFailures: [] },
      constraints: [],
      segments: [],
      outliers: [],
      artistDiversity: { uniqueArtists: 0, maxPerArtist: 0, repeatedArtists: [], suspiciousRepetition: false },
      underfill: { requested: 25, delivered: 10, honestPartial: true, outcome: "partial" },
      failureClasses: [{ class: cls as never, confidence: "possible" as const, evidence: "test" }],
      signalProvenance: { direct: [], inferred: [], proxy: [], unavailable: [] },
    },
  });
  const clusters = clusterFailures([mk("a", "underfill"), mk("b", "underfill"), mk("c", "tail")]);
  const underfill = clusters.find((c) => c.failureClass === "underfill");
  assert.ok(underfill);
  assert.ok(underfill!.count >= 2);
});

test("human review template includes prompt and tracks", () => {
  const evaluated = evaluateFromBetaEvidence({
    kind: "generation",
    generationEvidenceId: "t",
    requestId: "t",
    userTag: "anon",
    capturedAt: new Date().toISOString(),
    kwalify: { version: "1", commit: "x", nodeEnv: null, hostMode: null },
    prompt: { raw: "rainy evening", length: 13, mode: "balanced", noLibraryMode: false },
    interpretation: {},
    playlist: { title: null, description: null, requestedTrackCount: 20, deliveredTrackCount: 1, honestPartial: true, outcome: "partial" },
    tracks: [{ position: 1, name: "Song", artists: ["Artist"], album: null, spotifyId: "1", spotifyUri: "spotify:track:1", durationMs: null, releaseYear: null }],
    artistDiversity: { uniqueArtistCount: 1, repeatedArtists: [], maxTracksPerArtist: 1 },
    pipeline: {},
    spotify: { playlistCreated: false, playlistId: null, playlistUrl: null, savedPlaylistId: null },
  }, null);
  const tpl = humanReviewTemplate(evaluated);
  assert.equal(tpl.requestId, "t");
  const md = formatHumanReviewMarkdown(evaluated);
  assert.match(md, /rainy evening/);
  assert.match(md, /Automated hypothesis/);
});

test("report recommends waiting when insufficient evidence", () => {
  const report = buildHumanQualityReport([]);
  assert.match(report.recommendedNextStep, /insufficient|Gather/i);
  assert.equal(report.engineChanges, "NONE");
  assert.equal(report.confidence, "low");
});
