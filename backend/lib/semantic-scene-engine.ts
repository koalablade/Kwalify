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
    ],
    confidence: 0.94,
  },
  {
    id: "DOG_ON_DIRT_ROAD",
    patterns: [
      /\b(dog.{0,25}(dirt road|road|field|country)|dirt road.{0,25}dog)\b/i,
      /\b(dog.{0,20}(morning|afternoon|sun|warm|grass|farm|field))\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "DIRT_ROAD_SUNSET",
    patterns: [
      /\b(dirt road|country road|dusty road|gravel road)\b/i,
      /\b(sunset|golden hour|dusk).{0,40}(road|drive|field|rural|country|farm)\b/i,
      /\b(rural|countryside|heartland|farmland|open road).{0,40}(sunset|dusk|golden|warm)\b/i,
      /\b(americana|southern.{0,15}rock)\b/i,
    ],
    confidence: 0.92,
  },
  {
    id: "RURAL_FARM_ROAD",
    patterns: [
      /\b(farm road|country lane|rural road|open road.{0,20}(country|rural|field|farm))\b/i,
      /\b(farmland|countryside|open fields|rural.{0,20}(drive|ride|walk))\b/i,
    ],
    confidence: 0.85,
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
    id: "CITY_AFTER_MIDNIGHT",
    patterns: [
      /\b(city after midnight|walking.{0,20}city.{0,20}(midnight|night|late))\b/i,
      /\b(empty city|dead city|quiet city|city at.{0,10}(midnight|night|dawn))\b/i,
      /\b(after midnight).{0,30}(city|street|walk|urban)\b/i,
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
    id: "SUNSET_FIELDS",
    patterns: [
      /\b(sunset.{0,20}(field|fields|meadow|countryside)|field.{0,20}(sunset|dusk|evening))\b/i,
      /\b(open sky|wide open|horizon.{0,20}(sunset|dusk|golden))\b/i,
    ],
    confidence: 0.83,
  },

  // ── Travel ───────────────────────────────────────────────────────────────
  {
    id: "TRAIN_JOURNEY",
    patterns: [
      /\b(train journey|train ride|on a train|train window|watching.{0,15}pass.{0,15}train)\b/i,
      /\b(rail|railway|train station|platform.{0,20}(wait|depart|arrive))\b/i,
    ],
    confidence: 0.90,
  },
  {
    id: "AIRPORT_WAITING",
    patterns: [
      /\b(airport.{0,20}(wait|lounge|terminal|gate|departure|morning|night))\b/i,
      /\b(waiting.{0,20}(airport|flight|departure|gate)|departure lounge)\b/i,
    ],
    confidence: 0.90,
  },

  // ── Reflection / Emotional ───────────────────────────────────────────────
  {
    id: "HEARTBREAK",
    patterns: [
      /\b(heartbreak|heartbroken|broken heart|just broke.{0,10}up|breakup|break up|split up)\b/i,
      /\b(she left|he left|they left|missing (her|him|them)|can'?t stop thinking about)\b/i,
    ],
    confidence: 0.90,
  },
  {
    id: "NOSTALGIA",
    patterns: [
      /\b(nostalgia|nostalgic|reminiscing|throwback|old times|when i was (young|a kid))\b/i,
      /\b(childhood memory|growing up|remember when|back in the day|used to listen)\b/i,
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

  // ── Subculture / Genre-specific ──────────────────────────────────────────
  {
    id: "RAVE_90S_UK",
    patterns: [
      /\b(90s.{0,10}(rave|uk rave|acid house|drum.{0,5}bass|gabber)|uk rave|acid house)\b/i,
      /\b(warehouse (rave|party)|rave culture|old skool rave|jungle music|old school rave)\b/i,
      /\b(breakbeat|happy hardcore|hardcore rave|gabba|supersaw)\b/i,
    ],
    confidence: 0.95,
  },
  {
    id: "JAPANESE_CITY_POP",
    patterns: [
      /\b(japanese city pop|city pop|j-?pop.{0,20}(80s|retro|vintage)|japanese.{0,20}(80s|retro|funk|pop))\b/i,
      /\b(plastic love|tatsuro yamashita|mariya takeuchi|anri|miki matsubara)\b/i,
      /\b(city pop aesthetic|japanese 80s|retro futur.{0,10}japan)\b/i,
    ],
    confidence: 0.95,
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
