/** Audit mode side-effect policy and eval token authorization. */
import type { Request } from "express";
import { normalizeEvalToken } from "../../lib/eval-token-normalize";
import { expectedEvalToken, safeTokenEqual } from "../../lib/eval-token";
import { isLoopbackRequest } from "../../middleware/benchmark-auth";

export function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

export function generationAuditTokenAuthorized(req: Request): boolean {
  const expected = expectedEvalToken();
  if (!expected) return false;
  const token = normalizeEvalToken(
    requestHeader(req, "x-kwalify-evaluation-token")
      ?? requestHeader(req, "x-eval-token"),
  );
  return safeTokenEqual(token, expected);
}

/** Debug/diagnostic query flags in production require loopback or eval token. */
export function privilegedDebugAllowed(req: Request): boolean {
  if (process.env["NODE_ENV"] !== "production") return true;
  return generationAuditTokenAuthorized(req) || isLoopbackRequest(req);
}
