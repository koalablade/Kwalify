import type { Request } from "express";
import { safeTokenEqual } from "./eval-token";

function requestHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function opsMetricsTokenAuthorized(req: Request): boolean {
  const expected = process.env["OPS_METRICS_TOKEN"]?.trim();
  if (!expected) return false;
  const headerToken = requestHeader(req, "x-ops-metrics-token");
  const queryOps = typeof req.query.ops === "string" ? req.query.ops : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken?.trim() || queryOps?.trim() || queryToken?.trim();
  if (!token) return false;
  return safeTokenEqual(token, expected);
}
