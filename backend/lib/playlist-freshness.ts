/**
 * Anti-repetition: soft cooldowns — never hard-ban, progressively reduce weight.
 */

import type { EmotionProfile } from "./emotion";

export interface PlaylistHistoryRow {
  vibe: string;
  trackIds: string[] | null;
  emotionProfile?: EmotionProfile | null;
  createdAt?: Date | string;
}

export interface FreshnessStats {
  trackAppearances: Map<string, number>;
  artistAppearances: Map<string, number>;
  albumAppearances: Map<string, number>;
  recentSceneFingerprints: string[];
  playlistsScanned: number;
}

/** Progressive track cooldown: recent playlists should not dominate the next pick. */
export function trackCooldownMultiplier(appearances: number): number {
  if (appearances <= 0) return 1;
  if (appearances === 1) return 0.40;
  if (appearances === 2) return 0.24;
  if (appearances === 3) return 0.15;
  return 0.08;
}

/** Artist used heavily across recent playlists. */
export function artistCooldownMultiplier(appearances: number): number {
  if (appearances <= 0) return 1;
  if (appearances === 1) return 0.88;
  if (appearances === 2) return 0.72;
  if (appearances === 3) return 0.56;
  return 0.42;
}

export function albumCooldownMultiplier(appearances: number): number {
  if (appearances <= 0) return 1;
  if (appearances === 1) return 0.88;
  if (appearances === 2) return 0.72;
  return 0.55;
}

/** Emotional journey arc recently used — soft penalty. */
export function journeyArcCooldownMultiplier(recentArcCount: number): number {
  if (recentArcCount <= 0) return 1;
  if (recentArcCount === 1) return 0.94;
  if (recentArcCount === 2) return 0.88;
  return 0.82;
}

function sceneFingerprint(vibe: string, profile?: EmotionProfile | null): string {
  const p = profile;
  const parts = [
    vibe.slice(0, 80).toLowerCase().replace(/\s+/g, " "),
    p?.timeOfDay ?? "",
    p?.environment ?? "",
    Math.round((p?.energy ?? 0.5) * 10),
    Math.round((p?.nostalgia ?? 0.2) * 10),
    Math.round((p?.valence ?? 0.5) * 10),
  ];
  return parts.join("|");
}

export function countRecentJourneyArc(
  history: PlaylistHistoryRow[],
  arc: string,
  maxPlaylists = 8
): number {
  let n = 0;
  for (const pl of history.slice(0, maxPlaylists)) {
    const ep = pl.emotionProfile as { journeyArc?: string } | null;
    if (ep?.journeyArc === arc) n++;
  }
  return n;
}

export function buildFreshnessStats(
  history: PlaylistHistoryRow[],
  maxPlaylists = 20
): FreshnessStats {
  const trackAppearances = new Map<string, number>();
  const artistAppearances = new Map<string, number>();
  const albumAppearances = new Map<string, number>();
  const recentSceneFingerprints: string[] = [];

  const slice = history.slice(0, maxPlaylists);
  for (const pl of slice) {
    const ids = (pl.trackIds as string[]) ?? [];
    for (const id of ids) {
      trackAppearances.set(id, (trackAppearances.get(id) ?? 0) + 1);
    }
    recentSceneFingerprints.push(sceneFingerprint(pl.vibe, pl.emotionProfile as EmotionProfile | null));
  }

  return {
    trackAppearances,
    artistAppearances,
    albumAppearances,
    recentSceneFingerprints,
    playlistsScanned: slice.length,
  };
}

/** Build artist appearance counts from history track IDs + library artist map. */
export function buildArtistAppearanceMap(
  history: PlaylistHistoryRow[],
  trackIdToArtist: Map<string, string>,
  maxPlaylists = 12
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pl of history.slice(0, maxPlaylists)) {
    const ids = (pl.trackIds as string[]) ?? [];
    const artistsInPl = new Set<string>();
    for (const id of ids) {
      const artist = trackIdToArtist.get(id);
      if (artist) artistsInPl.add(artist.toLowerCase());
    }
    for (const a of artistsInPl) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildAlbumAppearanceMap(
  history: PlaylistHistoryRow[],
  trackIdToAlbum: Map<string, string>,
  maxPlaylists = 12
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pl of history.slice(0, maxPlaylists)) {
    const ids = (pl.trackIds as string[]) ?? [];
    const albumsInPl = new Set<string>();
    for (const id of ids) {
      const album = trackIdToAlbum.get(id);
      if (album) albumsInPl.add(album.toLowerCase());
    }
    for (const a of albumsInPl) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  return counts;
}

/** Near-identical vibe/scene combo used recently — light anti-clone on all scores. */
export function sceneClonePenalty(
  vibe: string,
  profile: EmotionProfile,
  recentFingerprints: string[],
  experienceSceneId?: string | null
): number {
  const fp = `${sceneFingerprint(vibe, profile)}|${experienceSceneId ?? ""}`;
  let hits = 0;
  for (const r of recentFingerprints.slice(0, 6)) {
    if (r === fp || (r.length > 20 && fp.startsWith(r.slice(0, 40)))) hits++;
  }
  if (hits >= 2) return 0.88;
  if (hits >= 1) return 0.94;
  return 1;
}

/** Penalty for hybrid pool pre-filter (last playlists weighted heavier). */
export function buildRecentTrackPoolPenalty(
  recentPlaylistTrackIds: string[][],
  maxPlaylists = 5,
  scale = 1
): Map<string, number> {
  const map = new Map<string, number>();
  for (const [i, ids] of recentPlaylistTrackIds.slice(0, maxPlaylists).entries()) {
    const weight = (i === 0 ? 0.26 : i === 1 ? 0.17 : 0.10) * scale;
    for (const id of ids) {
      map.set(id, (map.get(id) ?? 0) + weight);
    }
  }
  return map;
}

export function applyFreshnessToScore(
  baseScore: number,
  opts: {
    trackId: string;
    artistName: string;
    albumName: string;
    stats: FreshnessStats;
    artistAppearances: Map<string, number>;
    albumAppearances: Map<string, number>;
    globalCloneMultiplier: number;
  }
): number {
  const trackMult = trackCooldownMultiplier(
    opts.stats.trackAppearances.get(opts.trackId) ?? 0
  );
  const artistMult = artistCooldownMultiplier(
    opts.artistAppearances.get(opts.artistName.toLowerCase()) ?? 0
  );
  const albumMult = albumCooldownMultiplier(
    opts.albumAppearances.get(opts.albumName.toLowerCase()) ?? 0
  );
  const broadTasteMultiplier = artistMult * albumMult * opts.globalCloneMultiplier;
  return baseScore * trackMult * Math.max(0.72, broadTasteMultiplier);
}
