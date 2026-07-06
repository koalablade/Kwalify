interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, TokenBucketState>();

setInterval(
  () => {
    const cutoff = Date.now() - 60_000 * 10;
    for (const [key, state] of buckets) {
      if (state.lastRefillMs < cutoff) {
        buckets.delete(key);
      }
    }
  },
  10 * 60 * 1000
).unref();

/**
 * Token-bucket rate limiter.
 * Default generate policy: 10/min sustained with burst of 3.
 */
export function checkRateLimit(
  userId: string,
  maxRequests: number,
  windowMs: number,
  opts?: { consume?: boolean; burst?: number }
): { allowed: boolean; remaining: number; resetInMs: number } {
  const consume = opts?.consume !== false;
  const burst = opts?.burst ?? Math.min(3, maxRequests);
  const refillPerMs = maxRequests / windowMs;
  const capacity = maxRequests;
  const now = Date.now();

  let state = buckets.get(userId);
  if (!state) {
    state = { tokens: burst, lastRefillMs: now };
    buckets.set(userId, state);
  } else {
    const elapsed = now - state.lastRefillMs;
    state.tokens = Math.min(capacity, state.tokens + elapsed * refillPerMs);
    state.lastRefillMs = now;
  }

  if (state.tokens < 1) {
    const resetInMs = Math.ceil((1 - state.tokens) / refillPerMs);
    return { allowed: false, remaining: 0, resetInMs };
  }

  if (consume) {
    state.tokens -= 1;
  }

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(state.tokens)),
    resetInMs: 0,
  };
}
