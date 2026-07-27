/**
 * 2000 natural human evaluation prompts.
 */

export interface WorldEvalCase {
  id: string;
  category: string;
  prompt: string;
  expectedScene: string;
  acceptableScenes?: string[];
  expectedEmotions: string[];
  expectedConcepts?: string[];
  expectedMusicBehaviour: {
    maxEnergy?: number;
    minEnergy?: number;
    genres?: string[];
    textures?: string[];
  };
}

const FILL = {
  time: ["midnight", "3am", "late night", "dawn", "evening"],
  weather: ["rain", "heavy rain", "drizzle", "grey skies", "fog"],
  road: ["motorway", "A road", "empty road", "country lane"],
  place: ["the city", "London", "the coast", "my hometown", "the estate"],
  person: ["them", "someone I love", "an old friend", "my ex"],
  day: ["Sunday", "Monday", "a bank holiday", "a school night"],
};

function fillTemplate(template: string, index: number): string {
  let out = template;
  for (const [key, values] of Object.entries(FILL)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), values[index % values.length]);
  }
  return out;
}

function makeCases(
  category: string,
  prefix: string,
  count: number,
  templates: string[],
  expected: Omit<WorldEvalCase, "id" | "category" | "prompt">,
): WorldEvalCase[] {
  const cases: WorldEvalCase[] = [];
  for (let i = 0; i < count; i += 1) {
    cases.push({
      id: `${prefix}_${String(i + 1).padStart(3, "0")}`,
      category,
      prompt: fillTemplate(templates[i % templates.length], i),
      ...expected,
    });
  }
  return cases;
}

const DRIVING = [
  "driving home after {time} in {weather}",
  "empty {road} at {time}, {weather} on the windscreen",
  "I took the long way home tonight because I wasn't ready to go back yet",
  "couldn't sleep so went for a drive around {place}",
  "just wanted to keep driving through {place}",
  "driving nowhere because I need some space",
  "rain hitting the windscreen while driving home",
  "petrol station at {time} on the way back",
  "the feeling of driving nowhere because you need some space",
  "motorway at {time} with nowhere to rush to",
];

const WEATHER = [
  "{weather} on a {day} morning",
  "tea and rain on a grey sunday",
  "stuck inside while it's {weather} outside",
  "walking in the {weather} without an umbrella",
  "driving home after a difficult day, rain on the glass, nowhere to rush to",
];

const RELATIONSHIPS = [
  "walking home after saying goodbye to {person}",
  "after everyone left the party",
  "everyone left and the house went quiet",
  "missing {person} on a {day} night",
  "first date nerves before meeting {person}",
];

const NOSTALGIA = [
  "old memories of {place} when I was younger",
  "feeling like a kid again",
  "found an old photo and ended up listening to music for hours",
  "the last summer before everyone moved away",
  "driving past the house I grew up in",
];

const LIFE_CHANGES = [
  "first day in my new {place}",
  "that first night where your new place finally feels like home",
  "graduation day feeling",
  "moving out of my parents house",
  "the first morning where everything finally felt mine",
];

const UK_EVERYDAY = [
  "tea and rain on a grey sunday",
  "night bus home through {place}",
  "last train from {place}",
  "walking back from the pub through {place}",
  "estate lights at {time}",
  "bank holiday in the garden",
  "first flat, boxes everywhere",
  "country lanes at {time}",
  "coastal drive at {time}",
  "petrol station at midnight",
];

const ABSTRACT = [
  "peaceful loneliness",
  "feeling hopeful but tired",
  "quiet confidence before something big",
  "bittersweet and calm",
  "feeling lost but free",
  "acceptance after a long week",
];

const PLACES = [
  "summer evening in {place}",
  "empty high street at {time}",
  "seaside town in {weather}",
  "by the coast at {time}",
  "sitting outside my house for 20 minutes because I wasn't ready to go in",
];

const ACTIVITIES = [
  "cooking alone on a {day} night",
  "I kept the lights off and listened to music",
  "cleaning the flat while it's {weather} outside",
  "I walked around town until I felt better",
  "studying at {time} with {weather} outside",
];

const EVERYDAY_LANGUAGE = [
  "just chilling after a {time} shift",
  "needed some space after a {day}",
  "clearing my head on a {weather} {day}",
  "in my feels on a {time} night",
  "feeling lost in {place}",
  "rough week, just taking it easy",
  "can't sleep so I'm {time} daydreaming",
  "old times in {place}",
  "starting over in {place}",
];

const MUSIC_LANGUAGE = [
  "something chill for a {day} night",
  "sad but beautiful music for {time}",
  "cinematic vibes while driving through {place}",
  "dreamy music for a {weather} evening",
  "happy nostalgic songs from {day}s",
  "dark atmospheric tracks at {time}",
];

const TRAVEL_MOVEMENT = [
  "taking the long way home through {place}",
  "driving nowhere at {time} in {weather}",
  "wandering around {place} when it's {weather}",
  "coming home after {time} in the city",
  "getting lost in {place} on a {day}",
  "leaving {place} after everyone went home",
];

const SOCIAL_MOMENTS = [
  "that weird calm after a party finishes",
  "walking home alone after seeing {person}",
  "missing {person} on a {day} night",
  "reunion with {person} in {place}",
  "first date nerves before {time}",
  "alone after everyone left the gathering",
];

const TIME_ATMOSPHERE = [
  "music for a {time} drive in {weather}",
  "sunday morning in {place} feeling slow",
  "friday night energy in the city",
  "2am thoughts about life in {place}",
  "golden hour in {place} feeling bittersweet",
  "midnight in {place} when it's {weather}",
];

const SENSORY_MOMENTS = [
  "rain tapping while driving home at {time}",
  "golden light through the window on a {day}",
  "streetlights reflecting on wet roads in {place}",
  "quiet room at {time} with {weather} outside",
  "cold air and city lights at {time}",
  "coffee smell on a {weather} morning",
];

const UNIVERSAL_GOLDEN = [
  "Driving home after midnight with the rain coming down",
  "The feeling of summer ending",
  "Walking around a city when everyone has gone home",
  "That weird calm after a party finishes",
  "I want music for when you realise your life is changing",
  "The soundtrack to a summer I don't want to forget",
  "Music for sitting outside at night thinking about life",
  "I miss who I was five years ago",
  "Walking through London when it starts raining",
  "Rain on the windscreen driving home after work",
];

const SHORT_PROMPTS = [
  "rainy night",
  "summer memories",
  "gym playlist",
  "driving home",
  "late night vibes",
  "sad songs",
  "chill playlist",
  "nostalgic vibes",
  "main character energy",
  "2am thoughts",
];

const GYM_FITNESS = [
  "gym playlist for leg day",
  "music to push through the last set",
  "workout music when you need motivation",
  "running playlist at {time}",
  "training hard in the gym",
  "pre-workout hype music",
];

const GAMING_FOCUS = [
  "music for gaming sessions",
  "focus playlist for studying",
  "background music while coding",
  "immersive gaming soundtrack",
  "concentration music for revision",
];

const ACHIEVEMENT = [
  "music for when you finally achieve something",
  "celebrating a big win tonight",
  "the moment you prove everyone wrong",
  "graduation day feeling",
  "got the job playlist",
];

const MEMORY_NEIGHBOURHOOD = [
  "walking through my old neighbourhood",
  "driving past the house I grew up in",
  "music for remembering who you used to be",
  "back on my old street in {place}",
  "visiting hometown after years away",
];

const MAIN_CHARACTER = [
  "I want main character music",
  "protagonist energy playlist",
  "cinematic confidence vibes",
  "music for a montage of my life",
  "feeling like the main character tonight",
];

const MOTIVATION = [
  "need motivation on a {day} morning",
  "grey monday need a push",
  "music to get out of bed",
  "starting the week strong",
  "need energy for a long day",
];

const WORK_ROUTINE = [
  "commute playlist after a long day",
  "music for the office grind",
  "deadline mode focus music",
  "after work unwind playlist",
  "shift ends at {time}",
];

const HUMAN_MOMENTS = [
  "the feeling when everyone leaves and you're alone",
  "that moment life quietly changes",
  "when you realise you're growing up",
  "empty but peaceful sunday evening",
  "I need to clear my head",
];

const UK_EXTENDED = [
  "motorway services at {time}",
  "bank holiday in the garden",
  "walking back from the pub in {place}",
  "sixth form memories in {weather}",
  "first car on country lanes",
];

const SOCIAL_EXTENDED = [
  "after saying goodbye to {person}",
  "reunion with {person} in {place}",
  "first date nerves at {time}",
  "missing {person} after they moved away",
  "family dinner memories on a {day}",
];

const TRAVEL_EXTENDED = [
  "airport at {time} waiting to leave",
  "hotel room alone in a new city",
  "train journey through {place}",
  "road trip with nowhere to be",
  "arriving somewhere new at {time}",
];

export const WORLD_EVAL_CASES: WorldEvalCase[] = [
  ...makeCases("Driving", "driving", 50, DRIVING, {
    expectedScene: "LATE_NIGHT_SOLITARY_JOURNEY",
    acceptableScenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY", "NOCTURNAL_ESCAPE_DRIVE"],
    expectedEmotions: ["reflection", "avoidance", "freedom", "loneliness"],
    expectedMusicBehaviour: { maxEnergy: 0.55, genres: ["indie", "ambient"] },
  }),
  ...makeCases("Weather", "weather", 50, WEATHER, {
    expectedScene: "WEATHER_REFLECTION",
    acceptableScenes: ["WEATHER_REFLECTION", "UK_GREY_SUNDAY_INDOORS", "LATE_NIGHT_SOLITARY_JOURNEY"],
    expectedEmotions: ["reflection", "peace", "exhaustion", "relief"],
    expectedMusicBehaviour: { maxEnergy: 0.5 },
  }),
  ...makeCases("Relationships", "relationships", 50, RELATIONSHIPS, {
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "DEPARTURE_WALK", "NOSTALGIC_RETURN"],
    expectedEmotions: ["sadness", "reflection", "loneliness", "longing"],
    expectedMusicBehaviour: { maxEnergy: 0.45 },
  }),
  ...makeCases("Nostalgia", "nostalgia", 50, NOSTALGIA, {
    expectedScene: "NOSTALGIC_RETURN",
    acceptableScenes: ["NOSTALGIC_RETURN", "SUMMER_TRANSITION"],
    expectedEmotions: ["nostalgia", "innocence", "bittersweet"],
    expectedMusicBehaviour: { textures: ["warm"] },
  }),
  ...makeCases("Life changes", "life_changes", 50, LIFE_CHANGES, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "SUMMER_TRANSITION"],
    expectedEmotions: ["hope", "anticipation", "contentment", "independence"],
    expectedMusicBehaviour: { minEnergy: 0.3 },
  }),
  ...makeCases("UK everyday life", "uk_everyday", 100, UK_EVERYDAY, {
    expectedScene: "UK_GREY_SUNDAY_INDOORS",
    acceptableScenes: ["UK_GREY_SUNDAY_INDOORS", "LATE_NIGHT_SOLITARY_JOURNEY", "COASTAL_OPEN_ROAD", "MENTAL_RESET_WALK"],
    expectedEmotions: ["peace", "reflection", "nostalgia", "exhaustion"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Abstract feelings", "abstract", 100, ABSTRACT, {
    expectedScene: "WEATHER_REFLECTION",
    acceptableScenes: [
      "WEATHER_REFLECTION",
      "NOSTALGIC_RETURN",
      "INTROSPECTIVE_PRIVACY",
      "LATE_NIGHT_SOLITARY_JOURNEY",
      "DOMESTIC_QUIET",
      "FRESH_START_ALONE",
    ],
    expectedEmotions: ["reflection", "peace", "hope", "loneliness", "bittersweet"],
    expectedMusicBehaviour: { maxEnergy: 0.6 },
  }),
  ...makeCases("Places", "places", 50, PLACES, {
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "FRESH_START_ALONE", "COASTAL_OPEN_ROAD"],
    expectedEmotions: ["reflection", "avoidance", "nostalgia", "peace"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Activities", "activities", 50, ACTIVITIES, {
    expectedScene: "DOMESTIC_QUIET",
    acceptableScenes: ["DOMESTIC_QUIET", "INTROSPECTIVE_PRIVACY", "MENTAL_RESET_WALK"],
    expectedEmotions: ["peace", "introspection", "relief", "reflection"],
    expectedMusicBehaviour: { maxEnergy: 0.5 },
  }),
  ...makeCases("Everyday language", "everyday_lang", 75, EVERYDAY_LANGUAGE, {
    expectedScene: "INTROSPECTIVE_PRIVACY",
    acceptableScenes: ["INTROSPECTIVE_PRIVACY", "DOMESTIC_QUIET", "MENTAL_RESET_WALK", "WEATHER_REFLECTION"],
    expectedEmotions: ["reflection", "peace", "relief", "nostalgia", "exhaustion"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Music language", "music_lang", 75, MUSIC_LANGUAGE, {
    expectedScene: "WEATHER_REFLECTION",
    acceptableScenes: ["WEATHER_REFLECTION", "LATE_NIGHT_SOLITARY_JOURNEY", "DOMESTIC_QUIET"],
    expectedEmotions: ["peace", "reflection", "nostalgia", "sadness"],
    expectedMusicBehaviour: { maxEnergy: 0.6 },
  }),
  ...makeCases("Travel and movement", "travel_move", 75, TRAVEL_MOVEMENT, {
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "LATE_NIGHT_SOLITARY_JOURNEY", "DEPARTURE_WALK", "MENTAL_RESET_WALK"],
    expectedEmotions: ["reflection", "freedom", "avoidance", "loneliness"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Social moments", "social_moments", 75, SOCIAL_MOMENTS, {
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "DEPARTURE_WALK", "NOSTALGIC_RETURN"],
    expectedEmotions: ["reflection", "loneliness", "sadness", "nostalgia"],
    expectedMusicBehaviour: { maxEnergy: 0.5 },
  }),
  ...makeCases("Time atmosphere", "time_atmo", 75, TIME_ATMOSPHERE, {
    expectedScene: "LATE_NIGHT_SOLITARY_JOURNEY",
    acceptableScenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "UK_GREY_SUNDAY_INDOORS", "WEATHER_REFLECTION"],
    expectedEmotions: ["reflection", "peace", "nostalgia", "bittersweet"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Sensory moments", "sensory_moments", 75, SENSORY_MOMENTS, {
    expectedScene: "LATE_NIGHT_SOLITARY_JOURNEY",
    acceptableScenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "WEATHER_REFLECTION", "REFLECTIVE_AVOIDANCE_JOURNEY"],
    expectedEmotions: ["reflection", "peace", "calm", "nostalgia"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Short prompts", "short", 100, SHORT_PROMPTS, {
    expectedScene: "LATE_NIGHT_SOLITARY_JOURNEY",
    acceptableScenes: [
      "LATE_NIGHT_SOLITARY_JOURNEY",
      "WEATHER_REFLECTION",
      "NOSTALGIC_RETURN",
      "SUMMER_TRANSITION",
      "FRESH_START_ALONE",
      "REFLECTIVE_AVOIDANCE_JOURNEY",
    ],
    expectedEmotions: ["reflection", "nostalgia", "peace", "motivation", "joy", "calm"],
    expectedMusicBehaviour: { maxEnergy: 0.75 },
  }),
  ...makeCases("Gym and fitness", "gym", 100, GYM_FITNESS, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "MENTAL_RESET_WALK"],
    expectedEmotions: ["motivation", "confidence", "achievement"],
    expectedMusicBehaviour: { minEnergy: 0.5 },
  }),
  ...makeCases("Gaming and focus", "gaming", 50, GAMING_FOCUS, {
    expectedScene: "INTROSPECTIVE_PRIVACY",
    acceptableScenes: ["INTROSPECTIVE_PRIVACY", "DOMESTIC_QUIET", "FRESH_START_ALONE"],
    expectedEmotions: ["focus", "introspection", "peace"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Achievement", "achievement", 50, ACHIEVEMENT, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "SUMMER_TRANSITION", "NOSTALGIC_RETURN"],
    expectedEmotions: ["joy", "relief", "hope", "pride"],
    expectedMusicBehaviour: { minEnergy: 0.45 },
  }),
  ...makeCases("Memory and neighbourhood", "memory_hood", 100, MEMORY_NEIGHBOURHOOD, {
    expectedScene: "NOSTALGIC_RETURN",
    acceptableScenes: ["NOSTALGIC_RETURN", "SUMMER_TRANSITION", "DEPARTURE_WALK"],
    expectedEmotions: ["nostalgia", "bittersweet", "longing"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Main character", "main_char", 75, MAIN_CHARACTER, {
    expectedScene: "COASTAL_OPEN_ROAD",
    acceptableScenes: ["COASTAL_OPEN_ROAD", "FRESH_START_ALONE", "LATE_NIGHT_SOLITARY_JOURNEY"],
    expectedEmotions: ["confidence", "freedom", "joy"],
    expectedMusicBehaviour: { minEnergy: 0.45 },
  }),
  ...makeCases("Motivation", "motivation", 75, MOTIVATION, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "UK_GREY_SUNDAY_INDOORS"],
    expectedEmotions: ["hope", "motivation", "anticipation"],
    expectedMusicBehaviour: { minEnergy: 0.4 },
  }),
  ...makeCases("Work routine", "work", 75, WORK_ROUTINE, {
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "LATE_NIGHT_SOLITARY_JOURNEY", "DOMESTIC_QUIET"],
    expectedEmotions: ["exhaustion", "relief", "reflection"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Human moments", "human_moments", 75, HUMAN_MOMENTS, {
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "INTROSPECTIVE_PRIVACY", "FRESH_START_ALONE", "MENTAL_RESET_WALK"],
    expectedEmotions: ["reflection", "peace", "loneliness", "hope"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("UK extended", "uk_ext", 100, UK_EXTENDED, {
    expectedScene: "UK_GREY_SUNDAY_INDOORS",
    acceptableScenes: ["UK_GREY_SUNDAY_INDOORS", "NOSTALGIC_RETURN", "NOCTURNAL_ESCAPE_DRIVE", "COASTAL_OPEN_ROAD"],
    expectedEmotions: ["nostalgia", "peace", "reflection"],
    expectedMusicBehaviour: { maxEnergy: 0.6 },
  }),
  ...makeCases("Social extended", "social_ext", 100, SOCIAL_EXTENDED, {
    expectedScene: "DEPARTURE_WALK",
    acceptableScenes: ["DEPARTURE_WALK", "QUIET_AFTERMATH", "NOSTALGIC_RETURN", "FRESH_START_ALONE"],
    expectedEmotions: ["sadness", "nostalgia", "anticipation", "longing"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("Travel extended", "travel_ext", 100, TRAVEL_EXTENDED, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "LATE_NIGHT_SOLITARY_JOURNEY", "COASTAL_OPEN_ROAD", "DEPARTURE_WALK"],
    expectedEmotions: ["anticipation", "reflection", "freedom", "loneliness"],
    expectedMusicBehaviour: { maxEnergy: 0.6 },
  }),
];

export const ANTI_KEYWORD_CASES: Array<{
  id: string;
  prompt: string;
  expectedScene: string;
  acceptableScenes?: string[];
  expectedEmotions: string[];
  expectedConcepts?: string[];
}> = [
  {
    id: "anti_quiet_house",
    prompt: "The house felt strange after everyone went home",
    expectedScene: "QUIET_AFTERMATH",
    expectedEmotions: ["reflection", "loneliness"],
    expectedConcepts: ["social aftermath", "quiet"],
  },
  {
    id: "anti_keep_driving_night",
    prompt: "I kept driving because I didn't want the night to finish",
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "LATE_NIGHT_SOLITARY_JOURNEY"],
    expectedEmotions: ["nostalgia", "freedom", "reflection"],
    expectedConcepts: ["late night wandering"],
  },
  {
    id: "anti_first_morning_mine",
    prompt: "The first morning where everything finally felt mine",
    expectedScene: "FRESH_START_ALONE",
    expectedEmotions: ["hope", "contentment", "independence"],
    expectedConcepts: ["new home", "fresh chapter"],
  },
  {
    id: "anti_old_photo",
    prompt: "I found an old photo and ended up listening to music for hours",
    expectedScene: "NOSTALGIC_RETURN",
    expectedEmotions: ["nostalgia", "reflection"],
    expectedConcepts: ["memory", "past identity"],
  },
  {
    id: "anti_sat_outside",
    prompt: "I sat outside my house for 20 minutes because I wasn't ready to go in",
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "QUIET_AFTERMATH"],
    expectedEmotions: ["avoidance", "reflection"],
    expectedConcepts: ["needing space"],
  },
  {
    id: "anti_last_summer",
    prompt: "The last summer before everyone moved away",
    expectedScene: "SUMMER_TRANSITION",
    expectedEmotions: ["nostalgia", "bittersweet"],
    expectedConcepts: ["transition", "memory"],
  },
  {
    id: "anti_walk_reset",
    prompt: "I walked around town until I felt better",
    expectedScene: "MENTAL_RESET_WALK",
    expectedEmotions: ["relief", "reflection"],
  },
  {
    id: "anti_lights_off",
    prompt: "I kept the lights off and listened to music",
    expectedScene: "INTROSPECTIVE_PRIVACY",
    expectedEmotions: ["introspection", "privacy", "peace"],
  },
  {
    id: "anti_party_finishes",
    prompt: "That weird calm after a party finishes",
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "DOMESTIC_QUIET"],
    expectedEmotions: ["reflection", "peace", "loneliness"],
  },
  {
    id: "anti_summer_ending_feeling",
    prompt: "The feeling of summer ending",
    expectedScene: "SUMMER_TRANSITION",
    expectedEmotions: ["nostalgia", "bittersweet"],
  },
  {
    id: "anti_life_changing",
    prompt: "I want music for when you realise your life is changing",
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "SUMMER_TRANSITION"],
    expectedEmotions: ["hope", "anticipation", "anxiety"],
  },
];
