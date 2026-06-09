/**
 * Per-user generate session — single active request, phase tracking, Spotify idempotency.
 */

import { REQUEST_HARD_TIMEOUT_MS } from "./production-limits";

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
let requestSequence = 0;

const ACTIVE_PHASES = new Set<GeneratePhase>([
  "starting",
  "loading_library",
  "building_profile",
  "scoring",
  "composing",
  "spotify",
  "saving",
]);

function isActiveSession(s: SessionState): boolean {
  if (s.cancelled) return false;
  if (Date.now() - s.startedAt >= REQUEST_HARD_TIMEOUT_MS) return false;
  return ACTIVE_PHASES.has(s.phase);
}

function evictIfNeeded(): void {
  if (sessions.size <= MAX_SESSIONS) return;
  const sorted = [...sessions.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
  for (let i = 0; i < 50; i++) sessions.delete(sorted[i]![0]);
}

function nextRequestId(userId: string): string {
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}-${userId.length.toString(36)}`;
}

/**
 * Start a generate session. Returns null if another generate is in flight (unless force).
 */
export function acquireGenerateSession(
  userId: string,
  opts?: { force?: boolean }
): string | null {
  const existing = sessions.get(userId);
  if (!opts?.force && existing && isActiveSession(existing)) {
    return null;
  }
  if (existing) existing.cancelled = true;

  const requestId = nextRequestId(userId);
  sessions.set(userId, {
    requestId,
    startedAt: Date.now(),
    phase: "starting",
    cancelled: false,
  });
  evictIfNeeded();
  return requestId;
}

/** @deprecated use acquireGenerateSession */
export function beginGenerateSession(userId: string): string {
  return acquireGenerateSession(userId, { force: true })!;
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
  if (!isActiveSession(s)) {
    sessions.delete(userId);
    return null;
  }
  return { phase: s.phase, requestId: s.requestId, startedAt: s.startedAt };
}

/** Status polling — never report active after timeout or terminal phase. */
export function getGenerateStatus(userId: string): {
  phase: GeneratePhase;
  requestId: string | null;
  active: boolean;
} {
  const progress = getGenerateProgress(userId);
  if (!progress) {
    return { phase: "idle", requestId: null, active: false };
  }
  return {
    phase: progress.phase,
    requestId: progress.requestId,
    active: true,
  };
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
  return !!s && isActiveSession(s);
}
