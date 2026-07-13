/**
 * Compound prompt retrieval — era + genre + activity + scene/time must align together,
 * not as independent retrieval lanes.
 */

import type { EmotionProfile } from "./emotion";
import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  type ActivityClassificationInput,
  type ActivityIntentInput,
  type ActivityTrackInput,
} from "./activity-profiles";

export type CompoundPromptConstraints = {
  dimensions: number;
  era: { start: number; end: number; confidence: number } | null;
  genres: string[];
  genreConfidence: number;
  activity: string | null;
  activityConfidence: number;
  sceneTags: string[];
  timeOfDay: "morning" | "afternoon" | "evening" | "night" | "sunset" | null;
  energyLevel: "high" | "medium" | "low" | null;
};

const ERA_PATTERNS: Array<{ start: number; end: number; pattern: RegExp; confidence: number }> = [
  { start: 1965, end: 1979, pattern: /\b(?:70s|seventies|197\d)\b/i, confidence: 0.9 },
  { start: 1980, end: 1989, pattern: /\b(?:80s|eighties|198\d)\b/i, confidence: 0.9 },
  { start: 1990, end: 1999, pattern: /\b(?:90s|nineties|199\d)\b/i, confidence: 0.9 },
  { start: 1998, end: 2012, pattern: /\b(?:2000s|00s|y2k|200\d|201[0-2])\b/i, confidence: 0.88 },
  { start: 2010, end: 2019, pattern: /\b(?:2010s|10s|201\d)\b/i, confidence: 0.85 },
];

const GENRE_PATTERNS: Array<{ family: string; pattern: RegExp; confidence: number }> = [
  { family: "soul", pattern: /\b(?:disco|funk|boogie)\b/i, confidence: 0.88 },
  { family: "latin", pattern: /\b(?:latin|reggaeton|salsa|cumbia|bachata|merengue|dembow|tropical)\b/i, confidence: 0.9 },
  { family: "rock", pattern: /\b(?:pop[\s-]?punk|punk|emo|skate[\s-]?punk)\b/i, confidence: 0.9 },
  { family: "pop", pattern: /\b(?:city\s*pop|j[\s-]?pop)\b/i, confidence: 0.86 },
  { family: "electronic", pattern: /\b(?:house|techno|garage|ukg|drum\s*(?:and|&)\s*bass)\b/i, confidence: 0.84 },
  { family: "hip_hop", pattern: /\b(?:hip[\s-]?hop|rap|trap|drill)\b/i, confidence: 0.84 },
  { family: "indie", pattern: /\b(?:indie|alternative|alt[\s-]?rock)\b/i, confidence: 0.8 },
  { family: "folk", pattern: /\b(?:folk|acoustic|singer[\s-]?songwriter)\b/i, confidence: 0.78 },
];

const SCENE_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "coffee_shop", pattern: /\b(?:coffee\s*shop|cafe|café|espresso|latte)\b/i },
  { tag: "sunset", pattern: /\b(?:sunset|golden\s*hour|dusk)\b/i },
  { tag: "night", pattern: /\b(?:late\s*night|midnight|after\s*dark|night\s*drive)\b/i },
  { tag: "morning", pattern: /\b(?:morning|sunrise|wake\s*up)\b/i },
  { tag: "drive", pattern: /\b(?:drive|driving|road\s*trip|highway|motorway)\b/i },
  { tag: "party", pattern: /\b(?:party|dancefloor|club|pregame)\b/i },
  { tag: "gym", pattern: /\b(?:gym|workout|cardio|lifting)\b/i },
  { tag: "reset", pattern: /\b(?:sunday\s*reset|reset|slow\s*morning|self\s*care)\b/i },
  { tag: "chill", pattern: /\b(?:chill|cozy|calm|soft)\b/i },
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function parseCompoundPromptConstraints(
  vibe: string,
  intent: ActivityIntentInput & {
    genreFamilies?: string[];
    primaryGenres?: string[];
    primaryGenre?: string | null;
    energyLevel?: string | null;
    eraStart?: number | null;
    eraEnd?: number | null;
    eraRange?: { start: number; end: number } | null;
    mood?: string[];
  },
  emotionProfile: EmotionProfile,
): CompoundPromptConstraints {
  const genres = unique([
    ...(intent.genreFamilies ?? []),
    ...(intent.primaryGenres ?? []),
    ...(intent.primaryGenre ? [intent.primaryGenre] : []),
    ...GENRE_PATTERNS.filter((row) => row.pattern.test(vibe)).map((row) => row.family),
  ]);

  let era: CompoundPromptConstraints["era"] = null;
  if (intent.eraRange) {
    era = { start: intent.eraRange.start, end: intent.eraRange.end, confidence: 0.92 };
  } else if (intent.eraStart != null && intent.eraEnd != null) {
    era = { start: intent.eraStart, end: intent.eraEnd, confidence: 0.9 };
  } else {
    const hit = ERA_PATTERNS.find((row) => row.pattern.test(vibe));
    if (hit) era = { start: hit.start, end: hit.end, confidence: hit.confidence };
  }

  const activityProfile = resolveActivityProfile(vibe, intent);
  const activity = intent.activity ?? activityProfile?.id ?? null;
  const activityConfidence = activityProfile ? 0.9 : activity ? 0.65 : 0;

  const sceneTags = unique([
    ...SCENE_PATTERNS.filter((row) => row.pattern.test(vibe)).map((row) => row.tag),
    ...(emotionProfile.environment ? [emotionProfile.environment] : []),
  ]);

  let timeOfDay: CompoundPromptConstraints["timeOfDay"] = null;
  if (/\b(?:sunset|golden\s*hour|dusk)\b/i.test(vibe)) timeOfDay = "sunset";
  else if (/\b(?:morning|sunrise)\b/i.test(vibe)) timeOfDay = "morning";
  else if (/\b(?:afternoon)\b/i.test(vibe)) timeOfDay = "afternoon";
  else if (/\b(?:evening)\b/i.test(vibe)) timeOfDay = "evening";
  else if (/\b(?:late\s*night|midnight|night)\b/i.test(vibe)) timeOfDay = "night";
  else if (emotionProfile.timeOfDay === "morning") timeOfDay = "morning";
  else if (emotionProfile.timeOfDay === "night") timeOfDay = "night";

  const energyLevel =
    intent.energyLevel === "high" || intent.energyLevel === "medium" || intent.energyLevel === "low"
      ? intent.energyLevel
      : emotionProfile.energy >= 0.68
        ? "high"
        : emotionProfile.energy <= 0.38
          ? "low"
          : null;

  const dimensions =
    (era ? 1 : 0) +
    (genres.length > 0 ? 1 : 0) +
    (activity ? 1 : 0) +
    (sceneTags.length > 0 ? 1 : 0) +
    (timeOfDay ? 1 : 0) +
    (energyLevel ? 1 : 0);

  return {
    dimensions,
    era,
    genres,
    genreConfidence: genres.length > 0 ? Math.min(0.95, 0.55 + genres.length * 0.12) : 0,
    activity,
    activityConfidence,
    sceneTags,
    timeOfDay,
    energyLevel,
  };
}

function genreEvidenceMatch(
  classification: ActivityClassificationInput,
  track: ActivityTrackInput,
  genres: string[],
): number {
  if (genres.length === 0) return 0.55;
  const family = classification?.genreFamily ?? "unknown";
  const primary = classification?.genrePrimary ?? "";
  const sub = classification?.primarySubgenre ?? "";
  const text = `${family} ${primary} ${sub} ${(track as { trackName?: string }).trackName ?? ""}`.toLowerCase();
  let best = 0;
  for (const genre of genres) {
    const g = genre.toLowerCase();
    if (family === g || primary === g || sub === g) best = Math.max(best, 1);
    else if (text.includes(g.replace(/_/g, " ")) || text.includes(g.replace(/_/g, ""))) best = Math.max(best, 0.78);
    else if (g === "rock" && /\b(?:punk|emo|hardcore)\b/.test(text)) best = Math.max(best, 0.82);
    else if (g === "soul" && /\b(?:disco|funk)\b/.test(text)) best = Math.max(best, 0.85);
    else if (g === "latin" && /\b(?:reggaeton|salsa|cumbia|bachata|merengue|tropical|dembow)\b/.test(text)) best = Math.max(best, 0.86);
    else if (g === "pop" && /\b(?:city\s*pop|jpop)\b/.test(text)) best = Math.max(best, 0.84);
  }
  return best;
}

function eraMatch(
  track: ActivityTrackInput & { releaseYear?: number | null },
  era: NonNullable<CompoundPromptConstraints["era"]>,
): number {
  const year = track.releaseYear;
  if (year == null || !Number.isFinite(year)) return 0.42;
  if (year >= era.start && year <= era.end) return 1;
  const pad = 6;
  if (year >= era.start - pad && year <= era.end + pad) return 0.62;
  return 0.12;
}

function sceneTimeMatch(
  track: ActivityTrackInput,
  constraints: CompoundPromptConstraints,
  emotionProfile: EmotionProfile,
): number {
  let score = 0.5;
  let parts = 0;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const dance = track.danceability ?? 0.5;

  if (constraints.timeOfDay) {
    parts += 1;
    if (constraints.timeOfDay === "sunset" || constraints.timeOfDay === "evening") {
      score += valence >= 0.42 && valence <= 0.78 && energy >= 0.35 && energy <= 0.72 ? 0.42 : 0.12;
    } else if (constraints.timeOfDay === "night") {
      score += energy >= 0.38 && energy <= 0.78 ? 0.38 : 0.14;
    } else if (constraints.timeOfDay === "morning") {
      score += energy >= 0.32 && energy <= 0.68 && valence >= 0.45 ? 0.4 : 0.16;
    }
  }

  if (constraints.sceneTags.includes("coffee_shop") || constraints.sceneTags.includes("chill")) {
    parts += 1;
    score += energy <= 0.62 && dance <= 0.72 ? 0.4 : 0.15;
  }
  if (constraints.sceneTags.includes("party") || constraints.sceneTags.includes("gym")) {
    parts += 1;
    score += energy >= 0.58 || dance >= 0.62 ? 0.42 : 0.14;
  }
  if (constraints.sceneTags.includes("drive")) {
    parts += 1;
    score += energy >= 0.4 && (track.tempo ?? 100) >= 85 ? 0.38 : 0.16;
  }
  if (constraints.energyLevel === "high") {
    parts += 1;
    score += energy >= 0.62 ? 0.4 : 0.12;
  } else if (constraints.energyLevel === "low") {
    parts += 1;
    score += energy <= 0.52 ? 0.4 : 0.12;
  }

  if (parts === 0) {
    return Math.max(0.4, 1 - (Math.abs(energy - emotionProfile.energy) + Math.abs(valence - emotionProfile.valence)) / 2);
  }
  return Math.min(1, score);
}

export function scoreCompoundPromptFit(
  track: ActivityTrackInput & { releaseYear?: number | null; trackName?: string },
  classification: ActivityClassificationInput,
  constraints: CompoundPromptConstraints,
  vibe: string,
  emotionProfile: EmotionProfile,
): number {
  if (constraints.dimensions < 2) return 1;

  const parts: number[] = [];
  if (constraints.era) parts.push(eraMatch(track, constraints.era));
  if (constraints.genres.length > 0) parts.push(genreEvidenceMatch(classification, track, constraints.genres));
  if (constraints.activity) {
    const profile = resolveActivityProfile(vibe, { activity: constraints.activity });
    if (profile) {
      if (trackFailsActivityHardGate(track, classification, profile, vibe)) parts.push(0.08);
      else parts.push(scoreActivityCandidateFit(track, classification, profile, vibe));
    }
  }
  if (constraints.sceneTags.length > 0 || constraints.timeOfDay || constraints.energyLevel) {
    parts.push(sceneTimeMatch(track, constraints, emotionProfile));
  }

  if (parts.length === 0) return 1;
  const product = parts.reduce((acc, value) => acc * Math.max(0.05, value), 1);
  const geometric = Math.pow(product, 1 / parts.length);
  const arithmetic = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.max(0, Math.min(1, geometric * 0.62 + arithmetic * 0.38));
}

export function isCompoundPrompt(constraints: CompoundPromptConstraints): boolean {
  return constraints.dimensions >= 2;
}
