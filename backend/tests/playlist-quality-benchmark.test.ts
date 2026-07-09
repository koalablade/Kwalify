import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluateBlindPairwise } from "./playlist-quality-benchmark/blind-pairwise-evaluator";
import {
  loadHallOfFameEntries,
  loadNegativeExamples,
  resolveReferenceTracks,
  toPatternTrack,
} from "./playlist-quality-benchmark/hall-of-fame-loader";
import { buildFirstAttemptRecord, aggregateBenchmarkMetrics } from "./playlist-quality-benchmark/metrics-aggregator";
import {
  detectNegativeFailure,
  evaluateNegativeCorpusSelfTest,
} from "./playlist-quality-benchmark/negative-example-detector";
import { evaluateOpeningFive } from "./playlist-quality-benchmark/opening-five-evaluator";
import {
  evaluateRegressionGate,
  loadQualityBaseline,
} from "./playlist-quality-benchmark/regression-gate";
import {
  evaluateHallOfFameOffline,
  runQualityBenchmarkReport,
} from "./playlist-quality-benchmark/quality-benchmark-runner";
import { runGoldenPromptTests } from "./golden-prompts.test";

describe("playlist quality benchmark", () => {
  it("loads hall of fame entries across all categories", () => {
    const entries = loadHallOfFameEntries();
    assert.ok(entries.length >= 12);
    for (const category of ["easy_mood", "functional", "hard_activity", "emotional_specific"]) {
      assert.ok(entries.some((e) => e.category === category), `missing category ${category}`);
    }
  });

  it("blind pairwise hides labels and returns dimension scores", () => {
    const entry = loadHallOfFameEntries().find((e) => e.referenceId === "late_night");
    assert.ok(entry);
    const humanTracks = resolveReferenceTracks(entry!).map(toPatternTrack);
    const kwalifyTracks = humanTracks.map((t, i) => ({
      ...t,
      trackId: `${t.trackId}-kw-${i}`,
      energy: typeof t.energy === "number" ? Math.min(1, t.energy + 0.08) : t.energy,
    }));
    const result = evaluateBlindPairwise({
      prompt: entry!.prompt,
      humanTracks,
      kwalifyTracks,
      seed: 42,
    });
    assert.ok(result);
    assert.ok(["human", "kwalify", "tie"].includes(result!.winner));
    assert.ok(result!.dimensions.openingQuality);
    assert.ok(result!.dimensions.saveLikelihood);
  });

  it("opening five evaluation weights first track heavily", () => {
    const negatives = loadNegativeExamples();
    const gymSlow = negatives.find((n) => n.id === "neg_gym_too_slow");
    assert.ok(gymSlow);
    const opening = evaluateOpeningFive({ prompt: gymSlow!.prompt, tracks: gymSlow!.tracks });
    assert.ok(opening);
    assert.equal(opening!.pass, false);
    assert.ok(opening!.issues.length > 0);
  });

  it("detects negative corpus failures", () => {
    const selfTest = evaluateNegativeCorpusSelfTest();
    assert.equal(selfTest.pass, true, selfTest.failures.join("\n"));
  });

  it("tracks first attempt success by prompt category", () => {
    const saved = buildFirstAttemptRecord({
      promptId: "test_saved",
      prompt: "late night drive",
      category: "easy_mood",
      difficulty: "easy",
      generationSuccess: true,
      libraryInsufficient: false,
    });
    assert.equal(saved.outcome, "saved");
    assert.equal(saved.firstGenerationSuccess, true);

    const regen = buildFirstAttemptRecord({
      promptId: "test_regen",
      prompt: "gym boost",
      category: "hard_activity",
      difficulty: "hard",
      generationSuccess: true,
      libraryInsufficient: false,
      varietyBoost: true,
    });
    assert.equal(regen.outcome, "regenerated");
    assert.equal(regen.firstGenerationSuccess, false);
  });

  it("runs offline regression report with golden prompts", () => {
    const golden = runGoldenPromptTests();
    assert.equal(golden.failed, 0, golden.failures.join("\n"));

    const report = runQualityBenchmarkReport({ mode: "offline" });
    assert.ok(report.results.length >= 12);
    assert.ok(report.metrics.firstAttemptSuccessRate != null);
    assert.ok(report.metrics.byCategory.easy_mood.count > 0);
  });

  it("regression gate compares against baseline when present", () => {
    const report = runQualityBenchmarkReport({ mode: "offline" });
    const baseline = loadQualityBaseline();
    const gate = evaluateRegressionGate(report.metrics, baseline?.metrics ?? null);
    assert.ok(typeof gate.passed === "boolean");
    if (!baseline) {
      assert.ok(gate.flags.some((f) => f.includes("no_baseline")));
    }
  });

  it("offline hall of fame evaluation produces pairwise results", () => {
    const results = evaluateHallOfFameOffline();
    const withPairwise = results.filter((r) => r.blindPairwise);
    assert.ok(withPairwise.length >= 10);
    const metrics = aggregateBenchmarkMetrics(results, { passed: 59, failed: 0 });
    assert.ok(metrics.humanPreferenceWinRate != null);
  });
});
