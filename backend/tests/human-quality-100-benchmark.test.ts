import test from "node:test";
import assert from "node:assert/strict";
import {
  build100GenerationRunPlan,
  playlistQualityBand,
  build100GenerationReport,
} from "../lib/human-quality-evaluator/benchmark-100";
import { auditPlaylistAutomated } from "../lib/human-quality-evaluator/automated-audit";
import { evaluateFromApiResponse } from "../lib/human-quality-evaluator/evidence-ingest";

test("build100GenerationRunPlan produces 100 distinct run entries", () => {
  const plan = build100GenerationRunPlan(100);
  assert.equal(plan.length, 100);
  const ids = new Set(plan.map((p) => p.promptId));
  assert.equal(ids.size, 100);
});

test("build100GenerationReport summarizes records", () => {
  const evaluated = evaluateFromApiResponse({
    requestId: "t1",
    vibe: "cozy sunday coffee",
    tracks: [
      { id: "a", name: "Song A", artist: "Artist A" },
      { id: "b", name: "Song B", artist: "Artist B" },
    ],
    length: 25,
    success: true,
  });
  const { markdown, summary } = build100GenerationReport({
    benchmarkRunId: "test-run",
    engineCommit: "abc123",
    records: [{
      benchmarkRunId: "test-run",
      runItem: {
        runIndex: 0,
        seed: 1,
        promptId: "atm-cozy-coffee",
        prompt: "cozy sunday coffee",
        category: "atmosphere",
        difficulty: "normal",
        requestId: "t1",
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      httpStatus: 200,
      success: true,
      error: null,
      commit: "abc123",
      rawResponse: null,
      evaluated,
    }],
  });
  assert.match(markdown, /100-GENERATION/);
  assert.equal(summary.total, 1);
  assert.equal(evaluated.automated.underfill.requested, 25);
  assert.equal(evaluated.automated.underfill.delivered, 2);
  assert.equal(evaluated.automated.underfill.outcome, "partial");
});
