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
    patterns: [/\b(warm|cozy|cosy|golden|sunset|summer(?:time|y)?|sun(?:ny|shine)?|comfort|hearth|fireside|toasty)\b/i],
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

// ── Genre-specific force injection ────────────────────────────────────────
// When the vibe IS a genre name (e.g. "AMERICAN COUNTRY", "jazz at midnight"),
// inject a rich set of co-occurring influence forces so the lane generator has
// enough signal. Without this, single-word genre prompts produce only 1 force
// and fire the "unclear intent" fallback path, losing all genre specificity.

const GENRE_FORCE_INJECTIONS: Array<{
  pattern: RegExp;
  forces: Partial<Record<InfluenceForce, number>>;
}> = [
  {
    pattern: /\b(country|americana|western|cowboy|honky.?tonk|alt.?country|bluegrass|appalachian)\b/i,
    forces: { rural: 0.8, acoustic: 0.7, warmth: 0.6, freedom: 0.5 },
  },
  {
    pattern: /\b(jazz|bebop|swing|bossa.?nova|big.?band|latin.?jazz)\b/i,
    forces: { calm: 0.7, introspective: 0.8, cinematic: 0.5, urban: 0.4 },
  },
  {
    pattern: /\b(blues|delta.?blues|chicago.?blues|electric.?blues)\b/i,
    forces: { melancholy: 0.8, acoustic: 0.6, introspective: 0.7 },
  },
  {
    pattern: /\b(hip.?hop|rap|trap|drill|boom.?bap|r&b|rnb)\b/i,
    forces: { rhythm: 0.9, urban: 0.7, energy: 0.6 },
  },
  {
    pattern: /\b(edm|techno|house|trance|dubstep|drum.?n.?bass|dnb)\b/i,
    forces: { electronic: 0.9, energy: 0.8, party: 0.5 },
  },
  {
    pattern: /\b(classical|orchestral|symphony|concerto|chamber|baroque|neoclassical)\b/i,
    forces: { cinematic: 0.9, calm: 0.7, introspective: 0.6 },
  },
  {
    pattern: /\b(folk|indie.?folk|fingerpick|troubadour)\b/i,
    forces: { acoustic: 0.9, introspective: 0.7, warmth: 0.5 },
  },
  {
    pattern: /\b(metal|hard.?rock|punk|grunge|thrash|death.?metal|prog.?rock)\b/i,
    forces: { energy: 0.9, dark: 0.6, freedom: 0.5 },
  },
  {
    pattern: /\b(soul|motown|gospel|neo.?soul|funk.?soul)\b/i,
    forces: { warmth: 0.9, romantic: 0.6, rhythm: 0.7 },
  },
  {
    pattern: /\b(latin|salsa|reggaeton|cumbia|flamenco|bachata|merengue)\b/i,
    forces: { rhythm: 0.9, energy: 0.7, warmth: 0.6, romantic: 0.5 },
  },
  {
    pattern: /\b(reggae|ska|dub|dancehall|rocksteady)\b/i,
    forces: { freedom: 0.8, warmth: 0.7, rhythm: 0.6 },
  },
  {
    pattern: /\b(k.?pop|j.?pop|synth.?pop|art.?pop)\b/i,
    forces: { energy: 0.7, hopeful: 0.6, electronic: 0.5 },
  },
  {
    // "indie" prompts are common and produce zero text forces without this injection.
    // Without it, isUnclearIntent fires and the adaptive lane generator is bypassed entirely.
    pattern: /\b(indie|alternative|alt.?rock|indie.?rock|indie.?pop|dream.?pop|shoegaze|bedroom.?pop|lo.?fi|jangle.?pop)\b/i,
    forces: { hopeful: 0.55, freedom: 0.50, acoustic: 0.35, energy: 0.30 },
  },
];

function injectGenreForces(
  vibe: string,
  raw: Partial<Record<InfluenceForce, number>>,
): void {
  for (const { pattern, forces } of GENRE_FORCE_INJECTIONS) {
    if (pattern.test(vibe)) {
      for (const [force, weight] of Object.entries(forces) as Array<[InfluenceForce, number]>) {
        if ((raw[force] ?? 0) < weight) {
          raw[force] = weight;
        }
      }
    }
  }
}

function detectInfluenceForces(vibe: string): SceneInfluenceMap {
  const raw: Partial<Record<InfluenceForce, number>> = {};

  for (const { force, baseWeight, patterns } of INFLUENCE_PATTERNS) {
    if (patterns.some((re) => re.test(vibe))) {
      raw[force] = baseWeight;
    }
  }

  // Inject genre-specific forces so that "AMERICAN COUNTRY", "jazz", etc.
  // always produce at least 2 forces and bypass the unclear-intent fallback.
  injectGenreForces(vibe, raw);

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
  // A rich multi-force map (≥4 forces) signals a well-specified intent even when no single
  // force dominates (e.g. "Indie Summertime Drive" spreads across driving/warmth/hopeful/etc).
  // The topWeight < 0.35 guard was designed for single-force vibes; it must not penalise
  // multi-dimensional prompts that have legitimately distributed influence.
  if (forces.length >= 4) return false;
  return forces.length < 2 || topWeight < 0.35;
}
