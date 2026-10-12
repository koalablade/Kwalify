/**
 * Audit-only selection trace: which tracks enter and leave each post-retrieval selection stage, and
 * why. Request-scoped via AsyncLocalStorage and only active when the controller begins it (audit
 * generations). Outside an active trace every call is a no-op, so production behaviour is unchanged.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type TraceTrack = {
  trackId: string;
  trackName?: string | null;
  name?: string | null;
  artistName?: string | null;
  artist?: string | null;
  energy?: number | null;
  valence?: number | null;
  score?: number | null;
  laneScore?: number | null;
  sourceLane?: string | null;
  laneId?: string | null;
};

export type SelectionTraceTrack = {
  id: string;
  label: string;
  e: number | null;
  v: number | null;
  score: number | null;
  lane: string | null;
};

export type SelectionTraceStage = {
  stage: string;
  count: number;
  ids: string[];
  added: SelectionTraceTrack[];
  removed: SelectionTraceTrack[];
  note?: unknown;
};

type SelectionTraceContext = {
  stages: SelectionTraceStage[];
  last: Map<string, SelectionTraceTrack> | null;
  events: Array<{ stage: string; detail: unknown }>;
};

const storage = new AsyncLocalStorage<SelectionTraceContext>();

export function beginSelectionTrace(): void {
  storage.enterWith({ stages: [], last: null, events: [] });
}

export function selectionTraceActive(): boolean {
  return storage.getStore() != null;
}

const round = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;

function describe(track: TraceTrack): SelectionTraceTrack {
  return {
    id: track.trackId,
    label: `${track.artistName ?? track.artist ?? "?"} — ${track.trackName ?? track.name ?? "?"}`,
    e: round(track.energy),
    v: round(track.valence),
    score: round(track.score ?? track.laneScore ?? null),
    lane: track.sourceLane ?? track.laneId ?? null,
  };
}

/** Record the track list as it leaves `stage`, with additions/removals versus the previous stage. */
export function traceSelectionStage(stage: string, tracks: readonly TraceTrack[] | null | undefined, note?: unknown): void {
  const ctx = storage.getStore();
  if (!ctx || !tracks) return;
  const current = new Map<string, SelectionTraceTrack>();
  for (const track of tracks) if (track?.trackId) current.set(track.trackId, describe(track));
  const added: SelectionTraceTrack[] = [];
  const removed: SelectionTraceTrack[] = [];
  if (ctx.last) {
    for (const [id, t] of current) if (!ctx.last.has(id)) added.push(t);
    for (const [id, t] of ctx.last) if (!current.has(id)) removed.push(t);
  } else {
    added.push(...current.values());
  }
  ctx.stages.push({ stage, count: current.size, ids: [...current.keys()], added, removed, note });
  ctx.last = current;
}

/** Record a decision without changing the running list (e.g. replacement details). */
export function traceSelectionEvent(stage: string, detail: unknown): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.events.push({ stage, detail });
}

export function getSelectionTraceSnapshot(): { stages: SelectionTraceStage[]; events: Array<{ stage: string; detail: unknown }> } | undefined {
  const ctx = storage.getStore();
  if (!ctx) return undefined;
  return { stages: ctx.stages, events: ctx.events };
}
