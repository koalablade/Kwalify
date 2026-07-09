/**
 * Ephemeral session memory for session artist gravity budget.
 * Never persisted to DB — in-process only.
 */

const sessionArtistPlaylists = new Map<string, string[][]>();
const MAX_SESSION_PLAYLISTS = 20;

export function getSessionArtistHistory(sessionKey: string): string[][] {
  return sessionArtistPlaylists.get(sessionKey) ?? [];
}

export function recordSessionArtistPlaylist(sessionKey: string, artistNames: string[]): void {
  if (!sessionKey || artistNames.length === 0) return;
  const normalized = artistNames
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (normalized.length === 0) return;
  const existing = sessionArtistPlaylists.get(sessionKey) ?? [];
  sessionArtistPlaylists.set(sessionKey, [...existing, normalized].slice(-MAX_SESSION_PLAYLISTS));
}

export function clearSessionArtistGravitySession(sessionKey: string): void {
  sessionArtistPlaylists.delete(sessionKey);
}

/** Test helper */
export function sessionArtistGravitySessionSize(): number {
  return sessionArtistPlaylists.size;
}
