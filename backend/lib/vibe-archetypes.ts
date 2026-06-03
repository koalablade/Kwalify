/**
 * Reusable emotional "moments" — matched from user vibe text and blended into EmotionProfile.
 */

import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";

export interface VibeArchetype {
  id: string;
  label: string;
  /** Substrings that trigger this archetype (longer phrases first when matching). */
  terms: string[];
  defaultVibe: string;
  journeyArc: JourneyArc;
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
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export const VIBE_ARCHETYPES: VibeArchetype[] = [
  {
    id: "late_night_drive",
    label: "Late Night Drive",
    terms: ["late night drive", "driving home late", "night drive alone", "empty road at night"],
    defaultVibe: "late night drive alone on the motorway reflective",
    journeyArc: "slow_burn",
    weights: { energy: -0.1, valence: -0.05, tension: 0.12, nostalgia: 0.35, calm: 0.15 },
    sceneHints: { timeOfDay: "late_night", motionState: "driving", environment: "urban" },
  },
  {
    id: "driving_home_drained",
    label: "Driving Home Drained",
    terms: ["driving home at 11", "driving home at 11pm", "mentally drained commute", "drive home exhausted"],
    defaultVibe: "driving home at 11pm mentally drained want comfort",
    journeyArc: "recovery",
    weights: { energy: -0.2, valence: -0.1, tension: 0.1, nostalgia: 0.25, calm: 0.2 },
    sceneHints: { motionState: "driving", timeOfDay: "late_night" },
  },
  {
    id: "main_character",
    label: "Main Character Moment",
    terms: ["main character", "main character energy", "protagonist moment", "cinematic confidence"],
    defaultVibe: "main character energy confident cinematic momentum",
    journeyArc: "linear_rise",
    weights: { energy: 0.25, valence: 0.3, tension: 0.05, nostalgia: 0.05, calm: -0.1 },
  },
  {
    id: "summer_sunset",
    label: "Summer Sunset",
    terms: ["summer sunset", "golden hour summer", "warm sunset nostalgic"],
    defaultVibe: "summer sunset golden hour warm nostalgic uplifting",
    journeyArc: "peak_release",
    weights: { energy: 0.05, valence: 0.3, tension: -0.1, nostalgia: 0.35, calm: 0.1 },
    sceneHints: { timeOfDay: "evening", environment: "coastal" },
  },
  {
    id: "healing",
    label: "Healing",
    terms: ["healing playlist", "healing vibes", "emotional healing", "gentle healing"],
    defaultVibe: "healing comforting gentle low tension",
    journeyArc: "recovery",
    weights: { energy: -0.15, valence: 0.15, tension: -0.25, nostalgia: 0.2, calm: 0.35 },
  },
  {
    id: "heartbreak_recovery",
    label: "Heartbreak Recovery",
    terms: ["heartbreak recovery", "getting over someone", "moving on from heartbreak"],
    defaultVibe: "heartbreak but want to feel hopeful gradually",
    journeyArc: "recovery",
    weights: { energy: -0.05, valence: -0.1, tension: 0.15, nostalgia: 0.35, calm: 0.15 },
  },
  {
    id: "locked_in",
    label: "Locked In",
    terms: ["locked in", "deep focus", "in the zone", "flow state coding"],
    defaultVibe: "locked in coding focus no distractions forward momentum",
    journeyArc: "linear_rise",
    weights: { energy: 0.15, valence: 0.05, tension: 0.05, nostalgia: -0.05, calm: 0.25 },
  },
  {
    id: "petrol_station_2am",
    label: "Petrol Station 2AM",
    terms: ["petrol station at 2am", "gas station at 2am", "service station fluorescent"],
    defaultVibe: "petrol station at 2am fluorescent lonely",
    journeyArc: "slow_burn",
    weights: { energy: 0.05, valence: -0.2, tension: 0.28, nostalgia: 0.42, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
  },
  {
    id: "rainy_cafe",
    label: "Rainy Café",
    terms: ["rainy coffee shop", "coffee shop rainy", "cafe in the rain"],
    defaultVibe: "coffee shop rainy afternoon calm reflective",
    journeyArc: "slow_burn",
    weights: { energy: -0.1, valence: 0.05, tension: -0.05, nostalgia: 0.25, calm: 0.3 },
    sceneHints: { environment: "rainy", timeOfDay: "afternoon" },
  },
  {
    id: "gym_rage",
    label: "Gym Rage",
    terms: ["gym rage", "villain arc gym", "training session rage"],
    defaultVibe: "gym rage villain arc training session",
    journeyArc: "peak_release",
    weights: { energy: 0.45, valence: 0.1, tension: 0.35, nostalgia: 0.0, calm: -0.35 },
  },
  {
    id: "morning_reset",
    label: "Morning Reset",
    terms: ["morning reset", "fresh start morning", "wake up hopeful"],
    defaultVibe: "morning reset fresh start optimistic",
    journeyArc: "linear_rise",
    weights: { energy: 0.15, valence: 0.3, tension: -0.15, nostalgia: 0.05, calm: 0.1 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    id: "sunday_slow",
    label: "Sunday Slow",
    terms: ["sunday slow", "lazy sunday", "sunday afternoon soft"],
    defaultVibe: "sunday afternoon slow soft calm",
    journeyArc: "flat",
    weights: { energy: -0.2, valence: 0.15, tension: -0.2, nostalgia: 0.25, calm: 0.35 },
    sceneHints: { timeOfDay: "afternoon" },
  },
  {
    id: "date_night",
    label: "Date Night",
    terms: ["date night", "romantic evening", "dinner date vibes"],
    defaultVibe: "date night romantic warm intimate",
    journeyArc: "wave",
    weights: { energy: 0.05, valence: 0.3, tension: 0.08, nostalgia: 0.15, calm: 0.15 },
    sceneHints: { timeOfDay: "evening", environment: "social_indoor" },
  },
  {
    id: "party_friends",
    label: "Party With Friends",
    terms: ["party with friends", "house party", "pregame vibes", "night out friends"],
    defaultVibe: "party with friends celebrating night out",
    journeyArc: "peak_release",
    weights: { energy: 0.4, valence: 0.4, tension: 0.1, nostalgia: 0.05, calm: -0.25 },
    sceneHints: { timeOfDay: "night", environment: "social_indoor" },
  },
  {
    id: "alone_lonely",
    label: "Alone & Lonely",
    terms: ["feeling lonely", "alone tonight", "lonely night"],
    defaultVibe: "alone tonight lonely reflective",
    journeyArc: "slow_burn",
    weights: { energy: -0.2, valence: -0.25, tension: 0.2, nostalgia: 0.3, calm: 0.1 },
  },
  {
    id: "missing_someone",
    label: "Missing Someone",
    terms: ["missing someone", "miss you vibes", "long distance missing"],
    defaultVibe: "missing someone nostalgic bittersweet",
    journeyArc: "recovery",
    weights: { energy: -0.15, valence: -0.15, tension: 0.15, nostalgia: 0.45, calm: 0.15 },
  },
  {
    id: "anxiety_calm",
    label: "Anxiety → Calm",
    terms: ["anxious but want calm", "anxiety to calm", "panic to peaceful"],
    defaultVibe: "anxious but want to feel calm",
    journeyArc: "recovery",
    weights: { energy: -0.05, valence: 0.0, tension: -0.15, calm: 0.35 },
  },
  {
    id: "burnt_out_motivation",
    label: "Burnt Out → Motivated",
    terms: ["burnt out need motivation", "exhausted but need energy", "tired want hype"],
    defaultVibe: "burnt out need motivation",
    journeyArc: "linear_rise",
    weights: { energy: 0.2, valence: 0.15, tension: 0.0, calm: -0.1 },
  },
  {
    id: "study_focus",
    label: "Study Focus",
    terms: ["study session", "exam focus", "library studying", "revision grind"],
    defaultVibe: "deep focus study session no distractions",
    journeyArc: "flat",
    weights: { energy: 0.0, valence: 0.05, tension: 0.05, nostalgia: 0.0, calm: 0.35 },
  },
  {
    id: "coding_flow",
    label: "Coding Flow",
    terms: ["coding session", "programming flow", "debugging at night", "developer focus"],
    defaultVibe: "coding at night focused flow minimal distraction",
    journeyArc: "linear_rise",
    weights: { energy: 0.1, valence: 0.05, tension: 0.05, nostalgia: 0.05, calm: 0.25 },
    sceneHints: { timeOfDay: "late_night", environment: "indoor" },
  },
  {
    id: "reading_rain",
    label: "Reading in the Rain",
    terms: ["reading in the rain", "book and rain", "rainy day reading"],
    defaultVibe: "reading on a rainy day calm indoor",
    journeyArc: "slow_burn",
    weights: { energy: -0.2, valence: 0.1, tension: -0.15, nostalgia: 0.3, calm: 0.35 },
    sceneHints: { environment: "rainy", timeOfDay: "afternoon" },
  },
  {
    id: "beach_summer",
    label: "Beach Summer",
    terms: ["beach day", "summer beach", "ocean sunny afternoon"],
    defaultVibe: "beach summer sunny afternoon carefree",
    journeyArc: "wave",
    weights: { energy: 0.2, valence: 0.4, tension: -0.15, nostalgia: 0.15, calm: 0.1 },
    sceneHints: { environment: "coastal", timeOfDay: "afternoon" },
  },
  {
    id: "forest_walk",
    label: "Forest Walk",
    terms: ["forest walk", "woods peaceful", "nature hike calm"],
    defaultVibe: "forest walk peaceful nature calm",
    journeyArc: "slow_burn",
    weights: { energy: 0.0, valence: 0.2, tension: -0.2, nostalgia: 0.2, calm: 0.35 },
    sceneHints: { environment: "nature", motionState: "walking" },
  },
  {
    id: "city_night",
    label: "City Night",
    terms: ["city at night", "urban night lights", "downtown midnight"],
    defaultVibe: "city at night urban lights reflective",
    journeyArc: "wave",
    weights: { energy: 0.1, valence: 0.0, tension: 0.15, nostalgia: 0.25, calm: 0.05 },
    sceneHints: { environment: "urban", timeOfDay: "late_night" },
  },
  {
    id: "train_travel",
    label: "Train Travel",
    terms: ["train journey", "on the train", "rail travel window"],
    defaultVibe: "train journey window gaze reflective transit",
    journeyArc: "wave",
    weights: { energy: -0.05, valence: 0.0, tension: 0.05, nostalgia: 0.35, calm: 0.2 },
    sceneHints: { motionState: "transit", environment: "transit" },
  },
  {
    id: "plane_window",
    label: "Plane Window",
    terms: ["plane window", "flying somewhere", "airport travel calm"],
    defaultVibe: "plane window travel dreamy distance",
    journeyArc: "slow_burn",
    weights: { energy: -0.1, valence: 0.05, tension: 0.0, nostalgia: 0.3, calm: 0.25 },
    sceneHints: { motionState: "transit" },
  },
  {
    id: "snowy_cozy",
    label: "Snowy Cozy",
    terms: ["snowy cozy", "winter cozy indoor", "snow day warm"],
    defaultVibe: "snowy day cozy warm indoor calm",
    journeyArc: "flat",
    weights: { energy: -0.15, valence: 0.2, tension: -0.15, nostalgia: 0.3, calm: 0.35 },
    sceneHints: { environment: "winter" },
  },
  {
    id: "spring_fresh",
    label: "Spring Fresh",
    terms: ["spring morning", "fresh spring air", "blooming spring"],
    defaultVibe: "spring morning fresh hopeful light",
    journeyArc: "linear_rise",
    weights: { energy: 0.1, valence: 0.35, tension: -0.15, nostalgia: 0.1, calm: 0.15 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    id: "autumn_nostalgia",
    label: "Autumn Nostalgia",
    terms: ["autumn leaves", "fall nostalgia", "october mood"],
    defaultVibe: "autumn nostalgic warm melancholy",
    journeyArc: "slow_burn",
    weights: { energy: -0.05, valence: 0.05, tension: 0.05, nostalgia: 0.45, calm: 0.2 },
  },
  {
    id: "thunderstorm",
    label: "Thunderstorm",
    terms: ["thunderstorm", "storm outside", "lightning rain intense"],
    defaultVibe: "thunderstorm outside dramatic rain",
    journeyArc: "peak_release",
    weights: { energy: 0.15, valence: -0.05, tension: 0.35, nostalgia: 0.15, calm: -0.1 },
    sceneHints: { environment: "rainy" },
  },
  {
    id: "fog_mystery",
    label: "Fog & Mystery",
    terms: ["foggy morning", "misty mysterious", "fog atmosphere"],
    defaultVibe: "foggy mysterious atmospheric slow",
    journeyArc: "slow_burn",
    weights: { energy: -0.1, valence: -0.05, tension: 0.2, nostalgia: 0.25, calm: 0.2 },
  },
  {
    id: "cleaning_reset",
    label: "Cleaning Reset",
    terms: ["cleaning playlist", "tidy up energy", "house reset"],
    defaultVibe: "cleaning the house upbeat reset",
    journeyArc: "linear_rise",
    weights: { energy: 0.25, valence: 0.25, tension: -0.05, nostalgia: 0.05, calm: 0.0 },
  },
  {
    id: "cooking_kitchen",
    label: "Cooking Vibes",
    terms: ["cooking at home", "kitchen vibes", "making dinner"],
    defaultVibe: "cooking at home warm relaxed",
    journeyArc: "wave",
    weights: { energy: 0.05, valence: 0.25, tension: -0.1, nostalgia: 0.15, calm: 0.2 },
    sceneHints: { environment: "indoor" },
  },
  {
    id: "gaming_session",
    label: "Gaming Session",
    terms: ["gaming session", "late night gaming", "online gaming hype"],
    defaultVibe: "gaming session focused hype",
    journeyArc: "peak_release",
    weights: { energy: 0.3, valence: 0.2, tension: 0.15, nostalgia: 0.1, calm: -0.15 },
  },
  {
    id: "falling_asleep",
    label: "Falling Asleep",
    terms: ["falling asleep", "sleep playlist", "drift off"],
    defaultVibe: "falling asleep soft drowsy calm",
    journeyArc: "linear_fall",
    weights: { energy: -0.35, valence: 0.05, tension: -0.25, nostalgia: 0.1, calm: 0.45 },
  },
  {
    id: "waking_up",
    label: "Waking Up",
    terms: ["waking up", "alarm morning gentle", "rise and shine"],
    defaultVibe: "waking up gentle morning rise",
    journeyArc: "linear_rise",
    weights: { energy: 0.1, valence: 0.2, tension: -0.1, nostalgia: 0.05, calm: 0.2 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    id: "running_outdoor",
    label: "Outdoor Run",
    terms: ["outdoor run", "running playlist", "jogging energy"],
    defaultVibe: "outdoor run energetic forward",
    journeyArc: "linear_rise",
    weights: { energy: 0.4, valence: 0.25, tension: 0.05, nostalgia: 0.0, calm: -0.2 },
    sceneHints: { motionState: "running" },
  },
  {
    id: "walking_clear_head",
    label: "Walk to Clear Head",
    terms: ["walk to clear my head", "clearing my head walk", "walking thinking"],
    defaultVibe: "walking to clear my head reflective",
    journeyArc: "recovery",
    weights: { energy: 0.05, valence: 0.05, tension: -0.1, nostalgia: 0.2, calm: 0.25 },
    sceneHints: { motionState: "walking" },
  },
  {
    id: "office_grind",
    label: "Office Grind",
    terms: ["office grind", "work day focus", "9 to 5 focus"],
    defaultVibe: "office work focus productive steady",
    journeyArc: "flat",
    weights: { energy: 0.1, valence: 0.05, tension: 0.08, nostalgia: 0.0, calm: 0.2 },
    sceneHints: { environment: "urban" },
  },
  {
    id: "creative_burst",
    label: "Creative Burst",
    terms: ["creative burst", "making art", "painting vibes", "writing inspiration"],
    defaultVibe: "creative burst inspired dreamy",
    journeyArc: "wave",
    weights: { energy: 0.15, valence: 0.25, tension: 0.05, nostalgia: 0.15, calm: 0.1 },
  },
  {
    id: "overstimulated_cooldown",
    label: "Overstimulated Cooldown",
    terms: ["overstimulated", "too much noise", "sensory overload calm down"],
    defaultVibe: "overstimulated need calm down",
    journeyArc: "linear_fall",
    weights: { energy: -0.25, valence: -0.1, tension: -0.2, calm: 0.4 },
  },
  {
    id: "social_recovery",
    label: "Social Recovery",
    terms: ["social recovery", "after the party", "introvert recharge"],
    defaultVibe: "social recovery quiet recharge alone",
    journeyArc: "linear_fall",
    weights: { energy: -0.2, valence: 0.05, tension: -0.15, nostalgia: 0.1, calm: 0.35 },
  },
  {
    id: "family_gathering",
    label: "Family Gathering",
    terms: ["family gathering", "christmas family", "holiday dinner warm"],
    defaultVibe: "family gathering warm nostalgic cozy",
    journeyArc: "wave",
    weights: { energy: 0.05, valence: 0.3, tension: -0.05, nostalgia: 0.4, calm: 0.15 },
  },
  {
    id: "celebration",
    label: "Celebration",
    terms: ["celebration", "something to celebrate", "victory lap"],
    defaultVibe: "celebration victorious joyful",
    journeyArc: "peak_release",
    weights: { energy: 0.35, valence: 0.45, tension: 0.05, nostalgia: 0.1, calm: -0.15 },
  },
  {
    id: "grief_processing",
    label: "Grief Processing",
    terms: ["processing grief", "mourning", "loss of someone"],
    defaultVibe: "processing grief gentle reflective",
    journeyArc: "slow_burn",
    weights: { energy: -0.2, valence: -0.3, tension: 0.2, nostalgia: 0.4, calm: 0.2 },
  },
  {
    id: "anger_release",
    label: "Anger Release",
    terms: ["angry release", "rage outlet", "frustrated scream"],
    defaultVibe: "angry frustrated need release",
    journeyArc: "peak_release",
    weights: { energy: 0.4, valence: -0.25, tension: 0.45, calm: -0.3 },
  },
  {
    id: "euphoria",
    label: "Euphoria",
    terms: ["euphoric", "pure joy", "on top of the world"],
    defaultVibe: "euphoric pure joy on top of the world",
    journeyArc: "peak_release",
    weights: { energy: 0.45, valence: 0.5, tension: 0.05, nostalgia: 0.05, calm: -0.2 },
  },
  {
    id: "bittersweet",
    label: "Bittersweet",
    terms: ["bittersweet", "happy sad mix", "smile through sadness"],
    defaultVibe: "bittersweet nostalgic mixed feelings",
    journeyArc: "wave",
    weights: { energy: -0.05, valence: 0.0, tension: 0.15, nostalgia: 0.4, calm: 0.1 },
  },
  {
    id: "warehouse_rave",
    label: "Warehouse Rave",
    terms: ["warehouse rave", "underground rave", "techno warehouse"],
    defaultVibe: "warehouse rave underground techno pulse",
    journeyArc: "peak_release",
    weights: { energy: 0.5, valence: 0.15, tension: 0.25, nostalgia: 0.1, calm: -0.35 },
  },
  {
    id: "yacht_soft",
    label: "Yacht Rock Soft",
    terms: ["yacht rock", "soft 70s rock", "smooth fm vibes"],
    defaultVibe: "yacht rock soft smooth nostalgic",
    journeyArc: "wave",
    weights: { energy: -0.05, valence: 0.25, tension: -0.1, nostalgia: 0.4, calm: 0.2 },
  },
  {
    id: "groovy_sixties",
    label: "Groovy Sixties",
    terms: ["groovy sixties", "60s groovy", "sixties funk soul"],
    defaultVibe: "60s groovy funk soul motown",
    journeyArc: "wave",
    weights: { energy: 0.2, valence: 0.3, tension: -0.05, nostalgia: 0.55, calm: -0.05 },
  },
  {
    id: "feel_like_sun",
    label: "Feel Like Sun",
    terms: ["feel like sun", "songs that feel like sun", "sun drenched"],
    defaultVibe: "songs that feel like sun warm bright",
    journeyArc: "linear_rise",
    weights: { energy: 0.25, valence: 0.45, tension: -0.15, nostalgia: 0.1, calm: -0.1 },
    sceneHints: { timeOfDay: "afternoon", environment: "coastal" },
  },
  {
    id: "villain_arc",
    label: "Villain Arc",
    terms: ["villain arc", "dark confidence", "unstoppable energy"],
    defaultVibe: "villain arc dark confidence unstoppable",
    journeyArc: "linear_rise",
    weights: { energy: 0.35, valence: -0.05, tension: 0.3, nostalgia: 0.05, calm: -0.2 },
  },
  {
    id: "soft_romance",
    label: "Soft Romance",
    terms: ["soft romance", "tender love", "slow dance bedroom"],
    defaultVibe: "soft romance tender intimate slow",
    journeyArc: "slow_burn",
    weights: { energy: -0.1, valence: 0.3, tension: -0.1, nostalgia: 0.2, calm: 0.25 },
  },
  {
    id: "festival_field",
    label: "Festival Field",
    terms: ["festival field", "outdoor festival", "summer festival crowd"],
    defaultVibe: "outdoor festival summer crowd euphoric",
    journeyArc: "peak_release",
    weights: { energy: 0.4, valence: 0.4, tension: 0.1, nostalgia: 0.15, calm: -0.2 },
  },
  {
    id: "rainy_window",
    label: "Rainy Window",
    terms: ["rain on window", "rainy window", "watching rain inside"],
    defaultVibe: "watching rain on window calm reflective",
    journeyArc: "slow_burn",
    weights: { energy: -0.15, valence: 0.0, tension: 0.05, nostalgia: 0.35, calm: 0.3 },
    sceneHints: { environment: "rainy" },
  },
  {
    id: "pre_game",
    label: "Pre-Game",
    terms: ["pre game", "pregame", "getting ready to go out"],
    defaultVibe: "pregame getting ready hype building",
    journeyArc: "linear_rise",
    weights: { energy: 0.3, valence: 0.3, tension: 0.1, calm: -0.15 },
  },
  {
    id: "post_breakup",
    label: "Post Breakup",
    terms: ["post breakup", "just broke up", "breakup sadness"],
    defaultVibe: "just broke up sad but want hope",
    journeyArc: "recovery",
    weights: { energy: -0.1, valence: -0.2, tension: 0.2, nostalgia: 0.35, calm: 0.1 },
  },
];

/** Longest matching archetype term wins. */
export function matchArchetype(vibe: string): VibeArchetype | null {
  const text = vibe.toLowerCase();
  let best: { archetype: VibeArchetype; termLen: number } | null = null;

  for (const archetype of VIBE_ARCHETYPES) {
    for (const term of archetype.terms) {
      if (text.includes(term) && (!best || term.length > best.termLen)) {
        best = { archetype, termLen: term.length };
      }
    }
  }

  return best?.archetype ?? null;
}

/** Blend archetype weights into an analyzed profile (additive, capped). */
export function applyArchetypeNudge(
  vibe: string,
  profile: EmotionProfile,
  strength = 0.38
): EmotionProfile {
  const archetype = matchArchetype(vibe);
  if (!archetype) return profile;

  const p = { ...profile };
  const w = archetype.weights;
  const s = strength;

  if (w.energy !== undefined) p.energy = clamp(p.energy + w.energy * s);
  if (w.valence !== undefined) p.valence = clamp(p.valence + w.valence * s);
  if (w.tension !== undefined) p.tension = clamp(p.tension + w.tension * s);
  if (w.nostalgia !== undefined) p.nostalgia = clamp(p.nostalgia + w.nostalgia * s);
  if (w.calm !== undefined) p.calm = clamp(p.calm + w.calm * s);

  if (archetype.sceneHints) {
    if (archetype.sceneHints.environment && !p.environment) {
      p.environment = archetype.sceneHints.environment;
    }
    if (archetype.sceneHints.timeOfDay && !p.timeOfDay) {
      p.timeOfDay = archetype.sceneHints.timeOfDay;
    }
    if (archetype.sceneHints.motionState && !p.motionState) {
      p.motionState = archetype.sceneHints.motionState;
    }
  }

  return p;
}

export function getArchetypeJourneyArc(vibe: string): JourneyArc | null {
  return matchArchetype(vibe)?.journeyArc ?? null;
}
