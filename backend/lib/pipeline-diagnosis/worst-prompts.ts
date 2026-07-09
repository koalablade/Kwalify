/** Top 10 worst prompts from live-6h evaluation (top-50-worst-playlists.md). */
export const WORST_PROMPT_IDS = [
  "genre-pop-party",
  "party-70s-disco",
  "launch-calibration-091",
  "gym-2000s-pop-punk",
  "gym-heavy-lifting",
  "gym-cardio-upbeat",
  "gym-morning-boost",
  "gym-angry-rock",
  "gym-rap-cardio",
  "gym-chaotic-pr",
] as const;

export type WorstPromptId = (typeof WORST_PROMPT_IDS)[number];
