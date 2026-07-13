import type { Logger } from "pino";

let _shuttingDown = false;
let _graceStarted = false;

type ShutdownCleanup = () => void | Promise<void>;

/**
 * Default graceful-shutdown window.
 *
 * Must be >= the generation hard deadline (~90s) plus a margin so an in-flight
 * generation can finish and flush its response before the process exits. The HTTP
 * server's requestTimeout is 95s, so 100s guarantees the socket is drained. The
 * process manager's stop timeout (systemd TimeoutStopSec / PM2 kill_timeout) MUST
 * be set at least this high — see docs/OPERATIONS.md.
 */
export const DEFAULT_SHUTDOWN_GRACE_MS = 100_000;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

/** SIGTERM — allow in-flight generates a full generation window to finish. */
export function beginGracefulShutdown(
  logger: Logger,
  opts: number | { graceMs?: number; cleanup?: ShutdownCleanup } = DEFAULT_SHUTDOWN_GRACE_MS
): void {
  if (_graceStarted) return;
  _graceStarted = true;
  _shuttingDown = true;
  const graceMs = typeof opts === "number" ? opts : opts.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const cleanup = typeof opts === "number" ? undefined : opts.cleanup;
  logger.warn({ graceMs }, "SIGTERM — graceful shutdown started; new generates rejected");
  const timer = setTimeout(() => {
    logger.warn("Grace period ended — exiting");
    process.exit(0);
  }, graceMs);
  timer.unref?.();

  if (!cleanup) return;
  void Promise.resolve()
    .then(cleanup)
    .then(() => {
      logger.warn("Graceful shutdown cleanup complete — exiting");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, "Graceful shutdown cleanup failed — exiting");
      process.exit(1);
    });
}
