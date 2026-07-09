import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadNegativeExamples } from "./playlist-quality-benchmark/hall-of-fame-loader";
import { simulatePlaylistReplay } from "./playlist-quality-benchmark/replay-simulator";
import { evaluateSkipRisk } from "./playlist-quality-benchmark/replay-simulator/skip-risk";
import { runPlaylistQualityExperiment } from "./playlist-quality-benchmark/experiment-runner";
import { resolveReferenceTracks, loadHallOfFameEntries, toPatternTrack } from "./playlist-quality-benchmark/hall-of-fame-loader";

describe("playlist replay simulator", () => {
  it("flags high skip risk on gym failure corpus", () => {
    const negatives = loadNegativeExamples();
    const gymSlow = negatives.find((n) => n.id === "neg_gym_too_slow");
    assert.ok(gymSlow);
    const skip = evaluateSkipRisk({ prompt: gymSlow!.prompt, tracks: gymSlow!.tracks, weakOpenerScore: 0.2 });
    assert.ok(skip.score >= 0.55);
    assert.ok(skip.flags.includes("wrong_activity_energy"));
  });

  it("scores reference playlists with reasonable replay proxy", () => {
    const entry = loadHallOfFameEntries().find((e) => e.referenceId === "gym_boost");
    assert.ok(entry);
    const tracks = resolveReferenceTracks(entry!).map(toPatternTrack);
    const sim = simulatePlaylistReplay({ prompt: entry!.prompt, tracks });
    assert.ok(sim);
    assert.ok(sim!.replayProxyScore >= 0.45);
    assert.ok(sim!.saveProxyScore >= 0.45);
    assert.ok(sim!.continueListeningScore >= 0.45);
  });

  it("returns null when fewer than five tracks", () => {
    const sim = simulatePlaylistReplay({
      prompt: "late night drive",
      tracks: [{ trackId: "a-b", artistName: "A", energy: 0.5 }],
    });
    assert.equal(sim, null);
  });

  it("includes replay metrics in experiment reports", () => {
    const record = runPlaylistQualityExperiment({
      name: "replay proxy smoke",
      mode: "offline",
      suites: ["training"],
      persist: false,
    });
    const metrics = record.suites[0]!.metrics;
    assert.ok(metrics.avgReplayProxyScore != null);
    assert.ok(metrics.avgSkipRiskScore != null);
    assert.ok(metrics.avgSaveProxyScore != null);
    assert.ok(record.reportMarkdown.includes("Replay proxy"));
  });
});
