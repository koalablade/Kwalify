import type { PipelineCheckpoint, PipelineValidationReport } from "./types";

export class PipelineAuthorityViolationError extends Error {
  readonly checkpoint: PipelineCheckpoint;
  readonly report?: PipelineValidationReport;

  constructor(message: string, checkpoint: PipelineCheckpoint, report?: PipelineValidationReport) {
    super(message);
    this.name = "PipelineAuthorityViolationError";
    this.checkpoint = checkpoint;
    this.report = report;
  }
}

/** Thrown on any mutation attempt after terminal freeze. Never swallowed. */
export class PipelineAuthorityFrozenError extends Error {
  readonly stage: string;
  readonly reason: string;

  constructor(stage: string, reason: string) {
    super(`Pipeline authority frozen — mutation forbidden: ${stage} (${reason})`);
    this.name = "PipelineAuthorityFrozenError";
    this.stage = stage;
    this.reason = reason;
  }
}

/** @deprecated Use PipelineAuthorityFrozenError */
export class TerminalDeliveryViolationError extends PipelineAuthorityFrozenError {
  constructor(stage: string, reason: string) {
    super(stage, reason);
    this.name = "TerminalDeliveryViolationError";
  }
}

export function isStrictRcModeEnabled(): boolean {
  const raw = process.env["PLAYLIST_STRICT_RC"] ?? process.env["PIPELINE_STRICT_RC"];
  return raw === "1" || raw === "true";
}
