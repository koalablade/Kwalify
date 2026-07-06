import { buildFastFallbackPlaylist, type FastFallbackSceneContext } from "./fast-fallback-playlist";
import type { EmotionProfile, VibeKind } from "./emotion";
import type { ScenePrototype } from "./scene-prototypes";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { HumanIntent } from "./intent-decoder";
import { resolveSceneContext } from "./scene-validation";
import { buildSceneSeasonContext } from "./seasonal-logic";
import { parsePromptNegatives } from "./prompt-negatives";
import { resolveContradiction } from "../core/scene-intelligence/contradiction-handler";
import { buildTrackWhyReasons } from "./track-why-copy";
import {
  buildTrackMatchMetadata,
  trackMatchReasonLabel,
} from "./track-match-metadata";
import { trackRoleLabel, type TrackRole } from "./emotional-sequencing";
import type { GenreAudit } from "./genre-audit";
import type { BuildPlaylistPipelineResult } from "../core/playlist-pipeline";
import type { ScoredLibraryTrack } from "../core/scoring-engine/types";
import type { TrackScoringDebug } from "./hybrid-scoring";

function fallbackScoringDebug(trackId: string): TrackScoringDebug {
  return {
    trackId,
    sceneScore: 0.72,
    libraryFitScore: 0.72,
    genreBalanceScore: 0.5,
    sceneMatch: 0.72,
    emotionMatch: 0.72,
    genreMatch: 0.5,
    memoryMatch: 0.35,
    noveltyScore: 0.35,
    seasonalMatch: 0.5,
    moodPurity: 0.5,
    genrePrimary: "unknown",
    genreConfidence: 0,
    genreLocked: false,
    excludedBy: null,
    finalScore: 0.72,
  };
}

export function buildFastFallbackSceneContext(opts: {
  vibe: string;
  emotionProfile: EmotionProfile;
  prototype: ScenePrototype | null;
  canonicalScene: CanonicalSceneResult | null;
  humanIntent: HumanIntent;
  vibeKind: VibeKind;
  emotionalComplexity?: boolean;
}): FastFallbackSceneContext {
  const promptNegatives = parsePromptNegatives(opts.vibe);
  const sceneCtx = resolveSceneContext(opts.vibe, opts.canonicalScene, opts.emotionProfile);
  const season = buildSceneSeasonContext(opts.vibe);
  const contradiction = resolveContradiction(opts.vibe, opts.emotionProfile);

  return {
    vibe: opts.vibe,
    emotionProfile: opts.emotionProfile,
    prototype: opts.prototype,
    promptNegatives,
    hardFilterCtx: {
      vibe: opts.vibe,
      intent: opts.humanIntent,
      sceneFamily: sceneCtx.primary,
      season,
      prototype: opts.prototype,
      allowContrast: contradiction.active || season.allowContrast,
      allowEnergyMismatch: 0.35,
      emotionalComplexity: !!opts.emotionalComplexity,
      vibeKind: opts.vibeKind,
      promptNegatives,
    },
  };
}

export function buildFallbackPipelineResult<
  T extends {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    albumArt?: string | null;
    durationMs?: number | null;
    energy: number | null;
    valence: number | null;
    tempo?: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    score?: number;
    rediscoveryScore?: number;
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist: number;
  librarySize: number;
  sceneContext?: FastFallbackSceneContext;
}): BuildPlaylistPipelineResult<T> {
  const fb = buildFastFallbackPlaylist({
    tracks: opts.tracks,
    emotionProfile: opts.emotionProfile,
    playlistLength: opts.playlistLength,
    maxPerArtist: opts.maxPerArtist,
    scene: opts.sceneContext,
  });
  const fbScored: ScoredLibraryTrack<T>[] = fb.map((t) => ({
    ...t,
    score: 0.72,
    rediscoveryScore: 0.35,
    scoringDebug: fallbackScoringDebug(t.trackId),
  }));
  return {
    finalTracks: fbScored,
    sorted: fbScored,
    scoringDiagnostics: {
      fastFallback: true,
      failureReason: "time_budget",
      scoringPool: {
        poolCapped: true,
        originalCount: opts.librarySize,
        candidateCount: fb.length,
      },
    },
    hybridExcludedCount: 0,
    genreAudit: {
      detectedGenres: [],
      missingGenres: [],
      distribution: {},
      userDistribution: {},
      adjustmentsApplied: ["fast_fallback"],
      finalDistribution: {},
      coverageTargets: [],
    } as GenreAudit,
    composeMeta: {
      structured: fbScored,
      poolTarget: opts.playlistLength,
      afterDeadZone: fbScored,
      afterSmoothing: fbScored,
      afterArtistSep: fbScored,
      afterArc: fbScored,
      emotionalPeakTrackId: null,
      emotionalPeakIndex: null,
      gradientPhases: { start: 0, explore: 0, peak: 0, resolve: 0 },
    },
  };
}

export function formatTracksForApi(
  tracks: Array<{
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    albumArt?: string | null;
    durationMs?: number | null;
    energy?: number | null;
    valence?: number | null;
    tempo?: number | null;
    score?: number;
    rediscoveryScore?: number;
    narrativeRole?: string;
    trackRole?: TrackRole;
    emphasisAnchor?: boolean;
    scoringDebug?: import("./hybrid-scoring").TrackScoringDebug | null;
  }>,
  profile?: EmotionProfile | null,
  opts?: { fastFallback?: boolean }
) {
  return (tracks ?? [])
    .filter((t) => t?.trackId && t?.trackName && t?.artistName)
    .map((t, i) => {
      const match = buildTrackMatchMetadata({
        score: t.score,
        scoringDebug: t.scoringDebug,
        fastFallback: opts?.fastFallback,
        narrativeRole: t.narrativeRole,
      });
      return {
      id: t.trackId,
      name: t.trackName,
      artist: t.artistName,
      album: t.albumName ?? "",
      albumArt: t.albumArt ?? null,
      durationMs: t.durationMs ?? null,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      tempo: t.tempo ?? null,
      score: Math.round((t.score ?? 0.7) * 100) / 100,
      rediscoveryScore: Math.round((t.rediscoveryScore ?? 0) * 100) / 100,
      narrativeRole: t.narrativeRole,
      trackRole: t.trackRole ?? null,
      trackRoleLabel: t.trackRole ? trackRoleLabel(t.trackRole) : null,
      matchStrength: match.matchStrength,
      matchReason: match.reason,
      matchReasonLabel: trackMatchReasonLabel(match.reason),
      whyReasons: buildTrackWhyReasons(t, profile, i),
    };
    });
}

export function buildCachedGenerateResponse(cached: import("./generate-result-cache").CachedGeneratePayload) {
  return {
    success: true,
    cached: true,
    tracks: formatTracksForApi(cached.finalTracks, cached.emotionProfile),
    playlistName: cached.playlistName,
    name: cached.playlistName,
    vibe: cached.vibe,
    mode: cached.mode,
    count: cached.finalTracks.length,
    totalTracks: cached.finalTracks.length,
    emotionProfile: cached.emotionProfile,
    ...(cached.spotifyPlaylistUrl
      ? { spotifyPlaylistUrl: cached.spotifyPlaylistUrl }
      : { spotifyUnavailable: true as const }),
  };
}
