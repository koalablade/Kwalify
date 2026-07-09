import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  compareExperimentMetrics,
  decideExperimentRecommendation,
  decideOverallRecommendation,
} from "./playlist-quality-benchmark/experiment-comparator";
import { buildExperimentMetadata } from "./playlist-quality-benchmark/experiment-metadata";
import { formatExperimentMarkdown } from "./playlist-quality-benchmark/experiment-report";
import { runPlaylistQualityExperiment } from "./playlist-quality-benchmark/experiment-runner";
import {
  listPromptSuiteSplits,
  loadPromptSuiteEntries,
  loadPromptSuiteManifest,
} from "./playlist-quality-benchmark/prompt-suite-loader";
import { loadQualityBaseline } from "./playlist-quality-benchmark/regression-gate";

describe("playlist quality experiment tracking", () => {
  it("loads prompt suite manifest with train/validation/stress splits", () => {
    const manifest = loadPromptSuiteManifest();
    assert.equal(manifest.promptSuiteVersion, "1.0.0");
    assert.ok(manifest.splits.training.tuningAllowed);
    assert.equal(manifest.splits.validation.tuningAllowed, false);
    assert.equal(manifest.splits.stress.tuningAllowed, false);
  });

  it("loads validation and stress holdout prompts", () => {
    const validation = loadPromptSuiteEntries("validation");
    const stress = loadPromptSuiteEntries("stress");
    assert.ok(validation.length >= 5);
    assert.ok(stress.length >= 5);
    assert.ok(validation.every((row) => row.suite === "validation"));
    assert.ok(stress.every((row) => row.libraryDependency));
  });

  it("builds experiment metadata with git and version fields", () => {
    const metadata = buildExperimentMetadata({
      name: "candidate retrieval v3",
      mode: "offline",
      suite: "training",
      configurationFlags: { retrievalVersion: 3 },
    });
    assert.match(metadata.id, /candidate-retrieval-v3/);
    assert.equal(metadata.name, "candidate retrieval v3");
    assert.equal(metadata.configurationFlags.retrievalVersion, 3);
    assert.equal(metadata.promptSuiteVersion, "1.0.0");
  });

  it("compares metrics and recommends SHIP on improvement without regression", () => {
    const baseline = loadQualityBaseline();
    assert.ok(baseline);

    const syntheticBaseline = {
      ...baseline,
      metrics: {
        ...baseline.metrics,
        openingPassRate: 0.61,
        firstAttemptSuccessRate: 0.54,
        humanPreferenceWinRate: 0.48,
      },
    };

    const improved = {
      ...syntheticBaseline.metrics,
      openingPassRate: 0.72,
      firstAttemptSuccessRate: 0.67,
      humanPreferenceWinRate: 0.55,
    };

    const comparison = compareExperimentMetrics(improved, syntheticBaseline);
    assert.equal(comparison.regressionPassed, true);
    assert.ok(comparison.improvements.length >= 1);
    assert.equal(decideExperimentRecommendation(comparison), "SHIP");
  });

  it("rejects experiments when hard activity regresses", () => {
    const baseline = loadQualityBaseline();
    assert.ok(baseline);

    const regressed = {
      ...baseline.metrics,
      byCategory: {
        ...baseline.metrics.byCategory,
        hard_activity: {
          ...baseline.metrics.byCategory.hard_activity,
          openingPassRate: Math.max(0, (baseline.metrics.byCategory.hard_activity.openingPassRate ?? 0.7) - 0.15),
        },
      },
    };

    const comparison = compareExperimentMetrics(regressed, baseline);
    assert.equal(decideExperimentRecommendation(comparison), "REJECT");
  });

  it("runs offline experiment and produces markdown report", () => {
    const record = runPlaylistQualityExperiment({
      name: "offline smoke experiment",
      mode: "offline",
      suites: ["training"],
      persist: false,
    });

    assert.ok(record.metadata.id);
    assert.equal(record.suites.length, 1);
    assert.ok(["SHIP", "HOLD", "REJECT"].includes(record.overallRecommendation));
    assert.ok(record.reportMarkdown.includes("## Recommendation"));
    assert.ok(formatExperimentMarkdown(record).includes(record.metadata.name));
  });

  it("overall recommendation defers to holdout when validation is mixed", () => {
    const overall = decideOverallRecommendation([
      { suite: "training", recommendation: "SHIP", tuningAllowed: true },
      { suite: "validation", recommendation: "HOLD", tuningAllowed: false },
    ]);
    assert.equal(overall, "HOLD");
  });

  it("lists all prompt suite splits", () => {
    assert.deepEqual(listPromptSuiteSplits(), ["training", "validation", "stress"]);
  });
});
