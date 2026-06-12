export type RuntimeReadinessState = "starting" | "initializing" | "ready" | "failed";

type RuntimeReadiness = {
  state: RuntimeReadinessState;
  startedAt: number;
  readyAt: number | null;
  failedAt: number | null;
  error: string | null;
};

const readiness: RuntimeReadiness = {
  state: "starting",
  startedAt: Date.now(),
  readyAt: null,
  failedAt: null,
  error: null,
};

export function setRuntimeInitializing(): void {
  readiness.state = "initializing";
  readiness.error = null;
}

export function setRuntimeReady(): void {
  readiness.state = "ready";
  readiness.readyAt = Date.now();
  readiness.failedAt = null;
  readiness.error = null;
}

export function setRuntimeFailed(error: unknown): void {
  readiness.state = "failed";
  readiness.failedAt = Date.now();
  readiness.error = error instanceof Error ? error.message : String(error);
}

export function getRuntimeReadiness(): RuntimeReadiness & { uptimeMs: number } {
  return {
    ...readiness,
    uptimeMs: Date.now() - readiness.startedAt,
  };
}

export function isRuntimeReady(): boolean {
  return readiness.state === "ready";
}
