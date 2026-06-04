/**
 * Semantic Scene Engine — canonical scene vectors with genre ecosystems.
 *
 * Each scene vector encodes:
 *   - Detected emotions (for diagnostics + emotional scoring)
 *   - Energy target range
 *   - Genre ecosystem with per-genre weights (primary ranking signal)
 *   - Anti-genres (tracks that violate the scene are penalised)
 *   - Aesthetic tags (for coherence scoring)
 *
 * Semantic intent must dominate playlist identity.
 * At least 70% of tracks should come from the dominant ecosystem.
 */

import type { RootGenre, TrackGenreClassification } from "./genre-taxonomy";
import type { EmotionProfile } from "./emotion";

export interface SemanticSceneVector {
  id: string;
  label: string;
  emotions: string[];
  energy: { min: number; max: number; target: number };
  /** Ordered by weight — first entry is dominant ecosystem genre */
  genreEcosystem: { genre: RootGenre; weight: number }[];
  /** Dominant ecosystem share required (default 0.70) */
  ecosystemFloor: number;
  /** Genres that hard-violate the scene — receive a strong penalty */
  antiGenres: RootGenre[];
  aesthetics: string[];
}

export const SEMANTIC_SCENE_VECTORS: Record<string, SemanticSceneVector> = {
  // ── Rural / Americana ──────────────────────────────────────────────────────

  DIRT_ROAD_SUNSET: {
    id: "DIRT_ROAD_SUNSET",
    label: "Dirt road at sunset",
    emotions: ["nostalgic", "reflective", "free", "peaceful"],
    energy: { min: 0.25, max: 0.65, target: 0.42 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.85 },
      { genre: "blues", weight: 0.65 },
      { genre: "rock", weight: 0.55 },
      { genre: "indie", weight: 0.45 },
      { genre: "soul", weight: 0.30 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae"],
    aesthetics: ["golden hour", "dust", "warm air", "open landscape", "Americana", "analog warmth"],
  },

  DOG_ON_DIRT_ROAD: {
    id: "DOG_ON_DIRT_ROAD",
    label: "Dog on a dirt road",
    emotions: ["carefree", "warm", "nostalgic", "peaceful", "rural"],
    energy: { min: 0.20, max: 0.58, target: 0.38 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.90 },
      { genre: "blues", weight: 0.65 },
      { genre: "rock", weight: 0.50 },
      { genre: "indie", weight: 0.40 },
      { genre: "soul", weight: 0.28 },
    ],
    ecosystemFloor: 0.75,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae", "classical"],
    aesthetics: ["dirt road", "countryside", "dog", "lazy afternoon", "Americana", "porch"],
  },

  OUTLAW_COUNTRY: {
    id: "OUTLAW_COUNTRY",
    label: "Outlaw country",
    emotions: ["defiant", "rugged", "nostalgic", "free", "gritty"],
    energy: { min: 0.30, max: 0.72, target: 0.50 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.78 },
      { genre: "blues", weight: 0.70 },
      { genre: "rock", weight: 0.65 },
      { genre: "indie", weight: 0.35 },
    ],
    ecosystemFloor: 0.78,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae", "pop", "classical"],
    aesthetics: ["outlaw", "western", "grit", "honky tonk", "Americana", "heartland", "whiskey"],
  },

  RURAL_FARM_ROAD: {
    id: "RURAL_FARM_ROAD",
    label: "Rural farm road",
    emotions: ["peaceful", "nostalgic", "free", "grounded"],
    energy: { min: 0.18, max: 0.55, target: 0.35 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.92 },
      { genre: "blues", weight: 0.60 },
      { genre: "rock", weight: 0.45 },
      { genre: "indie", weight: 0.38 },
    ],
    ecosystemFloor: 0.74,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae"],
    aesthetics: ["farmland", "countryside", "fields", "Americana", "heartland", "pastoral"],
  },

  COMING_HOME: {
    id: "COMING_HOME",
    label: "Coming home",
    emotions: ["nostalgic", "bittersweet", "warm", "reflective", "relief"],
    energy: { min: 0.20, max: 0.58, target: 0.38 },
    genreEcosystem: [
      { genre: "country", weight: 0.90 },
      { genre: "folk", weight: 0.92 },
      { genre: "indie", weight: 0.75 },
      { genre: "rock", weight: 0.60 },
      { genre: "soul", weight: 0.50 },
      { genre: "pop", weight: 0.40 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["electronic", "metal", "hip_hop", "latin", "reggae"],
    aesthetics: ["homecoming", "heartland", "familiar", "warm light", "front porch"],
  },

  // ── Night / Urban ──────────────────────────────────────────────────────────

  PETROL_STATION_2AM: {
    id: "PETROL_STATION_2AM",
    label: "Petrol station at 2am",
    emotions: ["liminal", "isolated", "introspective", "still"],
    energy: { min: 0.10, max: 0.45, target: 0.25 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "indie", weight: 0.80 },
      { genre: "pop", weight: 0.50 },
      { genre: "soul", weight: 0.40 },
      { genre: "rnb", weight: 0.35 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "metal", "latin", "reggae", "classical"],
    aesthetics: ["neon", "fluorescent light", "concrete", "liminal space", "empty"],
  },

  EMPTY_MOTORWAY_NIGHT: {
    id: "EMPTY_MOTORWAY_NIGHT",
    label: "Empty motorway at night",
    emotions: ["focused", "introspective", "tense", "free"],
    energy: { min: 0.30, max: 0.70, target: 0.50 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rock", weight: 0.75 },
      { genre: "indie", weight: 0.70 },
      { genre: "pop", weight: 0.45 },
      { genre: "soul", weight: 0.35 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "classical", "reggae", "latin", "christmas"],
    aesthetics: ["synthwave", "motorway", "night drive", "dark ambient", "motion"],
  },

  RAINY_CITY_LIGHTS: {
    id: "RAINY_CITY_LIGHTS",
    label: "Rainy city lights",
    emotions: ["melancholic", "reflective", "urban", "cinematic"],
    energy: { min: 0.15, max: 0.55, target: 0.33 },
    genreEcosystem: [
      { genre: "jazz", weight: 1.0 },
      { genre: "soul", weight: 0.85 },
      { genre: "rnb", weight: 0.80 },
      { genre: "indie", weight: 0.65 },
      { genre: "electronic", weight: 0.55 },
      { genre: "pop", weight: 0.40 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["country", "folk", "metal", "latin", "reggae", "christmas"],
    aesthetics: ["jazzhop", "neo soul", "urban", "cinematic", "wet streets", "neon reflections"],
  },

  CITY_AFTER_MIDNIGHT: {
    id: "CITY_AFTER_MIDNIGHT",
    label: "Walking through a city after midnight",
    emotions: ["liminal", "urban", "reflective", "solitary"],
    energy: { min: 0.18, max: 0.55, target: 0.35 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "jazz", weight: 0.85 },
      { genre: "rnb", weight: 0.75 },
      { genre: "soul", weight: 0.70 },
      { genre: "indie", weight: 0.55 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "metal", "latin", "reggae", "christmas"],
    aesthetics: ["city at night", "urban", "liminal", "ambient", "lo-fi", "street lights"],
  },

  NEON_STREETS: {
    id: "NEON_STREETS",
    label: "Neon streets at night",
    emotions: ["urban", "electric", "restless", "cinematic"],
    energy: { min: 0.40, max: 0.80, target: 0.60 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rnb", weight: 0.80 },
      { genre: "hip_hop", weight: 0.70 },
      { genre: "pop", weight: 0.55 },
      { genre: "indie", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "classical", "reggae", "christmas"],
    aesthetics: ["neon", "synthwave", "cyberpunk", "urban night", "electric"],
  },

  // ── Nature / Landscape ─────────────────────────────────────────────────────

  SUMMER_FIELD_GOLDEN_HOUR: {
    id: "SUMMER_FIELD_GOLDEN_HOUR",
    label: "Summer field at golden hour",
    emotions: ["peaceful", "free", "warm", "nostalgic"],
    energy: { min: 0.30, max: 0.65, target: 0.48 },
    genreEcosystem: [
      { genre: "folk", weight: 1.0 },
      { genre: "indie", weight: 0.85 },
      { genre: "country", weight: 0.70 },
      { genre: "pop", weight: 0.55 },
      { genre: "rock", weight: 0.40 },
    ],
    ecosystemFloor: 0.70,
    antiGenres: ["electronic", "metal", "hip_hop", "classical", "christmas"],
    aesthetics: ["golden hour", "open field", "warm air", "indie folk", "pastoral"],
  },

  DRIVING_SOMEWHERE_NOWHERE: {
    id: "DRIVING_SOMEWHERE_NOWHERE",
    label: "Driving somewhere you don't need to be",
    emotions: ["restless", "reflective", "free", "bittersweet"],
    energy: { min: 0.28, max: 0.62, target: 0.44 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "rock", weight: 0.80 },
      { genre: "folk", weight: 0.70 },
      { genre: "country", weight: 0.60 },
      { genre: "pop", weight: 0.45 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "classical", "christmas", "electronic"],
    aesthetics: ["open road", "wandering", "bittersweet", "indie rock", "drifting"],
  },

  SUNSET_FIELDS: {
    id: "SUNSET_FIELDS",
    label: "Sunset over fields",
    emotions: ["peaceful", "nostalgic", "warm", "transcendent"],
    energy: { min: 0.22, max: 0.60, target: 0.40 },
    genreEcosystem: [
      { genre: "folk", weight: 1.0 },
      { genre: "country", weight: 0.85 },
      { genre: "indie", weight: 0.75 },
      { genre: "rock", weight: 0.50 },
      { genre: "soul", weight: 0.40 },
    ],
    ecosystemFloor: 0.70,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin"],
    aesthetics: ["sunset", "golden", "fields", "open sky", "pastoral", "warm"],
  },

  // ── Travel ─────────────────────────────────────────────────────────────────

  TRAIN_JOURNEY: {
    id: "TRAIN_JOURNEY",
    label: "Train journey",
    emotions: ["reflective", "nostalgic", "contemplative", "free"],
    energy: { min: 0.22, max: 0.60, target: 0.40 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "rock", weight: 0.70 },
      { genre: "electronic", weight: 0.55 },
      { genre: "jazz", weight: 0.50 },
      { genre: "pop", weight: 0.40 },
    ],
    ecosystemFloor: 0.67,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["motion", "landscape", "window", "travel", "contemplative", "passing scenery"],
  },

  AIRPORT_WAITING: {
    id: "AIRPORT_WAITING",
    label: "Airport waiting",
    emotions: ["liminal", "anticipation", "reflective", "quiet"],
    energy: { min: 0.15, max: 0.50, target: 0.30 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "indie", weight: 0.85 },
      { genre: "pop", weight: 0.65 },
      { genre: "jazz", weight: 0.55 },
      { genre: "soul", weight: 0.45 },
      { genre: "folk", weight: 0.38 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "country", "latin", "reggae", "christmas"],
    aesthetics: ["terminal", "ambient", "liminal", "departure", "quiet hum", "fluorescent"],
  },

  // ── Reflection / Emotional ─────────────────────────────────────────────────

  HEARTBREAK: {
    id: "HEARTBREAK",
    label: "Heartbreak",
    emotions: ["sad", "raw", "longing", "processing", "melancholic"],
    energy: { min: 0.12, max: 0.55, target: 0.32 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "soul", weight: 0.88 },
      { genre: "folk", weight: 0.80 },
      { genre: "pop", weight: 0.68 },
      { genre: "rnb", weight: 0.62 },
      { genre: "rock", weight: 0.48 },
      { genre: "country", weight: 0.45 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "electronic", "latin", "reggae", "christmas"],
    aesthetics: ["raw", "emotional", "bedroom", "tearful", "honest", "stripped"],
  },

  NOSTALGIA: {
    id: "NOSTALGIA",
    label: "Nostalgia",
    emotions: ["nostalgic", "bittersweet", "warm", "wistful", "reflective"],
    energy: { min: 0.18, max: 0.62, target: 0.40 },
    genreEcosystem: [
      { genre: "pop", weight: 0.80 },
      { genre: "rock", weight: 0.85 },
      { genre: "indie", weight: 0.80 },
      { genre: "soul", weight: 0.72 },
      { genre: "folk", weight: 0.65 },
      { genre: "rnb", weight: 0.60 },
      { genre: "country", weight: 0.55 },
    ],
    ecosystemFloor: 0.60,
    antiGenres: ["metal", "christmas"],
    aesthetics: ["retro", "warm", "memory", "faded", "analog", "childhood"],
  },

  THINKING_ABOUT_LIFE: {
    id: "THINKING_ABOUT_LIFE",
    label: "Thinking about life",
    emotions: ["introspective", "reflective", "calm", "philosophical"],
    energy: { min: 0.15, max: 0.55, target: 0.33 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.85 },
      { genre: "soul", weight: 0.72 },
      { genre: "rock", weight: 0.60 },
      { genre: "jazz", weight: 0.55 },
      { genre: "pop", weight: 0.48 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "latin", "reggae", "christmas"],
    aesthetics: ["introspective", "quiet", "thoughtful", "melancholic", "honest"],
  },

  // ── Subculture / Genre-specific ───────────────────────────────────────────

  RAVE_90S_UK: {
    id: "RAVE_90S_UK",
    label: "90s UK rave",
    emotions: ["euphoric", "electric", "hedonistic", "tribal", "free"],
    energy: { min: 0.70, max: 1.0, target: 0.88 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "pop", weight: 0.30 },
    ],
    ecosystemFloor: 0.85,
    antiGenres: ["country", "folk", "classical", "jazz", "blues", "metal", "reggae", "latin", "christmas"],
    aesthetics: ["rave", "warehouse", "strobe", "acid house", "gabber", "breakbeat", "drum and bass", "euphoria"],
  },

  JAPANESE_CITY_POP: {
    id: "JAPANESE_CITY_POP",
    label: "Japanese city pop",
    emotions: ["nostalgic", "dreamy", "urban", "breezy", "warm"],
    energy: { min: 0.35, max: 0.72, target: 0.54 },
    genreEcosystem: [
      { genre: "pop", weight: 1.0 },
      { genre: "soul", weight: 0.85 },
      { genre: "rnb", weight: 0.80 },
      { genre: "jazz", weight: 0.75 },
      { genre: "electronic", weight: 0.55 },
    ],
    ecosystemFloor: 0.70,
    antiGenres: ["country", "folk", "metal", "classical", "christmas", "reggae"],
    aesthetics: ["city pop", "retro futurism", "Japanese 80s", "breezy", "saxophone", "summer evening"],
  },

  // ── Tokyo / Japan Night ────────────────────────────────────────────────────

  TOKYO_NEON_NIGHT: {
    id: "TOKYO_NEON_NIGHT",
    label: "Tokyo neon night",
    emotions: ["electric", "dreamy", "urban", "nostalgic", "cinematic"],
    energy: { min: 0.35, max: 0.75, target: 0.55 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "pop", weight: 0.85 },
      { genre: "rnb", weight: 0.75 },
      { genre: "soul", weight: 0.65 },
      { genre: "jazz", weight: 0.60 },
      { genre: "indie", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "metal", "classical", "reggae", "christmas"],
    aesthetics: ["neon", "tokyo", "shibuya", "urban japan", "night city", "retro future", "anime aesthetic"],
  },

  // ── Dreamy / Ethereal ─────────────────────────────────────────────────────

  DREAMY_ETHEREAL: {
    id: "DREAMY_ETHEREAL",
    label: "Dreamy / ethereal",
    emotions: ["ethereal", "dreamy", "floating", "liminal", "peaceful", "surreal"],
    energy: { min: 0.08, max: 0.45, target: 0.25 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "indie", weight: 0.85 },
      { genre: "folk", weight: 0.65 },
      { genre: "pop", weight: 0.55 },
      { genre: "jazz", weight: 0.45 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "country", "latin", "reggae", "christmas"],
    aesthetics: ["ambient", "shoegaze", "dream pop", "ethereal", "floating", "haze", "soft focus"],
  },

  // ── Workout / Intensity ───────────────────────────────────────────────────

  WORKOUT_INTENSITY: {
    id: "WORKOUT_INTENSITY",
    label: "Workout / high-intensity training",
    emotions: ["driven", "aggressive", "focused", "powerful", "adrenaline"],
    energy: { min: 0.72, max: 1.0, target: 0.88 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rock", weight: 0.90 },
      { genre: "metal", weight: 0.80 },
      { genre: "hip_hop", weight: 0.75 },
      { genre: "pop", weight: 0.45 },
    ],
    ecosystemFloor: 0.78,
    antiGenres: ["folk", "country", "jazz", "classical", "reggae", "christmas"],
    aesthetics: ["power", "energy", "sweat", "intensity", "beast mode", "adrenaline", "gym"],
  },

  // ── Party / Social ────────────────────────────────────────────────────────

  PARTY_SOCIAL_NIGHT: {
    id: "PARTY_SOCIAL_NIGHT",
    label: "Party / social night out",
    emotions: ["euphoric", "social", "free", "fun", "electric"],
    energy: { min: 0.60, max: 0.95, target: 0.80 },
    genreEcosystem: [
      { genre: "pop", weight: 1.0 },
      { genre: "electronic", weight: 0.90 },
      { genre: "hip_hop", weight: 0.80 },
      { genre: "rnb", weight: 0.70 },
      { genre: "rock", weight: 0.50 },
      { genre: "indie", weight: 0.40 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["folk", "country", "classical", "jazz", "christmas"],
    aesthetics: ["party", "dance", "fun", "social", "night out", "drinks", "crowd", "dancing"],
  },

  // ── Beach / Coastal Summer ────────────────────────────────────────────────

  BEACH_COASTAL_SUMMER: {
    id: "BEACH_COASTAL_SUMMER",
    label: "Beach / coastal summer",
    emotions: ["free", "warm", "joyful", "carefree", "nostalgic"],
    energy: { min: 0.35, max: 0.78, target: 0.58 },
    genreEcosystem: [
      { genre: "pop", weight: 1.0 },
      { genre: "indie", weight: 0.85 },
      { genre: "folk", weight: 0.70 },
      { genre: "rock", weight: 0.65 },
      { genre: "rnb", weight: 0.55 },
      { genre: "reggae", weight: 0.50 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["metal", "hip_hop", "classical", "christmas"],
    aesthetics: ["beach", "coastal", "summer", "sun", "waves", "warm breeze", "carefree", "poolside"],
  },

  // ── Small Town Americana ──────────────────────────────────────────────────

  SMALL_TOWN_AMERICANA: {
    id: "SMALL_TOWN_AMERICANA",
    label: "Small town Americana",
    emotions: ["warm", "nostalgic", "communal", "grounded", "simple"],
    energy: { min: 0.25, max: 0.68, target: 0.48 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "rock", weight: 0.65 },
      { genre: "blues", weight: 0.60 },
      { genre: "indie", weight: 0.45 },
      { genre: "soul", weight: 0.40 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae"],
    aesthetics: ["small town", "front porch", "county fair", "americana", "heartland", "community", "bonfire"],
  },

  // ── Seasons ───────────────────────────────────────────────────────────────

  WINTER_COLD: {
    id: "WINTER_COLD",
    label: "Winter / cold season",
    emotions: ["introspective", "quiet", "still", "melancholic", "cosy"],
    energy: { min: 0.12, max: 0.52, target: 0.30 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.90 },
      { genre: "classical", weight: 0.75 },
      { genre: "jazz", weight: 0.68 },
      { genre: "soul", weight: 0.60 },
      { genre: "rock", weight: 0.50 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["electronic", "metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["winter", "snow", "cold", "frost", "quiet", "still", "bare trees", "ice"],
  },

  AUTUMN_MELANCHOLY: {
    id: "AUTUMN_MELANCHOLY",
    label: "Autumn melancholy",
    emotions: ["melancholic", "reflective", "nostalgic", "bittersweet", "wistful"],
    energy: { min: 0.15, max: 0.55, target: 0.33 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "rock", weight: 0.72 },
      { genre: "soul", weight: 0.65 },
      { genre: "jazz", weight: 0.55 },
      { genre: "pop", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["electronic", "metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["autumn", "leaves", "decay", "melancholy", "change", "season", "fading light"],
  },

  SPRING_FRESH: {
    id: "SPRING_FRESH",
    label: "Spring morning / fresh start",
    emotions: ["hopeful", "fresh", "light", "optimistic", "peaceful"],
    energy: { min: 0.28, max: 0.65, target: 0.45 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "pop", weight: 0.72 },
      { genre: "rock", weight: 0.60 },
      { genre: "soul", weight: 0.55 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["spring", "fresh", "morning", "bloom", "new beginning", "light", "hopeful"],
  },

  // ── Road Trip / Adventure ─────────────────────────────────────────────────

  ROAD_TRIP: {
    id: "ROAD_TRIP",
    label: "Road trip",
    emotions: ["free", "adventurous", "euphoric", "nostalgic", "open"],
    energy: { min: 0.40, max: 0.80, target: 0.60 },
    genreEcosystem: [
      { genre: "rock", weight: 1.0 },
      { genre: "indie", weight: 0.88 },
      { genre: "folk", weight: 0.72 },
      { genre: "country", weight: 0.68 },
      { genre: "pop", weight: 0.55 },
      { genre: "electronic", weight: 0.42 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "classical", "christmas"],
    aesthetics: ["road trip", "windows down", "freedom", "open road", "adventure", "singing along", "highway"],
  },

  EXPLORE_TRAVEL: {
    id: "EXPLORE_TRAVEL",
    label: "Travel / exploring new places",
    emotions: ["adventurous", "curious", "excited", "free", "open"],
    energy: { min: 0.35, max: 0.72, target: 0.52 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "pop", weight: 0.80 },
      { genre: "electronic", weight: 0.68 },
      { genre: "folk", weight: 0.65 },
      { genre: "rock", weight: 0.60 },
    ],
    ecosystemFloor: 0.62,
    antiGenres: ["metal", "classical", "christmas"],
    aesthetics: ["travel", "explore", "new city", "adventure", "abroad", "discovery", "wanderlust"],
  },

  // ── Late Night Drive ──────────────────────────────────────────────────────

  LATE_NIGHT_DRIVE: {
    id: "LATE_NIGHT_DRIVE",
    label: "Late night driving",
    emotions: ["introspective", "focused", "free", "solitary", "calm"],
    energy: { min: 0.28, max: 0.65, target: 0.45 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "indie", weight: 0.80 },
      { genre: "rock", weight: 0.72 },
      { genre: "pop", weight: 0.50 },
      { genre: "soul", weight: 0.42 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["country", "folk", "classical", "latin", "reggae", "christmas"],
    aesthetics: ["night drive", "headlights", "dark roads", "late night", "motion", "solo", "empty streets"],
  },
};

const SCENE_DETECTION_PATTERNS: {
  id: string;
  patterns: RegExp[];
  confidence: number;
}[] = [
  // ── Rural / Americana ────────────────────────────────────────────────────
  {
    id: "OUTLAW_COUNTRY",
    patterns: [
      /\b(outlaw country|outlaw.{0,10}music|outlaw.{0,10}song)\b/i,
      /\b(tyler childers|zach bryan|jason isbell|chris stapleton|turnpike troubadour|sturgill simpson|colter wall)\b/i,
      /\b(honky.?tonk|western.{0,15}(swing|music)|nashville.{0,20}(grit|dark|real))\b/i,
      /\b(western freedom|dusty boots|cowboy.{0,20}(sunset|sunrise|hat|boots|song))\b/i,
      /\b(roadhouse|road house).{0,20}(bar|night|music|song)\b/i,
      /\b(desert highway|wild west|old west|backcountry.{0,20}(ride|drive|adventure))\b/i,
      /\b(small town outlaw|country rebel|renegade country|outlaw spirit)\b/i,
      /\b(lonely saloon|bar.{0,15}(midnight|2am|late)|old cowboy|spaghetti western)\b/i,
      /\b(truck stop.{0,20}(midnight|night|late)|late night.{0,20}truck stop)\b/i,
    ],
    confidence: 0.94,
  },
  {
    id: "DOG_ON_DIRT_ROAD",
    patterns: [
      /\b(dog.{0,25}(dirt road|road|field|country)|dirt road.{0,25}dog)\b/i,
      /\b(dog.{0,20}(morning|afternoon|sun|warm|grass|farm|field))\b/i,
      /\b(dog riding shotgun|dog.{0,15}(truck|pickup|window))\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "DIRT_ROAD_SUNSET",
    patterns: [
      /\b(dirt road|country road|dusty road|gravel road|back road|backroad)\b/i,
      /\b(backroads|country roads|country lane.{0,20}(drive|ride|walk))\b/i,
      /\b(sunset|golden hour|dusk).{0,40}(road|drive|field|rural|country|farm)\b/i,
      /\b(rural|countryside|heartland|farmland|open road).{0,40}(sunset|dusk|golden|warm)\b/i,
      /\b(americana|southern.{0,15}rock)\b/i,
      /\b(country (drive|cruise|ride|roads|sunset|sunrise|morning|evening|highway))\b/i,
      /\b(southern (evening|summer|night|sunset|roads|countryside))\b/i,
      /\b(empty country.{0,20}(highway|road|lane)|country.{0,20}heartbreak)\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "RURAL_FARM_ROAD",
    patterns: [
      /\b(farm road|country lane|rural road|open road.{0,20}(country|rural|field|farm))\b/i,
      /\b(farmland|countryside|open fields|rural.{0,20}(drive|ride|walk))\b/i,
      /\b(tractor.{0,15}(road|lane|field)|driving.{0,20}farmland)\b/i,
      /\b(middle of nowhere|rural freedom|empty.{0,15}(country|rural|field|farmland))\b/i,
      /\b(old pickup.{0,15}(truck|ute)|pickup truck|truck.{0,20}(sunset|field|road|farm))\b/i,
      /\b(cornfield|corn field).{0,20}(sunset|evening|dusk|golden)\b/i,
      /\b(fishing.{0,20}(dawn|morning|lake|river)|lake cabin|cabin.{0,20}(lake|woods|rural))\b/i,
      /\b(whiskey.{0,20}(fire|campfire|night|bonfire)|bonfire.{0,20}(field|night|farm))\b/i,
    ],
    confidence: 0.85,
  },
  {
    id: "SMALL_TOWN_AMERICANA",
    patterns: [
      /\b(small town.{0,20}(friday|saturday|night|evening|life|vibes))\b/i,
      /\b(county fair|state fair|barn dance|front porch|porch.{0,15}(sitting|evening|song|guitar))\b/i,
      /\b(small town|smalltown|hometown.{0,20}(pride|night|summer|friday))\b/i,
      /\b(main street.{0,20}(town|small|friday|night)|friday night.{0,20}(town|lights|game))\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "COMING_HOME",
    patterns: [
      /\b(coming home|driving home|heading home|on my way home|back home)\b/i,
      /\b(homecoming|return.{0,20}home|missed home)\b/i,
    ],
    confidence: 0.88,
  },

  // ── Night / Urban ────────────────────────────────────────────────────────
  {
    id: "PETROL_STATION_2AM",
    patterns: [
      /\b(petrol station|gas station).{0,30}(2am|3am|late night|midnight|night)\b/i,
      /\b(2am|3am).{0,30}(petrol|gas station|garage|forecourt)\b/i,
      /\b(service station.{0,20}(midnight|night|late|2am)|late.{0,15}service station)\b/i,
    ],
    confidence: 0.95,
  },
  {
    id: "EMPTY_MOTORWAY_NIGHT",
    patterns: [
      /\b(empty motorway|empty highway|motorway at night|highway at night)\b/i,
      /\b(motorway|highway).{0,25}(midnight|2am|late night|empty|alone|dark)\b/i,
      /\b(night drive|driving at night|driving home.{0,20}night)\b/i,
      /\b(night highway|highway.{0,20}night|driving.{0,20}(3am|midnight))\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "LATE_NIGHT_DRIVE",
    patterns: [
      /\b(late night.{0,20}(driving|drive|road|cruise)|driving.{0,20}late night)\b/i,
      /\b(headlights.{0,20}(rain|road|night|dark)|rain.{0,20}headlights)\b/i,
      /\b(long road home|long drive home|long.{0,15}drive.{0,15}(home|back))\b/i,
      /\b(solo.{0,15}drive|driving.{0,15}alone.{0,15}(night|dark|late))\b/i,
    ],
    confidence: 0.86,
  },
  {
    id: "RAINY_CITY_LIGHTS",
    patterns: [
      /\b(rainy city|rain.{0,15}city|city.{0,15}rain)\b/i,
      /\b(rain).{0,30}(lights|neon|street|window|glass|city)\b/i,
      /\b(jazzhop|neo soul|rainy.{0,15}day|city lights|wet streets)\b/i,
      /\b(rain on (windows|glass|the window)|grey.{0,20}(afternoon|day|morning|sky))\b/i,
      /\b(walking.{0,20}(in the rain|through rain)|rain.{0,20}walk)\b/i,
      /\b(melancholy.{0,20}(evening|afternoon|day|night)|quiet.{0,15}(sadness|sorrow|grief))\b/i,
      /\b(autumn rain|overcast.{0,20}(city|day|afternoon)|empty streets.{0,20}(rain|grey|city))\b/i,
    ],
    confidence: 0.85,
  },
  {
    id: "CITY_AFTER_MIDNIGHT",
    patterns: [
      /\b(city after midnight|walking.{0,20}city.{0,20}(midnight|night|late))\b/i,
      /\b(empty city|dead city|quiet city|city at.{0,10}(midnight|night|dawn))\b/i,
      /\b(after midnight).{0,30}(city|street|walk|urban)\b/i,
      /\b(urban solitude|neon reflections|city.{0,20}(solitude|alone|quiet|empty))\b/i,
      /\b(empty streets|deserted streets|quiet streets|streets.{0,15}(empty|quiet|alone|late))\b/i,
    ],
    confidence: 0.87,
  },
  {
    id: "NEON_STREETS",
    patterns: [
      /\b(neon streets|neon lights.{0,20}(night|city|rain)|neon.{0,20}city)\b/i,
      /\b(late.?night.{0,20}(city|urban|streets)|urban night|city night)\b/i,
    ],
    confidence: 0.82,
  },

  // ── Nature / Landscape ───────────────────────────────────────────────────
  {
    id: "SUMMER_FIELD_GOLDEN_HOUR",
    patterns: [
      /\b(summer.{0,20}(field|meadow|grass|countryside|evening))\b/i,
      /\b(golden hour|golden light).{0,30}(summer|field|countryside|open)\b/i,
      /\b(festival sunset|indie folk|pastoral|open field)\b/i,
      /\b(late july|mid july|july evening|july.{0,15}(night|sunset|evening|warm))\b/i,
      /\b(carefree.{0,15}summer|summer.{0,15}(vibes|feeling|nostalgia|vacation|poolside))\b/i,
    ],
    confidence: 0.82,
  },
  {
    id: "DRIVING_SOMEWHERE_NOWHERE",
    patterns: [
      /\bdriving somewhere (you|i|we) don'?t need\b/i,
      /\b(aimless|nowhere to be|no destination|just driving|driving for the sake)\b/i,
      /\b(windows down).{0,25}(road|driving|cruise)\b/i,
      /\bwindows down\b/i,
      /\b(driving nowhere|driving.{0,15}nowhere|going nowhere.{0,15}drive)\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "SUNSET_FIELDS",
    patterns: [
      /\b(sunset.{0,20}(field|fields|meadow|countryside)|field.{0,20}(sunset|dusk|evening))\b/i,
      /\b(open sky|wide open|horizon.{0,20}(sunset|dusk|golden))\b/i,
    ],
    confidence: 0.83,
  },

  // ── Seasons ──────────────────────────────────────────────────────────────
  {
    id: "AUTUMN_MELANCHOLY",
    patterns: [
      /\b(autumn.{0,20}(leaves|rain|evening|morning|walk|feeling|melancholy|mood))\b/i,
      /\b(fall leaves|falling leaves|leaves.{0,20}(falling|changing|orange|brown))\b/i,
      /\b(seasonal.{0,15}(change|shift)|end of summer|summer ending|october.{0,15}(rain|morning|evening))\b/i,
    ],
    confidence: 0.85,
  },
  {
    id: "WINTER_COLD",
    patterns: [
      /\b(winter.{0,20}(evening|morning|night|day|cold|snow|feeling|vibes))\b/i,
      /\b(snowfall|snowing|snow.{0,15}(morning|evening|night|outside|falling))\b/i,
      /\b(cold morning|frosty.{0,20}(morning|sunrise|air|window)|frost.{0,15}(morning|air))\b/i,
      /\b(freezing cold|bitter cold|icy.{0,15}(road|morning|air))\b/i,
    ],
    confidence: 0.85,
  },
  {
    id: "SPRING_FRESH",
    patterns: [
      /\b(spring.{0,20}(morning|day|rain|flowers|evening|vibes|feeling))\b/i,
      /\b(spring morning|early spring|first day of spring|spring has (come|arrived))\b/i,
      /\b(blossom.{0,15}(morning|day|tree|walk)|cherry blossom)\b/i,
    ],
    confidence: 0.83,
  },

  // ── Beach / Summer ────────────────────────────────────────────────────────
  {
    id: "BEACH_COASTAL_SUMMER",
    patterns: [
      /\b(beach.{0,20}(sunset|morning|day|summer|walk|vibes|party))\b/i,
      /\b(coastal.{0,20}(road|drive|walk|morning|evening)|coast.{0,15}(road|drive|sunset))\b/i,
      /\b(poolside|pool.{0,15}(party|summer|day)|swimming.{0,15}(pool|hole|lake))\b/i,
      /\b(summer.{0,15}(sunset|sunrise|beach|waves|swim|holiday|vacation))\b/i,
      /\b(warm.{0,15}(air|breeze|evening|summer)|sea.{0,15}(breeze|air|swim|side))\b/i,
      /\b(windows down.{0,20}(summer|heat|warm|hot)|summer.{0,20}windows down)\b/i,
    ],
    confidence: 0.84,
  },

  // ── Road Trip / Travel ────────────────────────────────────────────────────
  {
    id: "ROAD_TRIP",
    patterns: [
      /\b(road trip|roadtrip|road.?trip)\b/i,
      /\b(summer road trip|cross.?country.{0,15}(drive|trip|road))\b/i,
      /\b(long drive|long.{0,10}road.{0,10}(ahead|trip|journey)|miles of road)\b/i,
      /\b(driving.{0,20}(across|through.{0,15}(country|state|america|europe)))\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "EXPLORE_TRAVEL",
    patterns: [
      /\b(exploring.{0,20}(new city|city|place|country|abroad|world))\b/i,
      /\b(flying.{0,15}(abroad|overseas|away)|travel.{0,15}(abroad|overseas|new place))\b/i,
      /\b(mountain pass|mountain.{0,15}(drive|road|crossing|pass))\b/i,
      /\b(coastal road|coast.{0,15}road|cliff.{0,15}(road|drive)|seaside.{0,15}(drive|road))\b/i,
      /\b(wanderlust|travel.{0,15}(mood|vibes|feeling)|passport|departure)\b/i,
    ],
    confidence: 0.82,
  },
  {
    id: "TRAIN_JOURNEY",
    patterns: [
      /\b(train journey|train ride|on a train|train window|watching.{0,15}pass.{0,15}train)\b/i,
      /\b(rail|railway|train station|platform.{0,20}(wait|depart|arrive))\b/i,
      /\b(lonely.{0,10}train|train.{0,15}(alone|solo|journey|night|window))\b/i,
    ],
    confidence: 0.90,
  },
  {
    id: "AIRPORT_WAITING",
    patterns: [
      /\b(airport.{0,20}(wait|lounge|terminal|gate|departure|morning|night|sunrise))\b/i,
      /\b(waiting.{0,20}(airport|flight|departure|gate)|departure lounge)\b/i,
      /\b(flying.{0,15}(abroad|overseas|away|early|morning))\b/i,
    ],
    confidence: 0.90,
  },

  // ── Reflection / Emotional ───────────────────────────────────────────────
  {
    id: "HEARTBREAK",
    patterns: [
      /\b(heartbreak|heartbroken|broken heart|just broke.{0,10}up|breakup|break up|split up)\b/i,
      /\b(she left|he left|they left|missing (her|him|them)|can'?t stop thinking about)\b/i,
      /\b(missing someone|heartache|lost love|lost.{0,10}(her|him|them|you))\b/i,
      /\b(moving on.{0,20}(relationship|love|someone)|can'?t move on|trying to move on)\b/i,
      /\b(relationship.{0,20}(ending|over|done|finished|failed)|end of.{0,10}relationship)\b/i,
      /\b(looking at old photos|old photos|scrolling.{0,20}photos|late night.{0,20}memories)\b/i,
      /\b(regret.{0,20}(love|her|him|them|us)|wishing.{0,20}(back|return|could))\b/i,
      /\bregret\b/i,
      /\b(moving on|trying to move on|learning to move on)\b/i,
    ],
    confidence: 0.90,
  },
  {
    id: "NOSTALGIA",
    patterns: [
      /\b(nostalgia|nostalgic|reminiscing|throwback|old times|when i was (young|a kid))\b/i,
      /\b(childhood memory|growing up|remember when|back in the day|used to listen)\b/i,
      /\b(looking at old photos|old memories|memories.{0,15}(flood|rush|back|again))\b/i,
    ],
    confidence: 0.86,
  },
  {
    id: "THINKING_ABOUT_LIFE",
    patterns: [
      /\b(thinking about (life|everything|it all)|life (reflection|thoughts)|contemplat)\b/i,
      /\b(late night thoughts|overthinking|existential|where am i going|what does it mean)\b/i,
    ],
    confidence: 0.82,
  },

  // ── Dreamy / Ethereal ─────────────────────────────────────────────────────
  {
    id: "DREAMY_ETHEREAL",
    patterns: [
      /\b(dreamy|dream.{0,15}(vibe|mood|state|world|like|feeling))\b/i,
      /\b(ethereal|otherworldly|unreal.{0,15}(vibe|mood|feeling|sound))\b/i,
      /\b(floating.{0,20}(through space|in space|away|feeling)|dream sequence)\b/i,
      /\b(liminal.{0,20}(space|vibe|feeling|mood)|liminal$)\b/i,
      /\b(sleepy.{0,15}(afternoon|morning|day|vibe)|golden haze|warm haze)\b/i,
      /\b(sunlight.{0,20}(through curtains|through window|filtering|soft)|soft focus)\b/i,
      /\b(ambient.{0,15}(dream|float|haze|space)|dream pop|shoegaze|hypnagogic)\b/i,
      /\b(soft focus memory|waking dream|half asleep|drowsy)\b/i,
      /\b(unreal.{0,20}(vibe|sound|feeling|place|world)|feels unreal|so unreal)\b/i,
      /\bunreal\b/i,
    ],
    confidence: 0.84,
  },

  // ── Workout / Intensity ───────────────────────────────────────────────────
  {
    id: "WORKOUT_INTENSITY",
    patterns: [
      /\b(gym.{0,20}(rage|session|playlist|workout|music|energy)|gym rage)\b/i,
      /\b(lifting.{0,15}(heavy|weights|hard)|weight.{0,15}(lifting|training))\b/i,
      /\b(workout.{0,20}(motivation|playlist|energy|mode)|training.{0,15}(hard|session|intense))\b/i,
      /\b(running.{0,15}(hard|fast|sprint|push)|sprinting|run.{0,15}(motivation|energy))\b/i,
      /\b(fight mode|beast mode|full intensity|personal record|PR.{0,10}(lift|run|hit))\b/i,
      /\b(aggressive.{0,15}(training|workout|energy|music)|adrenaline.{0,15}(rush|pump|hit))\b/i,
      /\badrenaline\b/i,
      /\b(high.?intensity|hiit|crossfit|powerlifting)\b/i,
    ],
    confidence: 0.92,
  },

  // ── Party / Social ────────────────────────────────────────────────────────
  {
    id: "PARTY_SOCIAL_NIGHT",
    patterns: [
      /\b(house party|flat party|house.{0,10}party|party.{0,10}(playlist|music|night|vibes))\b/i,
      /\b(summer party|birthday party|garden party|rooftop party)\b/i,
      /\b(pre.?drinks|pres|pregame|pre-game|before.{0,15}(going out|the club|party))\b/i,
      /\b(friday night out|saturday night out|night.{0,10}out.{0,10}(playlist|music|vibe))\b/i,
      /\b(dance floor|dancefloor|on the dancefloor|dancing.{0,15}(night|out|floor))\b/i,
      /\b(nightclub|the club|clubbing|going.{0,10}(out|clubbing|to a club))\b/i,
      /\b(afterparty|after.?party|3am.{0,15}(dancefloor|club|party)|2am.{0,15}(party|dance))\b/i,
      /\b(festival crowd|festival.{0,15}(vibe|energy|music|stage)|festival season)\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "RAVE_90S_UK",
    patterns: [
      /\b(90s.{0,10}(rave|uk rave|acid house|drum.{0,5}bass|gabber)|uk rave|acid house)\b/i,
      /\b(warehouse (rave|party)|rave culture|old skool rave|jungle music|old school rave)\b/i,
      /\b(breakbeat|happy hardcore|hardcore rave|gabba|supersaw)\b/i,
      /\b(rave field|field rave|open air rave|outdoor rave)\b/i,
    ],
    confidence: 0.95,
  },

  // ── City Pop / Japan ──────────────────────────────────────────────────────
  {
    id: "JAPANESE_CITY_POP",
    patterns: [
      /\b(japanese city pop|city pop|j-?pop.{0,20}(80s|retro|vintage)|japanese.{0,20}(80s|retro|funk|pop))\b/i,
      /\b(plastic love|tatsuro yamashita|mariya takeuchi|anri|miki matsubara)\b/i,
      /\b(city pop aesthetic|japanese 80s|retro futur.{0,10}japan)\b/i,
      /\b(japan.{0,20}(summer evening|afternoon|breezy)|city pop sunset)\b/i,
    ],
    confidence: 0.95,
  },
  {
    id: "TOKYO_NEON_NIGHT",
    patterns: [
      /\b(tokyo.{0,20}(at night|night|neon|lights|after dark))\b/i,
      /\b(shibuya.{0,20}(night|neon|crossing|lights)|osaka.{0,20}(night|nightlife|neon))\b/i,
      /\b(late night.{0,15}japan|japan.{0,20}(late night|midnight|neon))\b/i,
      /\b(80s.{0,10}tokyo|retro.{0,10}japan|retro.{0,10}japanese)\b/i,
      /\b(anime.{0,15}(aesthetic|vibe|nostalgia|music)|arcade.{0,20}(night|neon|80s))\b/i,
    ],
    confidence: 0.90,
  },
];

export interface SemanticSceneResolution {
  vector: SemanticSceneVector | null;
  confidence: number;
  matchedId: string | null;
}

/**
 * Detect which semantic scene vector applies to the vibe prompt.
 * Returns the best match with confidence, or null if no clear scene detected.
 */
export function resolveSemanticScene(
  vibe: string,
  profile: EmotionProfile
): SemanticSceneResolution {
  let bestId: string | null = null;
  let bestConf = 0;

  for (const entry of SCENE_DETECTION_PATTERNS) {
    if (entry.patterns.some((re) => re.test(vibe))) {
      if (entry.confidence > bestConf) {
        bestConf = entry.confidence;
        bestId = entry.id;
      }
    }
  }

  if (!bestId) {
    return { vector: null, confidence: 0, matchedId: null };
  }

  return {
    vector: SEMANTIC_SCENE_VECTORS[bestId] ?? null,
    confidence: bestConf,
    matchedId: bestId,
  };
}

/**
 * Compute how well a track's genre classification fits the scene's genre ecosystem.
 * This is the PRIMARY scoring signal at 40% weight.
 *
 * Returns 0–1 where 1 = perfect ecosystem fit.
 */
export function computeSemanticEcosystemScore(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector
): number {
  const primary = classification.genrePrimary;
  const secondary = classification.genreSecondary;
  const confidence = classification.confidenceScore;

  let primaryWeight = 0;
  let secondaryWeight = 0;

  for (const { genre, weight } of vector.genreEcosystem) {
    if (genre === primary) primaryWeight = weight;
    if (secondary && genre === secondary) secondaryWeight = weight;
  }

  if (primaryWeight === 0 && secondaryWeight === 0) return 0.05;

  const blended = primaryWeight * 0.75 + secondaryWeight * 0.25;
  return Math.min(1, blended * (0.7 + confidence * 0.3));
}

/**
 * Compute negative match penalty for tracks that violate the scene.
 * Anti-genre tracks receive a penalty multiplier < 1 applied to their final score.
 * Penalty is hard (0.08) when confidence is high — anti-genre tracks are nearly excluded.
 */
export function computeNegativePenalty(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector
): number {
  const primary = classification.genrePrimary;
  const secondary = classification.genreSecondary;

  const primaryViolates = vector.antiGenres.includes(primary);
  const secondaryViolates = secondary ? vector.antiGenres.includes(secondary) : false;

  // Hard penalty: high-confidence anti-genre tracks get near-zero multiplier
  if (primaryViolates && classification.confidenceScore >= 0.6) return 0.08;
  if (primaryViolates && classification.confidenceScore >= 0.4) return 0.18;
  if (primaryViolates) return 0.35;
  if (secondaryViolates) return 0.65;
  return 1.0;
}

/**
 * Returns true if a track's primary genre is in the scene's anti-genre list.
 * Used for pre-filtering the candidate pool before scoring.
 */
export function isHardAntiGenre(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector
): boolean {
  return (
    vector.antiGenres.includes(classification.genrePrimary) &&
    classification.confidenceScore >= 0.5
  );
}

/**
 * Scene confidence threshold above which the hard ecosystem gate activates.
 * At ≥ 0.70 confidence, only genres with weight ≥ ECOSYSTEM_HARD_GATE_MIN_WEIGHT
 * in the ecosystem may enter the scoring pool.
 */
export const ECOSYSTEM_HARD_GATE_CONFIDENCE = 0.70;

/**
 * Minimum ecosystem weight for a genre to pass the hard gate.
 * Genres below this weight (e.g. "indie" at 0.35 in OUTLAW_COUNTRY) are excluded
 * before scoring — they cannot win via high semantic similarity cross-genre.
 */
export const ECOSYSTEM_HARD_GATE_MIN_WEIGHT = 0.50;

/**
 * Hard ecosystem whitelist gate.
 *
 * When scene confidence ≥ ECOSYSTEM_HARD_GATE_CONFIDENCE, a track must have its
 * primary genre (or genre family) present in the ecosystem with weight ≥
 * ECOSYSTEM_HARD_GATE_MIN_WEIGHT. Tracks that fail this check receive score = 0
 * and are excluded from the scoring pool entirely.
 *
 * Returns true  = track is eligible to be scored.
 * Returns false = track must be excluded (zero eligibility — not a lower score).
 *
 * Examples for OUTLAW_COUNTRY (confidence 0.94):
 *   country (1.00) → eligible
 *   folk    (0.78) → eligible
 *   blues   (0.70) → eligible
 *   rock    (0.65) → eligible
 *   indie   (0.35) → EXCLUDED — below min weight
 *   hip_hop (anti) → EXCLUDED — not in ecosystem
 */
export function isEcosystemWhitelisted(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector,
  confidence: number,
): boolean {
  if (confidence < ECOSYSTEM_HARD_GATE_CONFIDENCE) return true;
  if (classification.genrePrimary === "unknown") return true;

  const genre = classification.genrePrimary;
  const family = classification.genreFamily;

  for (const { genre: g, weight } of vector.genreEcosystem) {
    if ((g === genre || g === family) && weight >= ECOSYSTEM_HARD_GATE_MIN_WEIGHT) {
      return true;
    }
  }
  return false;
}

/**
 * Compute energy fit for a track against the scene's energy target.
 */
export function computeEnergyFit(
  energy: number | null,
  vector: SemanticSceneVector
): number {
  if (energy === null) return 0.6;
  const e = energy;
  const { min, max, target } = vector.energy;

  if (e < min - 0.1 || e > max + 0.1) return 0.2;
  if (e < min || e > max) return 0.6;
  return 1 - Math.abs(e - target) * 1.8;
}

/**
 * Build a diagnostics summary for the debug panel.
 */
export function buildSemanticDiagnostics(
  vibe: string,
  resolution: SemanticSceneResolution,
  topTrackScores: { trackId: string; semanticScore: number; emotionMatch: number; genreMatch: number }[]
): Record<string, unknown> {
  const v = resolution.vector;
  return {
    input: vibe,
    detectedScene: v?.label ?? "None",
    detectedSceneId: resolution.matchedId,
    sceneConfidence: resolution.confidence,
    detectedEmotions: v?.emotions ?? [],
    detectedGenres: v?.genreEcosystem.slice(0, 5).map((g) => g.genre) ?? [],
    antiGenres: v?.antiGenres ?? [],
    aesthetics: v?.aesthetics ?? [],
    ecosystemFloor: v?.ecosystemFloor ?? null,
    topRankedSignals: topTrackScores.slice(0, 10).map((t) => ({
      trackId: t.trackId,
      sceneMatch: Math.round(t.semanticScore * 100),
      emotionMatch: Math.round(t.emotionMatch * 100),
      genreMatch: Math.round(t.genreMatch * 100),
    })),
  };
}
