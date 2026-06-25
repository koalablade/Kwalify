/**
 * Completeness tests for benchmark observability reliability.
 *
 * Run: npm run test:observability-completeness
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHtmlResponseBody, EXECUTION_PATHS } from "../core/observability/execution-state";
import {
  buildGateFailureExecutionTraceDraft,
  finalizePlaylistExecutionTrace,
} from "../core/observability/playlist-execution-trace";
import { parseHumanSaveabilityFromGenerateResponse } from "../lib/human-saveability-benchmark-parse";
import { fetchAndParseBenchmarkGenerate } from "../lib/benchmark-generate-fetch";

describe("observability completeness", () => {
  it("detects HTML bodies and never treats them as JSON", () => {
    const html = "<!DOCTYPE html><html><body>deploy</body></html>";
    assert.equal(isHtmlResponseBody(html), true);
    const parsed = parseHumanSaveabilityFromGenerateResponse(502, {});
    assert.equal(parsed.tracePresent, false);
    assert.equal(parsed.rejectionReasons[0], "missing_final_trace");
  });

  it("every execution path enum value is recognized", () => {
    for (const path of EXECUTION_PATHS) {
      const trace = finalizePlaylistExecutionTrace({
        requestId: "r",
        prompt: "p",
        executionPath: path,
        humanSaveable: path === "full_pipeline",
        rejectionReasons: path === "full_pipeline" ? ["human_saveable:passed"] : [`path:${path}`],
        debugFlags: {
          gateExecuted: path === "full_pipeline" || path === "gate_failure",
          gateBypassed: path === "fast_fallback" || path === "timeout_fallback",
          timeoutOccurred: path === "timeout_fallback",
        },
      });
      assert.equal(trace.executionPath, path);
      assert.ok(trace.rejectionReasons.length > 0);
    }
  });

  it("gate failure with non-finite curator score uses partial_pipeline attribution", () => {
    const trace = finalizePlaylistExecutionTrace(
      buildGateFailureExecutionTraceDraft({
        requestId: "req",
        prompt: "rainy walk",
        seed: 1,
        gate: {
          rejectionReasons: [],
          curatorScore: null,
          breakdown: { curatorScore: null },
          attribution: { stageResponsible: "sampler" },
        },
      }),
    );
    assert.equal(trace.executionPath, "partial_pipeline");
    assert.ok(trace.rejectionReasons.some((r) => r.includes("evaluation_metadata_incomplete")));
    assert.ok(!trace.rejectionReasons.includes("unspecified"));
  });

  it("failure traces never have empty rejectionReasons", () => {
    const trace = finalizePlaylistExecutionTrace({
      requestId: "r",
      prompt: "p",
      executionPath: "timeout_fallback",
      humanSaveable: false,
      rejectionReasons: [],
      debugFlags: { gateExecuted: false, gateBypassed: true, timeoutOccurred: true },
    });
    assert.ok(trace.rejectionReasons.length > 0);
  });

  it("parses only top-level playlistExecutionTrace", () => {
    const parsed = parseHumanSaveabilityFromGenerateResponse(200, {
      v3Diagnostics: {
        playlistExecutionTrace: {
          requestId: "nested-only",
          prompt: "should not parse",
          executionPath: "full_pipeline",
          humanSaveable: true,
          rejectionReasons: ["human_saveable:passed"],
        },
      },
    });
    assert.equal(parsed.tracePresent, false);
    assert.equal(parsed.rejectionReasons[0], "missing_final_trace");

    const topLevel = parseHumanSaveabilityFromGenerateResponse(200, {
      playlistExecutionTrace: {
        requestId: "top",
        prompt: "ok",
        executionPath: "full_pipeline",
        humanSaveable: true,
        rejectionReasons: ["human_saveable:passed"],
        debugFlags: { gateExecuted: true, gateBypassed: false, timeoutOccurred: false },
      },
    });
    assert.equal(topLevel.tracePresent, true);
    assert.equal(topLevel.executionPath, "full_pipeline");
  });

  it("null curator score on failure normalizes to 0 in benchmark parse", () => {
    const parsed = parseHumanSaveabilityFromGenerateResponse(422, {
      playlistExecutionTrace: finalizePlaylistExecutionTrace(
        buildGateFailureExecutionTraceDraft({
          requestId: "r",
          prompt: "p",
          gate: {
            rejectionReasons: ["evaluation_metadata_incomplete:curator_score_non_finite"],
            curatorScore: null,
            attribution: { stageResponsible: "sampler" },
          },
        }),
      ),
    });
    assert.equal(parsed.curatorScore, 0);
    assert.ok(parsed.rejectionReasons.length > 0);
  });
});

describe("benchmark html fetch helper", () => {
  it("exports fetch helper for integration", () => {
    assert.equal(typeof fetchAndParseBenchmarkGenerate, "function");
  });
});
