/**
 * V15 layered world retrieval — anchor → neighbours → taste → Spotify expansion.
 * Score-first inside cultural boundaries; never indie fallback.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  extractAnchorArtistNames,
  extractAdjacentArtistNames,
  extractMajorArtistNames,
  getCulturalProfile,
  matchesAvoidArtist,
} from "./cultural-identity-profile";
import { getNeighbourWorlds } from "./world-neighbour-graph";
import {
  artistForbiddenInWorld,
  artistSupportsWorld,
  resolveArtistWorldIdentity,
} from "./artist-identity-map";
import {
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { isUnknownGenreMetadata, resolveWorldSearchKeywords } from "./world-search-keywords";
import { markFunnelRecovery } from "./retrieval-funnel-trace";

export type LayeredRetrievalInput = {
  prompt: string;
  userLibrary: WorldIdentityTrack[];
  culturalProfile: CulturalWorldProfile;
  committedWorld: CommittedWorld;
  expansionCandidates?: WorldIdentityTrack[];
  minWorldScore?: number;
};

export type LayeredRetrievalResult = {
  tracks: WorldIdentityTrack[];
  layerCounts: Record<string, number>;
  searchKeywords: string[];
  recoveryUsed: boolean;
  recoveryLayer: string | null;
};

type ScoredTrack = { track: WorldIdentityTrack; score: number; layer: string };

const DEFAULT_MIN_WORLD_SCORE = 0.45;

function trackId(track: WorldIdentityTrack): string {
  return String(
    (track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`,
  );
}

function normalizeArtist(artist: string): string {
  return artist.toLowerCase().trim();
}

function scoreForLayer(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  layer: string,
  baseScore: number,
): ScoredTrack {
  const worldScore = scoreTrackWorldIdentity(track, profile);
  const layerBoost =
    layer === "anchor" ? 0.15 : layer === "neighbour" ? 0.08 : layer === "taste" ? 0.05 : 0.03;
  return { track, score: worldScore * 0.85 + baseScore * 0.1 + layerBoost, layer };
}

function matchesKeywordBlob(track: WorldIdentityTrack, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const blob = [
    track.artistName ?? "",
    track.albumName ?? "",
    track.trackName ?? "",
    track.genreFamily ?? "",
    track.genrePrimary ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .join(" ")
    .toLowerCase();
  return keywords.some((kw) => blob.includes(kw.toLowerCase()));
}

function passesCulturalBoundary(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  worldIds: string[],
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (!artist) return false;
  if (matchesAvoidArtist(artist, profile)) return false;
  if (artistForbiddenInWorld(artist, worldIds)) return false;
  return true;
}

/** Layer 1: exact world anchor artists from cultural profile. */
function layerAnchorArtists(
  library: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
): ScoredTrack[] {
  const anchors = new Set(
    extractAnchorArtistNames(profile).map((a) => normalizeArtist(a)),
  );
  const out: ScoredTrack[] = [];
  for (const track of library) {
    const artist = normalizeArtist(String(track.artistName ?? ""));
    if (!artist || !anchors.has(artist)) continue;
    if (!passesCulturalBoundary(track, profile, worldIds)) continue;
    out.push(scoreForLayer(track, profile, "anchor", 1));
  }
  return out;
}

/** Layer 2: cultural neighbours via world-neighbour-graph anchor lists. */
function layerCulturalNeighbours(
  library: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
): ScoredTrack[] {
  const neighbourIds = getNeighbourWorlds(profile.worldId);
  const neighbourArtists = new Set<string>();
  for (const neighbourId of neighbourIds) {
    const neighbourProfile = getCulturalProfile(neighbourId);
    if (!neighbourProfile) continue;
    for (const name of extractAdjacentArtistNames(neighbourProfile)) {
      neighbourArtists.add(normalizeArtist(name));
    }
    for (const name of extractMajorArtistNames(neighbourProfile)) {
      neighbourArtists.add(normalizeArtist(name));
    }
  }
  const out: ScoredTrack[] = [];
  for (const track of library) {
    const artist = normalizeArtist(String(track.artistName ?? ""));
    if (!artist || !neighbourArtists.has(artist)) continue;
    if (!passesCulturalBoundary(track, profile, worldIds)) continue;
    out.push(scoreForLayer(track, profile, "neighbour", 0.75));
  }
  return out;
}

/** Layer 3: user taste matching by artist/album/era/cultural identity keywords. */
function layerUserTasteMatch(
  library: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
  prompt: string,
  keywords: string[],
): ScoredTrack[] {
  const adjacent = new Set(
    extractAdjacentArtistNames(profile).map((a) => normalizeArtist(a)),
  );
  const out: ScoredTrack[] = [];
  for (const track of library) {
    if (!passesCulturalBoundary(track, profile, worldIds)) continue;
    const artist = normalizeArtist(String(track.artistName ?? ""));
    const identity = resolveArtistWorldIdentity(artist);
    const identityMatch = identity?.naturalWorlds.some((w) => worldIds.includes(w)) ?? false;
    const adjacentMatch = adjacent.has(artist);
    const keywordMatch = matchesKeywordBlob(track, keywords);
    const eraMatch =
      typeof track.releaseYear === "number" &&
      profile.preferredEras.min != null &&
      track.releaseYear >= profile.preferredEras.min - 3 &&
      (profile.preferredEras.max == null || track.releaseYear <= profile.preferredEras.max + 3);
    if (!identityMatch && !adjacentMatch && !keywordMatch && !eraMatch) continue;

    // V15: unknown metadata is unknown — score via artist identity, not indie default
    const unknownMeta = isUnknownGenreMetadata(track.genreFamily, track.genrePrimary);
    const base = unknownMeta && identityMatch ? 0.7 : identityMatch ? 0.65 : keywordMatch ? 0.55 : 0.45;
    out.push(scoreForLayer(track, profile, "taste", base));
  }
  return out;
}

/** Layer 4: approved Spotify anchor expansion candidates. */
function layerSpotifyExpansion(
  expansion: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
  minScore: number,
): ScoredTrack[] {
  const out: ScoredTrack[] = [];
  for (const track of expansion) {
    if (!passesCulturalBoundary(track, profile, worldIds)) continue;
    const worldScore = scoreTrackWorldIdentity(track, profile);
    if (worldScore < minScore) continue;
    out.push(scoreForLayer(track, profile, "spotify_anchor", worldScore));
  }
  return out;
}

function mergeDedupeRank(scored: ScoredTrack[]): WorldIdentityTrack[] {
  const byId = new Map<string, ScoredTrack>();
  for (const row of scored) {
    const id = trackId(row.track);
    const existing = byId.get(id);
    if (!existing || row.score > existing.score) byId.set(id, row);
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .map((row) => row.track);
}

/** Run layered retrieval — merge, dedupe, score, rank. */
export function runLayeredWorldRetrieval(input: LayeredRetrievalInput): LayeredRetrievalResult {
  const {
    prompt,
    userLibrary,
    culturalProfile,
    committedWorld,
    expansionCandidates = [],
    minWorldScore = DEFAULT_MIN_WORLD_SCORE,
  } = input;
  const worldIds = committedWorld.worldIds ?? [committedWorld.id];
  const keywords = resolveWorldSearchKeywords(prompt, culturalProfile.worldId);

  const layer1 = layerAnchorArtists(userLibrary, culturalProfile, worldIds);
  const layer2 = layerCulturalNeighbours(userLibrary, culturalProfile, worldIds);
  const layer3 = layerUserTasteMatch(userLibrary, culturalProfile, worldIds, prompt, keywords);
  const layer4 = layerSpotifyExpansion(expansionCandidates, culturalProfile, worldIds, minWorldScore);

  const merged = mergeDedupeRank([...layer1, ...layer2, ...layer3, ...layer4]);
  const filtered = merged.filter(
    (t) => scoreTrackWorldIdentity(t, culturalProfile) >= minWorldScore || isAnchorArtistForProfile(t.artistName, culturalProfile),
  );

  return {
    tracks: filtered.length > 0 ? filtered : merged,
    layerCounts: {
      anchor: layer1.length,
      neighbour: layer2.length,
      taste: layer3.length,
      spotify_anchor: layer4.length,
      merged: merged.length,
      afterWorldScore: filtered.length,
    },
    searchKeywords: keywords,
    recoveryUsed: false,
    recoveryLayer: null,
  };
}

/** V15 none-playlist recovery — run before returning 0 tracks. */
export function runNonePlaylistRecovery(input: LayeredRetrievalInput): LayeredRetrievalResult {
  const {
    prompt,
    userLibrary,
    culturalProfile,
    committedWorld,
    expansionCandidates = [],
    minWorldScore = DEFAULT_MIN_WORLD_SCORE,
  } = input;
  const worldIds = committedWorld.worldIds ?? [committedWorld.id];
  const keywords = resolveWorldSearchKeywords(prompt, culturalProfile.worldId);
  const seen = new Set<string>();
  const recovered: ScoredTrack[] = [];

  const push = (tracks: ScoredTrack[], layer: string) => {
    for (const row of tracks) {
      const id = trackId(row.track);
      if (seen.has(id)) continue;
      seen.add(id);
      recovered.push({ ...row, layer });
    }
    if (tracks.length > 0) markFunnelRecovery(layer);
  };

  // 1. Expand world neighbours
  const neighbourIds = getNeighbourWorlds(culturalProfile.worldId);
  for (const neighbourId of neighbourIds) {
    const neighbourProfile = getCulturalProfile(neighbourId);
    if (!neighbourProfile) continue;
    const neighbourAnchors = layerAnchorArtists(userLibrary, neighbourProfile, worldIds);
    push(neighbourAnchors, `recovery_neighbour:${neighbourId}`);
  }

  // 2. Search artist identity database
  for (const track of userLibrary) {
    const artist = String(track.artistName ?? "").trim();
    if (!artist) continue;
    if (!artistSupportsWorld(artist, worldIds)) continue;
    if (!passesCulturalBoundary(track, culturalProfile, worldIds)) continue;
    push([scoreForLayer(track, culturalProfile, "recovery_identity", 0.72)], "recovery_identity");
  }

  // 3. Search albums by anchor artists
  const anchorNames = extractAnchorArtistNames(culturalProfile).map(normalizeArtist);
  for (const track of userLibrary) {
    const artist = normalizeArtist(String(track.artistName ?? ""));
    const album = String(track.albumName ?? "").toLowerCase();
    if (!anchorNames.some((a) => artist.includes(a) || album.includes(a))) continue;
    if (!passesCulturalBoundary(track, culturalProfile, worldIds)) continue;
    push([scoreForLayer(track, culturalProfile, "recovery_album", 0.68)], "recovery_album");
  }

  // 4. Search user library without genre metadata (artist name match only)
  for (const track of userLibrary) {
    if (!isUnknownGenreMetadata(track.genreFamily, track.genrePrimary)) continue;
    const artist = String(track.artistName ?? "").trim();
    if (!artist) continue;
    if (!passesCulturalBoundary(track, culturalProfile, worldIds)) continue;
    const identity = resolveArtistWorldIdentity(artist);
    const keywordHit = matchesKeywordBlob(track, keywords);
    if (!identity && !keywordHit) continue;
    if (identity?.forbiddenWorlds.some((w) => worldIds.includes(w))) continue;
    push([scoreForLayer(track, culturalProfile, "recovery_no_genre", 0.5)], "recovery_no_genre");
  }

  // 5. Spotify catalogue anchors
  push(
    layerSpotifyExpansion(expansionCandidates, culturalProfile, worldIds, minWorldScore * 0.9),
    "recovery_spotify",
  );

  const tracks = mergeDedupeRank(recovered);
  const lastLayer = recovered.length > 0 ? recovered[recovered.length - 1]!.layer : null;

  return {
    tracks,
    layerCounts: {
      recovery_total: recovered.length,
      recovery_unique: tracks.length,
    },
    searchKeywords: keywords,
    recoveryUsed: tracks.length > 0,
    recoveryLayer: lastLayer,
  };
}

/** Run layered retrieval with automatic none-recovery when pool is empty. */
export function retrieveWithRecovery(input: LayeredRetrievalInput): LayeredRetrievalResult {
  const primary = runLayeredWorldRetrieval(input);
  if (primary.tracks.length > 0) return primary;
  const recovery = runNonePlaylistRecovery(input);
  return { ...recovery, recoveryUsed: true };
}
