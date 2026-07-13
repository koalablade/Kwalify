import { createConcurrencyLimiter } from "./concurrency-limiter";

function envIntOrUndefined(name: string): number | undefined {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const generateLimiter = createConcurrencyLimiter({
  name: "generate_pipeline",
  limitEnv: "GENERATE_CONCURRENCY_LIMIT",
  queueLimitEnv: "GENERATE_QUEUE_LIMIT",
  defaultLimit: 4,
  defaultQueueLimit: 12,
  // Operational override for heavy single-instance / audit deployments where a
  // single generation legitimately exceeds the default 30s overload heuristic
  // (which otherwise trips chronic system-health degradation + clustering bypass).
  overloadLatencyMs: envIntOrUndefined("GENERATE_OVERLOAD_LATENCY_MS"),
  overloadQueueThreshold: envIntOrUndefined("GENERATE_OVERLOAD_QUEUE_THRESHOLD"),
});

export async function acquireGenerateSlot(): Promise<() => void> {
  return generateLimiter.acquire();
}

export function releaseGenerateSlot(): void {
  generateLimiter.release();
}

export function recordGenerateLatency(latencyMs: number): void {
  generateLimiter.recordLatency(latencyMs);
}

export function getGenerateOverloadState(): { active: number; queued: number; limit: number; queueLimit: number; averageLatencyMs: number } {
  return generateLimiter.state();
}
