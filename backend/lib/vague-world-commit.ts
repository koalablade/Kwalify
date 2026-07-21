/**
 * Vague-prompt world commit — pick ONE everyday musical world and hard-lock it.
 *
 * Doctrine: never widen into a multi-scene mash for low-confidence lifestyle prompts.
 * Prefer commit > clarify > refuse. Clarify only when two worlds are near-tied.
 */

export type VagueCommitAction = "commit" | "clarify" | "passthrough";

export type VagueWorldCommit = {
  action: VagueCommitAction;
  /** World identity id (STRICT lock). */
  worldId: string | null;
  /** Semantic scene id for scoring affinity (single weight 1.0). */
  sceneId: string | null;
  /** 0–1 confidence in the commit. */
  confidence: number;
  reason: string;
  label: string;
  /** Alternate worlds when clarifying. */
  alternatives: Array<{ worldId: string; label: string; sceneId: string }>;
};

type EverydayWorld = {
  worldId: string;
  sceneId: string;
  label: string;
  /** Higher = preferred when multiple match. */
  priority: number;
  patterns: RegExp[];
};

/**
 * Everyday worlds for mam-test prompts. Expanded aggressively.
 * Patterns are OR'd; first strong match wins by priority then confidence.
 */
export const EVERYDAY_WORLD_MAP: EverydayWorld[] = [
  {
    worldId: "soft_sad_world",
    sceneId: "HEARTBREAK",
    label: "gentle sad / tender",
    priority: 10,
    patterns: [
      /\b(?:dumped|break.?up|heartbroken|miss someone|be gentle|a bit sad|soft songs? for when|crying(?!\s+in\s+the\s+club)|lonely but|hurt a little)\b/i,
      /\b(?:when you miss|sad soft|not depressing|processing|slap but also hurt)\b/i,
    ],
  },
  {
    worldId: "film_ending_world",
    sceneId: "CINEMATIC_CLOSE",
    label: "cinematic / film ending",
    priority: 12,
    patterns: [
      /\b(?:film ending|expensive and cinematic|main character walking|feels like a film ending)\b/i,
      /\bplaylist that feels like a film ending\b/i,
    ],
  },
  {
    worldId: "dad_secret_world",
    sceneId: "NOSTALGIA",
    label: "dad-core / secret classics",
    priority: 12,
    patterns: [/\b(?:songs?\s+my\s+dad|dad would secretly)\b/i],
  },
  {
    worldId: "older_sibling_world",
    sceneId: "INDIE_BEDROOM_LOFI",
    label: "cool older sibling",
    priority: 12,
    patterns: [/\b(?:cool\s+older\s+sibling|older\s+sibling)\b/i],
  },
  {
    worldId: "latin_summer_rooftop_world",
    sceneId: "PARTY_SOCIAL_NIGHT",
    label: "latin summer rooftop",
    priority: 13,
    patterns: [/\blatin\s+summer\s+rooftop\b/i, /\blatin.*rooftop\b/i, /\brooftop.*(?:latin|drinks)\b/i],
  },
  {
    worldId: "nostalgia_warm_world",
    sceneId: "NOSTALGIA",
    label: "emotional / feel something",
    priority: 11,
    patterns: [/\b(?:idk just make me feel|make me feel something)\b/i],
  },
  {
    worldId: "indie_dream_world",
    sceneId: "INDIE_BEDROOM_LOFI",
    label: "dreamy indie",
    priority: 9,
    patterns: [
      /\b(?:tumblr|2014 tumblr|indie sleaze|dreamy indie|one world only)\b/i,
      /\bphoebe bridgers\b/i,
    ],
  },
  {
    worldId: "commute_world",
    sceneId: "MORNING_RUN_SUNRISE",
    label: "commute / train",
    priority: 9,
    patterns: [
      /\b(?:train delayed|make it bearable)\b/i,
      /\bcommute\b/i,
    ],
  },
  {
    worldId: "first_date_world",
    sceneId: "HOPE_NEW_CHAPTER",
    label: "first date nerves",
    priority: 10,
    patterns: [/\bfirst\s+date\b/i],
  },
  {
    worldId: "summer_warm_world",
    sceneId: "HOPE_NEW_CHAPTER",
    label: "warm summer / sunny",
    priority: 9,
    patterns: [/\b(?:songs that feel like summer|summer vibes|sunny afternoon)\b/i],
  },
  {
    worldId: "feel_good_world",
    sceneId: "HOPE_NEW_CHAPTER",
    label: "feel-good / hype",
    priority: 8,
    patterns: [
      /\b(?:happy vibes|feel good|feel.?good|vibes only|promotion|let'?s go+|optimistic|first date nerves)\b/i,
      /\b(?:got a promotion)\b/i,
    ],
  },
  {
    worldId: "party_prep_world",
    sceneId: "PARTY_SOCIAL_NIGHT",
    label: "pre-drinks / night-out hype",
    priority: 10,
    patterns: [
      /\b(?:pre drinks|hype for a night out|night out starting|friday night kitchen dance)\b/i,
    ],
  },
  {
    worldId: "social_kitchen_world",
    sceneId: "PARTY_SOCIAL_NIGHT",
    label: "cooking / kitchen / soft social",
    priority: 9,
    patterns: [
      /\b(?:cooking dinner|dinner with friends|music for cooking|kitchen party|house party ending|people leaving|soft and intimate|party but make it soft)\b/i,
      /\b(?:crying in the club|tasteful|dinner party)\b/i,
    ],
  },
  {
    worldId: "sunday_chill_world",
    sceneId: "SLOW_MORNING_COFFEE",
    label: "sunday / cozy chill",
    priority: 9,
    patterns: [
      /\b(?:sunday morning|sunday reset|cozy evening|sofa|chill for sunday|chill evening|warm after.?work|after work unwind)\b/i,
      /\b(?:hospital waiting|weirdly calm|assembling ikea|ikea furniture|songs that sound like autumn)\b/i,
    ],
  },
  {
    worldId: "late_night_calm_world",
    sceneId: "SLOW_MORNING_COFFEE",
    label: "late night wind-down",
    priority: 9,
    patterns: [
      /\b(?:late night winding|wind(?:ing)?\s+down|house party ending people leaving)\b/i,
    ],
  },
  {
    worldId: "upbeat_chore_world",
    sceneId: "MORNING_RUN_SUNRISE",
    label: "upbeat chores / cleaning",
    priority: 8,
    patterns: [
      /\b(?:background music while i clean|clean the flat|hyperpop chaos for cleaning|upbeat stuff for a morning walk)\b/i,
    ],
  },
  {
    worldId: "coffee_soft_focus_world",
    sceneId: "STUDY_DEEP_FOCUS",
    label: "coffee shop / soft focus",
    priority: 8,
    patterns: [
      /\b(?:coffee shop|laptop session|writing essays|midnight with tea|exam week|brain is fried|studying but|exam week survival)\b/i,
      /\b(?:writing essays|exam week)\b/i,
    ],
  },
  {
    worldId: "evening_drive_world",
    sceneId: "EMPTY_MOTORWAY_NIGHT",
    label: "evening / night drive",
    priority: 9,
    patterns: [
      /\b(?:driving home|drive home|after work.*driv|motorway|headlights|road trip through|wales rainy|90s car stereo|windows down|lonely city walk|walk at 1am|golden hour walk)\b/i,
    ],
  },
  {
    worldId: "rainy_reading_world",
    sceneId: "RAINY_WINDOW_READ",
    label: "rainy reading / window",
    priority: 10,
    patterns: [
      /\b(?:rainy afternoon reading|reading by the window|rainy day in bed)\b/i,
    ],
  },
  {
    worldId: "beach_sunset_world",
    sceneId: "BEACH_SUNSET",
    label: "beach sunset / golden hour",
    priority: 9,
    patterns: [
      /\b(?:beach sunset|golden hour walk through the park)\b/i,
    ],
  },
  {
    worldId: "gym_energy_world",
    sceneId: "WORKOUT_INTENSITY",
    label: "gym energy",
    priority: 10,
    patterns: [
      /\b(?:need energy for the gym|energy for the gym|for the gym(?!\s+rock)|ex'?s birthday.*lift|ignore them and lift)\b/i,
      /\b(?:workout music that isn'?t aggressive)\b/i,
    ],
  },
  {
    worldId: "nostalgia_warm_world",
    sceneId: "NOSTALGIA",
    label: "warm nostalgia",
    priority: 7,
    patterns: [
      /\b(?:nostalgic 2000s|throwback night|feel like the 2014|memory lane|nostalgia)\b/i,
    ],
  },
  {
    worldId: "acoustic_sunday_world",
    sceneId: "SLOW_MORNING_COFFEE",
    label: "acoustic sunday",
    priority: 9,
    patterns: [/\bacoustic sunday\b/i],
  },
];

const NAMED_WORLD_RE =
  /\b(?:goth|grunge|disco|synthwave|retrowave|neon|lo-?fi|lofi|ambient|metal|pop[-\s]?punk|uk\s*garage|ukg|grime|shoegaze|darkwave|post[-\s]?punk|boss\s+fight|classic\s+rock|red\s+dirt|drum\s+and\s+bass|dnb|britpop|r&b|hyperpop|jazz|folk|emo|reggaeton|salsa|bachata|cumbia|garage\s+workshop)\b/i;

function scoreMatch(prompt: string, world: EverydayWorld): number {
  let hits = 0;
  for (const re of world.patterns) {
    if (re.test(prompt)) hits += 1;
  }
  if (hits === 0) return 0;
  return Math.min(1, 0.55 + hits * 0.18 + world.priority * 0.01);
}

/**
 * Resolve whether a prompt should auto-commit to one everyday world.
 * Named genre/scene prompts passthrough to existing hard locks.
 */
export function resolveVagueWorldCommit(
  prompt: string,
  opts?: { promptConfidenceScore?: number; tier?: "low" | "medium" | "high"; sceneIdLocked?: string | null },
): VagueWorldCommit {
  const p = prompt.trim();
  if (!p) {
    return {
      action: "clarify",
      worldId: null,
      sceneId: null,
      confidence: 0,
      reason: "empty_prompt",
      label: "",
      alternatives: [],
    };
  }
  if (opts?.sceneIdLocked?.trim()) {
    return {
      action: "passthrough",
      worldId: null,
      sceneId: null,
      confidence: 1,
      reason: "user_locked_scene",
      label: "",
      alternatives: [],
    };
  }
  if (NAMED_WORLD_RE.test(p)) {
    return {
      action: "passthrough",
      worldId: null,
      sceneId: null,
      confidence: 1,
      reason: "named_world_language",
      label: "",
      alternatives: [],
    };
  }

  const scored = EVERYDAY_WORLD_MAP.map((w) => ({
    world: w,
    score: scoreMatch(p, w),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.world.priority - a.world.priority);

  const confScore = opts?.promptConfidenceScore ?? 0.3;
  const tier = opts?.tier ?? (confScore < 0.38 ? "low" : confScore < 0.62 ? "medium" : "high");

  // High-confidence specific prompts with no everyday match → normal pipeline.
  if (scored.length === 0) {
    if (tier === "high") {
      return {
        action: "passthrough",
        worldId: null,
        sceneId: null,
        confidence: confScore,
        reason: "high_tier_no_everyday_map",
        label: "",
        alternatives: [],
      };
    }
    // Default commit for unmapped vague lifestyle language — one safe world.
    return {
      action: "commit",
      worldId: "sunday_chill_world",
      sceneId: "SLOW_MORNING_COFFEE",
      confidence: 0.62,
      reason: "vague_default_sunday_chill",
      label: "sunday / cozy chill",
      alternatives: [
        { worldId: "feel_good_world", label: "feel-good / hype", sceneId: "HOPE_NEW_CHAPTER" },
        { worldId: "soft_sad_world", label: "gentle sad / tender", sceneId: "HEARTBREAK" },
      ],
    };
  }

  const top = scored[0]!;
  const second = scored[1];
  const alternatives = scored.slice(1, 4).map((s) => ({
    worldId: s.world.worldId,
    label: s.world.label,
    sceneId: s.world.sceneId,
  }));

  // Near-tie → clarify (mam gets chips) unless scores are both weak — then still commit top.
  if (second && top.score - second.score < 0.08 && top.score >= 0.7 && second.score >= 0.65) {
    return {
      action: "clarify",
      worldId: top.world.worldId,
      sceneId: top.world.sceneId,
      confidence: top.score,
      reason: "near_tie_everyday_worlds",
      label: top.world.label,
      alternatives,
    };
  }

  return {
    action: "commit",
    worldId: top.world.worldId,
    sceneId: top.world.sceneId,
    confidence: Math.max(top.score, 0.7),
    reason: "everyday_world_commit",
    label: top.world.label,
    alternatives,
  };
}

/** True when generation should suppress multi-scene entropy / soft surprise widen. */
export function shouldSuppressVagueWiden(commit: VagueWorldCommit): boolean {
  return commit.action === "commit" && !!commit.worldId;
}
