/**
 * Global boot-state tracker.
 *
 * Tracks a single boolean: has bootstrap() completed successfully?
 *
 * All consumer-facing proxies (pool, db) and getters (getEnv, getFeatures)
 * call assertBootReady() so that any access before the server is fully
 * initialised fails immediately with a clear error rather than silently
 * operating in a partial state.
 *
 * Bootstrap internals NEVER call these proxies / getters — they use
 * dedicated init functions (initPool, initDb), receiving raw values via the
 * return value of initPool() rather than any bypass accessor.
 *
 * State machine:
 *   IDLE  → bootstrap() has not yet completed (initial state)
 *   READY → markBootComplete() was called; all services are accessible
 *
 * There is no FAILED state: any bootstrap error is fatal and the process exits.
 */

type BootPhase = "IDLE" | "READY";

let _phase: BootPhase = "IDLE";

/**
 * Called as the final step of bootstrap(), after all health checks pass and
 * immediately before app.listen(). Idempotent — calling it a second time is
 * a no-op.
 */
export function markBootComplete(): void {
  _phase = "READY";
}

/** Returns true only after markBootComplete() has been called. */
export function isBootComplete(): boolean {
  return _phase === "READY";
}

/**
 * Throws if called before markBootComplete().
 *
 * Used inside every consumer-facing proxy and getter to make partial-init
 * access a hard, immediate error rather than a silent degraded state.
 *
 * Error message format:
 *   [boot] Attempted to access <resource> before server bootstrap completed
 */
export function assertBootReady(resource: string): void {
  if (_phase !== "READY") {
    throw new Error(
      `[boot] Attempted to access ${resource} before server bootstrap completed`,
    );
  }
}
