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
import { getGenerateOverloadState } from "./runtime-overload";

let installed = false;

const REJECTION_WINDOW_MS = 60_000;
const REJECTION_EXIT_THRESHOLD = Number.parseInt(process.env["PROCESS_REJECTION_EXIT_THRESHOLD"] ?? "15", 10);
const rejectionTimestamps: number[] = [];

export function handleUnhandledRejection(
  reason: unknown,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  captureError(reason, { source: "unhandledRejection" });
  const now = Date.now();
  while (rejectionTimestamps.length > 0 && now - rejectionTimestamps[0]! >= REJECTION_WINDOW_MS) {
    rejectionTimestamps.shift();
  }
  rejectionTimestamps.push(now);

  if (rejectionTimestamps.length >= REJECTION_EXIT_THRESHOLD) {
    const generate = getGenerateOverloadState();
    logger.fatal(
      {
        err: reason,
        count: rejectionTimestamps.length,
        windowMs: REJECTION_WINDOW_MS,
        generateActive: generate.active,
        generateQueued: generate.queued,
      },
      "[process] Too many unhandled promise rejections — exiting",
    );
    exit(1);
    return;
  }

  logger.error(
    { err: reason, recentRejections: rejectionTimestamps.length },
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
