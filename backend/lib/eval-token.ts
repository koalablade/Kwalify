/**
 * Evaluation-token helpers: normalization + constant-time comparison.
 *
 * The eval/admin token gates internal tooling. Comparisons must not leak the
 * expected token's length or content via timing or early-exit, so we compare
 * fixed-length SHA-256 digests with crypto.timingSafeEqual.
 */

import crypto from "node:crypto";
import { normalizeEvalToken } from "./eval-token-normalize";

export function expectedEvalToken(): string {
  return normalizeEvalToken(process.env["PLAYLIST_EVAL_TOKEN"]);
}

export function isEvalTokenConfigured(): boolean {
  return expectedEvalToken().length > 0;
}

/** Explicit allowlist, or SMOKE_SPOTIFY_USER_ID when unset (self-host / CI convenience). */
export function resolveEvalAllowedSpotifyUserIds(): string | undefined {
  const explicit = process.env["EVAL_ALLOWED_SPOTIFY_USER_IDS"]?.trim();
  if (explicit) return explicit;
  return process.env["SMOKE_SPOTIFY_USER_ID"]?.trim() || undefined;
}

export function parseEvalAllowedSpotifyUserIds(): string[] {
  const raw = resolveEvalAllowedSpotifyUserIds();
  if (!raw) return [];
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * Constant-time token comparison. Both inputs are hashed to a fixed 32-byte
 * digest first, so differing lengths do not short-circuit the compare or leak
 * timing. The trailing length check restores exact-match correctness without a
 * meaningful timing signal.
 */
export function safeTokenEqual(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
  const digestMatch = crypto.timingSafeEqual(providedDigest, expectedDigest);
  return digestMatch && provided.length === expected.length;
}
