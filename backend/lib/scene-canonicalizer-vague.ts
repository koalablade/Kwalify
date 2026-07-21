/**
 * Aliases for short / vague benchmark-style prompts → everyday canonical scenes.
 */

interface VagueCanonicalEntry {
  id: string;
  prototypeId: string;
  emotionalTone: string;
  aliases: string[];
}

export const VAGUE_CANONICAL_SCENES: VagueCanonicalEntry[] = [
  {
    id: "winter_evening_cozy",
    prototypeId: "DOMESTIC_ROUTINE",
    emotionalTone: "cozy",
    aliases: [
      "chill evening",
      "chill night in",
      "relaxing evening at home",
      "wind down evening",
      "cozy evening",
      "evening chill",
    ],
  },
  {
    id: "late_night_overthinking",
    prototypeId: "OVERTHINK_LATE",
    emotionalTone: "rumination",
    aliases: ["late night vibes", "can't sleep vibes", "3am vibes"],
  },
  {
    id: "gym_session",
    prototypeId: "GYM_FOCUS",
    emotionalTone: "drive",
    aliases: ["gym motivation", "workout playlist", "gym pump", "training motivation"],
  },
  {
    id: "study_focus",
    prototypeId: "STUDY_FOCUS",
    emotionalTone: "concentration",
    aliases: ["focus deep work", "deep focus", "focus mode", "concentration playlist", "work focus"],
  },
  {
    id: "breakup_walk",
    prototypeId: "BREAKUP_WALK",
    emotionalTone: "processing",
    aliases: ["breakup sadness", "sad breakup", "heartbreak playlist", "breakup feels"],
  },
  {
    id: "getting_ready_out",
    prototypeId: "PRE_OUT_ENERGY",
    emotionalTone: "anticipation",
    aliases: ["getting ready to go out", "going out tonight", "night out vibes", "pregame vibes"],
  },
  {
    id: "spring_cleaning",
    prototypeId: "DOMESTIC_ROUTINE",
    emotionalTone: "fresh_start",
    aliases: ["sunday reset cleaning", "sunday reset", "cleaning playlist", "reset day"],
  },
  {
    id: "road_trip_alone",
    prototypeId: "ROAD_TRIP_ALONE",
    emotionalTone: "open_road",
    aliases: ["road trip drive", "road trip playlist", "driving playlist", "highway vibes"],
  },
  {
    id: "summer_afternoon_drift",
    prototypeId: "SUN_DAY_DRIVE",
    emotionalTone: "warmth",
    aliases: ["happy summer energy", "summer vibes", "summer energy", "sunny day playlist"],
  },
  {
    id: "anxious_to_calm",
    prototypeId: "OVERTHINK_LATE",
    emotionalTone: "regulation",
    aliases: ["anxious stress relief", "stress relief playlist", "calm my anxiety", "anxiety relief"],
  },
  {
    id: "memory_road_nostalgia",
    prototypeId: "ARCHAEOLOGY_MEMORY",
    emotionalTone: "nostalgic_warmth",
    aliases: ["nostalgic memories", "nostalgia playlist", "nostalgic vibes", "memory lane"],
  },
  {
    id: "bath_self_care",
    prototypeId: "HANGOVER_RECOVERY",
    emotionalTone: "self_care",
    aliases: [
      "emotional calm wind-down",
      "calm wind down",
      "wind down calm",
      "gentle wind down",
    ],
  },
  {
    id: "rainy_day_inside",
    prototypeId: "DOMESTIC_ROUTINE",
    emotionalTone: "cozy",
    aliases: ["rainy chill", "cozy rainy day", "rainy day chill"],
  },
  {
    id: "work_from_home",
    prototypeId: "STUDY_FOCUS",
    emotionalTone: "focus",
    aliases: ["wfh playlist", "work from home focus", "home office playlist"],
  },
  {
    id: "cooking_dinner_friends",
    prototypeId: "DOMESTIC_ROUTINE",
    emotionalTone: "social",
    aliases: [
      "cooking dinner",
      "cooking dinner with friends",
      "dinner with friends",
      "kitchen playlist",
      "kitchen dance party",
      "friday night kitchen",
    ],
  },
  {
    id: "happy_vibes_only",
    prototypeId: "SUN_DAY_DRIVE",
    emotionalTone: "warmth",
    aliases: [
      "happy vibes",
      "happy vibes only",
      "feel good playlist",
      "make me feel something",
      "idk just make me feel something",
      "songs that feel like summer",
      "got a promotion",
    ],
  },
  {
    id: "sofa_wind_down",
    prototypeId: "DOMESTIC_ROUTINE",
    emotionalTone: "cozy",
    aliases: [
      "cozy evening on the sofa",
      "late night winding down",
      "warm after-work unwind",
      "sunday morning chill",
      "something chill for sunday morning",
    ],
  },
  {
    id: "gym_need_energy",
    prototypeId: "GYM_FOCUS",
    emotionalTone: "drive",
    aliases: [
      "need energy for the gym",
      "energy for the gym",
      "gym energy",
      "workout energy",
    ],
  },
  {
    id: "coffee_laptop",
    prototypeId: "STUDY_FOCUS",
    emotionalTone: "focus",
    aliases: [
      "coffee shop laptop",
      "coffee shop laptop session",
      "exam week survival",
      "studying but my brain is fried",
      "writing essays at midnight",
    ],
  },
];
