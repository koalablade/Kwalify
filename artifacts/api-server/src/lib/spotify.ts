import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { logger } from "./logger";

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
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
  duration_ms: number;
  /** ISO-8601 timestamp from the liked-songs `added_at` field */
  addedAt?: string;
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

async function spotifyRequest<T = unknown>(
  config: AxiosRequestConfig,
  maxRetries = 2
): Promise<AxiosResponse<T>> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.request<T>(config);
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;

      if (status === 429) {
        const retryAfter = parseInt(err.response.headers["retry-after"] ?? "2", 10);
        const wait = (isNaN(retryAfter) ? 2 : retryAfter) * 1000;
        logger.warn({ attempt, wait }, "Spotify 429 — waiting before retry");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (status && status < 500) throw err;

      if (attempt < maxRetries) {
        const wait = (attempt + 1) * 500;
        logger.warn({ attempt, status, wait }, "Spotify error — retrying");
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

  // Log the exact scopes Spotify included in the issued token.
  // If playlist-modify-private / playlist-modify-public are absent here,
  // Spotify is not granting write scopes to this app (requires Extended Quota).
  console.log("[oauth-token-scopes] Spotify issued token with scopes:", data.scope ?? "NONE");

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

export async function getValidAccessToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  if (Date.now() < tokens.expiresAt - 60000) {
    return tokens;
  }
  logger.info("Refreshing Spotify access token");
  return refreshAccessToken(tokens.refreshToken);
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

/** Extract playlist ID from a Spotify URL or raw 22-char id. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/playlist\/([a-zA-Z0-9]{22})/i);
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
  trackIds: string[]
): Promise<SpotifyAudioFeatures[]> {
  const results: SpotifyAudioFeatures[] = [];
  const batchSize = 100;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);

    try {
      const response = await spotifyRequest<any>({
        method: "GET",
        url: `${SPOTIFY_API_BASE}/audio-features`,
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: batch.join(",") },
      });

      const features = response.data.audio_features?.filter(Boolean) ?? [];
      results.push(...features);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, batchStart: i },
        "Audio features fetch failed for batch — continuing without features"
      );
    }

    if (i + batchSize < trackIds.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

export async function createSpotifyPlaylist(
  accessToken: string,
  userId: string,
  name: string,
  trackUris: string[]
): Promise<{ id: string; url: string }> {
  // POST /me/playlists is the correct endpoint per Spotify docs and confirmed
  // working in Spotify's own API console with this account.
  const playlistResponse = await spotifyRequest<any>({
    method: "POST",
    url: `${SPOTIFY_API_BASE}/me/playlists`,
    data: {
      name,
      public: true,
      description: `Generated by K_WALAH — your emotional AI DJ`,
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const playlist = playlistResponse.data;

  if (!playlist?.id) {
    throw new Error(
      `[spotify] Playlist create response missing 'id'. Full response: ${JSON.stringify(playlist)}`
    );
  }

  logger.info(
    { playlistId: playlist.id, playlistOwner: playlist.owner?.id, tokenUserId: userId },
    "[spotify] Playlist created — owner vs token user check"
  );

  // Small delay — Spotify occasionally 403s track-add immediately after playlist creation
  // due to backend propagation lag. 800ms resolves this in practice.
  await new Promise((r) => setTimeout(r, 800));

  const batchSize = 100;
  try {
    logger.info(
      { playlistId: playlist.id, totalUris: trackUris.length, firstUri: trackUris[0] ?? null },
      "[spotify] Adding tracks to playlist"
    );
    for (let i = 0; i < trackUris.length; i += batchSize) {
      const batch = trackUris.slice(i, i + batchSize);
      // Use PUT on first batch to set initial tracks, POST for subsequent batches
      await spotifyRequest({
        method: i === 0 ? "PUT" : "POST",
        url: `${SPOTIFY_API_BASE}/playlists/${playlist.id}/items`,
        data: { uris: batch },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
    }
  } catch (err: any) {
    // Track addition failed — delete the empty playlist to avoid Spotify clutter,
    // then re-throw so the caller can fall back to DB-only mode.
    logger.warn(
      {
        playlistId: playlist.id,
        status: err?.response?.status,
        errorBody: err?.response?.data,
        msg: err?.message,
      },
      "[spotify] Track add failed — deleting empty playlist"
    );
    try {
      await spotifyRequest({
        method: "DELETE",
        url: `${SPOTIFY_API_BASE}/playlists/${playlist.id}/followers`,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }

  return {
    id: playlist.id,
    url: playlist.external_urls.spotify,
  };
}
