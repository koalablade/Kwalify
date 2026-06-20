/**
 * Music semantic compatibility scoring — narrative/cinematic/context/cultural alignment.
 */

import type { MusicSemanticConstraints, MusicSemanticProfile } from "./music-semantic-types";
import { isRichMusicSemanticPrompt } from "./scene-music-alignment";

export type MusicSemanticMatchDiagnostics = {
  narrativeAlignment: number;
  cinematicAlignment: number;
  contextAlignment: number;
  culturalResonance: number;
  textureAlignment: number;
  spatialAlignment: number;
  rhythmAlignment: number;
  movementAlignment: number;
  arcAlignment: number;
  intensityAlignment: number;
  sceneAffinityScore: number;
  focusCollapsePenalty: number;
  genreMonotonePenalty: number;
  totalBoost: number;
};

function enumOverlap<T extends string>(expected: T[], actual: T | T[]): number {
  if (expected.length === 0) return 0;
  const actualSet = new Set(Array.isArray(actual) ? actual : [actual]);
  const hits = expected.filter((e) => actualSet.has(e)).length;
  return hits / expected.length;
}

function textureDescriptorOverlap(expected: string[], music: MusicSemanticProfile): number {
  if (expected.length === 0) return 0;
  const trackDescriptors = new Set([
    ...music.sonicTexture.descriptors,
    music.sonicTexture.grain,
    music.sonicTexture.warmth,
    music.sonicTexture.density,
  ]);
  return expected.filter((d) => trackDescriptors.has(d)).length / expected.length;
}

function tagRecall(promptTags: string[], trackTags: string[]): number {
  if (promptTags.length === 0) return 0;
  const set = new Set(trackTags);
  return promptTags.filter((t) => set.has(t)).length / promptTags.length;
}

function tagOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const recall = tagRecall(a, b);
  const setA = new Set(a);
  const precision = b.filter((x) => setA.has(x)).length / b.length;
  return recall * 0.72 + precision * 0.28;
}

function sceneAffinityScore(
  constraints: Record<string, number>,
  profile: Record<string, number>,
): number {
  const keys = Object.keys(constraints);
  if (keys.length === 0) return 0;
  let sum = 0;
  for (const key of keys) {
    sum += (profile[key] ?? 0) * (constraints[key] ?? 0);
  }
  return Math.min(1, sum);
}

/** Prefer broken-beat urban texture over pure ambient drift on nocturnal city prompts. */
function nocturnalUrbanDiscrimination(
  constraints: MusicSemanticConstraints,
  music: MusicSemanticProfile,
): number {
  const nocturnalUrban =
    constraints.temporalFeeling.some((t) => t.includes("night"))
    && constraints.culturalTags.some(
      (t) => t.includes("urban-nightlife") || t.includes("broken-beat") || t.includes("uk-electronic"),
    );
  if (!nocturnalUrban) return 0;

  let delta = 0;
  if (
    music.culturalContextTags.includes("broken-beat")
    || music.culturalContextTags.includes("uk-electronic-scene")
  ) {
    delta += 0.12;
  }
  if (music.culturalContextTags.includes("ambient-scene") && music.rhythmicComplexity === "minimal") {
    delta -= 0.1;
  }
  return delta;
}

function arcAlignment(
  roles: MusicSemanticConstraints["emotionalArcRoles"],
  trackRole: MusicSemanticProfile["emotionalArcRole"],
): number {
  if (roles.length === 0 || !trackRole) return 0;
  return roles.includes(trackRole) ? 1 : 0.35;
}

function intensityAlignment(
  curves: MusicSemanticConstraints["intensityCurves"],
  trackCurve: MusicSemanticProfile["intensityCurve"],
): number {
  if (curves.length === 0) return 0;
  return curves.includes(trackCurve) ? 1 : trackCurve === "variable" ? 0.55 : 0.25;
}

/** Penalize generic focus-adjacent tracks when scene demands narrative/cinematic feel. */
function focusCollapsePenalty(
  constraints: MusicSemanticConstraints,
  music: MusicSemanticProfile,
): number {
  if (!isRichMusicSemanticPrompt(constraints)) return 0;
  const onlyFocus =
    music.situationalTags.length <= 2
    && music.situationalTags.every((t) => t === "focus-adjacent" || t === "background-listening")
    && music.narrativeTags.length === 0
    && music.cinematicTags.length === 0;
  if (onlyFocus) return 0.12;
  const hasNarrativeOrCinematic =
    music.narrativeTags.length > 0 || music.cinematicTags.length > 0;
  const hasDeepSemanticDepth =
    music.culturalContextTags.length >= 2
    || music.sonicTexture.descriptors.length >= 2
    || music.emotionalMovement === "pulse";
  if (isRichMusicSemanticPrompt(constraints) && !hasNarrativeOrCinematic && !hasDeepSemanticDepth) return 0.06;
  return 0;
}

/** Penalize tracks with no semantic depth when prompt is rich. */
function genreMonotonePenalty(
  constraints: MusicSemanticConstraints,
  music: MusicSemanticProfile,
): number {
  if (!isRichMusicSemanticPrompt(constraints)) return 0;
  const depth =
    music.narrativeTags.length +
    music.cinematicTags.length +
    music.culturalTags.length +
    music.situationalTags.length;
  if (depth <= 1) return 0.08;
  return 0;
}

export function scoreMusicSemanticCompatibility(
  constraints: MusicSemanticConstraints,
  music: MusicSemanticProfile,
  opts: { maxBoost?: number } = {},
): { boost: number; diagnostics: MusicSemanticMatchDiagnostics } {
  const narrativeAlignment = tagOverlap(constraints.narrativeTags, music.narrativeTags);
  const cinematicAlignment = tagOverlap(constraints.cinematicTags, music.cinematicTags);
  const contextAlignment = tagOverlap(
    [...constraints.situationalTags, ...constraints.temporalFeeling],
    [...music.situationalTags, ...music.temporalFeeling],
  );
  const culturalResonance = tagOverlap(
    constraints.culturalTags,
    [...music.culturalContextTags, ...music.culturalTags],
  );
  const textureAlignment = textureDescriptorOverlap(constraints.textureDescriptors, music);
  const spatialAlignment = enumOverlap(constraints.spatialFeel, music.spatialFeel);
  const rhythmAlignment = enumOverlap(constraints.rhythmicComplexity, music.rhythmicComplexity);
  const movementAlignment = enumOverlap(constraints.emotionalMovement, music.emotionalMovement);
  const arc = arcAlignment(constraints.emotionalArcRoles, music.emotionalArcRole);
  const intensity = intensityAlignment(constraints.intensityCurves, music.intensityCurve);
  const affinity = sceneAffinityScore(
    constraints.sceneAffinityVectors,
    music.sceneCompatibilityVectors ?? music.sceneAffinityVectors,
  );

  const focusPenalty = focusCollapsePenalty(constraints, music);
  const monotonePenalty = genreMonotonePenalty(constraints, music);

  const raw =
    narrativeAlignment * 0.18 +
    cinematicAlignment * 0.14 +
    contextAlignment * 0.12 +
    culturalResonance * 0.12 +
    textureAlignment * 0.14 +
    spatialAlignment * 0.1 +
    rhythmAlignment * 0.08 +
    movementAlignment * 0.06 +
    arc * 0.04 +
    intensity * 0.04 +
    affinity * 0.08 -
    focusPenalty -
    monotonePenalty +
    nocturnalUrbanDiscrimination(constraints, music);

  const cap = opts.maxBoost ?? (isRichMusicSemanticPrompt(constraints) ? 0.22 : 0.14);
  const boost = Math.max(0, Math.min(cap, raw * cap));

  return {
    boost,
    diagnostics: {
      narrativeAlignment: Math.round(narrativeAlignment * 1000) / 1000,
      cinematicAlignment: Math.round(cinematicAlignment * 1000) / 1000,
      contextAlignment: Math.round(contextAlignment * 1000) / 1000,
      culturalResonance: Math.round(culturalResonance * 1000) / 1000,
      textureAlignment: Math.round(textureAlignment * 1000) / 1000,
      spatialAlignment: Math.round(spatialAlignment * 1000) / 1000,
      rhythmAlignment: Math.round(rhythmAlignment * 1000) / 1000,
      movementAlignment: Math.round(movementAlignment * 1000) / 1000,
      arcAlignment: Math.round(arc * 1000) / 1000,
      intensityAlignment: Math.round(intensity * 1000) / 1000,
      sceneAffinityScore: Math.round(affinity * 1000) / 1000,
      focusCollapsePenalty: Math.round(focusPenalty * 1000) / 1000,
      genreMonotonePenalty: Math.round(monotonePenalty * 1000) / 1000,
      totalBoost: Math.round(boost * 1000) / 1000,
    },
  };
}

export function musicSemanticSurvivalMetrics(
  constraints: MusicSemanticConstraints,
  tracks: Array<{ music: MusicSemanticProfile }>,
): {
  narrativeSurvivalPercent: number;
  cinematicSurvivalPercent: number;
  contextSurvivalPercent: number;
  signature: string;
  avgBoost: number;
} {
  if (tracks.length === 0) {
    return {
      narrativeSurvivalPercent: 0,
      cinematicSurvivalPercent: 0,
      contextSurvivalPercent: 0,
      signature: constraints.constraintSignature,
      avgBoost: 0,
    };
  }
  const scores = tracks.map((t) => scoreMusicSemanticCompatibility(constraints, t.music).diagnostics);
  const narrativeHits = scores.filter((s) => s.narrativeAlignment >= 0.2).length;
  const cinematicHits = scores.filter((s) => s.cinematicAlignment >= 0.2).length;
  const contextHits = scores.filter((s) => s.contextAlignment >= 0.2).length;
  const avgBoost = scores.reduce((sum, s) => sum + s.totalBoost, 0) / scores.length;

  return {
    narrativeSurvivalPercent: Math.round((narrativeHits / tracks.length) * 100),
    cinematicSurvivalPercent: Math.round((cinematicHits / tracks.length) * 100),
    contextSurvivalPercent: Math.round((contextHits / tracks.length) * 100),
    signature: constraints.constraintSignature,
    avgBoost: Math.round(avgBoost * 1000) / 1000,
  };
}
