/**
 * Process-level safety handlers.
 *
 * Policy:
 *   - unhandledRejection → LOG + CAPTURE, then CONTINUE. A stray rejection from a
 *     best-effort background task must never take down a running server that is
 *     actively serving other users. The error is never hidden — it is logged at
 *     error level and forwarded to the error tracker.
 *   - uncaughtException → LOG + CAPTURE, then EXIT(1). A synchronous throw that
 *     unwound to the top of the stack leaves V8 in an undefined state; continuing
 *     risks corrupt memory/handles, so this remains fatal. A process manager
 *     (systemd/PM2) restarts us cleanly.
 */

import { logger } from "./logger";
import { captureError } from "./error-tracking";

let installed = false;

export function handleUnhandledRejection(reason: unknown): void {
  captureError(reason, { source: "unhandledRejection" });
  logger.error(
    { err: reason },
    "[process] Unhandled promise rejection — logged; process continues",
  );
}

/** Exposed for testing; real installation wires this to process.exit(1). */
export function handleUncaughtException(
  err: unknown,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  captureError(err, { source: "uncaughtException", fatal: true });
  logger.fatal({ err }, "[process] Uncaught exception — exiting");
  exit(1);
}

export function installProcessSafetyHandlers(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => handleUnhandledRejection(reason));
  process.on("uncaughtException", (err) => handleUncaughtException(err));
}
