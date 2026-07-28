/**
 * Error-tracking abstraction — ensures captureError routes to sinks safely.
 *
 * Run: npm run build && node --test backend/dist/tests/error-tracking.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureError,
  hasErrorSink,
  setErrorSink,
  type ErrorSink,
} from "../lib/error-tracking";

describe("error-tracking", () => {
  it("logs locally even when no sink is configured", () => {
    setErrorSink(null);
    assert.equal(hasErrorSink(), false);
    captureError(new Error("local-only"), { source: "test" });
  });

  it("forwards errors to an installed sink with context", () => {
    const captured: Array<{ error: unknown; context: Record<string, unknown> }> = [];
    const sink: ErrorSink = (error, context) => {
      captured.push({ error, context });
    };
    setErrorSink(sink);
    assert.equal(hasErrorSink(), true);

    const err = new Error("sink-test");
    captureError(err, { source: "test_sink", requestId: "req-1" });
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.error, err);
    assert.equal(captured[0]!.context.requestId, "req-1");

    setErrorSink(null);
  });

  it("isolates sink failures so tracking never throws into app logic", () => {
    setErrorSink(() => {
      throw new Error("sink exploded");
    });
    assert.doesNotThrow(() => captureError(new Error("survives"), { source: "test" }));
    setErrorSink(null);
  });
});
