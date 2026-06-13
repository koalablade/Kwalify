/**
 * Purpose: Spotify API client — auth, user profile, library sync, playlist creation.
 * Responsibilities:
 *   - OAuth URL generation, token exchange, token refresh
 *   - Fetching liked songs in paginated batches
 *   - Creating and populating Spotify playlists
 * Dependencies: axios, Spotify Web API
 */
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { logger } from "./logger";
import { recordSpotifyApiRequest, spotifyEndpointLabel } from "./spotify-api-audit";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_AUTH_BASE = "https://accounts.spotify.com";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  popularity?: number;
  artists: Array<{ id?: string; name: string }>;
  album: {
    id?: string;
    name: string;
    release_date?: string;
    genres?: string[];
    images: Array<{ url: string; width: number; height: number }>;
  };
  duration_ms: number;
  /** ISO-8601 timestamp from the liked-songs `added_at` field */
  addedAt?: string;
}

export type EnrichedTrack = SpotifyTrack & {
  spotifyArtistGenres?: string[];
  albumGenres?: string[];
  popularity?: number;
  releaseYear?: number | null;
};

export type AlbumMetadata = {
  genres: string[];
  releaseYear: number | null;
};

function releaseYearFromDate(value?: string): number | null {
  const year = value?.match(/^\d{4}/)?.[0];
  return year ? Number(year) : null;
}

export async function fetchArtistGenres(
  accessToken: string,
  artistIds: string[],
  opts?: { userKey?: string }
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniqueIds = [...new Set(artistIds.filter(Boolean))];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const batch = uniqueIds.slice(i, i + 50);
    const response = await spotifyRequest<any>(
      {
        method: "GET",
        url: `${SPOTIFY_API_BASE}/artists`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: batch.join(",") },
      },
      { userKey: opts?.userKey }
    );
    for (const artist of response.data.artists ?? []) {
      if (artist?.id) out.set(artist.id, Array.isArray(artist.genres) ? artist.genres : []);
    }
    if (i + 50 < uniqueIds.length) await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

export async function fetchAlbumMetadata(
  accessToken: string,
  albumIds: string[],
  opts?: { userKey?: string }
): Promise<Map<string, AlbumMetadata>> {
  const out = new Map<string, AlbumMetadata>();
  const uniqueIds = [...new Set(albumIds.filter(Boolean))];
  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = uniqueIds.slice(i, i + 20);
    const response = await spotifyRequest<any>(
      {
        method: "GET",
        url: `${SPOTIFY_API_BASE}/albums`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: batch.join(","), market: "from_token" },
      },
      { userKey: opts?.userKey }
    );
    for (const album of response.data.albums ?? []) {
      if (!album?.id) continue;
      out.set(album.id, {
        genres: Array.isArray(album.genres) ? album.genres : [],
        releaseYear: releaseYearFromDate(album.release_date),
      });
    }
    if (i + 20 < uniqueIds.length) await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

export function enrichTrackMetadata(
  track: SpotifyTrack,
  artistGenreMap = new Map<string, string[]>(),
  albumMetadataMap = new Map<string, AlbumMetadata>()
): EnrichedTrack {
  const spotifyArtistGenres = [
    ...new Set(track.artists.flatMap((artist) => artist.id ? artistGenreMap.get(artist.id) ?? [] : [])),
  ];
  const albumMetadata = track.album.id ? albumMetadataMap.get(track.album.id) : undefined;
  return {
    ...track,
    spotifyArtistGenres,
    albumGenres: albumMetadata?.genres ?? (Array.isArray(track.album.genres) ? track.album.genres : []),
    popularity: track.popularity,
    releaseYear: albumMetadata?.releaseYear ?? releaseYearFromDate(track.album.release_date),
  };
}

export interface SpotifyAudioFeatures {
  id: string;
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
}

const MIN_SPOTIFY_GAP_MS = 110;
const SPOTIFY_REQUEST_TIMEOUT_MS = 12_000;
const sessionThrottle = new Map<string, Promise<void>>();

async function awaitSpotifySlot(userKey?: string): Promise<void> {
  if (!userKey) {
    await new Promise((r) => setTimeout(r, 40));
    return;
  }
  const prev = sessionThrottle.get(userKey) ?? Promise.resolve();
  const slot = prev.then(
    () => new Promise<void>((r) => setTimeout(r, MIN_SPOTIFY_GAP_MS))
  );
  sessionThrottle.set(userKey, slot);
  await slot;
}

export type SpotifyRequestOpts = {
  /** Per-user session throttle (Spotify user id). */
  userKey?: string;
  maxRetries?: number;
};

async function spotifyRequest<T = unknown>(
  config: AxiosRequestConfig,
  opts: SpotifyRequestOpts = {}
): Promise<AxiosResponse<T>> {
  const maxRetries = opts.maxRetries ?? 4;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await awaitSpotifySlot(opts.userKey);
    const endpoint = spotifyEndpointLabel(config.method, config.url);
    const started = Date.now();
    try {
      const response = await axios.request<T>({
        timeout: SPOTIFY_REQUEST_TIMEOUT_MS,
        ...config,
      });
      recordSpotifyApiRequest({
        endpoint,
        durationMs: Date.now() - started,
        attempt,
        status: response.status,
        failed: false,
      });
      return response;
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      recordSpotifyApiRequest({
        endpoint,
        durationMs: Date.now() - started,
        attempt,
        status,
        failed: true,
      });

      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.["retry-after"] ?? "2", 10);
        const baseSec = isNaN(retryAfter) ? 2 : retryAfter;
        const wait = baseSec * 1000 * Math.pow(2, Math.min(attempt, 3));
        logger.warn({ attempt, wait, userKey: opts.userKey }, "Spotify 429 — backoff retry");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (status && status < 500) throw err;

      if (attempt < maxRetries) {
        const wait = (status && status >= 500 ? 800 : 500) * Math.pow(2, Math.min(attempt, 3));
        logger.warn(
          { attempt, status, wait, userKey: opts.userKey },
          status && status >= 500 ? "Spotify 5xx — backoff retry" : "Spotify error — retrying"
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastErr;
}

export function getAuthUrl(redirectUri: string, state: string): string {
  const scopes = [
    "user-library-read",
    "playlist-read-private",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-read-private",
    "user-read-email",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    show_dialog: "true",
  });

  return `${SPOTIFY_AUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<SpotifyTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: params.toString(),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = response.data as any;

  const scopeList =
    typeof data.scope === "string"
      ? data.scope.split(" ").filter(Boolean)
      : [];
  logger.info(
    {
      scopeCount: scopeList.length,
      hasPlaylistModify: scopeList.some((s: string) => s.startsWith("playlist-modify")),
    },
    "[spotify] OAuth token issued"
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: params.toString(),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = response.data as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

const refreshInFlight = new Map<string, Promise<SpotifyTokens>>();

export async function getValidAccessToken(
  tokens: SpotifyTokens,
  userKey?: string
): Promise<SpotifyTokens> {
  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens;
  }
  const key = userKey ?? tokens.refreshToken.slice(0, 16);
  const existing = refreshInFlight.get(key);
  if (existing) return existing;

  logger.info({ userKey: userKey ?? "anon" }, "Refreshing Spotify access token");
  const job = refreshAccessToken(tokens.refreshToken).finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, job);
  return job;
}

/**
 * Obtains a short-lived Client Credentials access token.
 *
 * Audio features are not user-specific — they only need a valid app token,
 * not the user's OAuth token. Using a separate CC token gives the audio-features
 * call its own quota bucket so it doesn't exhaust the user token that is also
 * handling 189+ liked-songs pages in the same sync run.
 */
export async function getClientCredentialsToken(): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await spotifyRequest<any>({
    method: "POST",
    url: `${SPOTIFY_AUTH_BASE}/api/token`,
    data: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data.access_token as string;
}

export async function getSpotifyUser(accessToken: string): Promise<any> {
  const response = await spotifyRequest<any>({
    method: "GET",
    url: `${SPOTIFY_API_BASE}/me`,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

export async function fetchLikedSongs(
  accessToken: string,
  onBatch: (tracks: SpotifyTrack[], total: number, offset: number) => Promise<void>,
  stopBefore?: Date
): Promise<void> {
  let offset = 0;
  const limit = 50;
  let total = 0;

  do {
    const response = await spotifyRequest<any>({
      method: "GET",
      url: `${SPOTIFY_API_BASE}/me/tracks`,
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit, offset, market: "from_token" },
    });

    const data = response.data;
    total = data.total;

    // Attach added_at to each track so callers can use it for incremental sync
    let tracks: SpotifyTrack[] = data.items
      .filter((item: any) => item.track && !item.track.is_local)
      .map((item: any) => ({ ...item.track, addedAt: item.added_at as string | undefined }));

    // Incremental stop: Spotify returns tracks newest-first.
    // If stopBefore is set, drop tracks that were added before the cutoff.
    // When some tracks in this page are older than the cutoff we've reached
    // already-synced territory — emit the new ones and stop.
    if (stopBefore) {
      const cutoff = stopBefore.getTime();
      const newTracks = tracks.filter(
        (t) => t.addedAt && new Date(t.addedAt).getTime() > cutoff
      );
      if (newTracks.length < tracks.length) {
        // Hit the boundary — emit new tracks from this page and bail out
        if (newTracks.length > 0) {
          await onBatch(newTracks, total, offset);
        }
        return;
      }
      tracks = newTracks;
    }

    await onBatch(tracks, total, offset);
    offset += limit;

    if (offset < total) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (offset < total);
}

export async function searchSpotifyTracks(
  accessToken: string,
  queries: string[],
  maxTracks = 100,
  opts?: { userKey?: string }
): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (out.length >= maxTracks) break;
    const q = query.trim();
    if (!q) continue;

    const response = await spotifyRequest<any>(
      {
        method: "GET",
        url: `${SPOTIFY_API_BASE}/search`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q,
          type: "track",
          limit: Math.min(50, maxTracks - out.length),
          market: "from_token",
        },
      },
      { userKey: opts?.userKey }
    );

    for (const track of response.data.tracks?.items ?? []) {
      if (!track?.id || track.is_local || seen.has(track.id)) continue;
      seen.add(track.id);
      out.push(track as SpotifyTrack);
      if (out.length >= maxTracks) break;
    }

    if (out.length < maxTracks) await new Promise((r) => setTimeout(r, 80));
  }

  return out;
}

/** Extract playlist ID from a Spotify URL or raw 22-char id. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/playlist[/:]([a-zA-Z0-9]{22})/i);
  return m?.[1] ?? null;
}

/**
 * Read track IDs from a public (or user-visible) playlist.
 * Uses /items (current Spotify API); falls back to legacy /tracks.
 */
export async function fetchPlaylistTrackIds(
  accessToken: string,
  playlistId: string,
  maxTracks = 100
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 50;
  let pathSuffix: "items" | "tracks" = "items";

  while (ids.length < maxTracks) {
    try {
      const response = await spotifyRequest<any>({
        method: "GET",
        url: `${SPOTIFY_API_BASE}/playlists/${playlistId}/${pathSuffix}`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          offset,
          limit,
          fields: "items(track(id,type)),total,next",
          market: "from_token",
        },
      });

      const data = response.data;
      const total = data.total ?? 0;
      for (const item of data.items ?? []) {
        if (ids.length >= maxTracks) break;
        const track = item.track;
        if (track?.id && track.type === "track") ids.push(track.id);
      }

      offset += limit;
      if (offset >= total || !data.next) break;
      await new Promise((r) => setTimeout(r, 80));
    } catch (err: any) {
      const status = err?.response?.status;
      if (pathSuffix === "items" && (status === 403 || status === 404 || status === 410)) {
        pathSuffix = "tracks";
        offset = 0;
        ids.length = 0;
        continue;
      }
      throw err;
    }
  }

  return ids;
}

export async function fetchAudioFeatures(
  accessToken: string,
  trackIds: string[],
  opts?: { fallbackToken?: string; userKey?: string }
): Promise<SpotifyAudioFeatures[]> {
  if (!trackIds.length) return [];

  const results: SpotifyAudioFeatures[] = [];
  const batchSize = 100;
  let token = accessToken;
  let usedFallback = false;
  let stopped403 = false;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    if (stopped403) break;

    const batch = trackIds.slice(i, i + batchSize);

    try {
      const response = await spotifyRequest<any>(
        {
          method: "GET",
          url: `${SPOTIFY_API_BASE}/audio-features`,
          headers: { Authorization: `Bearer ${token}` },
          params: { ids: batch.join(",") },
        },
        { userKey: opts?.userKey }
      );

      const features = response.data.audio_features?.filter(Boolean) ?? [];
      results.push(...features);
    } catch (err: any) {
      const status = err?.response?.status;

      if (
        status === 403 &&
        opts?.fallbackToken &&
        !usedFallback &&
        token !== opts.fallbackToken
      ) {
        usedFallback = true;
        token = opts.fallbackToken;
        i -= batchSize;
        logger.warn("Audio features 403 on app token — retrying with user token");
        continue;
      }

      if (status === 403) {
        stopped403 = true;
        logger.warn(
          { batchStart: i, totalIds: trackIds.length, fetched: results.length },
          "Audio features forbidden (403) — stopping further feature fetches (Spotify API restriction)"
        );
        break;
      }

      logger.warn(
        { err: err?.message, status, batchStart: i },
        "Audio features fetch failed for batch — skipping batch"
      );
    }

    if (i + batchSize < trackIds.length && !stopped403) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

export async function createSpotifyPlaylist(
  accessToken: string,
  userId: string,
  name: string,
  trackUris: string[],
  opts?: {
    existingPlaylistId?: string;
    /** Called once playlist shell exists (before track add) — for retry idempotency */
    onPlaylistCreated?: (playlistId: string) => void;
  }
): Promise<{
  id: string;
  url: string;
  partial?: boolean;
  tracksAdded?: number;
  tracksRequested?: number;
}> {
  const userKey = userId;
  let playlistId = opts?.existingPlaylistId;
  let playlistUrl = playlistId
    ? `https://open.spotify.com/playlist/${playlistId}`
    : "";

  if (!playlistId) {
    const playlistResponse = await spotifyRequest<any>(
      {
        method: "POST",
        url: `${SPOTIFY_API_BASE}/me/playlists`,
        data: {
          name,
          public: false,
          description: `Generated by K_WALAH — your emotional AI DJ`,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
      { userKey }
    );

    const playlist = playlistResponse.data;

    if (!playlist?.id) {
      throw new Error(
        `[spotify] Playlist create response missing 'id'. Full response: ${JSON.stringify(playlist)}`
      );
    }

    playlistId = playlist.id;
    playlistUrl =
      playlist.external_urls?.spotify ??
      `https://open.spotify.com/playlist/${playlistId}`;

    logger.info(
      { playlistId, trackCount: trackUris.length },
      "[spotify] Playlist shell created"
    );

    await new Promise((r) => setTimeout(r, 800));
    opts?.onPlaylistCreated?.(playlistId!);
  } else if (playlistId) {
    opts?.onPlaylistCreated?.(playlistId);
  }

  const batchSize = 100;
  let tracksAdded = 0;
  try {
    logger.info(
      { playlistId, trackCount: trackUris.length },
      "[spotify] Adding tracks to playlist"
    );
    for (let i = 0; i < trackUris.length; i += batchSize) {
      const batch = trackUris.slice(i, i + batchSize);
      await spotifyRequest(
        {
          method: i === 0 ? "PUT" : "POST",
          url: `${SPOTIFY_API_BASE}/playlists/${playlistId}/items`,
          data: { uris: batch },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
        { userKey }
      );
      tracksAdded += batch.length;
    }
  } catch (err: any) {
    logger.warn(
      {
        playlistId,
        status: err?.response?.status,
        tracksAdded,
        tracksRequested: trackUris.length,
        msg: err?.message,
      },
      "[spotify] Track add failed"
    );
    if (playlistId) {
      return {
        id: playlistId,
        url: playlistUrl,
        partial: true,
        tracksAdded,
        tracksRequested: trackUris.length,
      };
    }
    if (!opts?.existingPlaylistId && playlistId) {
      try {
        await spotifyRequest(
          {
            method: "DELETE",
            url: `${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`,
            headers: { Authorization: `Bearer ${accessToken}` },
          },
          { userKey }
        );
      } catch {
        // Ignore cleanup failure
      }
    }
    throw err;
  }

  return {
    id: playlistId!,
    url: playlistUrl,
    partial: tracksAdded < trackUris.length,
    tracksAdded,
    tracksRequested: trackUris.length,
  };
}
