/**
 * V14 world anchor retrieval — exhausted tier expansion until target or pool dry.
 * liked → anchors → major → deep cuts → forgotten → cult → era → neighbours (no emotion).
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  extractAnchorArtistNames,
  extractAdjacentArtistNames,
  extractMajorArtistNames,
  extractDeepCutNames,
  extractForgottenArtistNames,
  extractCultArtistNames,
  extractEraExtensionNames,
  getPriorityAnchorOrder,
  matchesAvoidArtist,
  getCulturalProfile,
} from "./cultural-identity-profile";
import {
  scoreTrackWorldIdentity,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { artistForbiddenInWorld } from "./artist-identity-map";
import type { CommittedWorld } from "../committed-world";
import { searchSpotifyTracks, type SpotifyTrack } from "../../lib/spotify";
import { getNeighbourWorlds } from "./world-neighbour-graph";
import {
  recordRetrievalRejection,
  diagnoseRetrievalShortfall,
  type RejectionStage,
} from "./retrieval-rejection-trace";

export type WorldAnchorRetrievalInput = {
  accessToken?: string | null;
  userLibrary: WorldIdentityTrack[];
  culturalProfile: CulturalWorldProfile;
  committedWorld: CommittedWorld;
  maxCandidates?: number;
  targetCount?: number;
  targetValidCount?: number;
  userDislikedArtists?: Set<string>;
  maxPerArtist?: number;
  /** V15: run every retrieval tier before delivery decision. */
  exhaustAllTiers?: boolean;
};

export type WorldAnchorRetrievalResult = {
  tracks: WorldIdentityTrack[];
  diagnostics: {
    libraryWorldFits: number;
    libraryAdjacent: number;
    spotifyQueries: string[];
    spotifyRawCount: number;
    spotifyFilteredCount: number;
    mergedCount: number;
    tierCounts: Record<string, number>;
    neighbourExpansion: number;
    diversityCapped: number;
    exhausted: boolean;
    shortfallSuggestions: string[];
  };
};

const MIN_WORLD_SCORE = 0.5;
const OPENER_WORLD_SCORE = 0.8;
const DEFAULT_MAX_PER_ARTIST = 3;
const PURITY_RETRIEVAL_MIN = 0.8;

type RetrievalTier =
  | "liked"
  | "anchors"
  | "major"
  | "deep_cuts"
  | "forgotten"
  | "cult"
  | "era_extensions"
  | "neighbours";

const TIER_ORDER: RetrievalTier[] = [
  "liked",
  "anchors",
  "major",
  "deep_cuts",
  "forgotten",
  "cult",
  "era_extensions",
  "neighbours",
];

function normalizeArtistKey(artist: string): string {
  return artist.toLowerCase().trim();
}

function trackIdOf(track: WorldIdentityTrack): string {
  return String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
}

function spotifyTrackToCandidate(track: SpotifyTrack): WorldIdentityTrack & { trackId: string } {
  const artistName = track.artists?.[0]?.name ?? "";
  const releaseYear = track.album?.release_date
    ? Number.parseInt(String(track.album.release_date).slice(0, 4), 10)
    : null;
  return {
    trackId: track.id,
    trackName: track.name,
    artistName,
    albumName: track.album?.name ?? "",
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : null,
    popularity: track.popularity ?? null,
    spotifyArtistGenres: null,
  };
}

function trackPassesWorldFilter(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  worldIds: string[],
  minScore = MIN_WORLD_SCORE,
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (!artist) return false;
  if (matchesAvoidArtist(artist, profile)) return false;
  if (artistForbiddenInWorld(artist, worldIds)) return false;
  return scoreTrackWorldIdentity(track, profile) >= minScore;
}

function recordFilterRejections(
  candidates: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
  worldId: string,
  stage: RejectionStage,
  minScore: number,
  retrievalSource: string,
): WorldIdentityTrack[] {
  const kept: WorldIdentityTrack[] = [];
  for (const track of candidates) {
    const artist = String(track.artistName ?? "").trim();
    if (!artist) {
      recordRetrievalRejection({
        worldId,
        artistName: "?",
        trackName: String(track.trackName ?? "?"),
        reason: "missing_artist",
        stage,
        retrievalSource,
      });
      continue;
    }
    if (matchesAvoidArtist(artist, profile)) {
      recordRetrievalRejection({
        worldId,
        artistName: artist,
        trackName: String(track.trackName ?? "?"),
        reason: "avoid_artist",
        stage,
        retrievalSource,
        worldIdentityScore: scoreTrackWorldIdentity(track, profile),
      });
      continue;
    }
    if (artistForbiddenInWorld(artist, worldIds)) {
      recordRetrievalRejection({
        worldId,
        artistName: artist,
        trackName: String(track.trackName ?? "?"),
        reason: "forbidden_in_world",
        stage,
        retrievalSource,
      });
      continue;
    }
    const score = scoreTrackWorldIdentity(track, profile);
    if (score < minScore) {
      recordRetrievalRejection({
        worldId,
        artistName: artist,
        trackName: String(track.trackName ?? "?"),
        reason: `below_min_score_${minScore}`,
        stage,
        retrievalSource,
        worldIdentityScore: score,
      });
      continue;
    }
    kept.push(track);
  }
  return kept;
}

/** Build Spotify search queries from cultural profile anchor + adjacent artists. */
export function buildAnchorSearchQueries(profile: CulturalWorldProfile): string[] {
  const anchors = getPriorityAnchorOrder(profile);
  const adjacent = extractAdjacentArtistNames(profile);
  const queries: string[] = [];

  for (const name of anchors.slice(0, 6)) {
    queries.push(`artist:"${name}"`);
  }
  for (const name of adjacent.slice(0, 4)) {
    queries.push(`artist:"${name}"`);
  }

  return [...new Set(queries)].slice(0, 10);
}

function artistNamesForTier(profile: CulturalWorldProfile, tier: RetrievalTier, neighbourId?: string): string[] {
  if (tier === "neighbours" && neighbourId) {
    const neighbourProfile = getCulturalProfile(neighbourId);
    if (!neighbourProfile) return [];
    return [
      ...extractAnchorArtistNames(neighbourProfile).slice(0, 3),
      ...extractDeepCutNames(neighbourProfile).slice(0, 3),
      ...extractMajorArtistNames(neighbourProfile).slice(0, 2),
    ];
  }
  switch (tier) {
    case "anchors":
      return getPriorityAnchorOrder(profile);
    case "major":
      return extractMajorArtistNames(profile);
    case "deep_cuts":
      return extractDeepCutNames(profile);
    case "forgotten":
      return extractForgottenArtistNames(profile);
    case "cult":
      return extractCultArtistNames(profile);
    case "era_extensions":
      return extractEraExtensionNames(profile);
    default:
      return [];
  }
}

function buildTierQueries(profile: CulturalWorldProfile, tier: RetrievalTier, neighbourId?: string): string[] {
  const names = artistNamesForTier(profile, tier, neighbourId);
  return [...new Set(names.map((n) => `artist:"${n}"`))].slice(0, tier === "anchors" ? 8 : 6);
}

/** Filter and rank expansion candidates — never include avoid/forbidden artists. */
export function filterWorldAnchorCandidates(
  candidates: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
  opts?: { minScore?: number; userDislikedArtists?: Set<string> },
): WorldIdentityTrack[] {
  const minScore = opts?.minScore ?? MIN_WORLD_SCORE;
  const disliked = opts?.userDislikedArtists ?? new Set<string>();

  return candidates
    .filter((track) => {
      const artist = String(track.artistName ?? "").trim();
      if (!artist || disliked.has(normalizeArtistKey(artist))) return false;
      if (matchesAvoidArtist(artist, profile)) return false;
      if (artistForbiddenInWorld(artist, worldIds)) return false;
      return scoreTrackWorldIdentity(track, profile) >= minScore;
    })
    .sort(
      (a, b) => scoreTrackWorldIdentity(b, profile) - scoreTrackWorldIdentity(a, profile),
    );
}

/** Cap artist duplicates — max 2-3 per artist for believable curation. */
export function applyArtistDiversityCap<T extends WorldIdentityTrack>(
  tracks: T[],
  maxPerArtist = DEFAULT_MAX_PER_ARTIST,
  worldId = "unknown",
): { tracks: T[]; capped: number } {
  const artistCounts = new Map<string, number>();
  const kept: T[] = [];
  let capped = 0;

  for (const track of tracks) {
    const artist = normalizeArtistKey(String(track.artistName ?? ""));
    if (!artist) {
      kept.push(track);
      continue;
    }
    const count = artistCounts.get(artist) ?? 0;
    if (count >= maxPerArtist) {
      capped += 1;
      recordRetrievalRejection({
        worldId,
        artistName: track.artistName ?? artist,
        trackName: String(track.trackName ?? "?"),
        reason: `artist_diversity_cap_${maxPerArtist}`,
        stage: "artist_diversity_cap",
      });
      continue;
    }
    artistCounts.set(artist, count + 1);
    kept.push(track);
  }

  return { tracks: kept, capped };
}

async function searchTier(
  accessToken: string | null | undefined,
  queries: string[],
  limit: number,
): Promise<WorldIdentityTrack[]> {
  if (!accessToken || queries.length === 0) return [];
  const raw = await searchSpotifyTracks(accessToken, queries, limit, {
    bestEffort: true,
    minTracks: 4,
    maxElapsedMs: 5000,
    maxRetries: 1,
    requestTimeoutMs: 3500,
  });
  return raw.map(spotifyTrackToCandidate);
}

export type ExhaustWorldRetrievalInput = WorldAnchorRetrievalInput & {
  targetValidCount?: number;
  maxRounds?: number;
};

export type TieredExpansionBatch = {
  tier: "anchor" | "major" | "deep_cut" | "forgotten" | "cult" | "era_extension" | "neighbour";
  queries: string[];
};

const TIER_BATCHES: Array<{ tier: TieredExpansionBatch["tier"]; tierKey: RetrievalTier }> = [
  { tier: "anchor", tierKey: "anchors" },
  { tier: "major", tierKey: "major" },
  { tier: "deep_cut", tierKey: "deep_cuts" },
  { tier: "forgotten", tierKey: "forgotten" },
  { tier: "cult", tierKey: "cult" },
  { tier: "era_extension", tierKey: "era_extensions" },
];

/** Build tiered Spotify query batches for round-robin expansion. */
export function buildTieredExpansionQueries(
  profile: CulturalWorldProfile,
  round: number,
): TieredExpansionBatch[] {
  if (round === 0) {
    const initial: TieredExpansionBatch[] = [
      { tier: "anchor", queries: buildTierQueries(profile, "anchors") },
      { tier: "deep_cut", queries: buildTierQueries(profile, "deep_cuts") },
      { tier: "forgotten", queries: buildTierQueries(profile, "forgotten") },
      { tier: "cult", queries: buildTierQueries(profile, "cult") },
    ];
    return initial.filter((batch) => batch.queries.length > 0);
  }
  const start = (round * 2) % TIER_BATCHES.length;
  const selected = [
    TIER_BATCHES[start]!,
    TIER_BATCHES[(start + 1) % TIER_BATCHES.length]!,
    TIER_BATCHES[(start + 2) % TIER_BATCHES.length]!,
  ];
  return selected.map(({ tier, tierKey }) => ({
    tier,
    queries: buildTierQueries(profile, tierKey),
  }));
}

/** Cap artist duplicates in a candidate pool before ranking. */
export function capArtistDiversityInPool<T extends WorldIdentityTrack>(
  tracks: T[],
  _profile: CulturalWorldProfile,
  maxPerArtist = DEFAULT_MAX_PER_ARTIST,
  worldId = "unknown",
): T[] {
  return applyArtistDiversityCap(tracks, maxPerArtist, worldId).tracks;
}

/** Alias for exhausted tier retrieval — loops until targetValidCount or maxRounds. */
export async function exhaustWorldRetrieval(
  input: ExhaustWorldRetrievalInput,
): Promise<WorldAnchorRetrievalResult> {
  const target = input.targetValidCount ?? input.targetCount ?? 25;
  const maxRounds = Math.max(1, input.maxRounds ?? 4);
  let result = await retrieveWorldAnchorCandidates({ ...input, targetCount: target, exhaustAllTiers: true });

  for (let round = 1; round < maxRounds && result.tracks.length < target; round += 1) {
    const extra = await retrieveWorldAnchorCandidates({
      ...input,
      targetCount: target,
      exhaustAllTiers: true,
      maxCandidates: (input.maxCandidates ?? 64) + round * 16,
    });
    const seen = new Set(result.tracks.map(trackIdOf));
    for (const track of extra.tracks) {
      const id = trackIdOf(track);
      if (seen.has(id)) continue;
      seen.add(id);
      result.tracks.push(track);
      if (result.tracks.length >= target) break;
    }
    result = {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        mergedCount: result.tracks.length,
        exhausted: result.tracks.length < target,
      },
    };
  }

  return result;
}

/** Exhausted world-anchor retrieval: liked → anchors → deep cuts → neighbours. */
export async function retrieveWorldAnchorCandidates(
  input: WorldAnchorRetrievalInput,
): Promise<WorldAnchorRetrievalResult> {
  const {
    accessToken,
    userLibrary,
    culturalProfile,
    committedWorld,
    maxCandidates = 64,
    targetCount = 25,
    userDislikedArtists,
    maxPerArtist = DEFAULT_MAX_PER_ARTIST,
    exhaustAllTiers = false,
  } = input;
  const worldIds = committedWorld.worldIds ?? [committedWorld.id];
  const worldId = committedWorld.id;
  const seen = new Set<string>();
  const merged: WorldIdentityTrack[] = [];
  const tierCounts: Record<string, number> = {};
  const allQueries: string[] = [];
  let spotifyRawCount = 0;
  let spotifyFilteredCount = 0;
  let neighbourExpansion = 0;
  let diversityCapped = 0;

  const addTracks = (
    candidates: WorldIdentityTrack[],
    tier: RetrievalTier,
    minScore: number,
    retrievalSource: string,
  ): number => {
    const stage: RejectionStage =
      tier === "neighbours" ? "neighbour_expansion" : tier === "liked" ? "retrieval_pipeline" : "anchor_retrieval";
    const filtered = recordFilterRejections(
      candidates,
      culturalProfile,
      worldIds,
      worldId,
      stage,
      minScore,
      retrievalSource,
    );
    spotifyFilteredCount += filtered.length;
    let added = 0;
    for (const track of filtered) {
      const id = trackIdOf(track);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(track);
      added += 1;
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      if (merged.length >= targetCount) break;
    }
    return added;
  };

  // Tier 0: liked library world fits (high purity bar)
  const libraryWorldFits = filterWorldAnchorCandidates(
    userLibrary,
    culturalProfile,
    worldIds,
    { minScore: OPENER_WORLD_SCORE, userDislikedArtists },
  );
  addTracks(libraryWorldFits, "liked", OPENER_WORLD_SCORE, "library_high_fit");

  const libraryAdjacent = filterWorldAnchorCandidates(
    userLibrary,
    culturalProfile,
    worldIds,
    { minScore: PURITY_RETRIEVAL_MIN, userDislikedArtists },
  ).filter((t) => !seen.has(trackIdOf(t)));
  addTracks(libraryAdjacent, "liked", PURITY_RETRIEVAL_MIN, "library_adjacent");

  // Exhaust tier loop — V15 exhaustAllTiers completes every tier before delivery decision
  for (const tier of TIER_ORDER) {
    if (!exhaustAllTiers && merged.length >= targetCount) break;
    if (tier === "liked") continue;

    if (tier === "neighbours") {
      const neighbours = getNeighbourWorlds(worldId);
      for (const neighbourId of neighbours) {
        if (merged.length >= targetCount) break;
        const queries = buildTierQueries(culturalProfile, "neighbours", neighbourId);
        allQueries.push(...queries);
        const raw = await searchTier(accessToken, queries, 16);
        spotifyRawCount += raw.length;
        const added = addTracks(raw, "neighbours", PURITY_RETRIEVAL_MIN, `neighbour:${neighbourId}`);
        neighbourExpansion += added;
      }
      continue;
    }

    const queries = buildTierQueries(culturalProfile, tier);
    if (queries.length === 0) continue;
    allQueries.push(...queries);
    const raw = await searchTier(accessToken, queries, 20);
    spotifyRawCount += raw.length;
    const minScore = tier === "anchors" ? OPENER_WORLD_SCORE : PURITY_RETRIEVAL_MIN;
    addTracks(raw, tier, minScore, `spotify:${tier}`);
  }

  const diversity = applyArtistDiversityCap(merged, maxPerArtist, worldId);
  diversityCapped = diversity.capped;

  const finalTracks = diversity.tracks.slice(0, maxCandidates);
  const exhausted = finalTracks.length < targetCount;
  const shortfall = diagnoseRetrievalShortfall(
    worldId,
    [],
    finalTracks.length,
    targetCount,
    culturalProfile,
  );

  return {
    tracks: finalTracks,
    diagnostics: {
      libraryWorldFits: libraryWorldFits.length,
      libraryAdjacent: libraryAdjacent.length,
      spotifyQueries: [...new Set(allQueries)],
      spotifyRawCount,
      spotifyFilteredCount,
      mergedCount: finalTracks.length,
      tierCounts,
      neighbourExpansion,
      diversityCapped,
      exhausted,
      shortfallSuggestions: shortfall.suggestions,
    },
  };
}
