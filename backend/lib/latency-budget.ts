/**
 * Request latency budget — phased delivery without changing scoring.
 *
 * 1. Core: find a good playlist (design target ~10–20s). Never skip core pipeline work.
 * 2. Improvement: refine while time remains after a usable playlist exists.
 * 3. Delivery: reserve final seconds for serialization; return the best playlist so far.
 */

/** Design center for “good playlist found” (10–20s target band). */
export const LATENCY_GOOD_PLAYLIST_TARGET_MS = 18_000;
export const LATENCY_GOOD_PLAYLIST_MAX_MS = 20_000;
export const LATENCY_HARD_DEADLINE_MS = 90_000;
/** Reserve time at the end for API serialization — no marginal work in this window. */
export const LATENCY_DELIVERY_RESERVE_MS = 3_000;
/** Cooperative abort for long-running core work before the delivery reserve. */
export const LATENCY_HARD_DEADLINE_BUFFER_MS = 2_000;

/** @deprecated Use LATENCY_GOOD_PLAYLIST_TARGET_MS */
export const LATENCY_TARGET_MS = LATENCY_GOOD_PLAYLIST_TARGET_MS;

export type LatencyPhase = "core" | "improvement" | "delivery";

export type LatencyBudgetSnapshot = {
  startedAt: number;
  elapsedMs: number;
  goodPlaylistTargetMs: number;
  goodPlaylistReadyAt: number | null;
  goodPlaylistReadyElapsedMs: number | null;
  phase: LatencyPhase;
  hardDeadlineMs: number;
  shouldSkipMarginalImprovement: boolean;
  mustDeliverNow: boolean;
  latencyBudgetExceeded: boolean;
  remainingImprovementMs: number | null;
  remainingHardMs: number;
};

export type LatencyBudget = {
  startedAt: number;
  hardDeadlineAt: number;
  exceeded: boolean;
  elapsedMs(): number;
  markGoodPlaylistReady(): void;
  goodPlaylistReady(): boolean;
  currentPhase(): LatencyPhase;
  /** Skip beam search, local search, retries, coherence rebuild — not core generation. */
  shouldSkipMarginalImprovement(): boolean;
  /** Return the best playlist now; do not chase marginal gains. */
  mustDeliverNow(): boolean;
  isHardDeadlineApproaching(): boolean;
  isHardDeadlineExceeded(): boolean;
  markExceeded(): void;
  snapshot(): LatencyBudgetSnapshot;
};

export function createLatencyBudget(
  startedAt = Date.now(),
  hardDeadlineMs = LATENCY_HARD_DEADLINE_MS,
): LatencyBudget {
  const hardDeadlineAt = startedAt + hardDeadlineMs;
  let exceeded = false;
  let goodPlaylistReadyAt: number | null = null;

  const buildSnapshot = (): LatencyBudgetSnapshot => {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const mustDeliver = exceeded || Date.now() >= hardDeadlineAt - LATENCY_DELIVERY_RESERVE_MS;
    const ready = goodPlaylistReadyAt !== null;
    const phase: LatencyPhase = mustDeliver
      ? "delivery"
      : ready
        ? "improvement"
        : "core";
    const skipMarginal = ready && mustDeliver;
    const readyElapsed = goodPlaylistReadyAt !== null
      ? Math.max(0, goodPlaylistReadyAt - startedAt)
      : null;
    const remainingImprovementMs = ready && !mustDeliver
      ? Math.max(0, hardDeadlineAt - LATENCY_DELIVERY_RESERVE_MS - Date.now())
      : null;
    return {
      startedAt,
      elapsedMs,
      goodPlaylistTargetMs: LATENCY_GOOD_PLAYLIST_TARGET_MS,
      goodPlaylistReadyAt,
      goodPlaylistReadyElapsedMs: readyElapsed,
      phase,
      hardDeadlineMs,
      shouldSkipMarginalImprovement: skipMarginal,
      mustDeliverNow: mustDeliver,
      latencyBudgetExceeded: exceeded || Date.now() >= hardDeadlineAt,
      remainingImprovementMs,
      remainingHardMs: Math.max(0, hardDeadlineAt - Date.now()),
    };
  };

  return {
    startedAt,
    hardDeadlineAt,
    exceeded,
    elapsedMs() {
      return Math.max(0, Date.now() - startedAt);
    },
    markGoodPlaylistReady() {
      if (goodPlaylistReadyAt === null) goodPlaylistReadyAt = Date.now();
    },
    goodPlaylistReady() {
      return goodPlaylistReadyAt !== null;
    },
    currentPhase() {
      return buildSnapshot().phase;
    },
    shouldSkipMarginalImprovement() {
      const snap = buildSnapshot();
      return snap.goodPlaylistReadyAt !== null && snap.mustDeliverNow;
    },
    mustDeliverNow() {
      return buildSnapshot().mustDeliverNow;
    },
    isHardDeadlineApproaching() {
      return Date.now() >= hardDeadlineAt - LATENCY_HARD_DEADLINE_BUFFER_MS;
    },
    isHardDeadlineExceeded() {
      return exceeded || Date.now() >= hardDeadlineAt;
    },
    markExceeded() {
      exceeded = true;
    },
    snapshot() {
      return buildSnapshot();
    },
  };
}
