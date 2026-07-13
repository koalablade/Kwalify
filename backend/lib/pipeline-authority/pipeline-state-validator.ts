import type { PipelineValidationContext, PipelineValidationReport } from "./types";
import { validatePlaylistQuality } from "./pipeline-quality-validator";

/**
 * @deprecated Prefer validatePlaylistQuality for quality gates and validatePipelineAuthority for authority gates.
 * Retained for backward compatibility — runs playlist quality validation only.
 */
export function validatePipelineState(ctx: PipelineValidationContext): PipelineValidationReport {
  return validatePlaylistQuality(ctx);
}

export { validatePlaylistQuality } from "./pipeline-quality-validator";
export { validatePipelineAuthority } from "./pipeline-authority-validator";
