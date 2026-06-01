/**
 * Prompt-aware score guards — era balance and mood/audio clashes only.
 * No per-artist or per-track blocklists (repetition is handled in playlist-freshness).
 */

import type { EmotionProfile } from "./emotion";

export type LibraryEraMode = "balanced" | "deep_library" | "fresh_likes" | "decade_weighted";

const DEEP_LIBRARY_RE =
  /\b(deep dive|deep library|forgotten|buried|archaeology|rediscover|what's fresh is not|not my recent)\b/i;
const FRESH_LIKES_RE =
  /\b(fresh|newly added|new likes|recent likes|just added|this month|this year only)\b/i;
const DECADE_RE =
  /\b(50s|60s|70s|80s|90s|00s|2000s|sixties|seventies|eighties|nineties|y2k)\b/i;
const CLASSIC_ROMANCE_RE =
  /\b(old time love|old-time love|classic romance|vintage love|golden oldies|standards|crooner|rat pack|old romantic|timeless romance|aren't cringe)\b/i;
const BREAKUP_NOT_LOVE_RE = /\b(breakup|heartbreak|divorce|cheating|toxic ex)\b/i;

const STRESSED_ESCAPE_RE =
  /\b(stressed|stress|anxious|overwhelmed|forget the world|dissociat|go blurry|need to escape|can't cope)\b/i;

const GRUNGE_ROCK_RE =
  /\b(grunge|90s alternative|alternative rock|moody feminine|night sky|watch the stars)\b/i;

export function detectLibraryEraMode(vibe: string): LibraryEraMode {
  const t = vibe.toLowerCase();
  if (FRESH_LIKES_RE.test(t)) return "fresh_likes";
  if (DEEP_LIBRARY_RE.test(t)) return "deep_library";
  if (DECADE_RE.test(t) || CLASSIC_ROMANCE_RE.test(t)) return "decade_weighted";
  return "balanced";
}

export function libraryEraScoreBoost(
  addedAt: Date | null | undefined,
  mode: LibraryEraMode,
  now = Date.now()
): number {
  if (!addedAt) return 0;
  const ageDays = (now - addedAt.getTime()) / (24 * 60 * 60 * 1000);

  if (mode === "fresh_likes") {
    if (ageDays <= 120) return 0.08;
    if (ageDays > 365) return -0.1;
    return 0;
  }
  if (mode === "deep_library") {
    if (ageDays >= 730) return 0.1;
    if (ageDays >= 365) return 0.06;
    if (ageDays <= 60) return -0.04;
    return 0.02;
  }
  if (mode === "decade_weighted") {
    if (ageDays >= 400) return 0.07;
    if (ageDays <= 90) return -0.05;
    return 0.02;
  }
  if (ageDays <= 45) return -0.03;
  if (ageDays >= 180 && ageDays <= 2500) return 0.04;
  if (ageDays > 2500) return 0.06;
  return 0;
}

export function wantsClassicRomance(vibe: string): boolean {
  return CLASSIC_ROMANCE_RE.test(vibe) && !BREAKUP_NOT_LOVE_RE.test(vibe);
}

export function applyVibeMatchGuards(
  score: number,
  track: {
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    addedAt?: Date | null;
  },
  profile: EmotionProfile,
  vibe: string
): number {
  let s = score;
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const d = track.danceability ?? 0.5;

  if (wantsClassicRomance(vibe)) {
    if (v < 0.38 && e < 0.45) s -= 0.1;
    if (v >= 0.52 && e >= 0.4 && e <= 0.72) s += 0.05;
  }

  if (STRESSED_ESCAPE_RE.test(vibe) || (profile.tension > 0.55 && profile.valence < 0.5)) {
    if (e > 0.78 && v > 0.72 && d > 0.62) s -= 0.2;
    if (e >= 0.35 && e <= 0.68 && v >= 0.35 && v <= 0.62) s += 0.05;
  }

  if (GRUNGE_ROCK_RE.test(vibe)) {
    if (v > 0.82 && d > 0.7 && e > 0.75) s -= 0.14;
    if (e >= 0.45 && e <= 0.85 && v <= 0.55) s += 0.05;
  }

  s += libraryEraScoreBoost(track.addedAt ?? null, detectLibraryEraMode(vibe));

  return Math.max(0, s);
}

export function modeScoreMultiplier(mode: "strict" | "balanced" | "chaotic"): number {
  if (mode === "strict") return 1.04;
  if (mode === "chaotic") return 0.97;
  return 1;
}

export function modeWildcardScale(mode: "strict" | "balanced" | "chaotic"): number {
  if (mode === "strict") return 0.25;
  if (mode === "chaotic") return 1.35;
  return 1;
}
