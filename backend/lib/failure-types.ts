export type FailureType =
  | "SYSTEM_FAILURE"
  | "DB_FAILURE"
  | "RETRIEVAL_FAILURE"
  | "SCORING_FAILURE"
  | "CLUSTERING_FAILURE"
  | "TIMEOUT_FAILURE"
  | "OVERLOAD_FAILURE"
  | "PARTIAL_DEGRADATION";

export type FailureContext = {
  stage: string;
  error: Error;
  type: FailureType;
  requestId: string;
  recoverable: boolean;
};

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function classifyFailure(stage: string, err: unknown): FailureType {
  const error = toError(err);
  const code = (error as Error & { code?: string }).code ?? "";
  const message = error.message.toLowerCase();
  const normalizedStage = stage.toLowerCase();

  if (code === "QUEUE_FULL" || code === "DB_CIRCUIT_OPEN" || normalizedStage.includes("overload")) return "OVERLOAD_FAILURE";
  if (code.startsWith("08") || code === "ECONNRESET" || code === "ETIMEDOUT" || message.includes("database")) return "DB_FAILURE";
  if (message.includes("timeout") || normalizedStage.includes("timeout")) return "TIMEOUT_FAILURE";
  if (normalizedStage.includes("retrieval")) return "RETRIEVAL_FAILURE";
  if (normalizedStage.includes("scoring") || normalizedStage.includes("score")) return "SCORING_FAILURE";
  if (normalizedStage.includes("cluster")) return "CLUSTERING_FAILURE";
  if (normalizedStage.includes("fallback") || normalizedStage.includes("degrad")) return "PARTIAL_DEGRADATION";
  return "SYSTEM_FAILURE";
}

export function createFailureContext(opts: {
  stage: string;
  error: unknown;
  requestId?: string;
  recoverable?: boolean;
}): FailureContext {
  const error = toError(opts.error);
  return {
    stage: opts.stage,
    error,
    type: classifyFailure(opts.stage, error),
    requestId: opts.requestId ?? "unknown",
    recoverable: opts.recoverable ?? true,
  };
}
