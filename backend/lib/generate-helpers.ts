import { buildFastFallbackPlaylist, FAST_SCAN_MAX } from "./fast-fallback-playlist";
import type { EmotionProfile } from "./emotion";
import { buildTrackWhyReasons } from "./track-why-copy";
import type { GenreAudit } from "./genre-audit";
import type { BuildPlaylistPipelineResult } from "../core/output";
import type { ScoredLibraryTrack } from "../core/scoring-engine/types";
import type { TrackScoringDebug } from "./hybrid-scoring";
import type { V3TrackMetadata } from "./v3-track-contract";

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
    genrePrimary?: string | null;
    genreFamily?: string | null;
    genres?: string[] | null;
  }
>(opts: {
  tracks: T[];
  emotionProfile: EmotionProfile;
  playlistLength: number;
  maxPerArtist: number;
  librarySize: number;
  genreByTrack?: (trackId: string) => {
    genrePrimary?: string | null;
    genreFamily?: string | null;
    genres?: string[] | null;
  } | null | undefined;
}): BuildPlaylistPipelineResult<T> {
  const fb = buildFastFallbackPlaylist({
    tracks: opts.tracks,
    emotionProfile: opts.emotionProfile,
    playlistLength: opts.playlistLength,
    maxPerArtist: opts.maxPerArtist,
  });
  const fbScored: Array<ScoredLibraryTrack<T> & V3TrackMetadata> = fb.map((t) => {
    const genre = opts.genreByTrack?.(t.trackId);
    const genrePrimary = t.genrePrimary ?? genre?.genrePrimary ?? undefined;
    return {
      ...t,
      genrePrimary,
      genreFamily: t.genreFamily ?? genre?.genreFamily ?? genrePrimary,
      genres: t.genres ?? genre?.genres ?? (genrePrimary ? [genrePrimary] : []),
      score: 0.72,
      rediscoveryScore: 0.35,
      scoringDebug: {
        ...fallbackScoringDebug(t.trackId),
        genrePrimary: genrePrimary ?? "unknown",
        genreConfidence: genrePrimary ? 0.7 : 0,
      },
    };
  });
  const artistCounts = fb.reduce<Record<string, number>>((acc, track) => {
    const key = track.artistName.toLowerCase().trim();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const artistCountValues = Object.values(artistCounts);
  return {
    finalTracks: fbScored,
    sorted: fbScored,
    scoringDiagnostics: {
      fastFallback: true,
      failureReason: "time_budget",
      scoringPool: {
        poolCapped: true,
        originalCount: opts.librarySize,
        scannedCount: Math.min(opts.tracks.length, FAST_SCAN_MAX),
        candidateCount: fb.length,
        maxPerArtist: opts.maxPerArtist,
        uniqueArtists: artistCountValues.length,
        repeatedArtists: artistCountValues.filter((count) => count > 1).length,
        cappedTracks: artistCountValues.reduce((sum, count) => sum + Math.max(0, count - opts.maxPerArtist), 0),
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
    danceability?: number | null;
    acousticness?: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
    releaseYear?: number | null;
    popularity?: number | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    score?: number;
    rediscoveryScore?: number;
    narrativeRole?: string;
    scoringDebug?: TrackScoringDebug;
    genreFamily?: string | null;
    genres?: string[] | null;
  }>,
  profile?: EmotionProfile | null
) {
  const formatted = (tracks ?? [])
    .filter((t) => t?.trackId && t?.trackName && t?.artistName)
    .map((t, i) => {
      const genreFromCluster = t.clusterIds
        ?.find((cluster) => cluster.startsWith("genre:"))
        ?.replace("genre:", "");
      const genrePrimary =
        t.genrePrimary ??
        (t.scoringDebug?.genrePrimary && t.scoringDebug.genrePrimary !== "unknown"
          ? t.scoringDebug.genrePrimary
          : null) ??
        genreFromCluster ??
        null;
      const genreFamily = t.genreFamily ?? genrePrimary;
      const genres = Array.isArray(t.genres) && t.genres.length > 0
        ? t.genres
        : genrePrimary
          ? [genrePrimary]
          : [];
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
        danceability: t.danceability ?? null,
        acousticness: t.acousticness ?? null,
        instrumentalness: t.instrumentalness ?? null,
        speechiness: t.speechiness ?? null,
        releaseYear: t.releaseYear ?? null,
        popularity: t.popularity ?? null,
        spotifyArtistGenres: Array.isArray(t.spotifyArtistGenres) ? t.spotifyArtistGenres : [],
        albumGenres: Array.isArray(t.albumGenres) ? t.albumGenres : [],
        score: Math.round((t.score ?? 0.7) * 100) / 100,
        rediscoveryScore: Math.round((t.rediscoveryScore ?? 0) * 100) / 100,
        narrativeRole: t.narrativeRole,
        genrePrimary,
        genreFamily,
        genres,
        laneId: t.laneId ?? t.sourceLane ?? null,
        sourceLane: t.sourceLane ?? t.laneId ?? null,
        laneScore: t.laneScore ?? null,
        laneEra: t.laneEra ?? null,
        clusterId: t.clusterId ?? t.clusterIds?.[0] ?? null,
        clusterIds: t.clusterIds ?? (t.clusterId ? [t.clusterId] : []),
        selectedByV3: t.selectedByV3 === true ? true : undefined,
        whyReasons: buildTrackWhyReasons(t, profile, i),
      };
    });
  return formatted;
}
