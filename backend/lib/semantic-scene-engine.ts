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
  /** Minimum primary-ecosystem share, max adjacent share, max other share */
  compositionTarget: { primaryMin: number; adjacentMax: number; otherMax: number };
  /** Narrative flow phase descriptions */
  flowPhases: { intro: string; core: string; peak: string; cooldown: string };
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
    compositionTarget: { primaryMin: 0.75, adjacentMax: 0.2, otherMax: 0.05 },
    flowPhases: { intro: "warm acoustic opener", core: "dusty country roads", peak: "anthemic freedom", cooldown: "golden hour nostalgia" },
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
    compositionTarget: { primaryMin: 0.78, adjacentMax: 0.18, otherMax: 0.04 },
    flowPhases: { intro: "lazy morning country", core: "peaceful countryside", peak: "carefree warmth", cooldown: "porch sunset" },
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
    compositionTarget: { primaryMin: 0.82, adjacentMax: 0.15, otherMax: 0.03 },
    flowPhases: { intro: "whiskey and swagger", core: "outlaw spirit", peak: "defiant anthem", cooldown: "dusty highway fade" },
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
    compositionTarget: { primaryMin: 0.76, adjacentMax: 0.19, otherMax: 0.05 },
    flowPhases: { intro: "early morning farm", core: "pastoral countryside", peak: "open field anthem", cooldown: "evening fields" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "familiar road", core: "returning warmth", peak: "homecoming moment", cooldown: "front door peace" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "fluorescent stillness", core: "liminal night", peak: "late night clarity", cooldown: "empty road quiet" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "headlights on dark road", core: "night highway pulse", peak: "full-speed momentum", cooldown: "motorway trance" },
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
    compositionTarget: { primaryMin: 0.74, adjacentMax: 0.2, otherMax: 0.06 },
    flowPhases: { intro: "raindrops on window", core: "wet streets and jazz", peak: "cinematic swell", cooldown: "late night reflection" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "empty intersection", core: "urban solitude", peak: "neon heartbeat", cooldown: "pre-dawn stillness" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "neon glow approach", core: "urban electric pulse", peak: "city night peak", cooldown: "fade to static" },
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
    compositionTarget: { primaryMin: 0.72, adjacentMax: 0.22, otherMax: 0.06 },
    flowPhases: { intro: "afternoon warmth", core: "open field bliss", peak: "golden hour swell", cooldown: "dusk settle" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "leaving without a plan", core: "aimless road", peak: "windows down moment", cooldown: "nowhere in particular" },
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
    compositionTarget: { primaryMin: 0.72, adjacentMax: 0.22, otherMax: 0.06 },
    flowPhases: { intro: "wide open horizon", core: "pastoral warmth", peak: "golden panorama", cooldown: "evening haze" },
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
    compositionTarget: { primaryMin: 0.69, adjacentMax: 0.25, otherMax: 0.06 },
    flowPhases: { intro: "departure platform", core: "passing landscapes", peak: "motion clarity", cooldown: "arrival" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "terminal quiet", core: "anticipation drift", peak: "departure gate energy", cooldown: "boarding stillness" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "raw first feeling", core: "processing the loss", peak: "emotional climax", cooldown: "quiet acceptance" },
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
    compositionTarget: { primaryMin: 0.62, adjacentMax: 0.3, otherMax: 0.08 },
    flowPhases: { intro: "memory trigger", core: "warm past glow", peak: "golden throwback", cooldown: "bittersweet present" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "quiet contemplation", core: "deep introspection", peak: "revelation moment", cooldown: "settled resolve" },
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
    compositionTarget: { primaryMin: 0.88, adjacentMax: 0.1, otherMax: 0.02 },
    flowPhases: { intro: "warehouse arrival", core: "acid house floor", peak: "rave peak moment", cooldown: "after-hours comedown" },
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
    compositionTarget: { primaryMin: 0.72, adjacentMax: 0.22, otherMax: 0.06 },
    flowPhases: { intro: "tokyo evening breeze", core: "city pop cruising", peak: "breezy summer peak", cooldown: "neon sunset fade" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "shibuya crossing glow", core: "tokyo neon pulse", peak: "electric city peak", cooldown: "late night japan fade" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "half-asleep drift", core: "floating through haze", peak: "ethereal peak", cooldown: "soft focus dissolve" },
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
    compositionTarget: { primaryMin: 0.8, adjacentMax: 0.16, otherMax: 0.04 },
    flowPhases: { intro: "warm up intensity", core: "peak training zone", peak: "max effort push", cooldown: "post-workout wind down" },
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
    compositionTarget: { primaryMin: 0.74, adjacentMax: 0.2, otherMax: 0.06 },
    flowPhases: { intro: "pre-drinks hype", core: "dance floor energy", peak: "peak night moment", cooldown: "end of night wind down" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "morning beach walk", core: "summer day sun", peak: "carefree peak", cooldown: "sunset on the water" },
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
    compositionTarget: { primaryMin: 0.74, adjacentMax: 0.2, otherMax: 0.06 },
    flowPhases: { intro: "front porch warmth", core: "small town heart", peak: "community anthem", cooldown: "bonfire fadeout" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "frost and stillness", core: "winter quiet", peak: "cold clarity peak", cooldown: "fireplace settle" },
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
    compositionTarget: { primaryMin: 0.7, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "first autumn chill", core: "falling leaves mood", peak: "melancholic swell", cooldown: "end of season quiet" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "first morning light", core: "hopeful emergence", peak: "fresh bloom peak", cooldown: "gentle spring settle" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "hitting the road", core: "open highway cruise", peak: "anthemic road moment", cooldown: "arrival and reflection" },
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
    compositionTarget: { primaryMin: 0.64, adjacentMax: 0.28, otherMax: 0.08 },
    flowPhases: { intro: "adventure begins", core: "new horizons", peak: "discovery moment", cooldown: "taking it all in" },
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
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "headlights in dark", core: "solo night cruise", peak: "late night clarity", cooldown: "arriving home quiet" },
  },

  // ── Study / Focus ──────────────────────────────────────────────────────────

  STUDY_DEEP_FOCUS: {
    id: "STUDY_DEEP_FOCUS",
    label: "Deep focus / studying",
    emotions: ["focused", "calm", "determined", "still", "absorbed"],
    energy: { min: 0.08, max: 0.42, target: 0.25 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "classical", weight: 0.90 },
      { genre: "jazz", weight: 0.80 },
      { genre: "indie", weight: 0.60 },
      { genre: "folk", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "country", "christmas"],
    aesthetics: ["ambient", "lo-fi", "focus", "study", "minimal", "clean", "concentration"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "settling in", core: "deep work zone", peak: "flow state", cooldown: "winding down" },
  },

  // ── Space / Cosmos ─────────────────────────────────────────────────────────

  SPACE_COSMOS: {
    id: "SPACE_COSMOS",
    label: "Space / floating in the cosmos",
    emotions: ["ethereal", "vast", "awe", "serene", "existential"],
    energy: { min: 0.05, max: 0.48, target: 0.22 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "classical", weight: 0.75 },
      { genre: "indie", weight: 0.55 },
      { genre: "folk", weight: 0.35 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["country", "folk", "metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["ambient", "space", "cosmos", "floating", "sci-fi", "zero gravity", "infinite"],
    compositionTarget: { primaryMin: 0.74, adjacentMax: 0.20, otherMax: 0.06 },
    flowPhases: { intro: "launch into orbit", core: "drifting through stars", peak: "cosmic vastness", cooldown: "floating back" },
  },

  // ── Cyberpunk / Future ─────────────────────────────────────────────────────

  CYBERPUNK_URBAN: {
    id: "CYBERPUNK_URBAN",
    label: "Cyberpunk city",
    emotions: ["electric", "tense", "futuristic", "urban", "cinematic"],
    energy: { min: 0.45, max: 0.85, target: 0.65 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rock", weight: 0.72 },
      { genre: "metal", weight: 0.55 },
      { genre: "hip_hop", weight: 0.50 },
      { genre: "indie", weight: 0.40 },
    ],
    ecosystemFloor: 0.75,
    antiGenres: ["country", "folk", "classical", "reggae", "latin", "christmas"],
    aesthetics: ["cyberpunk", "synthwave", "neon", "dystopia", "future", "blade runner", "urban tech"],
    compositionTarget: { primaryMin: 0.78, adjacentMax: 0.18, otherMax: 0.04 },
    flowPhases: { intro: "chrome city approach", core: "neon megacity pulse", peak: "system override", cooldown: "rain on metal" },
  },

  // ── Luxury / Ambition ──────────────────────────────────────────────────────

  LUXURY_AMBITION: {
    id: "LUXURY_AMBITION",
    label: "Luxury / ambition",
    emotions: ["confident", "driven", "elevated", "ambitious", "focused"],
    energy: { min: 0.35, max: 0.78, target: 0.58 },
    genreEcosystem: [
      { genre: "hip_hop", weight: 1.0 },
      { genre: "rnb", weight: 0.90 },
      { genre: "pop", weight: 0.72 },
      { genre: "electronic", weight: 0.60 },
      { genre: "soul", weight: 0.50 },
      { genre: "jazz", weight: 0.40 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "metal", "classical", "reggae", "christmas"],
    aesthetics: ["luxury", "wealth", "ambition", "penthouse", "smooth", "polished", "cinematic wealth"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "arrival energy", core: "peak ambition", peak: "victory moment", cooldown: "smooth satisfaction" },
  },

  // ── Adventure / Freedom ────────────────────────────────────────────────────

  ADVENTURE_MOUNTAINS: {
    id: "ADVENTURE_MOUNTAINS",
    label: "Mountain adventure / open wilderness",
    emotions: ["free", "adventurous", "awe", "alive", "expansive"],
    energy: { min: 0.38, max: 0.78, target: 0.58 },
    genreEcosystem: [
      { genre: "rock", weight: 1.0 },
      { genre: "folk", weight: 0.85 },
      { genre: "indie", weight: 0.78 },
      { genre: "country", weight: 0.65 },
      { genre: "electronic", weight: 0.40 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["hip_hop", "rnb", "metal", "classical", "christmas"],
    aesthetics: ["mountains", "wilderness", "peak", "open sky", "hiking", "summit", "vast landscape"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "trailhead departure", core: "open mountain climb", peak: "summit arrival", cooldown: "descent and reflection" },
  },

  // ── Healing / Hope ─────────────────────────────────────────────────────────

  HEALING_AFTER_PAIN: {
    id: "HEALING_AFTER_PAIN",
    label: "Healing after pain",
    emotions: ["healing", "tender", "quiet hope", "fragile", "gentle"],
    energy: { min: 0.10, max: 0.48, target: 0.28 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.92 },
      { genre: "soul", weight: 0.80 },
      { genre: "pop", weight: 0.65 },
      { genre: "rnb", weight: 0.55 },
      { genre: "jazz", weight: 0.45 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "electronic", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["gentle", "healing", "soft light", "recovery", "tender", "quiet", "slow"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "first tender step", core: "gentle recovery", peak: "quiet realisation", cooldown: "soft peace" },
  },

  HOPE_NEW_CHAPTER: {
    id: "HOPE_NEW_CHAPTER",
    label: "Hope / new chapter beginning",
    emotions: ["hopeful", "optimistic", "rising", "determined", "open"],
    energy: { min: 0.32, max: 0.72, target: 0.52 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "pop", weight: 0.85 },
      { genre: "folk", weight: 0.80 },
      { genre: "rock", weight: 0.68 },
      { genre: "soul", weight: 0.60 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["sunrise", "new start", "optimism", "forward", "light", "open door", "fresh air"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "first morning light", core: "stepping forward", peak: "breakthrough moment", cooldown: "settling in" },
  },

  // ── Regret / Reflection ────────────────────────────────────────────────────

  REGRET_REFLECTION: {
    id: "REGRET_REFLECTION",
    label: "Regret and reflection",
    emotions: ["regretful", "wistful", "melancholic", "introspective", "heavy"],
    energy: { min: 0.10, max: 0.45, target: 0.25 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "soul", weight: 0.78 },
      { genre: "rock", weight: 0.62 },
      { genre: "country", weight: 0.55 },
      { genre: "jazz", weight: 0.48 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "electronic", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["regret", "what could have been", "past", "heavy", "honest", "quiet", "still"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "memory arrives", core: "sitting with regret", peak: "raw acknowledgment", cooldown: "quiet acceptance" },
  },

  // ── Life Is Changing ──────────────────────────────────────────────────────

  LIFE_IS_CHANGING: {
    id: "LIFE_IS_CHANGING",
    label: "Life is changing",
    emotions: ["bittersweet", "uncertain", "hopeful", "nostalgic", "transitional"],
    energy: { min: 0.25, max: 0.65, target: 0.43 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "rock", weight: 0.72 },
      { genre: "pop", weight: 0.65 },
      { genre: "soul", weight: 0.60 },
      { genre: "country", weight: 0.45 },
    ],
    ecosystemFloor: 0.62,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["transition", "change", "bittersweet", "turning point", "moving forward", "uncertain future"],
    compositionTarget: { primaryMin: 0.64, adjacentMax: 0.28, otherMax: 0.08 },
    flowPhases: { intro: "sensing the shift", core: "in the middle of change", peak: "accepting the turn", cooldown: "walking into the new" },
  },

  // ── Life Moments ──────────────────────────────────────────────────────────

  SUMMER_BEFORE_UNI: {
    id: "SUMMER_BEFORE_UNI",
    label: "Last summer of youth",
    emotions: ["nostalgic", "bittersweet", "carefree", "anticipation", "warm"],
    energy: { min: 0.30, max: 0.72, target: 0.50 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "pop", weight: 0.85 },
      { genre: "rock", weight: 0.72 },
      { genre: "folk", weight: 0.68 },
      { genre: "rnb", weight: 0.50 },
      { genre: "electronic", weight: 0.40 },
    ],
    ecosystemFloor: 0.62,
    antiGenres: ["metal", "classical", "country", "reggae", "christmas"],
    aesthetics: ["golden summer", "last summer", "youth", "pre-change", "carefree days", "late nights", "warm evenings"],
    compositionTarget: { primaryMin: 0.64, adjacentMax: 0.28, otherMax: 0.08 },
    flowPhases: { intro: "last day feeling", core: "golden summer days", peak: "everything still feels infinite", cooldown: "knowing it will change" },
  },

  DRIVING_HOME_BREAKUP: {
    id: "DRIVING_HOME_BREAKUP",
    label: "Driving home after a breakup",
    emotions: ["raw", "numb", "processing", "alone", "broken"],
    energy: { min: 0.18, max: 0.55, target: 0.34 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "rock", weight: 0.80 },
      { genre: "folk", weight: 0.75 },
      { genre: "soul", weight: 0.70 },
      { genre: "pop", weight: 0.55 },
      { genre: "country", weight: 0.50 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["electronic", "metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["raw", "driving alone", "breakup", "night", "streetlights", "numb", "empty road"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "just left", core: "alone with it", peak: "raw hit", cooldown: "arriving home empty" },
  },

  // ── Festival / Social ─────────────────────────────────────────────────────

  FESTIVAL_SUMMER_FIELD: {
    id: "FESTIVAL_SUMMER_FIELD",
    label: "Summer music festival",
    emotions: ["euphoric", "free", "communal", "electric", "alive"],
    energy: { min: 0.55, max: 0.92, target: 0.75 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "rock", weight: 0.90 },
      { genre: "pop", weight: 0.78 },
      { genre: "electronic", weight: 0.68 },
      { genre: "folk", weight: 0.55 },
      { genre: "rnb", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["metal", "country", "classical", "jazz", "christmas"],
    aesthetics: ["festival", "field", "crowd", "main stage", "summer sun", "communal", "outdoor music"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "arriving at the field", core: "in the crowd", peak: "headline moment", cooldown: "walking out after" },
  },

  AFTERPARTY_COMEDOWN: {
    id: "AFTERPARTY_COMEDOWN",
    label: "Afterparty / 4am comedown",
    emotions: ["tired", "euphoric residue", "reflective", "still high", "tender"],
    energy: { min: 0.12, max: 0.50, target: 0.28 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rnb", weight: 0.80 },
      { genre: "soul", weight: 0.72 },
      { genre: "indie", weight: 0.65 },
      { genre: "pop", weight: 0.50 },
      { genre: "hip_hop", weight: 0.42 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["country", "folk", "classical", "metal", "reggae", "christmas"],
    aesthetics: ["afterparty", "4am", "comedown", "soft light", "kitchen floor", "tired but alive", "gentle"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "the party is ending", core: "4am kitchen glow", peak: "quiet euphoria", cooldown: "sun coming up" },
  },

  // ── Roots / Rural ─────────────────────────────────────────────────────────

  BLUEGRASS_MOUNTAIN: {
    id: "BLUEGRASS_MOUNTAIN",
    label: "Bluegrass / Appalachian mountain",
    emotions: ["grounded", "free", "nostalgic", "communal", "rugged"],
    energy: { min: 0.28, max: 0.72, target: 0.50 },
    genreEcosystem: [
      { genre: "country", weight: 1.0 },
      { genre: "folk", weight: 0.95 },
      { genre: "blues", weight: 0.70 },
      { genre: "rock", weight: 0.50 },
      { genre: "indie", weight: 0.35 },
    ],
    ecosystemFloor: 0.78,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae", "pop", "classical"],
    aesthetics: ["bluegrass", "banjo", "mountain", "Appalachian", "porch", "hollers", "roots music"],
    compositionTarget: { primaryMin: 0.82, adjacentMax: 0.15, otherMax: 0.03 },
    flowPhases: { intro: "morning mountain air", core: "roots picking session", peak: "foot stomping peak", cooldown: "porch evening quiet" },
  },

  SOUTHERN_ROCK_HIGHWAY: {
    id: "SOUTHERN_ROCK_HIGHWAY",
    label: "Southern rock highway",
    emotions: ["defiant", "free", "rugged", "electric", "nostalgic"],
    energy: { min: 0.42, max: 0.85, target: 0.65 },
    genreEcosystem: [
      { genre: "rock", weight: 1.0 },
      { genre: "country", weight: 0.80 },
      { genre: "blues", weight: 0.78 },
      { genre: "folk", weight: 0.55 },
      { genre: "indie", weight: 0.38 },
    ],
    ecosystemFloor: 0.74,
    antiGenres: ["electronic", "hip_hop", "rnb", "latin", "reggae", "classical", "christmas"],
    aesthetics: ["southern rock", "highway", "guitar riff", "dual guitars", "freedom", "heartland drive"],
    compositionTarget: { primaryMin: 0.76, adjacentMax: 0.20, otherMax: 0.04 },
    flowPhases: { intro: "open highway approach", core: "southern rock drive", peak: "guitar anthem peak", cooldown: "sunset cruise out" },
  },

  // ── Bedroom / Chill ───────────────────────────────────────────────────────

  INDIE_BEDROOM_LOFI: {
    id: "INDIE_BEDROOM_LOFI",
    label: "Bedroom / lo-fi chill",
    emotions: ["cosy", "introverted", "calm", "nostalgic", "gentle"],
    energy: { min: 0.08, max: 0.40, target: 0.22 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "electronic", weight: 0.80 },
      { genre: "folk", weight: 0.72 },
      { genre: "pop", weight: 0.60 },
      { genre: "jazz", weight: 0.50 },
      { genre: "rnb", weight: 0.42 },
    ],
    ecosystemFloor: 0.62,
    antiGenres: ["metal", "hip_hop", "country", "latin", "reggae", "classical", "christmas"],
    aesthetics: ["bedroom", "lo-fi", "chill", "cosy", "bedroom pop", "lazy afternoon", "soft focus", "headphones"],
    compositionTarget: { primaryMin: 0.64, adjacentMax: 0.28, otherMax: 0.08 },
    flowPhases: { intro: "settling into the room", core: "bedroom afternoon drift", peak: "soft headphone moment", cooldown: "dozing off" },
  },

  LATE_NIGHT_THOUGHTS: {
    id: "LATE_NIGHT_THOUGHTS",
    label: "Late night thoughts / can't sleep",
    emotions: ["introspective", "restless", "vulnerable", "honest", "quiet"],
    energy: { min: 0.08, max: 0.40, target: 0.22 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "folk", weight: 0.85 },
      { genre: "electronic", weight: 0.70 },
      { genre: "soul", weight: 0.65 },
      { genre: "pop", weight: 0.50 },
      { genre: "jazz", weight: 0.45 },
    ],
    ecosystemFloor: 0.62,
    antiGenres: ["metal", "hip_hop", "latin", "reggae", "country", "christmas"],
    aesthetics: ["late night", "darkness", "insomnia", "3am", "overthinking", "quiet", "honest thoughts"],
    compositionTarget: { primaryMin: 0.64, adjacentMax: 0.28, otherMax: 0.08 },
    flowPhases: { intro: "lights off, mind on", core: "3am spiral", peak: "raw honest moment", cooldown: "finally letting go" },
  },

  // ── Morning ───────────────────────────────────────────────────────────────

  SLOW_MORNING_COFFEE: {
    id: "SLOW_MORNING_COFFEE",
    label: "Slow morning / coffee ritual",
    emotions: ["peaceful", "gentle", "warm", "still", "grateful"],
    energy: { min: 0.10, max: 0.42, target: 0.24 },
    genreEcosystem: [
      { genre: "jazz", weight: 1.0 },
      { genre: "folk", weight: 0.88 },
      { genre: "indie", weight: 0.80 },
      { genre: "soul", weight: 0.72 },
      { genre: "pop", weight: 0.50 },
      { genre: "classical", weight: 0.45 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["metal", "hip_hop", "electronic", "latin", "reggae", "christmas"],
    aesthetics: ["morning", "coffee", "gentle light", "slow", "calm", "warm mug", "quiet kitchen"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "first light", core: "morning calm", peak: "quiet contentment", cooldown: "day begins" },
  },

  MORNING_RUN_SUNRISE: {
    id: "MORNING_RUN_SUNRISE",
    label: "Morning run / sunrise energy",
    emotions: ["energised", "alive", "clear", "determined", "free"],
    energy: { min: 0.58, max: 0.90, target: 0.74 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rock", weight: 0.85 },
      { genre: "indie", weight: 0.75 },
      { genre: "pop", weight: 0.65 },
      { genre: "hip_hop", weight: 0.55 },
    ],
    ecosystemFloor: 0.70,
    antiGenres: ["country", "folk", "classical", "jazz", "reggae", "christmas"],
    aesthetics: ["sunrise", "morning run", "early", "fresh air", "momentum", "clear head", "moving"],
    compositionTarget: { primaryMin: 0.72, adjacentMax: 0.22, otherMax: 0.06 },
    flowPhases: { intro: "first steps out the door", core: "finding the pace", peak: "sunrise push", cooldown: "cool-down walk home" },
  },

  // ── Rain / Weather ────────────────────────────────────────────────────────

  WALKING_RAIN_CITY: {
    id: "WALKING_RAIN_CITY",
    label: "Walking through a city in the rain",
    emotions: ["melancholic", "cinematic", "reflective", "solitary", "alive"],
    energy: { min: 0.18, max: 0.52, target: 0.33 },
    genreEcosystem: [
      { genre: "indie", weight: 1.0 },
      { genre: "electronic", weight: 0.82 },
      { genre: "jazz", weight: 0.78 },
      { genre: "soul", weight: 0.70 },
      { genre: "folk", weight: 0.60 },
      { genre: "rnb", weight: 0.52 },
    ],
    ecosystemFloor: 0.65,
    antiGenres: ["country", "metal", "hip_hop", "latin", "reggae", "christmas"],
    aesthetics: ["rain", "wet street", "city walk", "umbrella", "puddles", "grey sky", "cinematic"],
    compositionTarget: { primaryMin: 0.67, adjacentMax: 0.26, otherMax: 0.07 },
    flowPhases: { intro: "first drops", core: "walking in the downpour", peak: "soaking through", cooldown: "shelter found" },
  },

  TOKYO_RAIN_WALK: {
    id: "TOKYO_RAIN_WALK",
    label: "Walking through Tokyo in the rain",
    emotions: ["cinematic", "melancholic", "dreamy", "urban", "beautiful sadness"],
    energy: { min: 0.18, max: 0.55, target: 0.35 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "pop", weight: 0.88 },
      { genre: "jazz", weight: 0.80 },
      { genre: "soul", weight: 0.72 },
      { genre: "rnb", weight: 0.65 },
      { genre: "indie", weight: 0.55 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["country", "folk", "metal", "reggae", "latin", "christmas"],
    aesthetics: ["tokyo rain", "japan night", "neon reflection", "wet street", "city pop", "cinematic japan"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "shibuya in the rain", core: "walking through neon reflections", peak: "beautiful melancholy", cooldown: "train home" },
  },

  // ── Cultural / Era ────────────────────────────────────────────────────────

  EIGHTIES_UK_SYNTH: {
    id: "EIGHTIES_UK_SYNTH",
    label: "80s UK synth / new wave",
    emotions: ["nostalgic", "electric", "melancholic", "yearning", "cinematic"],
    energy: { min: 0.35, max: 0.80, target: 0.58 },
    genreEcosystem: [
      { genre: "electronic", weight: 1.0 },
      { genre: "rock", weight: 0.80 },
      { genre: "pop", weight: 0.75 },
      { genre: "indie", weight: 0.55 },
    ],
    ecosystemFloor: 0.72,
    antiGenres: ["country", "folk", "hip_hop", "metal", "reggae", "latin", "christmas"],
    aesthetics: ["synth-pop", "new wave", "80s UK", "Depeche Mode", "The Cure", "Joy Division", "cold wave", "reverb"],
    compositionTarget: { primaryMin: 0.74, adjacentMax: 0.20, otherMax: 0.06 },
    flowPhases: { intro: "cold synth opener", core: "new wave heartbeat", peak: "anthemic 80s peak", cooldown: "fade to reverb" },
  },

  // ── Outdoors / Social ─────────────────────────────────────────────────────

  CAMPFIRE_NIGHT: {
    id: "CAMPFIRE_NIGHT",
    label: "Campfire / bonfire night",
    emotions: ["warm", "communal", "nostalgic", "content", "free"],
    energy: { min: 0.22, max: 0.62, target: 0.42 },
    genreEcosystem: [
      { genre: "folk", weight: 1.0 },
      { genre: "country", weight: 0.88 },
      { genre: "indie", weight: 0.75 },
      { genre: "rock", weight: 0.68 },
      { genre: "blues", weight: 0.58 },
      { genre: "soul", weight: 0.45 },
    ],
    ecosystemFloor: 0.68,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "christmas"],
    aesthetics: ["campfire", "bonfire", "acoustic", "outdoor", "friends", "stars", "guitar around the fire"],
    compositionTarget: { primaryMin: 0.70, adjacentMax: 0.24, otherMax: 0.06 },
    flowPhases: { intro: "fire starting", core: "songs around the campfire", peak: "communal warmth peak", cooldown: "embers going out" },
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

  // ── Study / Focus ─────────────────────────────────────────────────────────
  {
    id: "STUDY_DEEP_FOCUS",
    patterns: [
      /\b(study|studying|revision|revising|deep.?focus|focus.{0,15}(music|playlist|session))\b/i,
      /\b(coding.{0,15}(music|playlist|session)|programming.{0,15}(music|flow|playlist))\b/i,
      /\b(reading.{0,15}(music|playlist|session)|concentration|focused.{0,15}(work|session))\b/i,
      /\b(pomodoro|flow.?state|in.?the.?zone|work.{0,15}(playlist|session|music))\b/i,
      /\b(library.{0,15}(session|music|vibe)|lo.?fi.{0,15}(study|focus|chill))\b/i,
    ],
    confidence: 0.88,
  },

  // ── Space / Cosmos ────────────────────────────────────────────────────────
  {
    id: "SPACE_COSMOS",
    patterns: [
      /\b(space.{0,20}(ambient|music|float|travel|journey|cosmos))\b/i,
      /\b(cosmos|outer space|zero gravity|floating in space|drifting in space)\b/i,
      /\b(sci.?fi.{0,15}(ambient|soundtrack|music)|interstellar|galaxy.{0,15}(music|vibes))\b/i,
      /\b(orbital|satellite|astro.{0,15}(music|ambient|vibe)|star.{0,15}(field|gazing|music))\b/i,
    ],
    confidence: 0.88,
  },

  // ── Cyberpunk ─────────────────────────────────────────────────────────────
  {
    id: "CYBERPUNK_URBAN",
    patterns: [
      /\b(cyberpunk|blade runner|dystopia.{0,15}(music|city|vibe)|neo.?noir)\b/i,
      /\b(synthwave.{0,15}(dark|cyber|future|noir)|dark.{0,15}synthwave)\b/i,
      /\b(futuristic.{0,15}(city|urban|neon|music)|future.{0,15}(city|noir|dark))\b/i,
      /\b(neon.{0,15}(rain|dystopia|future|noir)|tech.?noir|megacity)\b/i,
    ],
    confidence: 0.90,
  },

  // ── Luxury / Ambition ─────────────────────────────────────────────────────
  {
    id: "LUXURY_AMBITION",
    patterns: [
      /\b(luxury.{0,20}(vibes|music|drive|car|playlist))\b/i,
      /\b(ambition|ambitious|success.{0,15}(drive|playlist|music)|boss.{0,15}(music|vibes))\b/i,
      /\b(penthouse|yacht.{0,15}(music|vibes)|private jet|money.{0,15}(music|vibes))\b/i,
      /\b(grind.{0,15}(music|playlist|session)|hustle.{0,15}(music|vibes|playlist))\b/i,
      /\b(motivation.{0,15}(success|wealth|ambition)|driven.{0,15}(music|energy|vibe))\b/i,
    ],
    confidence: 0.82,
  },

  // ── Adventure ─────────────────────────────────────────────────────────────
  {
    id: "ADVENTURE_MOUNTAINS",
    patterns: [
      /\b(mountain.{0,20}(hike|hiking|drive|road|summit|trail|climb))\b/i,
      /\b(hiking.{0,15}(music|playlist|trail)|trail.{0,15}(run|hike|music))\b/i,
      /\b(wilderness.{0,15}(music|vibes|adventure)|open.{0,15}wilderness)\b/i,
      /\b(summit|peak.{0,15}(music|vibes|adventure)|altitude.{0,15}(music|vibe))\b/i,
      /\b(backpack.{0,15}(trip|adventure|hike)|trek.{0,15}(music|adventure|trail))\b/i,
    ],
    confidence: 0.85,
  },

  // ── Healing / Hope ────────────────────────────────────────────────────────
  {
    id: "HEALING_AFTER_PAIN",
    patterns: [
      /\b(healing.{0,20}(music|playlist|after|from|journey))\b/i,
      /\b(recovering.{0,15}(from|after)|recovery.{0,15}(music|playlist|journey))\b/i,
      /\b(getting.{0,15}(better|through|over it)|slowly.{0,15}(healing|better|getting better))\b/i,
      /\b(tender.{0,15}(moment|music|feeling)|gentle.{0,15}(music|healing|time))\b/i,
    ],
    confidence: 0.82,
  },
  {
    id: "HOPE_NEW_CHAPTER",
    patterns: [
      /\b(new.{0,15}(chapter|beginning|start|page)|fresh.{0,15}start)\b/i,
      /\b(hope(ful)?|optimis(m|tic)|things (are|will).{0,15}(better|good))\b/i,
      /\b(turning.{0,10}(point|corner)|new.{0,15}(direction|path|journey))\b/i,
      /\b(starting over|starting again|beginning again|moving forward with hope)\b/i,
    ],
    confidence: 0.80,
  },

  // ── Regret ────────────────────────────────────────────────────────────────
  {
    id: "REGRET_REFLECTION",
    patterns: [
      /\b(regret.{0,20}(music|playlist|feeling|thinking|about))\b/i,
      /\b(what.{0,15}(could have been|might have been|should have been))\b/i,
      /\b(if only|wishing i|wish i (had|hadn't|could|didn't))\b/i,
      /\b(missed.{0,15}(opportunity|chance|moment)|roads not taken)\b/i,
    ],
    confidence: 0.82,
  },

  // ── Life Changing ─────────────────────────────────────────────────────────
  {
    id: "LIFE_IS_CHANGING",
    patterns: [
      /\b(life.{0,20}(is changing|feels different|feels like it|changing|at a crossroads))\b/i,
      /\b(music.{0,15}(feels like|that feels like).{0,20}life.{0,15}changing)\b/i,
      /\b(everything.{0,15}(is changing|feels different|is different now))\b/i,
      /\b(at a.{0,10}crossroads|pivotal.{0,10}moment|life.{0,10}transition)\b/i,
      /\b(growing up|coming of age|milestone|things are shifting)\b/i,
    ],
    confidence: 0.80,
  },

  // ── Life Moments ──────────────────────────────────────────────────────────
  {
    id: "SUMMER_BEFORE_UNI",
    patterns: [
      /\b(summer before (uni|university|college|school|moving))\b/i,
      /\b(last summer (of|before|as a).{0,20}(youth|young|school|teenager|high school))\b/i,
      /\b(summer.{0,20}(before everything changed|before you leave|before it all changes))\b/i,
      /\b(end of.{0,15}(school|summer|era|youth|chapter))\b/i,
      /\b(18th|freshers|moving.{0,10}(away|out|to uni)).{0,20}(music|playlist|vibe)\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "DRIVING_HOME_BREAKUP",
    patterns: [
      /\b(driving home.{0,20}(breakup|break.?up|split|after breaking up))\b/i,
      /\b(after.{0,20}(breakup|break.?up|splitting up).{0,20}(drive|driving|car|home))\b/i,
      /\b(driving.{0,20}after.{0,20}(she left|he left|they left|we broke up))\b/i,
      /\b(alone.{0,20}(car|drive|driving).{0,20}(breakup|heartbreak|ended))\b/i,
    ],
    confidence: 0.90,
  },

  // ── Festival / Afterparty ─────────────────────────────────────────────────
  {
    id: "FESTIVAL_SUMMER_FIELD",
    patterns: [
      /\b(music festival|outdoor festival|festival.{0,15}(field|crowd|summer|music|vibes))\b/i,
      /\b(glastonbury|reading festival|leeds festival|coachella|field.{0,15}(festival|stage))\b/i,
      /\b(main stage|headline act|festival crowd|tent.{0,15}(stage|music))\b/i,
      /\b(outdoor.{0,15}(music|gig|stage|crowd)|field.{0,15}(crowd|music|dancing))\b/i,
    ],
    confidence: 0.90,
  },
  {
    id: "AFTERPARTY_COMEDOWN",
    patterns: [
      /\b(afterparty|after.?party|post.?club|4am.{0,20}(music|vibe|feeling|kitchen))\b/i,
      /\b(after the (club|rave|party)|club.{0,15}(ended|over|done|finished))\b/i,
      /\b(comedown.{0,15}(music|vibe|feeling)|post.?rave|rave.{0,10}after)\b/i,
      /\b(5am.{0,20}(music|vibe|feeling)|dawn.{0,20}(music|vibe|after party))\b/i,
      /\b(kitchen.{0,15}(4am|afterparty|floor|chat)|floor.{0,15}(4am|afterparty))\b/i,
    ],
    confidence: 0.90,
  },

  // ── Roots ─────────────────────────────────────────────────────────────────
  {
    id: "BLUEGRASS_MOUNTAIN",
    patterns: [
      /\b(bluegrass|appalachian.{0,15}(music|mountain|folk))\b/i,
      /\b(banjo.{0,20}(music|song|tune|picking)|mountain.{0,15}(folk|music|picking))\b/i,
      /\b(old.?timey|old time.{0,10}music|roots.{0,15}(music|americana|folk))\b/i,
      /\b(string.?band|porch.{0,15}(music|picking|jam)|fiddle.{0,15}(music|tune|song))\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "SOUTHERN_ROCK_HIGHWAY",
    patterns: [
      /\b(southern rock|southern.{0,15}(highway|rock|drive|road))\b/i,
      /\b(lynyrd skynyrd|allman brothers|southern.{0,10}fried|dixie.{0,10}rock)\b/i,
      /\b(dual.?guitar|guitar.{0,15}(highway|drive|road|riff)|highway.{0,15}(rock|guitar|riff))\b/i,
      /\b(heartland.{0,15}(rock|drive|road|music)|southern.{0,10}blues.{0,10}rock)\b/i,
    ],
    confidence: 0.88,
  },

  // ── Bedroom / Lo-fi ───────────────────────────────────────────────────────
  {
    id: "INDIE_BEDROOM_LOFI",
    patterns: [
      /\b(bedroom.{0,20}(pop|music|vibes|chill|playlist))\b/i,
      /\b(lo.?fi.{0,20}(chill|hip.?hop|vibes|music|playlist|study))\b/i,
      /\b(lazy.{0,15}(afternoon|day|sunday|saturday).{0,15}(music|playlist|vibes))\b/i,
      /\b(cosy.{0,15}(music|playlist|vibes|room|bedroom)|chill.{0,10}room|indoor.{0,10}(music|vibes))\b/i,
      /\b(headphones?.{0,15}(music|vibes|chill|bedroom)|late.{0,10}afternoon.{0,10}(chill|room))\b/i,
    ],
    confidence: 0.82,
  },
  {
    id: "LATE_NIGHT_THOUGHTS",
    patterns: [
      /\b(late night.{0,20}(thoughts|thinking|overthinking|spiral|feels))\b/i,
      /\b(can'?t sleep|insomnia.{0,15}(music|playlist|vibes))\b/i,
      /\b(3am.{0,20}(thoughts|thinking|feels|music|vibe)|midnight.{0,15}(thoughts|thinking|spiral))\b/i,
      /\b(overthink.{0,15}(ing)?|lying.{0,15}awake|staring.{0,15}(at ceiling|ceiling))\b/i,
      /\b(night.{0,15}thoughts|dark.{0,15}thoughts.{0,15}(music|night|quiet))\b/i,
    ],
    confidence: 0.84,
  },

  // ── Morning ───────────────────────────────────────────────────────────────
  {
    id: "SLOW_MORNING_COFFEE",
    patterns: [
      /\b(slow.{0,15}morning|morning.{0,15}coffee.{0,15}(music|playlist|vibe))\b/i,
      /\b(coffee.{0,15}(morning|ritual|playlist|music)|morning.{0,15}ritual)\b/i,
      /\b(lazy.{0,15}morning|gentle.{0,15}morning|quiet.{0,15}morning)\b/i,
      /\b(sunday.{0,15}morning|saturday.{0,15}morning).{0,20}(coffee|quiet|slow|gentle)\b/i,
      /\b(waking up slow|easing into the day|first cup|morning calm)\b/i,
    ],
    confidence: 0.84,
  },
  {
    id: "MORNING_RUN_SUNRISE",
    patterns: [
      /\b(morning.{0,15}(run|jog|sprint|workout).{0,15}(music|playlist|energy))\b/i,
      /\b(sunrise.{0,15}(run|jog|workout|music|energy)|running.{0,15}at sunrise)\b/i,
      /\b(early.{0,15}(morning run|run|workout).{0,15}(music|playlist|energy))\b/i,
      /\b(5am.{0,15}(run|workout|morning|energy)|6am.{0,15}(run|workout|energy))\b/i,
    ],
    confidence: 0.86,
  },

  // ── Rain / Walk ───────────────────────────────────────────────────────────
  {
    id: "WALKING_RAIN_CITY",
    patterns: [
      /\b(walking.{0,20}(in the rain|through rain|in rain|under rain))\b/i,
      /\b(walk.{0,15}(in|through|under).{0,10}(rain|downpour|drizzle))\b/i,
      /\b(rainy.{0,15}(walk|stroll|city|streets)|walking.{0,15}wet.{0,15}(streets|city))\b/i,
      /\b(umbrella.{0,15}(walk|city|rain|music)|caught.{0,15}in.{0,10}rain)\b/i,
    ],
    confidence: 0.86,
  },
  {
    id: "TOKYO_RAIN_WALK",
    patterns: [
      /\b(tokyo.{0,25}(rain|rainy|wet|walking|walk|in the rain))\b/i,
      /\b(walking.{0,25}(tokyo|japan).{0,20}rain)\b/i,
      /\b(japan.{0,25}(rain|rainy|wet street|walk))\b/i,
      /\b(shibuya.{0,20}(rain|wet|walking)|osaka.{0,20}(rain|wet|walking))\b/i,
    ],
    confidence: 0.92,
  },

  // ── Cultural ──────────────────────────────────────────────────────────────
  {
    id: "EIGHTIES_UK_SYNTH",
    patterns: [
      /\b(80s.{0,15}(uk|british|synth.?pop|new wave|post.?punk))\b/i,
      /\b(depeche.?mode|the cure|joy division|new order|echo.{0,5}bunnymen)\b/i,
      /\b(synth.?pop|new wave|cold.?wave|post.?punk).{0,20}(80s|eighties|british|uk)\b/i,
      /\b(80s.{0,10}(feel unreal|unreal feeling|ethereal|cinematic|atmospheric))\b/i,
      /\b(eighties.{0,15}(uk|brit|synth|new wave)|british.{0,10}80s)\b/i,
    ],
    confidence: 0.88,
  },

  // ── Outdoors / Social ─────────────────────────────────────────────────────
  {
    id: "CAMPFIRE_NIGHT",
    patterns: [
      /\b(campfire.{0,20}(music|songs|night|vibes|playlist))\b/i,
      /\b(bonfire.{0,20}(music|night|vibes|songs|playlist))\b/i,
      /\b(around.{0,10}(campfire|the fire|bonfire)|songs.{0,15}(campfire|around the fire))\b/i,
      /\b(camp.{0,10}(night|music|song|fire)|acoustic.{0,15}(campfire|outdoors|night))\b/i,
      /\b(outdoor.{0,15}(night|fire|guitar|acoustic)|stargazing.{0,15}(music|songs|playlist))\b/i,
    ],
    confidence: 0.86,
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
  /**
   * V10: weighted multi-scene vector, always 3–5 entries summing to 1.0.
   * Used for `sceneScore = Σ(weight × ecosystemAffinity)` in the scoring engine.
   * When input is weak (confidence < 0.5), entropy is spread across more scenes.
   */
  sceneVector: Array<{ id: string; weight: number }>;
  /** Up to 3 alternative scene matches ranked by confidence (excluding the primary) */
  alternatives: Array<{ id: string; label: string; confidence: number }>;
}

/**
 * V9.2 — scene category priority for conflict resolution.
 *
 * When multiple scenes match the same prompt, this priority order decides
 * the winner if confidence scores are tied (within 0.05).
 * Priority: Road/Outdoor > Urban/Night > Nostalgia/Warm > Chill/Focus > Energy/Motion > Other
 *
 * V9.2 rules:
 *   - Pick ONE dominant axis, never blend or average
 *   - Decorative language (cinematic, aesthetic, vibes, dreamy) does NOT affect scene
 *   - Modifiers (calm, chill, dark) only adjust confidence, NOT scene category
 */
const SCENE_CATEGORY_PRIORITY: Record<string, number> = {
  // Road / Outdoor (priority 1 — highest)
  DIRT_ROAD_SUNSET: 1,
  DOG_ON_DIRT_ROAD: 1,
  OUTLAW_COUNTRY: 1,
  RURAL_FARM_ROAD: 1,
  COMING_HOME: 1,
  BACKROAD_HIGHWAY: 1,
  BLUEGRASS_MOUNTAIN: 1,
  SOUTHERN_ROCK_HIGHWAY: 1,
  ADVENTURE_MOUNTAINS: 1,
  DRIVING_SOMEWHERE_NOWHERE: 1,
  SUNSET_FIELDS: 1,
  SUMMER_FIELD_GOLDEN_HOUR: 1,
  CAMPFIRE_NIGHT: 1,
  // Urban / Night (priority 2)
  PETROL_STATION_2AM: 2,
  EMPTY_MOTORWAY_NIGHT: 2,
  CITY_AFTER_MIDNIGHT: 2,
  NEON_STREETS: 2,
  RAINY_CITY_LIGHTS: 2,
  TOKYO_NEON_NIGHT: 2,
  CYBERPUNK_URBAN: 2,
  WALKING_RAIN_CITY: 2,
  TOKYO_RAIN_WALK: 2,
  LATE_NIGHT_THOUGHTS: 2,
  DRIVING_HOME_BREAKUP: 2,
  // Nostalgia / Warm (priority 3)
  NOSTALGIA: 3,
  THINKING_ABOUT_LIFE: 3,
  HEARTBREAK: 3,
  SUMMER_BEFORE_UNI: 3,
  JAPANESE_CITY_POP: 3,
  REGRET_REFLECTION: 3,
  LIFE_IS_CHANGING: 3,
  HOPE_NEW_CHAPTER: 3,
  HEALING_AFTER_PAIN: 3,
  SLOW_MORNING_COFFEE: 3,
  TRAIN_JOURNEY: 3,
  AIRPORT_WAITING: 3,
  // Chill / Focus (priority 4)
  STUDY_DEEP_FOCUS: 4,
  DREAMY_ETHEREAL: 4,
  INDIE_BEDROOM_LOFI: 4,
  SPACE_COSMOS: 4,
  MORNING_RUN_SUNRISE: 4,
  AFTERPARTY_COMEDOWN: 4,
  // Energy / Motion (priority 5 — lowest tiebreaker)
  WORKOUT_INTENSITY: 5,
  PARTY_SOCIAL_NIGHT: 5,
  RAVE_90S_UK: 5,
  FESTIVAL_SUMMER_FIELD: 5,
  EIGHTIES_UK_SYNTH: 5,
  LUXURY_AMBITION: 5,
  TOKYO_NEON_NIGHT_ENERGY: 5,
};

/** Confidence delta within which category priority is used as a tiebreaker (V9.2) */
const PRIORITY_TIEBREAK_DELTA = 0.05;

/**
 * V10 broad defaults — used when no scene matches or as padding to reach 3 scenes.
 * Represent the most genre-neutral, broadly applicable scenes in the taxonomy.
 * Priority: emotionally neutral first, then energy-based.
 */
const BROAD_DEFAULT_SCENES: Array<{ id: string; baseWeight: number }> = [
  { id: "NOSTALGIA", baseWeight: 0.40 },
  { id: "INDIE_BEDROOM_LOFI", baseWeight: 0.35 },
  { id: "THINKING_ABOUT_LIFE", baseWeight: 0.25 },
];

/**
 * Build the V10 scene vector from a sorted list of matches.
 * Always produces 3–5 entries summing to 1.0.
 *
 * Entropy expansion rule (V10):
 *   If primaryConfidence < 0.5, flatten the weight distribution so that
 *   secondary/tertiary scenes get more influence — "more scenes, not fallback".
 */
function buildSceneVector(
  sortedMatches: Array<{ id: string; confidence: number }>
): Array<{ id: string; weight: number }> {
  const primaryConf = sortedMatches[0]?.confidence ?? 0;
  const isWeakInput = primaryConf < 0.5;

  // Take up to 5 matches, assigning raw weights
  const top = sortedMatches.slice(0, 5);
  const rawEntries: Array<{ id: string; raw: number }> = top.map((m, i) => {
    // Entropy expansion: flatten distribution for weak inputs
    const base = isWeakInput
      ? m.confidence * 0.55 + (1 / (i + 1)) * 0.45
      : m.confidence;
    return { id: m.id, raw: base };
  });

  // Pad to minimum 3 scenes with broad defaults
  const existingIds = new Set(rawEntries.map((e) => e.id));
  for (const def of BROAD_DEFAULT_SCENES) {
    if (rawEntries.length >= 3) break;
    if (!existingIds.has(def.id) && SEMANTIC_SCENE_VECTORS[def.id]) {
      rawEntries.push({ id: def.id, raw: def.baseWeight * (isWeakInput ? 0.9 : 0.6) });
      existingIds.add(def.id);
    }
  }

  // Normalize to sum 1.0
  const total = rawEntries.reduce((s, e) => s + e.raw, 0);
  return rawEntries.map(({ id, raw }) => ({
    id,
    weight: total > 0 ? raw / total : 1 / rawEntries.length,
  }));
}

/**
 * Detect which semantic scenes apply to the vibe prompt.
 *
 * V9.2 / V10: Returns a deterministic primary scene PLUS a weighted multi-scene
 * vector of 3–5 scenes summing to 1.0 for use in the V10 scoring engine.
 *
 * Tiebreak order (V9.2): Road/Outdoor > Urban/Night > Nostalgia/Warm > Chill/Focus > Energy/Motion
 * Entropy expansion (V10): weak input (confidence < 0.5) spreads weight across more scenes.
 * Zero-match (V10): returns broad default scene vector — NEVER returns "no scene".
 */
export function resolveSemanticScene(
  vibe: string,
  profile: EmotionProfile
): SemanticSceneResolution {
  // Collect all matches with their confidence scores
  const matches: { id: string; confidence: number }[] = [];

  for (const entry of SCENE_DETECTION_PATTERNS) {
    if (entry.patterns.some((re) => re.test(vibe))) {
      matches.push({ id: entry.id, confidence: entry.confidence });
    }
  }

  // V10: Never return "no scene" — always produce a scene vector
  if (matches.length === 0) {
    const defaultVector = BROAD_DEFAULT_SCENES
      .filter((d) => SEMANTIC_SCENE_VECTORS[d.id])
      .map((d) => ({ id: d.id, weight: d.baseWeight }));
    const total = defaultVector.reduce((s, d) => s + d.weight, 0);
    const sceneVector = defaultVector.map((d) => ({ ...d, weight: d.weight / total }));
    return {
      vector: null,
      confidence: 0,
      matchedId: null,
      sceneVector,
      alternatives: [],
    };
  }

  // V9.2: Sort by confidence descending, then by category priority ascending (lower = higher priority).
  matches.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > PRIORITY_TIEBREAK_DELTA) return confDiff;
    const prioA = SCENE_CATEGORY_PRIORITY[a.id] ?? 6;
    const prioB = SCENE_CATEGORY_PRIORITY[b.id] ?? 6;
    if (prioA !== prioB) return prioA - prioB;
    return confDiff;
  });

  const [primary, ...rest] = matches;

  // V10: Build multi-scene vector (3-5 scenes, sum to 1.0)
  const sceneVector = buildSceneVector(matches);

  // Build alternatives list (up to 3, deduplicated, with label)
  const alternatives = rest
    .slice(0, 3)
    .map(({ id, confidence }) => {
      const v = SEMANTIC_SCENE_VECTORS[id];
      return { id, label: v?.label ?? id.replace(/_/g, " "), confidence };
    });

  return {
    vector: SEMANTIC_SCENE_VECTORS[primary.id] ?? null,
    confidence: primary.confidence,
    matchedId: primary.id,
    sceneVector,
    alternatives,
  };
}

/**
 * V10 multi-scene ecosystem score.
 * Computes `sceneScore = Σ(sceneVector[i].weight × ecosystemAffinity[i])`.
 * This is the scene channel (30%) in the V10 3-factor scoring formula.
 */
export function computeMultiSceneEcosystemScore(
  classification: TrackGenreClassification,
  sceneVector: Array<{ id: string; weight: number }>
): number {
  if (sceneVector.length === 0) return 0.5;
  let score = 0;
  for (const { id, weight } of sceneVector) {
    const sv = SEMANTIC_SCENE_VECTORS[id];
    if (!sv) continue;
    score += weight * computeSemanticEcosystemScore(classification, sv);
  }
  return Math.min(1, score);
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
 * V11 soft negative match penalty.
 *
 * Anti-genre tracks receive a soft rank-down multiplier — they are NEVER removed.
 * V11 spec: all penalties are continuous, not binary. No track may receive a
 * multiplier below 0.35 (previously 0.08), preserving cross-genre diversity.
 *
 * The penalty shapes the ranking; the diversity engine handles final balance.
 */
export function computeNegativePenalty(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector
): number {
  const primary = classification.genrePrimary;
  const secondary = classification.genreSecondary;

  const primaryViolates = vector.antiGenres.includes(primary);
  const secondaryViolates = secondary ? vector.antiGenres.includes(secondary) : false;

  // V11: Soft penalties only — floor raised from 0.08 to 0.35
  // High-confidence anti-genre: soft rank-down, NOT near-exclusion
  if (primaryViolates && classification.confidenceScore >= 0.6) return 0.35;
  if (primaryViolates && classification.confidenceScore >= 0.4) return 0.50;
  if (primaryViolates) return 0.65;
  if (secondaryViolates) return 0.80;
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
// V11: Hard gate PERMANENTLY DISABLED — scene is an interpretability signal only.
// All tracks enter scoring; diversity enforced post-ranking via soft weighting.
export const ECOSYSTEM_HARD_GATE_CONFIDENCE = 9999;

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
 * Minimum ecosystem weight for a genre to qualify as a Level-2 adjacency bridge.
 * Genres at 0.30–0.49 are "direct bridges" — explicitly present in the ecosystem
 * but below the hard gate minimum. Used only when Level-1 (full gate) leaves < 30%
 * of the pool cap. Never used for genres absent from the ecosystem entirely.
 */
export const ECOSYSTEM_ADJACENCY_MIN_WEIGHT = 0.30;

/**
 * Level-2 adjacency bridge check.
 *
 * Returns true if the track's primary genre (or family) appears in the scene
 * ecosystem with weight ≥ ECOSYSTEM_ADJACENCY_MIN_WEIGHT AND is NOT a hard
 * anti-genre. Tracks that fail are excluded even during Level-2 expansion.
 *
 * This is strictly tighter than `!isHardAntiGenre`: a genre must be explicitly
 * listed in the ecosystem graph to pass — fuzzy similarity is not enough.
 *
 * Examples for OUTLAW_COUNTRY:
 *   country  (1.00) → bridge eligible
 *   folk     (0.78) → bridge eligible
 *   blues    (0.70) → bridge eligible
 *   rock     (0.65) → bridge eligible
 *   indie    (0.35) → bridge eligible (in ecosystem, above 0.30)
 *   pop      (0.10) → NOT eligible (in ecosystem but below 0.30)
 *   hip_hop  (anti) → NOT eligible (anti-genre, always blocked)
 *   jazz     (none) → NOT eligible (absent from ecosystem entirely)
 */
export function isEcosystemAdjacent(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector,
): boolean {
  if (classification.genrePrimary === "unknown") return true;
  if (vector.antiGenres.includes(classification.genrePrimary)) return false;

  const genre = classification.genrePrimary;
  const family = classification.genreFamily;

  for (const { genre: g, weight } of vector.genreEcosystem) {
    if ((g === genre || g === family) && weight >= ECOSYSTEM_ADJACENCY_MIN_WEIGHT) {
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

// ── Scene Distribution API (spec §3) ─────────────────────────────────────────

export interface SceneDistributionEntry {
  sceneId: string;
  label: string;
  weight: number;
}

/**
 * resolveSceneDistribution — replaces single-scene resolveSemanticScene output
 * with a weighted multi-scene distribution (spec §3).
 *
 * Rules:
 *   - Always returns 3–5 entries summing to 1.0
 *   - Low confidence → broadens distribution breadth instead of falling back
 *   - Never collapses to a single scene
 */
export function resolveSceneDistribution(
  vibe: string,
  profile: EmotionProfile
): SceneDistributionEntry[] {
  const resolution = resolveSemanticScene(vibe, profile);
  return resolution.sceneVector.map(({ id, weight }) => ({
    sceneId: id,
    label: SEMANTIC_SCENE_VECTORS[id]?.label ?? id.replace(/_/g, " ").toLowerCase(),
    weight,
  }));
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
