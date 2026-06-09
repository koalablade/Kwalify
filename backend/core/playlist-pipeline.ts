/**
 * End-to-end playlist build — scoring → composition → genre post-enforcement.
 */

import { runScoringPipeline } from "./scoring-engine";
import { composePlaylistFromPool } from "./playlist-composer";
import { enforceFinalPlaylistGenres } from "./genre-intelligence/final-enforcement";
import { runV3Pipeline } from "./v3/v3-pipeline";
import type { EmotionProfile, VibeKind } from "../lib/emotion";
import type { IntentDecodeResult } from "../lib/intent-decoder";
import type { CanonicalSceneResult } from "../lib/scene-canonicalizer";
import type { ScenePrototype } from "../lib/scene-prototypes";
import type { SonicProfile } from "../lib/scene-sonic-map";
import type { UserGenreProfile } from "../lib/user-genre-profile";
import type { GenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import type { LibrarySignals } from "../lib/library-signals";
import type { ReferenceFingerprint } from "../lib/reference-playlist";
import type { RediscoveryMode } from "../lib/forgotten-favourites";
import type { ArchaeologyIntent } from "../lib/library-archaeology";
import type { ChapterMatch } from "../lib/music-life-chapters";
import type { SurpriseMix } from "../lib/human-surprise";
import type { JourneyArc } from "../lib/emotion-destination";
import {
  buildRecentTrackPoolPenalty,
  type FreshnessStats,
} from "../lib/playlist-freshness";
import type { GenreAudit } from "../lib/genre-audit";
import type { ScoredLibraryTrack } from "./scoring-engine/types";
import { logScoringStage } from "../lib/generate-stage-timer";
import type { EcosystemDebug } from "../lib/ecosystem-lock";
import { detectEraFromYear, estimateEraFromAudio } from "./v2/era-model";
import { completeLockedIntent, type LockedIntent } from "./v3/intent";
import { trackMatchesConstraints } from "./v3/constraint-filter";
import { getGenreFamily } from "./v3/global-diversity-controller";
import {
  warnIfFieldDropped,
  warnIfV3MetadataLost,
  type V3MetadataTrack,
} from "../lib/v3-track-contract";
import {
  buildUnifiedIntentContext,
  resolveUnifiedIntent,
  unifiedIntentFromControllerIntent,
  unifiedIntentFromLockedIntent,
  unifiedIntentFromSceneIntent,
  unifiedIntentFromV11Intent,
  type UnifiedIntentContext,
} from "./unified-intent";
import {
  getMomentMemory,
  injectMomentContext,
  updateMomentMemory,
} from "./memory/moment-memory";
import { buildPlaylistEmbedding } from "./v3/embedding-retrieval";

export interface BuildPlaylistPipelineOpts<T extends {
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
}> {
  likedSongs: T[];
  vibe: string;
  mode: "strict" | "balanced" | "chaotic";
  playlistLength: number;
  emotionProfile: EmotionProfile;
  vibeKind: VibeKind;
  intent: IntentDecodeResult;
  humanIntent: IntentDecodeResult;
  canonical: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  sonicProfile: SonicProfile | null;
  userGenreProfile: UserGenreProfile;
  genreStack: GenreIntelligenceStack;
  surpriseMix: SurpriseMix;
  journeyArc: JourneyArc;
  memoryByTrack: (trackId: string) => number;
  noveltyByTrack: (trackId: string) => number;
  recentPlaylistTrackIds?: string[][];
  postScore: {
    referenceFingerprint: ReferenceFingerprint | null;
    memoryWeight: number;
    emotionProfile: EmotionProfile;
    librarySignals: LibrarySignals;
    rediscoveryMode: RediscoveryMode;
    archaeology: ArchaeologyIntent | null;
    chapterMatch: ChapterMatch | null;
    startMs: number;
    promptConfidenceMultiplier: number;
    journeyArcMultiplier: number;
    freshness: {
      stats: FreshnessStats;
      artistAppearances: Map<string, number>;
      albumAppearances: Map<string, number>;
      globalCloneMultiplier: number;
    };
    vibe: string;
  };
  genrePost: {
    allowHoliday: boolean;
    suppressGenres: string[];
  };
  maxPerArtist: number;
  varietyPenaltyScale?: number;
  referencePlaylist?: boolean;
  pipelineLog?: import("pino").Logger;
  lastSuccessfulVibe?: string | null;
  momentMemoryKey?: string;
  /**
   * No-library mode: intent always overrides user history.
   * Library affinity weight is zeroed out and redistributed to semantic.
   */
  noLibraryMode?: boolean;
}

export interface BuildPlaylistPipelineResult<T extends { trackId: string }> {
  finalTracks: T[];
  sorted: ScoredLibraryTrack<T>[];
  scoringDiagnostics: Record<string, unknown>;
  hybridExcludedCount: number;
  genreAudit: GenreAudit;
  ecosystemDebug: EcosystemDebug | null;
  composeMeta: {
    structured: T[];
    poolTarget: number;
    afterDeadZone: T[];
    afterSmoothing: T[];
    afterArtistSep: T[];
    afterArc: T[];
    emotionalPeakTrackId: string | null;
    emotionalPeakIndex: number | null;
    gradientPhases: { start: number; explore: number; peak: number; resolve: number };
  };
}

function energyIntentFromProfile(profile: EmotionProfile): "low" | "medium" | "high" {
  const energy = profile.energy ?? 0.5;
  if (energy >= 0.64) return "high";
  if (energy <= 0.38) return "low";
  return "medium";
}

function moodFallbackFromProfile(profile: EmotionProfile): string[] {
  if ((profile.calm ?? 0) >= 0.6) return ["calm"];
  if ((profile.nostalgia ?? 0) >= 0.5) return ["nostalgic"];
  if ((profile.valence ?? 0.5) <= 0.42) return ["melancholic"];
  if ((profile.energy ?? 0.5) >= 0.65) return ["energised"];
  return ["balanced"];
}

function eraRangeFromCandidatePool<T extends { releaseYear?: number | null }>(
  tracks: T[],
): { start: number; end: number } | null {
  const years = tracks
    .map((track) => track.releaseYear)
    .filter((year): year is number => typeof year === "number" && year >= 1900);
  if (years.length === 0) return null;
  return { start: Math.min(...years), end: Math.max(...years) };
}

function genreFamilyForTrack<T extends { trackId: string; genrePrimary?: string }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classMap.get(track.trackId);
  const family = classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary;
  const normalized = family ? getGenreFamily(family) : null;
  return normalized && normalized !== "unknown" ? normalized : null;
}

function topGenreFamiliesFromPool<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): string[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = genreFamilyForTrack(track, classMap);
    if (!family) continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([family]) => family);
}

function hasLaneReadyEra(track: {
  releaseYear?: number | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}): boolean {
  if (track.releaseYear) return detectEraFromYear(track.releaseYear) !== "any";
  return estimateEraFromAudio(track) !== "any";
}

function isV3LaneReady<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): boolean {
  return !!genreFamilyForTrack(track, classMap) &&
    track.energy !== null &&
    hasLaneReadyEra(track);
}

function isV3LaneReadyForIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): boolean {
  if (!genreFamilyForTrack(track, classMap) || track.energy === null) return false;
  return lockedIntent.eraRange ? hasLaneReadyEra(track) : true;
}

function trackMatchesLockedIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): boolean {
  const classification = classMap.get(track.trackId);
  return trackMatchesConstraints({
    ...track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary,
    genrePrimary: classification?.genrePrimary ?? track.genrePrimary,
    laneEra: track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track),
  }, lockedIntent);
}

function familyCount<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): number {
  return new Set(
    tracks
      .map((track) => genreFamilyForTrack(track, classMap))
      .filter((family): family is string => !!family)
  ).size;
}

function familyDistribution<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const track of tracks) {
    const family = genreFamilyForTrack(track, classMap);
    if (!family) continue;
    distribution[family] = (distribution[family] ?? 0) + 1;
  }
  return distribution;
}

function dominantFamilyShare(distribution: Record<string, number>): {
  family: string | null;
  share: number;
} {
  const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  if (total === 0) return { family: null, share: 0 };
  const [family, count] = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { family, share: count / total };
}

function adjacentGenreFamilies(family: string | null): string[] {
  switch (family) {
    case "indie":
      return ["rock", "folk", "pop", "electronic"];
    case "rock":
      return ["indie", "folk", "blues", "pop"];
    case "country":
      return ["folk", "blues", "rock"];
    case "electronic":
      return ["pop", "hip_hop", "rnb", "indie"];
    case "hip_hop":
      return ["rnb", "soul", "electronic", "pop"];
    case "rnb":
      return ["soul", "hip_hop", "pop", "jazz"];
    case "jazz":
      return ["soul", "blues", "rnb"];
    case "folk":
      return ["country", "indie", "rock"];
    case "pop":
      return ["indie", "electronic", "rnb", "rock"];
    default:
      return [];
  }
}

function uncollapseV11CandidatePool<T extends {
  trackId: string;
  genrePrimary?: string;
}>(
  initialPool: T[],
  expandedPool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  playlistLength: number,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const availableFamilyCount = familyCount(expandedPool, classMap);
  const initialDistribution = familyDistribution(initialPool, classMap);
  const initialDominant = dominantFamilyShare(initialDistribution);
  const collapseDetected =
    initialDominant.share > 0.70 ||
    familyCount(initialPool, classMap) < Math.min(3, availableFamilyCount);

  if (!collapseDetected || availableFamilyCount < 2) {
    return {
      tracks: initialPool,
      diagnostics: {
        collapseDetected,
        availableFamilyCount,
        dominantFamily: initialDominant.family,
        dominantShare: Math.round(initialDominant.share * 1000) / 1000,
        uncollapseApplied: false,
      },
    };
  }

  const targetFamilyCount = Math.min(3, availableFamilyCount);
  const targetSize = Math.max(initialPool.length, Math.min(expandedPool.length, Math.max(playlistLength * 10, 90)));
  const usedIds = new Set(initialPool.map((track) => track.trackId));
  const out = [...initialPool];
  const allFamilies = topGenreFamiliesFromPool(expandedPool, classMap);
  const preferredFamilies = [
    ...adjacentGenreFamilies(initialDominant.family),
    ...allFamilies,
  ].filter((family, index, families) =>
    family !== initialDominant.family && families.indexOf(family) === index
  );

  function addFirstFromFamily(family: string): void {
    const candidate = expandedPool.find((track) =>
      !usedIds.has(track.trackId) &&
      genreFamilyForTrack(track, classMap) === family
    );
    if (!candidate) return;
    usedIds.add(candidate.trackId);
    out.push(candidate);
  }

  function diversityTargetMet(): boolean {
    return familyCount(out, classMap) >= targetFamilyCount &&
      dominantFamilyShare(familyDistribution(out, classMap)).share <= 0.70;
  }

  for (const family of preferredFamilies) {
    if (familyCount(out, classMap) >= targetFamilyCount) break;
    addFirstFromFamily(family);
  }

  for (const track of expandedPool) {
    if (out.length >= targetSize && diversityTargetMet()) break;
    if (usedIds.has(track.trackId)) continue;
    const family = genreFamilyForTrack(track, classMap);
    if (!family || family === initialDominant.family) continue;
    usedIds.add(track.trackId);
    out.push(track);
  }

  for (const track of expandedPool) {
    if (out.length >= targetSize && diversityTargetMet()) break;
    if (usedIds.has(track.trackId)) continue;
    usedIds.add(track.trackId);
    out.push(track);
  }

  const finalDistribution = familyDistribution(out, classMap);
  const finalDominant = dominantFamilyShare(finalDistribution);

  return {
    tracks: out,
    diagnostics: {
      collapseDetected,
      availableFamilyCount,
      dominantFamily: initialDominant.family,
      dominantShare: Math.round(initialDominant.share * 1000) / 1000,
      finalDominantFamily: finalDominant.family,
      finalDominantShare: Math.round(finalDominant.share * 1000) / 1000,
      uncollapseApplied: true,
      targetFamilyCount,
    },
  };
}

function buildV3CandidatePool<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  sorted: T[],
  classMap: UserGenreProfile["trackClassifications"],
  playlistLength: number,
  lockedIntent: LockedIntent,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const laneReady = sorted.filter((track) => isV3LaneReady(track, classMap));
  const intentLaneReady = sorted.filter((track) => isV3LaneReadyForIntent(track, classMap, lockedIntent));
  const effectiveLaneReady = lockedIntent.eraRange ? laneReady : intentLaneReady;
  const intentReady = effectiveLaneReady.filter((track) =>
    trackMatchesLockedIntent(track, classMap, lockedIntent)
  );
  const baseWindow = Math.min(intentReady.length, Math.max(playlistLength * 8, 75));
  let windowSize = baseWindow;
  while (windowSize < intentReady.length && familyCount(intentReady.slice(0, windowSize), classMap) < 3) {
    windowSize = Math.min(intentReady.length, windowSize + Math.max(playlistLength * 4, 25));
  }
  const initialTracks = intentReady.slice(0, windowSize);
  const expandedWindowSize = Math.min(
    intentReady.length,
    Math.max(windowSize, Math.max(playlistLength * 12, 120))
  );
  const uncollapsed = uncollapseV11CandidatePool(
    initialTracks,
    intentReady.slice(0, expandedWindowSize),
    classMap,
    playlistLength,
  );
  const tracks = uncollapsed.tracks;
  return {
    tracks,
    diagnostics: {
      inputCount: sorted.length,
      laneReadyCount: laneReady.length,
      intentLaneReadyCount: intentLaneReady.length,
      laneReadinessEraRelaxed: !lockedIntent.eraRange,
      intentReadyCount: intentReady.length,
      candidateCount: tracks.length,
      genreFamilyClusters: familyCount(tracks, classMap),
      expandedForFamilySpread: windowSize > baseWindow,
      v11Uncollapse: uncollapsed.diagnostics,
    },
  };
}

function buildV3LockedIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  releaseYear?: number | null;
}>(
  unifiedIntentContext: UnifiedIntentContext,
  previousUnifiedIntentContext: UnifiedIntentContext | null,
  profile: EmotionProfile,
  candidatePool: T[],
  classMap: UserGenreProfile["trackClassifications"],
): LockedIntent {
  const poolGenreFamilies = topGenreFamiliesFromPool(candidatePool, classMap);
  return completeLockedIntent(unifiedIntentContext.lockedIntent, {
    genreFamilies: poolGenreFamilies.length > 0
      ? poolGenreFamilies
      : previousUnifiedIntentContext?.lockedIntent.genreFamilies,
    eraRange: eraRangeFromCandidatePool(candidatePool) ?? previousUnifiedIntentContext?.lockedIntent.eraRange,
    mood: previousUnifiedIntentContext?.lockedIntent.mood.length ? previousUnifiedIntentContext.lockedIntent.mood : moodFallbackFromProfile(profile),
    activity: previousUnifiedIntentContext?.lockedIntent.activity ?? "listening",
    energy: energyIntentFromProfile(profile),
  });
}

export function buildPlaylistPipeline<T extends {
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
  score?: number;
  rediscoveryScore?: number;
}>(
  opts: BuildPlaylistPipelineOpts<T>
): BuildPlaylistPipelineResult<T> {
  const scoring = runScoringPipeline({
    pipelineLog: opts.pipelineLog,
    tracks: opts.likedSongs,
    vibe: opts.vibe,
    mode: opts.mode,
    emotionProfile: opts.emotionProfile,
    vibeKind: opts.vibeKind,
    intent: opts.intent,
    canonical: opts.canonical,
    prototype: opts.prototype,
    sonicProfile: opts.sonicProfile,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    playlistLength: opts.playlistLength,
    memoryByTrack: opts.memoryByTrack,
    noveltyByTrack: opts.noveltyByTrack,
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,
    varietyPenaltyScale: opts.varietyPenaltyScale,
    referencePlaylist: opts.referencePlaylist,
    noLibraryMode: opts.noLibraryMode,
    postScore: {
      ...opts.postScore,
      emotionProfile: opts.emotionProfile,
    },
  });

  const sortedPool = scoring.sorted;

  // ─────────────────────────────────────────────────────────────────────────
  // V3 MULTI-LANE ARCHITECTURE
  //
  //   Step 1: Multi-axis intent decomposition → Scene Influence Map
  //   Step 2: Router  → 2–5 independent lanes (core/emotional/motion/contrast)
  //   Step 3: Per-lane scoring   (isolated signal weights per lane type)
  //   Step 4: Per-lane sampling  (structural diversity: 35%/50%/60% hard caps)
  //   Step 5: Cross-lane interleaving + stabilization pass
  //
  // No global ranking — each lane is a mini recommender.
  // Fallback is also multi-lane (spec §8) — never a generic mood.
  // ─────────────────────────────────────────────────────────────────────────

  const classMap = opts.userGenreProfile.trackClassifications;
  const v3IntentSourcePool = scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>;
  const unifiedIntentContext = buildUnifiedIntentContext(
    opts.vibe,
    opts.emotionProfile,
    {},
    [
      unifiedIntentFromControllerIntent(opts.humanIntent, opts.emotionProfile),
      unifiedIntentFromV11Intent(opts.intent, opts.emotionProfile),
    ],
  );
  const preGenerationMomentMemory = getMomentMemory(opts.momentMemoryKey);
  const memoryAdjustedUnifiedIntent = injectMomentContext(
    unifiedIntentContext.unifiedIntent,
    preGenerationMomentMemory,
  );
  const unifiedIntentContextWithMemory: UnifiedIntentContext = {
    ...unifiedIntentContext,
    unifiedIntent: memoryAdjustedUnifiedIntent,
    diagnostics: {
      ...unifiedIntentContext.diagnostics,
      resolver: {
        ...unifiedIntentContext.diagnostics.resolver,
        intent: memoryAdjustedUnifiedIntent,
      },
    },
  };
  const previousUnifiedIntentContext = opts.lastSuccessfulVibe?.trim()
    ? buildUnifiedIntentContext(opts.lastSuccessfulVibe, opts.emotionProfile)
    : null;
  const v3LockedIntent = buildV3LockedIntent(
    unifiedIntentContextWithMemory,
    previousUnifiedIntentContext,
    opts.emotionProfile,
    v3IntentSourcePool,
    classMap,
  );
  const unifiedIntentDiagnostics = resolveUnifiedIntent([
    ...unifiedIntentContextWithMemory.diagnostics.snapshots,
    unifiedIntentFromLockedIntent(v3LockedIntent),
    unifiedIntentFromSceneIntent(v3LockedIntent.sceneIntent),
  ]);
  const v3CandidatePool = buildV3CandidatePool(
    scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>,
    classMap,
    opts.playlistLength,
    v3LockedIntent,
  );

  let t = Date.now();
  const v3 = runV3Pipeline(
    v3CandidatePool.tracks as unknown as T[],
    opts.vibe,
    opts.emotionProfile,
    opts.playlistLength,
    {
      genreByTrack:          (trackId) => classMap.get(trackId)?.genrePrimary ?? "unknown",
      classificationByTrack: (trackId) => classMap.get(trackId),
      noveltyByTrack:        opts.noveltyByTrack,
      seed:                  opts.postScore.startMs,
      lockedIntent:          v3LockedIntent,
      unifiedIntentContext:   unifiedIntentContextWithMemory,
      momentMemory:           preGenerationMomentMemory,
    }
  );
  logScoringStage(opts.pipelineLog, "V3 multi-lane pipeline complete", t, {
    poolSize: v3CandidatePool.tracks.length,
    selectedCount: v3.finalTracks.length,
    lanes: (v3.diagnostics["lanes"] as Array<{ laneId: string }>)?.map((l) => l.laneId),
  });

  // V3 final tracks are authoritative; do not rehydrate from scored tracks here,
  // or V3 metadata such as sourceLane/laneScore/clusterIds can be dropped.
  const finalTracksList = v3.finalTracks as V3MetadataTrack<T>[];
  const finalHardFilterTrace = {
    stage: "final hard-filter count",
    before: v3.finalTracks.length,
    after: finalTracksList.length,
    removed: Math.max(0, v3.finalTracks.length - finalTracksList.length),
    topReasons: v3.finalTracks.length > finalTracksList.length
      ? [{ reason: "v3_output_to_controller_drop", count: v3.finalTracks.length - finalTracksList.length }]
      : [],
    sourceFile: "backend/core/playlist-pipeline.ts",
    functionName: "buildPlaylistPipeline",
  };

  // Last-resort fallback: V3 produced nothing (no audio features / empty lib)
  if (finalTracksList.length === 0) {
    const fallbackPool = v3CandidatePool.tracks as unknown as ScoredLibraryTrack<T>[];
    const recentTrackPenalty = opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(opts.recentPlaylistTrackIds, 5, opts.varietyPenaltyScale ?? 1)
      : undefined;
    const composed = composePlaylistFromPool({
      sortedPool: fallbackPool,
      playlistLength: opts.playlistLength,
      mode: opts.mode,
      maxPerArtist: opts.maxPerArtist,
      emotionProfile: opts.emotionProfile,
      vibeKind: opts.vibeKind,
      journeyArc: opts.journeyArc,
      surpriseMix: opts.surpriseMix,
      humanIntent: opts.humanIntent,
      vibe: opts.vibe,
      canonical: opts.canonical,
      recentTrackPenalty,
      ecosystemVector: undefined,
    });
    const enforcedFallback = enforceFinalPlaylistGenres({
      finalTracks: composed.finalTracks,
      sortedPool: fallbackPool,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: scoring.sceneInfluenceRatio,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    const fallbackMomentMemory = updateMomentMemory({
      unifiedIntent: memoryAdjustedUnifiedIntent,
      finalPlaylistEmbedding: buildPlaylistEmbedding(enforcedFallback.tracks).centroidVector,
      memoryKey: opts.momentMemoryKey,
    });
    return {
      finalTracks: enforcedFallback.tracks,
      sorted: scoring.sorted,
      scoringDiagnostics: {
        ...scoring.scoringDiagnostics,
        unifiedIntent: unifiedIntentDiagnostics,
        momentMemory: {
          recentStates: fallbackMomentMemory.recentStates.length,
          decayWeight: Math.round(fallbackMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
        },
        v3Pipeline: {
          ...v3.diagnostics,
          forensicPoolTrace: {
            ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
            finalHardFilterTrace,
          },
          fallback: true,
          reason: "empty_library",
          preV3Recovery: v3CandidatePool.diagnostics,
        },
      },
      hybridExcludedCount: scoring.hybridExcludedCount,
      genreAudit: enforcedFallback.genreAudit,
      ecosystemDebug: null,
      composeMeta: {
        structured: enforcedFallback.tracks,
        poolTarget: opts.playlistLength,
        afterDeadZone: enforcedFallback.tracks,
        afterSmoothing: enforcedFallback.tracks,
        afterArtistSep: enforcedFallback.tracks,
        afterArc: enforcedFallback.tracks,
        emotionalPeakTrackId: composed.emotionalPeakTrackId,
        emotionalPeakIndex: composed.emotionalPeakIndex,
        gradientPhases: composed.gradientPhases,
      },
    };
  }

  // Genre enforcement safety net — audit only; V3 structural diversity already
  // prevents collapse inside each lane (35% genre / 50% energy / 60% era caps).
  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
    finalTracks: [...finalTracksList] as unknown as ScoredLibraryTrack<T>[],
    sortedPool: scoring.sorted,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    allowHoliday: opts.genrePost.allowHoliday,
    suppressGenres: opts.genrePost.suppressGenres,
    coverageState: scoring.coverageState,
    genreForecast: scoring.genreForecast,
    sceneInfluenceRatio: 0,
    stabilityDiagnostics: scoring.stabilityDiagnostics,
  });
  logScoringStage(opts.pipelineLog, "V3 genre audit complete", t, {
    tracks: finalTracksList.length,
  });
  warnIfV3MetadataLost(
    v3.finalTracks,
    finalTracksList,
    "v3-output-to-create-playlist"
  );
  warnIfFieldDropped("laneScore", v3.finalTracks, finalTracksList, "v3-output-to-create-playlist");
  warnIfFieldDropped("clusterIds", v3.finalTracks, finalTracksList, "v3-output-to-create-playlist");
  const updatedMomentMemory = updateMomentMemory({
    unifiedIntent: memoryAdjustedUnifiedIntent,
    finalPlaylistEmbedding: buildPlaylistEmbedding(finalTracksList).centroidVector,
    memoryKey: opts.momentMemoryKey,
  });

  return {
    finalTracks: finalTracksList,
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      unifiedIntent: unifiedIntentDiagnostics,
      momentMemory: {
        recentStates: updatedMomentMemory.recentStates.length,
        decayWeight: Math.round(updatedMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
      },
      v3Pipeline: {
        ...v3.diagnostics,
        forensicPoolTrace: {
          ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
          finalHardFilterTrace,
        },
        preV3Recovery: v3CandidatePool.diagnostics,
      },
    },
    hybridExcludedCount: scoring.hybridExcludedCount,
    genreAudit: enforced.genreAudit,
    ecosystemDebug: null,
    composeMeta: {
      structured: finalTracksList,
      poolTarget: opts.playlistLength,
      afterDeadZone: finalTracksList,
      afterSmoothing: finalTracksList,
      afterArtistSep: finalTracksList,
      afterArc: finalTracksList,
      emotionalPeakTrackId: null,
      emotionalPeakIndex: null,
      gradientPhases: { start: 0.10, explore: 0.35, peak: 0.65, resolve: 0.85 },
    },
  };
}
