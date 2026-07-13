import { winningTrackIds } from "./contextual-uniqueness";
import type { PlaylistContextFingerprint } from "./contextual-uniqueness";

/** Matches parseEvaluationPlaylistContexts() server cap. */
export const EVAL_SESSION_MAX_PLAYLIST_CONTEXTS = 20;

/** Matches evaluationSessionTrackLists() server cap. */
export const EVAL_SESSION_MAX_TRACK_LISTS = 50;

/** Matches CUP_WINNER_TOP_K used by contextual-uniqueness on the server. */
export const EVAL_SESSION_TRACKS_PER_LIST = 20;

/** Default Express JSON body limit; keep request bodies below this. */
export const DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES = 64 * 1024;

/** Headroom under the default Express limit for base generate fields. */
export const EVAL_SESSION_BODY_BUDGET_BYTES = 58 * 1024;

export type EvaluationSessionMemoryInput = {
  previousTrackLists: string[][];
  previousPlaylistContexts: Array<{
    trackIds: string[];
    context: PlaylistContextFingerprint;
  }>;
};

export type EvaluationSessionMemoryPayload = {
  previousTrackIds: string[][];
  previousPlaylistContexts: Array<{
    trackIds: string[];
    context: PlaylistContextFingerprint;
  }>;
};

export type BuildEvaluationSessionMemoryOptions = {
  /** Serialized size budget for the full POST body including base fields. */
  bodyBudgetBytes?: number;
  /** Base generate request fields (vibe, mode, audit flags, etc.). */
  baseBody: Record<string, unknown>;
  maxTrackLists?: number;
  maxContexts?: number;
  tracksPerList?: number;
};

export function jsonUtf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function trimTrackIds(trackIds: string[], tracksPerList: number): string[] {
  return winningTrackIds(trackIds, tracksPerList);
}

function buildPayload(
  runMemory: EvaluationSessionMemoryInput,
  maxTrackLists: number,
  maxContexts: number,
  tracksPerList: number,
): EvaluationSessionMemoryPayload {
  const recentTrackLists = [...runMemory.previousTrackLists].reverse().slice(0, maxTrackLists);
  const recentContexts = [...runMemory.previousPlaylistContexts].reverse().slice(0, maxContexts);
  const contextCount = Math.min(recentTrackLists.length, recentContexts.length, maxTrackLists, maxContexts);

  return {
    previousTrackIds: recentTrackLists
      .slice(0, contextCount)
      .map((trackIds) => trimTrackIds(trackIds, tracksPerList)),
    previousPlaylistContexts: recentContexts
      .slice(0, contextCount)
      .map((entry) => ({
        trackIds: trimTrackIds(entry.trackIds, tracksPerList),
        context: entry.context,
      })),
  };
}

function fitsBodyBudget(
  baseBody: Record<string, unknown>,
  memory: EvaluationSessionMemoryPayload,
  bodyBudgetBytes: number,
): boolean {
  return jsonUtf8ByteLength({ ...baseBody, evaluationSessionMemory: memory }) <= bodyBudgetBytes;
}

/**
 * Builds evaluation session memory for audit benchmark requests.
 * Trims to server-side caps and shrinks further until the full POST body fits
 * under the Express JSON limit (default 64kb).
 */
export function buildEvaluationSessionMemoryPayload(
  runMemory: EvaluationSessionMemoryInput,
  options: BuildEvaluationSessionMemoryOptions,
): EvaluationSessionMemoryPayload | undefined {
  if (runMemory.previousTrackLists.length === 0) return undefined;

  const bodyBudgetBytes = options.bodyBudgetBytes ?? EVAL_SESSION_BODY_BUDGET_BYTES;
  let maxTrackLists = Math.min(
    options.maxTrackLists ?? EVAL_SESSION_MAX_TRACK_LISTS,
    EVAL_SESSION_MAX_TRACK_LISTS,
    runMemory.previousTrackLists.length,
  );
  let maxContexts = Math.min(
    options.maxContexts ?? EVAL_SESSION_MAX_PLAYLIST_CONTEXTS,
    EVAL_SESSION_MAX_PLAYLIST_CONTEXTS,
    runMemory.previousPlaylistContexts.length,
  );
  let tracksPerList = options.tracksPerList ?? EVAL_SESSION_TRACKS_PER_LIST;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const memory = buildPayload(runMemory, maxTrackLists, maxContexts, tracksPerList);
    if (fitsBodyBudget(options.baseBody, memory, bodyBudgetBytes)) {
      return memory;
    }
    if (tracksPerList > 8) {
      tracksPerList -= 4;
      continue;
    }
    if (maxTrackLists > 5 || maxContexts > 5) {
      maxTrackLists = Math.max(5, maxTrackLists - 3);
      maxContexts = Math.max(5, maxContexts - 3);
      tracksPerList = options.tracksPerList ?? EVAL_SESSION_TRACKS_PER_LIST;
      continue;
    }
    if (tracksPerList > 5) {
      tracksPerList = 5;
      continue;
    }
    return memory;
  }

  return buildPayload(runMemory, 5, 5, 5);
}
