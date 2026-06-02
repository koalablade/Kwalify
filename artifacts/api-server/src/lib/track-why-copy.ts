import type { EmotionProfile } from "./emotion";

type TrackLike = {
  energy?: number | null;
  valence?: number | null;
  rediscoveryScore?: number;
  narrativeRole?: string;
};

const HUMAN_REASONS = [
  "Matches your listening mood and energy",
  "Fits the overall vibe of the playlist",
  "Similar to tracks you've enjoyed recently",
] as const;

/** Human-readable bullets for the first tracks — no scoring or algorithm language. */
export function buildTrackWhyReasons(
  track: TrackLike,
  profile?: EmotionProfile | null,
  trackIndex = 0
): string[] {
  const reasons: string[] = [];
  const energy = track.energy ?? 0.5;
  const rediscovery = track.rediscoveryScore ?? 0;

  if (rediscovery >= 0.45 || track.narrativeRole === "rediscovery") {
    reasons.push("A deep cut from your library that fits this moment");
  }
  if (profile?.timeOfDay === "late_night" && energy < 0.58) {
    reasons.push("Matches a late-night atmosphere in your taste");
  }
  if (track.narrativeRole === "peak" || track.narrativeRole === "climax") {
    reasons.push("Carries the emotional peak of the set");
  }
  if (track.narrativeRole === "opener" || track.narrativeRole === "intro") {
    reasons.push("Opens the set with the right mood");
  }
  if ((profile?.calm ?? 0) >= 0.55 && energy < 0.45) {
    reasons.push("Calm energy that matches your moment");
  }

  const fallback = HUMAN_REASONS[trackIndex % HUMAN_REASONS.length];
  if (reasons.length === 0) reasons.push(fallback);
  else if (reasons.length === 1) reasons.push(fallback);

  return reasons.slice(0, 2);
}
