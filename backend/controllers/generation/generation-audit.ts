/** Audit mode side-effect policy and eval token authorization. */
import type { Request } from "express";
import { normalizeEvalToken } from "../../lib/eval-token-normalize";

export function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

export function generationAuditTokenAuthorized(req: Request): boolean {
  const expected = normalizeEvalToken(process.env["PLAYLIST_EVAL_TOKEN"]);
  if (!expected) return false;
  const token = normalizeEvalToken(
    requestHeader(req, "x-kwalify-evaluation-token")
      ?? requestHeader(req, "x-eval-token"),
  );
  return token === expected;
}
