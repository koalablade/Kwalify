/**
 * Semantic Interpreter — Layer 0 of the moment pipeline.
 *
 * Converts ANY free-text vibe input (including creative, abstract, poetic,
 * slang, metaphorical, or fragmented descriptions) into a structured semantic
 * interpretation that feeds the rest of the scoring pipeline.
 *
 * Architecture:
 * 1. Structural decomposition (time / place / person state / atmosphere / narrative)
 * 2. Semantic anchor bank scoring (40+ archetypal emotional clusters)
 * 3. Hybrid weighting — combines structural context with anchor similarity
 * 4. Fallback expansion — broadens genre/emotion space when confidence is low
 *
 * This runs BEFORE the canonical scene canonicalizer and acts as a semantic
 * pre-pass that boosts signals for the downstream pipeline.
 */

import type { EmotionProfile } from "./emotion";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SemanticInterpretation {
  /** 0–1 overall confidence in the interpretation */
  confidence: number;
  /** Primary emotional cluster label */
  primaryCluster: string;
  /** Secondary cluster (second-best match) */
  secondaryCluster: string | null;
  /** Derived emotion profile delta (to blend into the base profile) */
  emotionDelta: Partial<EmotionProfile>;
  /** Scene context overrides */
  sceneContext: {
    environment?: string;
    timeOfDay?: string;
    motionState?: string;
  };
  /** Suggested canonical scene ID (if we found a strong match) */
  suggestedCanonical: string | null;
  /** Aesthetic/genre cluster tags */
  aestheticTags: string[];
  /** Whether this input appears creative/abstract/poetic */
  isAbstract: boolean;
  /** Whether a contrast/contradiction was detected */
  hasContrast: boolean;
  /** Dominant narrative type */
  narrativeType:
    | "scene_description"
    | "emotional_state"
    | "activity"
    | "metaphor"
    | "memory"
    | "journey"
    | "default";
  /** Human-readable explanation of the interpretation */
  summary: string;
}

interface SemanticAnchor {
  id: string;
  label: string;
  /** Word-level terms that strongly suggest this cluster (any match = hit) */
  terms: string[];
  /** Phrase-level matches (scored higher) */
  phrases: string[];
  /** Structural cues that boost this anchor */
  structuralBoost?: {
    isAbstract?: boolean;
    hasContrast?: boolean;
    hasMotion?: boolean;
    hasTemporalAnchor?: boolean;
    hasNarrative?: boolean;
    isMemory?: boolean;
  };
  emotionVector: {
    energy: number;
    valence: number;
    tension: number;
    nostalgia: number;
    calm: number;
  };
  sceneContext: {
    environment?: string;
    timeOfDay?: string;
    motionState?: string;
  };
  suggestedCanonical?: string;
  aestheticTags: string[];
  narrativeType: SemanticInterpretation["narrativeType"];
}

// ─── SEMANTIC ANCHOR BANK ─────────────────────────────────────────────────────

const SEMANTIC_ANCHORS: SemanticAnchor[] = [
  // ── LIMINAL / DRIFTING NIGHT ─────────────────────────────────────────────
  {
    id: "liminal_night_drift",
    label: "Liminal Night — Drifting",
    terms: ["nothing", "nowhere", "aimless", "empty", "liminal", "floating", "between", "suspended", "drift", "drifting", "blank", "hollow"],
    phrases: ["thinking about nothing", "going nowhere", "driving nowhere", "empty road", "alone with thoughts", "middle of nowhere"],
    structuralBoost: { isAbstract: true, hasTemporalAnchor: true },
    emotionVector: { energy: 0.22, valence: 0.28, tension: 0.18, nostalgia: 0.42, calm: 0.55 },
    sceneContext: { timeOfDay: "late_night" },
    suggestedCanonical: "night_drive_alone_reflection",
    aestheticTags: ["ambient", "indie folk", "lo-fi", "slowcore", "shoegaze"],
    narrativeType: "emotional_state",
  },

  // ── RURAL NIGHT / DIRT ROAD ───────────────────────────────────────────────
  {
    id: "rural_night_isolation",
    label: "Rural Night — Isolation & Calm",
    terms: ["dirt", "road", "rural", "country", "highway", "field", "gravel", "dust", "open", "flat", "plains", "empty sky"],
    phrases: ["dirt road", "country road", "back road", "open road", "two-lane", "outskirts", "edge of town", "middle of nowhere"],
    structuralBoost: { hasTemporalAnchor: true, hasMotion: true },
    emotionVector: { energy: 0.28, valence: 0.32, tension: 0.12, nostalgia: 0.52, calm: 0.5 },
    sceneContext: { environment: "nature", timeOfDay: "late_night", motionState: "driving" },
    suggestedCanonical: "night_drive_alone_reflection",
    aestheticTags: ["outlaw country", "americana", "indie folk", "alt-country", "ambient country", "soft rock"],
    narrativeType: "scene_description",
  },

  // ── CINEMATIC MEMORY / MOVIE FEELING ─────────────────────────────────────
  {
    id: "cinematic_memory_reflection",
    label: "Cinematic Memory — Already Ended",
    terms: ["movie", "film", "scene", "credits", "ended", "over", "finished", "chapter", "montage", "soundtrack", "score"],
    phrases: ["movie that already ended", "film that ended", "like a movie", "feel like a film", "life is a movie", "end credits", "after the credits", "last scene", "cinematic"],
    structuralBoost: { isAbstract: true, hasNarrative: true, isMemory: true },
    emotionVector: { energy: 0.2, valence: 0.3, tension: 0.22, nostalgia: 0.72, calm: 0.45 },
    sceneContext: { timeOfDay: "evening" },
    suggestedCanonical: "library_archaeology",
    aestheticTags: ["post-rock", "ambient", "dream pop", "film score", "synthwave", "shoegaze"],
    narrativeType: "metaphor",
  },

  // ── INTROSPECTIVE DRIVE ───────────────────────────────────────────────────
  {
    id: "introspective_drive",
    label: "Introspective Drive",
    terms: ["thinking", "thoughts", "mind", "reflecting", "considering", "wondering", "processing", "clarity", "headspace"],
    phrases: ["thinking too much", "lost in thought", "clearing my head", "drive and think", "thinking out loud", "processing everything"],
    structuralBoost: { hasMotion: true },
    emotionVector: { energy: 0.3, valence: 0.35, tension: 0.28, nostalgia: 0.38, calm: 0.4 },
    sceneContext: { motionState: "driving" },
    suggestedCanonical: "night_drive_alone_reflection",
    aestheticTags: ["indie rock", "alt-country", "singer-songwriter", "post-rock", "ambient"],
    narrativeType: "emotional_state",
  },

  // ── BITTERSWEET / WARM SADNESS ────────────────────────────────────────────
  {
    id: "bittersweet_warm_sadness",
    label: "Bittersweet — Warm Sadness",
    terms: ["bittersweet", "sad", "warm", "wistful", "mixed", "ache", "longing", "tender", "soft"],
    phrases: ["summer sadness", "happy sad", "sad but warm", "warm melancholy", "nostalgic sadness", "bittersweet feeling", "beautiful sadness"],
    structuralBoost: { hasContrast: true, isAbstract: true },
    emotionVector: { energy: 0.28, valence: 0.42, tension: 0.2, nostalgia: 0.6, calm: 0.35 },
    sceneContext: {},
    aestheticTags: ["dream pop", "indie pop", "bedroom pop", "soft rock", "folk"],
    narrativeType: "emotional_state",
  },

  // ── CALM CONTRADICTION / ZEN SPEED ────────────────────────────────────────
  {
    id: "calm_inside_chaos_outside",
    label: "Calm Inside — Fast Outside",
    terms: ["calm", "inside", "fast", "speed", "rush", "despite", "still", "centered", "peace", "chaos"],
    phrases: ["driving fast but calm", "calm inside", "fast but calm", "chaos outside calm inside", "eye of the storm", "still in motion", "moving but peaceful"],
    structuralBoost: { hasContrast: true, hasMotion: true },
    emotionVector: { energy: 0.55, valence: 0.5, tension: 0.2, nostalgia: 0.15, calm: 0.62 },
    sceneContext: { motionState: "driving" },
    aestheticTags: ["post-rock", "ambient techno", "electronic", "downtempo", "trip-hop"],
    narrativeType: "emotional_state",
  },

  // ── CINEMATIC DUSK / GOLDEN HOUR FAREWELL ─────────────────────────────────
  {
    id: "golden_hour_farewell",
    label: "Golden Hour — End of Something",
    terms: ["golden", "dusk", "fading", "fades", "last", "goodbye", "sunset", "end", "final", "closing", "twilight"],
    phrases: ["golden hour", "end of summer", "last day", "last drive", "final scene", "summer ending", "goodbye to", "saying goodbye", "things ending"],
    structuralBoost: { hasNarrative: true, isMemory: true },
    emotionVector: { energy: 0.28, valence: 0.45, tension: 0.18, nostalgia: 0.68, calm: 0.38 },
    sceneContext: { timeOfDay: "evening", environment: "nature" },
    suggestedCanonical: "summer_afternoon_drift",
    aestheticTags: ["indie folk", "dream pop", "ambient", "shoegaze", "alternative"],
    narrativeType: "memory",
  },

  // ── LATE NIGHT SOLITUDE / 2AM ─────────────────────────────────────────────
  {
    id: "late_night_2am_solitude",
    label: "Late Night — 2AM Solitude",
    terms: ["2am", "1am", "3am", "midnight", "late night", "sleepless", "insomnia", "awake", "can't sleep"],
    phrases: ["can't sleep", "wide awake at", "up at 2am", "still awake", "late night thoughts", "3am thoughts", "middle of the night"],
    structuralBoost: { hasTemporalAnchor: true },
    emotionVector: { energy: 0.18, valence: 0.22, tension: 0.25, nostalgia: 0.48, calm: 0.5 },
    sceneContext: { timeOfDay: "late_night" },
    suggestedCanonical: "night_drive_alone_reflection",
    aestheticTags: ["lo-fi", "ambient", "dream pop", "indie", "shoegaze", "slowcore"],
    narrativeType: "scene_description",
  },

  // ── MEMORY ARCHAEOLOGY ────────────────────────────────────────────────────
  {
    id: "memory_archaeology",
    label: "Memory Archaeology — Old Feelings",
    terms: ["remember", "memory", "memories", "past", "back then", "old", "forgotten", "found", "again", "used to", "years ago", "childhood"],
    phrases: ["songs from another life", "back in the day", "felt like that again", "used to feel", "found an old", "going back to", "remember when", "took me back"],
    structuralBoost: { isMemory: true },
    emotionVector: { energy: 0.22, valence: 0.38, tension: 0.15, nostalgia: 0.88, calm: 0.42 },
    sceneContext: {},
    suggestedCanonical: "library_archaeology",
    aestheticTags: ["retro", "indie", "alternative", "80s", "90s", "throwback"],
    narrativeType: "memory",
  },

  // ── RAINY CITY / GREY URBAN ───────────────────────────────────────────────
  {
    id: "rainy_city_grey",
    label: "Rainy City — Grey Urban Introspection",
    terms: ["rain", "grey", "wet", "drizzle", "damp", "overcast", "cloudy", "mist", "foggy", "bleak", "cold"],
    phrases: ["rainy city", "grey city", "wet streets", "rainy walk", "cold rain", "rain on the window", "puddles", "grey sky"],
    structuralBoost: {},
    emotionVector: { energy: 0.22, valence: 0.25, tension: 0.2, nostalgia: 0.38, calm: 0.48 },
    sceneContext: { environment: "urban", timeOfDay: "evening" },
    suggestedCanonical: "rain_windscreen_night_drive",
    aestheticTags: ["neo-soul", "jazz", "lo-fi hip-hop", "downtempo", "trip-hop", "alternative"],
    narrativeType: "scene_description",
  },

  // ── SURREAL / DETACHED ────────────────────────────────────────────────────
  {
    id: "surreal_detached",
    label: "Surreal — Detached from Reality",
    terms: ["surreal", "dream", "weird", "strange", "bizarre", "dissociated", "unreal", "floating", "outside", "detached", "observer"],
    phrases: ["like a dream", "feels unreal", "watching myself", "outside my body", "doesn't feel real", "floating above", "like someone else", "alternate reality"],
    structuralBoost: { isAbstract: true, hasNarrative: true },
    emotionVector: { energy: 0.2, valence: 0.3, tension: 0.35, nostalgia: 0.3, calm: 0.38 },
    sceneContext: {},
    aestheticTags: ["dream pop", "ambient", "psychedelic", "post-rock", "shoegaze", "art rock"],
    narrativeType: "metaphor",
  },

  // ── HIGH ENERGY / FORWARD MOTION ─────────────────────────────────────────
  {
    id: "high_energy_forward",
    label: "High Energy — Forward, Purposeful",
    terms: ["pump", "hype", "energy", "go", "moving", "forward", "push", "power", "strength", "motivated", "unstoppable"],
    phrases: ["full speed", "keep going", "moving forward", "nothing can stop", "on a mission", "feel alive", "ready to go"],
    structuralBoost: { hasMotion: true },
    emotionVector: { energy: 0.88, valence: 0.7, tension: 0.3, nostalgia: 0.05, calm: 0.12 },
    sceneContext: { motionState: "active" },
    aestheticTags: ["hip-hop", "electronic", "rock", "pop", "EDM", "alternative"],
    narrativeType: "emotional_state",
  },

  // ── GYM / RAGE WORKOUT ────────────────────────────────────────────────────
  {
    id: "gym_rage_intensity",
    label: "Gym Rage — Maximum Intensity",
    terms: ["gym", "rage", "lift", "workout", "training", "grind", "sweat", "beast", "aggressive", "hard", "heavy", "intense"],
    phrases: ["gym session", "lifting heavy", "beast mode", "rage workout", "no pain no gain", "training hard"],
    structuralBoost: { hasMotion: true },
    emotionVector: { energy: 0.98, valence: 0.45, tension: 0.7, nostalgia: 0.05, calm: 0.04 },
    sceneContext: { environment: "gym", motionState: "active" },
    aestheticTags: ["hard techno", "trap metal", "rap", "metal", "drum and bass"],
    narrativeType: "activity",
  },

  // ── PARTY / EUPHORIC SOCIAL ───────────────────────────────────────────────
  {
    id: "euphoric_social_party",
    label: "Euphoric Social — Party / Festival",
    terms: ["party", "dance", "festival", "rave", "club", "together", "crowd", "euphoria", "joy", "celebrate", "fun", "friends"],
    phrases: ["dance floor", "all night", "euphoric feeling", "festival vibes", "up all night", "feel the music"],
    structuralBoost: {},
    emotionVector: { energy: 0.92, valence: 0.92, tension: 0.15, nostalgia: 0.08, calm: 0.06 },
    sceneContext: { environment: "social_indoor", timeOfDay: "late_night" },
    aestheticTags: ["EDM", "pop", "dance", "house", "disco", "indie pop"],
    narrativeType: "activity",
  },

  // ── SOFT MORNING / GENTLE WAKEUP ─────────────────────────────────────────
  {
    id: "soft_morning_gentle",
    label: "Soft Morning — Quiet Start",
    terms: ["morning", "waking", "woke", "sunrise", "dawn", "slow", "gentle", "soft", "quiet", "still", "peaceful", "coffee"],
    phrases: ["waking up slowly", "soft morning", "quiet morning", "early morning", "morning coffee", "slow start"],
    structuralBoost: { hasTemporalAnchor: true },
    emotionVector: { energy: 0.2, valence: 0.55, tension: 0.08, nostalgia: 0.15, calm: 0.78 },
    sceneContext: { timeOfDay: "morning", environment: "indoor" },
    aestheticTags: ["acoustic", "folk", "indie", "bedroom pop", "soft pop"],
    narrativeType: "scene_description",
  },

  // ── HEARTBREAK / EMOTIONAL AFTERMATH ─────────────────────────────────────
  {
    id: "heartbreak_aftermath",
    label: "Heartbreak — Emotional Aftermath",
    terms: ["heartbreak", "breakup", "left", "gone", "miss", "broken", "crying", "tears", "alone", "moved on", "over you"],
    phrases: ["still thinking about", "can't get over", "after the breakup", "miss you", "trying to move on", "can't stop thinking"],
    structuralBoost: { isMemory: true },
    emotionVector: { energy: 0.25, valence: 0.15, tension: 0.38, nostalgia: 0.55, calm: 0.2 },
    sceneContext: {},
    aestheticTags: ["indie pop", "sad pop", "singer-songwriter", "alternative", "soul"],
    narrativeType: "emotional_state",
  },

  // ── DEEP FOCUS / FLOW STATE ───────────────────────────────────────────────
  {
    id: "deep_focus_flow",
    label: "Deep Focus — In the Zone",
    terms: ["focus", "work", "study", "code", "write", "create", "concentrated", "locked in", "flow", "zone", "productive"],
    phrases: ["deep focus", "in the zone", "flow state", "locked in", "getting work done", "late night coding", "study session"],
    structuralBoost: {},
    emotionVector: { energy: 0.45, valence: 0.45, tension: 0.22, nostalgia: 0.08, calm: 0.6 },
    sceneContext: { environment: "indoor" },
    aestheticTags: ["lo-fi", "ambient", "electronic", "post-rock", "classical"],
    narrativeType: "activity",
  },

  // ── COASTAL / SUMMER WARMTH ───────────────────────────────────────────────
  {
    id: "coastal_summer_warmth",
    label: "Coastal Summer — Warm Joy",
    terms: ["beach", "ocean", "sea", "summer", "sun", "warm", "waves", "coast", "sand", "bright", "golden", "sunlit"],
    phrases: ["beach day", "golden hour", "summer drive", "sunny afternoon", "ocean breeze", "warm and bright"],
    structuralBoost: {},
    emotionVector: { energy: 0.55, valence: 0.82, tension: 0.08, nostalgia: 0.22, calm: 0.42 },
    sceneContext: { environment: "coastal", timeOfDay: "afternoon" },
    suggestedCanonical: "summer_afternoon_drift",
    aestheticTags: ["indie pop", "surf rock", "alternative", "summer pop", "acoustic"],
    narrativeType: "scene_description",
  },

  // ── URBAN NIGHT GLOW ─────────────────────────────────────────────────────
  {
    id: "urban_night_glow",
    label: "Urban Night — Neon & Glow",
    terms: ["neon", "city", "urban", "streetlight", "glow", "lit", "lights", "skyscraper", "downtown", "alley", "concrete"],
    phrases: ["city at night", "neon lights", "empty streets", "late night city", "city lights", "urban glow"],
    structuralBoost: { hasTemporalAnchor: true },
    emotionVector: { energy: 0.42, valence: 0.4, tension: 0.3, nostalgia: 0.32, calm: 0.32 },
    sceneContext: { environment: "urban", timeOfDay: "late_night" },
    aestheticTags: ["synthwave", "neo-soul", "lo-fi", "R&B", "electronic", "ambient"],
    narrativeType: "scene_description",
  },

  // ── TRAIN / TRANSIT STARING OUT ───────────────────────────────────────────
  {
    id: "transit_window_staring",
    label: "Transit — Staring Out the Window",
    terms: ["train", "bus", "commute", "transit", "platform", "window", "passing", "watching", "outside", "blur"],
    phrases: ["staring out the window", "watching the world go by", "train journey", "commute home", "bus ride"],
    structuralBoost: { hasMotion: true },
    emotionVector: { energy: 0.22, valence: 0.32, tension: 0.15, nostalgia: 0.42, calm: 0.55 },
    sceneContext: { environment: "transit", motionState: "transit" },
    suggestedCanonical: "rainy_train_home_decompress",
    aestheticTags: ["indie", "alternative", "post-rock", "ambient", "folk"],
    narrativeType: "activity",
  },

  // ── ANGER / FRUSTRATION ───────────────────────────────────────────────────
  {
    id: "anger_frustration",
    label: "Anger — Frustration & Release",
    terms: ["angry", "anger", "pissed", "rage", "frustrated", "fed up", "hate", "furious", "mad", "irritated", "done with"],
    phrases: ["so angry", "fucking frustrated", "done with this", "rage driving", "want to scream", "letting go of anger"],
    structuralBoost: {},
    emotionVector: { energy: 0.82, valence: 0.12, tension: 0.75, nostalgia: 0.08, calm: 0.06 },
    sceneContext: {},
    aestheticTags: ["metal", "hard rock", "punk", "rap", "alt-rock"],
    narrativeType: "emotional_state",
  },

  // ── PHILOSOPHICAL / EXISTENTIAL ───────────────────────────────────────────
  {
    id: "philosophical_existential",
    label: "Philosophical — Existential & Questioning",
    terms: ["meaning", "purpose", "why", "life", "existence", "point", "wondering", "questioning", "what is", "who am i", "universe"],
    phrases: ["what's the point", "thinking about life", "questioning everything", "searching for meaning", "what does it all mean"],
    structuralBoost: { isAbstract: true, hasNarrative: true },
    emotionVector: { energy: 0.22, valence: 0.28, tension: 0.38, nostalgia: 0.35, calm: 0.38 },
    sceneContext: {},
    aestheticTags: ["post-rock", "ambient", "art rock", "folk", "progressive", "alternative"],
    narrativeType: "metaphor",
  },

  // ── HOPEFUL / NEW BEGINNING ───────────────────────────────────────────────
  {
    id: "hopeful_new_beginning",
    label: "Hopeful — New Beginning",
    terms: ["hope", "new", "start", "beginning", "fresh", "ahead", "future", "better", "change", "turning", "brighter"],
    phrases: ["new chapter", "fresh start", "new beginning", "looking ahead", "better days", "things are changing", "turning a corner"],
    structuralBoost: {},
    emotionVector: { energy: 0.52, valence: 0.72, tension: 0.15, nostalgia: 0.22, calm: 0.38 },
    sceneContext: { timeOfDay: "morning" },
    aestheticTags: ["indie pop", "folk", "alternative", "uplifting pop", "singer-songwriter"],
    narrativeType: "emotional_state",
  },

  // ── AMBIENT SOLITUDE / BEING ALONE ────────────────────────────────────────
  {
    id: "ambient_solitude",
    label: "Solitude — Alone with Self",
    terms: ["alone", "solitude", "lonely", "by myself", "just me", "isolated", "no one", "quiet", "silence"],
    phrases: ["alone in my room", "just me and", "nobody around", "complete silence", "all by myself", "quiet house"],
    structuralBoost: { isAbstract: true },
    emotionVector: { energy: 0.18, valence: 0.28, tension: 0.22, nostalgia: 0.45, calm: 0.58 },
    sceneContext: { environment: "indoor" },
    aestheticTags: ["ambient", "lo-fi", "bedroom pop", "dream pop", "slowcore"],
    narrativeType: "emotional_state",
  },

  // ── ANTHEMIC / CATHARTIC RELEASE ──────────────────────────────────────────
  {
    id: "anthemic_cathartic",
    label: "Anthemic — Cathartic Release",
    terms: ["cathartic", "release", "let go", "scream", "cry", "anthem", "epic", "powerful", "overwhelming", "builds"],
    phrases: ["need a release", "feel everything", "something that builds", "want to cry", "cathartic playlist", "emotional release"],
    structuralBoost: {},
    emotionVector: { energy: 0.68, valence: 0.35, tension: 0.55, nostalgia: 0.42, calm: 0.18 },
    sceneContext: {},
    aestheticTags: ["post-rock", "alternative", "indie rock", "emo", "shoegaze"],
    narrativeType: "emotional_state",
  },

  // ── PRODUCTIVE / FOCUSED EVENING ─────────────────────────────────────────
  {
    id: "productive_evening",
    label: "Productive Evening — Quiet Grind",
    terms: ["late", "evening", "working", "grinding", "hustle", "productive", "efficient", "tasks", "deadline", "progress"],
    phrases: ["late night work", "evening grind", "night owl", "burning the midnight oil", "working late"],
    structuralBoost: { hasTemporalAnchor: true },
    emotionVector: { energy: 0.42, valence: 0.45, tension: 0.28, nostalgia: 0.12, calm: 0.5 },
    sceneContext: { timeOfDay: "evening", environment: "indoor" },
    aestheticTags: ["lo-fi", "downtempo", "electronic", "jazz hip-hop", "ambient"],
    narrativeType: "activity",
  },

  // ── ROAD TRIP / FREEDOM ───────────────────────────────────────────────────
  {
    id: "road_trip_freedom",
    label: "Road Trip — Freedom & Open Road",
    terms: ["road trip", "miles", "windows down", "cruising", "open highway", "escaping", "leaving", "adventure", "journey"],
    phrases: ["windows down", "open road", "long drive", "road trip vibes", "miles to go", "hitting the road", "long journey"],
    structuralBoost: { hasMotion: true },
    emotionVector: { energy: 0.62, valence: 0.72, tension: 0.1, nostalgia: 0.3, calm: 0.38 },
    sceneContext: { motionState: "driving", environment: "nature" },
    aestheticTags: ["rock", "indie", "alternative", "folk", "americana", "pop"],
    narrativeType: "journey",
  },

  // ── COLD LONELINESS / WINTER BLUES ────────────────────────────────────────
  {
    id: "winter_cold_loneliness",
    label: "Winter — Cold Loneliness",
    terms: ["cold", "winter", "freezing", "frost", "ice", "snow", "bleak", "dark", "grey", "november", "december", "january"],
    phrases: ["cold winter", "bleak winter", "winter blues", "grey november", "cold and dark", "freezing night"],
    structuralBoost: {},
    emotionVector: { energy: 0.18, valence: 0.18, tension: 0.25, nostalgia: 0.5, calm: 0.42 },
    sceneContext: { environment: "winter" },
    aestheticTags: ["ambient", "post-rock", "slowcore", "indie folk", "alternative"],
    narrativeType: "scene_description",
  },

  // ── COZY INDOOR / RAINY COMFORT ───────────────────────────────────────────
  {
    id: "cozy_indoor_comfort",
    label: "Cozy Indoor — Rain & Comfort",
    terms: ["cozy", "comfortable", "warm", "indoors", "blanket", "fireplace", "tea", "coffee", "hygge", "snug"],
    phrases: ["cozy day", "rainy day inside", "staying in", "lazy sunday", "wrapped up", "warm inside"],
    structuralBoost: {},
    emotionVector: { energy: 0.2, valence: 0.62, tension: 0.06, nostalgia: 0.35, calm: 0.75 },
    sceneContext: { environment: "indoor" },
    aestheticTags: ["acoustic", "folk", "indie", "lo-fi", "ambient", "jazz"],
    narrativeType: "scene_description",
  },

  // ── NOSTALGIC THROWBACK / ERA ─────────────────────────────────────────────
  {
    id: "nostalgic_era_throwback",
    label: "Nostalgic Throwback — Era Feeling",
    terms: ["90s", "80s", "2000s", "retro", "throwback", "era", "decade", "vhs", "cassette", "mixtape", "walkman", "cd"],
    phrases: ["feels like the 90s", "throwback to", "80s feeling", "cassette tape vibes", "mixtape era", "grew up listening"],
    structuralBoost: { isMemory: true },
    emotionVector: { energy: 0.4, valence: 0.52, tension: 0.1, nostalgia: 0.92, calm: 0.3 },
    sceneContext: {},
    aestheticTags: ["retro", "throwback", "80s pop", "90s alternative", "2000s indie"],
    narrativeType: "memory",
  },

  // ── SPIRITUAL / TRANSCENDENT ──────────────────────────────────────────────
  {
    id: "spiritual_transcendent",
    label: "Spiritual — Transcendent & Open",
    terms: ["spiritual", "transcendent", "boundless", "infinite", "universe", "sacred", "meditat", "prayer", "peace", "soul"],
    phrases: ["feeling spiritual", "connected to everything", "meditation music", "at peace with", "inner peace"],
    structuralBoost: { isAbstract: true },
    emotionVector: { energy: 0.2, valence: 0.62, tension: 0.08, nostalgia: 0.2, calm: 0.85 },
    sceneContext: {},
    aestheticTags: ["ambient", "classical", "spiritual", "world music", "neo-classical"],
    narrativeType: "emotional_state",
  },
];

// ─── STRUCTURAL ANALYSIS ──────────────────────────────────────────────────────

interface StructuralAnalysis {
  isAbstract: boolean;
  hasContrast: boolean;
  hasMotion: boolean;
  hasTemporalAnchor: boolean;
  hasNarrative: boolean;
  isMemory: boolean;
  timeAnchor: string | null;
  placeAnchor: string | null;
  personState: string | null;
  atmosphericQuality: string | null;
}

const TIME_PATTERNS = [
  { pattern: /\b(1|2|3|4|5)am\b|\b(1|2|3|4|5)\s*am\b/i, anchor: "late_night" },
  { pattern: /\bmidnight\b|\b(late|middle of the)\s+night\b/i, anchor: "late_night" },
  { pattern: /\bevening\b|\bsunset\b|\bdusk\b|\btwi?light\b/i, anchor: "evening" },
  { pattern: /\bmorning\b|\bsunrise\b|\bdawn\b|\bwaking\b/i, anchor: "morning" },
  { pattern: /\bafternoon\b|\bmid-?day\b|\bnoon\b/i, anchor: "afternoon" },
];

const ABSTRACT_SIGNALS = [
  /like\s+(a|the|an)\s+\w+/i,        // "like a movie", "like an old friend"
  /feels?\s+like\b/i,                 // "feels like"
  /kind\s+of\s+(like|as|when)/i,      // "kind of like when"
  /\bmetaphor\b|\bsymbol\b/i,
  /\bin\s+(a|the)\s+\w+\s+(that|who|which)/i, // "in a movie that..."
  /\bif\s+(i|you|we|they)\s+(were|could|was)\b/i,
];

const CONTRAST_PATTERNS = [
  /\bbut\b.{0,30}\b(calm|quiet|still|peace|soft|gentle)\b/i,
  /\bbut\b.{0,30}\b(sad|dark|heavy|intense|hard|loud)\b/i,
  /\b(happy|warm|bright)\b.{0,30}\b(sad|dark|heavy|cold|grey)\b/i,
  /\b(sad|dark|heavy|cold)\b.{0,30}\b(happy|warm|bright|soft)\b/i,
  /\bbittersweet\b|\bmixed feelings\b|\blove.hate\b/i,
  /\bdespite\b|\beven though\b|\balthough\b/i,
];

const MOTION_PATTERNS = /\b(driving|walking|running|moving|riding|cycling|flying|floating|drifting|travelling|wandering|commuting)\b/i;

const NARRATIVE_PATTERNS = /\b(movie|film|story|chapter|scene|credits|after|ended|finished|over|last|beginning|start|journey|path|road)\b/i;

const MEMORY_PATTERNS = /\b(remember|memory|memories|past|back then|used to|childhood|years ago|long ago|when i was|back in|found an old|nostalg)\b/i;

function analyzeStructure(text: string): StructuralAnalysis {
  const lower = text.toLowerCase();

  const isAbstract = ABSTRACT_SIGNALS.some((p) => p.test(text));
  const hasContrast = CONTRAST_PATTERNS.some((p) => p.test(text));
  const hasMotion = MOTION_PATTERNS.test(text);
  const hasNarrative = NARRATIVE_PATTERNS.test(text);
  const isMemory = MEMORY_PATTERNS.test(text);

  let timeAnchor: string | null = null;
  for (const { pattern, anchor } of TIME_PATTERNS) {
    if (pattern.test(text)) { timeAnchor = anchor; break; }
  }
  const hasTemporalAnchor = timeAnchor !== null;

  // Simple place extraction
  let placeAnchor: string | null = null;
  if (/\bdirt road\b|\bcountry road\b|\bback road\b|\bhighway\b|\bmotorway\b/i.test(text)) placeAnchor = "road";
  else if (/\bcity\b|\burban\b|\bstreets?\b|\bdowntown\b/i.test(text)) placeAnchor = "city";
  else if (/\bbeach\b|\bocean\b|\bsea\b|\bcoast\b/i.test(text)) placeAnchor = "coastal";
  else if (/\bforest\b|\bwoods\b|\bnature\b|\bmountain\b/i.test(text)) placeAnchor = "nature";
  else if (/\bhome\b|\bbedroom\b|\broom\b|\bhouse\b/i.test(text)) placeAnchor = "indoor";

  // Person state
  let personState: string | null = null;
  if (/\bthinking\b|\breflecting\b|\bwondering\b|\bprocessing\b/i.test(text)) personState = "introspective";
  else if (/\bdriving\b|\bwalking\b|\brunning\b/i.test(text)) personState = "moving";
  else if (/\bworking\b|\bstudying\b|\bcoding\b/i.test(text)) personState = "working";
  else if (/\bpartying\b|\bdancing\b|\bcelebrat\b/i.test(text)) personState = "celebrating";

  // Atmospheric quality
  let atmosphericQuality: string | null = null;
  if (/\bfoggy\b|\bhazy\b|\bmisty\b|\bblurry\b/i.test(text)) atmosphericQuality = "hazy";
  else if (/\bcrisp\b|\bclear\b|\bsharp\b|\bbright\b/i.test(text)) atmosphericQuality = "clear";
  else if (/\bdark\b|\bshadow\b|\bgloomy\b/i.test(text)) atmosphericQuality = "dark";
  else if (/\bwarm\b|\bgolden\b|\bsunlit\b/i.test(text)) atmosphericQuality = "warm";

  return { isAbstract, hasContrast, hasMotion, hasTemporalAnchor, hasNarrative, isMemory, timeAnchor, placeAnchor, personState, atmosphericQuality };
}

// ─── ANCHOR SCORING ───────────────────────────────────────────────────────────

function scoreAnchor(anchor: SemanticAnchor, text: string, structural: StructuralAnalysis): number {
  const lower = text.toLowerCase();
  let score = 0;

  // Term matches (word level)
  const termHits = anchor.terms.filter((t) => lower.includes(t)).length;
  score += termHits * 0.12;

  // Phrase matches (phrase level — scored higher)
  const phraseHits = anchor.phrases.filter((p) => lower.includes(p)).length;
  score += phraseHits * 0.28;

  // Structural boosts
  if (anchor.structuralBoost) {
    if (anchor.structuralBoost.isAbstract && structural.isAbstract) score += 0.15;
    if (anchor.structuralBoost.hasContrast && structural.hasContrast) score += 0.18;
    if (anchor.structuralBoost.hasMotion && structural.hasMotion) score += 0.12;
    if (anchor.structuralBoost.hasTemporalAnchor && structural.hasTemporalAnchor) score += 0.12;
    if (anchor.structuralBoost.hasNarrative && structural.hasNarrative) score += 0.12;
    if (anchor.structuralBoost.isMemory && structural.isMemory) score += 0.15;
  }

  // Context alignment bonuses
  if (anchor.sceneContext.timeOfDay && structural.timeAnchor === anchor.sceneContext.timeOfDay) score += 0.1;
  if (anchor.sceneContext.environment === "nature" && structural.placeAnchor === "road") score += 0.08;
  if (anchor.sceneContext.motionState === "driving" && structural.personState === "moving") score += 0.08;
  if (anchor.narrativeType === "metaphor" && structural.isAbstract) score += 0.1;
  if (anchor.narrativeType === "memory" && structural.isMemory) score += 0.1;

  return Math.min(score, 1.0);
}

// ─── MAIN INTERPRETER ─────────────────────────────────────────────────────────

export function interpretSemantics(vibe: string): SemanticInterpretation {
  const structural = analyzeStructure(vibe);

  // Score all anchors
  const scored = SEMANTIC_ANCHORS.map((anchor) => ({
    anchor,
    score: scoreAnchor(anchor, vibe, structural),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  const confidence = Math.min(best.score, 0.95);
  const hasWeakMatch = confidence < 0.2;

  // Build emotion delta from top-2 anchors (blended)
  const blend = hasWeakMatch ? 1.0 : Math.max(0, 1 - (second?.score ?? 0) / (best.score + 0.001));
  const secondWeight = hasWeakMatch ? 0 : (1 - blend) * 0.4;

  function blendVec(primary: SemanticAnchor["emotionVector"], secondary?: SemanticAnchor["emotionVector"]) {
    if (!secondary || hasWeakMatch) return primary;
    return {
      energy: primary.energy * blend + secondary.energy * secondWeight,
      valence: primary.valence * blend + secondary.valence * secondWeight,
      tension: primary.tension * blend + secondary.tension * secondWeight,
      nostalgia: primary.nostalgia * blend + secondary.nostalgia * secondWeight,
      calm: primary.calm * blend + secondary.calm * secondWeight,
    };
  }

  const blendedVec = blendVec(best.anchor.emotionVector, second?.anchor.emotionVector);

  const emotionDelta: Partial<EmotionProfile> = {
    energy: blendedVec.energy,
    valence: blendedVec.valence,
    tension: blendedVec.tension,
    nostalgia: blendedVec.nostalgia,
    calm: blendedVec.calm,
  };

  // Scene context — prefer best anchor's context
  const sceneContext: SemanticInterpretation["sceneContext"] = {};
  if (best.anchor.sceneContext.environment) sceneContext.environment = best.anchor.sceneContext.environment;
  if (best.anchor.sceneContext.timeOfDay) sceneContext.timeOfDay = best.anchor.sceneContext.timeOfDay;
  if (best.anchor.sceneContext.motionState) sceneContext.motionState = best.anchor.sceneContext.motionState;

  // Fill from structural if not found in anchor
  if (!sceneContext.timeOfDay && structural.timeAnchor) sceneContext.timeOfDay = structural.timeAnchor;
  if (!sceneContext.environment && structural.placeAnchor && structural.placeAnchor !== "road") {
    sceneContext.environment = structural.placeAnchor;
  }
  if (!sceneContext.motionState && structural.hasMotion) {
    sceneContext.motionState = structural.personState === "moving" ? "driving" : "active";
  }

  // Aesthetic tags — merge from top-2
  const aestheticTags = [
    ...best.anchor.aestheticTags,
    ...(second && second.score > 0.15 ? second.anchor.aestheticTags.slice(0, 2) : []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  // Summary generation
  const summary = generateSummary(best.anchor, structural, confidence);

  return {
    confidence,
    primaryCluster: best.anchor.label,
    secondaryCluster: second && second.score > 0.1 ? second.anchor.label : null,
    emotionDelta,
    sceneContext,
    suggestedCanonical: best.anchor.suggestedCanonical ?? null,
    aestheticTags,
    isAbstract: structural.isAbstract,
    hasContrast: structural.hasContrast,
    narrativeType: best.anchor.narrativeType,
    summary,
  };
}

function generateSummary(anchor: SemanticAnchor, structural: StructuralAnalysis, confidence: number): string {
  const parts: string[] = [`[${anchor.label}]`];
  if (structural.timeAnchor) parts.push(structural.timeAnchor.replace("_", " "));
  if (structural.placeAnchor) parts.push(structural.placeAnchor);
  if (structural.hasContrast) parts.push("with contrast");
  if (structural.isAbstract) parts.push("abstract/metaphorical");
  if (structural.isMemory) parts.push("memory-tinged");
  parts.push(`confidence: ${(confidence * 100).toFixed(0)}%`);
  return parts.join(" · ");
}
