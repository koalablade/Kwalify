import { buildFastFallbackPlaylist } from "./fast-fallback-playlist";
import type { EmotionProfile } from "./emotion";
import type { GenreAudit } from "./genre-audit";
import type { BuildPlaylistPipelineResult } from "../core/playlist-pipeline";

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
  const fbScored = fb.map((t) => ({
    ...t,
    score: 0.72,
    rediscoveryScore: 0.35,
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
  }>
) {
  return (tracks ?? [])
    .filter((t) => t?.trackId && t?.trackName && t?.artistName)
    .map((t) => ({
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
    }));
}
