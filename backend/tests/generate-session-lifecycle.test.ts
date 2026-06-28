import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireGenerateSession,
  cancelGenerateSession,
  isGenerateCancelled,
  isGenerateSuperseded,
  isGenerateTimeoutCancelled,
  resolveAuditHardTimeoutMs,
} from "../lib/generate-session";
import {
  AUDIT_REQUEST_HARD_TIMEOUT_MS,
  REQUEST_HARD_TIMEOUT_MS,
} from "../lib/production-limits";

describe("generate session lifecycle", () => {
  it("treats supersession separately from timeout cancellation", () => {
    const userId = `user-${Date.now()}`;
    const firstRequestId = acquireGenerateSession(userId, { hardTimeoutMs: REQUEST_HARD_TIMEOUT_MS });
    assert.ok(firstRequestId);
    cancelGenerateSession(userId, firstRequestId!);
    assert.equal(isGenerateTimeoutCancelled(userId, firstRequestId!), true);
    assert.equal(isGenerateSuperseded(userId, firstRequestId!), false);

    const secondRequestId = acquireGenerateSession(userId, { hardTimeoutMs: REQUEST_HARD_TIMEOUT_MS });
    assert.notEqual(secondRequestId, firstRequestId);
    assert.equal(isGenerateSuperseded(userId, firstRequestId!), true);
    assert.equal(isGenerateCancelled(userId, firstRequestId!), true);
    assert.equal(isGenerateCancelled(userId, secondRequestId!), false);
  });

  it("uses audit timeout budget aligned with benchmark harness", () => {
    assert.equal(resolveAuditHardTimeoutMs(undefined), AUDIT_REQUEST_HARD_TIMEOUT_MS);
    assert.equal(resolveAuditHardTimeoutMs({ evaluationTimeoutMs: 120_000 }), 120_000);
    assert.equal(resolveAuditHardTimeoutMs({ evaluationTimeoutMs: 30_000 }), REQUEST_HARD_TIMEOUT_MS);
    assert.equal(resolveAuditHardTimeoutMs({ evaluationTimeoutMs: 300_000 }), AUDIT_REQUEST_HARD_TIMEOUT_MS);
  });

  it("stores per-session hard timeout for long audit runs", () => {
    const userId = `audit-${Date.now()}`;
    const requestId = acquireGenerateSession(userId, { hardTimeoutMs: AUDIT_REQUEST_HARD_TIMEOUT_MS });
    assert.ok(requestId);
    assert.equal(isGenerateCancelled(userId, requestId!), false);
  });
});
