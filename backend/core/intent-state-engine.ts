/**
 * Intent State Engine — structured meaning extracted BEFORE retrieval.
 * Deterministic, non-blocking, partial understanding only.
 */

import { buildLockedIntent } from "./v3/intent";
import { detectEra } from "../lib/era-detection";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_ERA_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";

export interface IntentState {
  activity?: string;
  emotion?: string;
  energy?: "low" | "medium" | "high";
  scene?: string[];
  era?: string;
  constraints?: {
    excludedGenres?: string[];
    excludedArtists?: string[];
  };
  unknownTokens?: string[];
  confidence: number;
}

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but",
  "my", "me", "i", "we", "you", "with", "from", "is", "it", "this", "that",
  "want", "need", "music", "songs", "song", "tracks", "track", "playlist",
  "please", "pls", "some", "like", "feel", "feeling", "vibe", "vibes", "make",
  "give", "get", "be", "am", "im", "i'm", "its", "it's", "not", "just",
  "really", "very", "something", "anything", "while", "when", "where", "who",
]);

const CULTURAL_SCENE_PATTERNS: Array<{ pattern: RegExp; scene: string }> = [
  { pattern: /\bkerrang\b/i, scene: "kerrang_alt_rock" },
  { pattern: /\btony\s+hawk\b/i, scene: "tony_hawk_punk" },
  { pattern: /\bneed\s+for\s+speed\b|\bnfs\b/i, scene: "need_for_speed" },
  { pattern: /\bforza\s+horizon\b|\bforza\b/i, scene: "forza_horizon" },
  { pattern: /\buk\s+grime\b/i, scene: "uk_grime" },
  { pattern: /\bgrime\s+(?:classics|anthems|bangers|workout|walk|era)\b/i, scene: "uk_grime" },
  { pattern: /\buk\s+rap\b/i, scene: "uk_rap" },
  { pattern: /\buk\s+drill\b/i, scene: "uk_drill" },
  { pattern: /\b(?:fix(?:ing)?|repair(?:ing)?|working\s+on)\s+(?:a\s+|my\s+)?(?:car|cars|volvo|saab|bmw|mx-?5)\b/i, scene: "garage_repair" },
  { pattern: /\b(?:garage|workshop|project\s+car)\b/i, scene: "garage_workshop" },
  { pattern: /\brainy\s+night\s+driv/i, scene: "rainy_night_drive" },
  { pattern: /\bnight\s+driv/i, scene: "night_drive" },
  { pattern: /\btop\s+gear\b|\bclarkson\b/i, scene: "top_gear_driving" },
];

const EXCLUDED_GENRE_PATTERNS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\bno\s+rap\b|\bwithout\s+rap\b/i, family: "hip_hop" },
  { pattern: /\bno\s+metal\b|\bwithout\s+metal\b/i, family: "metal" },
  { pattern: /\bno\s+country\b/i, family: "country" },
  { pattern: /\bno\s+pop\b/i, family: "pop" },
  { pattern: /\bno\s+edm\b|\bno\s+techno\b/i, family: "electronic" },
  { pattern: /\bno\s+drill\b|\bno\s+trap\b/i, family: "hip_hop" },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function tokenize(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/gi) ?? [])
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 0);
}

function collectMatchedSpans(prompt: string): Set<string> {
  const lower = prompt.toLowerCase();
  const matched = new Set<string>();
  const mark = (term: string): void => {
    const normalized = term.toLowerCase().trim();
    if (normalized.length >= 2) matched.add(normalized);
  };

  for (const [key, terms] of Object.entries(EXPANDED_MOOD_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    if (termRegex([key]).test(lower)) mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_ACTIVITY_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    if (termRegex([key]).test(lower)) mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_PLACE_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    if (termRegex([key]).test(lower)) mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_TIME_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    if (termRegex([key]).test(lower)) mark(key);
  }
  for (const eraEntry of EXPANDED_ERA_TERMS) {
    for (const term of eraEntry.terms) if (termRegex([term]).test(lower)) mark(term);
    if (termRegex([eraEntry.label]).test(lower)) mark(eraEntry.label);
  }
  for (const group of EXPANDED_GENRE_ALIASES) {
    for (const term of group.terms) if (termRegex([term]).test(lower)) mark(term);
    mark(group.family);
  }
  for (const { pattern, scene } of CULTURAL_SCENE_PATTERNS) {
    if (pattern.test(lower)) mark(scene);
  }

  const era = detectEra(prompt);
  if (era.decade) mark(era.decade);

  return matched;
}

function tokenCovered(token: string, matched: Set<string>): boolean {
  const lower = token.toLowerCase();
  if (matched.has(lower)) return true;
  for (const span of matched) {
    if (span.includes(lower) || lower.includes(span)) return true;
  }
  return false;
}

function extractExcludedGenres(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return [...new Set(
    EXCLUDED_GENRE_PATTERNS
      .filter(({ pattern }) => pattern.test(lower))
      .map(({ family }) => family),
  )];
}

function extractExcludedArtists(prompt: string): string[] {
  const matches = [...prompt.matchAll(/\bno\s+([a-z][a-z\s.'-]{1,40}?)(?:\s+songs?|\s+music|\s+tracks?|,|$)/gi)];
  return [...new Set(matches.map((m) => m[1]?.trim().toLowerCase()).filter(Boolean) as string[])];
}

function extractCulturalScenes(prompt: string): string[] {
  const ukMusicGarage = /\b(?:ukg|uk\s+garage|grime|uk\s+rap|uk\s+drill)\b/i.test(prompt);
  return CULTURAL_SCENE_PATTERNS
    .filter(({ pattern, scene }) => {
      if (scene === "garage_workshop" && ukMusicGarage) return false;
      return pattern.test(prompt);
    })
    .map(({ scene }) => scene);
}

function computeConfidence(signals: {
  hasActivity: boolean;
  hasEmotion: boolean;
  hasEnergy: boolean;
  hasScene: boolean;
  hasEra: boolean;
  unknownRatio: number;
}): number {
  const richness =
    (signals.hasActivity ? 0.18 : 0) +
    (signals.hasEmotion ? 0.18 : 0) +
    (signals.hasEnergy ? 0.12 : 0) +
    (signals.hasScene ? 0.22 : 0) +
    (signals.hasEra ? 0.12 : 0);
  const coverage = 1 - signals.unknownRatio;
  return round2(clamp01(richness + coverage * 0.35));
}

export function buildIntentState(prompt: string): IntentState {
  const text = prompt.trim();
  if (!text) return { confidence: 0.1, unknownTokens: [] };

  const locked = buildLockedIntent(text);
  const matched = collectMatchedSpans(text);
  const tokens = tokenize(text);
  const unknownTokens = [...new Set(
    tokens
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
      .filter((token) => !tokenCovered(token, matched))
      .filter((token) => !/^\d+$/.test(token)),
  )].slice(0, 12);

  const culturalScenes = extractCulturalScenes(text);
  const scene = [...new Set([
    ...culturalScenes,
    ...locked.genreFamilies,
    locked.primarySubgenre,
    locked.activity ? locked.activity.replace(/_/g, " ") : null,
  ].filter((value): value is string => !!value))].slice(0, 6);

  const eraCtx = detectEra(text);
  const era = eraCtx.decade
    ?? (locked.eraRange ? `${locked.eraRange.start}s` : undefined);

  const excludedGenres = extractExcludedGenres(text);
  const excludedArtists = extractExcludedArtists(text);
  const constraints = (excludedGenres.length || excludedArtists.length)
    ? {
        ...(excludedGenres.length ? { excludedGenres } : {}),
        ...(excludedArtists.length ? { excludedArtists } : {}),
      }
    : undefined;

  const contentTokens = tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  const unknownRatio = contentTokens.length > 0 ? unknownTokens.length / contentTokens.length : 0;

  const confidence = computeConfidence({
    hasActivity: !!locked.activity,
    hasEmotion: locked.mood.length > 0,
    hasEnergy: !!locked.energy,
    hasScene: scene.length > 0,
    hasEra: !!era,
    unknownRatio,
  });

  return {
    ...(locked.activity ? { activity: locked.activity.replace(/_/g, " ") } : {}),
    ...(locked.mood[0] ? { emotion: locked.mood[0] } : {}),
    ...(locked.energy ? { energy: locked.energy } : {}),
    ...(scene.length ? { scene } : {}),
    ...(era ? { era } : {}),
    ...(constraints ? { constraints } : {}),
    ...(unknownTokens.length ? { unknownTokens } : {}),
    confidence,
  };
}
