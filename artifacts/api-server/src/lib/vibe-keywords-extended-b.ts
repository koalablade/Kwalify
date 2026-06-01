/**
 * Extended vibe keywords — batch B (merged after batch A in emotion.ts).
 */

import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

export const EXTENDED_VIBE_KEYWORDS_B: ExtendedVibeKeyword[] = [
  // ── Hip-hop / rap subgenres ─────────────────────────────────────────────────
  {
    terms: ["boom bap", "old school hip hop", "90s hip hop", "golden age hip hop", "east coast rap"],
    weights: { energy: 0.2, valence: 0.05, tension: 0.1, nostalgia: 0.42, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["g-funk", "west coast", "california rap", "dr dre vibes", "snoop vibes"],
    weights: { energy: 0.25, valence: 0.15, tension: 0.05, nostalgia: 0.38, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["southern rap", "crunk", "dirty south", "houston chopped", "screwed and chopped"],
    weights: { energy: 0.2, valence: 0.05, tension: 0.08, nostalgia: 0.35, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["cloud rap", "cloud rap vibes", "atmospheric rap", "ethereal rap"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.1, nostalgia: 0.25, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["emo rap", "sad rap", "melodic rap", "juice wrld vibes", "xxxtentacion vibes"],
    weights: { energy: 0.05, valence: -0.25, tension: 0.2, nostalgia: 0.2, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["conscious rap", "lyrical rap", "storytelling rap", "rap verses"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.15, nostalgia: 0.15, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["phonk", "drift phonk", "memphis phonk", "cowbell phonk"],
    weights: { energy: 0.4, valence: -0.1, tension: 0.25, nostalgia: 0.15, calm: -0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["pluggnb", "rage", "rage beats", "playboi carti vibes", "yeat vibes"],
    weights: { energy: 0.45, valence: 0.0, tension: 0.2, nostalgia: -0.05, calm: -0.4 },
    artistOrGenreCue: true,
  },

  // ── Modern pop / internet genres ────────────────────────────────────────────
  {
    terms: ["hyperpop", "100 gecs", "digicore", "glitch pop"],
    weights: { energy: 0.4, valence: 0.1, tension: 0.25, nostalgia: 0.05, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["bedroom pop", "indie pop", "dream pop pop", "alt pop"],
    weights: { energy: -0.05, valence: 0.15, tension: 0.05, nostalgia: 0.2, calm: 0.2 },
    artistOrGenreCue: true,
  },
  {
    terms: ["synth pop", "electropop", "dance pop", "euro pop"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.0, nostalgia: 0.2, calm: -0.1 },
    artistOrGenreCue: true,
  },

  // ── More electronic depth ───────────────────────────────────────────────────
  {
    terms: ["deep house", "tech house", "minimal techno", "berlin techno", "warehouse techno"],
    weights: { energy: 0.35, valence: 0.05, tension: 0.1, nostalgia: 0.1, calm: -0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["hardstyle", "gabber", "hardcore techno", "industrial techno"],
    weights: { energy: 0.5, valence: -0.05, tension: 0.3, nostalgia: 0.05, calm: -0.45 },
    artistOrGenreCue: true,
  },
  {
    terms: ["dub techno", "ambient techno", "minimal ambient", "berghain"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.08, nostalgia: 0.15, calm: 0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["italo disco", "eurodance", "eurobeat", "initial d"],
    weights: { energy: 0.38, valence: 0.2, tension: 0.05, nostalgia: 0.4, calm: -0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["future bass", "melodic dubstep", "color bass"],
    weights: { energy: 0.3, valence: 0.25, tension: 0.05, nostalgia: 0.1, calm: -0.1 },
    artistOrGenreCue: true,
  },

  // ── Post-rock / experimental / instrumental ─────────────────────────────────
  {
    terms: ["post rock", "post-rock", "godspeed", "explosions in the sky", "sigur ros"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.15, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["math rock", "midwest emo", "american football", "twinkle emo"],
    weights: { energy: 0.15, valence: -0.05, tension: 0.2, nostalgia: 0.35, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["krautrock", "can band", "neu", "motorik"],
    weights: { energy: 0.2, valence: 0.05, tension: 0.1, nostalgia: 0.35, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["neo classical", "modern classical", "piano minimalism", "max richter", "olafur arnalds"],
    weights: { energy: -0.2, valence: 0.1, tension: 0.05, nostalgia: 0.2, calm: 0.4 },
    artistOrGenreCue: true,
  },

  // ── More iconic artists (batch B) ───────────────────────────────────────────
  {
    terms: ["tame impala", "currents", "lonerism", "the less i know"],
    weights: { energy: 0.1, valence: 0.1, tension: 0.05, nostalgia: 0.25, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["dua lipa", "future nostalgia", "disco pop"],
    weights: { energy: 0.3, valence: 0.3, tension: -0.05, nostalgia: 0.15, calm: -0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["harry styles", "fine line", "as it was"],
    weights: { energy: 0.15, valence: 0.25, tension: -0.05, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["adele", "21 adele", "someone like you vibes"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.15, nostalgia: 0.3, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["amy winehouse", "back to black", "frank winehouse"],
    weights: { energy: 0.0, valence: -0.1, tension: 0.1, nostalgia: 0.38, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["lana del rey", "born to die", "summertime sadness"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.12, nostalgia: 0.4, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["rihanna", "anti rihanna", "umbrella era"],
    weights: { energy: 0.15, valence: 0.2, tension: 0.05, nostalgia: 0.25, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["beyonce", "lemonade", "renaissance beyonce"],
    weights: { energy: 0.25, valence: 0.25, tension: 0.1, nostalgia: 0.15, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["drake", "views drake", "take care drake", "ovo"],
    weights: { energy: 0.05, valence: -0.05, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["travis scott", "astroworld", "rodeo travis"],
    weights: { energy: 0.2, valence: 0.0, tension: 0.15, nostalgia: 0.15, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["j cole", "2014 forest hills", "kendrick adjacent"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.12, nostalgia: 0.2, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["outkast", "andre 3000", "hey ya vibes"],
    weights: { energy: 0.25, valence: 0.25, tension: 0.0, nostalgia: 0.35, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["wu-tang", "wu tang", "rza beats"],
    weights: { energy: 0.2, valence: 0.05, tension: 0.2, nostalgia: 0.38, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["nas", "illmatic", "mobb deep", "shook ones"],
    weights: { energy: 0.15, valence: -0.1, tension: 0.25, nostalgia: 0.4, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["eminem", "slim shady", "marshall mathers"],
    weights: { energy: 0.35, valence: -0.05, tension: 0.3, nostalgia: 0.25, calm: -0.25 },
    artistOrGenreCue: true,
  },
  {
    terms: ["jay-z", "jay z", "reasonable doubt"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.1, nostalgia: 0.35, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["depeche mode", "violator", "enjoy the silence"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.15, nostalgia: 0.38, calm: 0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["pet shop boys", "synth british", "new romantic"],
    weights: { energy: 0.2, valence: 0.15, tension: 0.05, nostalgia: 0.42, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["underworld", "born slippy", "big beat", "chemical brothers", "prodigy firestarter"],
    weights: { energy: 0.45, valence: 0.1, tension: 0.15, nostalgia: 0.3, calm: -0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["fatboy slim", "moby play", "gorillaz", "demon days"],
    weights: { energy: 0.25, valence: 0.15, tension: 0.05, nostalgia: 0.35, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["st vincent", "annie clark", "pj harvey", "rid of me"],
    weights: { energy: 0.15, valence: -0.05, tension: 0.22, nostalgia: 0.25, calm: 0.0 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sonic youth", "daydream nation", "dinosaur jr", "my bloody valentine loveless"],
    weights: { energy: 0.2, valence: 0.0, tension: 0.2, nostalgia: 0.35, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["rem", "automatic for the people", "u2 joshua tree", "coldplay parachutes"],
    weights: { energy: 0.1, valence: 0.1, tension: 0.05, nostalgia: 0.35, calm: 0.15 },
    artistOrGenreCue: true,
  },
  {
    terms: ["oasis morning glory", "wonderwall vibes", "champagne supernova"],
    weights: { energy: 0.2, valence: 0.15, tension: 0.05, nostalgia: 0.42, calm: 0.05 },
    artistOrGenreCue: true,
  },

  // ── "-esque" / "sounds like" phrases ────────────────────────────────────────
  {
    terms: ["sounds like radiohead", "radiohead-esque", "ok computer vibes"],
    weights: { energy: -0.15, valence: -0.2, tension: 0.28, nostalgia: 0.22, calm: -0.05 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sounds like frank ocean", "frank ocean-esque", "blonde vibes"],
    weights: { energy: -0.1, valence: 0.08, tension: 0.1, nostalgia: 0.28, calm: 0.18 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sounds like the 1975", "1975-esque", "a brief inquiry"],
    weights: { energy: 0.1, valence: 0.1, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sounds like bon iver", "bon iver-esque", "holocene vibes"],
    weights: { energy: -0.2, valence: 0.05, tension: 0.05, nostalgia: 0.32, calm: 0.28 },
    artistOrGenreCue: true,
  },
  {
    terms: ["sounds like daft punk", "daft punk-esque", "discovery vibes"],
    weights: { energy: 0.28, valence: 0.22, tension: 0.0, nostalgia: 0.28, calm: -0.08 },
    artistOrGenreCue: true,
  },
  {
    terms: ["studio ghibli", "ghibli", "joe hisaishi", "anime soundtrack", "spirited away"],
    weights: { energy: -0.05, valence: 0.2, tension: -0.1, nostalgia: 0.35, calm: 0.35 },
    artistOrGenreCue: true,
  },
  {
    terms: ["blade runner", "vangelis", "interstellar score", "hans zimmer", "inception bwaa"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.25, nostalgia: 0.2, calm: 0.1 },
    artistOrGenreCue: true,
  },
  {
    terms: ["stranger things", "synth horror", "retro horror synth"],
    weights: { energy: 0.05, valence: -0.1, tension: 0.35, nostalgia: 0.4, calm: -0.05 },
    artistOrGenreCue: true,
  },

  // ── Sports / physical ───────────────────────────────────────────────────────
  {
    terms: ["long run", "marathon training", "5k run", "jogging", "park run"],
    weights: { energy: 0.35, valence: 0.15, tension: 0.05, nostalgia: 0.0, calm: -0.25 },
    sceneHints: { motionState: "running" },
  },
  {
    terms: ["cycling", "bike ride", "peloton", "spin class", "indoor cycling"],
    weights: { energy: 0.4, valence: 0.1, tension: 0.05, nostalgia: 0.0, calm: -0.3 },
  },
  {
    terms: ["swimming", "laps", "pool swim", "open water swim"],
    weights: { energy: 0.2, valence: 0.1, tension: -0.05, nostalgia: 0.05, calm: 0.2 },
  },
  {
    terms: ["yoga", "stretching", "pilates", "cool down", "warm down"],
    weights: { energy: -0.2, valence: 0.15, tension: -0.25, nostalgia: 0.05, calm: 0.45 },
  },
  {
    terms: ["football match", "pre match", "post match", "stadium", "match day"],
    weights: { energy: 0.35, valence: 0.2, tension: 0.15, nostalgia: 0.1, calm: -0.2 },
  },
  {
    terms: ["boxing", "sparring", "heavy bag", "fight night"],
    weights: { energy: 0.45, valence: -0.05, tension: 0.35, nostalgia: 0.0, calm: -0.4 },
  },

  // ── Domestic / mundane (high specificity) ───────────────────────────────────
  {
    terms: ["doing the dishes", "washing up", "cleaning the kitchen", "sunday clean"],
    weights: { energy: 0.05, valence: 0.05, tension: -0.1, nostalgia: 0.1, calm: 0.25 },
  },
  {
    terms: ["shower thoughts", "in the shower", "hot shower", "long shower"],
    weights: { energy: -0.1, valence: 0.1, tension: -0.15, nostalgia: 0.1, calm: 0.3 },
    sceneHints: { environment: "indoor" },
  },
  {
    terms: ["bath", "bubble bath", "soak in the tub"],
    weights: { energy: -0.25, valence: 0.15, tension: -0.2, nostalgia: 0.1, calm: 0.42 },
  },
  {
    terms: ["cooking dinner", "meal prep", "chopping onions", "stir fry"],
    weights: { energy: 0.1, valence: 0.15, tension: -0.05, nostalgia: 0.1, calm: 0.15 },
  },
  {
    terms: ["baking", "bread baking", "sourdough", "cake in the oven"],
    weights: { energy: -0.05, valence: 0.2, tension: -0.1, nostalgia: 0.2, calm: 0.3 },
  },
  {
    terms: ["dog walk", "walking the dog", "puppy walk", "park with dog"],
    weights: { energy: 0.1, valence: 0.2, tension: -0.1, nostalgia: 0.05, calm: 0.2 },
    sceneHints: { motionState: "walking", environment: "nature" },
  },
  {
    terms: ["cat nap", "afternoon nap", "power nap", "dozing on the sofa"],
    weights: { energy: -0.4, valence: 0.1, tension: -0.3, nostalgia: 0.05, calm: 0.4 },
  },
  {
    terms: ["hangover", "hungover", "morning after", "regret last night"],
    weights: { energy: -0.3, valence: -0.2, tension: 0.1, nostalgia: 0.1, calm: 0.05 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["hangover cure", "greasy breakfast", "full english", "brunch recovery"],
    weights: { energy: 0.05, valence: 0.1, tension: -0.05, nostalgia: 0.15, calm: 0.1 },
    sceneHints: { timeOfDay: "morning" },
  },

  // ── Cities / travel vibes ───────────────────────────────────────────────────
  {
    terms: ["tokyo night", "shibuya", "neon tokyo", "japan night"],
    weights: { energy: 0.15, valence: 0.1, tension: 0.1, nostalgia: 0.2, calm: -0.05 },
    sceneHints: { environment: "urban", timeOfDay: "night" },
  },
  {
    terms: ["nyc subway", "new york subway", "manhattan night", "brooklyn walk"],
    weights: { energy: 0.12, valence: 0.0, tension: 0.15, nostalgia: 0.25, calm: -0.1 },
    sceneHints: { environment: "urban", environment2: "transit" } as any,
  },
  {
    terms: ["paris cafe", "café paris", "left bank", "cobblestone"],
    weights: { energy: -0.05, valence: 0.2, tension: -0.05, nostalgia: 0.35, calm: 0.25 },
    sceneHints: { environment: "social_indoor" },
  },
  {
    terms: ["amsterdam canal", "bike amsterdam", "dutch indie"],
    weights: { energy: 0.1, valence: 0.15, tension: -0.05, nostalgia: 0.2, calm: 0.2 },
  },
  {
    terms: ["la sunset", "california sunset", "pacific coast highway", "pch drive"],
    weights: { energy: 0.05, valence: 0.25, tension: -0.05, nostalgia: 0.3, calm: 0.2 },
    sceneHints: { timeOfDay: "evening", motionState: "driving", environment: "coastal" },
  },
  {
    terms: ["london rain", "grey london", "tube commute", "northern line"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.1, nostalgia: 0.2, calm: 0.1 },
    sceneHints: { environment: "rainy", environment2: "transit" } as any,
  },

  // ── Seasons / holidays ────────────────────────────────────────────────────────
  {
    terms: ["christmas eve", "christmas morning", "holiday season", "winter holiday"],
    weights: { energy: 0.05, valence: 0.3, tension: -0.1, nostalgia: 0.45, calm: 0.15 },
    sceneHints: { environment: "winter" },
  },
  {
    terms: ["halloween", "spooky season", "october vibes", "trick or treat"],
    weights: { energy: 0.1, valence: -0.05, tension: 0.3, nostalgia: 0.25, calm: -0.05 },
  },
  {
    terms: ["bonfire night", "fireworks", "guy fawkes", "new year's eve", "countdown"],
    weights: { energy: 0.25, valence: 0.25, tension: 0.1, nostalgia: 0.3, calm: -0.1 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["spring morning", "birds singing", "blossom", "cherry blossom"],
    weights: { energy: 0.1, valence: 0.3, tension: -0.15, nostalgia: 0.15, calm: 0.25 },
    sceneHints: { timeOfDay: "morning", environment: "nature" },
  },
  {
    terms: ["autumn walk", "fall leaves", "crunchy leaves", "october walk", "pumpkin spice"],
    weights: { energy: 0.0, valence: 0.1, tension: -0.05, nostalgia: 0.35, calm: 0.2 },
    sceneHints: { environment: "nature", motionState: "walking" },
  },

  // ── Gaming / internet ───────────────────────────────────────────────────────
  {
    terms: ["minecraft", "minecraft vibes", "c418", "blocky calm"],
    weights: { energy: -0.15, valence: 0.15, tension: -0.2, nostalgia: 0.35, calm: 0.35 },
  },
  {
    terms: ["late night gaming", "ranked grind", "one more game", "gaming session"],
    weights: { energy: 0.2, valence: 0.05, tension: 0.2, nostalgia: 0.1, calm: -0.15 },
    sceneHints: { timeOfDay: "late_night", environment: "indoor" },
  },
  {
    terms: ["boss fight", "final boss", "epic boss", "dark souls"],
    weights: { energy: 0.4, valence: -0.1, tension: 0.4, nostalgia: 0.1, calm: -0.35 },
  },
  {
    terms: ["minecraft cave", "underground vibes", "deep dark"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.35, nostalgia: 0.15, calm: 0.05 },
  },

  // ── Tempo / texture words people type ───────────────────────────────────────
  {
    terms: ["slow songs", "slow tempo", "ballad", "ballads", "slow burn"],
    weights: { energy: -0.35, valence: 0.0, tension: -0.1, nostalgia: 0.2, calm: 0.25 },
  },
  {
    terms: ["fast paced", "uptempo", "high bpm", "bangers only", "all bangers"],
    weights: { energy: 0.45, valence: 0.2, tension: 0.1, nostalgia: -0.05, calm: -0.4 },
  },
  {
    terms: ["acoustic only", "unplugged", "stripped back", "raw acoustic", "fingerpicking"],
    weights: { energy: -0.15, valence: 0.05, tension: -0.1, nostalgia: 0.25, calm: 0.3 },
    artistOrGenreCue: true,
  },
  {
    terms: ["instrumental", "no vocals", "no words", "wordless", "vocals minimal"],
    weights: { energy: -0.05, valence: 0.05, tension: -0.05, nostalgia: 0.1, calm: 0.25 },
  },
  {
    terms: ["bass heavy", "sub bass", "low end", "808s"],
    weights: { energy: 0.25, valence: 0.0, tension: 0.15, nostalgia: 0.05, calm: -0.2 },
  },
  {
    terms: ["guitar driven", "riff", "power chords", "shredding"],
    weights: { energy: 0.35, valence: 0.05, tension: 0.2, nostalgia: 0.15, calm: -0.25 },
    artistOrGenreCue: true,
  },

  // ── Mental health adjacent (gentle) ─────────────────────────────────────────
  {
    terms: ["therapy session", "after therapy", "processing feelings", "journaling"],
    weights: { energy: -0.15, valence: -0.05, tension: 0.1, nostalgia: 0.15, calm: 0.25 },
  },
  {
    terms: ["panic attack", "panicking", "spiralling", "spiraling", "can't breathe"],
    weights: { energy: 0.2, valence: -0.35, tension: 0.5, nostalgia: 0.0, calm: -0.45 },
  },
  {
    terms: ["dissociating", "dissociation", "not real", "unreal", "depersonalization"],
    weights: { energy: -0.2, valence: -0.15, tension: 0.25, nostalgia: 0.1, calm: 0.1 },
  },
  {
    terms: ["manic", "mania", "hypomanic", "too much energy brain"],
    weights: { energy: 0.4, valence: 0.1, tension: 0.3, nostalgia: -0.05, calm: -0.4 },
  },
  {
    terms: ["burnout sunday", "can't get out of bed", "bed rot", "bedrot"],
    weights: { energy: -0.45, valence: -0.15, tension: 0.05, nostalgia: 0.05, calm: 0.2 },
    sceneHints: { environment: "indoor" },
  },

  // ── Work / school micro-scenes ──────────────────────────────────────────────
  {
    terms: ["monday morning", "case of the mondays", "back to work", "commute dread"],
    weights: { energy: -0.05, valence: -0.15, tension: 0.2, nostalgia: 0.0, calm: -0.1 },
    sceneHints: { timeOfDay: "morning", motionState: "transit" },
  },
  {
    terms: ["friday afternoon", "clock watching", "almost weekend", "end of week"],
    weights: { energy: 0.15, valence: 0.25, tension: -0.1, nostalgia: 0.05, calm: 0.05 },
    sceneHints: { timeOfDay: "afternoon" },
  },
  {
    terms: ["presentation nerves", "job interview", "interview tomorrow", "big meeting"],
    weights: { energy: 0.15, valence: -0.15, tension: 0.45, nostalgia: 0.0, calm: -0.35 },
  },
  {
    terms: ["got the job", "promotion", "passed the exam", "aced it"],
    weights: { energy: 0.3, valence: 0.45, tension: -0.15, nostalgia: 0.05, calm: 0.0 },
  },
  {
    terms: ["failed the exam", "rejected", "didn't get in", "flunked"],
    weights: { energy: -0.2, valence: -0.4, tension: 0.25, nostalgia: 0.1, calm: -0.15 },
  },

  // ── Relationships ───────────────────────────────────────────────────────────
  {
    terms: ["first date", "nervous date", "date night", "dinner date"],
    weights: { energy: 0.1, valence: 0.25, tension: 0.2, nostalgia: 0.05, calm: -0.1 },
  },
  {
    terms: ["missing someone", "miss you", "long distance", "far away from you"],
    weights: { energy: -0.15, valence: -0.15, tension: 0.15, nostalgia: 0.4, calm: 0.05 },
  },
  {
    terms: ["reconnecting", "old friend", "caught up", "haven't seen you in years"],
    weights: { energy: 0.1, valence: 0.3, tension: -0.05, nostalgia: 0.45, calm: 0.1 },
  },
  {
    terms: ["argument makeup", "made up", "forgive", "second chance"],
    weights: { energy: 0.05, valence: 0.25, tension: -0.1, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["situationship", "talking stage", "undefined", "it's complicated"],
    weights: { energy: 0.0, valence: -0.05, tension: 0.25, nostalgia: 0.1, calm: -0.1 },
  },

  // ── More UK / niche places ──────────────────────────────────────────────────
  {
    terms: ["tesco run", "late tesco", "24 hour supermarket", "asda", "sainsbury's"],
    weights: { energy: 0.0, valence: 0.0, tension: 0.05, nostalgia: 0.15, calm: 0.0 },
    sceneHints: { environment: "urban", timeOfDay: "late_night" },
  },
  {
    terms: ["night bus", "last bus home", "night tube", "drunk bus"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.1, nostalgia: 0.25, calm: 0.05 },
    sceneHints: { environment: "transit", timeOfDay: "late_night" },
  },
  {
    terms: ["uni halls", "student house", "shared kitchen", "house party uni"],
    weights: { energy: 0.2, valence: 0.15, tension: 0.1, nostalgia: 0.35, calm: -0.1 },
  },
  {
    terms: ["council estate summer", "ends", "block party", "yard party"],
    weights: { energy: 0.25, valence: 0.2, tension: 0.05, nostalgia: 0.3, calm: -0.1 },
  },
  {
    terms: ["country pub", "village pub", "local", "pint at the pub"],
    weights: { energy: 0.05, valence: 0.2, tension: -0.1, nostalgia: 0.35, calm: 0.15 },
  },

  // ── Oddly specific (user-requested style) ───────────────────────────────────
  {
    terms: [
      "car boot sale",
      "boot fair",
      "charity shop haul",
      "thrift haul",
      "ebay scroll",
      "depop scroll",
    ],
    weights: { energy: 0.05, valence: 0.1, tension: -0.05, nostalgia: 0.35, calm: 0.05 },
  },
  {
    terms: ["greenhouse", "gardening", "potting plants", "allotment", "compost"],
    weights: { energy: -0.05, valence: 0.2, tension: -0.15, nostalgia: 0.15, calm: 0.35 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["stuck in traffic", "traffic jam", "m25", "ring road", "crawling traffic"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.25, nostalgia: 0.05, calm: -0.15 },
    sceneHints: { motionState: "driving", environment: "urban" },
  },
  {
    terms: ["car wash", "jet wash", "vacuum the car", "detailing"],
    weights: { energy: 0.05, valence: 0.1, tension: -0.05, nostalgia: 0.2, calm: 0.15 },
  },
  {
    terms: ["smoke break", "cigarette break", "vape break", "outside the office"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.15, nostalgia: 0.15, calm: 0.05 },
  },
  {
    terms: ["waiting room", "dentist waiting", "optician", "blood test waiting"],
    weights: { energy: -0.15, valence: -0.2, tension: 0.35, nostalgia: 0.0, calm: -0.2 },
  },
  {
    terms: ["plane landing", "touchdown", "coming home flight", "landing at heathrow"],
    weights: { energy: 0.05, valence: 0.15, tension: -0.05, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { environment: "transit" },
  },
  {
    terms: ["hostel", "backpacking", "gap year", "interrail", "eurotrip"],
    weights: { energy: 0.15, valence: 0.2, tension: 0.05, nostalgia: 0.3, calm: 0.0 },
  },
  {
    terms: ["ski trip", "skiing", "après ski", "apres ski", "mountain lodge"],
    weights: { energy: 0.2, valence: 0.25, tension: 0.05, nostalgia: 0.2, calm: 0.05 },
    sceneHints: { environment: "winter", environment2: "nature" } as any,
  },
  {
    terms: ["surf", "surfing", "beach morning", "early surf"],
    weights: { energy: 0.25, valence: 0.3, tension: 0.0, nostalgia: 0.1, calm: 0.1 },
    sceneHints: { environment: "coastal", timeOfDay: "morning" },
  },
];
