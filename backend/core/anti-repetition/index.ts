/**
 * Anti-repetition — freshness stats and clone penalties (applied via scoring-engine post-score).
 */

export {
  buildFreshnessStats,
  buildArtistAppearanceMap,
  buildAlbumAppearanceMap,
  sceneClonePenalty,
  journeyArcCooldownMultiplier,
  countRecentJourneyArc,
  applyFreshnessToScore,
  type FreshnessStats,
} from "../../lib/playlist-freshness";
