/**
 * Human intent layer — what the user wants from music, not just what they describe.
 */

export type IntentKind =
  | "soundtrack"
  | "nostalgia"
  | "emotional_support"
  | "atmosphere"
  | "energy"
  | "achievement"
  | "reflection"
  | "unknown";

export interface IntentContract {
  kind: IntentKind;
  confidence: number;
  trigger?: string;
  emotionBoosts: string[];
  sceneFamilies: string[];
  preferredScenes?: string[];
  stressRecovery?: boolean;
  energyBias?: "low" | "medium" | "high";
}

const INTENT_PATTERNS: Array<{
  kind: IntentKind;
  patterns: RegExp[];
  emotionBoosts: string[];
  sceneFamilies: string[];
  preferredScenes?: string[];
  stressRecovery?: boolean;
  energyBias?: "low" | "medium" | "high";
}> = [
  {
    kind: "soundtrack",
    patterns: [/i want music for/i, /playlist for/i, /soundtrack to/i, /music for when/i, /songs for/i],
    emotionBoosts: [],
    sceneFamilies: [],
  },
  {
    kind: "nostalgia",
    patterns: [/i miss/i, /miss the old/i, /old days/i, /used to be/i, /remember when/i, /throwback/i, /teenage years/i, /who i was/i],
    emotionBoosts: ["nostalgia", "longing", "bittersweet"],
    sceneFamilies: ["NOSTALGIA"],
  },
  {
    kind: "emotional_support",
    patterns: [
      /rough (day|week)/i,
      /horrible day/i,
      /awful day/i,
      /terrible day/i,
      /worst day/i,
      /difficult day/i,
      /hard day/i,
      /bad day/i,
      /stressful day/i,
      /after a horrible/i,
      /after an awful/i,
      /decompress after/i,
      /needed to decompress/i,
    ],
    emotionBoosts: ["relief", "reflection", "exhaustion", "peace"],
    sceneFamilies: ["MOVEMENT"],
    preferredScenes: ["REFLECTIVE_AVOIDANCE_JOURNEY"],
    stressRecovery: true,
  },
  {
    kind: "emotional_support",
    patterns: [/i need/i, /need to clear/i, /help me feel/i, /get through/i],
    emotionBoosts: ["relief", "reflection", "peace"],
    sceneFamilies: ["PRIVATE", "MOVEMENT"],
  },
  {
    kind: "atmosphere",
    patterns: [/feels like/i, /feeling like/i, /vibes like/i, /something like/i, /sounds like/i],
    emotionBoosts: ["reflection", "peace"],
    sceneFamilies: ["PRIVATE", "MOVEMENT"],
  },
  {
    kind: "energy",
    patterns: [/gym/i, /workout/i, /hype/i, /pump me up/i, /main character/i, /feeling alive/i, /get motivated/i],
    emotionBoosts: ["confidence", "motivation", "freedom", "joy"],
    sceneFamilies: ["ACHIEVEMENT", "MOVEMENT"],
    energyBias: "high",
  },
  {
    kind: "achievement",
    patterns: [/finally (did|achieve|made it)/i, /achieved something/i, /won/i, /graduation/i, /got the job/i, /personal success/i],
    emotionBoosts: ["joy", "relief", "pride", "hope"],
    sceneFamilies: ["ACHIEVEMENT", "LIFE_TRANSITIONS"],
    energyBias: "high",
  },
  {
    kind: "reflection",
    patterns: [/thinking about/i, /late night thoughts/i, /lost in thought/i, /processing/i, /need space/i],
    emotionBoosts: ["reflection", "introspection", "peace"],
    sceneFamilies: ["PRIVATE", "MOVEMENT"],
    energyBias: "low",
  },
];

export function resolveIntentContract(prompt: string): IntentContract {
  const lower = prompt.toLowerCase();

  for (const entry of INTENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      const match = lower.match(pattern);
      if (!match) continue;
      return {
        kind: entry.kind,
        confidence: 0.75 + Math.min(match[0].length / 40, 0.2),
        trigger: match[0],
        emotionBoosts: entry.emotionBoosts,
        sceneFamilies: entry.sceneFamilies,
        preferredScenes: entry.preferredScenes,
        stressRecovery: entry.stressRecovery,
        energyBias: entry.energyBias,
      };
    }
  }

  return {
    kind: "unknown",
    confidence: 0.3,
    emotionBoosts: [],
    sceneFamilies: [],
  };
}
