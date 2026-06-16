import type { FailureContext } from "./failure-types";

export type PipelineTrace = {
  requestId?: string;
  stageDurations: Record<string, number>;
  intermediateCounts: Record<string, number>;
  retryCounts: Record<string, number>;
  failures: Array<{
    stage: string;
    type: string;
    recoverable: boolean;
    message: string;
  }>;
  fallbackEvents: string[];
  recoveryEvents: Array<{
    stage: string;
    event: "recovery_attempted" | "recovery_success" | "recovery_failed";
  }>;
  degraded: boolean;
  degradationReasons: string[];
};

export function createPipelineTrace(requestId?: string): PipelineTrace {
  return {
    requestId,
    stageDurations: {},
    intermediateCounts: {},
    retryCounts: {},
    failures: [],
    fallbackEvents: [],
    recoveryEvents: [],
    degraded: false,
    degradationReasons: [],
  };
}

export function recordTraceDuration(trace: PipelineTrace | undefined, stage: string, durationMs: number): void {
  if (!trace) return;
  trace.stageDurations[stage] = (trace.stageDurations[stage] ?? 0) + Math.max(0, Math.round(durationMs));
}

export function recordTraceCount(trace: PipelineTrace | undefined, key: string, count: number): void {
  if (!trace || !Number.isFinite(count)) return;
  trace.intermediateCounts[key] = Math.max(0, Math.round(count));
}

export function recordTraceFallback(trace: PipelineTrace | undefined, event: string): void {
  if (!trace || !event) return;
  trace.fallbackEvents.push(event);
  trace.degraded = true;
  trace.degradationReasons.push(event);
}

export function recordTraceFailure(trace: PipelineTrace | undefined, ctx: FailureContext): void {
  if (!trace) return;
  trace.failures.push({
    stage: ctx.stage,
    type: ctx.type,
    recoverable: ctx.recoverable,
    message: ctx.error.message,
  });
  trace.degraded = true;
  trace.degradationReasons.push(`${ctx.stage}:${ctx.type}`);
}

export function recordTraceRecovery(
  trace: PipelineTrace | undefined,
  stage: string,
  event: "recovery_attempted" | "recovery_success" | "recovery_failed",
): void {
  if (!trace) return;
  trace.recoveryEvents.push({ stage, event });
  trace.retryCounts[stage] = (trace.retryCounts[stage] ?? 0) + (event === "recovery_attempted" ? 1 : 0);
}
