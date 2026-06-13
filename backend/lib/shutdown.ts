import type { Logger } from "pino";

let _shuttingDown = false;
let _graceStarted = false;

type ShutdownCleanup = () => void | Promise<void>;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

/** Render SIGTERM — allow in-flight generates a short window to finish. */
export function beginGracefulShutdown(
  logger: Logger,
  opts: number | { graceMs?: number; cleanup?: ShutdownCleanup } = 25_000
): void {
  if (_graceStarted) return;
  _graceStarted = true;
  _shuttingDown = true;
  const graceMs = typeof opts === "number" ? opts : opts.graceMs ?? 25_000;
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
