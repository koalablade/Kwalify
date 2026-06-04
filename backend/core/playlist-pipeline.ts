/**
 * End-to-end playlist build — scoring → composition → genre post-enforcement.
 */

import { runScoringPipeline } from "./scoring-engine";
import { composePlaylistFromPool } from "./playlist-composer";
import { enforceFinalPlaylistGenres } from "./genre-intelligence/final-enforcement";
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
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import {
  ECOSYSTEM_LOCK_THRESHOLD,
  classifyPoolByEcosystem,
  selectAnchorTracks,
  hoistAnchorTracksInPool,
  enforceEcosystemFloor,
  buildEcosystemDebug,
  type EcosystemDebug,
} from "../lib/ecosystem-lock";

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
  // ── Resolve semantic scene for ecosystem locking ────────────────────────────
  const semanticResolution = resolveSemanticScene(opts.vibe, opts.emotionProfile);
  const ecosystemLockActive =
    !!semanticResolution.vector &&
    semanticResolution.confidence >= ECOSYSTEM_LOCK_THRESHOLD;

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

  // ── Ecosystem anchor hoisting ────────────────────────────────────────────────
  // When the scene lock is active, identify the 10 strongest primary-ecosystem
  // tracks and hoist them to the front of the scoring pool. The composer will
  // then preferentially pick from these anchor slots first.
  let sortedPool = scoring.sorted;
  let anchorTrackIds: string[] = [];

  if (ecosystemLockActive && semanticResolution.vector) {
    const vector = semanticResolution.vector;
    const poolWithScore = sortedPool.map((t) => ({ ...t, score: (t as unknown as { score: number }).score ?? 0 }));
    const classified = classifyPoolByEcosystem(poolWithScore as (typeof poolWithScore[number] & { trackId: string; trackName: string; artistName: string; albumName: string; energy: number | null; valence: number | null; tempo: number | null; danceability: number | null; acousticness: number | null; score: number })[], vector);
    const anchors = selectAnchorTracks(classified.primary as unknown as (typeof sortedPool[number] & { score: number })[], 10);
    anchorTrackIds = anchors.map((a) => a.trackId);
    sortedPool = hoistAnchorTracksInPool(sortedPool, anchors as unknown as typeof sortedPool);
    logScoringStage(opts.pipelineLog, "Ecosystem anchor hoisting applied", Date.now(), {
      locked: true,
      sceneId: vector.id,
      confidence: semanticResolution.confidence,
      primaryPoolSize: classified.primary.length,
      adjacentPoolSize: classified.adjacent.length,
      antiPoolSize: classified.anti.length,
      anchorsSelected: anchorTrackIds.length,
    });
  }

  const recentTrackPenalty = opts.recentPlaylistTrackIds?.length
    ? buildRecentTrackPoolPenalty(
        opts.recentPlaylistTrackIds,
        5,
        opts.varietyPenaltyScale ?? 1
      )
    : undefined;

  let t = Date.now();
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
    ecosystemVector: ecosystemLockActive ? semanticResolution.vector ?? undefined : undefined,
  });
  logScoringStage(opts.pipelineLog, "Playlist composed", t, {
    poolSize: sortedPool.length,
    finalTracks: composed.finalTracks.length,
  });

  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
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
  logScoringStage(opts.pipelineLog, "Final genre enforcement complete", t, {
    tracks: enforced.tracks.length,
  });

  // ── Ecosystem floor enforcement ──────────────────────────────────────────────
  // After composition, validate that the primary ecosystem meets the floor.
  // If it doesn't, swap out the weakest non-primary tracks for primary candidates.
  let ecosystemEnforcedTracks = enforced.tracks;
  let swapsApplied = 0;
  let rejectedAndRegenerated = false;
  let ecosystemDebug: EcosystemDebug | null = null;

  if (ecosystemLockActive && semanticResolution.vector) {
    const vector = semanticResolution.vector;

    const poolForEnforcement = (scoring.sorted as unknown as (T & { score: number })[]);
    const tracksForEnforcement = (enforced.tracks as unknown as (T & { score: number })[]);

    const result = enforceEcosystemFloor(
      tracksForEnforcement,
      poolForEnforcement,
      vector,
      1
    );
    ecosystemEnforcedTracks = result.tracks as unknown as typeof enforced.tracks;
    swapsApplied = result.swapsApplied;
    rejectedAndRegenerated = result.rejectedAndRegenerated;

    ecosystemDebug = buildEcosystemDebug({
      vector,
      sceneConfidence: semanticResolution.confidence,
      locked: ecosystemLockActive,
      pool: poolForEnforcement,
      finalTracks: result.tracks as unknown as (T & { score: number })[],
      anchorTrackIds,
      swapsApplied,
      rejectedAndRegenerated,
    });

    logScoringStage(opts.pipelineLog, "Ecosystem floor enforcement complete", t, {
      sceneId: vector.id,
      primaryShare: result.primaryShare,
      primaryFloor: vector.ecosystemFloor,
      swapsApplied,
      finalTracks: ecosystemEnforcedTracks.length,
    });
  }

  const chaos = scoring.scoringDiagnostics.controlledChaos as Record<string, unknown> | undefined;

  return {
    finalTracks: ecosystemEnforcedTracks,
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      ecosystemLock: ecosystemDebug ?? {
        locked: false,
        sceneId: semanticResolution.matchedId ?? null,
        sceneConfidence: semanticResolution.confidence,
      },
      controlledChaos: {
        ...chaos,
        emotionalPeakTrackId: composed.emotionalPeakTrackId,
        emotionalPeakIndex: composed.emotionalPeakIndex,
        gradientPhases: composed.gradientPhases,
      },
    },
    hybridExcludedCount: scoring.hybridExcludedCount,
    genreAudit: enforced.genreAudit,
    ecosystemDebug,
    composeMeta: {
      structured: composed.structured,
      poolTarget: composed.poolTarget,
      afterDeadZone: composed.afterDeadZone,
      afterSmoothing: composed.afterSmoothing,
      afterArtistSep: composed.afterArtistSep,
      afterArc: composed.afterArc,
      emotionalPeakTrackId: composed.emotionalPeakTrackId,
      emotionalPeakIndex: composed.emotionalPeakIndex,
      gradientPhases: composed.gradientPhases,
      ...(composed.signatureTrackIds && { signatureTrackIds: composed.signatureTrackIds }),
    },
  };
}
