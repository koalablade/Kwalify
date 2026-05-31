// ─── EMOTION ENGINE ───────────────────────────────────────────────────────────
// Analyses a free-text vibe string and converts it into a structured
// EmotionProfile that drives playlist scoring.

export interface EmotionProfile {
  energy: number;
  valence: number;
  tension: number;
  nostalgia: number;
  calm: number;
  environment: string | null;
  timeOfDay: string | null;
  motionState: string | null;
}

interface SceneContext {
  environment: string | null;
  timeOfDay: string | null;
  motionState: string | null;
  intensityBoost: number;
}

interface VibeKeyword {
  terms: string[];
  weights: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  };
  sceneHints?: Partial<SceneContext>;
  artistOrGenreCue?: boolean;
  exactMatch?: boolean;
}

// ─── INTENSIFIER DETECTION ────────────────────────────────────────────────────

const INTENSIFIER_SCALES: Array<{ pattern: RegExp; scale: number }> = [
  { pattern: /\bextremely\b|\binsanely\b|\babsolutely\b|\bcompletely\b/i, scale: 1.6 },
  { pattern: /\bvery\b|\breally\b|\bso\b|\bsuper\b|\bdeeply\b|\bintensely\b/i, scale: 1.35 },
  { pattern: /\bquite\b|\bpretty\b|\brather\b|\bfairly\b/i, scale: 1.15 },
  { pattern: /\ba\s+bit\b|\bslightly\b|\ba\s+little\b|\bsomewhat\b/i, scale: 0.7 },
  { pattern: /\bhardly\b|\bbarely\b|\bscarcely\b/i, scale: 0.4 },
];

function getIntensifierScale(text: string): number {
  for (const { pattern, scale } of INTENSIFIER_SCALES) {
    if (pattern.test(text)) return scale;
  }
  return 1.0;
}

// ─── NEGATION DETECTION ───────────────────────────────────────────────────────

const NEGATION_PATTERNS = [
  /\bnot\s+(\w+)/gi,
  /\bno\s+(\w+)/gi,
  /\bwithout\s+(\w+)/gi,
  /\bnever\s+(\w+)/gi,
  /\bdon't\s+feel\s+(\w+)/gi,
  /\bdon't\s+want\s+(\w+)/gi,
];

function extractNegatedTerms(text: string): Set<string> {
  const negated = new Set<string>();
  for (const pattern of NEGATION_PATTERNS) {
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(text)) !== null) {
      if (match[1]) negated.add(match[1].toLowerCase());
    }
  }
  return negated;
}

function detectContradictionBoost(text: string): number {
  const contradictionPhrases = [
    /happy.*sad|sad.*happy/i,
    /love.*hate|hate.*love/i,
    /excited.*anxious|anxious.*excited/i,
    /nostalgic.*hopeful|hopeful.*nostalgic/i,
    /calm.*restless|restless.*calm/i,
    /bittersweet/i,
    /love-hate/i,
    /mixed feelings/i,
    /don't know how (i|to) feel/i,
  ];
  let boost = 0;
  for (const phrase of contradictionPhrases) {
    if (phrase.test(text)) boost += 0.12;
  }
  return Math.min(boost, 0.3);
}

function computeEmotionalDepth(text: string): number {
  const wordCount = text.split(/\s+/).length;
  const hasSubclauses = /,|;|because|although|even though|despite|while/i.test(text);
  const hasMeta = /feel(ing)?|emotion|mood|vibe|sense/i.test(text);
  let depth = 0;
  if (wordCount > 5) depth += 0.1;
  if (wordCount > 12) depth += 0.1;
  if (hasSubclauses) depth += 0.15;
  if (hasMeta) depth += 0.1;
  return Math.min(depth, 0.4);
}

// ─── SCENE DETECTION ─────────────────────────────────────────────────────────

const SCENE_PATTERNS: Array<{
  pattern: RegExp;
  environment?: string;
  timeOfDay?: string;
  motionState?: string;
}> = [
  { pattern: /\bdriving\b|\bhighway\b|\bmotorway\b|\bcar\b|\bcommute\b/i, environment: "urban", motionState: "driving" },
  { pattern: /\bwalk(ing)?\b/i, motionState: "walking" },
  { pattern: /\brun(ning)?\b|\bjogging\b/i, motionState: "running" },
  { pattern: /\btrain\b|\bsubway\b|\bmetro\b|\bbus\b/i, environment: "transit", motionState: "transit" },
  { pattern: /\bplane\b|\bflight\b|\bairport\b/i, environment: "transit", motionState: "transit" },
  { pattern: /\bcity\b|\burban\b|\bstreet\b|\bdowntown\b|\balley\b/i, environment: "urban" },
  { pattern: /\bforest\b|\bwoods\b|\bhike\b|\btrail\b|\bnature\b|\bpark\b/i, environment: "nature" },
  { pattern: /\beach\b|\bocean\b|\bsea\b|\bcoast\b|\bwaves?\b/i, environment: "coastal" },
  { pattern: /\brainy?\b|\brain(fall)?\b|\bstorm\b|\bthunder\b/i, environment: "rainy" },
  { pattern: /\bsnow\b|\bwinter storm\b|\bblizzard\b/i, environment: "winter" },
  { pattern: /\bhome\b|\bbedroom\b|\broom\b|\bindoors?\b/i, environment: "indoor" },
  { pattern: /\bcafe\b|\bcoffee shop\b|\bbar\b|\brestaurant\b/i, environment: "social_indoor" },
  { pattern: /\b2\s*am\b|\blate night\b|\bafter midnight\b|\bdeep night\b|\bdead of night\b/i, timeOfDay: "late_night" },
  { pattern: /\bmidnight\b|\b1\s*am\b|\b3\s*am\b|\b4\s*am\b/i, timeOfDay: "late_night" },
  { pattern: /\bmorning\b|\bsunrise\b|\bdawn\b|\bearly\b/i, timeOfDay: "morning" },
  { pattern: /\bafternoon\b|\bmidday\b|\bnoon\b/i, timeOfDay: "afternoon" },
  { pattern: /\bsunset\b|\bdusk\b|\bgolden hour\b|\bevening\b/i, timeOfDay: "evening" },
  { pattern: /\bnight\b|\bnight time\b/i, timeOfDay: "night" },
];

function detectScene(text: string): SceneContext {
  const ctx: SceneContext = {
    environment: null,
    timeOfDay: null,
    motionState: null,
    intensityBoost: 0,
  };

  for (const { pattern, environment, timeOfDay, motionState } of SCENE_PATTERNS) {
    if (pattern.test(text)) {
      if (environment && !ctx.environment) ctx.environment = environment;
      if (timeOfDay && !ctx.timeOfDay) ctx.timeOfDay = timeOfDay;
      if (motionState && !ctx.motionState) ctx.motionState = motionState;
    }
  }

  // Motion boosts energy slightly
  if (ctx.motionState === "running") ctx.intensityBoost = 0.15;
  else if (ctx.motionState === "driving") ctx.intensityBoost = 0.08;

  return ctx;
}

function applySceneWeights(
  profile: EmotionProfile,
  scene: SceneContext
): EmotionProfile {
  const p = { ...profile };

  if (scene.environment === "rainy") {
    p.energy = clamp(p.energy - 0.08);
    p.valence = clamp(p.valence - 0.06);
    p.calm = clamp(p.calm + 0.07);
    p.tension = clamp(p.tension + 0.05);
  }
  if (scene.environment === "nature") {
    p.calm = clamp(p.calm + 0.1);
    p.tension = clamp(p.tension - 0.08);
  }
  if (scene.environment === "urban") {
    p.energy = clamp(p.energy + 0.06);
    p.tension = clamp(p.tension + 0.04);
  }
  if (scene.environment === "coastal") {
    p.calm = clamp(p.calm + 0.08);
    p.valence = clamp(p.valence + 0.05);
  }
  if (scene.environment === "indoor") {
    p.calm = clamp(p.calm + 0.05);
    p.energy = clamp(p.energy - 0.04);
  }
  if (scene.timeOfDay === "late_night") {
    p.energy = clamp(p.energy - 0.12);
    p.nostalgia = clamp(p.nostalgia + 0.1);
    p.tension = clamp(p.tension + 0.06);
    p.calm = clamp(p.calm - 0.04);
  }
  if (scene.timeOfDay === "morning") {
    p.energy = clamp(p.energy + 0.08);
    p.valence = clamp(p.valence + 0.06);
    p.calm = clamp(p.calm + 0.04);
  }
  if (scene.timeOfDay === "evening") {
    p.nostalgia = clamp(p.nostalgia + 0.08);
    p.calm = clamp(p.calm + 0.05);
    p.energy = clamp(p.energy - 0.05);
  }
  if (scene.timeOfDay === "night") {
    p.energy = clamp(p.energy - 0.06);
    p.nostalgia = clamp(p.nostalgia + 0.06);
  }
  if (scene.motionState === "driving") {
    p.energy = clamp(p.energy + 0.07);
    p.tension = clamp(p.tension + 0.03);
  }
  if (scene.motionState === "running") {
    p.energy = clamp(p.energy + 0.15);
    p.tension = clamp(p.tension + 0.04);
  }

  p.energy = clamp(p.energy + scene.intensityBoost);

  return p;
}

// ─── VIBE KEYWORD BANK ───────────────────────────────────────────────────────

const VIBE_KEYWORDS: VibeKeyword[] = [
  // ── Core Moods ──────────────────────────────────────────────────────────────
  {
    terms: ["2am", "2 am", "late night", "insomnia", "can't sleep", "sleepless", "up late", "3am", "4am"],
    weights: { energy: -0.35, valence: -0.15, tension: 0.25, nostalgia: 0.2, calm: -0.1 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["motorway", "highway", "driving at night", "long drive", "road trip", "open road"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.05, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { motionState: "driving" },
  },
  {
    terms: ["rainy", "rain", "raining", "drizzle", "stormy", "grey day", "overcast", "pouring"],
    weights: { energy: -0.2, valence: -0.15, calm: 0.15, tension: 0.08, nostalgia: 0.12 },
    sceneHints: { environment: "rainy" },
  },
  {
    terms: ["alone", "lonely", "by myself", "solitude", "isolated", "on my own", "just me"],
    weights: { energy: -0.2, valence: -0.2, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
  },
  {
    terms: ["argument", "fight", "conflict", "angry", "pissed off", "frustrated", "rage", "furious"],
    weights: { energy: 0.3, valence: -0.35, tension: 0.45, nostalgia: -0.05, calm: -0.35 },
  },
  {
    terms: ["sad", "sadness", "depressed", "depression", "down", "blue", "melancholy", "miserable", "unhappy", "sorrow"],
    weights: { energy: -0.3, valence: -0.4, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
  },
  {
    terms: ["happy", "happiness", "joy", "joyful", "elated", "great", "good vibes", "positive", "upbeat"],
    weights: { energy: 0.2, valence: 0.45, tension: -0.2, nostalgia: -0.05, calm: 0.1 },
  },
  {
    terms: ["nostalgic", "nostalgia", "throwback", "memories", "remember when", "back then", "old times", "miss those days"],
    weights: { energy: -0.1, valence: 0.05, tension: -0.05, nostalgia: 0.5, calm: 0.08 },
  },
  {
    terms: ["villain", "villain arc", "villain mode", "evil", "menacing", "sinister", "dark energy"],
    weights: { energy: 0.3, valence: -0.2, tension: 0.4, nostalgia: -0.1, calm: -0.3 },
  },
  {
    terms: ["chill", "chilled", "chilling", "relaxed", "relaxing", "mellow", "laid back", "easy going", "low key"],
    weights: { energy: -0.25, valence: 0.15, tension: -0.25, nostalgia: 0.05, calm: 0.4 },
  },
  {
    terms: ["party", "partying", "club", "clubbing", "dancing", "dance", "turn up", "hype", "rave", "festival"],
    weights: { energy: 0.5, valence: 0.35, tension: 0.1, nostalgia: -0.1, calm: -0.35 },
  },
  {
    terms: ["morning", "sunrise", "dawn", "fresh start", "new day", "wake up", "breakfast"],
    weights: { energy: 0.15, valence: 0.2, tension: -0.15, nostalgia: 0.08, calm: 0.2 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["sunset", "golden hour", "dusk", "end of day", "evening glow"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.08, nostalgia: 0.25, calm: 0.2 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["city", "urban", "street", "downtown", "metropolitan", "cityscape", "city lights"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.1, nostalgia: 0.1, calm: -0.1 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["nature", "outdoors", "forest", "woods", "hiking", "mountains", "countryside"],
    weights: { energy: 0.05, valence: 0.15, tension: -0.15, nostalgia: 0.1, calm: 0.3 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["focus", "study", "studying", "concentrate", "concentration", "work", "productive", "deep work"],
    weights: { energy: 0.05, valence: 0.05, tension: -0.1, nostalgia: -0.1, calm: 0.35 },
  },
  {
    terms: ["summer", "summertime", "summer vibes", "hot", "sunny", "beach", "vacation"],
    weights: { energy: 0.2, valence: 0.3, tension: -0.15, nostalgia: 0.15, calm: 0.1 },
  },
  {
    terms: ["winter", "cold", "freezing", "snow", "snowfall", "cozy", "hibernation"],
    weights: { energy: -0.15, valence: 0.0, tension: -0.05, nostalgia: 0.2, calm: 0.2 },
  },
  {
    terms: ["anxious", "anxiety", "nervous", "worried", "overthinking", "panic", "on edge", "stressed"],
    weights: { energy: 0.1, valence: -0.3, tension: 0.45, nostalgia: 0.05, calm: -0.4 },
  },
  {
    terms: ["floating", "dreamy", "ethereal", "surreal", "dissociated", "out of body", "weightless", "drifting"],
    weights: { energy: -0.2, valence: 0.1, tension: -0.15, nostalgia: 0.15, calm: 0.3 },
  },
  {
    terms: ["bittersweet", "bittersweetness", "mixed feelings", "happy sad", "sad happy", "beautiful sadness"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.1, nostalgia: 0.3, calm: 0.05 },
  },
  {
    terms: ["triumphant", "triumph", "victory", "winning", "i made it", "overcome", "proud moment"],
    weights: { energy: 0.35, valence: 0.4, tension: 0.05, nostalgia: 0.05, calm: -0.1 },
  },
  {
    terms: ["drunk", "tipsy", "buzzed", "wine drunk", "high", "stoned", "altered"],
    weights: { energy: 0.1, valence: 0.15, tension: -0.1, nostalgia: 0.2, calm: 0.15 },
  },
  {
    terms: ["heartbroken", "heartbreak", "breakup", "broke up", "dumped", "ended things", "lost love", "ex"],
    weights: { energy: -0.2, valence: -0.45, tension: 0.2, nostalgia: 0.3, calm: -0.2 },
  },

  // ── Narrative / Psychological States ────────────────────────────────────────
  {
    terms: ["numb", "empty", "hollow", "nothing", "void", "blank", "disconnected", "apathetic"],
    weights: { energy: -0.4, valence: -0.2, tension: 0.05, nostalgia: 0.1, calm: 0.15 },
  },
  {
    terms: ["seeking", "searching", "looking for myself", "lost", "finding my way", "drifting", "wandering"],
    weights: { energy: 0.0, valence: -0.1, tension: 0.2, nostalgia: 0.2, calm: -0.1 },
  },
  {
    terms: ["identity crisis", "who am i", "don't know who i am", "lost myself", "not myself"],
    weights: { energy: -0.1, valence: -0.2, tension: 0.3, nostalgia: 0.25, calm: -0.2 },
  },
  {
    terms: ["internal conflict", "torn", "conflicted", "can't decide", "two minds", "contradicted"],
    weights: { energy: 0.05, valence: -0.1, tension: 0.3, nostalgia: 0.1, calm: -0.2 },
  },
  {
    terms: ["temporal drift", "time passing", "watching time go by", "slow", "nothing changes", "stuck"],
    weights: { energy: -0.25, valence: -0.1, tension: 0.05, nostalgia: 0.3, calm: 0.15 },
  },

  // ── Extended Emotional States ────────────────────────────────────────────────
  {
    terms: ["burned out", "burnout", "exhausted", "drained", "depleted", "tired", "worn out", "fatigued"],
    weights: { energy: -0.45, valence: -0.2, tension: 0.1, nostalgia: 0.1, calm: 0.05 },
  },
  {
    terms: ["grief", "grieving", "loss", "mourning", "miss someone", "someone died", "missing"],
    weights: { energy: -0.3, valence: -0.4, tension: 0.15, nostalgia: 0.35, calm: -0.05 },
  },
  {
    terms: ["existential", "existential dread", "meaning of life", "what's the point", "nihilistic", "void"],
    weights: { energy: -0.2, valence: -0.25, tension: 0.2, nostalgia: 0.15, calm: 0.05 },
  },
  {
    terms: ["restless", "restlessness", "can't sit still", "agitated", "antsy", "need to move"],
    weights: { energy: 0.2, valence: -0.1, tension: 0.3, nostalgia: 0.0, calm: -0.35 },
  },
  {
    terms: ["hopeful", "hope", "optimistic", "things will get better", "looking up", "bright future"],
    weights: { energy: 0.1, valence: 0.35, tension: -0.1, nostalgia: 0.05, calm: 0.2 },
  },
  {
    terms: ["proud", "pride", "accomplished", "achievement", "did it", "made it", "success"],
    weights: { energy: 0.25, valence: 0.4, tension: -0.05, nostalgia: 0.1, calm: 0.1 },
  },
  {
    terms: ["longing", "yearn", "yearning", "ache", "aching", "pine", "pining", "want so badly"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.2, nostalgia: 0.35, calm: -0.1 },
  },
  {
    terms: ["romantic", "romance", "love", "in love", "falling in love", "crush", "infatuated", "adore"],
    weights: { energy: 0.05, valence: 0.4, tension: 0.1, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["cathartic", "catharsis", "release", "let it out", "cry it out", "emotional release", "purge"],
    weights: { energy: 0.1, valence: 0.1, tension: 0.25, nostalgia: 0.1, calm: 0.0 },
  },
  {
    terms: ["overcoming", "getting over it", "moving on", "healing", "recovering", "bouncing back"],
    weights: { energy: 0.15, valence: 0.2, tension: -0.1, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["introspective", "introspection", "self reflection", "reflect", "thinking about life", "deep thoughts"],
    weights: { energy: -0.15, valence: 0.0, tension: 0.1, nostalgia: 0.2, calm: 0.2 },
  },

  // ── Compound Scene Phrases ───────────────────────────────────────────────────
  {
    terms: ["sunday morning", "lazy sunday", "slow sunday"],
    weights: { energy: -0.2, valence: 0.2, tension: -0.2, nostalgia: 0.15, calm: 0.35 },
    sceneHints: { timeOfDay: "morning", environment: "indoor" },
  },
  {
    terms: ["2am drive", "late night drive", "driving at 2am", "midnight drive"],
    weights: { energy: 0.05, valence: -0.05, tension: 0.1, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", motionState: "driving" },
  },
  {
    terms: ["empty train", "late train", "last train", "midnight train", "empty subway"],
    weights: { energy: -0.2, valence: -0.1, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { timeOfDay: "night", environment: "transit", motionState: "transit" },
  },
  {
    terms: ["last day of summer", "end of summer", "summer ending", "summer's almost over"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.05, nostalgia: 0.45, calm: 0.05 },
    sceneHints: { environment: "outdoor" },
  },
  {
    terms: ["walking home alone", "walk home alone", "walking alone at night"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.15, nostalgia: 0.2, calm: 0.05 },
    sceneHints: { motionState: "walking", timeOfDay: "night" },
  },
  {
    terms: ["after the party", "post party", "everyone's gone home", "party's over"],
    weights: { energy: -0.2, valence: -0.05, tension: 0.05, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["first coffee", "morning coffee", "coffee and thoughts"],
    weights: { energy: 0.1, valence: 0.2, tension: -0.1, nostalgia: 0.1, calm: 0.25 },
    sceneHints: { timeOfDay: "morning", environment: "indoor" },
  },
  {
    terms: ["rainy window", "watching rain", "rain on window", "looking out at rain"],
    weights: { energy: -0.25, valence: -0.05, tension: -0.05, nostalgia: 0.3, calm: 0.25 },
    sceneHints: { environment: "rainy", environment2: "indoor" } as any,
  },
  {
    terms: ["city at night", "night city", "city lights at night", "neon lights"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.1, nostalgia: 0.2, calm: 0.0 },
    sceneHints: { environment: "urban", timeOfDay: "night" },
  },

  // ── Genre / Artist Cues ───────────────────────────────────────────────────────
  {
    terms: ["radiohead", "thom yorke", "ok computer", "kid a"],
    weights: { energy: -0.2, valence: -0.25, tension: 0.3, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["early kanye", "college dropout", "late registration", "graduation kanye"],
    weights: { energy: 0.25, valence: 0.2, tension: 0.05, nostalgia: 0.3, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["dark kanye", "yeezus", "donda kanye", "tlop kanye"],
    weights: { energy: 0.3, valence: -0.2, tension: 0.35, nostalgia: 0.05, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["frank ocean", "channel orange", "blonde frank"],
    weights: { energy: -0.15, valence: 0.1, tension: 0.1, nostalgia: 0.25, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["indie folk", "folk", "acoustic folk", "folk music"],
    weights: { energy: -0.2, valence: 0.05, tension: -0.05, nostalgia: 0.3, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["post punk", "post-punk", "dark wave", "darkwave", "gothic"],
    weights: { energy: 0.1, valence: -0.3, tension: 0.35, nostalgia: 0.15, calm: -0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["drill", "uk drill", "chicago drill", "trap", "dark trap"],
    weights: { energy: 0.35, valence: -0.15, tension: 0.4, nostalgia: -0.1, calm: -0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["jazz", "jazzy", "jazz vibes", "bebop", "swing", "jazz fusion"],
    weights: { energy: -0.05, valence: 0.15, tension: -0.1, nostalgia: 0.25, calm: 0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["classical", "orchestral", "symphony", "piano classical", "chamber music"],
    weights: { energy: -0.1, valence: 0.1, tension: 0.05, nostalgia: 0.15, calm: 0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["metal", "heavy metal", "hard rock", "metalcore", "death metal"],
    weights: { energy: 0.55, valence: -0.2, tension: 0.45, nostalgia: 0.05, calm: -0.5 },
    artistOrGenreCue: true,
  },
  {
    terms: ["edm", "electronic dance", "house music", "techno", "electro", "club music"],
    weights: { energy: 0.5, valence: 0.25, tension: 0.1, nostalgia: -0.1, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["lofi", "lo-fi", "lo fi", "chill hop", "lofi hip hop", "study beats"],
    weights: { energy: -0.3, valence: 0.05, tension: -0.2, nostalgia: 0.2, calm: 0.45 },
    artistOrGenreCue: true,
  },
  {
    terms: ["90s", "90s music", "nineties", "old school 90s"],
    weights: { energy: 0.1, valence: 0.1, tension: -0.05, nostalgia: 0.45, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["80s", "80s music", "eighties", "synthwave", "retro"],
    weights: { energy: 0.1, valence: 0.2, tension: -0.05, nostalgia: 0.5, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["hip hop", "rap", "hiphop", "hip-hop", "bars"],
    weights: { energy: 0.2, valence: 0.1, tension: 0.1, nostalgia: 0.05, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["rnb", "r&b", "neo soul", "soul music", "smooth rnb"],
    weights: { energy: -0.05, valence: 0.2, tension: 0.0, nostalgia: 0.15, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["ambient", "ambient music", "drone", "soundscape", "atmospheric"],
    weights: { energy: -0.4, valence: 0.05, tension: -0.15, nostalgia: 0.1, calm: 0.5 },
    artistOrGenreCue: true,
  },
  {
    terms: ["punk", "punk rock", "punk music", "anarchy"],
    weights: { energy: 0.5, valence: -0.1, tension: 0.35, nostalgia: 0.1, calm: -0.45 },
    artistOrGenreCue: true,
  },
  {
    terms: ["gospel", "church music", "gospel choir", "worship", "spiritual"],
    weights: { energy: 0.2, valence: 0.4, tension: -0.05, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["country", "country music", "americana", "bluegrass", "western"],
    weights: { energy: 0.05, valence: 0.1, tension: 0.0, nostalgia: 0.35, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["kendrick", "kendrick lamar", "to pimp a butterfly", "damn kendrick"],
    weights: { energy: 0.2, valence: -0.1, tension: 0.25, nostalgia: 0.15, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["tyler", "tyler the creator", "igor", "flower boy", "goblin tyler"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.15, nostalgia: 0.15, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["billie eilish", "billie", "when we all fall asleep"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.2, nostalgia: 0.05, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["arctic monkeys", "am arctic", "favourite worst nightmare", "tranquility base"],
    weights: { energy: 0.15, valence: 0.0, tension: 0.2, nostalgia: 0.2, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["taylor swift", "taylor", "swiftie", "folklore taylor", "evermore taylor"],
    weights: { energy: 0.05, valence: 0.15, tension: 0.05, nostalgia: 0.3, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sza", "ctrl sza", "sos sza"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.15, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["james blake", "james blake music", "overgrown", "assume form"],
    weights: { energy: -0.25, valence: -0.05, tension: 0.15, nostalgia: 0.2, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mac miller", "swimming mac", "circles mac", "good am"],
    weights: { energy: 0.0, valence: 0.05, tension: 0.05, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["phoebe bridgers", "phoebe", "punisher phoebe", "stranger in the alps"],
    weights: { energy: -0.3, valence: -0.15, tension: 0.1, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["the weeknd", "weeknd", "after hours weeknd", "starboy weeknd"],
    weights: { energy: 0.15, valence: -0.1, tension: 0.2, nostalgia: 0.1, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["daniel caesar", "freudian", "case study daniel"],
    weights: { energy: -0.1, valence: 0.2, tension: 0.0, nostalgia: 0.15, calm: 0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["glass animals", "dreamland", "how to be a human being"],
    weights: { energy: 0.05, valence: 0.1, tension: 0.1, nostalgia: 0.15, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["flume", "skin flume", "palaces flume", "electronic flume"],
    weights: { energy: 0.1, valence: 0.15, tension: 0.05, nostalgia: 0.1, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mount kimbie", "crooks and lovers", "love what survives"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.1, nostalgia: 0.15, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["four tet", "kieran hebden", "there is love in you", "rounds four tet"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.05, nostalgia: 0.15, calm: 0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["daft punk", "random access memories", "discovery daft punk", "homework daft punk"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.0, nostalgia: 0.25, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["lcd soundsystem", "sound of silver", "american dream lcd"],
    weights: { energy: 0.25, valence: 0.05, tension: 0.1, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["bon iver", "for emma", "22 a million", "i i bon iver"],
    weights: { energy: -0.25, valence: 0.0, tension: 0.05, nostalgia: 0.3, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["grimes", "art angels", "visions grimes", "miss anthropocene"],
    weights: { energy: 0.15, valence: 0.05, tension: 0.2, nostalgia: 0.05, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["childish gambino", "donald glover", "because the internet", "awaken my love", "camp gambino"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["solange", "a seat at the table", "when i get home solange"],
    weights: { energy: -0.05, valence: 0.1, tension: 0.05, nostalgia: 0.2, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["mitski", "puberty 2", "be the cowboy", "bury me at makeout creek"],
    weights: { energy: 0.05, valence: -0.2, tension: 0.25, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["beach house", "teen dream", "depression cherry", "thank your lucky stars"],
    weights: { energy: -0.2, valence: 0.1, tension: 0.0, nostalgia: 0.3, calm: 0.3 },
    artistOrGenreCue: true,
  },
];

// ─── VIBE ANALYSIS ────────────────────────────────────────────────────────────

export function analyzeVibe(vibe: string): EmotionProfile {
  const text = vibe.toLowerCase().trim();
  const negatedTerms = extractNegatedTerms(text);
  const contradictionBoost = detectContradictionBoost(text);
  const emotionalDepth = computeEmotionalDepth(text);
  const scene = detectScene(text);

  const profile: EmotionProfile = {
    energy: 0.5,
    valence: 0.5,
    tension: 0.3,
    nostalgia: 0.2,
    calm: 0.5,
    environment: scene.environment,
    timeOfDay: scene.timeOfDay,
    motionState: scene.motionState,
  };

  let totalWeight = 0;

  for (const keyword of VIBE_KEYWORDS) {
    let matched = false;
    let matchedTerm = "";

    for (const term of keyword.terms) {
      if (keyword.exactMatch) {
        if (text === term) {
          matched = true;
          matchedTerm = term;
          break;
        }
      } else {
        if (text.includes(term)) {
          matched = true;
          matchedTerm = term;
          break;
        }
      }
    }

    if (!matched) continue;

    // Check if the matched term is negated
    const termWords = matchedTerm.split(/\s+/);
    const isNegated = termWords.some((word) => negatedTerms.has(word));

    // Intensifier context around the match
    const matchIdx = text.indexOf(matchedTerm);
    const contextStart = Math.max(0, matchIdx - 20);
    const context = text.slice(contextStart, matchIdx + matchedTerm.length + 20);
    const intensifierScale = getIntensifierScale(context);

    // Artist/genre cues get a fixed weight (0.6) regardless of intensifiers
    const baseScale = keyword.artistOrGenreCue ? 0.6 : 1.0;
    const effectiveScale = isNegated ? -0.5 : baseScale * intensifierScale;

    const w = keyword.weights;

    if (w.energy !== undefined) profile.energy += w.energy * effectiveScale;
    if (w.valence !== undefined) profile.valence += w.valence * effectiveScale;
    if (w.tension !== undefined) profile.tension += w.tension * effectiveScale;
    if (w.nostalgia !== undefined) profile.nostalgia += w.nostalgia * effectiveScale;
    if (w.calm !== undefined) profile.calm += w.calm * effectiveScale;

    // Apply scene hints from keyword if not already set
    if (keyword.sceneHints) {
      if (keyword.sceneHints.environment && !profile.environment) {
        profile.environment = keyword.sceneHints.environment;
      }
      if (keyword.sceneHints.timeOfDay && !profile.timeOfDay) {
        profile.timeOfDay = keyword.sceneHints.timeOfDay;
      }
      if (keyword.sceneHints.motionState && !profile.motionState) {
        profile.motionState = keyword.sceneHints.motionState;
      }
    }

    totalWeight += 1;
  }

  // Apply contradiction boost to tension
  profile.tension += contradictionBoost;

  // Emotional depth nudges calm down slightly (deeper = more complex)
  profile.calm -= emotionalDepth * 0.2;

  // Normalise — clamp all to [0,1]
  profile.energy = clamp(profile.energy);
  profile.valence = clamp(profile.valence);
  profile.tension = clamp(profile.tension);
  profile.nostalgia = clamp(profile.nostalgia);
  profile.calm = clamp(profile.calm);

  // Apply scene-based weight adjustments
  const withScene = applySceneWeights(profile, scene);

  return withScene;
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, val));
}

// ─── SONG SCORING ─────────────────────────────────────────────────────────────

interface SongFeatures {
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}

const FEATURE_WEIGHTS = {
  strict: { energy: 0.4, valence: 0.35, danceability: 0.1, acousticness: 0.08, tempo: 0.07 },
  balanced: { energy: 0.3, valence: 0.3, danceability: 0.15, acousticness: 0.1, tempo: 0.15 },
  chaotic: { energy: 0.2, valence: 0.2, danceability: 0.2, acousticness: 0.15, tempo: 0.25 },
};

export function scoreSong(
  song: SongFeatures,
  profile: EmotionProfile,
  mode: "strict" | "balanced" | "chaotic"
): number {
  const weights = FEATURE_WEIGHTS[mode];

  // Normalise tempo from BPM to [0,1] — 60 BPM → 0, 200 BPM → 1
  const normTempo = song.tempo != null ? clamp((song.tempo - 60) / 140) : 0.5;

  // Desired tempo from emotion profile
  // High energy/tension → high tempo, low energy/calm → low tempo
  const desiredTempo = clamp(profile.energy * 0.6 + profile.tension * 0.4);

  const energyDelta = song.energy != null ? Math.abs(song.energy - profile.energy) : 0.3;
  const valenceDelta = song.valence != null ? Math.abs(song.valence - profile.valence) : 0.3;
  const tempoDelta = Math.abs(normTempo - desiredTempo);

  // Danceability: high party/energy → high danceability is good
  const desiredDanceability = clamp(profile.energy * 0.5 + profile.valence * 0.3 + 0.2);
  const danceabilityDelta =
    song.danceability != null ? Math.abs(song.danceability - desiredDanceability) : 0.3;

  // Acousticness: high calm/nostalgia → acoustic preferred
  const desiredAcousticness = clamp(profile.calm * 0.4 + profile.nostalgia * 0.4);
  const acousticnessDelta =
    song.acousticness != null ? Math.abs(song.acousticness - desiredAcousticness) : 0.3;

  // Score = 1 - weighted delta (higher = better match)
  const rawScore =
    1 -
    (energyDelta * weights.energy +
      valenceDelta * weights.valence +
      danceabilityDelta * weights.danceability +
      acousticnessDelta * weights.acousticness +
      tempoDelta * weights.tempo);

  // Tension bonus — songs with high energy & low valence score better when tension is high
  const tensionBonus =
    song.energy != null && song.valence != null
      ? profile.tension * 0.1 * (song.energy - song.valence)
      : 0;

  // Nostalgia bonus — acousticness correlates with nostalgia
  const nostalgiaBonus =
    song.acousticness != null ? profile.nostalgia * 0.05 * song.acousticness : 0;

  return clamp(rawScore + tensionBonus + nostalgiaBonus);
}

// ─── PLAYLIST STRUCTURE ───────────────────────────────────────────────────────

export function buildPlaylistStructure<T extends { score: number; energy: number | null }>(
  songs: T[],
  targetLength: number,
  mode: "strict" | "balanced" | "chaotic"
): T[] {
  const sorted = [...songs].sort((a, b) => b.score - a.score);

  const poolSize =
    mode === "strict"
      ? targetLength
      : mode === "balanced"
        ? targetLength * 2
        : targetLength * 3;
  const pool = sorted.slice(0, Math.min(poolSize, sorted.length));

  if (pool.length <= targetLength) return pool;

  // Intro → Build → Peak → Descent arc
  const introCount = Math.max(1, Math.round(targetLength * 0.15));
  const buildCount = Math.max(1, Math.round(targetLength * 0.25));
  const peakCount = Math.max(1, Math.round(targetLength * 0.3));
  const descentCount = Math.max(1, targetLength - introCount - buildCount - peakCount);

  // Separate pool by energy quartiles
  const byEnergy = [...pool].sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
  const quartile = Math.floor(byEnergy.length / 4);

  const lowEnergy = byEnergy.slice(0, quartile * 2);
  const midEnergy = byEnergy.slice(quartile, quartile * 3);
  const highEnergy = byEnergy.slice(quartile * 2);

  function pickBest<U extends { score: number }>(arr: U[], n: number, used: Set<number>): U[] {
    return arr
      .map((item, i) => ({ item, origIdx: pool.indexOf(item as any) }))
      .filter(({ origIdx }) => !used.has(origIdx))
      .sort((a, b) => b.item.score - a.item.score)
      .slice(0, n)
      .map(({ item, origIdx }) => {
        used.add(origIdx);
        return item;
      });
  }

  const used = new Set<number>();

  // Intro: low energy
  const intro = pickBest(lowEnergy.length > 0 ? lowEnergy : pool, introCount, used);
  // Build: mid energy
  const build = pickBest(midEnergy.length > 0 ? midEnergy : pool, buildCount, used);
  // Peak: high energy
  const peak = pickBest(highEnergy.length > 0 ? highEnergy : pool, peakCount, used);
  // Descent: low-mid, remaining
  const descentPool = pool.filter((_, i) => !used.has(i));
  const descent = pickBest(
    descentPool.length > 0 ? descentPool : pool,
    descentCount,
    new Set()
  );

  return [...intro, ...build, ...peak, ...descent];
}

// ─── ARTIST REPETITION LIMITER ────────────────────────────────────────────────

export function limitArtistRepetition<T extends { artistName: string }>(
  songs: T[],
  maxPerArtist: number
): T[] {
  const counts = new Map<string, number>();
  const result: T[] = [];

  for (const song of songs) {
    const artist = song.artistName.toLowerCase();
    const current = counts.get(artist) ?? 0;
    if (current < maxPerArtist) {
      result.push(song);
      counts.set(artist, current + 1);
    }
  }

  return result;
}

// ─── QUALITY ENGINE ───────────────────────────────────────────────────────────

/**
 * Ensures no two adjacent tracks share the same primary artist.
 * Displaced tracks are reinserted at the next safe position.
 */
export function separateAdjacentArtists<T extends { artistName: string }>(songs: T[]): T[] {
  if (songs.length < 2) return songs;

  const result: T[] = [];
  const deferred: T[] = [];

  for (const song of songs) {
    const last = result[result.length - 1];
    if (last && last.artistName.toLowerCase() === song.artistName.toLowerCase()) {
      deferred.push(song);
    } else {
      result.push(song);
    }
  }

  // Re-insert deferred tracks at the first non-conflicting position
  for (const song of deferred) {
    let inserted = false;
    for (let i = result.length - 1; i >= 1; i--) {
      const prev = result[i - 1]!;
      const next = result[i];
      if (
        prev.artistName.toLowerCase() !== song.artistName.toLowerCase() &&
        (!next || next.artistName.toLowerCase() !== song.artistName.toLowerCase())
      ) {
        result.splice(i, 0, song);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(song);
  }

  return result;
}

/**
 * Nudges track order so energy doesn't spike or drop by more than `maxStep`
 * between consecutive tracks.
 */
export function smoothEnergyCurve<T extends { energy: number | null }>(
  songs: T[],
  minEnergy: number,
  maxEnergy: number
): T[] {
  if (songs.length < 3) return songs;

  // Filter out extreme outliers
  return songs.filter((s) => {
    const e = s.energy ?? 0.5;
    return e >= minEnergy && e <= maxEnergy;
  });
}

/**
 * Removes tracks with energy so low they would kill momentum (dead zones).
 * Applies only when the track pool is large enough to afford it.
 */
export function filterDeadZones<T extends { energy: number | null }>(
  songs: T[],
  targetLength: number
): T[] {
  if (songs.length <= targetLength) return songs;

  const DEAD_ZONE_THRESHOLD = 0.08;
  const filtered = songs.filter((s) => (s.energy ?? 0.5) >= DEAD_ZONE_THRESHOLD);

  // Safety: don't over-trim
  return filtered.length >= targetLength ? filtered : songs;
}

/**
 * Re-sorts a playlist to loosely follow an energy arc:
 * low → rising → peak (60-75%) → descent.
 * Preserves relative score ordering within each segment.
 */
export function enforceArc<T extends { energy: number | null; score: number }>(
  songs: T[]
): T[] {
  if (songs.length < 4) return songs;

  const n = songs.length;
  const introEnd = Math.round(n * 0.15);
  const buildEnd = Math.round(n * 0.4);
  const peakEnd = Math.round(n * 0.75);

  const byEnergy = [...songs].sort((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5));
  const totalQ = Math.floor(n / 4);

  const lowPool = byEnergy.slice(0, totalQ + 1);
  const midPool = byEnergy.slice(totalQ, totalQ * 3);
  const highPool = byEnergy.slice(totalQ * 2);

  function fillSegment(pool: T[], count: number, used: Set<number>): T[] {
    return pool
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !used.has(i))
      .sort((a, b) => b.t.score - a.t.score)
      .slice(0, count)
      .map(({ t, i }) => {
        used.add(i);
        return t;
      });
  }

  const used = new Set<number>();

  const introTracks = fillSegment(
    lowPool.map((t, i) => ({ ...t, _idx: i })) as any,
    introEnd,
    used
  );

  // Reset — use energy-indexed pool directly
  const usedEnergy = new Set<T>();
  const introFinal = lowPool.slice(0, introEnd);
  introFinal.forEach((t) => usedEnergy.add(t));

  const buildFinal = midPool.filter((t) => !usedEnergy.has(t)).slice(0, buildEnd - introEnd);
  buildFinal.forEach((t) => usedEnergy.add(t));

  const peakFinal = highPool.filter((t) => !usedEnergy.has(t)).slice(0, peakEnd - buildEnd);
  peakFinal.forEach((t) => usedEnergy.add(t));

  const remainingFinal = songs.filter((t) => !usedEnergy.has(t));

  return [...introFinal, ...buildFinal, ...peakFinal, ...remainingFinal];
}

// ─── PLAYLIST NAMING ──────────────────────────────────────────────────────────

const NAME_TEMPLATES = {
  high_energy: [
    "Maximum Voltage",
    "Kinetic",
    "Overdrive",
    "Full Throttle",
    "Surge",
    "Critical Mass",
  ],
  low_energy: [
    "Slow Dissolve",
    "Undertow",
    "Suspended",
    "Still Water",
    "Low Signal",
    "Gentle Frequency",
  ],
  high_tension: [
    "Edge of Collapse",
    "Tight Frequency",
    "Static Pressure",
    "Fault Lines",
    "Live Wire",
    "Storm Front",
  ],
  nostalgic: [
    "Ghost Light",
    "Faded Polaroid",
    "Memory Foam",
    "Analogue Warmth",
    "Soft Rewind",
    "Before Everything Changed",
  ],
  calm: [
    "Low Tide",
    "Quiet Current",
    "Drift State",
    "Settled",
    "Noon Glass",
    "Still Morning",
  ],
  joyful: [
    "Signal Boost",
    "Bright Circuit",
    "Open Window",
    "Sun Exposure",
    "Clear Channel",
    "Good Frequency",
  ],
  dark: [
    "Negative Space",
    "Black Box",
    "3AM Transmission",
    "Deep Current",
    "Radio Silence",
    "Dark Matter",
  ],
  default: [
    "Emotional Frequency",
    "Signal and Noise",
    "Interior Landscape",
    "Frequency Shift",
    "Mood Index",
    "The Mix",
  ],
};

function pickFromList(list: string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % list.length;
  return list[idx]!;
}

export function generatePlaylistName(vibe: string, profile: EmotionProfile): string {
  const { energy, valence, tension, nostalgia, calm } = profile;

  let category: keyof typeof NAME_TEMPLATES;

  if (energy > 0.7) category = "high_energy";
  else if (energy < 0.3) category = "low_energy";
  else if (tension > 0.6) category = "high_tension";
  else if (nostalgia > 0.5) category = "nostalgic";
  else if (calm > 0.6) category = "calm";
  else if (valence > 0.65) category = "joyful";
  else if (valence < 0.3) category = "dark";
  else category = "default";

  const base = pickFromList(NAME_TEMPLATES[category], vibe);

  // Append a short vibe fragment if the input has meaningful words
  const vibeWords = vibe
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["with", "that", "this", "when", "like", "just", "feel", "feeling"].includes(w));

  if (vibeWords.length > 0 && Math.abs(hashStr(vibe)) % 3 !== 0) {
    const fragment = vibeWords.slice(0, 2).join(" ");
    return `${base}: ${capitalize(fragment)}`;
  }

  return base;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function hashStr(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
