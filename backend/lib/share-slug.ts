import { randomBytes } from "node:crypto";

/** URL-safe opaque token for public playlist share links. */
export function generateShareSlug(): string {
  return randomBytes(12).toString("base64url");
}
