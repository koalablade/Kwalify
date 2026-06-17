import type { NextFunction, Request, Response } from "express";
import { moduleLogger } from "./logger";

const log = moduleLogger("global-rate-limit");

type WindowState = {
  timestamps: number[];
  burstTimestamps: number[];
};

const windows = new Map<string, WindowState>();

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const GLOBAL_RATE_LIMIT_PER_MINUTE = envInt("GLOBAL_RATE_LIMIT_PER_MINUTE", 60);
const GLOBAL_RATE_LIMIT_BURST = envInt("GLOBAL_RATE_LIMIT_BURST", 20);
const GLOBAL_RATE_LIMIT_BURST_WINDOW_MS = envInt("GLOBAL_RATE_LIMIT_BURST_WINDOW_MS", 10_000);
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60_000;

setInterval(() => {
  const cutoff = Date.now() - Math.max(GLOBAL_RATE_LIMIT_WINDOW_MS, GLOBAL_RATE_LIMIT_BURST_WINDOW_MS) * 2;
  for (const [key, state] of windows) {
    if (state.timestamps.every((time) => time < cutoff) && state.burstTimestamps.every((time) => time < cutoff)) {
      windows.delete(key);
    }
  }
}, 10 * 60_000).unref();

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function isExempt(req: Request): boolean {
  return req.path === "/healthz" ||
    req.path === "/readyz" ||
    req.path === "/api/healthz" ||
    req.path === "/api/readyz" ||
    req.path === "/api/health" ||
    req.path === "/api/eval/ping";
}

export function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isExempt(req)) {
    next();
    return;
  }

  const now = Date.now();
  const key = clientKey(req);
  const state = windows.get(key) ?? { timestamps: [], burstTimestamps: [] };
  state.timestamps = state.timestamps.filter((time) => time > now - GLOBAL_RATE_LIMIT_WINDOW_MS);
  state.burstTimestamps = state.burstTimestamps.filter((time) => time > now - GLOBAL_RATE_LIMIT_BURST_WINDOW_MS);
  windows.set(key, state);

  const minuteExceeded = state.timestamps.length >= GLOBAL_RATE_LIMIT_PER_MINUTE;
  const burstExceeded = state.burstTimestamps.length >= GLOBAL_RATE_LIMIT_BURST;
  if (minuteExceeded || burstExceeded) {
    const resetInMs = minuteExceeded
      ? (state.timestamps[0] ?? now) + GLOBAL_RATE_LIMIT_WINDOW_MS - now
      : (state.burstTimestamps[0] ?? now) + GLOBAL_RATE_LIMIT_BURST_WINDOW_MS - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(resetInMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    log.warn(
      {
        requestId: req.id,
        ip: key,
        path: req.path,
        minuteCount: state.timestamps.length,
        burstCount: state.burstTimestamps.length,
        retryAfterSeconds,
      },
      "global_rate_limit_rejected",
    );
    res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many requests. Please retry shortly.",
      requestId: req.id,
      retryAfterSeconds,
    });
    return;
  }

  state.timestamps.push(now);
  state.burstTimestamps.push(now);
  res.setHeader("X-RateLimit-Limit", String(GLOBAL_RATE_LIMIT_PER_MINUTE));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, GLOBAL_RATE_LIMIT_PER_MINUTE - state.timestamps.length)));
  next();
}
