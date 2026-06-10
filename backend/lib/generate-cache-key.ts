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
  referencePlaylistKey?: string | null;
  sceneId?: string | null;
  noLibraryMode?: boolean;
  mockMode?: boolean;
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
    parts.referencePlaylistKey ? `ref:${normalizePrompt(parts.referencePlaylistKey)}` : "ref:none",
    parts.sceneId ? `scene:${normalizePrompt(parts.sceneId)}` : "scene:none",
    parts.noLibraryMode ? "nolib1" : "nolib0",
    parts.mockMode ? "mock1" : "mock0",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}
