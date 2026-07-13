/**
 * Human Expectation Layer — Semantic Human Moment Space.
 *
 * Interprets an arbitrary human moment as a *composition* over reusable
 * reasoning dimensions, rather than matching a fixed library of named scenes.
 * This is the generalisation layer: it must degrade gracefully for prompts it
 * has never seen ("building IKEA furniture", "holding your newborn child").
 *
 * Design notes:
 *  - No hardcoded prompt rules, no if(prompt.includes("rain")) branching. The
 *    only data is a compact anchor registry (descriptor words per dimension),
 *    which is intentionally extensible — adding a dimension = adding data.
 *  - Embedding is pluggable via `MomentEmbedder`. The default embedder is
 *    deterministic and dependency-free (word tokens + character trigrams via
 *    signed feature hashing), giving morphological generalisation past exact
 *    keyword tables (e.g. "snowfall" shares "snow", "driving" shares "drive").
 *    A neural sentence embedder can be dropped in later without touching
 *    callers by swapping the embedder passed to `interpretMoment`.
 */

import {
  DIMENSION_GROUPS,
  type DimensionGroup,
  type DimensionScore,
  type MomentDimensions,
  type MomentInterpretation,
  type SubIntent,
} from "./types";

// ── Embedder abstraction ──────────────────────────────────────────────────

export interface MomentEmbedder {
  readonly version: string;
  embed(text: string): Float64Array;
}

const EMBED_DIM = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** FNV-1a based signed hash → [index, sign]. */
function hashFeature(feature: string, dim: number): { index: number; sign: number } {
  let h = 2166136261;
  for (let i = 0; i < feature.length; i++) {
    h ^= feature.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const index = ((h % dim) + dim) % dim;
  // Second, decorrelated hash for the sign bit.
  let s = h ^ 0x9e3779b9;
  s = Math.imul(s, 2654435761);
  const sign = (s & 1) === 0 ? 1 : -1;
  return { index, sign };
}

function charTrigrams(token: string): string[] {
  if (token.length <= 3) return [token];
  const grams: string[] = [];
  const padded = `#${token}#`;
  for (let i = 0; i + 3 <= padded.length; i++) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

function l2normalize(v: Float64Array): Float64Array {
  let mag = 0;
  for (let i = 0; i < v.length; i++) mag += v[i]! * v[i]!;
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= mag;
  return v;
}

/**
 * Deterministic lexical-semantic embedder. Word tokens are weighted higher than
 * character trigrams; trigrams provide sub-word generalisation for morphology
 * and unseen inflections. Fully offline and stable across processes.
 */
export class LexicalSemanticEmbedder implements MomentEmbedder {
  readonly version = "lexical-semantic-v1";

  embed(text: string): Float64Array {
    const vec = new Float64Array(EMBED_DIM);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const { index, sign } = hashFeature(`w:${token}`, EMBED_DIM);
      vec[index]! += sign * 1.0;
      for (const gram of charTrigrams(token)) {
        const g = hashFeature(`g:${gram}`, EMBED_DIM);
        vec[g.index]! += g.sign * 0.34;
      }
    }
    return l2normalize(vec);
  }
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

// ── Dimension anchor registry (data, not rules) ─────────────────────────────
//
// Each anchor is a reusable reasoning descriptor with a small set of surface
// terms. Interpretation composes over these; it does not select a named scene.
// Keep additive: extending this list widens coverage without new code paths.

interface Anchor {
  key: string;
  group: DimensionGroup;
  terms: string[];
}

const ANCHORS: Anchor[] = [
  // emotional
  { key: "joy", group: "emotional", terms: ["joy", "joyful", "happy", "elated", "delighted", "cheerful"] },
  { key: "hope", group: "emotional", terms: ["hope", "hopeful", "optimism", "looking forward", "promise"] },
  { key: "relief", group: "emotional", terms: ["relief", "relieved", "finally", "over", "made it", "exhale"] },
  { key: "melancholy", group: "emotional", terms: ["melancholy", "wistful", "blue", "somber", "downcast"] },
  { key: "sadness", group: "emotional", terms: ["sad", "sadness", "crying", "tears", "grief", "heartbreak", "heartbroken", "loss", "losing"] },
  { key: "anger", group: "emotional", terms: ["anger", "angry", "rage", "furious", "fed up", "resent"] },
  { key: "confidence", group: "emotional", terms: ["confident", "confidence", "powerful", "unstoppable", "bold", "swagger"] },
  { key: "fear", group: "emotional", terms: ["fear", "afraid", "anxious", "anxiety", "nervous", "dread", "scared"] },
  { key: "gratitude", group: "emotional", terms: ["grateful", "gratitude", "thankful", "blessed"] },
  { key: "romance", group: "emotional", terms: ["romance", "romantic", "love", "in love", "falling in love", "crush", "intimate", "first date", "date night", "dinner date", "slow dance"] },
  { key: "comfort", group: "emotional", terms: ["comfort", "cozy", "cosy", "safe", "warm", "soothing", "calming"] },
  { key: "anticipation", group: "emotional", terms: ["anticipation", "excited", "buildup", "waiting", "about to", "before"] },
  { key: "loneliness", group: "emotional", terms: ["lonely", "loneliness", "alone", "isolated", "solitude", "empty"] },
  { key: "nostalgia", group: "emotional", terms: ["nostalgia", "nostalgic", "memory", "memories", "remember", "old days", "used to", "childhood", "throwback"] },
  { key: "wonder", group: "emotional", terms: ["wonder", "awe", "amazed", "breathtaking", "sublime", "marvel"] },
  { key: "acceptance", group: "emotional", terms: ["acceptance", "letting go", "peace", "at peace", "closure", "moving on"] },
  { key: "bittersweet", group: "emotional", terms: ["bittersweet", "happy but", "hurts", "mixed feelings", "smiling through"] },
  { key: "restlessness", group: "emotional", terms: ["restless", "can't sleep", "cant sleep", "wired", "uneasy"] },
  { key: "calm", group: "emotional", terms: ["calm", "calmness", "peaceful", "serene", "tranquil", "still", "mellow", "quiet mind"] },

  // social
  { key: "alone", group: "social", terms: ["alone", "by myself", "solo", "just me", "on my own"] },
  { key: "partner", group: "social", terms: ["partner", "lover", "date", "him", "her", "significant other", "together"] },
  { key: "friends", group: "social", terms: ["friends", "mates", "crew", "squad", "with the boys", "with the girls"] },
  { key: "family", group: "social", terms: ["family", "mum", "mom", "dad", "grandparents", "grandma", "grandpa", "kids", "newborn", "child"] },
  { key: "crowd", group: "social", terms: ["crowd", "everyone", "packed", "strangers", "people everywhere"] },
  { key: "celebration", group: "social", terms: ["celebration", "celebrate", "party", "wedding", "birthday", "graduation", "reunion"] },

  // environment
  { key: "city", group: "environment", terms: ["city", "downtown", "urban", "streets", "skyline", "metropolis", "tokyo", "london"] },
  { key: "suburbs", group: "environment", terms: ["suburbs", "neighbourhood", "backyard", "porch", "driveway"] },
  { key: "forest", group: "environment", terms: ["forest", "woods", "trees", "trail", "wilderness"] },
  { key: "beach", group: "environment", terms: ["beach", "ocean", "sea", "shore", "coast", "waves", "sand"] },
  { key: "mountains", group: "environment", terms: ["mountains", "peak", "summit", "valley", "highlands", "iceland"] },
  { key: "rain", group: "environment", terms: ["rain", "rainy", "drizzle", "downpour", "storm", "thunder"] },
  { key: "snow", group: "environment", terms: ["snow", "snowfall", "snowing", "winter", "frost", "ice", "blizzard"] },
  { key: "fog", group: "environment", terms: ["fog", "foggy", "mist", "haze", "overcast"] },
  { key: "night", group: "environment", terms: ["night", "midnight", "2am", "3am", "late night", "nocturnal", "dark"] },
  { key: "sunrise", group: "environment", terms: ["sunrise", "dawn", "morning", "early morning", "first light"] },
  { key: "sunset", group: "environment", terms: ["sunset", "dusk", "golden hour", "evening", "twilight"] },
  { key: "indoors", group: "environment", terms: ["indoors", "home", "bedroom", "room", "house", "fireplace", "kitchen"] },
  { key: "cafe", group: "environment", terms: ["cafe", "coffee shop", "coffeehouse", "barista"] },
  { key: "transit", group: "environment", terms: ["train", "airplane", "plane", "airport", "station", "commute", "bus", "subway"] },
  { key: "car", group: "environment", terms: ["car", "highway", "motorway", "road", "freeway", "petrol", "gas station"] },

  // activity
  { key: "driving", group: "activity", terms: ["driving", "drive", "cruising", "road trip", "behind the wheel"] },
  { key: "walking", group: "activity", terms: ["walking", "walk", "strolling", "wandering", "on foot"] },
  { key: "studying", group: "activity", terms: ["studying", "study", "revision", "exam", "homework", "library"] },
  { key: "focus", group: "activity", terms: ["focus", "deep focus", "concentrate", "flow state", "in the zone"] },
  { key: "coding", group: "activity", terms: ["coding", "code", "programming", "debugging", "building software"] },
  { key: "gaming", group: "activity", terms: ["gaming", "game", "playing", "grinding", "ranked"] },
  { key: "reading", group: "activity", terms: ["reading", "read", "book", "novel", "fantasy", "chapter"] },
  { key: "travel", group: "activity", terms: ["travel", "travelling", "trip", "journey", "exploring", "adventure"] },
  { key: "working", group: "activity", terms: ["working", "work", "office", "shift", "deadline"] },
  { key: "cleaning", group: "activity", terms: ["cleaning", "chores", "tidying", "housework", "laundry"] },
  { key: "cooking", group: "activity", terms: ["cooking", "cook", "baking", "kitchen", "dinner"] },
  { key: "exercising", group: "activity", terms: ["gym", "workout", "lifting", "training", "exercise", "cardio", "pr"] },
  { key: "running", group: "activity", terms: ["running", "run", "jogging", "marathon", "sprint"] },
  { key: "relaxing", group: "activity", terms: ["relaxing", "relax", "chill", "unwind", "lounging", "resting"] },
  { key: "sleeping", group: "activity", terms: ["sleep", "asleep", "falling asleep", "sleeping", "insomnia", "bedtime", "lullaby", "drift off", "drifting off", "nap"] },
  { key: "meditating", group: "activity", terms: ["meditation", "meditate", "meditating", "mindfulness", "breathe", "breathing", "yoga"] },
  { key: "grieving", group: "activity", terms: ["grieving", "mourning", "funeral", "goodbye", "lost someone"] },
  { key: "recovering", group: "activity", terms: ["recovering", "recovery", "healing", "hungover", "burnout", "aftermath"] },
  { key: "celebrating", group: "activity", terms: ["celebrating", "toast", "cheers", "victory", "won", "winning"] },
  { key: "building", group: "activity", terms: ["building", "assembling", "diy", "ikea", "furniture", "fixing"] },

  // energyTrajectory
  { key: "constant", group: "energyTrajectory", terms: ["steady", "constant", "even", "consistent"] },
  { key: "slow_rise", group: "energyTrajectory", terms: ["build up", "buildup", "slow burn", "gradual", "rising", "warm up"] },
  { key: "slow_fall", group: "energyTrajectory", terms: ["wind down", "winding down", "coming down", "comedown", "fading", "cooling off"] },
  { key: "wave", group: "energyTrajectory", terms: ["ebb and flow", "waves", "ups and downs", "rolling"] },
  { key: "explosive", group: "energyTrajectory", terms: ["explosive", "peak", "hype", "go hard", "full send", "adrenaline"] },
  { key: "steady_focus", group: "energyTrajectory", terms: ["locked in", "sustained", "grind", "steady focus"] },

  // atmosphere
  { key: "warm", group: "atmosphere", terms: ["warm", "golden", "hazy", "sun-soaked", "tender"] },
  { key: "cold", group: "atmosphere", terms: ["cold", "icy", "bleak", "stark", "frozen"] },
  { key: "dreamlike", group: "atmosphere", terms: ["dreamy", "dreamlike", "ethereal", "floaty", "surreal"] },
  { key: "cinematic", group: "atmosphere", terms: ["cinematic", "epic", "sweeping", "film", "movie", "grand"] },
  { key: "intimate", group: "atmosphere", terms: ["intimate", "close", "personal", "whispered", "quiet"] },
  { key: "minimal", group: "atmosphere", terms: ["minimal", "sparse", "stripped", "bare", "empty space"] },
  { key: "chaotic", group: "atmosphere", terms: ["chaotic", "frantic", "messy", "overwhelming", "noise"] },
  { key: "urban_atmos", group: "atmosphere", terms: ["gritty", "neon", "concrete", "street", "underground"] },
  { key: "natural_atmos", group: "atmosphere", terms: ["organic", "earthy", "natural", "acoustic space", "open air"] },
  { key: "airy", group: "atmosphere", terms: ["airy", "spacious", "light", "breezy", "open"] },
  { key: "dense", group: "atmosphere", terms: ["dense", "heavy", "thick", "wall of sound", "layered"] },

  // lyrical
  { key: "instrumental_lyric", group: "lyrical", terms: ["instrumental", "no lyrics", "no vocals", "wordless"] },
  { key: "storytelling_lyric", group: "lyrical", terms: ["storytelling", "lyrics", "words", "poetry", "narrative", "deep lyrics"] },
  { key: "minimal_lyric", group: "lyrical", terms: ["minimal lyrics", "few words", "repetitive"] },
  { key: "vocal_forward", group: "lyrical", terms: ["vocals", "singing", "voice", "sing along", "singalong", "vocal"] },

  // production
  { key: "acoustic_prod", group: "production", terms: ["acoustic", "unplugged", "guitar", "piano", "strings", "organic recording"] },
  { key: "analogue_prod", group: "production", terms: ["analogue", "analog", "vinyl", "tape", "vintage", "warm production"] },
  { key: "electronic_prod", group: "production", terms: ["electronic", "synth", "synths", "programmed", "digital", "beats"] },
  { key: "ambient_prod", group: "production", terms: ["ambient", "atmospheric", "drone", "soundscape", "textures", "reverb"] },
  { key: "raw_prod", group: "production", terms: ["raw", "lo-fi", "lofi", "distorted", "gritty production", "rough"] },
  { key: "polished_prod", group: "production", terms: ["polished", "clean", "produced", "glossy", "pristine"] },

  // era
  { key: "timeless_era", group: "era", terms: ["timeless", "classic", "any era"] },
  { key: "modern_era", group: "era", terms: ["modern", "current", "new", "today", "contemporary"] },
  { key: "retro_era", group: "era", terms: ["retro", "vintage", "old school", "oldies"] },
  { key: "eighties_era", group: "era", terms: ["80s", "eighties", "1980s"] },
  { key: "nineties_era", group: "era", terms: ["90s", "nineties", "1990s"] },
  { key: "y2k_era", group: "era", terms: ["2000s", "y2k", "early 2000s", "noughties"] },
  { key: "future_era", group: "era", terms: ["futuristic", "future", "next gen", "forward"] },

  // discovery
  { key: "comfort_disc", group: "discovery", terms: ["favourites", "favorites", "comfort", "familiar", "the classics", "songs i know"] },
  { key: "exploration_disc", group: "discovery", terms: ["discover", "discovery", "new music", "hidden gems", "deep cuts", "something new", "new to me"] },
  { key: "mixed_disc", group: "discovery", terms: ["mix it up", "variety", "surprise me", "bit of everything"] },
];

// Precompute anchor embeddings once (module-level, deterministic).
let ANCHOR_EMB_CACHE: Map<string, { anchor: Anchor; emb: Float64Array }> | null = null;

function anchorEmbeddings(embedder: MomentEmbedder): Map<string, { anchor: Anchor; emb: Float64Array }> {
  // Cache only for the default embedder version to avoid cross-embedder bleed.
  if (embedder instanceof LexicalSemanticEmbedder && ANCHOR_EMB_CACHE) {
    return ANCHOR_EMB_CACHE;
  }
  const map = new Map<string, { anchor: Anchor; emb: Float64Array }>();
  for (const anchor of ANCHORS) {
    map.set(anchor.key, { anchor, emb: embedder.embed(anchor.terms.join(" ")) });
  }
  if (embedder instanceof LexicalSemanticEmbedder) ANCHOR_EMB_CACHE = map;
  return map;
}

// ── Interpretation ──────────────────────────────────────────────────────────

export interface InterpretMomentOptions {
  embedder?: MomentEmbedder;
  /**
   * Optional seed signals from the existing engine (reused, never duplicated).
   * When provided, emotional dimensions are anchored to the resolved profile so
   * the interpreter agrees with the pipeline rather than competing with it.
   */
  seed?: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  };
}

const SALIENCE_FLOOR = 0.12;
const DIRECT_HIT_WEIGHT = 0.55;
const EMBED_WEIGHT = 0.45;
/**
 * Embedding-only matches (no lexical grounding) must clear a high affinity bar
 * before they register at all, and are damped so they cannot outweigh grounded
 * evidence. This trades some generalisation for precision (deliberate: the
 * deterministic trigram space is noisy for out-of-vocabulary tokens).
 */
const EMB_ONLY_MIN_AFFINITY = 0.4;
const EMB_ONLY_DAMPEN = 0.6;

/**
 * Whole-word / whole-phrase match against a normalised, space-padded prompt.
 * Avoids substring false positives (e.g. "her" inside "there", "pr" inside
 * "surprise") that would otherwise inflate direct-hit salience and defeat
 * novel-prompt detection.
 */
function directLexicalHit(paddedVibeNorm: string, anchor: Anchor): number {
  let hits = 0;
  for (const term of anchor.terms) {
    const termNorm = tokenize(term).join(" ");
    if (termNorm.length === 0) continue;
    if (paddedVibeNorm.includes(` ${termNorm} `)) hits += 1;
  }
  if (hits === 0) return 0;
  // Diminishing returns; one strong hit already saturates most of the signal.
  return Math.min(1, 0.6 + (hits - 1) * 0.2);
}

function softmax(values: number[], temperature: number): number[] {
  if (values.length === 0) return [];
  const scaled = values.map((v) => v / Math.max(temperature, 1e-6));
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, x) => s + x, 0) || 1;
  return exps.map((x) => x / sum);
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const READABLE_KEY: Record<string, string> = {
  slow_rise: "slow-building",
  slow_fall: "wind-down",
  steady_focus: "sustained focus",
  urban_atmos: "urban",
  natural_atmos: "organic",
  instrumental_lyric: "instrumental",
  storytelling_lyric: "lyric-driven",
  minimal_lyric: "minimal-lyric",
  vocal_forward: "vocal-forward",
  acoustic_prod: "acoustic",
  analogue_prod: "analogue",
  electronic_prod: "electronic",
  ambient_prod: "ambient",
  raw_prod: "raw",
  polished_prod: "polished",
  comfort_disc: "familiar",
  exploration_disc: "exploratory",
  mixed_disc: "varied",
  timeless_era: "timeless",
  modern_era: "modern",
  retro_era: "retro",
  eighties_era: "80s",
  nineties_era: "90s",
  y2k_era: "2000s",
  future_era: "futuristic",
};

function readable(key: string): string {
  return READABLE_KEY[key] ?? key.replace(/_/g, " ");
}

/**
 * Interpret a human moment into a compositional dimension profile plus ranked
 * lived-experience candidates. Generalises to unseen prompts: when direct
 * lexical coverage is weak the embedding affinity carries interpretation, and
 * `novelPrompt` is flagged so downstream stages can widen tolerance.
 */
export function interpretMoment(
  vibe: string,
  opts: InterpretMomentOptions = {},
): MomentInterpretation {
  const embedder = opts.embedder ?? new LexicalSemanticEmbedder();
  const paddedVibeNorm = ` ${tokenize(vibe).join(" ")} `;
  const promptEmb = embedder.embed(vibe);
  const anchors = anchorEmbeddings(embedder);

  const scores: Record<string, number> = {};
  const byGroup: Record<DimensionGroup, DimensionScore[]> = {
    emotional: [],
    social: [],
    environment: [],
    activity: [],
    energyTrajectory: [],
    atmosphere: [],
    lyrical: [],
    production: [],
    era: [],
    discovery: [],
  };

  let peakSalience = 0;
  let peakDirect = 0;

  for (const { anchor, emb } of anchors.values()) {
    const embAffinity = Math.max(0, cosine(promptEmb, emb));
    const direct = directLexicalHit(paddedVibeNorm, anchor);
    peakDirect = Math.max(peakDirect, direct);
    const grounded = direct > 0;

    let salience: number;
    if (grounded) {
      // Grounded anchors: direct hit is the backbone; embedding gently boosts.
      salience = direct * DIRECT_HIT_WEIGHT + embAffinity * EMBED_WEIGHT;
    } else {
      // Embedding-only: must be strong, and is damped below grounded range.
      if (embAffinity < EMB_ONLY_MIN_AFFINITY) continue;
      salience = embAffinity * EMBED_WEIGHT * EMB_ONLY_DAMPEN;
    }
    if (salience < SALIENCE_FLOOR) continue;
    scores[anchor.key] = salience;
    byGroup[anchor.group].push({ key: anchor.key, group: anchor.group, weight: salience, grounded });
    peakSalience = Math.max(peakSalience, salience);
  }

  // Anchor emotional dimensions to the engine's resolved profile when seeded.
  if (opts.seed) {
    const seedPairs: Array<[string, number | undefined]> = [
      ["nostalgia", opts.seed.nostalgia],
      ["comfort", opts.seed.calm],
    ];
    for (const [key, value] of seedPairs) {
      if (typeof value === "number" && value > 0.45) {
        const boosted = Math.max(scores[key] ?? 0, value * 0.6);
        scores[key] = boosted;
        const group: DimensionGroup = "emotional";
        const existing = byGroup[group].find((d) => d.key === key);
        if (existing) {
          existing.weight = boosted;
          existing.grounded = true;
        } else {
          byGroup[group].push({ key, group, weight: boosted, grounded: true });
        }
        peakSalience = Math.max(peakSalience, boosted);
      }
    }
  }

  for (const group of DIMENSION_GROUPS) {
    byGroup[group].sort((a, b) => b.weight - a.weight);
  }

  const novelPrompt = peakDirect < 0.5;

  const candidates = buildCandidates(byGroup, peakSalience, novelPrompt);

  return {
    vibe,
    candidates,
    dimensions: { scores, byGroup },
    embedderVersion: embedder.version,
    novelPrompt,
    peakSalience,
  };
}

/**
 * Derive multiple plausible lived experiences from the dimension composition.
 * Each candidate is seeded by a dominant emotional/atmosphere descriptor and
 * fleshed out with co-activated context (environment / activity / trajectory).
 * This encodes "humans mean several things" without any named-scene lookup.
 */
function buildCandidates(
  byGroup: Record<DimensionGroup, DimensionScore[]>,
  peakSalience: number,
  novelPrompt: boolean,
): SubIntent[] {
  // Labels/context are built ONLY from lexically grounded evidence so we never
  // fabricate descriptors that the user did not imply (embedding-only noise).
  const groundedTop = (group: DimensionGroup): DimensionScore | undefined =>
    byGroup[group].find((d) => d.grounded);

  const seeds = [...byGroup.emotional, ...byGroup.atmosphere]
    .filter((s) => s.grounded && s.weight >= SALIENCE_FLOOR)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const context: DimensionScore[] = [
    groundedTop("environment"),
    groundedTop("activity"),
    groundedTop("social"),
    groundedTop("energyTrajectory"),
  ].filter((d): d is DimensionScore => !!d);

  const contextLabel = context
    .slice(0, 2)
    .map((d) => readable(d.key))
    .join(" ");

  if (seeds.length === 0) {
    // No emotional/atmosphere signal — fall back to context, or "open moment".
    const label = contextLabel.length > 0 ? titleCase(contextLabel) : "Open interpretation";
    const characteristics = context.map((d) => readable(d.key));
    return [
      {
        label,
        confidence: 1,
        characteristics: characteristics.length > 0 ? characteristics : ["ambiguous"],
        dominantGroups: context.map((d) => d.group),
      },
    ];
  }

  const confidences = softmax(
    seeds.map((s) => s.weight),
    novelPrompt ? 0.55 : 0.35,
  );

  const candidates: SubIntent[] = seeds.map((seed, i) => {
    const characteristics = [
      readable(seed.key),
      ...context.map((d) => readable(d.key)),
    ];
    const seedLabel = readable(seed.key);
    const label =
      contextLabel.length > 0 ? `${titleCase(seedLabel)} ${contextLabel}` : titleCase(seedLabel);
    const dominantGroups = Array.from(
      new Set<DimensionGroup>([seed.group, ...context.map((d) => d.group)]),
    );
    return {
      label,
      confidence: confidences[i] ?? 0,
      characteristics: Array.from(new Set(characteristics)),
      dominantGroups,
    };
  });

  // When interpretation is weak/ambiguous, acknowledge an explicit open reading.
  if ((novelPrompt || peakSalience < 0.35) && candidates.length < 3) {
    candidates.push({
      label: "Broader open reading",
      confidence: 0,
      characteristics: ["ambiguous", "generalised from phrasing"],
      dominantGroups: [],
    });
    // Renormalise confidences across the appended candidate.
    const total = candidates.reduce((s, c) => s + c.confidence, 0) || 1;
    for (const c of candidates) c.confidence = c.confidence / total;
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
