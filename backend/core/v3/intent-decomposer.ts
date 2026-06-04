/**
 * V3 Intent Decomposer — multi-axis intent extraction.
 *
 * Spec §2 + §9:
 *   A. Primary intent   — dominant theme string
 *   B. Secondary intents — hidden emotional / thematic signals
 *   C. Context anchors  — era, environment, motion level
 *   D. Scene Influence Map — soft forces (sum ≈ 1.0) replacing single-scene labels
 */

import type { EmotionProfile } from "../../lib/emotion";
import { parseUserIntent, type UserIntent, type EraBucket } from "../../lib/intent-parser";

// ── Types ──────────────────────────────────────────────────────────────────

export type InfluenceForce =
  | "driving" | "nostalgia" | "night" | "freedom" | "melancholy"
  | "energy" | "calm" | "warmth" | "urban" | "rural" | "focus"
  | "party" | "cinematic" | "introspective" | "euphoric" | "dark"
  | "romantic" | "hopeful" | "acoustic" | "electronic" | "rhythm";

export type EnvironmentType = "road" | "room" | "city" | "nature" | "night" | "mixed";

export interface SceneInfluenceMap {
  [force: string]: number;
}

export interface ContextAnchors {
  era: EraBucket;
  environment: EnvironmentType;
  motionLevel: number;
}

export interface DecomposedIntent {
  primary: string;
  secondaryIntents: string[];
  contextAnchors: ContextAnchors;
  sceneInfluenceMap: SceneInfluenceMap;
  baseIntent: UserIntent;
}

// ── Influence force detection ──────────────────────────────────────────────

const INFLUENCE_PATTERNS: Array<{
  force: InfluenceForce;
  baseWeight: number;
  patterns: RegExp[];
}> = [
  {
    force: "driving",
    baseWeight: 1.0,
    patterns: [/\b(driv(e|ing)|road.?trip|highway|motorway|windows.?down|cruise|night.?drive|open.?road|behind.?the.?wheel)\b/i],
  },
  {
    force: "nostalgia",
    baseWeight: 1.0,
    patterns: [/\b(nostalg|throwback|memory|memories|childhood|remember|reminisce|growing.?up|retro|vintage|old.?school|classic|back.?in.?the.?day)\b/i],
  },
  {
    force: "night",
    baseWeight: 0.9,
    patterns: [/\b(night|midnight|2\s?am|3\s?am|late.?night|nocturnal|after.?dark|dark.?hours|evening|witching.?hour)\b/i],
  },
  {
    force: "freedom",
    baseWeight: 0.8,
    patterns: [/\b(free|freedom|open|vast|escape|wide|horizon|cowboy|outlaw|rebel|roam|endless)\b/i],
  },
  {
    force: "melancholy",
    baseWeight: 1.0,
    patterns: [/\b(melanchol|sad|heartbreak|grief|lonely|loneliness|blue|desolate|empty|aching|yearning)\b/i],
  },
  {
    force: "energy",
    baseWeight: 1.0,
    patterns: [/\b(energ(y|ised|ized)|hype|pump(ed)?|fired.?up|intense|power|adrenaline|charged|electric)\b/i],
  },
  {
    force: "calm",
    baseWeight: 1.0,
    patterns: [/\b(calm|peaceful|serene|gentle|soft|quiet|still|tranquil|relax|chill|soothe|mellow)\b/i],
  },
  {
    force: "warmth",
    baseWeight: 0.8,
    patterns: [/\b(warm|cozy|cosy|golden|sunset|summer|sun|comfort|hearth|fireside|toasty)\b/i],
  },
  {
    force: "urban",
    baseWeight: 0.9,
    patterns: [/\b(city|urban|street|downtown|metro|subway|traffic|night.?city|neon|skyline|concrete)\b/i],
  },
  {
    force: "rural",
    baseWeight: 0.9,
    patterns: [/\b(rural|country|countryside|farm|field|nature|forest|mountain|dirt.?road|barn|porch|prairie|pasture)\b/i],
  },
  {
    force: "focus",
    baseWeight: 1.0,
    patterns: [/\b(focus|concentrate|deep.?work|flow.?state|productive|sharp|clarity|zen|locked.?in)\b/i],
  },
  {
    force: "party",
    baseWeight: 1.0,
    patterns: [/\b(party|club|rave|dance.?floor|festival|banger|turn.?up|pregame|all.?night)\b/i],
  },
  {
    force: "cinematic",
    baseWeight: 0.9,
    patterns: [/\b(cinemat|epic|orchestral|film|score|grand|sweeping|dramatic|blockbuster|soundtrack)\b/i],
  },
  {
    force: "introspective",
    baseWeight: 0.9,
    patterns: [/\b(introspect|reflect|thinking|contempl|alone|solitude|inner|ponder|meditat|self)\b/i],
  },
  {
    force: "euphoric",
    baseWeight: 1.0,
    patterns: [/\b(euphoric|bliss|ecstatic|peak|elated|overjoyed|transcendent|high.?on.?life)\b/i],
  },
  {
    force: "dark",
    baseWeight: 0.9,
    patterns: [/\b(dark|gloomy|brooding|heavy|ominous|eerie|sinister|haunting|gothic|shadow|void)\b/i],
  },
  {
    force: "romantic",
    baseWeight: 1.0,
    patterns: [/\b(romantic|love|intimate|tender|date.?night|passion|longing|crush|devotion)\b/i],
  },
  {
    force: "hopeful",
    baseWeight: 0.9,
    patterns: [/\b(hope|optimis|bright|new.?chapter|looking.?forward|sunrise|beginning|fresh.?start|uplifting)\b/i],
  },
  {
    force: "acoustic",
    baseWeight: 0.8,
    patterns: [/\b(acoustic|unplugged|folk|guitar|singer.?songwriter|raw|stripped|campfire)\b/i],
  },
  {
    force: "electronic",
    baseWeight: 0.9,
    patterns: [/\b(electronic|synth|digital|edm|techno|beats|808|glitch|rave|cyber)\b/i],
  },
  {
    force: "rhythm",
    baseWeight: 0.8,
    patterns: [/\b(groove|rhythm|beat|bass|danceable|funky|funk|hip.?hop|rap|bounce)\b/i],
  },
];

function detectInfluenceForces(vibe: string): SceneInfluenceMap {
  const raw: Partial<Record<InfluenceForce, number>> = {};

  for (const { force, baseWeight, patterns } of INFLUENCE_PATTERNS) {
    if (patterns.some((re) => re.test(vibe))) {
      raw[force] = baseWeight;
    }
  }

  const detected = Object.keys(raw);

  if (detected.length === 0) {
    return { calm: 0.50, introspective: 0.30, nostalgia: 0.20 };
  }

  const total = Object.values(raw).reduce((s, v) => s + (v ?? 0), 0);
  const normalized: SceneInfluenceMap = {};
  for (const [force, weight] of Object.entries(raw) as Array<[InfluenceForce, number]>) {
    normalized[force] = Math.round((weight / total) * 1000) / 1000;
  }
  return normalized;
}

// ── Environment detection ──────────────────────────────────────────────────

const ENV_PATTERNS: Array<{ env: EnvironmentType; patterns: RegExp[] }> = [
  { env: "road",   patterns: [/\b(road|highway|motorway|drive|driving|car|vehicle|truck|cruising)\b/i] },
  { env: "room",   patterns: [/\b(room|bedroom|home|house|cozy|cosy|indoor|apartment|flat|study|office)\b/i] },
  { env: "city",   patterns: [/\b(city|urban|street|downtown|metro|subway|neon|skyline|alleyway)\b/i] },
  { env: "nature", patterns: [/\b(nature|forest|mountain|field|park|countryside|rural|dirt.?road|trail|woods|prairie)\b/i] },
  { env: "night",  patterns: [/\b(night|midnight|2\s?am|late.?night|after.?dark|nocturnal|evening)\b/i] },
];

function detectEnvironment(vibe: string): EnvironmentType {
  for (const { env, patterns } of ENV_PATTERNS) {
    if (patterns.some((re) => re.test(vibe))) return env;
  }
  return "mixed";
}

// ── Motion level ───────────────────────────────────────────────────────────

function detectMotionLevel(influences: SceneInfluenceMap): number {
  const motionScore =
    (influences["driving"] ?? 0) * 0.90 +
    (influences["party"] ?? 0) * 0.85 +
    (influences["energy"] ?? 0) * 0.75 +
    (influences["rhythm"] ?? 0) * 0.55 +
    (influences["freedom"] ?? 0) * 0.45;

  const stillnessScore =
    (influences["calm"] ?? 0) * 0.80 +
    (influences["focus"] ?? 0) * 0.85 +
    (influences["introspective"] ?? 0) * 0.70 +
    (influences["cinematic"] ?? 0) * 0.40;

  return Math.max(0, Math.min(1, 0.50 + motionScore - stillnessScore));
}

// ── Primary and secondary intent strings ──────────────────────────────────

function extractPrimaryIntent(vibe: string): string {
  const words = vibe.trim().split(/\s+/).filter((w) => w.length > 2);
  return words.slice(0, 7).join(" ");
}

function extractSecondaryIntents(influences: SceneInfluenceMap): string[] {
  return Object.entries(influences)
    .sort((a, b) => b[1] - a[1])
    .slice(1, 5)
    .map(([force]) => force);
}

// ── Main decomposer ────────────────────────────────────────────────────────

export function decomposeIntent(vibe: string, profile: EmotionProfile): DecomposedIntent {
  const baseIntent = parseUserIntent(vibe, profile);
  const sceneInfluenceMap = detectInfluenceForces(vibe);

  return {
    primary: extractPrimaryIntent(vibe),
    secondaryIntents: extractSecondaryIntents(sceneInfluenceMap),
    contextAnchors: {
      era: baseIntent.era,
      environment: detectEnvironment(vibe),
      motionLevel: detectMotionLevel(sceneInfluenceMap),
    },
    sceneInfluenceMap,
    baseIntent,
  };
}

/** Returns true when the intent is ambiguous / under-specified */
export function isUnclearIntent(intent: DecomposedIntent): boolean {
  const forces = Object.keys(intent.sceneInfluenceMap);
  const topWeight = Math.max(...Object.values(intent.sceneInfluenceMap), 0);
  return forces.length < 2 || topWeight < 0.35;
}
