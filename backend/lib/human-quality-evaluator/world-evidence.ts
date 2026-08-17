/**
 * Evaluator-only world evidence for forensic diagnosis.
 * Does NOT drive generation. Token lists are hypotheses, not engine truth.
 */

export type FitBand = "PASS" | "MIXED" | "FAIL" | "UNKNOWN";

export type TrackLike = {
  name: string;
  artist: string;
  album?: string | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s&+]/g, " ").replace(/\s+/g, " ").trim();
}

function blob(t: TrackLike): string {
  return norm(`${t.artist} ${t.name} ${t.album ?? ""}`);
}

function hasToken(haystack: string, tokens: string[]): boolean {
  return tokens.some((tok) => haystack.includes(norm(tok)));
}

export type WorldSpec = {
  id: string;
  label: string;
  match: (prompt: string) => boolean;
  /** Narrow worlds must not be satisfied by generic coherence. */
  strict: boolean;
  era?: { min: number; max: number; label: string };
  positiveArtistTokens: string[];
  negativeArtistTokens: string[];
  positiveTitleTokens: string[];
  neighbourLabels: string[];
};

export const WORLD_SPECS: WorldSpec[] = [
  {
    id: "shoegaze",
    label: "shoegaze",
    match: (p) => /\bshoegaze\b/i.test(p),
    strict: true,
    positiveArtistTokens: [
      "slowdive", "my bloody valentine", "mbv", "ride", "lush", "chapterhouse",
      "pale saints", "whirr", "nothing", "dIIV", "diiv", "beach house", "cocteau twins",
      "alcest", "hum", "swervedriver", "drop nights", "have a nice life",
    ],
    negativeArtistTokens: [
      "ac/dc", "acdc", "guns n roses", "guns n' roses", "led zeppelin", "fleetwood mac",
      "queens of the stone age", "jake bugg", "the killers", "arctic monkeys",
    ],
    positiveTitleTokens: ["shoegaze", "dream pop"],
    neighbourLabels: ["classic rock", "indie rock", "grunge"],
  },
  {
    id: "grime",
    label: "grime",
    match: (p) => /\bgrime\b/i.test(p) && !/\bgarage\b/i.test(p),
    strict: true,
    positiveArtistTokens: [
      "dizzee rascal", "wiley", "kano", "jme", "skepta", "stormzy", "chip", "chipmunk",
      "lethal bizzle", "giggs", "novelist", "d double e", "jammer", "roll deep",
      "boy better know", "devlin", "ghetts", "jammer",
    ],
    negativeArtistTokens: [
      "artful dodger", "craig david", "conducta", "kurupt fm", "shy fx", "mj cole",
    ],
    positiveTitleTokens: ["grime"],
    neighbourLabels: ["UK garage", "UK rap", "drill"],
  },
  {
    id: "uk_garage",
    label: "UK garage",
    match: (p) => /\buk\s*garage\b|\bukg\b/i.test(p),
    strict: true,
    positiveArtistTokens: [
      "artful dodger", "mj cole", "craig david", "oxide", "so solid", "ms dynamite",
      "conducta", "interplanetary criminal", "t q", "ez", "shanks", "sweet female attitude",
      "garage",
    ],
    negativeArtistTokens: [],
    positiveTitleTokens: ["garage", "rewind", "bassline"],
    neighbourLabels: ["UK rap", "grime", "drum and bass"],
  },
  {
    id: "britpop",
    label: "britpop",
    match: (p) => /\bbritpop\b/i.test(p),
    strict: true,
    era: { min: 1993, max: 2002, label: "mid-90s–early-00s britpop window" },
    positiveArtistTokens: [
      "oasis", "blur", "pulp", "suede", "supergrass", "the verve", "elastica",
      "cast", "ocean colour scene", "kula shaker", "sleeper", "dodgy", "menswear",
      "shed seven", "james", "ash", "travis", "stereophonics", "kasabian",
    ],
    negativeArtistTokens: [
      "panic at the disco", "panic! at the disco", "fall out boy", "soundgarden",
      "foo fighters", "sonic youth",
    ],
    positiveTitleTokens: ["wonderwall", "common people", "song 2"],
    neighbourLabels: ["emo", "pop-punk", "grunge", "indie rock"],
  },
  {
    id: "90s_alt",
    label: "90s alternative rock",
    match: (p) => /\b90s\b/i.test(p) && /\balternative|alt.?rock\b/i.test(p),
    strict: true,
    era: { min: 1988, max: 2001, label: "late-80s–90s alternative" },
    positiveArtistTokens: [
      "radiohead", "nirvana", "smashing pumpkins", "sonic youth", "pj harvey",
      "pavement", "weezer", "r.e.m", "rem", "hole", "garbage", "placebo",
      "foo fighters", "pearl jam", "soundgarden", "alice in chains", "blur",
      "oasis", "the verve", "beck", "built to spill",
    ],
    negativeArtistTokens: ["laurindo almeida", "cody fry", "the cab", "wallows"],
    positiveTitleTokens: [],
    neighbourLabels: ["2010s indie", "bedroom pop"],
  },
  {
    id: "80s_synthpop",
    label: "80s synthpop",
    match: (p) => /\b80s\b/i.test(p) && /\bsynth/i.test(p),
    strict: true,
    era: { min: 1978, max: 1991, label: "late-70s–80s synthpop" },
    positiveArtistTokens: [
      "depeche mode", "new order", "pet shop boys", "a-ha", "aha", "duran duran",
      "yazoo", "erasure", "tears for fears", "eurythmics", "human league",
      "gary numan", "omd", "alphaville", "bronski beat", "ultravox", "kraftwerk",
      "soft cell", "a flock of seagulls", "talking heads",
    ],
    negativeArtistTokens: ["the 1975", "wallows", "the jungle giants", "cody fry"],
    positiveTitleTokens: ["blue monday", "enjoy the silence"],
    neighbourLabels: ["2010s indie pop"],
  },
  {
    id: "bristol_triphop",
    label: "mid-90s Bristol trip-hop",
    match: (p) => /\btrip-?hop\b/i.test(p) || (/\bbristol\b/i.test(p) && /\b90s|mid-90s\b/i.test(p)),
    strict: true,
    era: { min: 1991, max: 2001, label: "90s trip-hop" },
    positiveArtistTokens: [
      "portishead", "massive attack", "tricky", "smith & mighty", "morcheeba",
      "lamb", "unkle", "dj shadow", "hooverphonic", "sneaker pimps",
    ],
    negativeArtistTokens: ["laurindo almeida", "the cab", "cody fry", "wallows", "the jungle giants"],
    positiveTitleTokens: ["glory box", "unfinished sympathy", "sour times"],
    neighbourLabels: ["2010s indie", "acoustic"],
  },
  {
    id: "indie_rock",
    label: "indie rock",
    match: (p) => /\bindie rock\b/i.test(p),
    strict: false,
    positiveArtistTokens: [
      "the smiths", "arctic monkeys", "the strokes", "interpol", "yeah yeah yeahs",
      "vampire weekend", "the national", "lcd soundsystem", "mgmt", "wallows",
      "the 1975", "the jungle giants", "florence",
    ],
    negativeArtistTokens: [],
    positiveTitleTokens: ["indie"],
    neighbourLabels: ["pop", "hip hop"],
  },
  {
    id: "lofi",
    label: "lo-fi study",
    match: (p) => /\blo-?fi|lofi\b/i.test(p),
    strict: true,
    positiveArtistTokens: [
      "nujabes", "j dilla", "chillhop", "lofi", "tomppabeats", "eevee", "idealism",
      "jinsang", "kupla", "men i trust",
    ],
    negativeArtistTokens: ["laurindo almeida", "cody fry", "mexican slum rats"],
    positiveTitleTokens: ["lofi", "lo-fi", "chillhop", "beats"],
    neighbourLabels: ["acoustic indie"],
  },
];

export function matchingWorlds(prompt: string): WorldSpec[] {
  return WORLD_SPECS.filter((w) => w.match(prompt));
}

export type TrackWorldHit = {
  positive: boolean;
  negative: boolean;
  neighbour: boolean;
  inEra: boolean | null;
  keywordInName: boolean;
};

export function scoreTrackAgainstWorld(track: TrackLike, world: WorldSpec): TrackWorldHit {
  const b = blob(track);
  const positive = hasToken(b, world.positiveArtistTokens) || hasToken(b, world.positiveTitleTokens);
  const negative = hasToken(b, world.negativeArtistTokens);
  const year = track.releaseYear;
  const inEra =
    world.era && typeof year === "number"
      ? year >= world.era.min && year <= world.era.max
      : null;
  const keywordInName = world.positiveTitleTokens.some((tok) => b.includes(norm(tok)))
    && !hasToken(b, world.positiveArtistTokens);
  return { positive, negative, neighbour: negative && !positive, inEra, keywordInName };
}

export function eraWindowForPrompt(prompt: string): { min: number; max: number; label: string } | null {
  const p = prompt.toLowerCase();
  for (const w of matchingWorlds(prompt)) {
    if (w.era) return w.era;
  }
  if (/\b80s\b|\b1980s\b/.test(p)) return { min: 1978, max: 1991, label: "1980s" };
  if (/\b90s\b|\b1990s\b/.test(p)) return { min: 1988, max: 2001, label: "1990s" };
  if (/\b2000s\b/.test(p)) return { min: 1999, max: 2010, label: "2000s" };
  return null;
}

export type CompoundPart = {
  id: string;
  label: string;
  score: (tracks: TrackLike[]) => { hits: number; evidence: string };
};

export function compoundPartsForPrompt(prompt: string): CompoundPart[] {
  const p = prompt.toLowerCase();
  const parts: CompoundPart[] = [];
  const mean = (vals: Array<number | null | undefined>) => {
    const xs = vals.filter((v): v is number => typeof v === "number");
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  if (/\bsad\b/.test(p) && /\bparty|banger/.test(p)) {
    parts.push({
      id: "sad",
      label: "sad",
      score: (tracks) => {
        const v = mean(tracks.map((t) => t.valence ?? null));
        const hits = tracks.filter((t) => (t.valence ?? 0.5) < 0.45).length;
        return { hits, evidence: `valence mean ${v?.toFixed(2) ?? "n/a"}; low-valence tracks ${hits}/${tracks.length}` };
      },
    });
    parts.push({
      id: "party",
      label: "party/banger",
      score: (tracks) => {
        const e = mean(tracks.map((t) => t.energy ?? null));
        const hits = tracks.filter((t) => (t.energy ?? 0) >= 0.6).length;
        return { hits, evidence: `energy mean ${e?.toFixed(2) ?? "n/a"}; high-energy tracks ${hits}/${tracks.length}` };
      },
    });
  }
  if (/\bparty\b/.test(p) && /\brestrain/.test(p)) {
    parts.push({
      id: "party",
      label: "party",
      score: (tracks) => {
        const hits = tracks.filter((t) => (t.energy ?? 0) >= 0.55).length;
        return { hits, evidence: `energy≥0.55 tracks ${hits}/${tracks.length}` };
      },
    });
    parts.push({
      id: "restrained",
      label: "restrained",
      score: (tracks) => {
        const wild = tracks.filter((t) =>
          /ac\/dc|guns n|panic|fall out boy|drill|sludge/i.test(`${t.artist} ${t.name}`),
        ).length;
        const hits = tracks.length - wild;
        return { hits, evidence: `obvious unrestrained/anthem tracks ${wild}/${tracks.length}` };
      },
    });
  }
  if (/\bcozy\b/.test(p) && /\bupbeat\b/.test(p)) {
    parts.push({
      id: "cozy",
      label: "cozy",
      score: (tracks) => {
        const hits = tracks.filter((t) => (t.acousticness ?? 0) >= 0.35 || /acoustic/i.test(`${t.name} ${t.album ?? ""}`)).length;
        return { hits, evidence: `acoustic/cozy-coded tracks ${hits}/${tracks.length}` };
      },
    });
    parts.push({
      id: "upbeat",
      label: "upbeat",
      score: (tracks) => {
        const hits = tracks.filter((t) => (t.energy ?? 0) >= 0.55 && (t.valence ?? 0) >= 0.45).length;
        return { hits, evidence: `upbeat-coded tracks ${hits}/${tracks.length}` };
      },
    });
  }
  if (/\bparty\b/.test(p) && /\bnot cheesy|not\s+cheesy/.test(p)) {
    parts.push({
      id: "party",
      label: "party",
      score: (tracks) => {
        const hits = tracks.filter((t) => (t.energy ?? 0) >= 0.5).length;
        return { hits, evidence: `energy≥0.5 tracks ${hits}/${tracks.length}` };
      },
    });
    parts.push({
      id: "not_cheesy",
      label: "not cheesy",
      score: () => ({ hits: 0, evidence: "Cheesiness not measurable without human listening" }),
    });
  }
  return parts;
}

export function negativeConstraints(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const out: string[] = [];
  if (/\bno mainstream\b/.test(p)) out.push("no mainstream");
  if (/\bnot cheesy|not\s+cheesy|without cheesy/.test(p)) out.push("not cheesy");
  if (/\bnot too slow|nothing too slow/.test(p)) out.push("not too slow");
  if (/\bonly\b/.test(p)) out.push("only (narrow)");
  return out;
}

export const MAINSTREAM_ARTIST_TOKENS = [
  "the 1975", "ed sheeran", "taylor swift", "drake", "weeknd", "coldplay",
  "imagine dragons", "post malone", "harry styles", "billie eilish", "oasis",
];

export function keywordLiteralOpening(prompt: string, tracks: TrackLike[]): { flagged: boolean; evidence: string } {
  const words = prompt.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  const distinctive = words.filter((w) =>
    !["something", "playlist", "music", "songs", "track", "that", "this", "with", "from", "make", "need"].includes(w),
  );
  if (distinctive.length === 0 || tracks.length === 0) return { flagged: false, evidence: "" };
  const opening = tracks.slice(0, 4);
  const hits = opening.filter((t) => distinctive.some((w) => blob(t).includes(w)));
  const musicalSupport = matchingWorlds(prompt).some((w) =>
    opening.some((t) => scoreTrackAgainstWorld(t, w).positive),
  );
  if (hits.length >= 2 && !musicalSupport) {
    return {
      flagged: true,
      evidence: `Opening tracks echo prompt words (${hits.map((t) => t.artist).join(", ")}) without musical-world evidence`,
    };
  }
  return { flagged: false, evidence: "" };
}
