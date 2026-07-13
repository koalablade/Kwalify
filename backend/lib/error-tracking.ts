/**
 * Error-tracking abstraction — the single capture point for operational errors.
 *
 * Today this only routes to the structured logger. It exists so that wiring in
 * an external error tracker (Sentry, GlitchTip, etc.) later is a one-line change
 * in bootstrap: `setErrorSink((err, ctx) => Sentry.captureException(err, { extra: ctx }))`.
 *
 * Nothing in the request path should import a vendor SDK directly — call
 * captureError() instead so the integration stays swappable.
 */

import { logger } from "./logger";

export type ErrorContext = Record<string, unknown>;

/** External sink (e.g. Sentry). Optional; installed once at boot if configured. */
export type ErrorSink = (error: unknown, context: ErrorContext) => void;

let sink: ErrorSink | null = null;

/** Install (or clear) the external error sink. Safe to call once at startup. */
export function setErrorSink(fn: ErrorSink | null): void {
  sink = fn;
}

export function hasErrorSink(): boolean {
  return sink !== null;
}

/**
 * Capture an operational error: always logs locally, then forwards to the
 * external sink when configured. The sink is isolated — if it throws, we log
 * that and carry on, never propagating a tracking failure into app logic.
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  logger.error({ err: error, ...context }, "[error-tracking] captured error");
  if (!sink) return;
  try {
    sink(error, context);
  } catch (sinkErr) {
    logger.warn({ err: sinkErr }, "[error-tracking] external error sink threw");
  }
}
