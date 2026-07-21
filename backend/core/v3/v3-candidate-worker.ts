/**
 * Worker entry for parallel V3 candidate execution.
 *
 * Receives a loop-invariant context (once) + per-candidate task, reconstructs the
 * non-serialisable callbacks from plain data, and runs the SAME runV3Pipeline used on
 * the main thread. Returns only plain/clone-safe fields; the winning candidate is
 * re-run on the main thread for the authoritative full result, so nothing here changes
 * playlist selection.
 */
import { parentPort } from "node:worker_threads";
import { runV3Pipeline } from "./v3-pipeline";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";

type WorkerContext = {
  classMapEntries: Array<[string, TrackGenreClassification]>;
  noveltyEntries: Array<[string, number]> | null;
  vibe: string;
  profile: unknown;
  targetCount: number;
  lockedIntent?: unknown;
  unifiedIntentContext?: unknown;
  momentMemory?: unknown;
  sessionArtistMemory?: unknown;
  trackReusePenalty?: Map<string, number>;
  requestId?: string;
  sceneWorldProof?: boolean;
  editorialMemory?: unknown;
  libraryFingerprint?: unknown;
  dominantIntentGates?: unknown;
  diagnosticsMode?: "minimal" | "full";
  artistEcosystemGraph?: unknown;
  hardWorldLock?: boolean;
  worldVerifiedTrackIds?: string[];
};

type WorkerTask = {
  v3Tracks: unknown[];
  seed: number;
  samplerInterpretation?: string;
};

let ctx: WorkerContext | null = null;
let classMap: Map<string, TrackGenreClassification> | null = null;
let noveltyMap: Map<string, number> | null = null;

function applyContext(next: WorkerContext): void {
  ctx = next;
  classMap = new Map(next.classMapEntries);
  noveltyMap = next.noveltyEntries ? new Map(next.noveltyEntries) : null;
}

async function runTask(task: WorkerTask): Promise<Record<string, unknown>> {
  if (!ctx || !classMap) throw new Error("worker context not initialised");
  const localClassMap = classMap;
  const localNovelty = noveltyMap;
  const result = await runV3Pipeline(task.v3Tracks as never[], ctx.vibe, ctx.profile as never, ctx.targetCount, {
    genreByTrack: (trackId: string) => localClassMap.get(trackId)?.genrePrimary ?? "unknown",
    classificationByTrack: (trackId: string) => localClassMap.get(trackId),
    ...(localNovelty ? { noveltyByTrack: (trackId: string) => localNovelty.get(trackId) ?? 0 } : {}),
    seed: task.seed,
    lockedIntent: ctx.lockedIntent as never,
    unifiedIntentContext: ctx.unifiedIntentContext as never,
    momentMemory: ctx.momentMemory as never,
    sessionArtistMemory: ctx.sessionArtistMemory as never,
    trackReusePenalty: ctx.trackReusePenalty,
    requestId: ctx.requestId,
    diagnosticsMode: ctx.diagnosticsMode ?? "minimal",
    sceneWorldProof: ctx.sceneWorldProof ?? false,
    editorialMemory: ctx.editorialMemory as never,
    libraryFingerprint: ctx.libraryFingerprint as never,
    dominantIntentGates: ctx.dominantIntentGates as never,
    samplerInterpretation: task.samplerInterpretation as never,
    artistEcosystemGraph: (ctx.artistEcosystemGraph as never) ?? null,
    shouldSkipMarginalImprovement: () => false,
    hardWorldLock: ctx.hardWorldLock,
    worldVerifiedTrackIds: ctx.worldVerifiedTrackIds
      ? new Set(ctx.worldVerifiedTrackIds)
      : undefined,
  });
  return {
    ok: true,
    finalTracks: result.finalTracks,
    sceneWorldContext: result.sceneWorldContext ?? null,
    timingMs: (result.diagnostics as { timingMs?: Record<string, number> } | undefined)?.timingMs ?? {},
  };
}

parentPort?.on("message", (msg: { type: "init" | "task"; context?: WorkerContext; task: WorkerTask }) => {
  void (async () => {
    try {
      if (msg.type === "init" && msg.context) applyContext(msg.context);
      const result = await runTask(msg.task);
      parentPort?.postMessage(result);
    } catch (err) {
      parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
