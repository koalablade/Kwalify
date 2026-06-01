import { createHash } from "crypto";
import type { VibeKind } from "./emotion";

export function normalizePrompt(vibe: string): string {
  return vibe
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function buildGenerateCacheKey(parts: {
  userId: string;
  vibe: string;
  vibeKind: VibeKind;
  mode: string;
  length: number;
  varietyBoost?: boolean;
  referencePlaylist?: boolean;
}): string {
  const norm = normalizePrompt(parts.vibe);
  const raw = [
    parts.userId,
    norm,
    parts.vibeKind,
    parts.mode,
    String(parts.length),
    parts.varietyBoost ? "v1" : "v0",
    parts.referencePlaylist ? "ref1" : "ref0",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}
