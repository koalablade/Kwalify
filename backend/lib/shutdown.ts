import type { Logger } from "pino";

let _shuttingDown = false;
let _graceStarted = false;
let _exitScheduled = false;

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

function scheduleShutdownExit(logger: Logger, code: number, message: string): void {
  if (_exitScheduled) return;
  _exitScheduled = true;
  logger.warn(message);
  process.exit(code);
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
    scheduleShutdownExit(logger, 0, "Grace period ended — exiting");
  }, graceMs);
  timer.unref?.();

  if (!cleanup) return;
  void Promise.resolve()
    .then(cleanup)
    .then(() => {
      scheduleShutdownExit(logger, 0, "Graceful shutdown cleanup complete — exiting");
    })
    .catch((err) => {
      logger.error({ err }, "Graceful shutdown cleanup failed — exiting");
      scheduleShutdownExit(logger, 1, "Graceful shutdown cleanup failed — exiting");
    });
}
