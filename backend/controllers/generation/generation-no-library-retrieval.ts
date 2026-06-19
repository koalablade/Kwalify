/**
 * Spotify-wide retrieval ladder for no-library generation mode.
 */
import { likedSongsTable } from "../../db";
import {
  enrichTrackMetadata,
  fetchAlbumMetadata,
  fetchArtistGenres,
  fetchAudioFeatures,
  searchSpotifyTracks,
} from "../../lib/spotify";

function hasDecorativeEraOnly(lower: string): boolean {
  const decorativeEraContext = /\b(?:60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\s+(?:car|cars|motor|motors|vehicle|vehicles|volvo|bmw|mercedes|honda|toyota|ford|garage|bedroom|room|fit|fashion|aesthetic|vibe)\b/i;
  const explicitMusicEraContext = /\b(?:music|songs?|tracks?|playlist|mix|hits?|anthems?|throwbacks?|classics?|era|decade|sound|rave|disco|rock|pop|rap|hip\s*hop|jungle|house|techno)\b/i;
  return decorativeEraContext.test(lower) && !explicitMusicEraContext.test(lower);
}

function extractEraRange(vibe: string): { start: number | null; end: number | null; terms: string[] } {
  const lower = vibe.toLowerCase();
  const terms: string[] = [];
  if (hasDecorativeEraOnly(lower)) return { start: null, end: null, terms };
  const decadeMatch = lower.match(/\b(60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\b/);
  if (decadeMatch?.[1]) {
    const term = decadeMatch[1].replace("'", "");
    terms.push(term);
    const start = fullDecadeStart(term);
    return { start, end: start + 9, terms };
  }

  const rangeMatch = lower.match(/\b(19\d{2}|20\d{2})\s*(?:-|to|through|until)\s*(19\d{2}|20\d{2})\b/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    terms.push(`${start}-${end}`);
    return { start: Math.min(start, end), end: Math.max(start, end), terms };
  }

  const yearMatch = lower.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    terms.push(String(year));
    return { start: year, end: year, terms };
  }

  return { start: null, end: null, terms };
}

function fullDecadeStart(term: string): number {
  const normalized = term.toLowerCase().replace("'", "");
  if (/^(1960|1970|1980|1990|2000|2010|2020)s$/.test(normalized)) {
    return Number(normalized.slice(0, 4));
  }
  if (normalized === "00s") return 2000;
  if (normalized === "10s") return 2010;
  if (normalized === "20s") return 2020;
  return Number(`19${normalized.slice(0, 2)}`);
}

const NO_LIBRARY_GENRE_SEARCH_TERMS: Record<string, string[]> = {
  country: [
    "genre:country",
    "country",
    "americana",
    "red dirt country",
    "outlaw country",
    "bluegrass",
    "zach bryan",
    "johnny cash",
  ],
  hip_hop: ["genre:hip-hop", "hip hop", "rap", "trap", "drill"],
  rock: ["genre:rock", "rock", "classic rock", "alternative rock", "indie rock"],
  electronic: ["genre:electronic", "electronic", "house", "techno", "uk garage"],
  rnb: ["r&b", "rnb", "neo soul", "slow jams"],
  pop: ["genre:pop", "pop", "dance pop"],
  reggae: ["reggae", "dancehall", "dub"],
  jazz: ["jazz", "bebop", "swing"],
  latin: ["latin", "reggaeton", "salsa"],
  metal: ["metal", "metalcore", "thrash"],
};

export function noLibrarySearchQueries(vibe: string, families: string[], subgenreTerms: string[] = []): string[] {
  const cleanedVibe = vibe.trim();
  const eraTerms = extractEraRange(vibe).terms;
  const priorityQueries = new Set<string>();
  const expandedQueries = new Set<string>();
  const lower = cleanedVibe.toLowerCase();
  const controlledAliases = new Set<string>();
  const aliasSource = `${lower} ${subgenreTerms.join(" ").toLowerCase().replace(/_/g, " ")}`;
  if (/\b(?:tekk|tekno|schranz|hardgroove|industrial techno)\b/.test(aliasSource)) {
    ["hard techno", "schranz", "tekno", "techno"].forEach((term) => controlledAliases.add(term));
  }
  if (/\b(?:d\s*&\s*b|dnb|drum and bass|rollers?|liquid dnb|liquid drum and bass|jungle|old\s*skool jungle|old\s*school jungle|breakbeat hardcore)\b/.test(aliasSource)) {
    ["dnb rollers", "drum and bass rollers", "liquid drum and bass", "drum and bass", "jungle", "old school jungle", "jungle rollers", "breakbeat hardcore"].forEach((term) => controlledAliases.add(term));
  }
  if (cleanedVibe) priorityQueries.add(cleanedVibe);
  for (const subgenre of [...subgenreTerms, ...controlledAliases]) {
    const term = subgenre.replace(/_/g, " ").trim();
    if (!term) continue;
    priorityQueries.add(term);
    if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
      expandedQueries.add(`${cleanedVibe} ${term}`);
    }
    for (const era of eraTerms) {
      expandedQueries.add(`${era} ${term}`);
    }
  }
  for (const family of families) {
    for (const term of NO_LIBRARY_GENRE_SEARCH_TERMS[family] ?? [family.replace(/_/g, " ")]) {
      priorityQueries.add(term);
      if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
        expandedQueries.add(`${cleanedVibe} ${term}`);
      }
      for (const era of eraTerms) {
        expandedQueries.add(`${era} ${term}`);
      }
    }
  }
  return [...priorityQueries, ...expandedQueries].slice(0, 24);
}

export type RetrievalCompletionDiagnostics = {
  retrievalBlockingReason: string | null;
  unresolvedProviders: string[];
  retrievalWaitTimePerSource: Record<string, number>;
  usedPartialRetrieval: boolean;
  retrievalPartialCompletion: boolean;
  candidatePoolSizeAtUnblock: number;
  minViablePool: number;
  emptyPoolDetectedAtStage?: string | null;
  fallbackDepthReached?: number;
  fallbackExpansionPath?: string[];
  finalPoolSizeAtScoringEntry?: number;
  retrievalFatalEmptyPool?: boolean;
};

type TimedRetrievalSource<T> = {
  value: T;
  elapsedMs: number;
  timedOut: boolean;
  failed: boolean;
};

export function defaultRetrievalCompletionDiagnostics(minViablePool: number): RetrievalCompletionDiagnostics {
  return {
    retrievalBlockingReason: null,
    unresolvedProviders: [],
    retrievalWaitTimePerSource: {},
    usedPartialRetrieval: false,
    retrievalPartialCompletion: false,
    candidatePoolSizeAtUnblock: 0,
    minViablePool,
    emptyPoolDetectedAtStage: null,
    fallbackDepthReached: 0,
    fallbackExpansionPath: [],
    finalPoolSizeAtScoringEntry: 0,
    retrievalFatalEmptyPool: false,
  };
}

async function timeboxRetrievalSource<T>(
  source: string,
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<TimedRetrievalSource<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guarded = promise
    .then((value) => ({
      value,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: false,
    }))
    .catch(() => ({
      value: fallback,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: true,
    }));
  const timeout = new Promise<TimedRetrievalSource<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        value: fallback,
        elapsedMs: Date.now() - startedAt,
        timedOut: true,
        failed: false,
      });
    }, timeoutMs);
  });
  const result = await Promise.race([guarded, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

export async function buildNoLibrarySpotifyCandidates(opts: {
  accessToken: string;
  userId: string;
  vibe: string;
  length: number;
  families: string[];
  subgenreTerms?: string[];
  mode?: "strict" | "balanced" | "chaotic";
  primarySubgenre?: string | null;
  allowGlobalFallback?: boolean;
}): Promise<{
  tracks: Array<typeof likedSongsTable.$inferSelect>;
  diagnostics: RetrievalCompletionDiagnostics;
}> {
  const minViablePool = Math.min(120, Math.max(50, opts.length * 2));
  const diagnostics = defaultRetrievalCompletionDiagnostics(minViablePool);
  const maxTracks = Math.max(80, opts.length * 3);
  const searchResult = await timeboxRetrievalSource(
    "spotifySearch",
    searchSpotifyTracks(
      opts.accessToken,
      noLibrarySearchQueries(opts.vibe, opts.families, opts.subgenreTerms),
      maxTracks,
      {
        userKey: opts.userId,
        bestEffort: true,
        minTracks: minViablePool,
        maxElapsedMs: 5_000,
        maxRetries: 0,
        requestTimeoutMs: 2_500,
      }
    ),
    6_000,
    []
  );
  diagnostics.retrievalWaitTimePerSource.spotifySearch = searchResult.elapsedMs;
  let rawTracks = searchResult.value;
  const searchWindowElapsed = searchResult.elapsedMs >= 4_900 && rawTracks.length < maxTracks;
  if (searchResult.timedOut || searchResult.failed || searchWindowElapsed) {
    diagnostics.unresolvedProviders.push("spotifySearch");
  }
  if (rawTracks.length === 0 && (opts.subgenreTerms?.length ?? 0) > 0) {
    diagnostics.emptyPoolDetectedAtStage = "spotify_search_strict";
    diagnostics.fallbackDepthReached = 1;
    const familySearchResult = await timeboxRetrievalSource(
      "spotifyFamilySearch",
      searchSpotifyTracks(
        opts.accessToken,
        noLibrarySearchQueries(opts.vibe, opts.families, []),
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyFamilySearch = familySearchResult.elapsedMs;
    if (familySearchResult.timedOut || familySearchResult.failed) diagnostics.unresolvedProviders.push("spotifyFamilySearch");
    rawTracks = familySearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`family:${rawTracks.length}`);
  }
  if (rawTracks.length === 0) {
    const allowGlobalFallback = opts.allowGlobalFallback !== false &&
      !(opts.mode === "strict" && !!opts.primarySubgenre);
    if (!allowGlobalFallback) {
      diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search_family";
      diagnostics.fallbackDepthReached = Math.max(diagnostics.fallbackDepthReached ?? 0, 2);
      diagnostics.retrievalBlockingReason = "global_fallback_blocked_no_library_strict";
      diagnostics.retrievalFatalEmptyPool = true;
      diagnostics.candidatePoolSizeAtUnblock = 0;
      diagnostics.finalPoolSizeAtScoringEntry = 0;
      return { tracks: [], diagnostics };
    }
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search_family";
    diagnostics.fallbackDepthReached = Math.max(diagnostics.fallbackDepthReached ?? 0, 2);
    const broadQueries = [
      ...opts.families.map((family) => family.replace(/_/g, " ")),
      ...opts.families.map((family) => `popular ${family.replace(/_/g, " ")}`),
      "popular music",
    ];
    const broadSearchResult = await timeboxRetrievalSource(
      "spotifyBroadSearch",
      searchSpotifyTracks(
        opts.accessToken,
        broadQueries,
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyBroadSearch = broadSearchResult.elapsedMs;
    if (broadSearchResult.timedOut || broadSearchResult.failed) diagnostics.unresolvedProviders.push("spotifyBroadSearch");
    rawTracks = broadSearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`global:${rawTracks.length}`);
  }
  diagnostics.candidatePoolSizeAtUnblock = rawTracks.length;
  diagnostics.finalPoolSizeAtScoringEntry = rawTracks.length;
  if (rawTracks.length === 0) {
    diagnostics.retrievalBlockingReason = "empty_candidate_pool_after_timeboxed_retrieval";
    diagnostics.usedPartialRetrieval = searchResult.timedOut || searchResult.failed;
    diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search";
    diagnostics.retrievalFatalEmptyPool = true;
    return { tracks: [], diagnostics };
  }
  if (rawTracks.length >= minViablePool && (searchResult.timedOut || searchResult.failed || searchWindowElapsed)) {
    diagnostics.retrievalBlockingReason = "min_viable_pool_reached_before_all_sources_completed";
  } else if (rawTracks.length < minViablePool) {
    diagnostics.retrievalBlockingReason = "retrieval_timebox_elapsed_below_min_viable_pool";
  }

  const [artistGenreResult, albumMetadataResult, audioFeaturesResult] = await Promise.all([
    timeboxRetrievalSource(
      "artistGenres",
      fetchArtistGenres(
        opts.accessToken,
        rawTracks.flatMap((track) => track.artists.map((artist) => artist.id).filter((id): id is string => !!id)),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map<string, string[]>()
    ),
    timeboxRetrievalSource(
      "albumMetadata",
      fetchAlbumMetadata(
        opts.accessToken,
        rawTracks.map((track) => track.album.id).filter((id): id is string => !!id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map()
    ),
    timeboxRetrievalSource(
      "audioFeatures",
      fetchAudioFeatures(
        opts.accessToken,
        rawTracks.map((track) => track.id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      []
    ),
  ]);
  diagnostics.retrievalWaitTimePerSource.artistGenres = artistGenreResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.albumMetadata = albumMetadataResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.audioFeatures = audioFeaturesResult.elapsedMs;
  for (const [source, result] of [
    ["artistGenres", artistGenreResult],
    ["albumMetadata", albumMetadataResult],
    ["audioFeatures", audioFeaturesResult],
  ] as const) {
    if (result.timedOut || result.failed) diagnostics.unresolvedProviders.push(source);
  }
  diagnostics.usedPartialRetrieval = diagnostics.unresolvedProviders.length > 0 || rawTracks.length < minViablePool;
  diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
  const artistGenreMap = artistGenreResult.value;
  const albumMetadataMap = albumMetadataResult.value;
  const audioFeatures = audioFeaturesResult.value;
  const featuresById = new Map(audioFeatures.map((features) => [features.id, features]));
  const now = new Date();

  const tracks = rawTracks.map((track, index) => {
    const enriched = enrichTrackMetadata(track, artistGenreMap, albumMetadataMap);
    const features = featuresById.get(track.id);
    return {
      id: -1 - index,
      spotifyUserId: opts.userId,
      trackId: enriched.id,
      trackName: enriched.name,
      artistName: enriched.artists[0]?.name ?? "Unknown",
      albumName: enriched.album.name,
      albumArt: enriched.album.images[0]?.url ?? null,
      durationMs: enriched.duration_ms,
      energy: features?.energy ?? null,
      valence: features?.valence ?? null,
      tempo: features?.tempo ?? null,
      danceability: features?.danceability ?? null,
      acousticness: features?.acousticness ?? null,
      instrumentalness: features?.instrumentalness ?? null,
      loudness: features?.loudness ?? null,
      speechiness: features?.speechiness ?? null,
      spotifyArtistGenres: enriched.spotifyArtistGenres,
      albumGenres: enriched.albumGenres,
      popularity: enriched.popularity ?? null,
      releaseYear: enriched.releaseYear ?? null,
      primaryArtistId: enriched.artists[0]?.id ?? null,
      artistIds: enriched.artists.map((artist) => artist.id).filter((id): id is string => !!id),
      semanticProfile: null,
      enrichmentVersion: null,
      enrichedAt: null,
      addedAt: now,
      createdAt: now,
    };
  });
  return { tracks, diagnostics };
}
