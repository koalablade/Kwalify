/**
 * Master culture library — decades, genres, moods, personality, gaming, internet.
 */

import { tagBatch, tagKw } from "./tag-keyword-helpers";
import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

const DECADES: ExtendedVibeKeyword[] = tagBatch(
  ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "50s", "60s", "70s", "80s", "90s", "00s"],
  { nostalgia: 0.25, energy: 0.0 },
  undefined,
  true
);

const ERA_FEELINGS: ExtendedVibeKeyword[] = [
  ...tagBatch(
    [
      "golden oldies",
      "swinging sixties",
      "summer of love",
      "disco era",
      "new wave era",
      "hair metal era",
      "y2k",
      "myspace era",
      "indie sleaze",
      "tumblr era",
      "soundcloud era",
      "covid era",
      "streaming generation",
    ],
    { nostalgia: 0.3 },
    undefined,
    true
  ),
  tagKw("britpop era", { nostalgia: 0.35, valence: 0.1, energy: 0.08 }, undefined, true),
];

const GENRE_FAMILIES: ExtendedVibeKeyword[] = tagBatch(
  [
    "rock",
    "pop",
    "hip hop",
    "rap",
    "r&b",
    "rnb",
    "soul",
    "funk",
    "jazz",
    "blues",
    "country",
    "folk",
    "electronic",
    "dance",
    "house",
    "techno",
    "garage",
    "drum and bass",
    "dnb",
    "dubstep",
    "reggae",
    "ska",
    "punk",
    "metal",
    "classical",
    "ambient",
    "soundtrack",
    "world music",
    "latin",
    "afrobeats",
    "k-pop",
    "kpop",
    "j-pop",
    "indie",
    "alternative",
  ],
  { nostalgia: 0.05 },
  undefined,
  true
);

const ROCK_SUB: ExtendedVibeKeyword[] = tagBatch(
  [
    "classic rock",
    "hard rock",
    "soft rock",
    "arena rock",
    "dad rock",
    "indie rock",
    "britpop",
    "post-punk",
    "pop punk",
    "emo",
    "grunge",
    "shoegaze",
    "psychedelic rock",
    "nu metal",
  ],
  { energy: 0.08, nostalgia: 0.1 },
  undefined,
  true
);

const ELECTRONIC_SUB: ExtendedVibeKeyword[] = tagBatch(
  [
    "deep house",
    "tech house",
    "trance",
    "eurodance",
    "minimal techno",
    "liquid dnb",
    "jungle",
    "uk garage",
    "2-step",
    "future bass",
    "synthwave",
    "vaporwave",
    "lofi",
    "lo-fi",
    "chillstep",
    "hardstyle",
  ],
  { energy: 0.1, calm: 0.05 },
  undefined,
  true
);

const HIP_HOP: ExtendedVibeKeyword[] = tagBatch(
  [
    "boom bap",
    "conscious rap",
    "trap",
    "drill",
    "uk drill",
    "grime",
    "jazz rap",
    "lo-fi hip hop",
    "melodic rap",
    "emo rap",
    "soundcloud rap",
    "old school rap",
  ],
  { energy: 0.1, tension: 0.05 },
  undefined,
  true
);

const SOUL_RNB: ExtendedVibeKeyword[] = tagBatch(
  ["motown", "northern soul", "neo soul", "quiet storm", "slow jams", "gospel soul"],
  { valence: 0.1, nostalgia: 0.2, calm: 0.1 },
  undefined,
  true
);

const POP: ExtendedVibeKeyword[] = tagBatch(
  ["teen pop", "dance pop", "electropop", "indie pop", "synth pop", "y2k pop", "sad pop", "anthemic pop"],
  { valence: 0.1, energy: 0.08 },
  undefined,
  true
);

const JAZZ: ExtendedVibeKeyword[] = tagBatch(
  ["smooth jazz", "bebop", "cool jazz", "vocal jazz", "late night jazz", "cafe jazz", "lounge jazz"],
  { calm: 0.2, energy: -0.1, valence: 0.05 },
  undefined,
  true
);

const MOODS: ExtendedVibeKeyword[] = tagBatch(
  [
    "hopeful",
    "optimistic",
    "melancholic",
    "heartbroken",
    "powerful",
    "comforted",
    "restless",
    "dreamy",
    "euphoric",
    "reflective",
    "lost",
    "healing",
  ],
  { energy: 0, valence: 0, tension: 0, nostalgia: 0, calm: 0 }
).map((k) => {
  const t = k.terms[0]!.toLowerCase();
  const w = { ...k.weights };
  if (t.includes("hope") || t.includes("optim")) Object.assign(w, { valence: 0.2, tension: -0.1 });
  if (t.includes("melanchol") || t.includes("heart")) Object.assign(w, { valence: -0.2, nostalgia: 0.2 });
  if (t.includes("power")) Object.assign(w, { energy: 0.25, valence: 0.15 });
  if (t.includes("comfort")) Object.assign(w, { calm: 0.25, valence: 0.1 });
  if (t.includes("restless")) Object.assign(w, { tension: 0.2, energy: 0.1 });
  if (t.includes("dream")) Object.assign(w, { calm: 0.2, energy: -0.1 });
  if (t.includes("euphor")) Object.assign(w, { valence: 0.3, energy: 0.25 });
  if (t.includes("reflect") || t.includes("heal")) Object.assign(w, { calm: 0.15, nostalgia: 0.15 });
  if (t.includes("lost")) Object.assign(w, { valence: -0.1, tension: 0.15 });
  return { ...k, weights: w };
});

const ENERGY_LEVELS: ExtendedVibeKeyword[] = [
  ...tagBatch(["sleepy", "low energy"], { energy: -0.3, calm: 0.2 }),
  ...tagBatch(["relaxed", "steady", "balanced"], { energy: -0.1, calm: 0.15 }),
  ...tagBatch(["upbeat", "energetic", "high energy"], { energy: 0.25, valence: 0.1 }),
  ...tagBatch(["adrenaline", "explosive", "chaotic energy"], { energy: 0.4, tension: 0.15 }),
];

const PERSONALITY: ExtendedVibeKeyword[] = tagBatch(
  [
    "main character",
    "old soul",
    "hopeless romantic",
    "dreamer",
    "night owl",
    "adventurer",
    "rebel",
    "outsider",
    "overthinker",
    "free spirit",
    "workaholic",
    "introvert",
    "extrovert",
  ],
  { nostalgia: 0.05 }
);

const GAMING: ExtendedVibeKeyword[] = [
  ...tagBatch(
    ["xbox 360 era", "ps2 nostalgia", "minecraft nostalgia", "call of duty nights", "online friends"],
    { nostalgia: 0.35 },
    { timeOfDay: "late_night" }
  ),
  ...tagBatch(["gaming marathon", "ranked grind", "lan party"], { energy: 0.15, tension: 0.1 }),
];

const INTERNET: ExtendedVibeKeyword[] = tagBatch(
  ["myspace", "tumblr", "vine", "early youtube", "facebook era", "spotify generation", "tiktok era"],
  { nostalgia: 0.35 },
  undefined,
  true
);

const TRAVEL: ExtendedVibeKeyword[] = [
  tagKw("red-eye flight", { energy: -0.15, calm: 0.15 }, { motionState: "transit", timeOfDay: "late_night" }),
  tagKw("hotel room", { calm: 0.2, nostalgia: 0.1 }, { environment: "indoor" }),
  tagKw("city break", { valence: 0.1, energy: 0.1 }, { environment: "urban" }),
  tagKw("backpacking", { valence: 0.1, energy: 0.1 }, { motionState: "walking" }),
  tagKw("solo travel", { nostalgia: 0.2, calm: 0.1 }),
  tagKw("leaving home", { nostalgia: 0.3, tension: 0.15 }),
];

const CAR_CULTURE: ExtendedVibeKeyword[] = [
  tagKw("classic car cruise", { nostalgia: 0.35, valence: 0.1 }, { motionState: "driving" }),
  tagKw("convertible weather", { valence: 0.2, energy: 0.1 }, { motionState: "driving" }),
  tagKw("car meet", { energy: 0.15, valence: 0.1 }),
  tagKw("sunday drive", { calm: 0.2, nostalgia: 0.25 }, { motionState: "driving" }),
  tagKw("driving to clear your head", { calm: 0.15, nostalgia: 0.2 }, { motionState: "driving" }),
  tagKw("driving after midnight", { nostalgia: 0.35, energy: 0.0 }, { motionState: "driving", timeOfDay: "late_night" }),
];

const HUMAN_EXP: ExtendedVibeKeyword[] = [
  ...tagBatch(["overthinking", "feeling stuck"], { tension: 0.2, energy: -0.05 }),
  ...tagBatch(["missing home", "homesick"], { nostalgia: 0.3, valence: -0.1 }),
  ...tagBatch(["finding yourself", "new beginnings", "growing up"], { valence: 0.1, nostalgia: 0.15 }),
  ...tagBatch(["grieving", "acceptance", "closure"], { valence: -0.15, calm: 0.15 }),
  ...tagBatch(["freedom", "escape", "belonging", "loneliness", "connection", "wonder", "growth", "reinvention"], {
    energy: 0,
    valence: 0,
    nostalgia: 0.1,
  }),
];

export const MASTER_CULTURE_KEYWORDS: ExtendedVibeKeyword[] = [
  ...DECADES,
  ...ERA_FEELINGS,
  ...GENRE_FAMILIES,
  ...ROCK_SUB,
  ...ELECTRONIC_SUB,
  ...HIP_HOP,
  ...SOUL_RNB,
  ...POP,
  ...JAZZ,
  ...MOODS,
  ...ENERGY_LEVELS,
  ...PERSONALITY,
  ...GAMING,
  ...INTERNET,
  ...TRAVEL,
  ...CAR_CULTURE,
  ...HUMAN_EXP,
];
