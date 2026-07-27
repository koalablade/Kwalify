/**
 * 300 natural human evaluation prompts (spec categories).
 */

export interface WorldEvalCase {
  id: string;
  category: string;
  prompt: string;
  expectedScene: string;
  acceptableScenes?: string[];
  expectedEmotions: string[];
  expectedEnvironment?: string[];
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
      id: `${prefix}_${String(i + 1).padStart(2, "0")}`,
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
  "that feeling driving home after {time} when it's {weather} and the whole world feels quiet",
  "I took the long way home tonight because I wasn't ready to go back yet",
  "couldn't sleep so went for a drive around {place}",
  "windows down on the {road} at {time}",
  "petrol station at {time} on the way back",
  "coastal drive with {weather} coming in off the sea",
  "country lanes at {time}, headlights cutting through {weather}",
  "just wanted to keep driving through {place}",
];

const WEATHER = [
  "{weather} on a {day} morning",
  "stuck inside while it's {weather} outside",
  "walking in the {weather} without an umbrella",
  "tea and rain on a grey sunday",
  "the sky went {weather} just as I left",
];

const RELATIONSHIPS = [
  "walking home after saying goodbye to {person}",
  "first date nerves before meeting {person}",
  "after everyone left the party",
  "missing {person} on a {day} night",
  "everyone left and the house went quiet",
];

const NOSTALGIA = [
  "old memories of {place} when I was younger",
  "school days and {weather} afternoons",
  "feeling like a kid again",
  "driving past the house I grew up in",
  "uni days with old friends",
];

const LIFE_EVENTS = [
  "first day in my new {place}",
  "just got the job at {place}",
  "moving out of my parents house",
  "graduation day feeling",
  "last day of summer",
];

const UK_CULTURE = [
  "tea and rain on a grey sunday",
  "night bus home through {place}",
  "estate lights at {time}",
  "walking back from the pub through {place}",
  "last train from {place}",
  "bank holiday in the garden",
  "first flat, boxes everywhere",
  "country lanes at {time}",
  "coastal drive at {time}",
  "summer evening in {place}",
];

const ABSTRACT = [
  "feeling hopeful but tired",
  "quiet confidence before something big",
  "peaceful loneliness",
  "anxious but excited",
  "bittersweet and calm",
];

export const WORLD_EVAL_CASES: WorldEvalCase[] = [
  ...makeCases("DRIVING", "driving", 50, DRIVING, {
    expectedScene: "LATE_NIGHT_SOLITARY_JOURNEY",
    acceptableScenes: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY", "NOCTURNAL_ESCAPE_DRIVE", "COASTAL_OPEN_ROAD"],
    expectedEmotions: ["reflection", "avoidance", "peace", "loneliness"],
    expectedMusicBehaviour: { maxEnergy: 0.55, genres: ["indie", "ambient"] },
  }),
  ...makeCases("WEATHER", "weather", 30, WEATHER, {
    expectedScene: "WEATHER_REFLECTION",
    acceptableScenes: ["WEATHER_REFLECTION", "UK_GREY_SUNDAY_INDOORS"],
    expectedEmotions: ["peace", "reflection", "sadness"],
    expectedEnvironment: ["rain", "grey"],
    expectedMusicBehaviour: { maxEnergy: 0.45 },
  }),
  ...makeCases("RELATIONSHIPS", "relationships", 40, RELATIONSHIPS, {
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "DEPARTURE_WALK", "NOSTALGIC_RETURN"],
    expectedEmotions: ["sadness", "reflection", "loneliness", "longing"],
    expectedMusicBehaviour: { maxEnergy: 0.45 },
  }),
  ...makeCases("NOSTALGIA", "nostalgia", 40, NOSTALGIA, {
    expectedScene: "NOSTALGIC_RETURN",
    acceptableScenes: ["NOSTALGIC_RETURN", "SUMMER_TRANSITION"],
    expectedEmotions: ["nostalgia", "innocence", "joy", "bittersweet"],
    expectedMusicBehaviour: { maxEnergy: 0.55, textures: ["warm"] },
  }),
  ...makeCases("LIFE EVENTS", "life_events", 40, LIFE_EVENTS, {
    expectedScene: "FRESH_START_ALONE",
    acceptableScenes: ["FRESH_START_ALONE", "SUMMER_TRANSITION", "NOSTALGIC_RETURN"],
    expectedEmotions: ["hope", "nostalgia", "anticipation"],
    expectedMusicBehaviour: { minEnergy: 0.25 },
  }),
  ...makeCases("UK CULTURE", "uk_culture", 50, UK_CULTURE, {
    expectedScene: "UK_GREY_SUNDAY_INDOORS",
    acceptableScenes: ["UK_GREY_SUNDAY_INDOORS", "WEATHER_REFLECTION", "LATE_NIGHT_SOLITARY_JOURNEY", "COASTAL_OPEN_ROAD"],
    expectedEmotions: ["peace", "reflection", "nostalgia", "exhaustion"],
    expectedMusicBehaviour: { maxEnergy: 0.55 },
  }),
  ...makeCases("ABSTRACT EMOTIONS", "abstract", 50, ABSTRACT, {
    expectedScene: "WEATHER_REFLECTION",
    acceptableScenes: ["WEATHER_REFLECTION", "NOSTALGIC_RETURN", "LATE_NIGHT_SOLITARY_JOURNEY"],
    expectedEmotions: ["reflection", "hope", "peace", "anxiety", "bittersweet"],
    expectedMusicBehaviour: { maxEnergy: 0.6 },
  }),
];

const GOLDEN_OVERRIDES: Record<string, Partial<WorldEvalCase>> = {
  driving_04: {
    prompt: "I took the long way home tonight because I wasn't ready to go back yet",
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    expectedEmotions: ["avoidance", "reflection"],
  },
};

for (const evalCase of WORLD_EVAL_CASES) {
  const override = GOLDEN_OVERRIDES[evalCase.id];
  if (override) Object.assign(evalCase, override);
}

export const ANTI_KEYWORD_CASES: Array<{
  id: string;
  prompt: string;
  expectedScene: string;
  acceptableScenes?: string[];
  expectedEmotions: string[];
  forbiddenKeywordOnly?: string[];
}> = [
  {
    id: "anti_quiet_house",
    prompt: "The house felt strange after everyone went home",
    expectedScene: "QUIET_AFTERMATH",
    acceptableScenes: ["QUIET_AFTERMATH", "INTROSPECTIVE_PRIVACY"],
    expectedEmotions: ["reflection", "loneliness"],
    forbiddenKeywordOnly: ["house"],
  },
  {
    id: "anti_walk_reset",
    prompt: "I walked around town until I felt better",
    expectedScene: "MENTAL_RESET_WALK",
    acceptableScenes: ["MENTAL_RESET_WALK", "DEPARTURE_WALK"],
    expectedEmotions: ["relief", "reflection"],
    forbiddenKeywordOnly: ["town"],
  },
  {
    id: "anti_lights_off",
    prompt: "I kept the lights off and listened to music",
    expectedScene: "INTROSPECTIVE_PRIVACY",
    expectedEmotions: ["introspection", "privacy", "peace"],
    forbiddenKeywordOnly: ["lights", "music"],
  },
  {
    id: "anti_summer_end",
    prompt: "The last day of summer",
    expectedScene: "SUMMER_TRANSITION",
    acceptableScenes: ["SUMMER_TRANSITION", "NOSTALGIC_RETURN"],
    expectedEmotions: ["nostalgia", "bittersweet"],
    forbiddenKeywordOnly: ["summer", "day"],
  },
  {
    id: "anti_avoidance_drive",
    prompt: "I drove around because I wasn't ready to go home",
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    expectedEmotions: ["avoidance", "reflection"],
    forbiddenKeywordOnly: ["home", "drove"],
  },
  {
    id: "anti_long_way_cluster",
    prompt: "Taking the long way back",
    expectedScene: "REFLECTIVE_AVOIDANCE_JOURNEY",
    acceptableScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY", "LATE_NIGHT_SOLITARY_JOURNEY"],
    expectedEmotions: ["reflection", "avoidance", "longing"],
    forbiddenKeywordOnly: ["way"],
  },
];
