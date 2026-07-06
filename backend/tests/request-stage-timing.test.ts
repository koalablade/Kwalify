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

  it("maps production timeline v3 wall time to v3_pipeline stage", () => {
    const timing = createRequestStageTiming(Date.now() - 60_000);
    timing.mergeProductionTimeline({
      v3_pipeline: 55_000,
      candidate_fetch: 3_000,
      prompt_understanding: 2_000,
    });
    timing.mergePlaylistPipelineTimingMs({
      scoring: 12_000,
      retrieval: 8_000,
      candidateGeneration: 1_200,
      v3ScoringAndSampling: 47_500,
    });
    timing.setTotal(60_000);
    const report = timing.report();
    assert.equal(report.stages.v3_pipeline.ms, 55_000);
    assert.equal(report.stages.v3_multi_candidate_loop.ms, 47_500);
    assert.equal(report.stages.candidate_pool_build.ms, 1_200);
    assert.equal(report.stages.pre_v3_hybrid_scoring.ms, 12_000);
    assert.notEqual(report.slowestStage, "candidate_pool_build");
    assert.equal(report.stages.retrieval.ms, 3_000 + 8_000);
  });

  it("does not fold v3 multi-candidate loop into candidate_pool_build", () => {
    const timing = createRequestStageTiming();
    timing.mergePlaylistPipelineTimingMs({
      candidateGeneration: 800,
      v3ScoringAndSampling: 82_000,
    });
    timing.setTotal(83_000);
    const report = timing.report();
    assert.equal(report.slowestStage, "v3_multi_candidate_loop");
    assert.equal(report.stages.candidate_pool_build.ms, 800);
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
