/**
 * Per-user generate session — single active request, phase tracking, Spotify idempotency.
 */

export type GeneratePhase =
  | "idle"
  | "starting"
  | "loading_library"
  | "building_profile"
  | "scoring"
  | "composing"
  | "spotify"
  | "saving"
  | "done"
  | "error";

type SessionState = {
  requestId: string;
  startedAt: number;
  phase: GeneratePhase;
  cancelled: boolean;
  /** Playlist created but track-add may retry */
  pendingSpotifyPlaylistId?: string;
};

const sessions = new Map<string, SessionState>();
const MAX_SESSIONS = 500;

function evictIfNeeded(): void {
  if (sessions.size <= MAX_SESSIONS) return;
  const sorted = [...sessions.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
  for (let i = 0; i < 50; i++) sessions.delete(sorted[i]![0]);
}

export function beginGenerateSession(userId: string): string {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prev = sessions.get(userId);
  if (prev) prev.cancelled = true;
  sessions.set(userId, {
    requestId,
    startedAt: Date.now(),
    phase: "starting",
    cancelled: false,
  });
  evictIfNeeded();
  return requestId;
}

export function setGeneratePhase(
  userId: string,
  requestId: string,
  phase: GeneratePhase
): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId && !s.cancelled) s.phase = phase;
}

export function isGenerateCancelled(userId: string, requestId: string): boolean {
  const s = sessions.get(userId);
  return !s || s.requestId !== requestId || s.cancelled;
}

export function getGenerateProgress(userId: string): {
  phase: GeneratePhase;
  requestId: string;
  startedAt: number;
} | null {
  const s = sessions.get(userId);
  if (!s || s.cancelled) return null;
  return { phase: s.phase, requestId: s.requestId, startedAt: s.startedAt };
}

export function endGenerateSession(userId: string, requestId: string): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId) sessions.delete(userId);
}

export function getPendingSpotifyPlaylistId(userId: string): string | undefined {
  return sessions.get(userId)?.pendingSpotifyPlaylistId;
}

export function setPendingSpotifyPlaylistId(
  userId: string,
  requestId: string,
  playlistId: string
): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId) s.pendingSpotifyPlaylistId = playlistId;
}

export function clearPendingSpotifyPlaylist(userId: string, requestId: string): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId) delete s.pendingSpotifyPlaylistId;
}

/** True if another generate is already running for this user. */
export function isGenerateInFlight(userId: string): boolean {
  const s = sessions.get(userId);
  if (!s || s.cancelled) return false;
  return Date.now() - s.startedAt < 120_000 && s.phase !== "done" && s.phase !== "error";
}
