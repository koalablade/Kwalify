/**
 * V15 world search keywords — cultural/scene terms for retrieval, not emotion labels.
 */

const PROMPT_WORLD_KEYWORDS: Array<{ pattern: RegExp; keywords: string[] }> = [
  {
    pattern: /\b(?:90s|1990s|nineties)\b.*\b(?:indie|road\s+trip)\b|\b(?:indie|road\s+trip)\b.*\b(?:90s|1990s|nineties)\b/i,
    keywords: ["90s", "indie", "britpop", "oasis", "blur", "pulp", "singalong", "road trip"],
  },
  {
    pattern: /\b(?:late\s+night\s+drive|long\s+drive|evening\s+drive|sunset\s+drive|something\s+for\s+driving)\b/i,
    keywords: [
      "night drive",
      "cinematic",
      "indie",
      "dream pop",
      "synth",
      "the war on drugs",
      "khruangbin",
      "cigarettes after sex",
      "post punk",
    ],
  },
  {
    pattern: /\b(?:motorway|highway|empty\s+road|windscreen|midnight\s+rain)\b/i,
    keywords: [
      "night drive",
      "cinematic",
      "synth",
      "new wave",
      "dream pop",
      "post punk",
      "ambient",
      "synthwave",
      "darkwave",
    ],
  },
  {
    pattern: /\b(?:80s|eighties)\b.*\b(?:drive|night|road)\b|\bnight\s+drive\b/i,
    keywords: [
      "new wave",
      "synth pop",
      "post punk",
      "new order",
      "depeche mode",
      "the cure",
      "synth",
      "80s",
    ],
  },
  {
    pattern: /\b(?:gym|workout|lifting|aggressive)\b/i,
    keywords: [
      "metal",
      "hard rock",
      "industrial",
      "punk",
      "nu metal",
      "thrash",
      "heavy rock",
    ],
  },
  {
    pattern: /\b(?:dad\s+rock|bbq|barbecue)\b/i,
    keywords: [
      "classic rock",
      "arena rock",
      "yacht rock",
      "heartland rock",
      "southern rock",
      "tom petty",
      "eagles",
    ],
  },
  {
    pattern: /\b(?:madchester|pub\s+walk)\b/i,
    keywords: [
      "madchester",
      "baggy",
      "stone roses",
      "happy mondays",
      "britpop",
      "indie dance",
    ],
  },
  {
    pattern: /\b(?:disco|1978|rooftop)\b/i,
    keywords: [
      "disco",
      "funk",
      "soul",
      "boogie",
      "earth wind fire",
      "donna summer",
      "chic",
    ],
  },
  {
    pattern: /\b(?:country|cowboy|road\s+trip)\b/i,
    keywords: [
      "country",
      "americana",
      "outlaw country",
      "johnny cash",
      "willie nelson",
      "chris stapleton",
    ],
  },
];

const WORLD_ID_KEYWORDS: Record<string, string[]> = {
  evening_drive_world: [
    "night drive",
    "indie",
    "dream pop",
    "cinematic",
    "the war on drugs",
    "khruangbin",
    "cigarettes after sex",
    "tame impala",
    "post punk",
    "synth",
  ],
  night_drive_world: [
    "night drive",
    "cinematic",
    "indie",
    "dream pop",
    "synth",
    "the war on drugs",
    "m83",
    "chromatics",
    "khruangbin",
    "cigarettes after sex",
    "post punk",
    "synthwave",
    "darkwave",
  ],
  road_trip_singalong_world: [
    "road trip",
    "indie",
    "classic rock",
    "singalong",
    "windows down",
    "90s",
    "britpop",
    "oasis",
    "blur",
    "pulp",
  ],
  rainy_motorway_world: ["night drive", "cinematic", "synth", "new wave", "dream pop", "post punk", "ambient"],
  "80s_night_drive_world": ["new wave", "synth pop", "post punk", "darkwave", "synth"],
  gym_rock_world: ["metal", "hard rock", "industrial", "punk", "nu metal"],
  heavy_gym_world: ["metal", "thrash", "industrial", "hardcore", "nu metal"],
  dad_rock_world: ["classic rock", "arena rock", "heartland rock", "yacht rock"],
  madchester_world: ["madchester", "baggy", "stone roses", "happy mondays"],
  disco_1970s_world: ["disco", "funk", "soul", "boogie"],
  country_world: ["country", "americana", "outlaw country"],
};

/** Resolve world-cultural search terms from prompt + committed world (not emotion). */
export function resolveWorldSearchKeywords(prompt: string, worldId?: string | null): string[] {
  const keywords = new Set<string>();
  for (const row of PROMPT_WORLD_KEYWORDS) {
    if (row.pattern.test(prompt)) {
      for (const kw of row.keywords) keywords.add(kw);
    }
  }
  if (worldId) {
    for (const kw of WORLD_ID_KEYWORDS[worldId] ?? []) keywords.add(kw);
  }
  return [...keywords];
}

/** True when genre metadata is absent — unknown, not indie. */
export function isUnknownGenreMetadata(
  genreFamily?: string | null,
  genrePrimary?: string | null,
): boolean {
  const family = String(genreFamily ?? "").trim().toLowerCase();
  const primary = String(genrePrimary ?? "").trim().toLowerCase();
  if (!family && !primary) return true;
  if (family === "unknown" || primary === "unknown") return true;
  return false;
}
