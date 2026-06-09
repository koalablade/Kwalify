export interface LockedIntent {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  mood: string[];
  activity: string | null;
  energy: "low" | "medium" | "high" | null;
}

const GENRE_ALIASES: Array<{ family: string; terms: string[] }> = [
  { family: "country", terms: ["country", "americana", "alt-country", "alt country", "bluegrass"] },
  { family: "rock", terms: ["rock", "indie rock", "alt rock", "alternative rock", "classic rock", "grunge", "punk"] },
  { family: "electronic", terms: ["electronic", "house", "techno", "trance", "edm", "dnb", "drum and bass", "rave"] },
  { family: "hip_hop", terms: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap"] },
  { family: "pop", terms: ["pop", "indie pop", "synthpop", "synth pop"] },
  { family: "jazz", terms: ["jazz", "soul jazz", "lo-fi jazz", "lofi jazz"] },
  { family: "folk", terms: ["folk", "singer-songwriter", "singer songwriter"] },
  { family: "rnb", terms: ["r&b", "rnb"] },
  { family: "soul", terms: ["soul", "funk", "motown"] },
  { family: "latin", terms: ["latin", "reggaeton", "salsa", "bachata"] },
];

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
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  const year = input.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return year ? { start: Number(year), end: Number(year) } : null;
}

export function buildLockedIntent(input: string): LockedIntent {
  const lower = input.toLowerCase();
  const genreFamilies = GENRE_ALIASES
    .filter(({ terms }) => terms.some((term) => matchesTerm(lower, term)))
    .map(({ family }) => family)
    .slice(0, 3);

  const mood = [
    /\b(sad|melanchol|lonely|blue|heartbreak)\b/.test(lower) ? "melancholic" : null,
    /\b(calm|chill|relax|soft|peaceful)\b/.test(lower) ? "calm" : null,
    /\b(nostalg|throwback|retro|memory)\b/.test(lower) ? "nostalgic" : null,
    /\b(warm|sunset|cozy|cosy|golden)\b/.test(lower) ? "warm" : null,
    /\b(hype|energ|intense|pump)\b/.test(lower) ? "energised" : null,
  ].filter((tag): tag is string => !!tag).slice(0, 3);

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
