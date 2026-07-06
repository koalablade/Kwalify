export interface LaunchHealthSnapshot {
  collectedAt: string;
  sampleSize: number;
  launchModeRequestPct: number;
  avgEmotionalConsistencyScore: number;
  driftWarningRate: number;
  perceptionTestPassRate: number;
  perceptionTestsPassed: number;
  perceptionTestsTotal: number;
}

interface HealthAccumulator {
  totalRequests: number;
  launchModeRequests: number;
  consistencySum: number;
  consistencyCount: number;
  driftWarnings: number;
}

const accumulator: HealthAccumulator = {
  totalRequests: 0,
  launchModeRequests: 0,
  consistencySum: 0,
  consistencyCount: 0,
  driftWarnings: 0,
};

let cachedPerception: {
  passRate: number;
  passed: number;
  total: number;
} | null = null;

export function recordPerceptionTestResult(passed: number, failed: number): void {
  const total = passed + failed;
  cachedPerception = {
    passRate: total > 0 ? passed / total : 0,
    passed,
    total,
  };
}

export function recordLaunchHealthEvent(event: {
  launchMode: boolean;
  emotionalConsistencyScore?: number | null;
  hadDriftWarning?: boolean;
}): void {
  accumulator.totalRequests += 1;
  if (event.launchMode) accumulator.launchModeRequests += 1;

  if (
    event.emotionalConsistencyScore != null &&
    Number.isFinite(event.emotionalConsistencyScore)
  ) {
    accumulator.consistencySum += event.emotionalConsistencyScore;
    accumulator.consistencyCount += 1;
  }

  if (event.hadDriftWarning) {
    accumulator.driftWarnings += 1;
  }
}

export function getLaunchHealthSnapshot(): LaunchHealthSnapshot {
  const sampleSize = accumulator.totalRequests;
  const launchModeRequestPct =
    sampleSize > 0 ? (accumulator.launchModeRequests / sampleSize) * 100 : 0;
  const avgEmotionalConsistencyScore =
    accumulator.consistencyCount > 0
      ? accumulator.consistencySum / accumulator.consistencyCount
      : 0;
  const driftWarningRate =
    sampleSize > 0 ? (accumulator.driftWarnings / sampleSize) * 100 : 0;

  return {
    collectedAt: new Date().toISOString(),
    sampleSize,
    launchModeRequestPct: Math.round(launchModeRequestPct * 100) / 100,
    avgEmotionalConsistencyScore:
      Math.round(avgEmotionalConsistencyScore * 100) / 100,
    driftWarningRate: Math.round(driftWarningRate * 100) / 100,
    perceptionTestPassRate: cachedPerception?.passRate ?? 0,
    perceptionTestsPassed: cachedPerception?.passed ?? 0,
    perceptionTestsTotal: cachedPerception?.total ?? 0,
  };
}

export function resetLaunchHealthMetrics(): void {
  accumulator.totalRequests = 0;
  accumulator.launchModeRequests = 0;
  accumulator.consistencySum = 0;
  accumulator.consistencyCount = 0;
  accumulator.driftWarnings = 0;
  cachedPerception = null;
}
