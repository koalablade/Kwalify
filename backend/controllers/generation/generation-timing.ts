/** Pre-V3 timing, production timeline, and live stage profiling. */
import type { Request } from "express";
import type {
  DbSessionLoadStageName,
  DbSessionLoadStageRecord,
  PreV3PerformanceReport,
  PreV3StageName,
  PreV3StageRecord,
  PreV3TimingBreakdown,
  ProductionTimeline,
  ProductionTimelineStage,
} from "./generation-types";

export function emptyPreV3Stage(stage: PreV3StageName): PreV3StageRecord {
  return {
    stage,
    durationMs: 0,
    inputSize: 0,
    outputSize: 0,
    cacheHit: false,
  };
}

export function emptyDbSessionLoadStage(stage: DbSessionLoadStageName): DbSessionLoadStageRecord {
  return {
    stage,
    durationMs: 0,
    inputSize: 0,
    outputSize: 0,
    rowsReturned: 0,
    cacheHit: false,
  };
}

export function createPreV3Timing(): PreV3TimingBreakdown {
  return {
    cacheTimeMs: 0,
    dbTimeMs: 0,
    likedSongsQueryMs: 0,
    playlistHistoryQueryMs: 0,
    genreProfileTimeMs: 0,
    genreStackTimeMs: 0,
    freshnessTimeMs: 0,
    librarySignalTimeMs: 0,
    moodIntentTimeMs: 0,
    spotifyReferenceTimeMs: 0,
    totalBeforeV3Ms: 0,
    slowestStage: null,
    slowestStageMs: 0,
    preV3Stages: {
      dbSessionLoad: emptyPreV3Stage("dbSessionLoad"),
      userHistoryFetch: emptyPreV3Stage("userHistoryFetch"),
      genreProfileBuild: emptyPreV3Stage("genreProfileBuild"),
      librarySignalLoad: emptyPreV3Stage("librarySignalLoad"),
      embeddingPrep: emptyPreV3Stage("embeddingPrep"),
      promptNormalization: emptyPreV3Stage("promptNormalization"),
    },
    dbSessionLoadStages: {
      userProfileQuery: emptyDbSessionLoadStage("userProfileQuery"),
      userPreferencesQuery: emptyDbSessionLoadStage("userPreferencesQuery"),
      playlistHistoryQuery: emptyDbSessionLoadStage("playlistHistoryQuery"),
      recentTracksQuery: emptyDbSessionLoadStage("recentTracksQuery"),
      implicitFeedbackQuery: emptyDbSessionLoadStage("implicitFeedbackQuery"),
    },
  };
}

export function createProductionTimeline(): ProductionTimeline {
  return {
    request_received: 0,
    queue_entered: null,
    worker_acquired: null,
    deps_loaded: null,
    candidate_fetch_start: null,
    candidate_fetch_end: null,
    scoring_start: null,
    scoring_end: null,
    v3_entry: null,
    stageDurations: {},
    activeStages: {},
  };
}

export function timelineOffset(startMs: number): number {
  return Math.max(0, Date.now() - startMs);
}

export function markTimeline(
  timeline: ProductionTimeline,
  startMs: number,
  key: keyof Pick<
    ProductionTimeline,
    | "queue_entered"
    | "worker_acquired"
    | "deps_loaded"
    | "candidate_fetch_start"
    | "candidate_fetch_end"
    | "scoring_start"
    | "scoring_end"
    | "v3_entry"
  >
): void {
  timeline[key] = timelineOffset(startMs);
}

export function startTimelineStage(
  timeline: ProductionTimeline,
  startMs: number,
  stage: ProductionTimelineStage
): void {
  timeline.activeStages[stage] = timelineOffset(startMs);
}

export function endTimelineStage(
  timeline: ProductionTimeline,
  startMs: number,
  stage: ProductionTimelineStage
): void {
  const startedAt = timeline.activeStages[stage];
  if (typeof startedAt !== "number") return;
  const elapsed = Math.max(0, timelineOffset(startMs) - startedAt);
  timeline.stageDurations[stage] = (timeline.stageDurations[stage] ?? 0) + elapsed;
  delete timeline.activeStages[stage];
}

export function buildProductionTimelineReport(
  timeline: ProductionTimeline,
  startMs: number,
  opts: { failureReason?: string | null } = {}
): Record<string, unknown> {
  const nowOffset = timelineOffset(startMs);
  const terminalOffset = timeline.v3_entry ?? timeline.scoring_start ?? nowOffset;
  const activeDurations = Object.fromEntries(
    Object.entries(timeline.activeStages).map(([stage, startedAt]) => [
      stage,
      Math.max(0, nowOffset - (startedAt ?? nowOffset)),
    ])
  );
  const completedStageMs = Object.values(timeline.stageDurations)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const activeStageMs = Object.values(activeDurations)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const allStageDurations = {
    ...timeline.stageDurations,
    ...activeDurations,
  };
  const blockingStage = Object.entries(allStageDurations)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "unknown";
  return {
    timeline: {
      request_received: timeline.request_received,
      queue_entered: timeline.queue_entered,
      worker_acquired: timeline.worker_acquired,
      deps_loaded: timeline.deps_loaded,
      candidate_fetch_start: timeline.candidate_fetch_start,
      candidate_fetch_end: timeline.candidate_fetch_end,
      scoring_start: timeline.scoring_start,
      scoring_end: timeline.scoring_end,
      v3_entry: timeline.v3_entry,
    },
    stageDurationsMs: allStageDurations,
    unaccounted_time_ms: Math.max(0, terminalOffset - completedStageMs - activeStageMs),
    blocking_stage: blockingStage,
    failure_reason: opts.failureReason ?? null,
  };
}

export function recordPreV3Timing(
  timing: PreV3TimingBreakdown,
  key: Exclude<keyof PreV3TimingBreakdown, "totalBeforeV3Ms" | "slowestStage" | "slowestStageMs" | "preV3Stages" | "dbSessionLoadStages">,
  ms: number
): void {
  timing[key] += ms;
  if (timing[key] > timing.slowestStageMs) {
    timing.slowestStage = key;
    timing.slowestStageMs = timing[key];
  }
}

export function addStructuredStageTiming(
  current: PreV3StageRecord,
  durationMs: number,
  inputSize: number,
  outputSize: number,
  cacheHit: boolean,
): PreV3StageRecord {
  return {
    stage: current.stage,
    durationMs: current.durationMs + durationMs,
    inputSize,
    outputSize,
    cacheHit: current.cacheHit || cacheHit,
  };
}

export function recordPreV3Stage(
  timing: PreV3TimingBreakdown,
  stage: PreV3StageName,
  meta: { durationMs: number; inputSize?: number; outputSize?: number; cacheHit?: boolean },
): PreV3StageRecord {
  const record = addStructuredStageTiming(
    timing.preV3Stages[stage],
    meta.durationMs,
    meta.inputSize ?? timing.preV3Stages[stage].inputSize,
    meta.outputSize ?? timing.preV3Stages[stage].outputSize,
    meta.cacheHit ?? false,
  );
  timing.preV3Stages[stage] = record;
  return record;
}

export function recordDbSessionLoadStage(
  timing: PreV3TimingBreakdown,
  stage: DbSessionLoadStageName,
  meta: { durationMs: number; inputSize?: number; outputSize?: number; rowsReturned?: number; cacheHit?: boolean },
): DbSessionLoadStageRecord {
  const base = addStructuredStageTiming(
    timing.dbSessionLoadStages[stage],
    meta.durationMs,
    meta.inputSize ?? timing.dbSessionLoadStages[stage].inputSize,
    meta.outputSize ?? timing.dbSessionLoadStages[stage].outputSize,
    meta.cacheHit ?? false,
  );
  const record = {
    ...base,
    rowsReturned: meta.rowsReturned ?? timing.dbSessionLoadStages[stage].rowsReturned,
  };
  timing.dbSessionLoadStages[stage] = record;
  return record;
}

export function logPreV3Stage(
  logger: Pick<Request["log"], "info">,
  record: PreV3StageRecord,
): void {
  logger.info(
    {
      stage: record.stage,
      durationMs: record.durationMs,
      inputSize: record.inputSize,
      outputSize: record.outputSize,
      cacheHit: record.cacheHit,
    },
    "pre_v3_stage_completed",
  );
}

export function logDbSessionLoadStage(
  logger: Pick<Request["log"], "info">,
  record: DbSessionLoadStageRecord,
): void {
  logger.info(
    {
      stage: record.stage,
      durationMs: record.durationMs,
      rowsReturned: record.rowsReturned,
      cacheHit: record.cacheHit,
    },
    "db_session_load_stage_completed",
  );
}

export function buildPreV3PerformanceReport(timing: PreV3TimingBreakdown): PreV3PerformanceReport {
  const stageBreakdown = Object.values(timing.preV3Stages);
  const bottleneck = stageBreakdown
    .filter((stage) => stage.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)[0] ?? null;
  return {
    totalPreV3Time: timing.totalBeforeV3Ms,
    stageBreakdown,
    dbSessionLoadStages: Object.values(timing.dbSessionLoadStages),
    bottleneckStage: bottleneck?.stage ?? timing.slowestStage,
  };
}

type LiveStageProfileEntry = {
  stage: string;
  count: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
};

type LiveStageProfileSnapshot = {
  elapsedMs: number;
  currentStage: { stage: string; detail?: string; elapsedMs: number } | null;
  completed: LiveStageProfileEntry[];
  slowestCompleted: LiveStageProfileEntry | null;
  recentEvents: Array<{ stage: string; detail?: string; elapsedMs?: number; status: "started" | "completed" }>;
};

export function createLiveStageProfiler(startMs: number): {
  start: (stage: string, detail?: string) => () => void;
  snapshot: () => LiveStageProfileSnapshot;
} {
  const completed = new Map<string, LiveStageProfileEntry>();
  const recentEvents: LiveStageProfileSnapshot["recentEvents"] = [];
  let currentStage: { stage: string; detail?: string; startedAt: number } | null = null;

  const pushEvent = (event: LiveStageProfileSnapshot["recentEvents"][number]): void => {
    recentEvents.push(event);
    if (recentEvents.length > 24) recentEvents.shift();
  };

  return {
    start(stage, detail) {
      const startedAt = Date.now();
      currentStage = { stage, detail, startedAt };
      pushEvent({ stage, detail, status: "started" });
      return () => {
        const elapsedMs = Date.now() - startedAt;
        const existing = completed.get(stage) ?? { stage, count: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
        existing.count += 1;
        existing.totalMs += elapsedMs;
        existing.lastMs = elapsedMs;
        existing.maxMs = Math.max(existing.maxMs, elapsedMs);
        completed.set(stage, existing);
        if (currentStage?.stage === stage && currentStage.startedAt === startedAt) {
          currentStage = null;
        }
        pushEvent({ stage, detail, elapsedMs, status: "completed" });
      };
    },
    snapshot() {
      const completedRows = [...completed.values()].sort((a, b) => b.totalMs - a.totalMs);
      return {
        elapsedMs: Date.now() - startMs,
        currentStage: currentStage
          ? {
              stage: currentStage.stage,
              detail: currentStage.detail,
              elapsedMs: Date.now() - currentStage.startedAt,
            }
          : null,
        completed: completedRows,
        slowestCompleted: completedRows[0] ?? null,
        recentEvents: [...recentEvents],
      };
    },
  };
}
