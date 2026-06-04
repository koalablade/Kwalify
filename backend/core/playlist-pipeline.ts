/**
 * End-to-end playlist build — scoring → composition → genre post-enforcement.
 */

import { runScoringPipeline } from "./scoring-engine";
import { composePlaylistFromPool } from "./playlist-composer";
import { enforceFinalPlaylistGenres } from "./genre-intelligence/final-enforcement";
import { runV2Pipeline } from "./v2/v2-pipeline";
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
// Re-exported from scoring-engine but imported directly for local use
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import type { EcosystemDebug } from "../lib/ecosystem-lock";

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
  // V2: Scene detection is soft context only — no ecosystem locking.
  const semanticResolution = resolveSemanticScene(opts.vibe, opts.emotionProfile);

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
  // V2 FINAL ARCHITECTURE: Replace compose + enforce with V2 pipeline.
  //
  //   Step 1: Triple-signal re-scoring  (R×0.45 + V×0.35 + C×0.20)
  //   Step 2: Greedy diversity selection (streak-based penalties)
  //   Step 3: Bucketed selection         (25% × 4 anti-collapse buckets)
  //   Step 4: Sequencer                  (flow-optimized ordering)
  //
  // NO track removed due to genre/scene. ALL diversity is post-score only.
  // Scene contributes at most 10% of C signal → ≤2% of final score.
  // ─────────────────────────────────────────────────────────────────────────

  // Build a fast lookups from the scored pool
  const sortedByTrackId = new Map(sortedPool.map((s) => [s.trackId, s]));
  const classMap = opts.userGenreProfile.trackClassifications;

  let t = Date.now();
  const v2 = runV2Pipeline(
    opts.likedSongs,
    opts.vibe,
    opts.emotionProfile,
    opts.playlistLength,
    {
      genreByTrack: (trackId) => classMap.get(trackId)?.genrePrimary ?? "unknown",
      sceneAffinityByTrack: (trackId) => {
        const scored = sortedByTrackId.get(trackId);
        return scored ? (scored.scoringDebug?.sceneMatch ?? 0.5) : 0.5;
      },
      seed: opts.postScore.startMs,
    }
  );
  logScoringStage(opts.pipelineLog, "V2 pipeline complete", t, {
    poolSize: opts.likedSongs.length,
    scoredCount: v2.scoredPool.length,
    selectedCount: v2.finalTracks.length,
  });

  // Map V2 final tracks back to ScoredLibraryTrack<T> for genre enforcement compatibility.
  // Replace score with V2 score; keep existing scoringDebug for debug tooling.
  const v2ScoreMap = new Map(v2.scoredPool.map((s) => [s.trackId, s.v2Score]));
  const v2FinalScored = v2.finalTracks
    .map((track) => {
      const existing = sortedByTrackId.get(track.trackId);
      if (!existing) return null;
      return { ...existing, score: v2ScoreMap.get(track.trackId) ?? existing.score } as ScoredLibraryTrack<T>;
    })
    .filter((s): s is ScoredLibraryTrack<T> => s !== null);

  // Fallback: if V2 produced nothing (empty library / no audio features),
  // fall back to compose from the existing scoring pool.
  if (v2FinalScored.length === 0) {
    const recentTrackPenalty = opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(opts.recentPlaylistTrackIds, 5, opts.varietyPenaltyScale ?? 1)
      : undefined;
    const composed = composePlaylistFromPool({
      sortedPool,
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
      sortedPool: scoring.sorted,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: scoring.sceneInfluenceRatio,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    return {
      finalTracks: enforcedFallback.tracks,
      sorted: scoring.sorted,
      scoringDiagnostics: { ...scoring.scoringDiagnostics, v2Pipeline: { fallback: true } },
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

  // V2 genre enforcement — safety net for minimum genre diversity.
  // V2 bucketed selection already enforces anti-collapse (3+ genres guaranteed when available).
  // This pass adds audit metadata and enforces the 60% max dominance cap (V2 spec).
  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
    finalTracks: v2FinalScored,
    sortedPool: scoring.sorted,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    allowHoliday: opts.genrePost.allowHoliday,
    suppressGenres: opts.genrePost.suppressGenres,
    coverageState: scoring.coverageState,
    genreForecast: scoring.genreForecast,
    sceneInfluenceRatio: 0, // V2: scene has < 2% influence on final score
    stabilityDiagnostics: scoring.stabilityDiagnostics,
  });
  logScoringStage(opts.pipelineLog, "V2 genre audit complete", t, {
    tracks: enforced.tracks.length,
  });

  const finalTracksList = enforced.tracks as T[];

  return {
    finalTracks: finalTracksList,
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      v2Pipeline: v2.diagnostics,
      ecosystemLock: {
        locked: false,
        sceneId: semanticResolution.matchedId ?? null,
        sceneConfidence: semanticResolution.confidence,
        v2SceneInfluence: "soft_context_max_0.10",
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
