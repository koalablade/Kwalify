/**
 * Build unified fault-diagnosis prompt corpus from all repo sources.
 * Run: node scripts/build-fault-diagnosis-corpus.mjs
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PLAYLIST_BENCHMARK_PROMPTS } = require("../backend/dist/lib/playlist-evaluation/benchmark-prompts.js");

const OUT = path.resolve("data/corpus/fault-diagnosis-prompt-corpus.json");

const EDITORIAL_15 = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.", category: "editorial", tags: ["editorial", "human_saveability"] },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood", category: "editorial", tags: ["editorial"] },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth", category: "editorial", tags: ["editorial"] },
  { id: "late_night", prompt: "late night feeling", category: "editorial", tags: ["editorial"] },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light", category: "editorial", tags: ["editorial"] },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy", category: "editorial", tags: ["editorial"] },
  { id: "study_session", prompt: "music for thinking and study session focus", category: "editorial", tags: ["editorial"] },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout", category: "editorial", tags: ["editorial"] },
  { id: "coffee_shop", prompt: "lazy Saturday coffee shop reading with indie folk vibes", category: "editorial", tags: ["editorial"] },
  { id: "road_trip", prompt: "windows-down road trip singalong energy", category: "editorial", tags: ["editorial"] },
  { id: "after_work", prompt: "after work decompression walk home calm but not sad", category: "editorial", tags: ["editorial"] },
  { id: "party_pregame", prompt: "pregame playlist before going out with friends tonight", category: "editorial", tags: ["editorial"] },
  { id: "melancholy_rain", prompt: "melancholy rainy afternoon staring out the window", category: "editorial", tags: ["editorial"] },
  { id: "focus_coding", prompt: "deep focus coding session late evening electronic ambient", category: "editorial", tags: ["editorial"] },
  { id: "morning_yoga", prompt: "gentle morning yoga stretch calm uplifting", category: "editorial", tags: ["editorial"] },
];

const NARRATIVE_SCENE = [
  "Tokyo at 3am after missing the last train",
  "Rain on the motorway",
  "Fixing my Volvo in the garage at midnight",
  "Walking through empty city streets",
  "Urban nostalgia from a forgotten rave flyer in 1997",
  "I need music that feels like driving home at 2am after a great night out",
  "songs for fixing an old Volvo in the garage on a rainy day",
  "music that feels like summer is ending",
  "music for a road trip through Scotland",
  "stuff that makes me want to build something",
].map((prompt, i) => ({
  id: `narrative-${i + 1}`,
  prompt,
  category: "narrative_scene",
  mode: "balanced",
  length: 25,
  tags: ["narrative", "scene"],
}));

const STRESS_LIVE = [
  "2000s pop punk gym workout",
  "late 90s skate punk workout",
  "angry metal gym session with no screamo",
  "high energy female-fronted rock workout",
  "2000s emo workout but not sad",
  "pop punk cardio playlist with no Blink-182",
  "relaxing workout music",
  "aggressive music for studying",
  "happy breakup songs",
  "sad songs that feel hopeful",
  "high energy chill playlist",
  "focus music that isn't ambient",
  "2000s Welsh pop punk workout",
  "female-fronted melodic hardcore from the 2000s",
  "early 2000s post-hardcore gym playlist",
  "2000s pop punk without Green Day",
  "metal workout without Metallica",
  "classic rock road trip without Queen",
  "90s grunge without Nirvana",
  "indie playlist without Arctic Monkeys",
  "music for restoring a Volvo 480 in a cold garage",
  "2000s pop punk gym workout with no pop music",
  "focus music with no vocals and no ambient",
  "angry rock workout with no metal",
  "upbeat gym playlist with no electronic music",
  "gym 2000s pop punk workout",
  "music for fixing a car alone in a garage",
  "songs that feel like winning after a long struggle",
  "stuff I'd have heard on Kerrang in the 2000s",
  "music for driving through rain at night",
  "2000s pop punk without Blink-182",
  "rock workout playlist from exactly 2004-2008",
  "angry workout playlist with no metal, rap or EDM",
].map((prompt, i) => ({
  id: `stress-live-${i + 1}`,
  prompt,
  category: "stress_live",
  mode: prompt.includes("without") || prompt.includes("no ") ? "strict" : "balanced",
  length: 25,
  tags: ["stress", "constraint"],
}));

function norm(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function addEntry(map, entry, source) {
  const key = norm(entry.prompt);
  if (!key || map.has(key)) return;
  map.set(key, {
    id: entry.id,
    prompt: entry.prompt,
    category: entry.category ?? "mixed",
    mode: entry.mode ?? "balanced",
    length: entry.length ?? 25,
    tags: [...new Set([...(entry.tags ?? []), source])],
    source,
  });
}

async function main() {
  const map = new Map();

  for (const p of PLAYLIST_BENCHMARK_PROMPTS) {
    addEntry(map, {
      id: p.id,
      prompt: p.prompt,
      category: p.category,
      mode: p.mode,
      length: p.length,
      tags: p.tags,
    }, "benchmark-prompts");
  }

  for (const p of EDITORIAL_15) addEntry(map, p, "editorial-15");
  for (const p of NARRATIVE_SCENE) addEntry(map, p, "narrative-scene");
  for (const p of STRESS_LIVE) addEntry(map, p, "stress-live");

  try {
    const pairwise = JSON.parse(await readFile(path.resolve("data/corpus/pairwise-benchmark-prompts.json"), "utf8"));
    for (const row of pairwise) {
      addEntry(map, {
        id: row.id,
        prompt: row.prompt,
        category: "editorial_pairwise",
        mode: "balanced",
        length: 25,
        tags: ["editorial", "pairwise"],
      }, "pairwise-corpus");
    }
  } catch { /* optional */ }

  try {
    const golden = JSON.parse(await readFile(path.resolve("backend/lib/playlist-evaluation/golden-prompt-regression.json"), "utf8"));
    let i = 0;
    for (const prompt of Object.keys(golden)) {
      i += 1;
      addEntry(map, {
        id: `golden-${i}`,
        prompt,
        category: "golden_regression",
        mode: "strict",
        length: 30,
        tags: ["golden", "regression"],
      }, "golden-regression");
    }
  } catch { /* optional */ }

  const prompts = [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  const payload = {
    generatedAt: new Date().toISOString(),
    uniquePromptCount: prompts.length,
    sources: ["benchmark-prompts", "editorial-15", "narrative-scene", "stress-live", "pairwise-corpus", "golden-regression"],
    prompts,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ out: OUT, uniquePromptCount: prompts.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
