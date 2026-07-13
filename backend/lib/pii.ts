/**
 * PII helpers. Spotify user IDs are personal identifiers and must not appear in
 * logs in raw form. hashId() produces a short, stable, non-reversible token so
 * operators can still correlate a user's activity across log lines without
 * storing or printing the real identifier.
 */

import crypto from "node:crypto";

/** Stable 12-char hex digest of an identifier (e.g. Spotify user id). */
export function hashId(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/** Convenience: `sha256:<12hex>` form used in log output. */
export function hashedIdTag(value: string | null | undefined): string {
  if (!value) return "anon";
  return `sha256:${hashId(String(value))}`;
}
