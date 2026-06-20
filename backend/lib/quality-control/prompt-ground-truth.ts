/**
 * Prompt-ground truth — expectations derived from raw prompt text only.
 * No locked intent, pipeline state, or library context.
 */

export type PromptGroundTruth = {
  prompt: string;
  explicitGenres: string[];
  explicitSubgenres: string[];
  explicitEmotions: string[];
  explicitAtmospheres: string[];
  explicitActivities: string[];
  explicitNegations: string[];
  explicitDimensions: Array<"genre" | "subgenre" | "emotion" | "atmosphere" | "activity">;
};

const GENRE_TERMS: Record<string, RegExp[]> = {
  jazz: [/\bjazz\b/i],
  classical: [/\bclassical\b/i, /\bopera\b/i, /\bsymphony\b/i],
  electronic: [/\belectronic\b/i, /\btechno\b/i, /\bhouse\b/i, /\bambient\b/i, /\bedm\b/i],
  uk_garage: [/\buk\s+garage\b/i, /\bgarage\b/i],
  hip_hop: [/\bhip[\s-]?hop\b/i, /\brap\b/i, /\bdrill\b/i, /\bgrime\b/i],
  rock: [/\brock\b/i, /\bmetal\b/i, /\bpunk\b/i],
  indie: [/\bindie\b/i],
  folk: [/\bfolk\b/i],
  country: [/\bcountry\b/i],
  soul: [/\bsoul\b/i, /\br\s*&\s*b\b/i],
};

const SUBGENRE_TERMS: Record<string, RegExp[]> = {
  uk_garage: [/\buk\s+garage\b/i],
  drill: [/\bdrill\b/i],
  grime: [/\bgrime\b/i],
  ambient: [/\bambient\b/i],
  techno: [/\btechno\b/i],
  house: [/\bhouse\b/i],
  jazz_fusion: [/\bjazz\s+fusion\b/i],
  post_punk: [/\bpost[\s-]?punk\b/i],
};

const EMOTION_TERMS: Record<string, RegExp[]> = {
  melancholy: [/\bmelanchol/i, /\bsad\b/i, /\bblue\b/i, /\bheartbreak/i],
  nostalgia: [/\bnostalg/i, /\bthrowback\b/i, /\bclassic\b/i],
  tension: [/\btense\b/i, /\btension\b/i, /\banxious\b/i, /\buneasy\b/i],
  aggression: [/\baggressive\b/i, /\bangry\b/i, /\brage\b/i],
  peace: [/\bpeace/i, /\bcalm\b/i, /\bchill\b/i, /\bsoft\b/i],
  euphoria: [/\beuphor/i, /\bbliss\b/i, /\buplifting\b/i, /\bhype\b/i],
  loneliness: [/\blonely\b/i, /\balone\b/i, /\bempty\b/i],
  longing: [/\blonging\b/i, /\byearning\b/i],
};

const ATMOSPHERE_TERMS: Record<string, RegExp[]> = {
  rainy: [/\brain/i, /\bwet\b/i, /\bstorm\b/i],
  dark: [/\bdark\b/i, /\bunderground\b/i],
  warehouse: [/\bwarehouse\b/i, /\bindustrial\b/i],
  atmospheric: [/\batmospheric\b/i, /\bambient\b/i],
  chill: [/\bchill\b/i, /\bcalm\b/i],
  nocturnal: [/\blate\s+night\b/i, /\bmidnight\b/i, /\b[234]\s?am\b/i, /\bnocturnal\b/i],
  cyberpunk: [/\bcyberpunk\b/i, /\bdystop/i, /\bneon\b/i],
};

const ACTIVITY_TERMS: Record<string, RegExp[]> = {
  driving: [/\bdriv/i, /\broad\b/i, /\bhighway\b/i, /\bcar\b/i],
  focus: [/\bfocus\b/i, /\bstudy/i, /\breading\b/i, /\bwork\b/i],
  gym: [/\bworkout\b/i, /\bgym\b/i, /\bexercise\b/i],
  party: [/\bparty\b/i, /\brave\b/i, /\bdancefloor\b/i],
  relaxing: [/\brelax/i, /\bwind\s+down\b/i],
};

const NEGATION_RE = /\b(?:no|not|without|never)\s+([a-z][\w\s-]{1,24})/gi;

function promptKeys(patterns: Record<string, RegExp[]>, prompt: string): string[] {
  return Object.entries(patterns)
    .filter(([, tests]) => tests.some((re) => re.test(prompt)))
    .map(([key]) => key);
}

function extractNegations(prompt: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  NEGATION_RE.lastIndex = 0;
  while ((match = NEGATION_RE.exec(prompt)) !== null) {
    const term = match[1]?.trim().toLowerCase();
    if (term) out.push(term.replace(/\s+/g, "_"));
  }
  return [...new Set(out)];
}

export function extractPromptGroundTruth(prompt: string): PromptGroundTruth {
  const explicitGenres = promptKeys(GENRE_TERMS, prompt);
  const explicitSubgenres = promptKeys(SUBGENRE_TERMS, prompt);
  const explicitEmotions = promptKeys(EMOTION_TERMS, prompt);
  const explicitAtmospheres = promptKeys(ATMOSPHERE_TERMS, prompt);
  const explicitActivities = promptKeys(ACTIVITY_TERMS, prompt);
  const explicitNegations = extractNegations(prompt);

  const explicitDimensions: PromptGroundTruth["explicitDimensions"] = [];
  if (explicitGenres.length > 0) explicitDimensions.push("genre");
  if (explicitSubgenres.length > 0) explicitDimensions.push("subgenre");
  if (explicitEmotions.length > 0) explicitDimensions.push("emotion");
  if (explicitAtmospheres.length > 0) explicitDimensions.push("atmosphere");
  if (explicitActivities.length > 0) explicitDimensions.push("activity");

  return {
    prompt,
    explicitGenres,
    explicitSubgenres,
    explicitEmotions,
    explicitAtmospheres,
    explicitActivities,
    explicitNegations,
    explicitDimensions,
  };
}
