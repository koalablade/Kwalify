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
  onBatch: (tracks: SpotifyTrack[], total: number, offset: number) => Promise<void>
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

    const tracks: SpotifyTrack[] = data.items
      .filter((item: any) => item.track && !item.track.is_local)
      .map((item: any) => item.track);

    await onBatch(tracks, total, offset);
    offset += limit;

    if (offset < total) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (offset < total);
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
  // Use /v1/me/playlists instead of /v1/users/{id}/playlists.
  // The user-scoped endpoint returns 403 "Forbidden" for Development Mode apps
  // even with correct scopes; /me/playlists creates for the authenticated user
  // directly and does not carry the same ownership-check restrictions.
  const playlistResponse = await spotifyRequest<any>({
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
  });

  const playlist = playlistResponse.data;

  const batchSize = 100;
  for (let i = 0; i < trackUris.length; i += batchSize) {
    const batch = trackUris.slice(i, i + batchSize);
    await spotifyRequest({
      method: "POST",
      url: `${SPOTIFY_API_BASE}/playlists/${playlist.id}/tracks`,
      data: { uris: batch },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  return {
    id: playlist.id,
    url: playlist.external_urls.spotify,
  };
}
