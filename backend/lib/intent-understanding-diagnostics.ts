/**
 * Intent Understanding Diagnostics — exposes what the parser recognized,
 * what it ignored, assumptions made, and scene/genre predictions.
 */

import { buildLockedIntent, type LockedIntent } from "../core/v3/intent";
import type { EmotionProfile } from "./emotion";
import { interpretSemantics } from "./semantic-interpreter";
import { resolveSemanticScene, resolveSceneDistribution } from "./semantic-scene-engine";
import { detectTimeOfDay, detectEnvironment, detectMotionState } from "./emotion-scene-layers";
import { detectEra } from "./era-detection";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_ERA_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "./expanded-intent-vocabulary";

export type RecognizedConcepts = {
  activity: string[];
  atmosphere: string[];
  emotion: string[];
  time: string[];
  place: string[];
  genre: string[];
  era: string[];
};

export type IntentUnderstandingDiagnostics = {
  prompt: string;
  recognizedConcepts: RecognizedConcepts;
  unrecognizedTerms: string[];
  assumptions: string[];
  scenePrediction: Record<string, number>;
  confidence: number;
  semanticSummary: string | null;
  primaryCluster: string | null;
  weakMatch: boolean;
};

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but",
  "my", "me", "i", "we", "you", "with", "from", "is", "it", "this", "that",
  "want", "need", "music", "songs", "song", "tracks", "track", "playlist",
  "please", "pls", "some", "like", "feel", "feeling", "vibe", "vibes", "make",
  "give", "get", "be", "am", "im", "i'm", "its", "it's", "not", "no", "just",
  "really", "very", "something", "anything", "while", "when", "where", "who",
]);

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

  for (const [mood, terms] of Object.entries(EXPANDED_MOOD_TERMS)) {
    for (const term of terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    if (termRegex([mood]).test(lower)) mark(mood);
  }

  for (const [activity, terms] of Object.entries(EXPANDED_ACTIVITY_TERMS)) {
    for (const term of terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    if (termRegex([activity]).test(lower)) mark(activity);
  }

  for (const [place, terms] of Object.entries(EXPANDED_PLACE_TERMS)) {
    for (const term of terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    if (termRegex([place]).test(lower)) mark(place);
  }

  for (const [time, terms] of Object.entries(EXPANDED_TIME_TERMS)) {
    for (const term of terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    if (termRegex([time]).test(lower)) mark(time);
  }

  for (const eraEntry of EXPANDED_ERA_TERMS) {
    for (const term of eraEntry.terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    if (termRegex([eraEntry.label]).test(lower)) mark(eraEntry.label);
  }

  for (const group of EXPANDED_GENRE_ALIASES) {
    for (const term of group.terms) {
      if (termRegex([term]).test(lower)) mark(term);
    }
    mark(group.family);
  }

  const structuralPatterns: Array<[RegExp, string]> = [
    [/\b(?:fix(?:ing)?|work(?:ing)?)\s+(?:on\s+)?(?:a\s+)?(?:car|cars|motor|engine)\b/i, "garage work"],
    [/\b(?:rainy|rain|drizzle|drizzling|wet)\b/i, "rainy"],
    [/\b(?:alone|lonely|solitary|by myself)\b/i, "solitary"],
    [/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, "weekday"],
    [/\b(?:garage|workshop|shed)\b/i, "garage"],
    [/\b(?:driv(?:e|ing)|road trip|cruise|highway|motorway)\b/i, "driving"],
    [/\b(?:gym|workout|lifting|training)\b/i, "gym"],
    [/\b(?:study|focus|coding|deep work)\b/i, "focus"],
    [/\b(?:party|club|dance)\b/i, "party"],
    [/\b(?:breakup|break up|heartbreak)\b/i, "heartbreak"],
    [/\b(?:nostalg|throwback|retro)\b/i, "nostalgic"],
    [/\b(?:kerrang|nu metal|pop punk|emo|post.?hardcore)\b/i, "alt rock scene"],
  ];
  for (const [pattern, label] of structuralPatterns) {
    if (pattern.test(lower)) mark(label);
  }

  const time = detectTimeOfDay(lower);
  if (time) mark(time);
  const place = detectEnvironment(lower);
  if (place) mark(place);
  const motion = detectMotionState(lower);
  if (motion) mark(motion);

  const era = detectEra(prompt);
  if (era?.decade) mark(era.decade);

  return matched;
}

function tokenCoveredByMatches(token: string, matched: Set<string>): boolean {
  const lower = token.toLowerCase();
  if (matched.has(lower)) return true;
  for (const span of matched) {
    if (span.includes(lower) || lower.includes(span)) return true;
  }
  return false;
}

function buildRecognizedConcepts(
  lockedIntent: LockedIntent,
  profile: EmotionProfile,
  semantic: ReturnType<typeof interpretSemantics>,
): RecognizedConcepts {
  const atmosphere: string[] = [];
  if (profile.environment) atmosphere.push(profile.environment.replace(/_/g, " "));
  if (semantic.aestheticTags.length) atmosphere.push(...semantic.aestheticTags.slice(0, 4));
  if (lockedIntent.mood.includes("melancholic")) atmosphere.push("rainy", "introspective");
  if (lockedIntent.mood.includes("calm")) atmosphere.push("calm");

  const emotion: string[] = [...lockedIntent.mood];
  if (semantic.primaryCluster) emotion.push(semantic.primaryCluster.replace(/_/g, " "));
  if (profile.valence < 0.42) emotion.push("melancholic");
  if (profile.calm > 0.55) emotion.push("calm");

  const time: string[] = [];
  if (profile.timeOfDay) time.push(profile.timeOfDay.replace(/_/g, " "));
  if (lockedIntent.eraRange) {
    time.push(`${lockedIntent.eraRange.start}s`);
  }

  const place: string[] = [];
  if (profile.environment) place.push(profile.environment.replace(/_/g, " "));
  if (semantic.sceneContext.environment) place.push(semantic.sceneContext.environment);

  const activity: string[] = [];
  if (lockedIntent.activity) activity.push(lockedIntent.activity.replace(/_/g, " "));
  if (semantic.sceneContext.motionState) activity.push(semantic.sceneContext.motionState.replace(/_/g, " "));

  const genre = [
    ...lockedIntent.genreFamilies,
    lockedIntent.primaryGenre,
    lockedIntent.primarySubgenre,
    ...lockedIntent.subgenreTerms,
  ].filter((value): value is string => !!value);

  const era: string[] = [];
  if (lockedIntent.eraRange) {
    era.push(`${lockedIntent.eraRange.start}–${lockedIntent.eraRange.end}`);
  }

  const dedupe = (values: string[]): string[] =>
    [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, 8);

  return {
    activity: dedupe(activity),
    atmosphere: dedupe(atmosphere),
    emotion: dedupe(emotion),
    time: dedupe(time),
    place: dedupe(place),
    genre: dedupe(genre),
    era: dedupe(era),
  };
}

function buildAssumptions(
  prompt: string,
  lockedIntent: LockedIntent,
  semantic: ReturnType<typeof interpretSemantics>,
  sceneResolution: ReturnType<typeof resolveSemanticScene>,
): string[] {
  const assumptions: string[] = [];
  const lower = prompt.toLowerCase();

  if (/\b(?:garage|workshop|fix(?:ing)?|mechanic)\b/i.test(lower) && lockedIntent.activity) {
    assumptions.push(`${lockedIntent.activity} -> workshop focus`);
  }
  if (/\b(?:rainy|rain|drizzle)\b/i.test(lower) && lockedIntent.mood.includes("melancholic")) {
    assumptions.push("rainy -> introspective");
  }
  if (/\b(?:alone|lonely|solitary)\b/i.test(lower)) {
    assumptions.push("solitary -> low-energy introspective");
  }
  if (semantic.confidence < 0.35 && semantic.primaryCluster) {
    assumptions.push(`weak semantic match -> ${semantic.primaryCluster.replace(/_/g, " ")}`);
  }
  if (sceneResolution.matchedId && sceneResolution.confidence < 0.5) {
    assumptions.push(
      `scene guess -> ${sceneResolution.vector?.label ?? sceneResolution.matchedId}`,
    );
  }
  if (lockedIntent.genreFamilies.length === 0 && sceneResolution.vector?.genreEcosystem?.length) {
    const top = sceneResolution.vector.genreEcosystem
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((g) => g.genre)
      .join(" + ");
    if (top) assumptions.push(`no explicit genre -> inferred ${top}`);
  }
  if (lockedIntent.energy) {
    assumptions.push(`energy level -> ${lockedIntent.energy}`);
  }

  return [...new Set(assumptions)].slice(0, 12);
}

function buildScenePrediction(
  vibe: string,
  profile: EmotionProfile,
  lockedIntent: LockedIntent,
): Record<string, number> {
  const distribution = resolveSceneDistribution(vibe, profile);
  const sceneWeights: Record<string, number> = {};
  for (const entry of distribution) {
    sceneWeights[entry.sceneId] = round2(entry.weight);
  }

  const resolution = resolveSemanticScene(vibe, profile);
  const genres = resolution.vector?.genreEcosystem ?? [];
  const genreWeights: Record<string, number> = {};
  for (const item of genres.slice(0, 6)) {
    genreWeights[item.genre] = round2(item.weight);
  }

  if (lockedIntent.genreFamilies.length > 0) {
    for (const family of lockedIntent.genreFamilies) {
      genreWeights[family] = round2((genreWeights[family] ?? 0) + 0.25);
    }
  }

  const combined = { ...genreWeights, ...sceneWeights };
  const entries = Object.entries(combined).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return Object.fromEntries(entries.map(([key, weight]) => [key, round2(weight / total)]));
}

function computeUnderstandingConfidence(
  prompt: string,
  recognized: RecognizedConcepts,
  unrecognizedTerms: string[],
  semanticConfidence: number,
): number {
  const tokens = tokenize(prompt).filter((t) => !STOPWORDS.has(t) && t.length > 1);
  const recognizedCount = tokens.filter((token) => !unrecognizedTerms.includes(token)).length;
  const coverage = tokens.length > 0 ? recognizedCount / tokens.length : 0.5;
  const conceptRichness = [
    recognized.activity,
    recognized.atmosphere,
    recognized.emotion,
    recognized.time,
    recognized.place,
    recognized.genre,
  ].filter((group) => group.length > 0).length / 6;

  return round2(clamp01(coverage * 0.45 + semanticConfidence * 0.35 + conceptRichness * 0.20));
}

export function buildIntentUnderstandingDiagnostics(opts: {
  prompt: string;
  profile: EmotionProfile;
  lockedIntent?: LockedIntent;
}): IntentUnderstandingDiagnostics {
  const prompt = opts.prompt.trim();
  const lockedIntent = opts.lockedIntent ?? buildLockedIntent(prompt);
  const semantic = interpretSemantics(prompt);
  const sceneResolution = resolveSemanticScene(prompt, opts.profile);
  const matchedSpans = collectMatchedSpans(prompt);

  const tokens = tokenize(prompt);
  const unrecognizedTerms = [...new Set(
    tokens
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
      .filter((token) => !tokenCoveredByMatches(token, matchedSpans))
      .filter((token) => !/^\d+$/.test(token)),
  )].slice(0, 12);

  const recognizedConcepts = buildRecognizedConcepts(lockedIntent, opts.profile, semantic);
  const assumptions = buildAssumptions(prompt, lockedIntent, semantic, sceneResolution);
  const scenePrediction = buildScenePrediction(prompt, opts.profile, lockedIntent);
  const confidence = computeUnderstandingConfidence(
    prompt,
    recognizedConcepts,
    unrecognizedTerms,
    semantic.confidence,
  );

  return {
    prompt,
    recognizedConcepts,
    unrecognizedTerms,
    assumptions,
    scenePrediction,
    confidence,
    semanticSummary: semantic.summary || null,
    primaryCluster: semantic.primaryCluster || null,
    weakMatch: semantic.confidence < 0.2,
  };
}
