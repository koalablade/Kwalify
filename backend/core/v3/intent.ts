import { getGenreFamily } from "./global-diversity-controller";

export interface LockedIntent {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  mood: string[];
  activity: string | null;
  energy: "low" | "medium" | "high" | null;
}

export interface LockedIntentFallbacks {
  genreFamilies?: string[];
  eraRange?: { start: number; end: number } | null;
  mood?: string[];
  activity?: string | null;
  energy?: "low" | "medium" | "high" | null;
}

const GENRE_ALIASES: Array<{ family: string; terms: string[] }> = [
  { family: "country", terms: ["country", "americana", "alt-country", "alt country", "bluegrass"] },
  { family: "rock", terms: ["rock", "indie rock", "alt rock", "alternative rock", "classic rock", "grunge", "punk", "punk rock", "pop punk", "pop-punk"] },
  { family: "electronic", terms: ["electronic", "house", "techno", "trance", "edm", "dnb", "drum and bass", "rave", "hardstyle", "dubstep"] },
  { family: "hip_hop", terms: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap"] },
  { family: "pop", terms: ["pop", "indie pop", "synthpop", "synth pop"] },
  { family: "jazz", terms: ["jazz", "soul jazz", "lo-fi jazz", "lofi jazz"] },
  { family: "folk", terms: ["folk", "singer-songwriter", "singer songwriter"] },
  { family: "rnb", terms: ["r&b", "rnb"] },
  { family: "soul", terms: ["soul", "funk", "motown"] },
  { family: "latin", terms: ["latin", "reggaeton", "salsa", "bachata"] },
];

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
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(input);
}

function parseEra(input: string): { start: number; end: number } | null {
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

export function eraRangeFromBucket(bucket?: string | null): { start: number; end: number } | null {
  return bucket ? ERA_BUCKET_RANGES[bucket] ?? null : null;
}

export function normalizeLockedGenreFamily(value?: string | null): string | null {
  if (!value || value === "unknown") return null;
  const normalized = value.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    alt_rock: "rock",
    alternative_rock: "rock",
    indie_rock: "rock",
    punk_rock: "rock",
    pop_punk: "rock",
    hip_hop: "hip_hop",
    hiphop: "hip_hop",
    r_and_b: "rnb",
    rhythm_and_blues: "rnb",
    singer_songwriter: "folk",
    singer_songwriters: "folk",
    drum_and_bass: "electronic",
    dnb: "electronic",
    edm: "electronic",
    hardstyle: "electronic",
    dubstep: "electronic",
  };
  return getGenreFamily(aliases[normalized] ?? normalized);
}

function uniqueGenreFamilies(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const family = normalizeLockedGenreFamily(value);
    if (!family || seen.has(family)) continue;
    seen.add(family);
    out.push(family);
    if (out.length >= 3) break;
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
      return { family, confidence: hitCount + directFamilyHit };
    })
    .filter(({ family, confidence }) => confidence > 0 && !excluded.has(family))
    .sort((a, b) => b.confidence - a.confidence);

  const primary = matches[0];
  if (!primary) return [];

  const families = [primary.family];
  const secondary = matches.find((match) =>
    match.family !== primary.family &&
    match.confidence >= Math.max(1, primary.confidence * 0.5)
  );
  if (secondary) families.push(secondary.family);
  return families;
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

  return {
    genreFamilies,
    eraRange: intent.eraRange ?? fallbacks.eraRange ?? null,
    mood: intent.mood.length > 0 ? intent.mood.slice(0, 3) : (fallbacks.mood?.slice(0, 3) ?? ["balanced"]),
    activity: intent.activity ?? fallbacks.activity ?? "listening",
    energy: intent.energy ?? fallbacks.energy ?? "medium",
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
  ]
    .filter((tag): tag is string => !!tag && !excludedMoods.has(tag))
    .slice(0, 2);

  const activity =
    /\b(driv|road|cruise|highway)\b/.test(lower) ? "driving" :
    /\b(study|focus|coding|work|deep work)\b/.test(lower) ? "focus" :
    /\b(gym|workout|run|running)\b/.test(lower) ? "gym" :
    /\b(relax|sleep|unwind)\b/.test(lower) ? "relaxing" :
    /\b(party|club|dance)\b/.test(lower) ? "party" :
    null;

  const energy =
    /\b(gym|workout|hype|high energy|intense|party|rave|run|running)\b/.test(lower) ? "high" :
    /\b(chill|relax|sleep|ambient|calm|study|focus|soft|low energy)\b/.test(lower) ? "low" :
    /\b(driving|walk|walking|commute|medium energy|steady)\b/.test(lower) ? "medium" :
    null;

  return {
    genreFamilies,
    eraRange: parseEra(lower),
    mood,
    activity,
    energy,
  };
}
