/**
 * Live Spotify QA adapter — reuses existing Spotify client + refresh token.
 * Does not create a second OAuth system.
 */

import { readLocalDotEnv, readLocalDotEnvValue } from "../benchmark-env-dotenv";
import {
  addSpotifyPlaylistUrisOneByOne,
  createSpotifyPlaylist,
  getSpotifyUser,
  getValidAccessToken,
  refreshAccessToken,
  unfollowSpotifyPlaylist,
  type SpotifyTokens,
} from "../spotify";
import type { SpotifyQaAdapter, SpotifyQaAddFailure, SpotifyQaCreateResult } from "./spotify-qa-adapter";

function hydrateSpotifyEnvFromDotEnv(): void {
  const env = readLocalDotEnv();
  for (const key of [
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "SPOTIFY_REFRESH_TOKEN",
    "DATABASE_URL",
    "SMOKE_SPOTIFY_USER_ID",
  ] as const) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
}

export function resolveQaRefreshToken(): string | null {
  hydrateSpotifyEnvFromDotEnv();
  return readLocalDotEnvValue("SPOTIFY_REFRESH_TOKEN") ?? process.env.SPOTIFY_REFRESH_TOKEN ?? null;
}

async function tokensFromKwalifySession(): Promise<SpotifyTokens | null> {
  hydrateSpotifyEnvFromDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const userId = process.env.SMOKE_SPOTIFY_USER_ID ?? null;
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: url });
  await client.connect();
  try {
    const result = userId
      ? await client.query(
        `SELECT sess FROM session WHERE expire > NOW() AND sess->>'spotifyUserId' = $1 AND sess->'spotifyTokens' IS NOT NULL ORDER BY expire DESC LIMIT 1`,
        [userId],
      )
      : await client.query(
        `SELECT sess FROM session WHERE expire > NOW() AND sess->'spotifyTokens' IS NOT NULL ORDER BY expire DESC LIMIT 1`,
      );
    const raw = result.rows[0]?.sess;
    const sess = (typeof raw === "string" ? JSON.parse(raw) : raw) as { spotifyTokens?: SpotifyTokens } | undefined;
    const tokens = sess?.spotifyTokens;
    if (!tokens?.refreshToken || !tokens?.accessToken) return null;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Number(tokens.expiresAt) || 0,
    };
  } finally {
    await client.end();
  }
}

export async function createLiveSpotifyQaAdapter(): Promise<SpotifyQaAdapter> {
  hydrateSpotifyEnvFromDotEnv();
  const refresh = resolveQaRefreshToken();
  let tokens: SpotifyTokens | null = refresh
    ? await refreshAccessToken(refresh)
    : await tokensFromKwalifySession();

  if (!tokens) {
    throw new Error(
      "No Spotify user token for QA. Log into Kwalify locally (playlist-modify-private) or set SPOTIFY_REFRESH_TOKEN.",
    );
  }
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET missing from environment.");
  }

  tokens = await getValidAccessToken(tokens, "qa");
  const me = await getSpotifyUser(tokens.accessToken);
  const userId = String(me?.id ?? "unknown");
  let liveTokens = tokens;

  return {
    kind: "live",
    async getUserId() {
      return userId;
    },
    async createPrivatePlaylist(input): Promise<SpotifyQaCreateResult> {
      liveTokens = await getValidAccessToken(liveTokens, userId);
      const shell = await createSpotifyPlaylist(liveTokens.accessToken, userId, input.name, [], {
        description: input.description.slice(0, 300),
      });
      const { added, failed } = await addSpotifyPlaylistUrisOneByOne(
        liveTokens.accessToken,
        shell.id,
        input.uris,
        userId,
      );
      const failures: SpotifyQaAddFailure[] = failed.map((f) => {
        const meta = input.trackMeta?.find((t) => t.uri === f.uri);
        return {
          uri: f.uri,
          reason: f.reason,
          trackName: meta?.name,
          artist: meta?.artist,
          spotifyId: meta?.spotifyId,
        };
      });
      return {
        playlistId: shell.id,
        url: shell.url,
        uri: `spotify:playlist:${shell.id}`,
        tracksAdded: added.length,
        tracksRequested: input.uris.length,
        failures,
      };
    },
    async unfollowPlaylist(playlistId: string) {
      liveTokens = await getValidAccessToken(liveTokens, userId);
      await unfollowSpotifyPlaylist(liveTokens.accessToken, playlistId, userId);
    },
  };
}
