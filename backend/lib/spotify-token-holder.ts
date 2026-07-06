import type { SpotifyTokens } from "./spotify";

/** Mutable token bag for 401 refresh + retry during long sync/generate runs. */
export type SpotifyTokenHolder = {
  tokens: SpotifyTokens;
  retried401: boolean;
  onRefreshed?: (tokens: SpotifyTokens) => void;
};

export function createSpotifyTokenHolder(
  tokens: SpotifyTokens,
  onRefreshed?: (tokens: SpotifyTokens) => void
): SpotifyTokenHolder {
  return { tokens, retried401: false, onRefreshed };
}
