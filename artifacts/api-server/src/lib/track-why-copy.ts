import type { EmotionProfile } from "./emotion";

type TrackLike = {
  energy?: number | null;
  valence?: number | null;
  rediscoveryScore?: number;
  narrativeRole?: string;
  score?: number;
};

/** Human-readable bullets for the first tracks in the result list. */
export function buildTrackWhyReasons(
  track: TrackLike,
  profile?: EmotionProfile | null
): string[] {
  const reasons: string[] = [];
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const rediscovery = track.rediscoveryScore ?? 0;

  if (rediscovery >= 0.45 || track.narrativeRole === "rediscovery") {
    reasons.push("Rarely surfaced in your Kwalify playlists lately");
  }
  if (profile?.timeOfDay === "late_night" && energy < 0.58) {
    reasons.push("Matches a late-night atmosphere");
  }
  if ((profile?.nostalgia ?? 0) >= 0.45 && valence < 0.55) {
    reasons.push("Strong nostalgia score for this vibe");
  }
  if (track.narrativeRole === "peak" || track.narrativeRole === "climax") {
    reasons.push("Fits the emotional peak of the set");
  }
  if (track.narrativeRole === "opener" || track.narrativeRole === "intro") {
    reasons.push("Opens the set with the right mood");
  }
  if ((profile?.calm ?? 0) >= 0.55 && energy < 0.45) {
    reasons.push("Calm energy that matches your moment");
  }
  if ((track.score ?? 0) >= 0.82 && reasons.length < 2) {
    reasons.push("One of the strongest matches in your library");
  }
  if (reasons.length === 0) {
    reasons.push("Strong emotional fit for your prompt");
  }
  return reasons.slice(0, 3);
}
