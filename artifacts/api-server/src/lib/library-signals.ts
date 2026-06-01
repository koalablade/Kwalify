/**
 * Per-user library signals derived from liked_songs + playlist_history.
 * No new DB columns required — computed at generation time.
 */

import type { EmotionProfile } from "./emotion";
import type { PlaylistHistoryRow } from "./playlist-freshness";

export interface LikedSongRow {
  trackId: string;
  artistName: string;
  albumName: string;
  addedAt: Date | null;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
}

export interface TrackLibrarySignal {
  trackId: string;
  artistKey: string;
  albumKey: string;
  dateLiked: Date | null;
  lastSurfacedAt: Date | null;
  daysSinceSurfaced: number | null;
  playlistAppearances: number;
  artistPlaylistAppearances: number;
  artistLibraryCount: number;
  artistUnderused: boolean;
}

export interface LibrarySignals {
  tracks: Map<string, TrackLibrarySignal>;
  artistPlaylistCounts: Map<string, number>;
  artistLibraryCounts: Map<string, number>;
  recentJourneyArcs: string[];
  playlistsScanned: number;
}

const MS_DAY = 24 * 60 * 60 * 1000;

export function buildLibrarySignals(
  songs: LikedSongRow[],
  history: PlaylistHistoryRow[],
  maxPlaylists = 30,
  now = Date.now()
): LibrarySignals {
  const artistLibraryCounts = new Map<string, number>();
  const trackArtistById = new Map<string, string>();
  for (const s of songs) {
    const k = s.artistName.toLowerCase();
    artistLibraryCounts.set(k, (artistLibraryCounts.get(k) ?? 0) + 1);
    trackArtistById.set(s.trackId, k);
  }

  const trackAppearances = new Map<string, number>();
  const trackLastSurfaced = new Map<string, Date>();
  const artistPlaylistCounts = new Map<string, number>();
  const recentJourneyArcs: string[] = [];

  const slice = history.slice(0, maxPlaylists);
  for (const pl of slice) {
    const created =
      pl.createdAt instanceof Date
        ? pl.createdAt
        : pl.createdAt
          ? new Date(pl.createdAt)
          : new Date(now);
    const ids = (pl.trackIds as string[]) ?? [];
    const artistsInPl = new Set<string>();

    const idSet = new Set(ids);
    for (const id of idSet) {
      trackAppearances.set(id, (trackAppearances.get(id) ?? 0) + 1);
      const prev = trackLastSurfaced.get(id);
      if (!prev || created > prev) trackLastSurfaced.set(id, created);
    }

    for (const id of idSet) {
      const artist = trackArtistById.get(id);
      if (artist) artistsInPl.add(artist);
    }
    for (const a of artistsInPl) {
      artistPlaylistCounts.set(a, (artistPlaylistCounts.get(a) ?? 0) + 1);
    }

    const ep = pl.emotionProfile as EmotionProfile & { journeyArc?: string } | null;
    if (ep && typeof (ep as any).journeyArc === "string") {
      recentJourneyArcs.push((ep as any).journeyArc);
    }
  }

  const tracks = new Map<string, TrackLibrarySignal>();
  for (const s of songs) {
    const artistKey = s.artistName.toLowerCase();
    const last = trackLastSurfaced.get(s.trackId) ?? null;
    const daysSinceSurfaced = last
      ? Math.floor((now - last.getTime()) / MS_DAY)
      : null;

    const libCount = artistLibraryCounts.get(artistKey) ?? 1;
    const plArtist = artistPlaylistCounts.get(artistKey) ?? 0;

    tracks.set(s.trackId, {
      trackId: s.trackId,
      artistKey,
      albumKey: s.albumName.toLowerCase(),
      dateLiked: s.addedAt,
      lastSurfacedAt: last,
      daysSinceSurfaced,
      playlistAppearances: trackAppearances.get(s.trackId) ?? 0,
      artistPlaylistAppearances: plArtist,
      artistLibraryCount: libCount,
      artistUnderused: libCount >= 3 && plArtist === 0,
    });
  }

  return {
    tracks,
    artistPlaylistCounts,
    artistLibraryCounts,
    recentJourneyArcs,
    playlistsScanned: slice.length,
  };
}
