import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadOpeningCuratorV2BenchmarkPrompts } from "./opening-curator-v2-benchmark/loader";
import { runOpeningCuratorV2Benchmark } from "./opening-curator-v2-benchmark/runner";

describe("opening curator v2 human retention benchmark", () => {
  it("loads full prompt suite across six categories", () => {
    const prompts = loadOpeningCuratorV2BenchmarkPrompts();
    assert.ok(prompts.length >= 30);
    const categories = new Set(prompts.map((p: { category: string }) => p.category));
    assert.ok(categories.has("easy_mood"));
    assert.ok(categories.has("functional"));
    assert.ok(categories.has("library_gravity"));
    assert.ok(categories.has("adversarial"));
  });

  it("runs offline benchmark and produces executive report", () => {
    const report = runOpeningCuratorV2Benchmark({ mode: "offline" });
    assert.equal(report.mode, "offline");
    assert.equal(report.results.length, report.promptCount);
    assert.ok(report.markdown.includes("Executive answers"));
    assert.ok(report.rankedWeaknesses.length > 0);
    assert.ok(report.topRoiFixes.length > 0);
  });

  it("flags library gravity simulations as non-human openings", () => {
    const report = runOpeningCuratorV2Benchmark({ mode: "offline" });
    const gravity = report.results.filter((r: { category: string }) => r.category === "library_gravity");
    assert.ok(gravity.length >= 3);
    const nonHuman = gravity.filter((r: { feelsHumanFirstFive: boolean }) => !r.feelsHumanFirstFive);
    assert.ok(nonHuman.length >= 2);
  });
});
