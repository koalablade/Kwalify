import type { Request } from "express";
import { safeTokenEqual } from "./eval-token";

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function opsMetricsTokenAuthorized(req: Request): boolean {
  const expected = process.env["OPS_METRICS_TOKEN"]?.trim();
  if (!expected) return false;
  const token = requestHeader(req, "x-ops-metrics-token");
  if (!token?.trim()) return false;
  return safeTokenEqual(token.trim(), expected);
}
