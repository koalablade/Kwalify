/**
 * Forgotten Favourites Engine — weighted rediscovery, not random deep cuts.
 */

import type { EmotionProfile } from "./emotion";
import type { LibrarySignals, TrackLibrarySignal } from "./library-signals";

export type RediscoveryMode =
  | "balanced"
  | "forgotten_favourites"
  | "deep_cuts"
  | "old_obsessions"
  | "hidden_gems"
  | "nostalgic_rediscovery";

export interface RediscoveryScoreInput {
  signal: TrackLibrarySignal;
  emotionFit: number;
  profile: EmotionProfile;
  mode: RediscoveryMode;
  now?: number;
}

const MS_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const MODE_PATTERNS: { mode: RediscoveryMode; re: RegExp }[] = [
  { mode: "deep_cuts", re: /\bdeep cuts?\b|\brare tracks?\b|\bhidden tracks?\b/i },
  { mode: "old_obsessions", re: /\bold obsession\b|\bused to love\b|\bplayed to death\b|\babandoned\b/i },
  { mode: "hidden_gems", re: /\bhidden gems?\b|\bhidden corners\b|\bforgotten favourites?\b/i },
  {
    mode: "nostalgic_rediscovery",
    re: /\bnostalgic rediscovery\b|\btake me back\b|\bforgotten summer\b|\blost summer\b/i,
  },
  {
    mode: "forgotten_favourites",
    re: /\bforgotten\b|\bforgot i loved\b|\bcompletely forgot\b|\bmusic you forgot\b|\barchaeology\b|\bexcavat/i,
  },
];

export function detectRediscoveryMode(vibe: string): RediscoveryMode {
  for (const { mode, re } of MODE_PATTERNS) {
    if (re.test(vibe)) return mode;
  }
  return "balanced";
}

/** 0–1 rediscovery potential (independent of vibe fit). */
export function computeRediscoveryScore(input: RediscoveryScoreInput): number {
  const { signal, emotionFit, profile, mode } = input;
  const now = input.now ?? Date.now();
  let score = 0.2;

  if (signal.dateLiked) {
    const ageMs = now - signal.dateLiked.getTime();
    if (ageMs > 4 * MS_YEAR) score += 0.22;
    else if (ageMs > 2 * MS_YEAR) score += 0.16;
    else if (ageMs > MS_YEAR) score += 0.1;
    else if (ageMs < 90 * 24 * 60 * 60 * 1000) score -= 0.08;
  }

  if (signal.playlistAppearances === 0) score += 0.18;
  else if (signal.playlistAppearances === 1) score += 0.06;
  else score -= 0.06 * Math.min(signal.playlistAppearances, 4);

  if (signal.daysSinceSurfaced == null) score += 0.12;
  else if (signal.daysSinceSurfaced > 60) score += 0.14;
  else if (signal.daysSinceSurfaced > 14) score += 0.06;
  else if (signal.daysSinceSurfaced < 3) score -= 0.1;

  if (signal.artistUnderused) score += 0.1;
  if (signal.artistPlaylistAppearances >= 3) score -= 0.12;
  else if (signal.artistPlaylistAppearances >= 2) score -= 0.06;

  if (profile.nostalgia > 0.45 && emotionFit > 0.55) score += 0.08;

  switch (mode) {
    case "forgotten_favourites":
      score += signal.playlistAppearances === 0 ? 0.1 : 0;
      break;
    case "deep_cuts":
      if (signal.artistLibraryCount <= 2) score += 0.12;
      if (signal.playlistAppearances <= 1) score += 0.08;
      break;
    case "old_obsessions":
      if (signal.artistLibraryCount >= 5 && signal.artistPlaylistAppearances <= 1) score += 0.15;
      break;
    case "hidden_gems":
      if (signal.artistLibraryCount <= 3 && signal.playlistAppearances === 0) score += 0.14;
      break;
    case "nostalgic_rediscovery":
      if (signal.dateLiked) {
        const y = signal.dateLiked.getFullYear();
        const currentY = new Date(now).getFullYear();
        if (currentY - y >= 3) score += 0.12;
      }
      break;
    default:
      break;
  }

  return Math.max(0, Math.min(1, score));
}

/** Additive boost blended with emotion fit — never overrides a bad match. */
export function rediscoveryScoreBoost(
  rediscoveryScore: number,
  emotionFit: number,
  mode: RediscoveryMode
): number {
  const modeWeight =
    mode === "balanced"
      ? 0.35
      : mode === "forgotten_favourites" || mode === "nostalgic_rediscovery"
        ? 0.55
        : 0.48;

  return rediscoveryScore * emotionFit * modeWeight * 0.28;
}
