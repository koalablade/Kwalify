/**
 * V2 Intent Parser — structured intent extraction from free-text vibe prompts.
 *
 * Replaces scene-first detection. Scene detection is OPTIONAL metadata only;
 * it never gates, filters, or dominates scoring.
 *
 * Output: UserIntent — a strongly-typed descriptor that drives the triple-signal scorer.
 */

import type { EmotionProfile } from "./emotion";
import { buildQueryEmbedding, type AudioVector } from "../shared/embeddings/track-embeddings";

// ─── Types ─────────────────────────────────────────────────────────────────

export type EraBucket =
  | "60s" | "70s" | "80s" | "90s" | "00s" | "10s" | "20s" | "any";

export type ActivityType =
  | "driving" | "working" | "party" | "chill" | "focus"
  | "nostalgia" | "walking" | "studying" | "cleaning" | "unknown";

export interface UserIntent {
  era: EraBucket;
  energy: number;
  mood: string[];
  activity: ActivityType;
  vibeTags: string[];
}

// ─── Era detection ──────────────────────────────────────────────────────────

const ERA_PATTERNS: Array<{ era: EraBucket; patterns: RegExp[] }> = [
  {
    era: "60s",
    patterns: [/\b(60s|1960s|sixties|motown|beatles era|flower power)\b/i],
  },
  {
    era: "70s",
    patterns: [/\b(70s|1970s|seventies|disco era|classic rock era)\b/i],
  },
  {
    era: "80s",
    patterns: [
      /\b(80s|1980s|eighties|synth.?pop|new wave|cold wave|depeche mode)\b/i,
    ],
  },
  {
    era: "90s",
    patterns: [
      /\b(90s|1990s|nineties|grunge|britpop|trip.?hop|90s?(hip.?hop|pop|rock|r&b))\b/i,
    ],
  },
  {
    era: "00s",
    patterns: [
      /\b(00s|2000s|noughties|early 2000s|y2k|emo era|post.?grunge)\b/i,
    ],
  },
  {
    era: "10s",
    patterns: [
      /\b(10s|2010s|twenty.?tens|edm era|trap era|indie pop era)\b/i,
    ],
  },
  {
    era: "20s",
    patterns: [
      /\b(20s|2020s|twenty.?twenties|hyperpop|bedroom pop|modern)\b/i,
    ],
  },
];

function detectEra(vibe: string): EraBucket {
  const lower = vibe.toLowerCase();
  for (const { era, patterns } of ERA_PATTERNS) {
    if (patterns.some((re) => re.test(lower))) return era;
  }
  // "throwback" / "nostalgic" without a specific era → 90s as default
  if (/\b(throwback|nostalgia|retro|vintage|classic|old school)\b/i.test(lower)) {
    return "90s";
  }
  return "any";
}

// ─── Activity detection ─────────────────────────────────────────────────────

const ACTIVITY_PATTERNS: Array<{ activity: ActivityType; patterns: RegExp[] }> = [
  {
    activity: "driving",
    patterns: [
      /\b(driv(e|ing)|road.?trip|highway|motorway|windows.?down|cruise|night.?drive)\b/i,
    ],
  },
  {
    activity: "party",
    patterns: [
      /\b(party|club|rave|dance.?floor|festival|banger|turn.?up|pregame|pregaming)\b/i,
    ],
  },
  {
    activity: "focus",
    patterns: [
      /\b(focus|concentrate|deep.?work|study|coding|flow.?state|productive)\b/i,
    ],
  },
  {
    activity: "working",
    patterns: [
      /\b(work(ing)?|office|productivity|background|grind|hustle)\b/i,
    ],
  },
  {
    activity: "chill",
    patterns: [
      /\b(chill(ing)?|relax(ing)?|lazy|calm|lounge|sunset|laid.?back|cozy|cosy)\b/i,
    ],
  },
  {
    activity: "nostalgia",
    patterns: [
      /\b(nostalgic|throwback|memory|memories|remember|reminisce|growing.?up)\b/i,
    ],
  },
  {
    activity: "walking",
    patterns: [
      /\b(walk(ing)?|stroll(ing)?|morning.?run|commute|commuting|headphones)\b/i,
    ],
  },
  {
    activity: "studying",
    patterns: [
      /\b(study(ing)?|studying|revision|homework|reading|library|exam|learn(ing)?|academic)\b/i,
    ],
  },
  {
    activity: "cleaning",
    patterns: [
      /\b(clean(ing)?|tidy(ing)?|chores?|hoover(ing)?|vacuuming|housework|wash(ing)?\s+dishes|mop(ping)?)\b/i,
    ],
  },
];

function detectActivity(vibe: string): ActivityType {
  for (const { activity, patterns } of ACTIVITY_PATTERNS) {
    if (patterns.some((re) => re.test(vibe))) return activity;
  }
  return "unknown";
}

// ─── Mood tag extraction ─────────────────────────────────────────────────────

const MOOD_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "melancholic", pattern: /\b(melanchol|sad|blue|heartbreak|grief|lonely)\b/i },
  { tag: "euphoric", pattern: /\b(euphoric|bliss|ecstatic|peak|high|love)\b/i },
  { tag: "energised", pattern: /\b(energ|hype|pump(ed)?|fired.?up|intense|power)\b/i },
  { tag: "calm", pattern: /\b(calm|peace|serene|gentle|soft|quiet|still)\b/i },
  { tag: "nostalgic", pattern: /\b(nostalg|throwback|remember|childhood|grow|old)\b/i },
  { tag: "cinematic", pattern: /\b(cinemat|epic|orchestral|film|score|grand)\b/i },
  { tag: "dark", pattern: /\b(dark|gloomy|brooding|heavy|ominous|eerie)\b/i },
  { tag: "hopeful", pattern: /\b(hope|optimis|bright|new chapter|looking.?forward)\b/i },
  { tag: "romantic", pattern: /\b(romantic|love|intimate|tender|date.?night)\b/i },
  { tag: "introspective", pattern: /\b(introspect|reflect|think|contempl|alone)\b/i },
];

function extractMoodTags(vibe: string): string[] {
  const excluded = new Set<string>();
  const lower = vibe.toLowerCase();
  if (/\b(?:not|no|without)\s+(?:sad|melanchol|lonely|blue|heartbreak)\b/.test(lower)) excluded.add("melancholic");
  if (/\b(?:not|no|without)\s+(?:hype|energ|intense|power)\b/.test(lower)) excluded.add("energised");
  if (/\b(?:not|no|without)\s+(?:calm|peace|quiet|still)\b/.test(lower)) excluded.add("calm");
  if (/\b(?:not|no|without)\s+(?:nostalg|throwback|old)\b/.test(lower)) excluded.add("nostalgic");

  return MOOD_PATTERNS
    .filter(({ pattern }) => pattern.test(vibe))
    .map(({ tag }) => tag)
    .filter((tag) => !excluded.has(tag))
    .slice(0, 2);
}

// ─── Vibe tag extraction ─────────────────────────────────────────────────────

function extractVibeTags(vibe: string): string[] {
  const words = vibe.toLowerCase().split(/[\s,;.!?]+/);
  return words.filter((w) => w.length >= 4 && w.length <= 20);
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a free-text vibe string into a structured UserIntent.
 * The emotion profile provides the energy/valence baseline from the existing pipeline.
 */
export function parseUserIntent(vibe: string, profile: EmotionProfile): UserIntent {
  const activity = detectActivity(vibe);
  const activityEnergy: Partial<Record<ActivityType, number>> = {
    party: 0.85,
    driving: 0.62,
    chill: 0.28,
    focus: 0.35,
    walking: 0.52,
    working: 0.40,
    nostalgia: 0.45,
    studying: 0.32,
    cleaning: 0.68,
  };
  return {
    era: detectEra(vibe),
    energy: activityEnergy[activity] ?? profile.energy,
    mood: extractMoodTags(vibe),
    activity,
    vibeTags: extractVibeTags(vibe),
  };
}

// ─── Intent → Embedding ─────────────────────────────────────────────────────

/**
 * Build a 7D audio-feature embedding from a UserIntent.
 *
 * Used as the query vector for cosine similarity scoring (signal R at 45%).
 * Each dimension is derived analytically from intent fields.
 */
export function buildIntentEmbedding(intent: UserIntent): AudioVector {
  const energy = intent.energy;
  const hasDark = intent.mood.includes("dark") || intent.mood.includes("melancholic");
  const hasCinematic = intent.mood.includes("cinematic");

  // Valence: derived from mood tags
  let valence = 0.5;
  if (intent.mood.includes("euphoric") || intent.mood.includes("hopeful")) valence = 0.75;
  if (hasDark || intent.mood.includes("introspective")) valence = 0.30;
  if (intent.mood.includes("calm")) valence = 0.55;

  // Activity-specific overrides
  const activityEnergy: Partial<Record<ActivityType, number>> = {
    party: 0.85,
    driving: 0.62,
    chill: 0.28,
    focus: 0.35,
    walking: 0.52,
    working: 0.40,
    nostalgia: 0.45,
    studying: 0.32,
    cleaning: 0.68,
    unknown: energy,
  };
  const resolvedEnergy = activityEnergy[intent.activity] ?? energy;

  // Danceability: party=high, chill=low, driving=medium
  const activityDance: Partial<Record<ActivityType, number>> = {
    party: 0.85,
    driving: 0.55,
    chill: 0.35,
    focus: 0.30,
    walking: 0.60,
    nostalgia: 0.50,
    studying: 0.25,
    cleaning: 0.72,
  };
  const danceability = activityDance[intent.activity] ?? Math.min(1, resolvedEnergy * 0.6 + 0.2);

  // Acousticness: cinematic/chill = more acoustic; party/driving = less
  const acousticness = hasCinematic
    ? 0.65
    : intent.activity === "chill"
    ? 0.55
    : Math.max(0, 0.70 - resolvedEnergy * 0.80);
  const acousticnessInv = 1 - acousticness;

  // Instrumentalness: focus/cinematic = higher, vocal/party = lower
  const instrumentalness =
    intent.activity === "focus" ? 0.35
    : hasCinematic ? 0.25
    : 0.05;

  // Tempo: correlates with energy
  const tempoNorm = Math.min(1, 0.40 + resolvedEnergy * 0.50);

  return buildQueryEmbedding(
    { energy: resolvedEnergy, valence } as EmotionProfile,
    {
      energyTarget: resolvedEnergy,
      danceabilityHint: danceability,
      acousticnessHint: acousticness,
      instrumentalnessHint: instrumentalness,
      tempoHint: tempoNorm * 200,
    }
  );
}

// ─── Activity energy/valence profiles ────────────────────────────────────────

/**
 * Compute how well a track's energy/danceability suits the intended activity.
 * Returns 0–1. Used as activityMatch in signal C.
 */
export function computeActivityMatch(
  track: { energy: number | null; danceability: number | null; valence: number | null },
  activity: ActivityType
): number {
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const v = track.valence ?? 0.5;

  switch (activity) {
    case "party":
      return (e * 0.5 + d * 0.5) * 0.8 + v * 0.2;
    case "driving":
      return 1 - Math.abs(e - 0.65) * 1.6;
    case "chill":
      return 1 - Math.abs(e - 0.28) * 2.0;
    case "focus":
      return 1 - Math.abs(e - 0.35) * 2.0;
    case "working":
      return 1 - Math.abs(e - 0.50) * 1.5;
    case "walking":
      return 1 - Math.abs(e - 0.52) * 1.8;
    case "nostalgia":
      return 0.5 + v * 0.3 - Math.abs(e - 0.45) * 0.5;
    case "studying":
      // Low energy, low danceability — calm instrumental focus
      return Math.max(0, 1 - Math.abs(e - 0.32) * 2.2 - d * 0.3);
    case "cleaning":
      // Upbeat and danceable — energetic but not intense
      return (e * 0.45 + d * 0.45 + v * 0.1) * 1.2 - Math.abs(e - 0.68) * 0.5;
    default:
      return 0.5;
  }
}
