/**
 * Adversarial prompt generator — 1000 prompts designed to break scene/taste pipeline.
 */

import type { AdversarialCategory, AdversarialPrompt } from "./types";

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)]!;
const pickN = <T>(rng: () => number, items: T[], n: number): T[] => {
  const copy = [...items];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
};

const SCENES = [
  "Tokyo at 3am",
  "Paris café in the rain",
  "Reading Agatha Christie",
  "Warehouse rave at midnight",
  "Driving through rural France",
  "Cyberpunk dystopia",
  "Victorian detective story",
  "Desert highway at sunset",
  "Berlin warehouse sunrise",
  "Small-town horror novel",
  "Last train home",
  "Fixing my Volvo in the garage",
];

const EMOTIONS = ["sad", "happy", "melancholy", "euphoric", "anxious", "calm", "angry", "nostalgic", "romantic", "tense"];
const GENRES = ["jazz", "classical", "uk garage", "ambient", "metal", "country", "drill", "techno", "folk", "soul", "opera", "grime"];
const SLANG = [
  "vibey", "main character energy", "no cap", "it's giving", "core", "slaps", "bussin",
  "lowkey", "highkey", "based", "cursed", "unhinged", "chronically online", "brain rot",
  "sigma grindset", "skibidi", "rizz", "delulu", "ate", "mid", "goated",
];
const ABSTRACT = [
  "the colour of forgetting",
  "music for when time folds",
  "soundtrack to a dream you almost remember",
  "what loneliness tastes like at 4am",
  "the space between two heartbeats",
  "echoes of a city that never existed",
  "warm static from another timeline",
  "floating through borrowed memories",
  "the hum before the world wakes up",
  "glass rain on neon water",
];
const CULTURES = [
  "Tokyo", "Paris", "Berlin", "Mumbai", "Lagos", "Seoul", "Cairo", "Havana", "Reykjavik", "Nairobi",
  "Agatha Christie", "Tolkien", "Murakami", "Orwell", "Borges", "Kafka",
];
const ACTIVITIES = ["reading", "driving", "studying", "partying", "cooking", "walking", "working out", "sleeping", "coding", "mourning"];

function contradictoryPrompt(rng: () => number): string {
  const templates = [
    () => `${pick(rng, EMOTIONS)} but ${pick(rng, EMOTIONS)} ${pick(rng, ACTIVITIES)}`,
    () => `${pick(rng, ["high energy", "hype", "intense"])} but chill and sleepy`,
    () => `${pick(rng, GENRES)} but no ${pick(rng, GENRES)} please`,
    () => `party vibes but I want to cry quietly`,
    () => `no vocals but singalong anthem energy`,
    () => `${pick(rng, ["nocturnal", "late night"])} but bright morning sunshine`,
    () => `aggressive but soft and gentle`,
    () => `study focus but dancefloor bangers`,
    () => `${pick(rng, SCENES)} but the opposite mood`,
    () => `not boring but also not interesting`,
  ];
  return pick(rng, templates)();
}

function multiScenePrompt(rng: () => number): string {
  const parts = pickN(rng, SCENES, 2 + Math.floor(rng() * 2));
  const glue = pick(rng, [" then ", " while ", " but also ", " / ", " + "]);
  return parts.join(glue);
}

function genreEmotionConflictPrompt(rng: () => number): string {
  const pairs: Array<[string, string]> = [
    ["happy funeral", "sad"],
    ["aggressive lullaby", "calm"],
    ["romantic drill", "romantic"],
    ["melancholy party", "melancholy"],
    ["anxious meditation", "anxious"],
    ["euphoric grief", "euphoric"],
    ["tense spa day", "tense"],
    ["nostalgic futuristic", "nostalgic"],
  ];
  const [phrase, emotion] = pick(rng, pairs);
  return `${phrase} ${pick(rng, GENRES)} ${emotion}`;
}

function memeSlangPrompt(rng: () => number): string {
  const slang = pick(rng, SLANG);
  const templates = [
    () => `${slang} ${pick(rng, SCENES).toLowerCase()}`,
    () => `playlist for when it's ${slang}`,
    () => `${pick(rng, GENRES)} but ${slang}`,
    () => `${slang} vibes only no ${pick(rng, ["skip", "mid", "basic"])}`,
    () => `${pick(rng, ACTIVITIES)} ${slang} edition`,
    () => `${slang} and ${pick(rng, SLANG)} at 3am`,
  ];
  return pick(rng, templates)();
}

function abstractPrompt(rng: () => number): string {
  const base = pick(rng, ABSTRACT);
  if (rng() > 0.6) return `${base} ${pick(rng, ["...", "???", "idk", "help"])}`;
  return base;
}

function culturalMashupPrompt(rng: () => number): string {
  const a = pick(rng, CULTURES);
  let b = pick(rng, CULTURES);
  while (b === a) b = pick(rng, CULTURES);
  const templates = [
    () => `${a} meets ${b} at ${pick(rng, ["midnight", "dawn", "rain", "neon hour"])}`,
    () => `Reading ${a} in ${b} during ${pick(rng, ACTIVITIES)}`,
    () => `${a} aesthetic ${b} soundtrack ${pick(rng, GENRES)}`,
    () => `${pick(rng, SCENES)} but ${a} and ${b}`,
    () => `${a} café ${b} warehouse ${pick(rng, EMOTIONS)}`,
  ];
  return pick(rng, templates)();
}

const GENERATORS: Record<AdversarialCategory, (rng: () => number) => string> = {
  contradictory: contradictoryPrompt,
  multi_scene: multiScenePrompt,
  genre_emotion_conflict: genreEmotionConflictPrompt,
  meme_slang: memeSlangPrompt,
  abstract: abstractPrompt,
  cultural_mashup: culturalMashupPrompt,
};

const CATEGORY_COUNTS: Record<AdversarialCategory, number> = {
  contradictory: 150,
  multi_scene: 150,
  genre_emotion_conflict: 150,
  meme_slang: 150,
  abstract: 150,
  cultural_mashup: 250,
};

export function generateAdversarialPrompts(opts: { seed?: number; limit?: number } = {}): AdversarialPrompt[] {
  const seed = opts.seed ?? 42;
  const rng = mulberry32(seed);
  const prompts: AdversarialPrompt[] = [];
  let index = 0;

  for (const [category, count] of Object.entries(CATEGORY_COUNTS) as Array<[AdversarialCategory, number]>) {
    const seen = new Set<string>();
    let generated = 0;
    let attempts = 0;
    while (generated < count && attempts < count * 20) {
      attempts += 1;
      const prompt = GENERATORS[category](rng);
      const key = prompt.toLowerCase().trim();
      if (seen.has(key)) {
        const variant = `${prompt} ${Math.floor(rng() * 9999)}`;
        if (seen.has(variant.toLowerCase())) continue;
        seen.add(variant.toLowerCase());
        index += 1;
        prompts.push({
          id: `adv-${String(index).padStart(4, "0")}`,
          prompt: variant,
          category,
          tags: [category, "dedup-variant"],
        });
        generated += 1;
        continue;
      }
      seen.add(key);
      index += 1;
      prompts.push({
        id: `adv-${String(index).padStart(4, "0")}`,
        prompt,
        category,
        tags: [category],
      });
      generated += 1;
    }
  }

  if (opts.limit != null && opts.limit > 0) {
    return prompts.slice(0, opts.limit);
  }
  return prompts;
}

export const ADVERSARIAL_PROMPT_TARGET_COUNT = Object.values(CATEGORY_COUNTS).reduce((a, b) => a + b, 0);
