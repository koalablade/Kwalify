import { createConcurrencyLimiter } from "./concurrency-limiter";

const generateLimiter = createConcurrencyLimiter({
  name: "generate_pipeline",
  limitEnv: "GENERATE_CONCURRENCY_LIMIT",
  queueLimitEnv: "GENERATE_QUEUE_LIMIT",
  defaultLimit: 10,
  defaultQueueLimit: 20,
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
