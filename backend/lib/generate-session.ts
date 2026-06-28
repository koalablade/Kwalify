/**
 * Per-user generate session — single active request, phase tracking, Spotify idempotency.
 */

import {
  AUDIT_REQUEST_HARD_TIMEOUT_MS,
  REQUEST_FAST_FALLBACK_MS,
  REQUEST_HARD_TIMEOUT_MS,
} from "./production-limits";

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

export type GenerateProgressTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumArt?: string | null;
};

export type GenerateStage =
  | "Initializing"
  | "Retrieving candidates"
  | "Ranking matches"
  | "Diversity check"
  | "Finalizing playlist";

type SessionState = {
  requestId: string;
  startedAt: number;
  updatedAt: number;
  hardTimeoutMs: number;
  phase: GeneratePhase;
  stage: GenerateStage;
  stageIndex: number;
  stageDetail: string | null;
  partialTracks: GenerateProgressTrack[];
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

const PHASE_STAGE: Record<GeneratePhase, { stage: GenerateStage; stageIndex: number }> = {
  idle: { stage: "Initializing", stageIndex: 0 },
  starting: { stage: "Initializing", stageIndex: 0 },
  loading_library: { stage: "Retrieving candidates", stageIndex: 1 },
  building_profile: { stage: "Retrieving candidates", stageIndex: 1 },
  scoring: { stage: "Ranking matches", stageIndex: 2 },
  composing: { stage: "Diversity check", stageIndex: 3 },
  spotify: { stage: "Finalizing playlist", stageIndex: 4 },
  saving: { stage: "Finalizing playlist", stageIndex: 4 },
  done: { stage: "Finalizing playlist", stageIndex: 4 },
  error: { stage: "Finalizing playlist", stageIndex: 4 },
};

function isActiveSession(s: SessionState): boolean {
  if (s.cancelled) return false;
  if (Date.now() - s.startedAt >= s.hardTimeoutMs) return false;
  return ACTIVE_PHASES.has(s.phase);
}

function evictIfNeeded(): void {
  for (const [userId, session] of sessions.entries()) {
    if (!isActiveSession(session)) sessions.delete(userId);
  }
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
  opts?: { force?: boolean; hardTimeoutMs?: number }
): string | null {
  const existing = sessions.get(userId);
  if (!opts?.force && existing && isActiveSession(existing)) {
    return null;
  }
  if (existing) existing.cancelled = true;

  const requestId = nextRequestId(userId);
  const hardTimeoutMs = opts?.hardTimeoutMs ?? REQUEST_HARD_TIMEOUT_MS;
  sessions.set(userId, {
    requestId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    hardTimeoutMs,
    phase: "starting",
    ...PHASE_STAGE.starting,
    stageDetail: null,
    partialTracks: [],
    cancelled: false,
  });
  evictIfNeeded();
  return requestId;
}

export function setGeneratePhase(
  userId: string,
  requestId: string,
  phase: GeneratePhase
): boolean {
  const s = sessions.get(userId);
  if (s?.requestId === requestId && !s.cancelled) {
    const stage = PHASE_STAGE[phase];
    if (stage.stageIndex < s.stageIndex) return false;
    s.phase = phase;
    s.updatedAt = Date.now();
    s.stage = stage.stage;
    s.stageIndex = stage.stageIndex;
    return true;
  }
  return false;
}

export function setGeneratePartialTracks(
  userId: string,
  requestId: string,
  tracks: GenerateProgressTrack[]
): void {
  const s = sessions.get(userId);
  if (s?.requestId !== requestId || s.cancelled) return;
  s.partialTracks = tracks.slice(0, 60);
  s.updatedAt = Date.now();
}

export function setGenerateStageDetail(
  userId: string,
  requestId: string,
  stageDetail: string | null
): void {
  const s = sessions.get(userId);
  if (s?.requestId !== requestId || s.cancelled) return;
  s.stageDetail = stageDetail ? stageDetail.slice(0, 120) : null;
  s.updatedAt = Date.now();
}

export function isGenerateCancelled(userId: string, requestId: string): boolean {
  const s = sessions.get(userId);
  return !s || s.requestId !== requestId || s.cancelled;
}

/** True when a newer generate request replaced this one (not a timeout/disconnect cancel). */
export function isGenerateSuperseded(userId: string, requestId: string): boolean {
  const s = sessions.get(userId);
  return !!s && s.requestId !== requestId;
}

/** Same request cancelled by watchdog, client disconnect, or cooperative deadline — not superseded. */
export function isGenerateTimeoutCancelled(userId: string, requestId: string): boolean {
  const s = sessions.get(userId);
  return !!s && s.requestId === requestId && s.cancelled;
}

export function resolveAuditHardTimeoutMs(rawBody: Record<string, unknown> | undefined): number {
  const raw = rawBody?.["evaluationTimeoutMs"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return AUDIT_REQUEST_HARD_TIMEOUT_MS;
  return Math.min(AUDIT_REQUEST_HARD_TIMEOUT_MS, Math.max(REQUEST_HARD_TIMEOUT_MS, Math.floor(raw)));
}

export function getGenerateProgress(userId: string): {
  phase: GeneratePhase;
  stage: GenerateStage;
  stageIndex: number;
  stageCount: number;
  stageDetail: string | null;
  requestId: string;
  startedAt: number;
  elapsedMs: number;
  lastUpdatedAt: number;
  fallbackEligibleAt: number;
  partialTracks: GenerateProgressTrack[];
} | null {
  const s = sessions.get(userId);
  if (!s || s.cancelled) return null;
  if (!isActiveSession(s)) {
    sessions.delete(userId);
    return null;
  }
  return {
    phase: s.phase,
    stage: s.stage,
    stageIndex: s.stageIndex,
    stageCount: 5,
    stageDetail: s.stageDetail,
    requestId: s.requestId,
    startedAt: s.startedAt,
    elapsedMs: Date.now() - s.startedAt,
    lastUpdatedAt: s.updatedAt,
    fallbackEligibleAt: s.startedAt + REQUEST_FAST_FALLBACK_MS,
    partialTracks: s.partialTracks,
  };
}

/** Status polling — never report active after timeout or terminal phase. */
export function getGenerateStatus(userId: string): {
  phase: GeneratePhase;
  stage: GenerateStage | null;
  stageIndex: number;
  stageCount: number;
  stageDetail: string | null;
  requestId: string | null;
  startedAt: number | null;
  elapsedMs: number;
  lastUpdatedAt: number | null;
  fallbackEligibleAt: number | null;
  active: boolean;
  partialTracks: GenerateProgressTrack[];
} {
  const progress = getGenerateProgress(userId);
  if (!progress) {
    return { phase: "idle", stage: null, stageIndex: 0, stageCount: 5, stageDetail: null, requestId: null, startedAt: null, elapsedMs: 0, lastUpdatedAt: null, fallbackEligibleAt: null, active: false, partialTracks: [] };
  }
  return {
    phase: progress.phase,
    stage: progress.stage,
    stageIndex: progress.stageIndex,
    stageCount: progress.stageCount,
    stageDetail: progress.stageDetail,
    requestId: progress.requestId,
    startedAt: progress.startedAt,
    elapsedMs: progress.elapsedMs,
    lastUpdatedAt: progress.lastUpdatedAt,
    fallbackEligibleAt: progress.fallbackEligibleAt,
    active: true,
    partialTracks: progress.partialTracks,
  };
}

export function endGenerateSession(userId: string, requestId: string): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId) sessions.delete(userId);
}

export function cancelGenerateSession(userId: string, requestId: string): void {
  const s = sessions.get(userId);
  if (s?.requestId === requestId) {
    s.cancelled = true;
    s.phase = "error";
    s.updatedAt = Date.now();
  }
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
