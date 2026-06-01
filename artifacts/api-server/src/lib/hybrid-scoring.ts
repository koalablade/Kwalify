/**
 * Hybrid scoring — scene-first, normalized layers, hard filters, debug output.
 *
 * Order: scene > intent > emotion > memory > genre > novelty
 */

import type { EmotionProfile } from "./emotion";
import { scoreSong, type VibeKind } from "./emotion";
import type { IntentDecodeResult, HumanIntent } from "./intent-decoder";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { ScenePrototype } from "./scene-prototypes";
import { buildSceneSeasonContext, inferTrackSeasonTags, seasonalMatchScore } from "./seasonal-logic";
import { inferTrackGenreHintsFromSignals, genreMatchScore } from "./genre-expansion-map";
import { resolveSceneContext, sceneMatchScore, type SceneContext } from "./scene-validation";
import { applyHardFilters, type HardFilterContext } from "./hard-filters";
import { sonicFitBonus } from "./scene-sonic-profile";
import type { SonicProfile } from "./scene-sonic-map";

const LAYER_WEIGHTS = {
  scene: 0.35,
  emotion: 0.3,
  genre: 0.2,
  memory: 0.1,
  novelty: 0.05,
} as const;

const MAX_LAYER_INFLUENCE = 0.4;

export interface TrackScoringDebug {
  trackId: string;
  sceneMatch: number;
  emotionMatch: number;
  genreMatch: number;
  memoryMatch: number;
  noveltyScore: number;
  seasonalMatch: number;
  moodPurity: number;
  excludedBy: string | null;
  finalScore: number;
}

export interface HybridScoringContext {
  vibe: string;
  profile: EmotionProfile;
  intent: IntentDecodeResult;
  canonical: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  sonicProfile: SonicProfile | null;
  vibeKind: VibeKind;
  scene: SceneContext;
  season: ReturnType<typeof buildSceneSeasonContext>;
  hardFilter: Omit<HardFilterContext, "vibe"> & { vibe: string };
  contrastAllowance: number;
  emotionalComplexity: boolean;
}

export function buildHybridScoringContext(opts: {
  vibe: string;
  profile: EmotionProfile;
  intent: IntentDecodeResult;
  canonical: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  sonicProfile: SonicProfile | null;
  vibeKind: VibeKind;
  experienceSeason?: string | null;
}): HybridScoringContext {
  const scene = resolveSceneContext(opts.vibe, opts.canonical, opts.profile, opts.experienceSeason);
  const season = buildSceneSeasonContext(opts.vibe, opts.experienceSeason);
  const emotionalComplexity =
    /\b(but|yet|although|sad but|happy but|lonely but|complex|contradict)\b/i.test(opts.vibe);

  const contrastAllowance = computeContrastAllowance(
    opts.intent.intent,
    scene.primary,
    opts.vibeKind,
    emotionalComplexity
  );

  return {
    vibe: opts.vibe,
    profile: opts.profile,
    intent: opts.intent,
    canonical: opts.canonical,
    prototype: opts.prototype,
    sonicProfile: opts.sonicProfile,
    vibeKind: opts.vibeKind,
    scene,
    season,
    contrastAllowance,
    emotionalComplexity,
    hardFilter: {
      vibe: opts.vibe,
      intent: opts.intent.intent,
      sceneFamily: scene.primary,
      season,
      prototype: opts.prototype,
      allowContrast: contrastAllowance > 0.08,
      allowEnergyMismatch: opts.intent.scoringOverrides.allowEnergyMismatch,
      emotionalComplexity,
      vibeKind: opts.vibeKind,
    },
  };
}

function computeContrastAllowance(
  intent: HumanIntent,
  sceneFamily: string,
  vibeKind: VibeKind,
  emotionalComplexity: boolean
): number {
  if (emotionalComplexity) return 0.12;
  if (intent === "emotional_processing" || intent === "heal") return 0.1;
  if (vibeKind === "sunny" || sceneFamily === "sun_day") return 0.05;
  if (intent === "energise") return 0.08;
  return 0.06;
}

/** Mood purity — high = one dominant emotional direction */
export function computeMoodPurity(track: {
  energy: number | null;
  valence: number | null;
}): number {
  const v = track.valence ?? 0.5;
  const e = track.energy ?? 0.5;
  const happy = Math.max(0, (v - 0.5) * 2) * Math.max(0.3, e);
  const sad = Math.max(0, (0.5 - v) * 2) * Math.max(0.3, 1 - e);
  const hyped = Math.max(0, (e - 0.5) * 2) * Math.max(0.3, v);
  const spread = happy + sad + hyped + 0.01;
  const dominant = Math.max(happy, sad, hyped);
  return dominant / spread;
}

function percentileNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((x) => x <= v).length;
    return rank / sorted.length;
  });
}

function capLayerContribution(layer: number, weight: number): number {
  const raw = layer * weight;
  return Math.min(raw, MAX_LAYER_INFLUENCE);
}

export interface ScoredTrackLayers {
  sceneMatch: number;
  emotionMatch: number;
  genreMatch: number;
  memoryMatch: number;
  noveltyScore: number;
  seasonalMatch: number;
  moodPurity: number;
}

export function computeTrackLayers(
  track: {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    energy: number | null;
    valence: number | null;
    tempo: number | null;
    danceability: number | null;
    acousticness: number | null;
  },
  ctx: HybridScoringContext,
  mode: "strict" | "balanced" | "chaotic",
  memoryMatch: number,
  noveltyScore: number
): ScoredTrackLayers {
  const sceneMatch = sceneMatchScore(ctx.scene, ctx.profile, track);
  const emotionMatch = scoreSong(
    track,
    ctx.profile,
    mode,
    ctx.vibeKind
  );
  const genreHints = inferTrackGenreHintsFromSignals(track, {
    acousticness: track.acousticness,
    energy: track.energy,
  });
  const genreMatch = genreMatchScore({
    vibe: ctx.vibe,
    sceneFamily: ctx.scene.primary,
    profile: ctx.profile,
    intent: ctx.intent.intent,
    hints: genreHints,
  });
  const seasonalMatch = seasonalMatchScore(ctx.season, inferTrackSeasonTags(track));
  const moodPurity = computeMoodPurity(track);

  let sceneAdj = sceneMatch * 0.85 + seasonalMatch * 0.15;
  if (ctx.sonicProfile) {
    sceneAdj = sceneAdj * 0.75 + Math.min(1, sonicFitBonus(track, ctx.sonicProfile) * 4) * 0.25;
  }

  let emotionAdj = emotionMatch;
  if (!ctx.emotionalComplexity && moodPurity < 0.42 && ctx.scene.primary !== "memory_nostalgia") {
    emotionAdj *= 0.88;
  }

  return {
    sceneMatch: sceneAdj,
    emotionMatch: emotionAdj,
    genreMatch,
    memoryMatch,
    noveltyScore,
    seasonalMatch,
    moodPurity,
  };
}

export function combineHybridScore(
  normalized: ScoredTrackLayers,
  ctx: HybridScoringContext,
  rediscoveryScore: number
): number {
  let base =
    capLayerContribution(normalized.sceneMatch, LAYER_WEIGHTS.scene) +
    capLayerContribution(normalized.emotionMatch, LAYER_WEIGHTS.emotion) +
    capLayerContribution(normalized.genreMatch, LAYER_WEIGHTS.genre) +
    capLayerContribution(normalized.memoryMatch, LAYER_WEIGHTS.memory) +
    capLayerContribution(normalized.noveltyScore, LAYER_WEIGHTS.novelty);

  if (ctx.intent.intent === "nostalgia") {
    base += normalized.memoryMatch * 0.08;
    base += rediscoveryScore * 0.06;
  }
  if (ctx.intent.intent === "energise") {
    base += normalized.emotionMatch * 0.06;
  }
  if (ctx.scene.primary === "sun_day" || ctx.vibeKind === "sunny") {
    base += normalized.genreMatch * 0.04;
  }
  if (ctx.scene.primary === "travel_driving" && normalized.genreMatch > 0.6) {
    base += 0.05;
  }

  return Math.max(0, Math.min(1.2, base));
}

export interface HybridScoreResult<T> {
  track: T;
  score: number;
  debug: TrackScoringDebug;
  passed: boolean;
}

export function scoreLibraryHybrid<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}>(
  tracks: T[],
  ctx: HybridScoringContext,
  mode: "strict" | "balanced" | "chaotic",
  memoryByTrack: (trackId: string) => number,
  noveltyByTrack: (trackId: string) => number
): { results: HybridScoreResult<T>[]; excluded: TrackScoringDebug[] } {
  const passed: { track: T; layers: ScoredTrackLayers }[] = [];
  const excluded: TrackScoringDebug[] = [];

  for (const track of tracks) {
    const hard = applyHardFilters(track, ctx.hardFilter);
    if (!hard.pass) {
      excluded.push({
        trackId: track.trackId,
        sceneMatch: 0,
        emotionMatch: 0,
        genreMatch: 0,
        memoryMatch: 0,
        noveltyScore: 0,
        seasonalMatch: 0,
        moodPurity: 0,
        excludedBy: hard.excludedBy,
        finalScore: 0,
      });
      continue;
    }

    const layers = computeTrackLayers(
      track,
      ctx,
      mode,
      memoryByTrack(track.trackId),
      noveltyByTrack(track.trackId)
    );
    passed.push({ track, layers });
  }

  const sceneNorm = percentileNormalize(passed.map((p) => p.layers.sceneMatch));
  const emotionNorm = percentileNormalize(passed.map((p) => p.layers.emotionMatch));
  const genreNorm = percentileNormalize(passed.map((p) => p.layers.genreMatch));
  const memoryNorm = percentileNormalize(passed.map((p) => p.layers.memoryMatch));
  const noveltyNorm = percentileNormalize(passed.map((p) => p.layers.noveltyScore));

  const results: HybridScoreResult<T>[] = passed.map((p, i) => {
    const normalized: ScoredTrackLayers = {
      ...p.layers,
      sceneMatch: sceneNorm[i] ?? p.layers.sceneMatch,
      emotionMatch: emotionNorm[i] ?? p.layers.emotionMatch,
      genreMatch: genreNorm[i] ?? p.layers.genreMatch,
      memoryMatch: memoryNorm[i] ?? p.layers.memoryMatch,
      noveltyScore: noveltyNorm[i] ?? p.layers.noveltyScore,
    };

    const rediscovery = memoryByTrack(p.track.trackId);
    const finalScore = combineHybridScore(normalized, ctx, rediscovery);

    return {
      track: p.track,
      score: finalScore,
      passed: true,
      debug: {
        trackId: p.track.trackId,
        sceneMatch: Math.round(normalized.sceneMatch * 1000) / 1000,
        emotionMatch: Math.round(normalized.emotionMatch * 1000) / 1000,
        genreMatch: Math.round(normalized.genreMatch * 1000) / 1000,
        memoryMatch: Math.round(normalized.memoryMatch * 1000) / 1000,
        noveltyScore: Math.round(normalized.noveltyScore * 1000) / 1000,
        seasonalMatch: Math.round(p.layers.seasonalMatch * 1000) / 1000,
        moodPurity: Math.round(p.layers.moodPurity * 1000) / 1000,
        excludedBy: null,
        finalScore: Math.round(finalScore * 1000) / 1000,
      },
    };
  });

  return { results, excluded };
}

export function buildScoringDiagnostics(
  results: HybridScoreResult<unknown>[],
  excluded: TrackScoringDebug[],
  ctx: HybridScoringContext,
  limit = 20
): Record<string, unknown> {
  const top = [...results].sort((a, b) => b.score - a.score).slice(0, limit);
  const leakSamples = excluded
    .filter((e) => e.excludedBy?.includes("christmas") || e.excludedBy?.includes("seasonal"))
    .slice(0, 8);

  return {
    sceneFamily: ctx.scene.primary,
    secondaryScene: ctx.scene.secondary,
    contrastAllowance: ctx.contrastAllowance,
    excludedCount: excluded.length,
    exclusionReasons: countBy(excluded.map((e) => e.excludedBy ?? "unknown")),
    topScored: top.map((r) => r.debug),
    seasonalExclusionsSample: leakSamples,
  };
}

function countBy(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}
