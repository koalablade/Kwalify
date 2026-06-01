/**
 * Extended vibe keyword bank — merged into emotion.ts after core scene phrases.
 * Longer / more specific phrases are listed first within each export block.
 */

export interface ExtendedVibeKeyword {
  terms: string[];
  weights: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  };
  sceneHints?: {
    environment?: string;
    timeOfDay?: string;
    motionState?: string;
  };
  artistOrGenreCue?: boolean;
  exactMatch?: boolean;
}

export const EXTENDED_VIBE_KEYWORDS: ExtendedVibeKeyword[] = [
  // ── Garage / workshop / fixing things ───────────────────────────────────────
  {
    terms: [
      "1am still fixing cars",
      "1 am still fixing cars",
      "late night fixing cars",
      "still fixing the car at 1am",
      "garage day fixing cars",
      "garage day",
      "fixing cars in the garage",
      "working on the car",
      "under the hood",
      "mechanic mode",
      "wrenching",
      "oil and grease",
      "shed workshop",
      "home garage",
      "diy car repair",
      "tinkering in the garage",
      "spanners and socket set",
    ],
    weights: { energy: 0.12, valence: 0.05, tension: 0.18, nostalgia: 0.28, calm: 0.05 },
    sceneHints: { environment: "urban", timeOfDay: "late_night" },
  },

  // ── Mountains / long walks / outdoors epic ──────────────────────────────────
  {
    terms: [
      "long mountain top walk",
      "mountain top walk",
      "summit walk",
      "reached the summit",
      "top of the mountain",
      "ridge walk",
      "fell walking",
      "moorland walk",
      "alpine hike",
      "long hike uphill",
      "breathless at the top",
      "panoramic view walk",
      "coastal path walk",
      "cliff top walk",
      "national park hike",
      "10 mile walk",
      "all day hike",
    ],
    weights: { energy: 0.18, valence: 0.22, tension: -0.05, nostalgia: 0.15, calm: 0.2 },
    sceneHints: { environment: "nature", motionState: "walking" },
  },

  // ── Kate Bush / ethereal morning / art-pop feminine ─────────────────────────
  {
    terms: [
      "kate bush-esque morning",
      "kate bush morning",
      "kate bush vibes",
      "kate bush-esque",
      "running up that hill vibes",
      "wuthering heights energy",
      "art pop morning",
      "ethereal morning",
      "theatrical morning",
      "dramatic morning coffee",
    ],
    weights: { energy: 0.08, valence: 0.12, tension: 0.2, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { timeOfDay: "morning" },
    artistOrGenreCue: true,
  },
  {
    terms: [
      "kate bush",
      "bjork",
      "björk",
      "tori amos",
      "fiona apple",
      "regina spektor",
      "cocteau twins",
      "this mortal coil",
      "sophie",
      "sophie xcx",
      "charli xcx",
      "lorde",
      "florence and the machine",
      "florence + the machine",
    ],
    weights: { energy: 0.05, valence: 0.05, tension: 0.22, nostalgia: 0.2, calm: 0.05 },
    artistOrGenreCue: true,
  },

  // ── Rock decades & subgenres ────────────────────────────────────────────────
  {
    terms: ["90s rock", "nineties rock", "90s alternative", "90s grunge era", "1990s rock"],
    weights: { energy: 0.28, valence: 0.05, tension: 0.2, nostalgia: 0.45, calm: -0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["80s rock", "eighties rock", "80s arena rock", "hair metal", "glam rock"],
    weights: { energy: 0.35, valence: 0.15, tension: 0.1, nostalgia: 0.48, calm: -0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["70s rock", "seventies rock", "classic rock", "rock opera", "prog rock", "progressive rock"],
    weights: { energy: 0.25, valence: 0.1, tension: 0.12, nostalgia: 0.42, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["2000s rock", "00s rock", "nu metal", "pop punk", "emo rock", "screamo", "post-hardcore"],
    weights: { energy: 0.38, valence: -0.05, tension: 0.3, nostalgia: 0.4, calm: -0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["grunge", "seattle grunge", "nirvana vibes", "pearl jam vibes", "soundgarden"],
    weights: { energy: 0.3, valence: -0.15, tension: 0.28, nostalgia: 0.38, calm: -0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["britpop", "oasis vibes", "blur vibes", "madchester", "stone roses"],
    weights: { energy: 0.32, valence: 0.2, tension: 0.08, nostalgia: 0.42, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["shoegaze", "shoegazer", "dream pop", "noise pop", "slowdive", "my bloody valentine"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.15, nostalgia: 0.35, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["indie rock", "alternative rock", "alt rock", "garage rock", "psychedelic rock", "stoner rock"],
    weights: { energy: 0.22, valence: 0.05, tension: 0.15, nostalgia: 0.3, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["punk rock", "pop punk", "skate punk", "hardcore punk"],
    weights: { energy: 0.48, valence: 0.0, tension: 0.32, nostalgia: 0.2, calm: -0.4 },
    artistOrGenreCue: true,
  },
  {
    terms: ["blues rock", "southern rock", "americana rock", "heartland rock"],
    weights: { energy: 0.15, valence: 0.08, tension: 0.05, nostalgia: 0.38, calm: 0.1 },
    artistOrGenreCue: true,
  },

  // ── Electronic / dance subgenres ────────────────────────────────────────────
  {
    terms: ["uk garage", "2-step", "speed garage", "bassline"],
    weights: { energy: 0.38, valence: 0.2, tension: 0.12, nostalgia: 0.25, calm: -0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["drum and bass", "dnb", "jungle", "breakbeat hardcore"],
    weights: { energy: 0.45, valence: 0.1, tension: 0.2, nostalgia: 0.2, calm: -0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["trance", "progressive trance", "uplifting trance"],
    weights: { energy: 0.42, valence: 0.25, tension: 0.05, nostalgia: 0.15, calm: -0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["dubstep", "brostep", "bass music", "wobble"],
    weights: { energy: 0.4, valence: -0.05, tension: 0.25, nostalgia: 0.05, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["synthpop", "new wave", "synth wave", "retrowave", "outrun"],
    weights: { energy: 0.2, valence: 0.15, tension: 0.08, nostalgia: 0.45, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["vaporwave", "mallsoft", "chillwave"],
    weights: { energy: -0.15, valence: 0.0, tension: -0.05, nostalgia: 0.5, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["idm", "intelligent dance music", "aphex twin", "boards of canada", "autechre", "squarepusher"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.12, nostalgia: 0.3, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["trip hop", "massive attack", "portishead", "tricky", "bonobo", "thievery corporation"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.15, nostalgia: 0.28, calm: 0.25 },
    artistOrGenreCue: true,
  },

  // ── Pop decades & mainstream eras ───────────────────────────────────────────
  {
    terms: ["y2k pop", "2000s pop", "00s pop", "britney era", "early 2000s"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.0, nostalgia: 0.45, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["2010s pop", "tumblr era", "indie sleaze", "bloghouse"],
    weights: { energy: 0.25, valence: 0.15, tension: 0.1, nostalgia: 0.4, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["motown", "soul classics", "funk", "disco", "disco fever"],
    weights: { energy: 0.35, valence: 0.35, tension: -0.05, nostalgia: 0.4, calm: -0.1 },
    artistOrGenreCue: true,
  },

  // ── Iconic artists (obscure-to-mainstream) ───────────────────────────────────
  {
    terms: ["david bowie", "bowie", "ziggy stardust", "heroes bowie"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.15, nostalgia: 0.35, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["prince", "purple rain", "sign o the times"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.1, nostalgia: 0.35, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["pink floyd", "dark side of the moon", "wish you were here", "comfortably numb"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.1, nostalgia: 0.4, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["led zeppelin", "zeppelin", "stairway energy"],
    weights: { energy: 0.35, valence: 0.1, tension: 0.15, nostalgia: 0.42, calm: -0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["the cure", "robert smith", "disintegration", "goth rock"],
    weights: { energy: 0.05, valence: -0.15, tension: 0.25, nostalgia: 0.35, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["joy division", "new order", "ian curtis", "unknown pleasures"],
    weights: { energy: 0.1, valence: -0.2, tension: 0.3, nostalgia: 0.38, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["the smiths", "morrissey", "johnny marr"],
    weights: { energy: 0.1, valence: -0.1, tension: 0.2, nostalgia: 0.4, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["talking heads", "remain in light", "david byrne"],
    weights: { energy: 0.2, valence: 0.15, tension: 0.1, nostalgia: 0.35, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["steely dan", "yacht rock", "soft rock 70s", "fm rock"],
    weights: { energy: 0.05, valence: 0.2, tension: -0.1, nostalgia: 0.42, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["tom waits", "nick cave", "leonard cohen", "johnny cash", "willie nelson"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.15, nostalgia: 0.4, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["fleetwood mac", "rumours", "stevie nicks", "landslide vibes"],
    weights: { energy: 0.0, valence: 0.1, tension: 0.08, nostalgia: 0.42, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sufjan stevens", "illinois", "carrie and lowell"],
    weights: { energy: -0.15, valence: -0.05, tension: 0.1, nostalgia: 0.38, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["neutral milk hotel", "in the aeroplane", "jeff mangum"],
    weights: { energy: 0.05, valence: 0.05, tension: 0.12, nostalgia: 0.4, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["arcade fire", "funeral arcade fire", "the national", "high and violet"],
    weights: { energy: 0.1, valence: -0.05, tension: 0.18, nostalgia: 0.3, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["wilco", "yankee hotel foxtrot", "pavement", "slanted enchanted"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.1, nostalgia: 0.32, calm: 0.1 },
    artistOrGenreCue: true,
  },

  // ── Obscure / hyper-specific life scenes ────────────────────────────────────
  {
    terms: [
      "laundromat at night",
      "laundrette",
      "washing machine hum",
      "waiting for the spin cycle",
    ],
    weights: { energy: -0.15, valence: -0.08, tension: 0.1, nostalgia: 0.3, calm: 0.15 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: ["ikea trip", "flat pack furniture", "allen key", "building ikea"],
    weights: { energy: 0.05, valence: 0.05, tension: 0.12, nostalgia: 0.1, calm: -0.05 },
  },
  {
    terms: ["hospital waiting room", "ae waiting", "er waiting", "waiting for results"],
    weights: { energy: -0.2, valence: -0.25, tension: 0.4, nostalgia: 0.05, calm: -0.25 },
  },
  {
    terms: ["exam stress", "revision panic", "all nighter study", "dissertation", "thesis writing", "deadline looming"],
    weights: { energy: 0.15, valence: -0.2, tension: 0.42, nostalgia: -0.05, calm: -0.35 },
  },
  {
    terms: ["moving house", "packing boxes", "moving day", "new flat keys"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.2, nostalgia: 0.25, calm: -0.15 },
  },
  {
    terms: ["airport layover", "gate waiting", "delayed flight", "red eye flight", "redeye"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.2, nostalgia: 0.15, calm: 0.05 },
    sceneHints: { environment: "transit" },
  },
  {
    terms: ["ferry crossing", "on the ferry", "boat at night", "channel crossing"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.08, nostalgia: 0.28, calm: 0.2 },
    sceneHints: { environment: "coastal" },
  },
  {
    terms: ["camping", "tent at night", "campfire", "fire pit", "stargazing", "milky way"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.05, nostalgia: 0.2, calm: 0.35 },
    sceneHints: { environment: "nature", timeOfDay: "night" },
  },
  {
    terms: ["vinyl digging", "record shop", "crate digging", "second hand records"],
    weights: { energy: 0.05, valence: 0.15, tension: -0.05, nostalgia: 0.45, calm: 0.1 },
  },
  {
    terms: ["library silence", "reading room", "quiet study hall", "museum afternoon"],
    weights: { energy: -0.25, valence: 0.05, tension: -0.15, nostalgia: 0.15, calm: 0.42 },
  },
  {
    terms: ["chip shop", "chippy", "fish and chips", "kebab shop", "late night takeaway"],
    weights: { energy: 0.05, valence: 0.1, tension: 0.05, nostalgia: 0.35, calm: 0.0 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: ["pub garden", "beer garden", "sunday roast", "roast dinner"],
    weights: { energy: 0.1, valence: 0.25, tension: -0.1, nostalgia: 0.3, calm: 0.2 },
    sceneHints: { timeOfDay: "afternoon" },
  },
  {
    terms: ["warehouse rave", "afters", "after party", "5am club", "sunrise set"],
    weights: { energy: 0.45, valence: 0.15, tension: 0.15, nostalgia: 0.1, calm: -0.4 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["muddy festival", "glastonbury", "field festival", "tent city"],
    weights: { energy: 0.25, valence: 0.2, tension: 0.05, nostalgia: 0.25, calm: -0.1 },
  },
  {
    terms: ["desert highway", "arizona drive", "heat shimmer road", "long straight road"],
    weights: { energy: 0.12, valence: 0.0, tension: 0.1, nostalgia: 0.35, calm: 0.1 },
    sceneHints: { motionState: "driving", environment: "nature" },
  },
  {
    terms: ["lighthouse", "coastal cliff", "seaside walk", "pebble beach", "grey sea"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.08, nostalgia: 0.32, calm: 0.25 },
    sceneHints: { environment: "coastal" },
  },
  {
    terms: ["snow day", "first snow", "snowfall quiet", "frost morning"],
    weights: { energy: -0.2, valence: 0.05, tension: -0.05, nostalgia: 0.3, calm: 0.3 },
    sceneHints: { environment: "winter" },
  },
  {
    terms: ["heatwave", "heat wave", "too hot", "sticky summer night", "fan on full"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.1, nostalgia: 0.15, calm: -0.1 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["skate park", "skating", "bmx", "rollerblading", "half pipe"],
    weights: { energy: 0.35, valence: 0.15, tension: 0.1, nostalgia: 0.2, calm: -0.2 },
  },
  {
    terms: ["funeral", "memorial", "wake", "saying goodbye"],
    weights: { energy: -0.25, valence: -0.35, tension: 0.2, nostalgia: 0.35, calm: 0.1 },
  },
  {
    terms: ["wedding", "wedding day", "walking down the aisle", "reception"],
    weights: { energy: 0.2, valence: 0.4, tension: 0.1, nostalgia: 0.2, calm: 0.05 },
  },
  {
    terms: ["graduation", "graduation day", "leaving uni", "last day of school"],
    weights: { energy: 0.15, valence: 0.3, tension: 0.05, nostalgia: 0.4, calm: 0.05 },
  },

  // ── World / regional ────────────────────────────────────────────────────────
  {
    terms: ["reggae", "dub", "dancehall", "ska", "lovers rock"],
    weights: { energy: 0.15, valence: 0.2, tension: -0.05, nostalgia: 0.2, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["afrobeats", "afrobeat", "amapiano", "afropop"],
    weights: { energy: 0.35, valence: 0.3, tension: 0.05, nostalgia: 0.05, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["latin", "reggaeton", "bachata", "salsa", "bossa nova"],
    weights: { energy: 0.3, valence: 0.3, tension: 0.05, nostalgia: 0.1, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["k-pop", "kpop", "korean pop", "j-pop", "jpop", "anime opening"],
    weights: { energy: 0.35, valence: 0.25, tension: 0.05, nostalgia: 0.15, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["bollywood", "filmi", "indian classical fusion"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.1, nostalgia: 0.2, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["celtic", "irish folk", "scottish folk", "fiddle"],
    weights: { energy: 0.15, valence: 0.15, tension: 0.05, nostalgia: 0.38, calm: 0.1 },
    artistOrGenreCue: true,
  },

  // ── Mood adjectives people actually type ────────────────────────────────────
  {
    terms: ["eerie", "uncanny", "liminal", "backrooms", "empty mall", "dead mall"],
    weights: { energy: -0.15, valence: -0.2, tension: 0.35, nostalgia: 0.25, calm: 0.05 },
  },
  {
    terms: ["wholesome", "comfort show", "feel good", "warm fuzzies", "soft boy autumn"],
    weights: { energy: -0.05, valence: 0.35, tension: -0.2, nostalgia: 0.15, calm: 0.3 },
  },
  {
    terms: ["unhinged", "chaotic energy", "feral", "goblin mode", "gremlin"],
    weights: { energy: 0.35, valence: 0.1, tension: 0.25, nostalgia: -0.05, calm: -0.35 },
  },
  {
    terms: ["academic", "dark academia", "light academia", "study aesthetic"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.08, nostalgia: 0.25, calm: 0.3 },
  },
  {
    terms: ["cottagecore", "fairycore", "goblincore", "coastal grandmother"],
    weights: { energy: -0.1, valence: 0.2, tension: -0.1, nostalgia: 0.3, calm: 0.35 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["industrial", "factory", "warehouse", "concrete", "brutalist"],
    weights: { energy: 0.1, valence: -0.15, tension: 0.3, nostalgia: 0.1, calm: -0.1 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["y2k", "cyber y2k", "flip phone era", "msnmessenger"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.05, nostalgia: 0.48, calm: 0.0 },
    artistOrGenreCue: true,
  },
];
