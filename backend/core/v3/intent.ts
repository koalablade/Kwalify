import { getGenreFamily } from "./global-diversity-controller";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_ERA_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  termRegex,
} from "../../lib/expanded-intent-vocabulary";

export interface LockedIntent {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  mood: string[];
  activity: string | null;
  energy: "low" | "medium" | "high" | null;
  sceneIntent?: SceneIntent | null;
}

export interface SceneLatentVector {
  energy: number;
  valence: number;
  nostalgia: number;
  tension: number;
  motion: number;
  introspection: number;
  warmth: number;
  darkness: number;
  socialness: number;
  clarity: number;
}

export interface VibeMixture {
  vectors: SceneLatentVector[];
  weights: number[];
}

export interface ScenePrototype {
  id: string;
  centroidVector: SceneLatentVector;
}

export interface SceneIntent {
  momentType: string;
  emotionVector: {
    nostalgia: number;
    restlessness: number;
    joy: number;
    tension: number;
    calm: number;
  };
  energyArc: {
    start: number;
    mid: number;
    end: number;
    volatility: number;
  };
  contextWorld: {
    physical: "car" | "bedroom" | "outdoors" | "social" | "work" | "transit";
    time: "morning" | "afternoon" | "evening" | "late_night";
    motion: "static" | "moving" | "driving" | "walking";
  };
  intentDriver: "reflection" | "escape" | "focus" | "memory" | "energy" | "processing";
  genreRoles: {
    anchor: string;
    satellites: string[];
  };
  sceneVector: SceneLatentVector;
  stableVibeVector: SceneLatentVector;
  sceneConfidence: number;
  fallbackMode: "latent" | "balanced_latent_centroid";
  prototypeAffinities: Record<string, number>;
  sceneEmbedding: number[];
}

export interface LockedIntentFallbacks {
  genreFamilies?: string[];
  eraRange?: { start: number; end: number } | null;
  mood?: string[];
  activity?: string | null;
  energy?: "low" | "medium" | "high" | null;
  sceneIntent?: SceneIntent | null;
}

export const ROOT_GENRE_FAMILIES = [
  "country",
  "hip_hop",
  "rock",
  "electronic",
  "jazz",
  "pop",
  "folk",
  "soul",
  "metal",
  "classical",
  "christmas",
  "indie",
  "blues",
  "rnb",
  "reggae",
  "latin",
  "soundtrack",
  "world",
] as const;

const ROOT_GENRE_FAMILY_SET = new Set<string>(ROOT_GENRE_FAMILIES);
const SCENE_EMBEDDING_DIMS = 24;

export const GENRE_ALIASES: Array<{ family: string; terms: string[] }> = [
  { family: "country", terms: ["country", "americana", "alt-country", "alt country", "bluegrass", "western", "honky tonk", "outlaw", "outlaw country", "red dirt", "nashville", "country pop", "classic country"] },
  { family: "hip_hop", terms: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "boom-bap", "old school rap", "g-funk", "melodic rap", "emo rap"] },
  { family: "rock", terms: ["rock", "indie rock", "indie-rock", "alt rock", "alternative rock", "classic rock", "grunge", "punk", "punk rock", "hard rock", "post-rock", "post rock", "emo", "shoegaze"] },
  { family: "electronic", terms: ["electronic", "house", "house music", "techno", "trance", "edm", "dnb", "drum and bass", "drum & bass", "rave", "dubstep", "ambient", "synthwave", "retrowave", "jungle"] },
  { family: "jazz", terms: ["jazz", "soul jazz", "lo-fi jazz", "lofi jazz", "bebop", "bossa nova", "swing", "smooth jazz", "vocal jazz", "latin jazz"] },
  { family: "pop", terms: ["pop", "dance pop", "dance-pop", "indie pop", "synthpop", "synth pop", "synth-pop", "k-pop", "kpop", "teen pop", "boy band", "girl group"] },
  { family: "folk", terms: ["folk", "singer-songwriter", "singer songwriter", "acoustic folk", "traditional folk", "celtic folk", "irish folk"] },
  { family: "soul", terms: ["soul", "funk", "motown", "neo soul", "neo-soul", "detroit soul", "gospel"] },
  { family: "metal", terms: ["metal", "metalcore", "heavy metal", "death metal", "black metal", "thrash", "thrash metal", "nu metal", "nu-metal", "deathcore"] },
  { family: "classical", terms: ["classical", "orchestral", "piano classical", "symphony", "concerto", "nocturne", "sonata", "opera", "chamber", "baroque"] },
  { family: "christmas", terms: ["christmas", "xmas", "holiday", "holiday song", "festive", "noel", "santa", "jingle bells", "winter wonderland"] },
  { family: "indie", terms: ["indie", "indie music", "lo-fi", "lofi", "chillhop", "bedroom pop", "alternative indie", "study beats"] },
  { family: "blues", terms: ["blues", "delta blues", "chicago blues", "electric blues", "acoustic blues", "blues rock", "blues-rock"] },
  { family: "rnb", terms: ["r&b", "rnb", "classic r&b", "contemporary r&b", "alternative r&b", "alt rnb", "new jack swing"] },
  { family: "reggae", terms: ["reggae", "roots reggae", "dub", "dancehall", "rocksteady", "ragga"] },
  { family: "latin", terms: ["latin", "reggaeton", "salsa", "bachata", "merengue", "cumbia", "latin pop", "latin trap", "spanish pop"] },
  { family: "soundtrack", terms: ["soundtrack", "film score", "cinematic", "tv soundtrack", "series ost", "game soundtrack", "original motion picture"] },
  { family: "world", terms: ["world", "world music", "afrobeats", "afrobeat", "afropop", "amapiano", "highlife", "middle eastern", "arabic pop", "turkish pop"] },
].map((alias) => ({
  ...alias,
  terms: [
    ...alias.terms,
    ...(EXPANDED_GENRE_ALIASES.find((extra) => extra.family === alias.family)?.terms ?? []),
  ],
}));

const GENRE_EXCLUSION_RE = /\b(?:no|without|exclude|excluding|not)\s+([a-z0-9&\-\s]{2,28})/gi;

const ERA_BUCKET_RANGES: Record<string, { start: number; end: number }> = {
  "60s": { start: 1960, end: 1969 },
  "70s": { start: 1970, end: 1979 },
  "80s": { start: 1980, end: 1989 },
  "90s": { start: 1990, end: 1999 },
  "00s": { start: 2000, end: 2009 },
  "10s": { start: 2010, end: 2019 },
  "20s": { start: 2020, end: 2029 },
};

function matchesTerm(input: string, term: string): boolean {
  return termRegex([term]).test(input);
}

function termMatchIndex(input: string, term: string): number {
  const match = termRegex([term]).exec(input);
  return match?.index ?? -1;
}

function parseEra(input: string): { start: number; end: number } | null {
  for (const era of EXPANDED_ERA_TERMS) {
    if (termRegex(era.terms).test(input)) return { start: era.start, end: era.end };
  }
  const decade = input.match(/\b(60s|70s|80s|90s|00s|10s|20s|1960s|1970s|1980s|1990s|2000s|2010s|2020s)\b/i)?.[1];
  if (decade) {
    const start = decade.length === 4
      ? Number(`${decade.slice(0, 3)}0`)
      : decade === "00s" ? 2000 : decade === "10s" ? 2010 : decade === "20s" ? 2020 : Number(`19${decade.slice(0, 2)}`);
    return { start, end: start + 9 };
  }

  const range = input.match(/\b(19\d{2}|20\d{2})\s*(?:-|to|through|until)\s*(19\d{2}|20\d{2})\b/i);
  if (range?.[1] && range[2]) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start <= 19) return { start, end };
    const midpoint = Math.round((start + end) / 2);
    const decadeStart = Math.floor(midpoint / 10) * 10;
    return { start: decadeStart - 10, end: decadeStart + 9 };
  }

  const year = input.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return year ? { start: Number(year), end: Number(year) } : null;
}

function expandedMoodTerms(input: string): string[] {
  return Object.entries(EXPANDED_MOOD_TERMS)
    .filter(([, terms]) => termRegex(terms).test(input))
    .map(([mood]) => mood);
}

function expandedActivity(input: string): string | null {
  const hit = Object.entries(EXPANDED_ACTIVITY_TERMS)
    .find(([, terms]) => termRegex(terms).test(input))?.[0] ?? null;
  if (hit === "workout") return "gym";
  if (hit === "travel") return "walking";
  if (hit === "sleep") return "relaxing";
  return hit;
}

function parseEnergy(input: string): LockedIntent["energy"] {
  if (termRegex(["gym", "workout", "high energy", "intense", "party", "rave", "running", "buzzing", "gassed", "pres", "pre drinks", "night out", "five a side"]).test(input)) {
    return "high";
  }
  if (termRegex(["chill", "relax", "sleep", "ambient", "calm", "study", "focus", "soft", "low energy", "chilled", "peaceful"]).test(input)) {
    return "low";
  }
  if (termRegex(["driving", "walking", "commute", "medium energy", "steady", "motorway", "train", "tube"]).test(input)) {
    return "medium";
  }
  return null;
}

export function eraRangeFromBucket(bucket?: string | null): { start: number; end: number } | null {
  return bucket ? ERA_BUCKET_RANGES[bucket] ?? null : null;
}

export function normalizeLockedGenreFamily(value?: string | null): string | null {
  if (!value || value === "unknown") return null;
  const normalized = value.toLowerCase();
  if (ROOT_GENRE_FAMILY_SET.has(normalized)) return normalized;
  return getGenreFamily(normalized);
}

function uniqueGenreFamilies(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const family = normalizeLockedGenreFamily(value);
    if (!family || seen.has(family)) continue;
    seen.add(family);
    out.push(family);
  }
  return out;
}

function excludedGenreFamilies(input: string): Set<string> {
  const excluded = new Set<string>();
  for (const match of input.matchAll(GENRE_EXCLUSION_RE)) {
    const phrase = match[1] ?? "";
    for (const { family, terms } of GENRE_ALIASES) {
      if (terms.some((term) => matchesTerm(phrase, term))) {
        excluded.add(family);
      }
    }
  }
  return excluded;
}

function parseGenreFamilies(input: string): string[] {
  const excluded = excludedGenreFamilies(input);
  const matches = GENRE_ALIASES
    .map(({ family, terms }) => {
      const hitCount = terms.filter((term) => matchesTerm(input, term)).length;
      const directFamilyHit = matchesTerm(input, family) ? 2 : 0;
      const hitIndexes = [
        ...terms.map((term) => termMatchIndex(input, term)),
        termMatchIndex(input, family),
      ].filter((index) => index >= 0);
      const firstTermIndex = hitIndexes.length > 0
        ? Math.min(...hitIndexes)
        : Number.MAX_SAFE_INTEGER;
      return {
        family,
        confidence: hitCount + directFamilyHit,
        firstIndex: firstTermIndex,
      };
    })
    .filter(({ family, confidence }) => confidence > 0 && !excluded.has(family))
    .sort((a, b) => b.confidence - a.confidence || a.firstIndex - b.firstIndex);

  return matches.map((match) => match.family);
}

function parseMatchedGenreTerms(input: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const { terms: aliases } of GENRE_ALIASES) {
    for (const term of aliases) {
      if (!matchesTerm(input, term) || seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
    }
  }
  return terms.sort((a, b) => termMatchIndex(input, a) - termMatchIndex(input, b));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function hashUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function addVectorSignal(vector: number[], key: string, weight: number): void {
  for (let i = 0; i < vector.length; i++) {
    vector[i] += hashUnit(`${key}:${i}`) * weight;
  }
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Math.round((value / magnitude) * 10000) / 10000);
}

const LATENT_KEYS: Array<keyof SceneLatentVector> = [
  "energy",
  "valence",
  "nostalgia",
  "tension",
  "motion",
  "introspection",
  "warmth",
  "darkness",
  "socialness",
  "clarity",
];

const BASE_SCENE_VECTOR: SceneLatentVector = {
  energy: 0.45,
  valence: 0.48,
  nostalgia: 0.18,
  tension: 0.20,
  motion: 0.20,
  introspection: 0.35,
  warmth: 0.35,
  darkness: 0.18,
  socialness: 0.22,
  clarity: 0.50,
};

const GLOBAL_SCENE_PRIOR: SceneLatentVector = {
  energy: 0.46,
  valence: 0.46,
  nostalgia: 0.30,
  tension: 0.26,
  motion: 0.34,
  introspection: 0.42,
  warmth: 0.38,
  darkness: 0.24,
  socialness: 0.24,
  clarity: 0.54,
};

const BALANCED_LATENT_CENTROID: SceneLatentVector = {
  energy: 0.44,
  valence: 0.44,
  nostalgia: 0.36,
  tension: 0.28,
  motion: 0.36,
  introspection: 0.52,
  warmth: 0.42,
  darkness: 0.30,
  socialness: 0.20,
  clarity: 0.58,
};

const SCENE_PROTOTYPES: ScenePrototype[] = [
  {
    id: "late_night_thinking",
    centroidVector: { energy: 0.24, valence: 0.26, nostalgia: 0.48, tension: 0.58, motion: 0.20, introspection: 0.86, warmth: 0.30, darkness: 0.82, socialness: 0.08, clarity: 0.28 },
  },
  {
    id: "driving_nowhere",
    centroidVector: { energy: 0.52, valence: 0.42, nostalgia: 0.42, tension: 0.38, motion: 0.90, introspection: 0.62, warmth: 0.46, darkness: 0.38, socialness: 0.12, clarity: 0.42 },
  },
  {
    id: "first_warm_day_after_winter",
    centroidVector: { energy: 0.58, valence: 0.78, nostalgia: 0.30, tension: 0.12, motion: 0.48, introspection: 0.28, warmth: 0.90, darkness: 0.06, socialness: 0.44, clarity: 0.72 },
  },
  {
    id: "cleaning_room_nostalgia",
    centroidVector: { energy: 0.42, valence: 0.38, nostalgia: 0.88, tension: 0.28, motion: 0.34, introspection: 0.76, warmth: 0.58, darkness: 0.28, socialness: 0.08, clarity: 0.56 },
  },
  {
    id: "focused_flow",
    centroidVector: { energy: 0.34, valence: 0.46, nostalgia: 0.10, tension: 0.18, motion: 0.10, introspection: 0.58, warmth: 0.26, darkness: 0.16, socialness: 0.04, clarity: 0.88 },
  },
  {
    id: "energy_release",
    centroidVector: { energy: 0.86, valence: 0.68, nostalgia: 0.08, tension: 0.34, motion: 0.72, introspection: 0.12, warmth: 0.42, darkness: 0.20, socialness: 0.82, clarity: 0.56 },
  },
];

const TOKEN_CONTRIBUTIONS: Array<{ pattern: RegExp; weight: number; vector: Partial<SceneLatentVector> }> = [
  { pattern: /\b(petrol station|gas station|service station)\b/, weight: 1.0, vector: { motion: 0.30, introspection: 0.35, darkness: 0.24, tension: 0.22, energy: -0.08, socialness: -0.18 } },
  { pattern: /\b(2\s?am|3\s?am|4\s?am|late.?night|midnight|after.?dark)\b/, weight: 1.0, vector: { darkness: 0.58, introspection: 0.34, energy: -0.22, tension: 0.22, socialness: -0.20, clarity: -0.12 } },
  { pattern: /\b(existential crisis|existential|crisis|spiral|overthinking|thinking about everything)\b/, weight: 1.0, vector: { tension: 0.52, introspection: 0.52, valence: -0.32, clarity: -0.26, darkness: 0.24 } },
  { pattern: /\b(drive|driving|road|highway|dirt.?road|cruise|car)\b/, weight: 1.0, vector: { motion: 0.58, energy: 0.12, introspection: 0.12, clarity: 0.06 } },
  { pattern: /\b(nowhere|aimless|no destination|don't need to be|dont need to be)\b/, weight: 1.0, vector: { motion: 0.26, introspection: 0.42, tension: 0.18, clarity: -0.20, socialness: -0.12 } },
  { pattern: /\b(rain|rainy|storm|thunder|wet road|drizzle)\b/, weight: 1.0, vector: { introspection: 0.28, darkness: 0.26, tension: 0.14, warmth: -0.12, valence: -0.10 } },
  { pattern: /\b(memory|memories|nostalg|remember|throwback|old photos?)\b/, weight: 1.0, vector: { nostalgia: 0.62, introspection: 0.32, warmth: 0.20, valence: -0.06 } },
  { pattern: /\b(cleaning|clean room|bedroom|room|laundry)\b/, weight: 0.9, vector: { clarity: 0.26, introspection: 0.24, motion: 0.12, socialness: -0.14 } },
  { pattern: /\b(first warm day|after winter|spring|sun comes back|golden|sunrise)\b/, weight: 1.0, vector: { warmth: 0.58, valence: 0.38, energy: 0.18, darkness: -0.28, clarity: 0.20 } },
  { pattern: /\b(sad|sadness|lonely|alone|heartbreak|blue|melanchol)\b/, weight: 1.0, vector: { valence: -0.34, introspection: 0.32, tension: 0.24, socialness: -0.20, darkness: 0.22 } },
  { pattern: /\b(calm|chill|soft|peaceful|ambient|sleep|relax)\b/, weight: 1.0, vector: { energy: -0.24, tension: -0.22, clarity: 0.14, warmth: 0.12, valence: 0.08 } },
  { pattern: /\b(hype|energ|intense|workout|gym|run|party|rave|dance)\b/, weight: 1.0, vector: { energy: 0.44, motion: 0.28, socialness: 0.36, tension: 0.12, introspection: -0.20 } },
  { pattern: /\b(study|focus|coding|work|deep work)\b/, weight: 1.0, vector: { clarity: 0.46, introspection: 0.22, energy: -0.08, socialness: -0.24, tension: -0.08 } },
  { pattern: /\b(warm|cozy|cosy|comfort|soft light)\b/, weight: 0.9, vector: { warmth: 0.42, valence: 0.16, tension: -0.12, darkness: -0.10 } },
];

function emptyLatentVector(): SceneLatentVector {
  return { ...BASE_SCENE_VECTOR };
}

function addLatentContribution(
  target: SceneLatentVector,
  contribution: Partial<SceneLatentVector>,
  weight: number,
): void {
  for (const key of LATENT_KEYS) {
    target[key] += (contribution[key] ?? 0) * weight;
  }
}

function normalizeLatentVector(vector: SceneLatentVector): SceneLatentVector {
  const magnitude = Math.sqrt(LATENT_KEYS.reduce((sum, key) => sum + vector[key] * vector[key], 0));
  if (magnitude === 0) return { ...BASE_SCENE_VECTOR };
  const normalized = {} as SceneLatentVector;
  for (const key of LATENT_KEYS) {
    normalized[key] = clamp01((vector[key] / magnitude) * 1.9);
  }
  return normalized;
}

function latentCosine(a: SceneLatentVector, b: SceneLatentVector): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (const key of LATENT_KEYS) {
    dot += a[key] * b[key];
    aMag += a[key] * a[key];
    bMag += b[key] * b[key];
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function sceneVectorSanityMerge(vector: SceneLatentVector): SceneLatentVector {
  const merged = { ...vector };
  const lowEnergyPressure = (merged.introspection + merged.darkness + merged.tension) / 3;
  if (merged.energy > 0.68 && lowEnergyPressure > 0.62) {
    merged.energy = clamp01(merged.energy * 0.62 + (1 - lowEnergyPressure) * 0.38);
  }
  const sadnessPressure = (merged.tension + merged.darkness + merged.introspection) / 3;
  if (merged.valence > 0.66 && sadnessPressure > 0.62) {
    merged.valence = clamp01(merged.valence * 0.55 + (1 - sadnessPressure) * 0.45);
  }
  if (merged.motion > 0.70 && merged.clarity > 0.78 && merged.introspection > 0.68) {
    merged.clarity = clamp01(merged.clarity * 0.72 + (1 - merged.motion) * 0.28);
  }
  if (merged.socialness > 0.65 && merged.introspection > 0.72) {
    merged.socialness = clamp01(merged.socialness * 0.70 + (1 - merged.introspection) * 0.30);
  }
  return merged;
}

function blendLatentVectors(
  parts: Array<{ vector: SceneLatentVector; weight: number }>,
): SceneLatentVector {
  const blended = emptyLatentVector();
  for (const key of LATENT_KEYS) blended[key] = 0;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return emptyLatentVector();
  for (const part of parts) {
    for (const key of LATENT_KEYS) {
      blended[key] += part.vector[key] * part.weight;
    }
  }
  for (const key of LATENT_KEYS) {
    blended[key] /= totalWeight;
  }
  return sceneVectorSanityMerge(normalizeLatentVector(blended));
}

function previousSceneMemoryVector(sceneVector: SceneLatentVector): SceneLatentVector {
  const nearest = SCENE_PROTOTYPES
    .map((prototype) => ({
      vector: prototype.centroidVector,
      score: latentCosine(sceneVector, prototype.centroidVector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  return blendLatentVectors(
    nearest.map((item, index) => ({
      vector: item.vector,
      weight: Math.max(0.05, item.score) * (index === 0 ? 0.7 : 0.3),
    }))
  );
}

function recenterSceneVector(sceneVector: SceneLatentVector): SceneLatentVector {
  return blendLatentVectors([
    { vector: sceneVector, weight: 0.65 },
    { vector: previousSceneMemoryVector(sceneVector), weight: 0.20 },
    { vector: GLOBAL_SCENE_PRIOR, weight: 0.15 },
  ]);
}

function temporalSmooth(vibeVector: SceneLatentVector, alpha = 0.4): SceneLatentVector {
  return blendLatentVectors([
    { vector: vibeVector, weight: alpha },
    { vector: previousSceneMemoryVector(vibeVector), weight: 1 - alpha },
  ]);
}

function sceneConfidence(sceneVector: SceneLatentVector, mixture: VibeMixture): number {
  const prototypeConfidence = Math.max(
    ...SCENE_PROTOTYPES.map((prototype) => latentCosine(sceneVector, prototype.centroidVector))
  );
  const mixtureAgreement = mixture.vectors.length <= 1
    ? 1
    : mixture.vectors.reduce((sum, vector) => sum + latentCosine(sceneVector, vector), 0) / mixture.vectors.length;
  return clamp01(prototypeConfidence * 0.65 + mixtureAgreement * 0.35);
}

function hasMultiVibeAmbiguity(sceneVector: SceneLatentVector, mixture: VibeMixture): boolean {
  if (mixture.vectors.length <= 1) return false;
  const minAgreement = Math.min(...mixture.vectors.map((vector) => latentCosine(sceneVector, vector)));
  return minAgreement < 0.78;
}

function vectorFromPromptSegment(
  segment: string,
  mood: string[],
  activity: string | null,
  energy: "low" | "medium" | "high" | null,
): SceneLatentVector {
  const vector = emptyLatentVector();
  for (const contribution of TOKEN_CONTRIBUTIONS) {
    if (contribution.pattern.test(segment)) {
      addLatentContribution(vector, contribution.vector, contribution.weight);
    }
  }
  if (mood.includes("nostalgic")) addLatentContribution(vector, { nostalgia: 0.34, introspection: 0.16 }, 1);
  if (mood.includes("melancholic")) addLatentContribution(vector, { valence: -0.22, tension: 0.20, darkness: 0.14 }, 1);
  if (mood.includes("warm")) addLatentContribution(vector, { warmth: 0.26, valence: 0.12 }, 1);
  if (mood.includes("calm")) addLatentContribution(vector, { energy: -0.16, tension: -0.14, clarity: 0.10 }, 1);
  if (mood.includes("energised")) addLatentContribution(vector, { energy: 0.24, motion: 0.16 }, 1);
  if (activity === "driving") addLatentContribution(vector, { motion: 0.32, energy: 0.10 }, 1);
  if (activity === "focus") addLatentContribution(vector, { clarity: 0.28, socialness: -0.16 }, 1);
  if (activity === "party" || activity === "gym") addLatentContribution(vector, { energy: 0.30, socialness: 0.22 }, 1);
  if (energy === "high") addLatentContribution(vector, { energy: 0.30, motion: 0.12 }, 1);
  if (energy === "low") addLatentContribution(vector, { energy: -0.22, introspection: 0.12 }, 1);
  if (energy === "medium") addLatentContribution(vector, { energy: 0.08, clarity: 0.08 }, 1);
  return sceneVectorSanityMerge(normalizeLatentVector(vector));
}

function buildVibeMixture(
  input: string,
  mood: string[],
  activity: string | null,
  energy: "low" | "medium" | "high" | null,
): VibeMixture {
  const segments = input
    .split(/\s*(?:\+|,| and | with | while )\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const sourceSegments = segments.length > 0 ? segments : [input];
  const vectors = sourceSegments.map((segment) => vectorFromPromptSegment(segment, mood, activity, energy));
  const weights = sourceSegments.map((segment) => Math.max(0.6, Math.min(1.4, segment.length / Math.max(12, input.length / sourceSegments.length))));
  return { vectors, weights };
}

function fuseVibeMixture(mixture: VibeMixture): SceneLatentVector {
  const fused = emptyLatentVector();
  for (const key of LATENT_KEYS) fused[key] = 0;
  let totalWeight = 0;
  mixture.vectors.forEach((vector, index) => {
    const weight = mixture.weights[index] ?? 1;
    totalWeight += weight;
    for (const key of LATENT_KEYS) {
      fused[key] += vector[key] * weight;
    }
  });
  if (totalWeight > 0) {
    for (const key of LATENT_KEYS) {
      fused[key] /= totalWeight;
    }
  }
  return sceneVectorSanityMerge(normalizeLatentVector(fused));
}

function prototypeAffinities(sceneVector: SceneLatentVector): Record<string, number> {
  return Object.fromEntries(
    SCENE_PROTOTYPES.map((prototype) => [
      prototype.id,
      Math.round(latentCosine(sceneVector, prototype.centroidVector) * 1000) / 1000,
    ])
  );
}

function nearestPrototype(sceneVector: SceneLatentVector): string {
  return SCENE_PROTOTYPES
    .map((prototype) => ({
      id: prototype.id,
      score: latentCosine(sceneVector, prototype.centroidVector),
    }))
    .sort((a, b) => b.score - a.score)[0]?.id ?? "quiet_reflection";
}

function latentToContextWorld(sceneVector: SceneLatentVector): SceneIntent["contextWorld"] {
  return {
    physical: sceneVector.motion > 0.66 ? "car" : sceneVector.socialness > 0.62 ? "social" : sceneVector.clarity > 0.72 ? "work" : "outdoors",
    time: sceneVector.darkness > 0.62 ? "late_night" : sceneVector.warmth > 0.66 && sceneVector.valence > 0.55 ? "morning" : "evening",
    motion: sceneVector.motion > 0.70 ? "driving" : sceneVector.motion > 0.42 ? "moving" : "static",
  };
}

function latentToIntentDriver(sceneVector: SceneLatentVector): SceneIntent["intentDriver"] {
  if (sceneVector.clarity > 0.72) return "focus";
  if (sceneVector.energy > 0.72 && sceneVector.socialness > 0.45) return "energy";
  if (sceneVector.nostalgia > 0.62) return "memory";
  if (sceneVector.motion > 0.62) return "escape";
  if (sceneVector.tension > 0.58 || sceneVector.darkness > 0.58) return "processing";
  return "reflection";
}

function latentToEmotionVector(sceneVector: SceneLatentVector): SceneIntent["emotionVector"] {
  return {
    nostalgia: sceneVector.nostalgia,
    restlessness: clamp01(sceneVector.motion * 0.55 + sceneVector.tension * 0.35 + sceneVector.energy * 0.10),
    joy: sceneVector.valence,
    tension: sceneVector.tension,
    calm: clamp01((1 - sceneVector.tension) * 0.45 + sceneVector.clarity * 0.25 + (1 - sceneVector.energy) * 0.30),
  };
}

function latentToEnergyArc(
  sceneVector: SceneLatentVector,
  requestedEnergy: "low" | "medium" | "high" | null,
): SceneIntent["energyArc"] {
  const base = requestedEnergy === "high" ? Math.max(sceneVector.energy, 0.68) :
    requestedEnergy === "low" ? Math.min(sceneVector.energy, 0.38) :
    sceneVector.energy;
  const lift = sceneVector.motion * 0.10 + sceneVector.tension * 0.08;
  const settle = sceneVector.introspection * 0.08 + sceneVector.nostalgia * 0.06;
  return {
    start: clamp01(base - 0.08 + sceneVector.clarity * 0.04),
    mid: clamp01(base + lift),
    end: clamp01(base - settle),
    volatility: clamp01(Math.abs(lift - settle) + sceneVector.tension * 0.22),
  };
}

function projectSceneToVector(scene: Omit<SceneIntent, "sceneEmbedding">): number[] {
  const vector = new Array(SCENE_EMBEDDING_DIMS).fill(0);
  for (const key of LATENT_KEYS) {
    addVectorSignal(vector, `latent:${key}`, scene.sceneVector[key] * 0.85);
  }

  vector[0] += scene.emotionVector.nostalgia * 0.70;
  vector[1] += scene.emotionVector.restlessness * 0.70;
  vector[2] += scene.emotionVector.joy * 0.60;
  vector[3] += scene.emotionVector.tension * 0.65;
  vector[4] += scene.emotionVector.calm * 0.65;
  vector[5] += scene.energyArc.start * 0.55;
  vector[6] += scene.energyArc.mid * 0.65;
  vector[7] += scene.energyArc.end * 0.55;
  vector[8] += scene.energyArc.volatility * 0.45;
  vector[9] += scene.sceneVector.motion * 0.65;
  vector[10] += scene.sceneVector.introspection * 0.65;
  vector[11] += scene.sceneVector.warmth * 0.55;
  vector[12] += scene.sceneVector.darkness * 0.55;
  vector[13] += scene.sceneVector.socialness * 0.50;
  vector[14] += scene.sceneVector.clarity * 0.60;

  return normalizeVector(vector);
}

function buildSceneIntent(
  input: string,
  genreFamilies: string[],
  mood: string[],
  activity: string | null,
  energy: "low" | "medium" | "high" | null,
): SceneIntent | null {
  const matchedTerms = parseMatchedGenreTerms(input);
  const styleTerms = matchedTerms.filter((term) =>
    term !== (normalizeLockedGenreFamily(term) ?? term)
  );
  const primaryAnchor = genreFamilies[0] ?? null;
  const satellites = [
    ...genreFamilies.slice(1),
    ...styleTerms,
  ].filter((style, index, styles) => styles.indexOf(style) === index);
  const vibeMixture = buildVibeMixture(input, mood, activity, energy);
  const fusedVector = fuseVibeMixture(vibeMixture);
  const stableVibeVector = temporalSmooth(fusedVector, 0.4);
  const recenteredVector = recenterSceneVector(stableVibeVector);
  const confidence = sceneConfidence(recenteredVector, vibeMixture);
  const fallbackMode: SceneIntent["fallbackMode"] =
    confidence < 0.62 || hasMultiVibeAmbiguity(recenteredVector, vibeMixture)
      ? "balanced_latent_centroid"
      : "latent";
  const sceneVector = fallbackMode === "balanced_latent_centroid"
    ? blendLatentVectors([
        { vector: recenteredVector, weight: 0.70 },
        { vector: BALANCED_LATENT_CENTROID, weight: 0.30 },
      ])
    : recenteredVector;
  const contextWorld = latentToContextWorld(sceneVector);
  const intentDriver = latentToIntentDriver(sceneVector);
  const momentType = nearestPrototype(sceneVector);
  const emotionVector = latentToEmotionVector(sceneVector);

  const scene = {
    momentType,
    emotionVector,
    energyArc: latentToEnergyArc(sceneVector, energy),
    contextWorld,
    intentDriver,
    genreRoles: {
      anchor: primaryAnchor ?? genreFamilies[0] ?? "pop",
      satellites,
    },
    sceneVector,
    stableVibeVector,
    sceneConfidence: confidence,
    fallbackMode,
    prototypeAffinities: prototypeAffinities(sceneVector),
  };
  return {
    ...scene,
    sceneEmbedding: projectSceneToVector(scene),
  };
}

function completeSceneIntent(
  sceneIntent: SceneIntent | null | undefined,
  genreFamilies: string[],
  mood: string[],
  activity: string | null,
  energy: "low" | "medium" | "high" | null,
): SceneIntent | null {
  if (!sceneIntent) return null;
  const maybeScene = sceneIntent as Partial<SceneIntent>;
  if (
    maybeScene.sceneVector &&
    maybeScene.stableVibeVector &&
    typeof maybeScene.sceneConfidence === "number" &&
    maybeScene.fallbackMode &&
    maybeScene.prototypeAffinities
  ) {
    return sceneIntent;
  }

  const vibeMixture = buildVibeMixture(
    genreFamilies.join(" "),
    mood,
    activity,
    energy,
  );
  const baseVector = maybeScene.sceneVector ?? fuseVibeMixture(vibeMixture);
  const stableVibeVector = maybeScene.stableVibeVector ?? temporalSmooth(baseVector, 0.4);
  const recenteredVector = recenterSceneVector(stableVibeVector);
  const confidence = maybeScene.sceneConfidence ?? sceneConfidence(recenteredVector, vibeMixture);
  const fallbackMode: SceneIntent["fallbackMode"] = maybeScene.fallbackMode ??
    (confidence < 0.62 ? "balanced_latent_centroid" : "latent");
  const sceneVector = fallbackMode === "balanced_latent_centroid"
    ? blendLatentVectors([
        { vector: recenteredVector, weight: 0.70 },
        { vector: BALANCED_LATENT_CENTROID, weight: 0.30 },
      ])
    : recenteredVector;
  const completedScene: Omit<SceneIntent, "sceneEmbedding"> = {
    momentType: maybeScene.momentType ?? nearestPrototype(sceneVector),
    emotionVector: maybeScene.emotionVector ?? latentToEmotionVector(sceneVector),
    energyArc: maybeScene.energyArc ?? latentToEnergyArc(sceneVector, energy),
    contextWorld: maybeScene.contextWorld ?? latentToContextWorld(sceneVector),
    intentDriver: maybeScene.intentDriver ?? latentToIntentDriver(sceneVector),
    genreRoles: maybeScene.genreRoles ?? {
      anchor: genreFamilies[0] ?? "pop",
      satellites: genreFamilies.slice(1),
    },
    sceneVector,
    stableVibeVector,
    sceneConfidence: confidence,
    fallbackMode,
    prototypeAffinities: maybeScene.prototypeAffinities ?? prototypeAffinities(sceneVector),
  };
  return {
    ...completedScene,
    sceneEmbedding: projectSceneToVector(completedScene),
  };
}

function excludedMoodTags(input: string): Set<string> {
  const excluded = new Set<string>();
  const rules: Array<{ tag: string; pattern: RegExp }> = [
    { tag: "melancholic", pattern: /\b(?:not|no|without)\s+(?:sad|melanchol|lonely|blue|heartbreak)\b/i },
    { tag: "calm", pattern: /\b(?:not|no|without)\s+(?:calm|chill|relax|soft|peaceful)\b/i },
    { tag: "nostalgic", pattern: /\b(?:not|no|without)\s+(?:nostalg|throwback|retro|memory)\b/i },
    { tag: "warm", pattern: /\b(?:not|no|without)\s+(?:warm|cozy|cosy|golden)\b/i },
    { tag: "energised", pattern: /\b(?:not|no|without)\s+(?:hype|energ|intense|pump)\b/i },
  ];
  for (const rule of rules) {
    if (rule.pattern.test(input)) excluded.add(rule.tag);
  }
  return excluded;
}

export function completeLockedIntent(
  intent: LockedIntent,
  fallbacks: LockedIntentFallbacks = {},
): LockedIntent {
  const genreFamilies = uniqueGenreFamilies(
    intent.genreFamilies.length > 0
      ? intent.genreFamilies
      : fallbacks.genreFamilies ?? []
  );
  const completedSceneIntent = completeSceneIntent(
    intent.sceneIntent ?? fallbacks.sceneIntent ?? null,
    genreFamilies,
    intent.mood.length > 0 ? intent.mood : fallbacks.mood ?? ["balanced"],
    intent.activity ?? fallbacks.activity ?? "listening",
    intent.energy ?? fallbacks.energy ?? "medium",
  );

  return {
    genreFamilies: genreFamilies.length > 0 ? genreFamilies : ["pop"],
    eraRange: intent.eraRange ?? fallbacks.eraRange ?? null,
    mood: intent.mood.length > 0 ? intent.mood.slice(0, 3) : (fallbacks.mood?.slice(0, 3) ?? ["balanced"]),
    activity: intent.activity ?? fallbacks.activity ?? "listening",
    energy: intent.energy ?? fallbacks.energy ?? "medium",
    sceneIntent: completedSceneIntent ?? (
      genreFamilies.length > 1
        ? (() => {
          const vibeMixture = buildVibeMixture(
            genreFamilies.join(" "),
            intent.mood,
            intent.activity,
            intent.energy,
          );
          const fusedVector = fuseVibeMixture(vibeMixture);
          const stableVibeVector = temporalSmooth(fusedVector, 0.4);
          const recenteredVector = recenterSceneVector(stableVibeVector);
          const confidence = sceneConfidence(recenteredVector, vibeMixture);
          const sceneVector = blendLatentVectors([
            { vector: recenteredVector, weight: 0.70 },
            { vector: BALANCED_LATENT_CENTROID, weight: 0.30 },
          ]);
          const fallbackScene: Omit<SceneIntent, "sceneEmbedding"> = {
            momentType: nearestPrototype(sceneVector),
            emotionVector: latentToEmotionVector(sceneVector),
            energyArc: latentToEnergyArc(sceneVector, intent.energy),
            contextWorld: latentToContextWorld(sceneVector),
            intentDriver: latentToIntentDriver(sceneVector),
            genreRoles: {
              anchor: genreFamilies[0] ?? "pop",
              satellites: genreFamilies.slice(1),
            },
            sceneVector,
            stableVibeVector,
            sceneConfidence: confidence,
            fallbackMode: "balanced_latent_centroid",
            prototypeAffinities: prototypeAffinities(sceneVector),
          };
          return {
            ...fallbackScene,
            sceneEmbedding: projectSceneToVector(fallbackScene),
          };
        })()
        : null
    ),
  };
}

export function buildLockedIntent(input: string): LockedIntent {
  const lower = input.toLowerCase();
  const genreFamilies = parseGenreFamilies(lower);

  const excludedMoods = excludedMoodTags(lower);
  const mood = [
    /\b(sad|melanchol|lonely|blue|heartbreak)\b/.test(lower) ? "melancholic" : null,
    /\b(calm|chill|relax|soft|peaceful)\b/.test(lower) ? "calm" : null,
    /\b(nostalg|throwback|retro|memory)\b/.test(lower) ? "nostalgic" : null,
    /\b(warm|sunset|cozy|cosy|golden)\b/.test(lower) ? "warm" : null,
    /\b(hype|energ|intense|pump)\b/.test(lower) ? "energised" : null,
    ...expandedMoodTerms(lower),
  ]
    .filter((tag): tag is string => !!tag && !excludedMoods.has(tag))
    .filter((tag, index, tags) => tags.indexOf(tag) === index)
    .slice(0, 4);

  const activity = expandedActivity(lower) ?? (
    /\b(driv|road|cruise|highway)\b/.test(lower) ? "driving" :
      /\b(study|focus|coding|work|deep work)\b/.test(lower) ? "focus" :
        /\b(gym|workout|run|running)\b/.test(lower) ? "gym" :
          /\b(relax|sleep|unwind)\b/.test(lower) ? "relaxing" :
            /\b(party|club|dance)\b/.test(lower) ? "party" :
              null
  );

  const energy = parseEnergy(lower);

  return {
    genreFamilies,
    eraRange: parseEra(lower),
    mood,
    activity,
    energy,
    sceneIntent: buildSceneIntent(lower, genreFamilies, mood, activity, energy),
  };
}
