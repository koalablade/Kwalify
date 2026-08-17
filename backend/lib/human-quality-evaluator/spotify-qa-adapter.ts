/**
 * Spotify QA playlist adapter. QA tooling only — does not generate playlists.
 */

export type SpotifyQaAddFailure = {
  uri: string;
  trackName?: string;
  artist?: string;
  spotifyId?: string;
  reason: string;
};

export type SpotifyQaCreateResult = {
  playlistId: string;
  url: string;
  uri: string;
  tracksAdded: number;
  tracksRequested: number;
  failures: SpotifyQaAddFailure[];
};

export type SpotifyQaAdapter = {
  kind: "live" | "mock";
  getUserId(): Promise<string>;
  createPrivatePlaylist(input: {
    name: string;
    description: string;
    uris: string[];
    trackMeta?: Array<{ uri: string; name: string; artist: string; spotifyId: string }>;
  }): Promise<SpotifyQaCreateResult>;
  unfollowPlaylist(playlistId: string): Promise<void>;
};

export function createMockSpotifyQaAdapter(opts?: { failUris?: string[]; userId?: string }): SpotifyQaAdapter {
  const playlists = new Map<string, { name: string; uris: string[]; unfollowed?: boolean }>();
  let seq = 0;
  const fail = new Set(opts?.failUris ?? []);
  return {
    kind: "mock",
    async getUserId() {
      return opts?.userId ?? "qa-mock-user";
    },
    async createPrivatePlaylist(input) {
      seq += 1;
      const playlistId = `mock-pl-${seq}`;
      const added: string[] = [];
      const failures: SpotifyQaAddFailure[] = [];
      for (const uri of input.uris) {
        if (fail.has(uri)) {
          const meta = input.trackMeta?.find((t) => t.uri === uri);
          failures.push({
            uri,
            trackName: meta?.name,
            artist: meta?.artist,
            spotifyId: meta?.spotifyId,
            reason: "mock add failure",
          });
          continue;
        }
        added.push(uri);
      }
      playlists.set(playlistId, { name: input.name, uris: added });
      return {
        playlistId,
        url: `https://open.spotify.com/playlist/${playlistId}`,
        uri: `spotify:playlist:${playlistId}`,
        tracksAdded: added.length,
        tracksRequested: input.uris.length,
        failures,
      };
    },
    async unfollowPlaylist(playlistId: string) {
      const row = playlists.get(playlistId);
      if (!row) throw new Error(`mock: unknown QA playlist ${playlistId}`);
      row.unfollowed = true;
    },
  };
}
