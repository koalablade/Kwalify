/**
 * Canonical playlist execution trace — single debuggable format for every /generate exit path.
 * Observability only; does not affect ranking, clustering, or gate thresholds.
 */

import {
  type ExecutionPath,
  isExecutionPath,
  normalizeExecutionPath,
} from "./execution-state";

export type { ExecutionPath } from "./execution-state";
export { EXECUTION_PATHS, isHtmlResponseBody, isExecutionPath } from "./execution-state";

export type StageStatus = "completed" | "failed" | "skipped" | "bypassed";

export type StageAttributionEntry = {
  status: StageStatus;
  detail: string | null;
  diff: Record<string, unknown> | null;
};

export type PlaylistExecutionTrace = {
  requestId: string;
  prompt: string;
  seed: number | string | null;
  executionPath: ExecutionPath;
  humanSaveable: boolean;
  stageAttribution: {
    retrieval: StageAttributionEntry;
    scene_world: StageAttributionEntry;
    sampler: StageAttributionEntry;
    interleaver: StageAttributionEntry;
    editorial_audit: StageAttributionEntry;
  };
  dominantCluster: string | null;
  openingTenClusterTrace: Array<Record<string, unknown>>;
  rejectionReasons: string[];
  funnelCollapseStage: string | null;
  fastFallbackUsed: boolean;
  curatorScore: number | null;
  trackCounts: {
    retrieved: number;
    after_world: number;
    after_sampler: number;
    final: number;
  };
  debugFlags: {
    gateExecuted: boolean;
    gateBypassed: boolean;
    timeoutOccurred: boolean;
  };
};

export type PlaylistExecutionTraceDraft = Partial<PlaylistExecutionTrace> & {
  requestId: string;
  prompt: string;
};

const STAGE_ORDER = [
  "retrieval",
  "scene_world",
  "sampler",
  "interleaver",
  "editorial_audit",
] as const;

type StageKey = (typeof STAGE_ORDER)[number];

function emptyStage(status: StageStatus = "skipped"): StageAttributionEntry {
  return { status, detail: null, diff: null };
}

function defaultStageAttribution(): PlaylistExecutionTrace["stageAttribution"] {
  return {
    retrieval: emptyStage("skipped"),
    scene_world: emptyStage("skipped"),
    sampler: emptyStage("skipped"),
    interleaver: emptyStage("skipped"),
    editorial_audit: emptyStage("skipped"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeCuratorScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function mapFunnelStageToAttributionKey(stage: string | null): StageKey | null {
  if (!stage) return null;
  const lower = stage.toLowerCase();
  if (lower.includes("retrieval")) return "retrieval";
  if (lower.includes("world") || lower.includes("primary_family") || lower.includes("strict_cluster")) return "scene_world";
  if (lower.includes("sampler") || lower.includes("opening5_pre")) return "sampler";
  if (lower.includes("interleaver") || lower.includes("opening5_post")) return "interleaver";
  if (lower.includes("editorial")) return "editorial_audit";
  return null;
}

function firstFailingStage(
  stages: PlaylistExecutionTrace["stageAttribution"],
): StageKey | null {
  for (const key of STAGE_ORDER) {
    if (stages[key].status === "failed") return key;
  }
  return null;
}

export function inferRejectionReasons(trace: PlaylistExecutionTrace): string[] {
  const existing = trace.rejectionReasons.filter((r) => r.length > 0 && r !== "unspecified");
  if (existing.length > 0) return existing;

  if (trace.humanSaveable) {
    return ["human_saveable:passed"];
  }

  const inferred: string[] = [];

  if (trace.debugFlags.gateBypassed || !trace.debugFlags.gateExecuted) {
    const stage = trace.executionPath === "timeout_fallback"
      ? "timeout_fallback"
      : trace.executionPath === "fast_fallback"
        ? "fast_fallback"
        : trace.executionPath;
    inferred.push(`gate_not_executed:${stage}`);
  }

  if (trace.funnelCollapseStage) {
    inferred.push(`pipeline_funnel_collapse:${trace.funnelCollapseStage}`);
  }

  const failingStage = firstFailingStage(trace.stageAttribution);
  if (failingStage) {
    inferred.push(`stage_failure:${failingStage}`);
  }

  if (trace.executionPath === "fast_fallback") {
    inferred.push("execution_path:fast_fallback");
  } else if (trace.executionPath === "timeout_fallback") {
    inferred.push("execution_path:timeout_fallback");
  } else if (trace.executionPath === "gate_failure") {
    inferred.push("execution_path:gate_failure");
  } else if (trace.executionPath === "partial_pipeline") {
    inferred.push("execution_path:partial_pipeline");
  } else if (trace.executionPath === "invalid_html_response") {
    inferred.push("api_returned_html");
  } else if (trace.executionPath === "unknown_exit") {
    inferred.push("unknown_exit");
  }

  if (trace.curatorScore == null && trace.debugFlags.gateExecuted && !trace.debugFlags.gateBypassed) {
    inferred.push("curator_score:unavailable");
  }

  if (inferred.length === 0) {
    inferred.push("unknown_failure_stage");
  }

  return inferred;
}

export function finalizeExecutionTrace(draft: PlaylistExecutionTraceDraft): PlaylistExecutionTrace {
  const executionPath = normalizeExecutionPath(draft.executionPath, "unknown_exit");
  const stageAttribution = {
    ...defaultStageAttribution(),
    ...(draft.stageAttribution ?? {}),
  };

  const funnelCollapseStage = draft.funnelCollapseStage ?? null;
  const funnelStageKey = mapFunnelStageToAttributionKey(funnelCollapseStage);
  if (funnelStageKey && stageAttribution[funnelStageKey].status === "skipped") {
    stageAttribution[funnelStageKey] = {
      status: "failed",
      detail: funnelCollapseStage,
      diff: stageAttribution[funnelStageKey].diff,
    };
  }

  const trace: PlaylistExecutionTrace = {
    requestId: draft.requestId,
    prompt: draft.prompt,
    seed: draft.seed ?? null,
    executionPath,
    humanSaveable: draft.humanSaveable === true,
    stageAttribution,
    dominantCluster: draft.dominantCluster ?? null,
    openingTenClusterTrace: Array.isArray(draft.openingTenClusterTrace)
      ? draft.openingTenClusterTrace
      : [],
    rejectionReasons: Array.isArray(draft.rejectionReasons)
      ? draft.rejectionReasons.map(String).filter((r) => r !== "unspecified")
      : [],
    funnelCollapseStage,
    fastFallbackUsed: draft.fastFallbackUsed === true,
    curatorScore: normalizeCuratorScore(draft.curatorScore),
    trackCounts: {
      retrieved: draft.trackCounts?.retrieved ?? 0,
      after_world: draft.trackCounts?.after_world ?? 0,
      after_sampler: draft.trackCounts?.after_sampler ?? 0,
      final: draft.trackCounts?.final ?? 0,
    },
    debugFlags: {
      gateExecuted: draft.debugFlags?.gateExecuted === true,
      gateBypassed: draft.debugFlags?.gateBypassed === true,
      timeoutOccurred: draft.debugFlags?.timeoutOccurred === true,
    },
  };

  trace.rejectionReasons = inferRejectionReasons(trace);
  return trace;
}

/** Alias used by controller/pipeline exit paths. */
export const finalizePlaylistExecutionTrace = finalizeExecutionTrace;

export function extractFinalPlaylistExecutionTrace(
  data: Record<string, unknown>,
): PlaylistExecutionTrace | null {
  const top = data.playlistExecutionTrace;
  if (!top || typeof top !== "object") return null;
  return finalizeExecutionTrace(top as PlaylistExecutionTraceDraft);
}

export function buildUnknownExitTraceDraft(opts: {
  requestId: string;
  prompt: string;
  seed?: number | string | null;
  reason: string;
  timeoutOccurred?: boolean;
}): PlaylistExecutionTraceDraft {
  return {
    requestId: opts.requestId,
    prompt: opts.prompt,
    seed: opts.seed ?? null,
    executionPath: "unknown_exit",
    humanSaveable: false,
    rejectionReasons: [`unknown_exit:${opts.reason}`],
    dominantCluster: null,
    openingTenClusterTrace: [],
    funnelCollapseStage: null,
    fastFallbackUsed: false,
    curatorScore: null,
    trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: 0 },
    stageAttribution: defaultStageAttribution(),
    debugFlags: {
      gateExecuted: false,
      gateBypassed: true,
      timeoutOccurred: opts.timeoutOccurred === true,
    },
  };
}

export function attachExecutionTrace<T extends Record<string, unknown>>(
  payload: T,
  draft: PlaylistExecutionTraceDraft,
): T & { playlistExecutionTrace: PlaylistExecutionTrace } {
  return {
    ...payload,
    playlistExecutionTrace: finalizeExecutionTrace(draft),
  };
}

export function extractPlaylistExecutionTrace(
  data: Record<string, unknown>,
): PlaylistExecutionTrace | null {
  const finalTrace = extractFinalPlaylistExecutionTrace(data);
  if (finalTrace) return finalTrace;

  const v3 = asRecord(data.v3Diagnostics);
  const fromV3 = v3?.playlistExecutionTrace;
  if (fromV3 && typeof fromV3 === "object") {
    return finalizeExecutionTrace(fromV3 as PlaylistExecutionTraceDraft);
  }
  const gen = asRecord(data.generationDiagnostics);
  const v3Pipeline = asRecord(gen?.v3Pipeline);
  const fromPipeline = v3Pipeline?.playlistExecutionTrace;
  if (fromPipeline && typeof fromPipeline === "object") {
    return finalizeExecutionTrace(fromPipeline as PlaylistExecutionTraceDraft);
  }
  return null;
}

export function buildFallbackExecutionTraceDraft(opts: {
  requestId: string;
  prompt: string;
  seed?: number | string | null;
  executionPath: "fast_fallback" | "timeout_fallback";
  failureDetail?: string | null;
  finalTrackCount?: number;
  timeoutOccurred?: boolean;
}): PlaylistExecutionTraceDraft {
  const bypassed = true;
  return {
    requestId: opts.requestId,
    prompt: opts.prompt,
    seed: opts.seed ?? null,
    executionPath: opts.executionPath,
    humanSaveable: false,
    fastFallbackUsed: opts.executionPath === "fast_fallback",
    dominantCluster: null,
    openingTenClusterTrace: [],
    funnelCollapseStage: null,
    curatorScore: null,
    trackCounts: {
      retrieved: 0,
      after_world: 0,
      after_sampler: 0,
      final: opts.finalTrackCount ?? 0,
    },
    stageAttribution: {
      retrieval: emptyStage("bypassed"),
      scene_world: emptyStage("bypassed"),
      sampler: emptyStage("bypassed"),
      interleaver: emptyStage("bypassed"),
      editorial_audit: emptyStage("bypassed"),
    },
    rejectionReasons: [
      `gate_not_executed:${opts.executionPath}${opts.failureDetail ? `:${opts.failureDetail}` : ""}`,
    ],
    debugFlags: {
      gateExecuted: false,
      gateBypassed: bypassed,
      timeoutOccurred: opts.timeoutOccurred === true,
    },
  };
}

export function buildGateFailureExecutionTraceDraft(opts: {
  requestId: string;
  prompt: string;
  seed?: number | string | null;
  gate: Record<string, unknown>;
  attribution?: Record<string, unknown> | null;
}): PlaylistExecutionTraceDraft {
  const attribution = opts.attribution ?? asRecord(opts.gate.attribution);
  const funnel = asRecord(opts.gate.sceneClusterFunnel) ?? asRecord(attribution?.sceneClusterFunnel);
  const openingTen = asRecord(opts.gate.openingTenDominantCluster)
    ?? asRecord(attribution?.openingTenDominantCluster);
  const interleaverAudit = asRecord(opts.gate.interleaverAudit) ?? asRecord(attribution?.interleaverAudit);
  const funnelCollapseStage = typeof funnel?.earliestCollapseStage === "string"
    ? funnel.earliestCollapseStage
    : null;
  const dominantCluster =
    (typeof opts.gate.dominantCluster === "string" ? opts.gate.dominantCluster : null) ??
    (typeof attribution?.dominantCluster === "string" ? attribution.dominantCluster : null) ??
    (typeof funnel?.dominantClusterLabel === "string" ? funnel.dominantClusterLabel : null);

  const stageResponsible = typeof attribution?.stageResponsible === "string"
    ? attribution.stageResponsible
    : null;
  const stageAttribution = defaultStageAttribution();
  const stageMap: Record<string, StageKey> = {
    retrieval: "retrieval",
    "scene world layer": "scene_world",
    "cluster layer": "scene_world",
    sampler: "sampler",
    interleaver: "interleaver",
    "editorial audit": "editorial_audit",
  };
  const mappedStage = stageResponsible ? stageMap[stageResponsible] : mapFunnelStageToAttributionKey(funnelCollapseStage);
  if (mappedStage) {
    stageAttribution[mappedStage] = {
      status: "failed",
      detail: stageResponsible ?? funnelCollapseStage,
      diff: interleaverAudit
        ? {
            prePurity: interleaverAudit.preInterleaverOpeningClusterPurity,
            postPurity: interleaverAudit.postInterleaverOpeningClusterPurity,
            failureOrigin: interleaverAudit.failureOrigin,
          }
        : null,
    };
  }

  const counts = asRecord(funnel?.counts);
  const rejectionReasons = Array.isArray(opts.gate.rejectionReasons)
    ? opts.gate.rejectionReasons.map(String).filter((r) => r.length > 0 && r !== "unspecified")
    : [];

  const rawCuratorScore = normalizeCuratorScore(opts.gate.curatorScore)
    ?? normalizeCuratorScore(asRecord(opts.gate.breakdown)?.curatorScore);
  const evaluationIncomplete = rawCuratorScore == null;
  if (evaluationIncomplete) {
    rejectionReasons.push("evaluation_metadata_incomplete:curator_score_non_finite");
  }

  const executionPath: ExecutionPath = evaluationIncomplete ? "partial_pipeline" : "gate_failure";

  return {
    requestId: opts.requestId,
    prompt: opts.prompt,
    seed: opts.seed ?? null,
    executionPath,
    humanSaveable: false,
    dominantCluster,
    openingTenClusterTrace: Array.isArray(openingTen?.trace)
      ? openingTen.trace as Array<Record<string, unknown>>
      : [],
    rejectionReasons,
    funnelCollapseStage,
    fastFallbackUsed: false,
    curatorScore: rawCuratorScore,
    trackCounts: {
      retrieved: Number(counts?.retrieval ?? 0),
      after_world: Number(counts?.world_layer ?? 0),
      after_sampler: Number(counts?.sampler_pool ?? 0),
      final: 0,
    },
    stageAttribution: {
      retrieval: stageAttribution.retrieval.status === "failed"
        ? stageAttribution.retrieval
        : { status: "completed", detail: null, diff: null },
      scene_world: stageAttribution.scene_world.status === "failed"
        ? stageAttribution.scene_world
        : { status: counts?.world_layer != null ? "completed" : "skipped", detail: null, diff: null },
      sampler: stageAttribution.sampler.status === "failed"
        ? stageAttribution.sampler
        : { status: counts?.sampler_pool != null ? "completed" : "skipped", detail: null, diff: null },
      interleaver: {
        status: interleaverAudit?.degraded === true ? "failed" : counts?.opening5_post_interleaver != null ? "completed" : "skipped",
        detail: typeof interleaverAudit?.failureOrigin === "string" ? interleaverAudit.failureOrigin : null,
        diff: interleaverAudit
          ? {
              prePurity: interleaverAudit.preInterleaverOpeningClusterPurity,
              postPurity: interleaverAudit.postInterleaverOpeningClusterPurity,
              degraded: interleaverAudit.degraded,
            }
          : null,
      },
      editorial_audit: stageAttribution.editorial_audit,
    },
    debugFlags: {
      gateExecuted: true,
      gateBypassed: opts.gate.bypassed === true,
      timeoutOccurred: false,
    },
  };
}

export function buildV3PipelineExecutionTraceDraft(opts: {
  requestId: string;
  prompt: string;
  seed?: number | string | null;
  humanSaveable: boolean;
  gateExecuted: boolean;
  gateBypassed?: boolean;
  humanSaveabilityGate: Record<string, unknown>;
  sceneClusterFunnel: Record<string, unknown> | null;
  openingTenDominantCluster: Record<string, unknown> | null;
  interleaverAudit?: Record<string, unknown> | null;
  dominantClusterLabel?: string | null;
  retrievedCount: number;
  finalTrackCount: number;
  partialPipeline?: boolean;
  fastFallback?: boolean;
}): PlaylistExecutionTraceDraft {
  const funnel = opts.sceneClusterFunnel;
  const counts = asRecord(funnel?.counts);
  const funnelCollapseStage = typeof funnel?.earliestCollapseStage === "string"
    ? funnel.earliestCollapseStage
    : null;
  const interleaverAudit = opts.interleaverAudit
    ?? asRecord(opts.humanSaveabilityGate.interleaverAudit)
    ?? asRecord(asRecord(opts.humanSaveabilityGate.attribution)?.interleaverAudit);

  const rejectionReasons = Array.isArray(opts.humanSaveabilityGate.rejectionReasons)
    ? opts.humanSaveabilityGate.rejectionReasons.map(String).filter((r) => r !== "unspecified")
    : [];

  const stageAttribution = defaultStageAttribution();
  if (opts.retrievedCount > 0) {
    stageAttribution.retrieval = { status: "completed", detail: null, diff: null };
  }
  if (Number(counts?.world_layer ?? 0) > 0) {
    stageAttribution.scene_world = { status: "completed", detail: null, diff: null };
  }
  if (Number(counts?.sampler_pool ?? 0) > 0) {
    stageAttribution.sampler = { status: "completed", detail: null, diff: null };
  }
  if (counts?.opening5_post_interleaver != null || interleaverAudit) {
    stageAttribution.interleaver = {
      status: interleaverAudit?.degraded === true ? "failed" : "completed",
      detail: typeof interleaverAudit?.failureOrigin === "string" ? interleaverAudit.failureOrigin : null,
      diff: interleaverAudit
        ? {
            prePurity: interleaverAudit.preInterleaverOpeningClusterPurity,
            postPurity: interleaverAudit.postInterleaverOpeningClusterPurity,
            repairSwapCount: asRecord(opts.openingTenDominantCluster)?.interleaver
              ? asRecord(asRecord(opts.openingTenDominantCluster)?.interleaver)?.repairSwapCount
              : null,
          }
        : null,
    };
  }
  if (opts.gateExecuted) {
    stageAttribution.editorial_audit = { status: "completed", detail: null, diff: null };
  }

  const funnelStageKey = mapFunnelStageToAttributionKey(funnelCollapseStage);
  if (funnelStageKey && !opts.humanSaveable) {
    stageAttribution[funnelStageKey] = {
      ...stageAttribution[funnelStageKey],
      status: "failed",
      detail: funnelCollapseStage,
      diff: stageAttribution[funnelStageKey].diff,
    };
  }

  let executionPath: ExecutionPath = "full_pipeline";
  if (opts.fastFallback) executionPath = "fast_fallback";
  else if (opts.partialPipeline) executionPath = "partial_pipeline";
  else if (!opts.humanSaveable && opts.gateExecuted) executionPath = "gate_failure";

  return {
    requestId: opts.requestId,
    prompt: opts.prompt,
    seed: opts.seed ?? null,
    executionPath,
    humanSaveable: opts.humanSaveable,
    dominantCluster:
      opts.dominantClusterLabel ??
      (typeof opts.humanSaveabilityGate.dominantCluster === "string" ? opts.humanSaveabilityGate.dominantCluster : null) ??
      (typeof funnel?.dominantClusterLabel === "string" ? funnel.dominantClusterLabel : null),
    openingTenClusterTrace: Array.isArray(opts.openingTenDominantCluster?.trace)
      ? opts.openingTenDominantCluster!.trace as Array<Record<string, unknown>>
      : [],
    rejectionReasons,
    funnelCollapseStage: opts.humanSaveable ? null : funnelCollapseStage,
    fastFallbackUsed: opts.fastFallback === true,
    curatorScore: normalizeCuratorScore(opts.humanSaveabilityGate.curatorScore),
    trackCounts: {
      retrieved: opts.retrievedCount,
      after_world: Number(counts?.world_layer ?? 0),
      after_sampler: Number(counts?.sampler_pool ?? 0),
      final: opts.finalTrackCount,
    },
    stageAttribution,
    debugFlags: {
      gateExecuted: opts.gateExecuted,
      gateBypassed: opts.gateBypassed === true,
      timeoutOccurred: false,
    },
  };
}

export function assertExecutionTraceInvariants(trace: PlaylistExecutionTrace): void {
  if (!isExecutionPath(trace.executionPath)) {
    throw new Error(`playlistExecutionTrace.executionPath invalid: ${String(trace.executionPath)}`);
  }
  if (trace.rejectionReasons.length === 0) {
    throw new Error("playlistExecutionTrace.rejectionReasons must not be empty");
  }
  if (trace.rejectionReasons.some((r) => r === "unspecified")) {
    throw new Error('playlistExecutionTrace.rejectionReasons must not contain "unspecified"');
  }
  if (!trace.humanSaveable && trace.funnelCollapseStage == null) {
    const hasFailureSignal =
      trace.executionPath !== "full_pipeline" ||
      trace.debugFlags.gateBypassed ||
      !trace.debugFlags.gateExecuted ||
      STAGE_ORDER.some((k) => trace.stageAttribution[k].status === "failed");
    if (hasFailureSignal && trace.rejectionReasons.every((r) => r === "human_saveable:passed")) {
      throw new Error("failed trace must not only contain human_saveable:passed");
    }
  }
}
