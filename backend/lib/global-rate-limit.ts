import type { NextFunction, Request, Response } from "express";
import { moduleLogger } from "./logger";
import { sendApiError } from "./api-error-envelope";

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
  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (typeof cfConnectingIp === "string" && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket?.remoteAddress || req.ip || "unknown";
}

function isStaticAsset(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = req.path;
  return (
    path === "/" ||
    path === "/gallery" ||
    path.startsWith("/p/") ||
    path.startsWith("/pages/") ||
    path.startsWith("/styles/") ||
    path.startsWith("/lib/") ||
    /\.(html?|css|js|svg|png|jpe?g|webp|ico|txt|xml|webmanifest)$/i.test(path)
  );
}

function isExempt(req: Request): boolean {
  return isStaticAsset(req) ||
    req.path === "/healthz" ||
    req.path === "/livez" ||
    req.path === "/readyz" ||
    req.path === "/api/healthz" ||
    req.path === "/api/livez" ||
    req.path === "/api/readyz" ||
    req.path === "/api/health" ||
    req.path === "/api/eval/ping";
}

/** Scanner/bot paths (.env probes, CMS exploits) — reject quietly without warn spam. */
function isProbePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes(".env") || lower.includes(".git") || lower.includes("phpinfo")) return true;
  if (/^\/wp[-/]/.test(lower) || lower.startsWith("/wordpress")) return true;
  if (lower.endsWith(".php") || lower.endsWith(".asp") || lower.endsWith(".aspx")) return true;
  if (["/vercel.json", "/package.json", "/composer.json", "/web.config"].includes(lower)) return true;
  return false;
}

const probeLogThrottle = new Map<string, number>();
const PROBE_LOG_THROTTLE_MS = 60_000;

function logRateLimitRejected(
  req: Request,
  key: string,
  minuteCount: number,
  burstCount: number,
  retryAfterSeconds: number,
): void {
  const payload = {
    requestId: req.id,
    ip: key,
    path: req.path,
    minuteCount,
    burstCount,
    retryAfterSeconds,
  };
  if (isProbePath(req.path)) {
    const now = Date.now();
    const last = probeLogThrottle.get(key) ?? 0;
    if (now - last < PROBE_LOG_THROTTLE_MS) return;
    probeLogThrottle.set(key, now);
    log.debug(payload, "global_rate_limit_probe_rejected");
    return;
  }
  log.warn(payload, "global_rate_limit_rejected");
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
    logRateLimitRejected(
      req,
      key,
      state.timestamps.length,
      state.burstTimestamps.length,
      retryAfterSeconds,
    );
    sendApiError(res, 429, "RATE_LIMITED", "Too many requests. Please retry shortly.", {
      requestId: String(req.id),
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
