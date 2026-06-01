/**
 * Memory & rediscovery — selection bias only, not scoring structure.
 */

export { buildLibrarySignals, type LibrarySignals, type LikedSongRow } from "../../lib/library-signals";
export { computeTemporalMemory } from "../../lib/temporal-memory";
export { rediscoveryJitter } from "../../lib/rediscovery";
export {
  computeRediscoveryScore,
  detectRediscoveryMode,
  type RediscoveryMode,
} from "../../lib/forgotten-favourites";
export { detectArchaeologyIntent, type ArchaeologyIntent } from "../../lib/library-archaeology";
export {
  detectMusicChapters,
  matchChapterFromVibe,
  type ChapterMatch,
} from "../../lib/music-life-chapters";
export { computeSurpriseMix, type SurpriseMix } from "../../lib/human-surprise";
export {
  buildTrackPersistenceMemory,
  persistenceStickiness,
  type TrackPersistenceStore,
} from "./track-persistence-memory";
