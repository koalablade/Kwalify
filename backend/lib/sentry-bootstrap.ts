/**
 * Optional Sentry integration — activated when SENTRY_DSN is set.
 * Install @sentry/node and set SENTRY_DSN in .env to enable.
 */

import { setErrorSink } from "./error-tracking";
import { logger } from "./logger";

export async function initSentryIfConfigured(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  try {
    const Sentry = await import("@sentry/node");
    const environment = process.env.SENTRY_ENVIRONMENT?.trim()
      || process.env.NODE_ENV
      || "development";
    const release = process.env.GIT_COMMIT?.trim() || undefined;

    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      beforeSend(event) {
        if (event.request?.headers?.cookie) delete event.request.headers.cookie;
        return event;
      },
    });

    setErrorSink((error, context) => {
      Sentry.withScope((scope) => {
        Object.entries(context).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
        if (error instanceof Error) Sentry.captureException(error);
        else Sentry.captureMessage(String(error));
      });
    });

    logger.info({ environment, release }, "[sentry] Error tracking enabled");
  } catch (err) {
    logger.warn(
      { err },
      "[sentry] SENTRY_DSN is set but @sentry/node is missing — run npm install",
    );
  }
}
