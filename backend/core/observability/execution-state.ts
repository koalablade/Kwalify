/**
 * Canonical execution path enum — single source of truth for pipeline exit classification.
 * Observability only; does not affect generation logic.
 */

export const EXECUTION_PATHS = [
  "full_pipeline",
  "fast_fallback",
  "timeout_fallback",
  "gate_failure",
  "partial_pipeline",
  "invalid_html_response",
  "unknown_exit",
] as const;

export type ExecutionPath = (typeof EXECUTION_PATHS)[number];

export function isExecutionPath(value: unknown): value is ExecutionPath {
  return typeof value === "string" && (EXECUTION_PATHS as readonly string[]).includes(value);
}

export function normalizeExecutionPath(value: unknown, fallback: ExecutionPath = "unknown_exit"): ExecutionPath {
  return isExecutionPath(value) ? value : fallback;
}

export function isHtmlResponseBody(rawText: string): boolean {
  const trimmed = rawText.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

export function isBypassExecutionPath(path: ExecutionPath): boolean {
  return path === "fast_fallback" || path === "timeout_fallback" || path === "unknown_exit";
}

export function isFailureExecutionPath(path: ExecutionPath, humanSaveable: boolean): boolean {
  if (humanSaveable) return false;
  return path !== "full_pipeline";
}
