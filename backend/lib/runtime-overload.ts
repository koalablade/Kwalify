const DEFAULT_GENERATE_CONCURRENCY = 1;

let activeGenerateRequests = 0;

function maxGenerateConcurrency(): number {
  const parsed = Number.parseInt(process.env["GENERATE_CONCURRENCY_LIMIT"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GENERATE_CONCURRENCY;
}

export function tryAcquireGenerateSlot(): boolean {
  if (activeGenerateRequests >= maxGenerateConcurrency()) return false;
  activeGenerateRequests += 1;
  return true;
}

export function releaseGenerateSlot(): void {
  activeGenerateRequests = Math.max(0, activeGenerateRequests - 1);
}

export function getGenerateOverloadState(): { active: number; limit: number } {
  return {
    active: activeGenerateRequests,
    limit: maxGenerateConcurrency(),
  };
}
