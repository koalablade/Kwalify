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
    ecosystemFloor: 0.70,
    antiGenres: ["electronic", "metal", "hip_hop", "rnb", "latin", "reggae"],
    aesthetics: ["golden hour", "dust", "warm air", "open landscape", "Americana", "analog warmth"],
  },

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
    ecosystemFloor: 0.65,
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
    ecosystemFloor: 0.65,
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
    ecosystemFloor: 0.70,
    antiGenres: ["country", "folk", "metal", "latin", "reggae", "christmas"],
    aesthetics: ["jazzhop", "neo soul", "urban", "cinematic", "wet streets", "neon reflections"],
  },

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
    ecosystemFloor: 0.65,
    antiGenres: ["country", "folk", "metal", "latin", "reggae", "christmas"],
    aesthetics: ["city at night", "urban", "liminal", "ambient", "lo-fi", "street lights"],
  },
};

const SCENE_DETECTION_PATTERNS: {
  id: string;
  patterns: RegExp[];
  confidence: number;
}[] = [
  {
    id: "DIRT_ROAD_SUNSET",
    patterns: [
      /\b(dirt road|country road|dusty road|gravel road)\b/i,
      /\b(sunset|golden hour|dusk).{0,40}(road|drive|field|rural|country|farm)\b/i,
      /\b(rural|countryside|heartland|farmland|open road).{0,40}(sunset|dusk|golden|warm)\b/i,
      /\b(americana|outlaw country|southern.{0,15}rock)\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "PETROL_STATION_2AM",
    patterns: [
      /\b(petrol station|gas station).{0,30}(2am|3am|late night|midnight|night)\b/i,
      /\b(2am|3am).{0,30}(petrol|gas station|garage|forecourt)\b/i,
    ],
    confidence: 0.95,
  },
  {
    id: "EMPTY_MOTORWAY_NIGHT",
    patterns: [
      /\b(empty motorway|empty highway|motorway at night|highway at night)\b/i,
      /\b(motorway|highway).{0,25}(midnight|2am|late night|empty|alone|dark)\b/i,
      /\b(night drive|driving at night|driving home.{0,20}night)\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "RAINY_CITY_LIGHTS",
    patterns: [
      /\b(rainy city|rain.{0,15}city|city.{0,15}rain)\b/i,
      /\b(rain).{0,30}(lights|neon|street|window|glass|city)\b/i,
      /\b(jazzhop|neo soul|rainy.{0,15}day|city lights|wet streets)\b/i,
    ],
    confidence: 0.85,
  },
  {
    id: "SUMMER_FIELD_GOLDEN_HOUR",
    patterns: [
      /\b(summer.{0,20}(field|meadow|grass|countryside|evening))\b/i,
      /\b(golden hour|golden light).{0,30}(summer|field|countryside|open)\b/i,
      /\b(festival sunset|indie folk|pastoral|open field)\b/i,
    ],
    confidence: 0.82,
  },
  {
    id: "DRIVING_SOMEWHERE_NOWHERE",
    patterns: [
      /\bdriving somewhere (you|i|we) don'?t need\b/i,
      /\b(aimless|nowhere to be|no destination|just driving|driving for the sake)\b/i,
      /\b(windows down).{0,25}(road|driving|cruise)\b/i,
    ],
    confidence: 0.88,
  },
  {
    id: "CITY_AFTER_MIDNIGHT",
    patterns: [
      /\b(city after midnight|walking.{0,20}city.{0,20}(midnight|night|late))\b/i,
      /\b(empty city|dead city|quiet city|city at.{0,10}(midnight|night|dawn))\b/i,
      /\b(after midnight).{0,30}(city|street|walk|urban)\b/i,
    ],
    confidence: 0.87,
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
 */
export function computeNegativePenalty(
  classification: TrackGenreClassification,
  vector: SemanticSceneVector
): number {
  const primary = classification.genrePrimary;
  const secondary = classification.genreSecondary;

  const primaryViolates = vector.antiGenres.includes(primary);
  const secondaryViolates = secondary ? vector.antiGenres.includes(secondary) : false;

  if (primaryViolates && classification.confidenceScore >= 0.5) return 0.15;
  if (primaryViolates) return 0.40;
  if (secondaryViolates) return 0.72;
  return 1.0;
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
