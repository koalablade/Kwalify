import { buildFastFallbackPlaylist } from "./fast-fallback-playlist";
import type { EmotionProfile } from "./emotion";
import { buildTrackWhyReasons } from "./track-why-copy";
import type { GenreAudit } from "./genre-audit";
import type { BuildPlaylistPipelineResult } from "../core/playlist-pipeline";
import type { ScoredLibraryTrack } from "../core/scoring-engine/types";
import type { TrackScoringDebug } from "./hybrid-scoring";
import {
  warnIfV3MetadataLost,
  type V3TrackMetadata,
} from "./v3-track-contract";

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
}): BuildPlaylistPipelineResult<T> {
  const fb = buildFastFallbackPlaylist({
    tracks: opts.tracks,
    emotionProfile: opts.emotionProfile,
    playlistLength: opts.playlistLength,
    maxPerArtist: opts.maxPerArtist,
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
    ecosystemDebug: null,
  };
}

export function formatTracksForApi(
  tracks: Array<V3TrackMetadata & {
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
  }>,
  profile?: EmotionProfile | null
) {
  const formatted = (tracks ?? [])
    .filter((t) => t?.trackId && t?.trackName && t?.artistName)
    .map((t, i) => ({
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
      genrePrimary: t.genrePrimary ?? null,
      laneId: t.laneId ?? t.sourceLane ?? null,
      sourceLane: t.sourceLane ?? t.laneId ?? null,
      laneScore: t.laneScore ?? null,
      laneEra: t.laneEra ?? null,
      clusterId: t.clusterId ?? t.clusterIds?.[0] ?? null,
      clusterIds: t.clusterIds ?? (t.clusterId ? [t.clusterId] : []),
      selectedByV3: t.selectedByV3 === true ? true : undefined,
      whyReasons: buildTrackWhyReasons(t, profile, i),
    }));
  warnIfV3MetadataLost(
    tracks ?? [],
    formatted,
    "api-formatting"
  );
  return formatted;
}
