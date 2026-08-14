/**
 * Collect 100+ human-expectation benchmark prompts from repo sources.
 * Usage: node scripts/collect-human-benchmark-prompts-2026-07-28.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OUT_DIR = path.resolve("reports/playlist-evaluation/human-benchmark-2026-07-28");
const OUT_PATH = path.join(OUT_DIR, "prompts.json");

const LANDFILL = "\\b(bon iver|clairo|noah kahan|dayglow|gregory alan isakov|badbadnotgood|phoebe bridgers|sufjan|mitski)\\b";

/** @type {Record<string, { world: string, forbidden?: string, prefer: string, mode?: string, length?: number }>} */
const CATEGORY_DEFAULTS = {
  "genre-locked": {
    world: "coherent genre identity",
    forbidden: LANDFILL,
    prefer: "\\b(rock|metal|pop|country|disco|funk|soul|garage|grime|indie|rap|electronic|punk|jazz|rnb|soul|folk|alternative)\\b",
    mode: "strict",
  },
  "scene/mood": {
    world: "scene-appropriate mood and energy",
    prefer: "\\b(indie|folk|acoustic|soft|calm|rain|night|drive|electronic|ambient|soul|pop|rock)\\b",
  },
  activity: {
    world: "activity-matched energy and tone",
    prefer: "\\b(pop|rock|indie|electronic|ambient|folk|soul|dance|rap|metal)\\b",
  },
  "vague lifestyle": {
    world: "relatable everyday listening",
    prefer: "\\b(chill|soft|indie|pop|folk|acoustic|calm|upbeat|soul)\\b",
    length: 25,
  },
  negation: {
    world: "honours explicit exclusions",
    prefer: "\\b(warm|cozy|indie|folk|rock|metal|electronic|ambient|pop)\\b",
    mode: "strict",
  },
  "UK-specific": {
    world: "British cultural context",
    prefer: "\\b(britpop|indie|garage|grime|oasis|blur|arctic|stone roses|uk|pub|brit)\\b",
  },
  "era-locked": {
    world: "era-appropriate sound",
    prefer: "\\b(80s|90s|70s|2000s|2010s|synth|new wave|grunge|disco|britpop|pop punk|old school)\\b",
    mode: "strict",
  },
  emotional: {
    world: "emotionally honest direction",
    prefer: "\\b(sad|melanchol|indie|soft|slow|hope|warm|reflect|emotional|folk|soul)\\b",
  },
  "v6-golden": {
    world: "golden-ear world identity",
    forbidden: LANDFILL,
    prefer: "\\b(synth|electronic|rock|metal|disco|funk|soul|drive|cinematic|queen|fleetwood|metallica|bee gees)\\b",
  },
  "gym/party": {
    world: "high energy social or training",
    forbidden: LANDFILL,
    prefer: "\\b(pop|rock|metal|rap|dance|party|pump|garage|grime|paramore|green day|ac\\/dc)\\b",
  },
  focus: {
    world: "low-distraction focus",
    forbidden: "\\b(heavy metal|screamo|party|club)\\b",
    prefer: "\\b(ambient|lo-?fi|instrumental|electronic|focus|study|calm|soft)\\b",
    mode: "strict",
  },
  contradictory: {
    world: "holds emotional tension",
    prefer: "\\b(indie|pop|dance|electronic|folk|emotional|soft|sad|upbeat)\\b",
  },
  "lived experience": {
    world: "situationally grounded feeling",
    prefer: "\\b(sad|melanchol|indie|soft|slow|warm|reflect|ambient|folk|hope|emotional)\\b",
  },
  discovery: {
    world: "coherent discovery mix",
    prefer: "\\b(indie|pop|rock|folk|soul|electronic|alternative)\\b",
  },
  edge_case: {
    world: "handles vague or odd input honestly",
    prefer: "\\b(indie|pop|folk|rock|electronic|ambient)\\b",
  },
  driving: {
    world: "cinematic drive energy",
    forbidden: LANDFILL,
    prefer: "\\b(drive|synth|cinematic|electronic|indie|post.?rock|war on drugs|night|road)\\b",
  },
  nostalgic: {
    world: "warm nostalgic thread",
    prefer: "\\b(nostalg|indie|folk|pop|rock|soul|old|throwback|memory)\\b",
  },
  gaming: {
    world: "gaming-appropriate energy",
    prefer: "\\b(electronic|rock|metal|indie|synth|game|ambient|hype)\\b",
  },
};

/** Curated high-signal prompts with explicit scoring specs (v6 golden + human-expectation set). */
const CURATED = [
  { id: "golden-A", category: "v6-golden", prompt: "empty motorway at midnight, rain on the windscreen", world: "late-night cinematic driving", forbidden: "\\b(bon iver|clairo|noah kahan|dayglow|travis scott|dmx|fugees)\\b", prefer: "\\b(synth|electronic|post.?rock|dream|ambient|cinematic|drive|war on drugs|massive attack|depeche|tame impala|radiohead)\\b" },
  { id: "golden-B", category: "genre-locked", prompt: "dad rock BBQ with beers", world: "classic rock gathering", forbidden: "\\b(bon iver|clairo|phoebe bridgers|sufjan|gregory alan|noah kahan|iron\\s*&\\s*wine)\\b", prefer: "\\b(queen|fleetwood|eagles|petty|boston|ac\\/dc|zz top|lynyrd|def leppard|journey|billy joel|bruce)\\b" },
  { id: "golden-C", category: "genre-locked", prompt: "yacht rock sunset by the pool", world: "70s/80s smooth rock", forbidden: "\\b(bon iver|clairo|lo-?fi|bedroom|phoebe bridgers)\\b", prefer: "\\b(toto|steely dan|hall\\s*&\\s*oates|christopher cross|michael mcdonald|doobie|yacht|soft rock|fleetwood)\\b" },
  { id: "golden-D", category: "gym/party", prompt: "heavy gym workout, aggressive", world: "high energy training", forbidden: "\\b(bon iver|acoustic|iron\\s*&\\s*wine|sufjan|gregory alan|phoebe bridgers|folk)\\b", prefer: "\\b(metal|hard rock|rap|electronic|dmx|eminem|metallica|rage|pump|aggressive|high energy|ac\\/?dc|offspring)\\b" },
  { id: "golden-E", category: "genre-locked", prompt: "disco rooftop party 1978", world: "classic disco", forbidden: "\\b(bon iver|indie folk|acoustic|lo-?fi)\\b", prefer: "\\b(disco|funk|soul|bee gees|chic|donna summer|earth wind|kool|village people|gloria gaynor)\\b" },
  { id: "genre-metal", category: "genre-locked", prompt: "metal gym workout", world: "heavy metal training", forbidden: "\\b(bon iver|acoustic|folk|iron\\s*&\\s*wine|norah jones)\\b", prefer: "\\b(metallica|slayer|megadeth|pantera|metal|hard rock|disturbed)\\b" },
  { id: "genre-grunge", category: "genre-locked", prompt: "90s grunge dark cloudy night", world: "90s grunge alternative", forbidden: "\\b(bee gees|disco|donna summer|chic)\\b", prefer: "\\b(nirvana|pearl jam|soundgarden|alice in chains|grunge|mudhoney)\\b" },
  { id: "genre-britpop", category: "genre-locked", prompt: "britpop sunny bus ride", world: "90s UK guitar pop", forbidden: "\\b(country|disco|classical)\\b", prefer: "\\b(oasis|blur|pulp|suede|britpop|verve|ocean colour)\\b" },
  { id: "genre-country", category: "genre-locked", prompt: "american country cowboy red dirt", world: "country/Americana", forbidden: "\\b(disco|techno|grime|drum and bass)\\b", prefer: "\\b(country|outlaw|willie|cash|waylon|merle|red dirt|americana)\\b" },
  { id: "genre-ukg", category: "UK-specific", prompt: "freshers pre drinks ukg grime buzzing night out", world: "UK garage/grime nightlife", forbidden: "\\b(country|folk|acoustic unplugged)\\b", prefer: "\\b(garage|grime|skepta|stormzy|so solid|artful dodger|uk garage)\\b" },
  { id: "neg-christmas", category: "negation", prompt: "winter cozy not christmas", world: "warm winter without festive", forbidden: "\\b(christmas|xmas|santa|jingle|silent night|feliz navidad|wonderful christmastime|last christmas|all i want for christmas)\\b", prefer: "\\b(warm|cozy|indie|folk|acoustic|winter)\\b", mode: "strict" },
  { id: "neg-no-rap-gym", category: "negation", prompt: "no rap just heavy workout", world: "rock/metal gym no hip-hop", forbidden: "\\b(rap|hip.?hop|drake|kendrick|eminem|travis scott)\\b", prefer: "\\b(rock|metal|hard|pump|gym|ac\\/dc|metallica)\\b", mode: "strict" },
  { id: "neg-no-guitar", category: "negation", prompt: "no guitar electronic focus", world: "electronic focus no guitars", forbidden: "\\b(guitar|acoustic|unplugged)\\b", prefer: "\\b(electronic|ambient|techno|house|synth|instrumental)\\b", mode: "strict" },
  { id: "uk-madchester", category: "UK-specific", prompt: "madchester pub walk", world: "late-80s Manchester indie", forbidden: "\\b(country|disco|classical)\\b", prefer: "\\b(stone roses|happy mondays|inspiral|charlatans|madchester|indie)\\b", mode: "strict" },
  { id: "era-80s", category: "era-locked", prompt: "80s night drive", world: "80s synth/new wave", prefer: "\\b(80s|synth|new wave|depeche|pet shop|tears for fears|a-ha|duran)\\b", mode: "strict" },
  { id: "era-noughties", category: "era-locked", prompt: "naughties Manchester bank holiday pub sesh", world: "2000s UK indie/garage", prefer: "\\b(indie|garage|britpop|oasis|arctic|kasabian|stone roses)\\b" },
];

function norm(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(s, max = 40) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max);
}

function inferCategory(prompt, hint) {
  const p = prompt.toLowerCase();
  if (hint) return hint;
  if (/\b(no |not |without |non-)\b/.test(p) || /not christmas|no rap|no guitar/.test(p)) return "negation";
  if (/\b(gym|workout|lifting|cardio|pump)\b/.test(p)) return "gym/party";
  if (/\b(party|pres|club|pre drinks|night out)\b/.test(p)) return "gym/party";
  if (/\b(focus|study|coding|distraction|instrumental|lofi|lo-fi)\b/.test(p)) return "focus";
  if (/\b(drive|motorway|road trip|windscreen|highway)\b/.test(p)) return "driving";
  if (/\b(britpop|madchester|grime|ukg|garage|pub garden|mardy|freshers|mates|sesh)\b/.test(p)) return "UK-specific";
  if (/\b(80s|90s|70s|2000s|2010s|naughties|disco 19|yacht rock|grunge|britpop)\b/.test(p)) return "era-locked";
  if (/\b(metal|country|disco|jazz|techno|jungle|dubstep|phonk|shoegaze|americana)\b/.test(p)) return "genre-locked";
  if (/\b(chill|vibe|vibes|existing|sad|happy)\b/.test(p) && p.length < 30) return "vague lifestyle";
  if (/\b(but |sad party|chill but|hope without|beautiful, not)\b/.test(p)) return "contradictory";
  if (/\b(interview|hospital|funeral|breakup|anxiety|burnout|apartment|graduation|miss someone)\b/.test(p)) return "lived experience";
  if (/\b(discover|hidden gem|rediscover|surprise me|deep cut)\b/.test(p)) return "discovery";
  if (p.length < 12) return "edge_case";
  if (/\b(rain|coffee|sunday|morning|evening|cozy|night)\b/.test(p)) return "scene/mood";
  if (/\b(cooking|cleaning|gaming|commute|reading|gardening|running)\b/.test(p)) return "activity";
  if (/\b(feel|miss|proud|hope|emotional|heartbroken|anxious)\b/.test(p)) return "emotional";
  if (/\b(nostalg|throwback|old favourites|school days|childhood)\b/.test(p)) return "nostalgic";
  if (/\b(gaming|minecraft|boss fight|racing game|cyberpunk)\b/.test(p)) return "gaming";
  return "scene/mood";
}

function applyDefaults(entry) {
  const cat = entry.category;
  const d = CATEGORY_DEFAULTS[cat] ?? CATEGORY_DEFAULTS["scene/mood"];
  return {
    id: entry.id,
    category: cat,
    prompt: entry.prompt,
    world: entry.world ?? d.world,
    forbidden: entry.forbidden ?? d.forbidden ?? null,
    prefer: entry.prefer ?? d.prefer,
    mode: entry.mode ?? d.mode ?? "balanced",
    length: entry.length ?? d.length ?? 25,
    source: entry.source ?? "curated",
  };
}

async function readJson(rel) {
  try {
    return JSON.parse(await readFile(path.resolve(rel), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const seen = new Set();
  const prompts = [];

  function add(raw) {
    const text = typeof raw === "string" ? raw : raw.prompt;
    if (!text || text.length < 2) return;
    const key = norm(text);
    if (seen.has(key)) return;
    seen.add(key);
    const category = inferCategory(text, raw.category);
    const id = raw.id ?? `${category.slice(0, 4)}-${slug(text)}-${String(prompts.length + 1).padStart(3, "0")}`;
    prompts.push(applyDefaults({ ...raw, prompt: text.trim(), category, id, source: raw.source }));
  }

  for (const p of CURATED) add({ ...p, source: "v6-golden-ear-validation" });

  const golden = await readJson("backend/tests/golden-prompts.data.ts");
  // golden is TS — load via regex from file
  const goldenSrc = await readFile("backend/tests/golden-prompts.data.ts", "utf8");
  for (const m of goldenSrc.matchAll(/prompt:\s*"([^"]+)"/g)) {
    add({ prompt: m[1], source: "golden-prompts.data.ts" });
  }

  const hofFiles = [
    ["backend/tests/playlist-hall-of-fame/entries.json", "hall-of-fame"],
    ["backend/tests/playlist-hall-of-fame/validation-prompts.json", "hall-of-fame-validation"],
    ["backend/tests/playlist-hall-of-fame/stress-prompts.json", "hall-of-fame-stress"],
    ["backend/tests/opening-curator-v2-benchmark/prompts.json", "opening-curator"],
  ];
  for (const [file, source] of hofFiles) {
    const data = await readJson(file);
    const rows = Array.isArray(data) ? data : data?.prompts ?? [];
    for (const row of rows) add({ ...row, source });
  }

  const pairwise = await readJson("data/corpus/pairwise-benchmark-prompts.json");
  if (Array.isArray(pairwise)) {
    for (const row of pairwise) add({ ...row, source: "pairwise-benchmark-prompts" });
  }

  const humanExp = await readJson("backend/tests/human-experience-benchmark.json");
  if (humanExp?.prompts) {
    const byCat = new Map();
    for (const row of humanExp.prompts) {
      const cat = row.category ?? "golden";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(row);
    }
    const pick = (cat, n) => (byCat.get(cat) ?? []).slice(0, n);
    for (const row of [
      ...pick("golden", 12),
      ...pick("scene", 10),
      ...pick("mood", 8),
      ...pick("activity", 8),
      ...pick("uk", 8),
      ...pick("negation", 6),
      ...pick("era", 6),
      ...pick("genre", 8),
      ...pick("vague", 6),
      ...pick("emotional", 8),
      ...pick("contradictory", 5),
    ]) {
      add({ prompt: row.prompt, category: row.category, source: "human-experience-benchmark" });
    }
  }

  // Launch-calibration & genre picks (from benchmark-prompts.ts — high-signal subset)
  const launchPicks = [
    "pub garden after work but still lively",
    "mardy rainy bus home",
    "proper gassed pres before town",
    "late night motorway in the rain",
    "lofi but not boring",
    "motorway rain 2am no destination",
    "warehouse tekk sweat concrete",
    "jungle classics but not too mad",
    "grime walk through estate",
    "old skool dubstep dark room",
    "madchester pub walk",
    "britpop sunny bus ride",
    "metal but not screamy gym",
    "winter but no christmas obviously",
    "no sad no cheesy upbeat clean room",
    "sad but I need to move",
    "party but heartbroken",
    "gym but anxious not angry",
    "city lights but not clubby",
    "old corsa night drive cheap speakers",
    "bonfire night walk home",
    "rave comedown bus home",
    "liquid dnb rainy focus",
    "speed garage night bus",
    "shoegazy rainy corridor",
    "post punk cold city",
    "hyperpop getting ready",
    "cozy minecraft rain",
    "🛣️🌧️ 2am drive",
    "💔 but dancing",
    "music for pretending life is fine",
    "playlist for a cancelled plan",
    "soundtrack to leaving town",
    "walking home after failing a job interview",
    "sitting in a hospital waiting room",
    "sunday evening anxiety before the week starts",
    "I finally handed my notice in",
    "I miss someone I shouldn't",
    "I need hope without pretending everything is okay",
    "music for cleaning the house after a breakup",
  ];
  for (const prompt of launchPicks) add({ prompt, source: "benchmark-prompts-launch-calibration" });

  // Activity scenes from world atlas filenames
  const activityScenes = [
    "aimless drive at night",
    "barbecue with mates in the garden",
    "boring work day background",
    "browsing old photos nostalgic",
    "cleaning at night calm reset",
    "coffee alone quiet morning",
    "commute home tired",
    "concert aftermath walk home",
    "cooking dinner warm evening",
    "doom scrolling 2am",
    "early shift wake up",
    "family dinner warm",
    "finally clocked off decompression",
    "finishing work relief",
    "first day at work nerves",
    "fixing things in the garage",
    "gaming late night focus",
    "gardening sunny afternoon",
    "having a bath relax",
    "last day at work bittersweet",
    "late shift exhaustion",
    "lying awake can't sleep",
    "lying on sofa lazy",
    "making tea calm moment",
    "meeting friends low key",
    "memories moment reflective",
    "night shift hollow hours",
    "night walk alone",
    "nipping out quick errand",
    "office day steady focus",
    "overtime grind",
    "painting creative flow",
    "photography golden hour walk",
    "procrastinating but need momentum",
    "pub evening lively",
    "reading quiet afternoon",
    "reorganising room fresh start",
    "restoring cars garage afternoon",
    "running morning energy",
    "sitting in car before going inside",
  ];
  for (const prompt of activityScenes) add({ prompt, category: "activity", source: "world-atlas-activities" });

  // Ensure minimum 120
  const fillers = [
    "chill", "good vibes", "i'm just existing not really living",
    "morning coffee quiet before work", "lazy sunday morning doing nothing",
    "cozy rainy night chill", "late night motorway in the rain",
    "2am petrol station fluorescent lonely", "2000s pop punk gym workout",
    "house party with friends", "walking home after failing a job interview",
    "sad party bangers", "chill but emotional", "deep focus study session no distractions",
    "music for sitting in my car after work when I don't want to go inside yet",
    "Driving home after a horrible day with rain on the windscreen",
    "60s road trip", "70s rock evening", "90s alternative rainy night",
    "2000s pop punk party", "old school hip hop", "happy sad driving night sunrise energy chill workout",
    "melancholic but moving", "lonely late night", "garage with friends Saturday night",
    "beer fixing cars chatting rubbish with mates", "sleepy gym workout", "aggressive chill evening",
    "discover new music", "songs I forgot I liked", "vibe", "winter cozy not christmas",
    "late night drive alone on the motorway reflective", "hangover sunday morning gentle recovery",
    "getting ready to go out tonight hyped", "crying in the car alone", "after the club ride home",
    "rain on windscreen night drive", "anxious but want to feel calm", "missing someone bittersweet",
    "pregame getting ready for the party", "working from home deep focus", "coding at night flow state",
    "sunset walk golden hour", "deadline crunch due tomorrow", "cozy winter evening blanket tea",
    "driving through hometown nostalgic", "self care bath relax", "garden afternoon sunny chill",
    "sad but hopeful", "not sad uplifting morning", "calm hype music for cleaning my room",
    "3am and I can't sleep but I don't want sad music",
    "cold winter evening walk without christmas music",
    "deep work focus instrumental no lyrics no vocals",
    "gym workout high energy but not EDM or techno",
    "my girlfriend broke up with me last week and I'm moving apartments this weekend and I need something for the drive that isn't too sad but also isn't pretending everything is fine",
    "Sunday reset, laundry, open windows, feeling like a new week",
    "background music for a small dinner party that won't overpower conversation",
    "post breakup healing walk — reflective but moving forward",
    "feeling a bit sad but still need to get work done",
    "shoegaze footwork hybrid for late night coding",
    "windows-down road trip singalong energy",
    "melancholy rainy afternoon staring out the window",
    "after work decompression walk home calm but not sad",
    "gentle morning yoga stretch calm uplifting",
    "optimistic commute to work with forward energy",
    "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.",
    "rainy city morning walk with reflective mood",
    "soft happy Sunday afternoon with light emotional warmth",
    "driving at sunset with open windows and golden light",
    "late night feeling",
    "music for thinking and study session focus",
    "deep focus coding session late evening electronic ambient",
    "gym confidence boost high energy workout",
    "pregame playlist before going out with friends tonight",
    "just vibes",
    "chiled out sunday moring coffe",
  ];
  for (const prompt of fillers) add({ prompt, source: "synthesized-common-spotify" });

  await mkdir(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    count: prompts.length,
    categories: Object.fromEntries(
      [...new Set(prompts.map((p) => p.category))].map((c) => [c, prompts.filter((p) => p.category === c).length]),
    ),
    prompts,
  };
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${prompts.length} prompts to ${OUT_PATH}`);
  console.log("Categories:", JSON.stringify(payload.categories));
  if (prompts.length < 100) {
    console.error(`ERROR: only ${prompts.length} prompts — need 100+`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
