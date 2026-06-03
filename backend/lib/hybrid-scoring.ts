/**
 * Hybrid scoring — genre backbone + scene modulation.
 *
 * finalScore = scene×0.45 + libraryFit×0.35 + genreBalance×0.20
 * Genre lock prevents scene from overriding confident taxonomy.
 *
 * Orchestrated via `core/scoring-engine` — do not add parallel scoring paths here.
 */

import type { EmotionProfile } from "./emotion";
import { scoreSong, type VibeKind } from "./emotion";
import type { IntentDecodeResult, HumanIntent } from "./intent-decoder";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import { getPrototype, type ScenePrototype } from "./scene-prototypes";
import { buildSceneSeasonContext, inferTrackSeasonTags, seasonalMatchScore } from "./seasonal-logic";
import {
  resolveSceneContext,
  sceneMatchScore,
  toSceneAudioTrack,
  type SceneContext,
} from "./scene-validation";
import { applyHardFilters, type HardFilterContext } from "./hard-filters";
import { sonicFitBonus } from "./scene-sonic-profile";
import type { SonicProfile } from "./scene-sonic-map";
import {
  classifyTrack,
  genreLockWeight,
  isGenreLocked,
  type TrackGenreClassification,
} from "./genre-taxonomy";
import {
  computeGenreSignature,
  signatureSceneAffinity,
} from "./genre-signature";
import {
  buildUserGenreProfile,
  libraryFitScore,
  type UserGenreProfile,
} from "./user-genre-profile";
import { genreFallbackScore, pickFallbackGenres } from "./anti-generic-fallback";
import type { RootGenre } from "./genre-taxonomy";
import {
  SCORING_WEIGHTS,
  MAX_SCENE_SCORE_INFLUENCE,
  requireTrackClassification,
} from "../core/genre-intelligence/genre-constraints";
import { dynamicSimilarityBoost } from "../shared/embeddings/dynamic-genre-graph";
import { similarityFillBoost } from "../shared/embeddings/genre-similarity-graph";
import type { PreScoreContext } from "../core/genre-intelligence/pre-score-bias";
import {
  computePreScoreBias,
  computePreScoreBiasBreakdown,
} from "../core/genre-intelligence/pre-score-bias";
import type { TruthAnchorStore } from "../core/genre-intelligence/genre-truth-anchor";
import {
  applyTruthAnchorGuard,
  getTruthAnchor,
} from "../core/genre-intelligence/genre-truth-anchor";
import {
  resolveSemanticScene,
  computeSemanticEcosystemScore,
  computeNegativePenalty,
  computeEnergyFit,
  type SemanticSceneResolution,
} from "./semantic-scene-engine";

const GENRE_FLOOR_STRONG = 0.15;

export interface TrackScoringDebug {
  trackId: string;
  sceneScore: number;
  libraryFitScore: number;
  genreBalanceScore: number;
  sceneMatch: number;
  emotionMatch: number;
  genreMatch: number;
  memoryMatch: number;
  noveltyScore: number;
  seasonalMatch: number;
  moodPurity: number;
  genrePrimary: string;
  genreConfidence: number;
  genreLocked: boolean;
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
  userGenre: UserGenreProfile;
  fallbackGenres: RootGenre[];
  sceneSeasonMode: "winter_holiday" | "summer" | "neutral";
  preScore?: PreScoreContext;
  truthAnchors?: TruthAnchorStore;
  /** Semantic scene resolution — drives primary ecosystem ranking signal */
  semanticResolution: SemanticSceneResolution;
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
  userGenre?: UserGenreProfile;
  libraryTracks?: Parameters<typeof buildUserGenreProfile>[0];
  preScore?: PreScoreContext;
  truthAnchors?: TruthAnchorStore;
}): HybridScoringContext {
  let prototype = opts.prototype;
  if (!prototype && opts.vibeKind === "sunny") {
    prototype = getPrototype("SUN_DAY_DRIVE");
  }

  const userGenre =
    opts.userGenre ??
    (opts.libraryTracks ? buildUserGenreProfile(opts.libraryTracks, opts.vibe) : buildUserGenreProfile([], opts.vibe));

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

  const blueprintSeason = prototype?.blueprint?.season;
  let sceneSeasonMode: "winter_holiday" | "summer" | "neutral" = "neutral";
  if (blueprintSeason === "winter_holiday" || /\b(christmas|xmas|holiday)\b/i.test(opts.vibe)) {
    sceneSeasonMode = "winter_holiday";
  } else if (blueprintSeason === "summer" || opts.vibeKind === "sunny" || scene.primary === "sun_day") {
    sceneSeasonMode = "summer";
  }

  const semanticResolution = resolveSemanticScene(opts.vibe, opts.profile);

  return {
    vibe: opts.vibe,
    profile: opts.profile,
    intent: opts.intent,
    canonical: opts.canonical,
    prototype,
    sonicProfile: opts.sonicProfile,
    vibeKind: opts.vibeKind,
    scene,
    season,
    contrastAllowance,
    emotionalComplexity,
    userGenre,
    fallbackGenres: pickFallbackGenres(userGenre, opts.profile, opts.vibe),
    sceneSeasonMode,
    preScore: opts.preScore,
    truthAnchors: opts.truthAnchors,
    semanticResolution,
    hardFilter: {
      vibe: opts.vibe,
      intent: opts.intent.intent,
      sceneFamily: scene.primary,
      season,
      prototype,
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
  return Math.max(happy, sad, hyped) / spread;
}

function percentileNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((x) => x <= v).length;
    return rank / sorted.length;
  });
}

export interface TriScores {
  sceneScore: number;
  libraryFitScore: number;
  genreBalanceScore: number;
  emotionMatch: number;
  seasonalMatch: number;
  moodPurity: number;
  classification: TrackGenreClassification;
  /** Semantic ecosystem match — scene-driven genre fit (primary signal) */
  semanticEcosystemScore: number;
  /** Instrumentation/aesthetic fit score */
  aestheticScore: number;
  /** Negative match multiplier (< 1 penalises anti-genre tracks) */
  negativePenalty: number;
}

export function computeTriScores(
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
    instrumentalness?: number | null;
    speechiness?: number | null;
  },
  ctx: HybridScoringContext,
  mode: "strict" | "balanced" | "chaotic",
  memoryMatch: number,
  noveltyScore: number
): TriScores {
  let classification = requireTrackClassification(
    track.trackId,
    ctx.userGenre.trackClassifications,
    () => classifyTrack(track)
  );
  const anchor = ctx.truthAnchors ? getTruthAnchor(ctx.truthAnchors, track.trackId) : undefined;
  if (anchor) {
    classification = applyTruthAnchorGuard(classification, anchor).classification;
  }

  const audio = {
    energy: track.energy,
    valence: track.valence,
    acousticness: track.acousticness,
    danceability: track.danceability,
    instrumentalness: track.instrumentalness ?? null,
    speechiness: track.speechiness ?? null,
    tempo: track.tempo,
  };
  const signature = computeGenreSignature(audio, classification);
  const blueprint = ctx.prototype?.blueprint;

  // Scene modifier — energy/atmosphere only (no genre affinity in this channel)
  let sceneMoment = sceneMatchScore(ctx.scene, ctx.profile, toSceneAudioTrack(track));
  const seasonalMatch = seasonalMatchScore(ctx.season, inferTrackSeasonTags(track));
  sceneMoment = sceneMoment * 0.85 + seasonalMatch * 0.15;

  if (blueprint?.instrumentationBias) {
    sceneMoment =
      sceneMoment * 0.82 +
      signatureSceneAffinity(signature, blueprint.instrumentationBias) * 0.18;
  }
  if (ctx.sonicProfile) {
    sceneMoment = sceneMoment * 0.88 + Math.min(1, sonicFitBonus(audio, ctx.sonicProfile) * 4) * 0.12;
  }

  const moodPurity = computeMoodPurity(track);
  if (!ctx.emotionalComplexity && moodPurity < 0.42) {
    sceneMoment *= 0.94;
  }

  const emotionMatch = scoreSong(audio, ctx.profile, mode, ctx.vibeKind);

  let libraryFit = libraryFitScore(classification, ctx.userGenre.vector);
  libraryFit = libraryFit * 0.8 + memoryMatch * 0.12 + noveltyScore * 0.08;
  libraryFit += genreFallbackScore(classification, ctx.fallbackGenres, ctx.profile) * 0.08;

  // Genre backbone — user's library affinity (now a minor signal at 5%)
  const userShare = ctx.userGenre.vector[classification.genrePrimary] ?? 0;
  let genreBalance =
    Math.min(1, userShare * 2.8) * 0.45 +
    classification.confidenceScore * 0.35 +
    signatureSceneAffinity(signature, {
      acoustic: 0.5,
      storytelling: 0.45,
      warmth: 0.5,
      synth: 0.35,
    }) *
      0.2;

  const underrepresented = (Object.entries(ctx.userGenre.vector) as [RootGenre, number][])
    .filter(([g, v]) => (v ?? 0) >= 0.05 && g !== "christmas")
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6)
    .map(([g]) => g);
  if (ctx.preScore) {
    genreBalance += computePreScoreBiasBreakdown(classification, ctx.preScore).total;
  } else {
    genreBalance += similarityFillBoost(classification.genreFamily, underrepresented);
  }

  if (blueprint?.genreAffinity) {
    const aff = blueprint.genreAffinity[classification.genrePrimary] ?? 0;
    genreBalance += aff * 0.08;
  }

  if (classification.holidayBound && ctx.sceneSeasonMode !== "winter_holiday") {
    genreBalance *= 0.04;
    sceneMoment *= 0.12;
  }

  const lock = isGenreLocked(classification);
  if (lock) {
    const lockW = genreLockWeight(classification);
    sceneMoment *= 1 - lockW * 0.65;
    genreBalance = Math.max(genreBalance, GENRE_FLOOR_STRONG + classification.confidenceScore * 0.3);
  }

  if (classification.confidenceScore >= 0.5) {
    genreBalance = Math.max(genreBalance, GENRE_FLOOR_STRONG);
  }

  let sceneScore = Math.min(sceneMoment, MAX_SCENE_SCORE_INFLUENCE);

  // ── Semantic ecosystem scoring (PRIMARY signal at 40%) ────────────────────
  const sv = ctx.semanticResolution.vector;
  let semanticEcosystemScore: number;
  let negativePenalty: number;

  if (sv) {
    // Scene detected — use canonical ecosystem weights
    const rawSemantic = computeSemanticEcosystemScore(classification, sv);
    const energyFit = computeEnergyFit(track.energy, sv);
    semanticEcosystemScore = rawSemantic * 0.80 + energyFit * 0.20;
    negativePenalty = computeNegativePenalty(classification, sv);
  } else {
    // No canonical scene — fall back to scene/genre balance as proxy
    semanticEcosystemScore = genreBalance * 0.55 + sceneScore * 0.45;
    negativePenalty = 1.0;
  }

  // ── Aesthetic score (instrumentation/signature fit) ────────────────────────
  const aestheticScore = blueprint?.instrumentationBias
    ? signatureSceneAffinity(signature, blueprint.instrumentationBias)
    : signatureSceneAffinity(signature, { acoustic: 0.45, warmth: 0.5, storytelling: 0.4, synth: 0.3 });

  return {
    sceneScore,
    libraryFitScore: Math.min(1, libraryFit),
    genreBalanceScore: Math.min(1, genreBalance),
    emotionMatch,
    seasonalMatch,
    moodPurity,
    classification,
    semanticEcosystemScore: Math.min(1, semanticEcosystemScore),
    aestheticScore: Math.min(1, aestheticScore),
    negativePenalty,
  };
}

export function combineTriScore(tri: TriScores, ctx: HybridScoringContext): number {
  const sceneContrib = Math.min(tri.sceneScore, MAX_SCENE_SCORE_INFLUENCE) * SCORING_WEIGHTS.scene;

  // Primary signal: semantic ecosystem match (scene-driven genre fit)
  let final =
    tri.semanticEcosystemScore * SCORING_WEIGHTS.semantic +
    tri.emotionMatch * SCORING_WEIGHTS.emotion +
    sceneContrib +
    tri.aestheticScore * SCORING_WEIGHTS.aesthetic +
    tri.libraryFitScore * SCORING_WEIGHTS.library +
    tri.genreBalanceScore * SCORING_WEIGHTS.genre;

  // Apply negative match penalty — anti-genre tracks are penalised multiplicatively
  final *= tri.negativePenalty;

  if (ctx.intent.intent === "nostalgia") {
    final += tri.libraryFitScore * 0.04;
  }
  if (isGenreLocked(tri.classification)) {
    // Genre-locked tracks: ensure semantic score still leads but genre gets a floor
    final = final * 0.85 + tri.semanticEcosystemScore * 0.15;
  }

  return Math.max(0, Math.min(1.25, final));
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
  instrumentalness?: number | null;
  speechiness?: number | null;
}>(
  tracks: T[],
  ctx: HybridScoringContext,
  mode: "strict" | "balanced" | "chaotic",
  memoryByTrack: (trackId: string) => number,
  noveltyByTrack: (trackId: string) => number
): { results: HybridScoreResult<T>[]; excluded: TrackScoringDebug[] } {
  const passed: { track: T; tri: TriScores }[] = [];
  const excluded: TrackScoringDebug[] = [];

  for (const track of tracks) {
    const hard = applyHardFilters(track, ctx.hardFilter);
    if (!hard.pass) {
      excluded.push(emptyDebug(track.trackId, hard.excludedBy));
      continue;
    }

    const tri = computeTriScores(
      track,
      ctx,
      mode,
      memoryByTrack(track.trackId),
      noveltyByTrack(track.trackId)
    );
    passed.push({ track, tri });
  }

  const sceneNorm = percentileNormalize(passed.map((p) => p.tri.sceneScore));
  const libNorm = percentileNormalize(passed.map((p) => p.tri.libraryFitScore));
  const genreNorm = percentileNormalize(passed.map((p) => p.tri.genreBalanceScore));
  const semanticNorm = percentileNormalize(passed.map((p) => p.tri.semanticEcosystemScore));
  const aestheticNorm = percentileNormalize(passed.map((p) => p.tri.aestheticScore));

  const results: HybridScoreResult<T>[] = passed.map((p, i) => {
    const tri: TriScores = {
      ...p.tri,
      sceneScore: sceneNorm[i] ?? p.tri.sceneScore,
      libraryFitScore: libNorm[i] ?? p.tri.libraryFitScore,
      genreBalanceScore: genreNorm[i] ?? p.tri.genreBalanceScore,
      semanticEcosystemScore: semanticNorm[i] ?? p.tri.semanticEcosystemScore,
      aestheticScore: aestheticNorm[i] ?? p.tri.aestheticScore,
    };

    const finalScore = combineTriScore(tri, ctx);
    const c = tri.classification;

    return {
      track: p.track,
      score: finalScore,
      passed: true,
      debug: {
        trackId: p.track.trackId,
        sceneScore: round(tri.sceneScore),
        libraryFitScore: round(tri.libraryFitScore),
        genreBalanceScore: round(tri.genreBalanceScore),
        sceneMatch: round(tri.sceneScore),
        emotionMatch: round(tri.emotionMatch),
        genreMatch: round(tri.genreBalanceScore),
        memoryMatch: round(memoryByTrack(p.track.trackId)),
        noveltyScore: round(noveltyByTrack(p.track.trackId)),
        seasonalMatch: round(tri.seasonalMatch),
        moodPurity: round(tri.moodPurity),
        genrePrimary: c.genrePrimary,
        genreConfidence: round(c.confidenceScore),
        genreLocked: isGenreLocked(c),
        excludedBy: null,
        finalScore: round(finalScore),
      },
    };
  });

  return { results, excluded };
}

function emptyDebug(trackId: string, excludedBy: string | null): TrackScoringDebug {
  return {
    trackId,
    sceneScore: 0,
    libraryFitScore: 0,
    genreBalanceScore: 0,
    sceneMatch: 0,
    emotionMatch: 0,
    genreMatch: 0,
    memoryMatch: 0,
    noveltyScore: 0,
    seasonalMatch: 0,
    moodPurity: 0,
    genrePrimary: "unknown",
    genreConfidence: 0,
    genreLocked: false,
    excludedBy,
    finalScore: 0,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
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
    sceneSeasonMode: ctx.sceneSeasonMode,
    userGenreVector: ctx.userGenre.vector,
    dominantGenres: ctx.userGenre.dominant,
    fallbackGenres: ctx.fallbackGenres,
    contrastAllowance: ctx.contrastAllowance,
    scoringModel: "semantic0.40_emotion0.20_scene0.15_aesthetic0.10_library0.10_genre0.05",
    semanticResolution: ctx.semanticResolution.matchedId
      ? { sceneId: ctx.semanticResolution.matchedId, confidence: ctx.semanticResolution.confidence }
      : null,
    sceneInfluenceCap: MAX_SCENE_SCORE_INFLUENCE,
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
