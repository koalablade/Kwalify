import {
  REQUEST_FAST_FALLBACK_MS,
  REQUEST_HARD_TIMEOUT_MS,
} from "./production-limits";

export interface RequestBudget {
  startedAt: number;
  hardDeadlineAt: number;
  fastFallbackAt: number;
  remainingMs(): number;
  shouldFastFallback(): boolean;
  isExpired(): boolean;
}

export function createRequestBudget(
  startedAt = Date.now(),
  hardMs = REQUEST_HARD_TIMEOUT_MS,
  fastMs = REQUEST_FAST_FALLBACK_MS
): RequestBudget {
  const hardDeadlineAt = startedAt + hardMs;
  const fastFallbackAt = startedAt + fastMs;
  return {
    startedAt,
    hardDeadlineAt,
    fastFallbackAt,
    remainingMs() {
      return Math.max(0, hardDeadlineAt - Date.now());
    },
    shouldFastFallback() {
      return Date.now() >= fastFallbackAt;
    },
    isExpired() {
      return Date.now() >= hardDeadlineAt;
    },
  };
}
