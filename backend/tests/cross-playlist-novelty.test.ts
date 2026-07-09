import test from "node:test";
import assert from "node:assert/strict";
import {
  primaryPathNoveltyDeduction,
  primaryPathArtistNoveltyDeduction,
  applyPrimaryPathNoveltyPenalty,
  buildNoveltyDiagnostics,
  resolveNoveltyDiagnostics,
  trackPlaylistAppearanceCount,
} from "../lib/cross-playlist-novelty";
import { buildFreshnessStats } from "../lib/playlist-freshness";

test("primaryPathNoveltyDeduction — zero appearances no penalty", () => {
  assert.equal(primaryPathNoveltyDeduction(0), 0);
});

test("primaryPathNoveltyDeduction — escalates with reuse", () => {
  assert.ok(primaryPathNoveltyDeduction(1) < primaryPathNoveltyDeduction(3));
  assert.ok(primaryPathNoveltyDeduction(3) < primaryPathNoveltyDeduction(8));
  assert.ok(primaryPathNoveltyDeduction(8) < primaryPathNoveltyDeduction(15));
});

test("primaryPathNoveltyDeduction — saves soften penalty", () => {
  const base = primaryPathNoveltyDeduction(6);
  const saved = primaryPathNoveltyDeduction(6, { saveCount: 2 });
  assert.ok(saved < base);
});

test("applyPrimaryPathNoveltyPenalty — Laurindo-like repeat loses to fresh alternative", () => {
  const stats = buildFreshnessStats([
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
    { vibe: "focus", trackIds: ["laurindo"] },
  ]);
  const config = {
    enabled: true,
    stats,
    previousPlaylistCount: 8,
    frequencyPenalty: new Map([["laurindo", 0.48]]),
  };

  const laurindo = applyPrimaryPathNoveltyPenalty(0.82, "laurindo", "Laurindo Almeida", config);
  const fresh = applyPrimaryPathNoveltyPenalty(0.74, "fresh1", "New Artist", config);

  assert.ok(laurindo.penalty > 0.25);
  assert.equal(fresh.penalty, 0);
  assert.ok(fresh.score > laurindo.score);
});

test("buildNoveltyDiagnostics — surfaces displaced alternatives", () => {
  const stats = buildFreshnessStats([{ vibe: "gym", trackIds: ["repeat"] }]);
  const config = {
    enabled: true,
    stats,
    previousPlaylistCount: 1,
  };
  const candidates = [
    { trackId: "repeat", artistName: "A", trackName: "Repeat", scoreBefore: 0.9, scoreAfter: 0.55, penalty: 0.35, appearanceCount: 1 },
    { trackId: "fresh", artistName: "B", trackName: "Fresh", scoreBefore: 0.72, scoreAfter: 0.72, penalty: 0, appearanceCount: 0 },
  ];
  const diag = buildNoveltyDiagnostics(candidates, config, 5);
  assert.ok(diag);
  assert.equal(diag!.displacedTracks[0]?.alternativeTrackId, "fresh");
});

test("resolveNoveltyDiagnostics — prefers direct diagnostics, falls back to audit sample", () => {
  const direct = { trackFrequency: { a: 1 }, previousPlaylistCount: 2, noveltyPenalty: {}, scoreBefore: {}, scoreAfter: {}, displacedTracks: [] };
  assert.deepEqual(resolveNoveltyDiagnostics({ noveltyDiagnostics: direct }, 0), direct);

  const audit = [{ trackId: "x", artistName: "A", trackName: "T", trackFrequency: 3, previousPlaylistCount: 3, noveltyPenalty: 0.1, scoreBefore: 0.8, scoreAfter: 0.7, scoringStage: "post_score_primary_path" as const }];
  const fallback = resolveNoveltyDiagnostics({ noveltyPenaltyAuditSample: audit }, 3);
  assert.ok(fallback);
  assert.equal(fallback!.previousPlaylistCount, 3);
  assert.deepEqual(fallback!.auditSample, audit);
  assert.equal(resolveNoveltyDiagnostics(undefined, 0), null);
  const enabledShell = resolveNoveltyDiagnostics(undefined, 2, true);
  assert.ok(enabledShell);
  assert.equal(enabledShell!.previousPlaylistCount, 2);
});

test("trackPlaylistAppearanceCount reads freshness stats", () => {
  const stats = buildFreshnessStats([
    { vibe: "a", trackIds: ["x", "y"] },
    { vibe: "b", trackIds: ["x"] },
  ]);
  assert.equal(trackPlaylistAppearanceCount(stats, "x"), 2);
  assert.equal(trackPlaylistAppearanceCount(stats, "y"), 1);
});

test("primaryPathArtistNoveltyDeduction — fresh track from repeat artist is penalized", () => {
  assert.equal(primaryPathArtistNoveltyDeduction(0), 0);
  assert.ok(primaryPathArtistNoveltyDeduction(7) > primaryPathArtistNoveltyDeduction(2));

  const stats = buildFreshnessStats([]);
  const config = {
    enabled: true,
    stats,
    previousPlaylistCount: 7,
    artistAppearances: new Map([["paramore", 7]]),
  };
  const paramoreFreshTrack = applyPrimaryPathNoveltyPenalty(0.88, "paramore-new", "Paramore", config);
  const unrelatedFresh = applyPrimaryPathNoveltyPenalty(0.82, "fresh-track", "New Band", config);

  assert.equal(paramoreFreshTrack.appearanceCount, 0);
  assert.ok(paramoreFreshTrack.artistPenalty >= 0.32);
  assert.equal(unrelatedFresh.artistPenalty, 0);
  assert.ok(unrelatedFresh.score > paramoreFreshTrack.score);
});
