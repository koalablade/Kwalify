/** Audit mode side-effect policy and eval token authorization. */
import type { Request } from "express";

export function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

export function generationAuditTokenAuthorized(req: Request): boolean {
  const expected = process.env["PLAYLIST_EVAL_TOKEN"]?.trim();
  if (!expected) return false;
  const token = requestHeader(req, "x-kwalify-evaluation-token")
    ?? requestHeader(req, "x-eval-token");
  return token === expected;
}
