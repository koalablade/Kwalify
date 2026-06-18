/** Execution health profiling for duplicate-stage detection. */
import type { Request } from "express";
import type {
  ExecutionHealthBaselineEntry,
  ExecutionHealthCause,
  ExecutionHealthProfile,
  ExecutionHealthState,
} from "./generation-types";
import { EXECUTION_HEALTH_BASELINE_SIZE } from "./generation-types";

const executionHealthBaseline: ExecutionHealthBaselineEntry[] = [];

export function createExecutionHealthProfile(cacheStatus: "HIT" | "MISS"): ExecutionHealthProfile {
  return {
    hydrationCount: 0,
    cacheStatus,
    retrievalPassCount: 0,
    scoringPassCount: 0,
    v3InvocationCount: 0,
    repairPassCount: 0,
    finalisationCount: 0,
    healthState: "HEALTHY",
    primaryCause: null,
    driftDetected: false,
    degradedPerformanceMode: false,
    duplicateDetections: [],
    stageCalls: {},
    needsCorrection: [],
  };
}

export function recordExecutionStage(
  profile: ExecutionHealthProfile,
  logger: Request["log"],
  stage: string,
  callStackTag: string,
  opts: { maxCalls?: number; cause?: ExecutionHealthCause; blockDuplicate?: boolean } = {},
): boolean {
  const nextCount = (profile.stageCalls[stage] ?? 0) + 1;
  profile.stageCalls[stage] = nextCount;
  const maxCalls = opts.maxCalls ?? 1;
  if (nextCount <= maxCalls) return true;

  profile.healthState = "BROKEN";
  profile.primaryCause = profile.primaryCause ?? opts.cause ?? "UNEXPECTED_FALLBACK_PATH";
  profile.driftDetected = true;
  profile.degradedPerformanceMode = true;
  profile.duplicateDetections.push({ stage, callStackTag });
  profile.needsCorrection.push(stage);
  logger.error(
    {
      stage,
      callStackTag,
      count: nextCount,
      maxCalls,
      cause: profile.primaryCause,
    },
    "DUPLICATE_EXECUTION_DETECTED",
  );
  return opts.blockDuplicate !== true;
}

export function finaliseExecutionHealth(
  profile: ExecutionHealthProfile,
  elapsedMs: number,
): {
  healthState: ExecutionHealthState;
  primaryCause: ExecutionHealthCause | null;
  driftDetected: boolean;
  executionSummary: Record<string, unknown>;
  rollingBaseline: Record<string, unknown>;
} {
  if (profile.healthState !== "BROKEN") {
    if (profile.hydrationCount > 1) {
      profile.healthState = "BROKEN";
      profile.primaryCause = profile.primaryCause ?? "MULTI_HYDRATION";
    } else if (profile.v3InvocationCount > 1) {
      profile.healthState = "BROKEN";
      profile.primaryCause = profile.primaryCause ?? "V3_REENTRY";
    } else if (profile.retrievalPassCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "DUPLICATE_RETRIEVAL";
    } else if (profile.scoringPassCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "DUPLICATE_SCORING";
    } else if (profile.finalisationCount > 1) {
      profile.healthState = "DEGRADED";
      profile.primaryCause = profile.primaryCause ?? "CONTROLLER_PIPELINE_CONFLICT";
    }
  }
  profile.driftDetected = profile.driftDetected || profile.healthState !== "HEALTHY";
  profile.degradedPerformanceMode = profile.degradedPerformanceMode || profile.healthState !== "HEALTHY";

  const latencyCategory = elapsedMs < 20_000 ? "FAST" : elapsedMs < 60_000 ? "NORMAL" : "SLOW";
  executionHealthBaseline.push({
    hydrationCount: profile.hydrationCount,
    retrievalPassCount: profile.retrievalPassCount,
    scoringPassCount: profile.scoringPassCount,
    latencyCategory,
  });
  if (executionHealthBaseline.length > EXECUTION_HEALTH_BASELINE_SIZE) executionHealthBaseline.shift();

  const average = (values: number[]): number =>
    values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;

  return {
    healthState: profile.healthState,
    primaryCause: profile.primaryCause,
    driftDetected: profile.driftDetected,
    executionSummary: {
      hydrationCount: profile.hydrationCount,
      cacheStatus: profile.cacheStatus,
      retrievalPassCount: profile.retrievalPassCount,
      scoringPassCount: profile.scoringPassCount,
      v3InvocationCount: profile.v3InvocationCount,
      repairPassCount: profile.repairPassCount,
      finalisationCount: profile.finalisationCount,
      degradedPerformanceMode: profile.degradedPerformanceMode,
      duplicateDetections: profile.duplicateDetections,
      needsCorrection: profile.needsCorrection,
    },
    rollingBaseline: {
      sampleSize: executionHealthBaseline.length,
      averageHydrationCount: average(executionHealthBaseline.map((entry) => entry.hydrationCount)),
      averageRetrievalPasses: average(executionHealthBaseline.map((entry) => entry.retrievalPassCount)),
      averageScoringPasses: average(executionHealthBaseline.map((entry) => entry.scoringPassCount)),
      latencyMix: executionHealthBaseline.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.latencyCategory] = (acc[entry.latencyCategory] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}
