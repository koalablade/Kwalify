import type { FailureContext } from "./failure-types";
import { moduleLogger } from "./logger";

export type SystemHealthState = "HEALTHY" | "DEGRADED" | "CRITICAL";

const log = moduleLogger("system-health");

const WINDOW_MS = 60_000;
const failures: Array<{ at: number; type: string; stage: string }> = [];
let overloadUntil = 0;

function prune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (failures.length > 0 && (failures[0]?.at ?? 0) < cutoff) failures.shift();
}

export function recordSystemFailure(ctx: FailureContext): void {
  prune();
  failures.push({ at: Date.now(), type: ctx.type, stage: ctx.stage });
  log.warn(
    {
      requestId: ctx.requestId,
      stage: ctx.stage,
      type: ctx.type,
      recoverable: ctx.recoverable,
      err: ctx.error,
    },
    "system_failure_recorded",
  );
}

export function recordSystemOverload(): void {
  overloadUntil = Date.now() + 30_000;
  log.warn({ healthState: getSystemHealthState() }, "system_overload_recorded");
}

export function getSystemHealthState(): SystemHealthState {
  prune();
  const recentStageFailures = failures.length;
  if (recentStageFailures >= 3) return "CRITICAL";
  if (Date.now() < overloadUntil) return "DEGRADED";
  if (failures.some((failure) => failure.type === "DB_FAILURE")) return "DEGRADED";
  if (recentStageFailures > 0) return "DEGRADED";
  return "HEALTHY";
}
