/**
 * Tests for generate_complete logging and extended ops metrics.
 *
 * Run: npm run test:observability-completeness
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import {
  initGenerateObs,
  noteGenerateFailure,
  noteGenerateSuccess,
  emitGenerateComplete,
} from "../lib/generate-complete-log";
import { hashedIdTag } from "../lib/pii";
import { getExtendedOpsMetrics, record5xxResponse, recordApiRequest, recordUserFeedbackEvent } from "../lib/ops-metrics-extended";

function mockReq(id = "req-test-1"): Request {
  const res = { statusCode: 200 } as Response;
  return {
    id,
    res,
    log: { info() {}, warn() {} },
  } as unknown as Request;
}

describe("generate_complete observability", () => {
  it("emits structured generate_complete on success", () => {
    const req = mockReq();
    const startMs = Date.now() - 1200;
    initGenerateObs(req, startMs);
    noteGenerateSuccess(req, {
      requestId: "req-test-1",
      userId: "spotify-user-abc",
      playlistSize: 25,
      requestedLength: 25,
      executionPath: "full_pipeline",
      humanSaveable: true,
    });

    let payload: Record<string, unknown> | null = null;
    const log = {
      info(obj: Record<string, unknown>, _msg: string) {
        payload = obj;
      },
      warn() {},
    };

    emitGenerateComplete(req, log as never);
    assert.ok(payload);
    const complete = payload as Record<string, unknown>;
    assert.equal(complete.event, "generate_complete");
    assert.equal(complete.requestId, "req-test-1");
    assert.equal(complete.outcome, "success");
    assert.equal(complete.trackCount, 25);
    assert.equal(complete.userId, hashedIdTag("spotify-user-abc"));
    assert.ok(typeof complete.totalMs === "number");
    assert.ok(complete.stages && typeof complete.stages === "object");
    assert.ok(complete.spotify && typeof complete.spotify === "object");
  });

  it("marks partial outcome when playlist is underfilled", () => {
    const req = mockReq("req-partial");
    initGenerateObs(req, Date.now() - 800);
    noteGenerateSuccess(req, {
      requestId: "req-partial",
      playlistSize: 6,
      requestedLength: 25,
      honestPartial: true,
      executionPath: "full_pipeline",
      humanSaveable: true,
    });

    let payload: Record<string, unknown> | null = null;
    const log = {
      info() {},
      warn(obj: Record<string, unknown>, _msg: string) {
        payload = obj;
      },
    };
    emitGenerateComplete(req, log as never);
    assert.ok(payload);
    assert.equal((payload as Record<string, unknown>).outcome, "partial");
  });

  it("logs failure with errorCode and trace summary hook", () => {
    const req = mockReq("req-fail");
    initGenerateObs(req, Date.now() - 500);
    noteGenerateFailure(req, {
      code: "HUMAN_SAVEABILITY_GATE_FAILED",
      reason: "gate failed",
      executionPath: "gate_failure",
      playlistSize: 0,
      firstCollapseReason: "sampler_empty",
      playlistExecutionTrace: {
        requestId: "req-fail",
        prompt: "test",
        seed: null,
        executionPath: "gate_failure",
        humanSaveable: false,
        stageAttribution: {
          retrieval: { status: "completed", detail: null, diff: null },
          scene_world: { status: "completed", detail: null, diff: null },
          sampler: { status: "failed", detail: "empty", diff: null },
          interleaver: { status: "skipped", detail: null, diff: null },
          editorial_audit: { status: "skipped", detail: null, diff: null },
        },
        dominantCluster: null,
        openingTenClusterTrace: [],
        rejectionReasons: ["sampler:empty"],
        funnelCollapseStage: "sampler_empty",
        fastFallbackUsed: false,
        curatorScore: 0,
        editorialLayer: null,
        editorialStabiliser: null,
        intentCollapseLayer: null,
        trackCounts: { retrieved: 100, after_world: 80, after_sampler: 0, final: 0 },
        debugFlags: { gateExecuted: true, gateBypassed: false, timeoutOccurred: false },
      },
    });
    req.res!.statusCode = 422;

    const warnings: Record<string, unknown>[] = [];
    const log = {
      info() {},
      warn(obj: Record<string, unknown>, _msg: string) {
        warnings.push(obj);
      },
    };
    emitGenerateComplete(req, log as never);

    const complete = warnings.find((w) => w.event === "generate_complete");
    assert.ok(complete);
    assert.equal(complete.outcome, "failure");
    assert.equal(complete.errorCode, "HUMAN_SAVEABILITY_GATE_FAILED");
    assert.equal(complete.poolCollapse, true);
    assert.equal(complete.firstCollapseReason, "sampler_empty");

    const traceSummary = warnings.find((w) => w.event === "playlist_execution_trace_summary");
    assert.ok(traceSummary);
  });

  it("records queue rejection as generate_complete failure", () => {
    const req = mockReq("req-queue");
    (req.res as { statusCode: number }).statusCode = 503;
    initGenerateObs(req, Date.now() - 50);
    noteGenerateFailure(req, {
      code: "SERVER_BUSY",
      reason: "Playlist generation is currently busy. Please retry shortly.",
    });
    const warnings: Record<string, unknown>[] = [];
    emitGenerateComplete(req, {
      info() {},
      warn(obj: Record<string, unknown>) {
        warnings.push(obj);
      },
    } as never);
    const complete = warnings.find((w) => w.event === "generate_complete");
    assert.ok(complete);
    assert.equal(complete.outcome, "failure");
    assert.equal(complete.failureCode, "SERVER_BUSY");
  });

  it("emit is idempotent when called twice", () => {
    const req = mockReq("req-idempotent");
    initGenerateObs(req, Date.now() - 100);
    noteGenerateSuccess(req, { requestId: "req-idempotent", playlistSize: 10, executionPath: "full_pipeline" });
    let count = 0;
    const log = {
      info() {
        count += 1;
      },
      warn() {},
      error() {},
    };
    emitGenerateComplete(req, log as never);
    emitGenerateComplete(req, log as never);
    assert.equal(count, 1);
  });
});

describe("extended ops metrics", () => {
  it("includes memory, 5xx, generate outcomes, and requests per minute", () => {
    record5xxResponse();
    recordApiRequest();
    recordUserFeedbackEvent();
    const snap = getExtendedOpsMetrics();
    assert.ok(snap.memory.heapUsed > 0);
    assert.ok(snap.memory.heapTotal > 0);
    assert.ok(snap.memory.rss > 0);
    assert.equal(snap.response5xx.total >= 1, true);
    assert.equal(snap.requestsPerMinute >= 1, true);
    assert.equal(snap.userFeedback.total >= 1, true);
    assert.ok(snap.generateOutcomes);
    assert.ok(snap.generationPhases.byPhase);
  });
});
