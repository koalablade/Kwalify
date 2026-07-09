import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { orderTracksByPlaylistSegments } from "../core/emotional-arc-planner";
import { applyOpeningCuratorV2 } from "../lib/opening-curator-v2";
import { loadNegativeExamples } from "./playlist-quality-benchmark/hall-of-fame-loader";
import { simulatePlaylistReplay } from "./playlist-quality-benchmark/replay-simulator";
import {
  loadHallOfFameEntries,
  resolveReferenceTracks,
  toPatternTrack,
} from "./playlist-quality-benchmark/hall-of-fame-loader";

const gymTracks = [
  { trackId: "slow", artistName: "Black Sabbath", energy: 0.22, popularity: 55, danceability: 0.3, acousticness: 0.4, rediscoveryScore: 0.2 },
  { trackId: "drive1", artistName: "Eminem", energy: 0.85, popularity: 82, danceability: 0.72, acousticness: 0.1, rediscoveryScore: 0.15 },
  { trackId: "drive2", artistName: "Kanye West", energy: 0.82, popularity: 78, danceability: 0.7, acousticness: 0.08, rediscoveryScore: 0.18 },
  { trackId: "drive3", artistName: "David Guetta", energy: 0.8, popularity: 76, danceability: 0.75, acousticness: 0.06, rediscoveryScore: 0.2 },
  { trackId: "drive4", artistName: "Survivor", energy: 0.84, popularity: 74, danceability: 0.68, acousticness: 0.12, rediscoveryScore: 0.22 },
  ...Array.from({ length: 10 }, (_, i) => ({
    trackId: `tail-${i}`,
    artistName: `Artist ${i}`,
    energy: 0.7 + i * 0.01,
    popularity: 60,
    danceability: 0.65,
    acousticness: 0.1,
    rediscoveryScore: 0.3,
  })),
];

describe("opening curator v2", () => {
  it("promotes identity-matched opener for gym prompt", () => {
    const result = applyOpeningCuratorV2({
      prompt: "gym confidence boost high energy workout",
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.8 + 0.1,
      intentForActivity: { activity: "gym" },
    });
    assert.notEqual(result.tracks[0]!.trackId, "slow");
    assert.ok(["drive1", "drive2", "drive3", "drive4"].includes(result.tracks[0]!.trackId));
    assert.ok(result.openingDecision.identityStrength >= 0.45);
    assert.equal(new Set(result.tracks.slice(0, 5).map((t) => t.artistName)).size, 5);
  });

  it("exposes audit-only openingDecision diagnostics", () => {
    const result = applyOpeningCuratorV2({
      prompt: "late night drive",
      tracks: gymTracks,
      scorePromptRelevance: (track) => 0.5,
    });
    assert.ok(result.openingDecision.openerTrackId);
    assert.ok(result.openingDecision.openingReason);
    assert.ok(Array.isArray(result.openingDecision.rejectedOpeningCandidates));
  });

  it("improves replay proxy vs deliberately weak gym opening", () => {
    const prompt = "gym confidence boost high energy workout";
    const before = simulatePlaylistReplay({ prompt, tracks: gymTracks });
    const curated = applyOpeningCuratorV2({
      prompt,
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const after = simulatePlaylistReplay({ prompt, tracks: curated.tracks });
    assert.ok(before && after);
    assert.ok(after!.replayProxyScore >= before!.replayProxyScore);
    assert.ok(after!.skipRiskScore <= before!.skipRiskScore);
  });

  it("improves hall of fame reference openings when deep cut is forced first", () => {
    const entry = loadHallOfFameEntries().find((e) => e.referenceId === "gym_boost");
    assert.ok(entry);
    const reference = resolveReferenceTracks(entry!).map(toPatternTrack);
    if (reference.length < 8) return;

    const mangled = reference.map((t, i) => ({ ...t, trackId: `${t.trackId}-${i}` }));
    const slow = { ...mangled[0]!, energy: 0.25, popularity: 15, rediscoveryScore: 0.8 };
    const badOpening = [slow, ...mangled.slice(1)];

    const before = simulatePlaylistReplay({ prompt: entry!.prompt, tracks: badOpening });
    const curated = applyOpeningCuratorV2({
      prompt: entry!.prompt,
      tracks: badOpening,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.7 + 0.15,
      intentForActivity: { activity: "gym" },
    });
    const after = simulatePlaylistReplay({ prompt: entry!.prompt, tracks: curated.tracks });
    assert.ok(before && after);
    assert.ok(after!.openingRetention.score >= before!.openingRetention.score);
  });

  it("preserves curated opening window through emotional arc ordering", () => {
    const prompt = "gym confidence boost high energy workout";
    const curated = applyOpeningCuratorV2({
      prompt,
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const openingIds = curated.tracks.slice(0, 5).map((t) => t.trackId);
    const arc = { start: "calm", peak: "aggressive", resolution: "controlled-power" };
    const afterArc = orderTracksByPlaylistSegments(curated.tracks, arc, {
      preservePrefixCount: 5,
    });
    assert.deepEqual(afterArc.slice(0, 5).map((t) => t.trackId), openingIds);
    assert.equal(afterArc.length, curated.tracks.length);
  });

  it("flags high skip risk on negative gym corpus before curation", () => {
    const neg = loadNegativeExamples().find((n) => n.id === "neg_gym_too_slow");
    assert.ok(neg);
    const before = simulatePlaylistReplay({ prompt: neg!.prompt, tracks: neg!.tracks });
    const curated = applyOpeningCuratorV2({
      prompt: neg!.prompt,
      tracks: neg!.tracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5),
      intentForActivity: { activity: "gym" },
    });
    const after = simulatePlaylistReplay({ prompt: neg!.prompt, tracks: curated.tracks });
    assert.ok(before && after);
    assert.ok(before!.skipRiskScore >= 0.5);
  });
});
