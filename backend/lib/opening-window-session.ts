/**
 * Ephemeral session memory for opening-window dedup (positions 1–10).
 * Never persisted to DB — in-process only.
 */

import { OPENING_DEDUP_WINDOW_SIZE } from "./opening-window-dedup";

const sessionOpeningWindows = new Map<string, string[][]>();
const MAX_SESSION_PLAYLISTS = 20;

export function getOpeningWindowSessionHistory(sessionKey: string): string[][] {
  return sessionOpeningWindows.get(sessionKey) ?? [];
}

export function recordOpeningWindowSession(sessionKey: string, trackIds: string[]): void {
  if (!sessionKey || trackIds.length === 0) return;
  const opening = trackIds.slice(0, OPENING_DEDUP_WINDOW_SIZE);
  const existing = sessionOpeningWindows.get(sessionKey) ?? [];
  sessionOpeningWindows.set(sessionKey, [...existing, opening].slice(-MAX_SESSION_PLAYLISTS));
}

export function clearOpeningWindowSession(sessionKey: string): void {
  sessionOpeningWindows.delete(sessionKey);
}

/** Test helper */
export function openingWindowSessionSize(): number {
  return sessionOpeningWindows.size;
}
