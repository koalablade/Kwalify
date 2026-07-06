import { buildGenreIntelligenceStack } from "./genre-intelligence-stack";
import { warmGenreProfileCache } from "./genre-profile-cache";
import { setCachedGenreStack } from "./genre-stack-cache";
import { buildUserGenreProfile } from "./user-genre-profile";

type LikedRow = Parameters<typeof buildUserGenreProfile>[0][number];

export function warmLibraryCachesAfterSync(userId: string, tracks: LikedRow[]): void {
  if (!tracks.length) return;

  warmGenreProfileCache(userId, tracks);

  const profile = buildUserGenreProfile(tracks);
  const stack = buildGenreIntelligenceStack({
    librarySize: tracks.length,
    tracks: tracks.map((t) => ({ ...t, tempo: t.tempo ?? null })),
    userProfile: profile,
    vibe: "",
    recentPlaylistTrackIds: [],
  });

  setCachedGenreStack(`warm:${userId}:${tracks.length}`, stack);
}

export function getWarmGenreStackCacheKey(userId: string, librarySize: number): string {
  return `warm:${userId}:${librarySize}`;
}
