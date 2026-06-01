import type { Logger } from "pino";

let _shuttingDown = false;
let _graceStarted = false;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

/** Render SIGTERM — allow in-flight generates a short window to finish. */
export function beginGracefulShutdown(logger: Logger, graceMs = 25_000): void {
  if (_graceStarted) return;
  _graceStarted = true;
  _shuttingDown = true;
  logger.warn({ graceMs }, "SIGTERM — graceful shutdown started; new generates rejected");
  setTimeout(() => {
    logger.warn("Grace period ended — exiting");
    process.exit(0);
  }, graceMs);
}
