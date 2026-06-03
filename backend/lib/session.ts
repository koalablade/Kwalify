import type { SpotifyTokens } from "./spotify";

declare module "express-session" {
  interface SessionData {
    spotifyTokens?: SpotifyTokens;
    spotifyUserId?: string;
    spotifyDisplayName?: string;
    spotifyEmail?: string;
    spotifyAvatarUrl?: string;
    spotifyCountry?: string;
    oauthState?: string;
  }
}

export {};
