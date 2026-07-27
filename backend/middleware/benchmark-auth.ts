import type { NextFunction, Request, Response } from "express";
import { safeTokenEqual } from "../lib/eval-token";

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return LOOPBACK_IPS.has(ip);
}

export function isLoopbackRequest(req: Request): boolean {
  const candidates = [
    req.socket?.remoteAddress,
    req.ip,
  ].filter((ip): ip is string => typeof ip === "string" && ip.length > 0);
  return candidates.some((ip) => isLoopbackIp(ip));
}

function benchmarkTokenAuthorized(req: Request): boolean {
  const expected = process.env["BENCHMARK_UI_TOKEN"]?.trim();
  if (!expected) return false;
  const header = req.headers["x-benchmark-ui-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== "string" || !token.trim()) return false;
  return safeTokenEqual(token.trim(), expected);
}

export function isBenchmarkAccessAuthorized(req: Request): boolean {
  if (isLoopbackRequest(req)) return true;
  if (benchmarkTokenAuthorized(req)) return true;
  return false;
}

/** Protects benchmark mutation routes (run/chat/clear-lock). */
export function requireBenchmarkAuth(req: Request, res: Response, next: NextFunction): void {
  if (isBenchmarkAccessAuthorized(req)) {
    next();
    return;
  }
  res.status(403).json({ ok: false, error: "Benchmark actions require local access or authentication." });
}

/** Restricts /reports static files to loopback, benchmark token, or authenticated sessions. */
export function requireReportsAccess(req: Request, res: Response, next: NextFunction): void {
  if (isBenchmarkAccessAuthorized(req)) {
    next();
    return;
  }
  res.status(404).end();
}
