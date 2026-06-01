/**
 * Soft exploration mode — raises surprise budget when prompts are vague or repetitive.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { computeDiversityScore } from "../genre-intelligence/genre-constraints";
import type { UserGenreVector } from "../../lib/user-genre-profile";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import { countGenreSetRepeats } from "../genre-intelligence/genre-session-decay";

const VAGUE_PROMPT_RE =
  /\b(something|anything|whatever|surprise me|mix it up|not sure|idk|random|vibes?|chill|music for|playlist for)\b/i;

export interface ExplorationModeInput {
  vibe: string;
  emotionProfile: EmotionProfile;
  userVector: UserGenreVector;
  recentPlaylistTrackIds?: string[][];
  trackClassifications?: Map<string, TrackGenreClassification>;
  mode: "strict" | "balanced" | "chaotic";
}

export function computeExplorationModeScore(input: ExplorationModeInput): number {
  let score = 0.2;

  if (VAGUE_PROMPT_RE.test(input.vibe) || input.vibe.trim().split(/\s+/).length <= 4) {
    score += 0.35;
  }

  const genreCount = Object.values(input.userVector).filter((v) => (v ?? 0) >= 0.04).length;
  if (genreCount >= 8) score += 0.2;
  else if (genreCount >= 5) score += 0.1;

  const dist: Record<string, number> = {};
  for (const [g, v] of Object.entries(input.userVector)) {
    if ((v ?? 0) >= 0.03) dist[g] = v ?? 0;
  }
  if (computeDiversityScore(dist) > 0.55) score += 0.15;

  if (input.recentPlaylistTrackIds?.length && input.trackClassifications) {
    const repeats = countGenreSetRepeats(
      input.recentPlaylistTrackIds,
      input.trackClassifications
    );
    if (repeats >= 3) score += 0.25;
    else if (repeats >= 2) score += 0.12;
  }

  if (input.mode === "chaotic") score += 0.15;
  else if (input.mode === "balanced") score += 0.05;

  return Math.round(Math.min(1, score) * 1000) / 1000;
}

export function surpriseBudgetFromExploration(explorationModeScore: number): number {
  const base = 0.08;
  const extra = explorationModeScore * 0.07;
  return Math.round(Math.min(0.15, base + extra) * 1000) / 1000;
}

export function leapProbabilityFromExploration(explorationModeScore: number): number {
  const base = 0.05;
  const extra = explorationModeScore * 0.07;
  return Math.min(0.12, base + extra);
}
