/**
 * Single structured `generate_complete` log per /api/generate request.
 * Correlates pipeline timings, interpretation, retrieval, and Spotify audit via requestId.
 */

import type { Request } from "express";
import type { Logger } from "pino";
import type { ProductionTimeline } from "../controllers/generation/generation-types";
import { buildProductionTimelineReport } from "../controllers/generation/generation-timing";
import type { PlaylistExecutionTrace } from "../core/observability/playlist-execution-trace";
import type { RequestStageTimingReport } from "./request-stage-timing";
import type { SpotifyApiAuditSnapshot } from "./spotify-api-audit";
import { getSpotifyApiAuditSnapshot } from "./spotify-api-audit";
import { recordGenerateOutcome, recordGenerationPhaseDuration } from "./ops-metrics-extended";
import { hashedIdTag } from "./pii";

export type GenerateCompleteOutcome = "success" | "failure" | "partial";

export type GenerateCompleteInterpretation = {
  sceneId: string | null;
  confidence: number | null;
  playlistIntent: string | null;
  emotionalArc: string | null;
  humanNarrativeSummary: string | null;
  interpretWorldMs?: number | null;
};

export type GenerateCompleteRetrieval = {
  strategy: string | null;
  candidatePoolSize: number | null;
  hybridPoolSize: number | null;
  librarySize: number | null;
};

export type GenerateCompleteCandidateCounts = {
  shaped: number | null;
  retrieved: number | null;
  afterWorld: number | null;
  afterSampler: number | null;
  final: number | null;
};

export type GenerateObsState = {
  startMs: number;
  requestId: string;
  userId?: string;
  emitted: boolean;
  outcome?: GenerateCompleteOutcome;
  failureCode?: string | null;
  failureReason?: string | null;
  executionPath?: string | null;
  humanSaveable?: boolean | null;
  playlistSize?: number | null;
  requestedLength?: number | null;
  degraded?: boolean;
  honestPartial?: boolean;
  firstCollapseReason?: string | null;
  interpretWorldMs?: number | null;
  cacheHit?: boolean;
  interpretation?: GenerateCompleteInterpretation;
  retrieval?: GenerateCompleteRetrieval;
  candidateCounts?: GenerateCompleteCandidateCounts;
  productionTimeline?: ProductionTimeline;
  requestStageTiming?: RequestStageTimingReport;
  playlistExecutionTrace?: PlaylistExecutionTrace;
  spotifySnapshot?: SpotifyApiAuditSnapshot;
};

const OBS_KEY = Symbol.for("kwalify.generateObs");

function obsStore(req: Request): GenerateObsState {
  const existing = (req as Request & { [OBS_KEY]?: GenerateObsState })[OBS_KEY];
  if (existing) return existing;
  const created: GenerateObsState = {
    startMs: Date.now(),
    requestId: String(req.id ?? "unknown"),
    emitted: false,
  };
  (req as Request & { [OBS_KEY]: GenerateObsState })[OBS_KEY] = created;
  return created;
}

export function initGenerateObs(req: Request, startMs: number): void {
  const state = obsStore(req);
  state.startMs = startMs;
  state.requestId = String(req.id ?? state.requestId);
}

export function updateGenerateObs(req: Request, patch: Partial<GenerateObsState>): void {
  const state = obsStore(req);
  Object.assign(state, patch);
  if (patch.requestId) state.requestId = patch.requestId;
}

export function noteGenerateFailure(
  req: Request,
  detail: {
    code: string;
    reason?: string;
    executionPath?: string;
    playlistExecutionTrace?: PlaylistExecutionTrace;
    playlistSize?: number;
    firstCollapseReason?: string | null;
  },
): void {
  updateGenerateObs(req, {
    outcome: "failure",
    failureCode: detail.code,
    failureReason: detail.reason ?? detail.code,
    executionPath: detail.executionPath ?? detail.playlistExecutionTrace?.executionPath ?? null,
    playlistExecutionTrace: detail.playlistExecutionTrace,
    playlistSize: detail.playlistSize ?? detail.playlistExecutionTrace?.trackCounts?.final ?? null,
    humanSaveable: detail.playlistExecutionTrace?.humanSaveable ?? false,
    firstCollapseReason:
      detail.firstCollapseReason
      ?? detail.playlistExecutionTrace?.funnelCollapseStage
      ?? null,
  });
}

export function noteGenerateSuccess(
  req: Request,
  detail: {
    requestId: string;
    userId?: string;
    executionPath?: string;
    humanSaveable?: boolean;
    playlistSize: number;
    requestedLength?: number;
    degraded?: boolean;
    honestPartial?: boolean;
    outcome?: GenerateCompleteOutcome;
    interpretation?: GenerateCompleteInterpretation;
    retrieval?: GenerateCompleteRetrieval;
    candidateCounts?: GenerateCompleteCandidateCounts;
    productionTimeline?: ProductionTimeline;
    requestStageTiming?: RequestStageTimingReport;
    playlistExecutionTrace?: PlaylistExecutionTrace;
    firstCollapseReason?: string | null;
    interpretWorldMs?: number | null;
    cacheHit?: boolean;
  },
): void {
  updateGenerateObs(req, {
    outcome: detail.outcome ?? "success",
    requestId: detail.requestId,
    userId: detail.userId,
    executionPath: detail.executionPath ?? detail.playlistExecutionTrace?.executionPath ?? "full_pipeline",
    humanSaveable: detail.humanSaveable ?? detail.playlistExecutionTrace?.humanSaveable ?? null,
    playlistSize: detail.playlistSize,
    requestedLength: detail.requestedLength,
    degraded: detail.degraded,
    honestPartial: detail.honestPartial,
    interpretation: detail.interpretation,
    retrieval: detail.retrieval,
    candidateCounts: detail.candidateCounts,
    productionTimeline: detail.productionTimeline,
    requestStageTiming: detail.requestStageTiming,
    playlistExecutionTrace: detail.playlistExecutionTrace,
    firstCollapseReason:
      detail.firstCollapseReason
      ?? detail.playlistExecutionTrace?.funnelCollapseStage
      ?? null,
    interpretWorldMs: detail.interpretWorldMs ?? detail.interpretation?.interpretWorldMs ?? null,
    cacheHit: detail.cacheHit ?? false,
    failureCode: null,
    failureReason: null,
  });
}

function stageMs(
  timeline: ProductionTimeline | undefined,
  stage: string,
): number | null {
  if (!timeline) return null;
  const value = timeline.stageDurations[stage as keyof typeof timeline.stageDurations];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function deriveStageTimings(
  timeline: ProductionTimeline | undefined,
  requestStageTiming: RequestStageTimingReport | undefined,
  totalMs: number,
  interpretWorldMs: number | null | undefined,
): Record<string, number | null> {
  const report = timeline
    ? buildProductionTimelineReport(timeline, Date.now() - totalMs)
    : null;
  const stageDurations = (report?.stageDurationsMs ?? {}) as Record<string, number>;

  const promptUnderstanding =
    stageMs(timeline, "prompt_understanding")
    ?? stageDurations.prompt_understanding
    ?? null;
  const interpretationMs =
    typeof interpretWorldMs === "number" && interpretWorldMs > 0
      ? Math.round(promptUnderstanding != null ? promptUnderstanding + interpretWorldMs : interpretWorldMs)
      : promptUnderstanding;

  const retrievalMs =
    requestStageTiming?.stages.retrieval?.ms
    ?? stageMs(timeline, "candidate_fetch")
    ?? stageDurations.candidate_fetch
    ?? null;
  const hybridScoringMs = requestStageTiming?.stages.pre_v3_hybrid_scoring?.ms ?? 0;
  const v3LoopMs = requestStageTiming?.stages.v3_multi_candidate_loop?.ms ?? 0;
  const scoringFromStages = hybridScoringMs + v3LoopMs;
  const scoringMs =
    scoringFromStages > 0
      ? scoringFromStages
      : requestStageTiming?.stages.pre_v3_hybrid_scoring?.ms
      ?? stageMs(timeline, "curator_scoring")
      ?? stageDurations.curator_scoring
      ?? null;
  const sequencingMs =
    requestStageTiming?.stages.refinement?.ms
    ?? requestStageTiming?.stages.v3_pipeline?.ms
    ?? requestStageTiming?.stages.v3_multi_candidate_loop?.ms
    ?? stageMs(timeline, "v3_pipeline")
    ?? stageDurations.v3_pipeline
    ?? null;
  const serializationMs = requestStageTiming?.stages.serialization?.ms ?? null;

  return {
    interpretationMs,
    retrievalMs,
    scoringMs: typeof scoringMs === "number" ? Math.round(scoringMs) : null,
    sequencingMs,
    serializationMs,
    totalMs,
  };
}

function queueWaitMs(timeline: ProductionTimeline | undefined): number | null {
  if (timeline?.queue_entered != null && timeline?.worker_acquired != null) {
    if (typeof timeline.queue_entered === "number" && typeof timeline.worker_acquired === "number") {
      return Math.max(0, timeline.worker_acquired - timeline.queue_entered);
    }
  }
  return null;
}

function truncateSummary(value: string | null | undefined, max = 120): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function resolveOutcome(state: GenerateObsState, statusCode: number | undefined): GenerateCompleteOutcome {
  if (state.outcome === "failure") return "failure";
  const finalCount = state.playlistSize ?? state.candidateCounts?.final ?? state.playlistExecutionTrace?.trackCounts?.final ?? 0;
  const requested = state.requestedLength ?? 0;
  const partialByLength =
    requested > 0
    && finalCount > 0
    && finalCount < Math.max(8, Math.ceil(requested * 0.45));
  if (state.outcome === "partial" || state.degraded || state.honestPartial || partialByLength) {
    return "partial";
  }
  if (typeof statusCode === "number" && statusCode >= 200 && statusCode < 300) return "success";
  if (state.outcome === "success") return "success";
  return "failure";
}

function buildPayload(req: Request, state: GenerateObsState): Record<string, unknown> {
  const totalMs = Math.max(0, Date.now() - state.startMs);
  const genCtx = (req as Request & { _genCtx?: Record<string, unknown> })._genCtx;
  const timeline =
    state.productionTimeline
    ?? (genCtx?.productionTimeline as ProductionTimeline | undefined);
  const requestStageTiming =
    state.requestStageTiming
    ?? (() => {
      const raw = genCtx?.requestStageTiming;
      if (!raw || typeof raw !== "object") return undefined;
      if ("report" in raw && typeof (raw as { report?: unknown }).report === "function") {
        return (raw as { report: () => RequestStageTimingReport }).report();
      }
      return raw as RequestStageTimingReport;
    })();
  const trace = state.playlistExecutionTrace;
  const spotify = state.spotifySnapshot ?? getSpotifyApiAuditSnapshot();
  const statusCode = req.res?.statusCode;
  const outcome = resolveOutcome(state, statusCode);
  const interpretWorldMs =
    state.interpretWorldMs
    ?? state.interpretation?.interpretWorldMs
    ?? (typeof (genCtx?.momentPipeline as { pipelineSummary?: { interpretWorldMs?: number } } | undefined)?.pipelineSummary?.interpretWorldMs === "number"
      ? (genCtx!.momentPipeline as { pipelineSummary: { interpretWorldMs: number } }).pipelineSummary.interpretWorldMs
      : null);

  const stages = deriveStageTimings(timeline, requestStageTiming, totalMs, interpretWorldMs);
  const candidateCounts: GenerateCompleteCandidateCounts = {
    shaped: state.candidateCounts?.shaped
      ?? (Array.isArray(genCtx?.scoringInputSongs) ? genCtx.scoringInputSongs.length : null),
    retrieved: state.candidateCounts?.retrieved ?? trace?.trackCounts?.retrieved ?? null,
    afterWorld: state.candidateCounts?.afterWorld ?? trace?.trackCounts?.after_world ?? null,
    afterSampler: state.candidateCounts?.afterSampler ?? trace?.trackCounts?.after_sampler ?? null,
    final: state.candidateCounts?.final ?? state.playlistSize ?? trace?.trackCounts?.final ?? null,
  };

  const retrievalOrchestrator = genCtx?.retrievalOrchestrator as Record<string, unknown> | undefined;
  const retrieval: GenerateCompleteRetrieval = {
    strategy: state.retrieval?.strategy
      ?? (typeof retrievalOrchestrator?.strategy === "string" ? retrievalOrchestrator.strategy : null)
      ?? (typeof retrievalOrchestrator?.mode === "string" ? retrievalOrchestrator.mode : null),
    candidatePoolSize: state.retrieval?.candidatePoolSize
      ?? (typeof retrievalOrchestrator?.candidatePoolSize === "number" ? retrievalOrchestrator.candidatePoolSize : null),
    hybridPoolSize: state.retrieval?.hybridPoolSize
      ?? (typeof retrievalOrchestrator?.hybridPoolSize === "number" ? retrievalOrchestrator.hybridPoolSize : null),
    librarySize: state.retrieval?.librarySize
      ?? (Array.isArray(genCtx?.likedSongs) ? genCtx.likedSongs.length : null),
  };

  const momentPipeline = genCtx?.momentPipeline as {
    canonicalScene?: { sceneId?: string; confidence?: number };
    intent?: { intent?: string };
    worldUnderstanding?: { humanNarrative?: string; emotionalArc?: string };
    pipelineSummary?: { interpretWorldMs?: number };
  } | undefined;

  const interpretation: GenerateCompleteInterpretation = {
    sceneId: state.interpretation?.sceneId ?? momentPipeline?.canonicalScene?.sceneId ?? null,
    confidence: state.interpretation?.confidence ?? momentPipeline?.canonicalScene?.confidence ?? null,
    playlistIntent: state.interpretation?.playlistIntent ?? momentPipeline?.intent?.intent ?? null,
    emotionalArc: state.interpretation?.emotionalArc
      ?? (typeof momentPipeline?.worldUnderstanding?.emotionalArc === "string"
        ? momentPipeline.worldUnderstanding.emotionalArc
        : null),
    humanNarrativeSummary: truncateSummary(
      state.interpretation?.humanNarrativeSummary
      ?? momentPipeline?.worldUnderstanding?.humanNarrative
      ?? null,
    ),
    interpretWorldMs: interpretWorldMs,
  };

  const firstCollapseReason =
    state.firstCollapseReason
    ?? trace?.funnelCollapseStage
    ?? null;
  const trackCount = candidateCounts.final ?? state.playlistSize ?? 0;
  const errorCode = outcome === "failure" ? (state.failureCode ?? "UNKNOWN") : null;

  return {
    event: "generate_complete",
    requestId: state.requestId,
    ...(state.userId ? { userId: hashedIdTag(state.userId) } : {}),
    outcome,
    errorCode,
    failureCode: errorCode,
    failureReason: outcome === "failure" ? (state.failureReason ?? state.failureCode ?? "unknown") : null,
    totalMs,
    queueWaitMs: queueWaitMs(timeline),
    stages: {
      ...stages,
      spotifyMs: spotify.totalDurationMs > 0 ? Math.round(spotify.totalDurationMs) : null,
    },
    executionPath: state.executionPath ?? trace?.executionPath ?? null,
    humanSaveable: state.humanSaveable ?? trace?.humanSaveable ?? null,
    trackCount,
    interpretation,
    retrieval,
    candidateCounts,
    playlistSize: trackCount,
    spotify: {
      requests: spotify.totalRequests,
      failures: spotify.failures,
      retries: spotify.retries,
      rateLimitResponses: spotify.rateLimitResponses,
    },
    poolCollapse: firstCollapseReason != null,
    ...(firstCollapseReason ? { firstCollapseReason } : {}),
    cacheHit: state.cacheHit ?? false,
    httpStatus: statusCode ?? null,
  };
}

function recordPhaseMetrics(stages: Record<string, number | null>): void {
  const map: Array<[string, number | null]> = [
    ["interpretation", stages.interpretationMs ?? null],
    ["retrieval", stages.retrievalMs ?? null],
    ["scoring", stages.scoringMs ?? null],
    ["sequencing", stages.sequencingMs ?? null],
    ["serialization", stages.serializationMs ?? null],
    ["spotify", stages.spotifyMs ?? null],
    ["total", stages.totalMs ?? null],
  ];
  for (const [phase, ms] of map) {
    if (typeof ms === "number" && ms > 0) recordGenerationPhaseDuration(phase, ms);
  }
}

function logExecutionTraceSummary(log: Logger, state: GenerateObsState): void {
  const trace = state.playlistExecutionTrace;
  if (!trace) return;
  log.warn(
    {
      event: "playlist_execution_trace_summary",
      requestId: state.requestId,
      executionPath: trace.executionPath,
      humanSaveable: trace.humanSaveable,
      funnelCollapseStage: trace.funnelCollapseStage,
      rejectionReasons: trace.rejectionReasons?.slice(0, 8) ?? [],
      trackCounts: trace.trackCounts,
      curatorScore: trace.curatorScore,
      fastFallbackUsed: trace.fastFallbackUsed,
      debugFlags: trace.debugFlags,
    },
    "playlist_execution_trace_summary",
  );
}

export function emitGenerateComplete(req: Request, log: Logger): void {
  const state = obsStore(req);
  if (state.emitted) return;

  try {
    const payload = buildPayload(req, state);
    const outcome = payload.outcome as GenerateCompleteOutcome;
    const totalMs = payload.totalMs as number;
    const stages = payload.stages as Record<string, number | null>;

    recordGenerateOutcome(outcome !== "failure", totalMs);
    recordPhaseMetrics(stages);

    if (outcome === "success") {
      log.info(payload, "generate_complete");
    } else {
      log.warn(payload, "generate_complete");
    }

    if (outcome === "failure" || state.humanSaveable === false || payload.humanSaveable === false) {
      logExecutionTraceSummary(log, state);
    }
    state.emitted = true;
  } catch (err) {
    state.emitted = true;
    log.error(
      {
        err,
        requestId: state.requestId,
        event: "generate_complete_emit_failed",
      },
      "generate_complete emit failed",
    );
  }
}
