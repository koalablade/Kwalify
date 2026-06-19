/**
 * Intent Decomposer V1 — structured semantic intent from raw prompts.
 * Deterministic, partial understanding, never blocks pipeline.
 */

import { buildLockedIntent } from "./v3/intent";
import { detectEra } from "../lib/era-detection";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  EXPANDED_ERA_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";

export type DecomposedIntent = {
  raw: string;
  scene: string | null;
  emotion: string | null;
  energy: "low" | "medium" | "high" | null;
  exclusions: string[];
  culturalRefs: string[];
  inferredActivity: string | null;
  unknownTokens: string[];
  confidence: number;
};

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but",
  "my", "me", "i", "we", "you", "with", "from", "is", "it", "this", "that",
  "want", "need", "music", "songs", "song", "tracks", "track", "playlist",
  "please", "pls", "some", "like", "feel", "feeling", "vibe", "vibes", "make",
  "give", "get", "be", "am", "im", "i'm", "its", "it's", "not", "just",
  "really", "very", "something", "anything", "while", "when", "where", "who",
]);

const KNOWN_TOKEN_ROOTS = new Set([
  ...Object.keys(EXPANDED_MOOD_TERMS),
  ...Object.keys(EXPANDED_ACTIVITY_TERMS),
  ...Object.keys(EXPANDED_PLACE_TERMS),
  ...Object.keys(EXPANDED_TIME_TERMS),
  "kerrang", "tony", "hawk", "nfs", "forza", "volvo", "saab", "garage", "rainy",
  "night", "drive", "driving", "gym", "workout", "sleep", "calm", "sad", "angry",
  "rock", "metal", "pop", "rap", "trap", "edm", "indie", "blues", "country",
  "agatha", "christie", "sherlock", "holmes", "tolkien", "dune", "orwell", "lovecraft",
  "mystery", "detective", "victorian", "noir", "fantasy", "horror",
]);

const CULTURAL_PATTERNS: Array<{ pattern: RegExp; ref: string; scene: string }> = [
  { pattern: /\bkerrang\b/i, ref: "kerrang", scene: "alt-rock-scene" },
  { pattern: /\btony\s+hawk\b/i, ref: "tony-hawk", scene: "skate-punk-scene" },
  { pattern: /\bneed\s+for\s+speed\b|\bnfs\b/i, ref: "need-for-speed", scene: "driving-electronic-rock" },
  { pattern: /\bforza\s+horizon\b|\bforza\b/i, ref: "forza-horizon", scene: "driving-electronic-rock" },
  { pattern: /\btop\s+gear\b|\bclarkson\b/i, ref: "top-gear", scene: "driving-rock" },
  { pattern: /\bvolvo\b|\bsaab\b|\bmx-?5\b|\be46\b/i, ref: "project-car", scene: "garage-repair" },
  { pattern: /\b(?:fix(?:ing)?|repair(?:ing)?|working\s+on)\s+(?:a\s+|my\s+)?(?:car|cars|volvo|saab|bmw|mx-?5)\b/i, ref: "garage-work", scene: "garage-repair" },
  { pattern: /\buk\s+grime\b/i, ref: "uk-grime", scene: "uk-grime" },
  { pattern: /\buk\s+rap\b/i, ref: "uk-rap", scene: "uk-rap" },
  { pattern: /\buk\s+drill\b/i, ref: "uk-drill", scene: "uk-drill" },
  { pattern: /\b(?:british|london|road)\s+rap\b/i, ref: "uk-rap", scene: "uk-rap" },
  { pattern: /\bgrime\s+(?:classics|anthems|bangers|playlist|mix|workout)\b/i, ref: "uk-grime", scene: "uk-grime" },
  { pattern: /\b(?:ukg|uk\s+garage)\b.*\b(?:grime|rap|drill)\b/i, ref: "uk-garage-grime", scene: "uk-garage-grime" },
  { pattern: /\b(?:garage|workshop|project\s+car)\b/i, ref: "garage-workshop", scene: "garage-workshop" },
  { pattern: /\brainy\s+night\s+driv/i, ref: "rainy-night-drive", scene: "rainy-night-drive" },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function tokenize(lower: string): string[] {
  return (lower.match(/[a-z0-9][a-z0-9'-]*/gi) ?? [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export function matchScene(text: string): string | null {
  const expansion = expandCulturalReferences(text);
  if (expansion.sceneId) return expansion.sceneId;
  for (const entry of CULTURAL_PATTERNS) {
    if (entry.pattern.test(text)) return entry.scene;
  }
  const lower = text.toLowerCase();
  if (/\b(?:ukg|uk\s+garage|grime|uk\s+rap|uk\s+drill)\b/.test(lower)) return null;
  if (/\bgarage\b/.test(lower)) return "garage-workshop";
  if (/\brainy\b/.test(lower) && /\bnight\b/.test(lower)) return "rainy-night-drive";
  return null;
}

export function matchCulture(text: string): string | null {
  const refs = extractCulturalRefs(text);
  return refs[0] ?? null;
}

export function matchEmotion(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(?:heartbreak|breakup|break\s+up|sad|crying|grief)\b/.test(lower)) return "sad";
  if (/\b(?:motivated|hype|pump|fired\s+up)\b/.test(lower)) return "motivated";
  if (/\b(?:angry|rage|furious|aggressive)\b/.test(lower)) return "aggressive";
  if (/\b(?:calm|peaceful|relaxed|chill)\b/.test(lower)) return "calm";
  if (/\b(?:nostalg|throwback|retro)\b/.test(lower)) return "nostalgic";
  if (/\b(?:lonely|alone|solitary)\b/.test(lower)) return "solitary";
  return null;
}

export function matchEnergy(text: string): "low" | "medium" | "high" | null {
  const lower = text.toLowerCase();
  if (/\b(?:gym|workout|hype|party|rave|intense|pump)\b/.test(lower)) return "high";
  if (/\b(?:sleep|calm|relax|unwind|soft|peaceful)\b/.test(lower)) return "low";
  return "medium";
}

export function matchActivity(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [activity, terms] of Object.entries(EXPANDED_ACTIVITY_TERMS)) {
    if (termRegex([activity]).test(lower)) return activity;
    if (terms.some((term) => termRegex([term]).test(lower))) return activity;
  }
  if (/\b(?:driv|road|cruise|highway)\b/.test(lower)) return "driving";
  if (/\b(?:study|focus|coding)\b/.test(lower)) return "focus";
  return null;
}

export function extractExclusions(text: string): string[] {
  const lower = text.toLowerCase();
  const exclusions: string[] = [];
  if (/\bno\s+rap\b|\bwithout\s+rap\b|\bno\s+trap\b|\bno\s+drill\b/.test(lower)) exclusions.push("hip_hop");
  if (/\bno\s+metal\b/.test(lower)) exclusions.push("metal");
  if (/\bno\s+country\b/.test(lower)) exclusions.push("country");
  if (/\bno\s+pop\b/.test(lower)) exclusions.push("pop");
  if (/\bno\s+edm\b|\bno\s+techno\b/.test(lower)) exclusions.push("electronic");
  return [...new Set(exclusions)];
}

export function extractCulturalRefs(text: string): string[] {
  const legacy = CULTURAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ ref }) => ref);
  const expansion = expandCulturalReferences(text);
  return [...new Set([...legacy, ...expansion.matchedIds, ...expansion.culturalRefs])];
}

function collectMatchedSpans(prompt: string): Set<string> {
  const lower = prompt.toLowerCase();
  const matched = new Set<string>();
  const mark = (term: string) => { if (term.length >= 2) matched.add(term.toLowerCase()); };

  for (const [key, terms] of Object.entries(EXPANDED_MOOD_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_ACTIVITY_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_PLACE_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    mark(key);
  }
  for (const [key, terms] of Object.entries(EXPANDED_TIME_TERMS)) {
    for (const term of terms) if (termRegex([term]).test(lower)) mark(term);
    mark(key);
  }
  for (const era of EXPANDED_ERA_TERMS) {
    for (const term of era.terms) if (termRegex([term]).test(lower)) mark(term);
    mark(era.label);
  }
  for (const group of EXPANDED_GENRE_ALIASES) {
    for (const term of group.terms) if (termRegex([term]).test(lower)) mark(term);
    mark(group.family);
  }
  for (const entry of CULTURAL_PATTERNS) {
    if (entry.pattern.test(lower)) {
      mark(entry.ref);
      mark(entry.scene);
    }
  }
  const expansion = expandCulturalReferences(prompt);
  for (const id of expansion.matchedIds) mark(id);
  for (const tag of expansion.culturalTags) mark(tag);
  for (const theme of expansion.themes) mark(theme);
  if (expansion.sceneId) mark(expansion.sceneId);
  const era = detectEra(prompt);
  if (era.decade) mark(era.decade);

  return matched;
}

export function isKnownToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (STOPWORDS.has(lower) || /^\d+$/.test(lower)) return true;
  if (KNOWN_TOKEN_ROOTS.has(lower)) return true;
  for (const root of KNOWN_TOKEN_ROOTS) {
    if (lower.includes(root) || root.includes(lower)) return true;
  }
  return false;
}

function computeIntentConfidence(signals: {
  scene: string | null;
  emotion: string | null;
  energy: "low" | "medium" | "high" | null;
  culturalRefs: string[];
  unknownTokens: string[];
}): number {
  const richness =
    (signals.scene ? 0.22 : 0) +
    (signals.emotion ? 0.18 : 0) +
    (signals.energy ? 0.12 : 0) +
    (signals.culturalRefs.length > 0 ? 0.2 : 0);
  const contentTokens = signals.unknownTokens.length + (richness > 0 ? 4 : 1);
  const coverage = 1 - signals.unknownTokens.length / Math.max(1, contentTokens);
  return round2(clamp01(richness + coverage * 0.35));
}

export function decomposeIntent(prompt: string): DecomposedIntent {
  const raw = prompt.trim();
  const lower = raw.toLowerCase();
  if (!raw) {
    return {
      raw,
      scene: null,
      emotion: null,
      energy: null,
      exclusions: [],
      culturalRefs: [],
      inferredActivity: null,
      unknownTokens: [],
      confidence: 0.1,
    };
  }

  const locked = buildLockedIntent(raw);
  const culturalRefs = extractCulturalRefs(raw);
  const scene = matchScene(lower) ?? (culturalRefs.length > 0 ? matchScene(lower) : null);
  const emotion = matchEmotion(lower) ?? locked.mood[0] ?? null;
  const energy = matchEnergy(lower) ?? locked.energy ?? null;
  const exclusions = extractExclusions(lower);
  const inferredActivity = matchActivity(lower) ?? locked.activity ?? null;

  const matched = collectMatchedSpans(raw);
  const unknownTokens = [...new Set(
    tokenize(lower)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .filter((t) => !isKnownToken(t))
      .filter((t) => !matched.has(t) && ![...matched].some((span) => span.includes(t) || t.includes(span))),
  )].slice(0, 12);

  const confidence = computeIntentConfidence({
    scene,
    emotion,
    energy,
    culturalRefs,
    unknownTokens,
  });

  return {
    raw,
    scene,
    emotion,
    energy,
    exclusions,
    culturalRefs,
    inferredActivity,
    unknownTokens,
    confidence,
  };
}
