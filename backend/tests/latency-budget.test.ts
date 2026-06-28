import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLatencyBudget,
  LATENCY_DELIVERY_RESERVE_MS,
  LATENCY_GOOD_PLAYLIST_TARGET_MS,
  LATENCY_HARD_DEADLINE_MS,
} from "../lib/latency-budget";

describe("latency budget", () => {
  it("stays in core phase until a good playlist is ready", () => {
    const budget = createLatencyBudget(Date.now() - 25_000);
    assert.equal(budget.currentPhase(), "core");
    assert.equal(budget.shouldSkipMarginalImprovement(), false);
    budget.markGoodPlaylistReady();
    assert.equal(budget.currentPhase(), "improvement");
    assert.equal(budget.shouldSkipMarginalImprovement(), false);
  });

  it("enters delivery phase and skips marginal improvement near hard deadline", () => {
    const start = Date.now() - LATENCY_HARD_DEADLINE_MS + LATENCY_DELIVERY_RESERVE_MS - 500;
    const budget = createLatencyBudget(start);
    budget.markGoodPlaylistReady();
    assert.equal(budget.currentPhase(), "delivery");
    assert.equal(budget.mustDeliverNow(), true);
    assert.equal(budget.shouldSkipMarginalImprovement(), true);
  });

  it("records good-playlist-ready timing in snapshot", () => {
    const start = Date.now() - 15_000;
    const budget = createLatencyBudget(start);
    budget.markGoodPlaylistReady();
    const snap = budget.snapshot();
    assert.equal(snap.goodPlaylistTargetMs, LATENCY_GOOD_PLAYLIST_TARGET_MS);
    assert.ok((snap.goodPlaylistReadyElapsedMs ?? 0) >= 14_000);
    assert.equal(snap.phase, "improvement");
  });

  it("marks exceeded explicitly", () => {
    const budget = createLatencyBudget();
    budget.markExceeded();
    assert.equal(budget.isHardDeadlineExceeded(), true);
    assert.equal(budget.snapshot().latencyBudgetExceeded, true);
  });
});
