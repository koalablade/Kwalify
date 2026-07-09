import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { orderTracksByPlaylistSegments } from "../core/emotional-arc-planner";
import { computeEmotionalConsistencyScore } from "../lib/emotional-consistency-score";
import { applyOpeningCuratorV2 } from "../lib/opening-curator-v2";
import {
  createOpeningLock,
  enforceOpeningLock,
  mergeTracksWithOpeningLock,
  OPENING_LOCK_REASON,
} from "../lib/opening-lock";
import { simulatePlaylistReplay } from "./playlist-quality-benchmark/replay-simulator";

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

const focusTracks = [
  { trackId: "loud", artistName: "Metallica", energy: 0.9, popularity: 80, danceability: 0.4, acousticness: 0.05, rediscoveryScore: 0.1 },
  { trackId: "calm1", artistName: "Bonobo", energy: 0.35, popularity: 70, danceability: 0.55, acousticness: 0.6, rediscoveryScore: 0.2 },
  { trackId: "calm2", artistName: "Tycho", energy: 0.38, popularity: 68, danceability: 0.5, acousticness: 0.58, rediscoveryScore: 0.22 },
  { trackId: "calm3", artistName: "Emancipator", energy: 0.32, popularity: 62, danceability: 0.48, acousticness: 0.62, rediscoveryScore: 0.25 },
  { trackId: "calm4", artistName: "Helios", energy: 0.36, popularity: 58, danceability: 0.52, acousticness: 0.55, rediscoveryScore: 0.28 },
  { trackId: "calm5", artistName: "Nujabes", energy: 0.4, popularity: 72, danceability: 0.58, acousticness: 0.5, rediscoveryScore: 0.18 },
  ...Array.from({ length: 8 }, (_, i) => ({
    trackId: `focus-tail-${i}`,
    artistName: `Focus ${i}`,
    energy: 0.42 + i * 0.01,
    popularity: 55,
    danceability: 0.5,
    acousticness: 0.5,
    rediscoveryScore: 0.3,
  })),
];

describe("opening lock", () => {
  it("creates opening lock metadata after curator v2", () => {
    const curated = applyOpeningCuratorV2({
      prompt: "gym confidence boost high energy workout",
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    assert.ok(curated.openingLock);
    assert.equal(curated.openingLock!.enabled, true);
    assert.equal(curated.openingLock!.reason, OPENING_LOCK_REASON);
    assert.equal(curated.openingLock!.lockedTrackIds.length, 5);
    assert.deepEqual(curated.openingLock!.lockedTrackIds, curated.tracks.slice(0, 5).map((t) => t.trackId));
  });

  it("does not create opening lock when playlist is shorter than 6 tracks", () => {
    const short = gymTracks.slice(0, 5);
    const lock = createOpeningLock(short);
    assert.equal(lock, null);
  });

  it("preserves curated opening through arc ordering and lock enforcement", () => {
    const prompt = "gym confidence boost high energy workout";
    const curated = applyOpeningCuratorV2({
      prompt,
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const lock = curated.openingLock!;
    const arc = { start: "calm", peak: "aggressive", resolution: "controlled-power" };
    const afterArc = orderTracksByPlaylistSegments(curated.tracks, arc, { preservePrefixCount: 5 });
    const shuffled = [...afterArc.slice(5), ...afterArc.slice(0, 5)];
    const enforced = enforceOpeningLock(shuffled, lock);
    assert.deepEqual(
      enforced.tracks.slice(0, 5).map((t) => t.trackId),
      lock.lockedTrackIds,
    );
    assert.equal(enforced.preserved, true);
  });

  it("keeps gym opener as strongest drive track after lock enforcement", () => {
    const curated = applyOpeningCuratorV2({
      prompt: "gym confidence boost high energy workout",
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const mangled = [...curated.tracks.slice(5), curated.tracks[0]!, ...curated.tracks.slice(1, 5)];
    const enforced = enforceOpeningLock(mangled, curated.openingLock!);
    assert.notEqual(enforced.tracks[0]!.trackId, "slow");
    assert.ok((enforced.tracks[0]!.energy ?? 0) >= 0.78);
  });

  it("keeps focus opener calm after lock enforcement", () => {
    const curated = applyOpeningCuratorV2({
      prompt: "focus study deep work concentration",
      tracks: focusTracks,
      scorePromptRelevance: (track) => 1 - (track.energy ?? 0.5) * 0.7,
      intentForActivity: { activity: "focus" },
    });
    const mangled = [focusTracks[0]!, ...curated.tracks.slice(1)];
    const enforced = enforceOpeningLock(mangled, curated.openingLock!);
    assert.ok((enforced.tracks[0]!.energy ?? 1) <= 0.45);
    assert.notEqual(enforced.tracks[0]!.trackId, "loud");
  });

  it("logs removal when critical validation drops a locked track", () => {
    const curated = applyOpeningCuratorV2({
      prompt: "gym confidence boost high energy workout",
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const openerId = curated.openingLock!.lockedTrackIds[0]!;
    const afterPrune = curated.tracks.filter((track) => track.trackId !== openerId);
    const merged = mergeTracksWithOpeningLock(
      afterPrune,
      curated.openingLock!,
      [],
      "generic_gym_api_contamination_prune",
    );
    assert.ok(merged.violations.some((v) => v.trackId === openerId && v.action === "removed"));
    assert.ok(!merged.lock.lockedTrackIds.includes(openerId));
  });

  it("does not regress emotional consistency score after lock enforcement", () => {
    const curated = applyOpeningCuratorV2({
      prompt: "gym confidence boost high energy workout",
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const before = computeEmotionalConsistencyScore({
      tracks: curated.tracks,
      sceneConfidence: 0.7,
      hasCanonicalScene: true,
    });
    const mangled = [...curated.tracks].reverse();
    const enforced = enforceOpeningLock(mangled, curated.openingLock!);
    const after = computeEmotionalConsistencyScore({
      tracks: enforced.tracks,
      sceneConfidence: 0.7,
      hasCanonicalScene: true,
    });
    assert.ok(after.score >= before.score - 8);
  });

  it("maintains replay proxy after lock enforcement on weak opening shuffle", () => {
    const prompt = "gym confidence boost high energy workout";
    const curated = applyOpeningCuratorV2({
      prompt,
      tracks: gymTracks,
      scorePromptRelevance: (track) => (track.energy ?? 0.5) * 0.75 + 0.12,
      intentForActivity: { activity: "gym" },
    });
    const baseline = simulatePlaylistReplay({ prompt, tracks: curated.tracks });
    const shuffled = [gymTracks[0]!, ...curated.tracks.slice(1)];
    const enforced = enforceOpeningLock(shuffled, curated.openingLock!);
    const after = simulatePlaylistReplay({ prompt, tracks: enforced.tracks });
    assert.ok(baseline && after);
    assert.ok(after!.replayProxyScore >= baseline!.replayProxyScore - 0.02);
    assert.ok(after!.skipRiskScore <= baseline!.skipRiskScore + 0.05);
  });
});
