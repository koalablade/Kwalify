interface WindowState {
  timestamps: number[];
}

const windows = new Map<string, WindowState>();

setInterval(
  () => {
    const cutoff = Date.now() - 60_000 * 10;
    for (const [key, state] of windows) {
      if (state.timestamps.every((t) => t < cutoff)) {
        windows.delete(key);
      }
    }
  },
  10 * 60 * 1000
).unref();

export function checkRateLimit(
  userId: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let state = windows.get(userId);
  if (!state) {
    state = { timestamps: [] };
    windows.set(userId, state);
  }

  state.timestamps = state.timestamps.filter((t) => t > cutoff);

  if (state.timestamps.length >= maxRequests) {
    const oldest = state.timestamps[0]!;
    const resetInMs = oldest + windowMs - now;
    return { allowed: false, remaining: 0, resetInMs };
  }

  state.timestamps.push(now);
  const remaining = maxRequests - state.timestamps.length;
  return { allowed: true, remaining, resetInMs: 0 };
}
