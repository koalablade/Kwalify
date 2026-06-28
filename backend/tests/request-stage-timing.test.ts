import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequestStageTiming, formatRequestStageTimingMarkdown } from "../lib/request-stage-timing";

describe("request stage timing", () => {
  it("rolls up v3 timing into canonical stages", () => {
    const timing = createRequestStageTiming(Date.now() - 50_000);
    timing.mergeV3TimingMs({
      timingMs: {
        retrieval: 12_000,
        intentExpansion: 2_000,
        laneGeneration: 8_000,
        scoring: 15_000,
        completeSearch: 9_000,
        localSearch: 4_000,
        humanSaveability: 6_000,
      },
    });
    timing.setTotal(50_000);
    const report = timing.report();
    assert.equal(report.stages.retrieval.ms, 12_000);
    assert.equal(report.stages.intent_expansion.ms, 2_000);
    assert.equal(report.stages.beam_complete_search.ms, 9_000);
    assert.ok(report.stages.candidate_generation.ms >= 23_000);
    assert.equal(report.slowestStage, "candidate_generation");
  });

  it("formats markdown timing sections", () => {
    const timing = createRequestStageTiming();
    timing.add("retrieval", 40_000);
    timing.add("diagnostics", 12_000);
    timing.setTotal(55_000);
    const md = formatRequestStageTimingMarkdown("test-id", "rainy night walk", 55_000, timing.report(), {
      latencyBudgetExceeded: true,
      retries: { humanSaveability: 2 },
    });
    assert.match(md, /latencyBudgetExceeded/);
    assert.match(md, /retrieval \| 40000/);
  });
});
