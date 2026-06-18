/**
 * In-process graceful shutdown flag smoke (no SIGTERM to production).
 * Usage: npm run smoke:shutdown
 */

import type { Logger } from "pino";
import { beginGracefulShutdown, isShuttingDown } from "../lib/shutdown";

const logger = {
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

if (isShuttingDown()) {
  process.stderr.write("shutdown-smoke: process already shutting down\n");
  process.exit(1);
}

beginGracefulShutdown(logger, { graceMs: 60_000 });

if (!isShuttingDown()) {
  process.stderr.write("shutdown-smoke: isShuttingDown() did not flip after beginGracefulShutdown\n");
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ pass: true, shuttingDown: isShuttingDown() })}\n`);
process.exit(0);
