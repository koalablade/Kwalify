/**
 * Genre intelligence — taxonomy, detection, graph, coverage (no scene imports).
 */

export { buildUserGenreProfile, type UserGenreProfile } from "../../lib/user-genre-profile";
export { buildGenreIntelligenceStack, type GenreIntelligenceStack } from "../../lib/genre-intelligence-stack";
export { detectTrackGenreProfile } from "../../lib/genre-detector";
export { enforceFinalPlaylistGenres } from "./final-enforcement";
export { GENRE_MAX_DOMINANCE, GENRE_MIN_LIBRARY_SHARE } from "../../lib/genre-coverage";
export {
  MAX_GENRE_DOMINANCE,
  MIN_DISTINCT_GENRES_IN_PLAYLIST,
  GENRE_LIBRARY_FLOOR,
  MAX_SCENE_SCORE_INFLUENCE,
  SCORING_WEIGHTS,
} from "./genre-constraints";
export { applyGenreCoverageEngine, type GenreCoverageState } from "./genre-coverage-engine";
export { buildGenreForecast, buildGenreForecastFromLibrary, type GenreForecast } from "./genre-forecast";
export { buildGenreMemoryTrace, type GenreMemoryTrace } from "./genre-memory-trace";
export type { GenreAudit } from "../../lib/genre-audit";
