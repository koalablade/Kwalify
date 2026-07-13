import type { GenerationEvaluationResult } from "../playlist-evaluation/metrics";
import { verifyPipelineAuthorityDiagnostics } from "./verification";
import type { PipelineAuthorityDiagnostics } from "./types";

export type PipelineValidationGateSummary = {
  pass: boolean;
  evaluated: number;
  failures: number;
  skipped: number;
  failurePromptIds: string[];
  violationIds: string[];
};

export type PipelineAuthorityGateSummary = PipelineValidationGateSummary;
export type PipelineQualityGateSummary = PipelineValidationGateSummary;

type PipelineValidationReport = {
  checkpoint: string;
  pass: boolean;
  violations: Array<{ id: string; severity: string }>;
};

const QUALITY_INVARIANT_IDS = new Set([
  "artist_cap",
  "duplicate_track_ids",
  "duplicate_song_identities",
  "playlist_length",
  "thin_library_cap",
  "opening_lock",
  "genre_hard_constraints",
  "era_hard_constraints",
  "genre_evidence_ratio",
  "recovery_floor_consistency",
  "telemetry_coverage",
  "confidence_bounds",
]);

const AUTHORITY_INVARIANT_IDS = new Set([
  "terminal_frozen",
  "freeze_recorded",
  "checkpoint_order",
  "no_duplicate_checkpoint",
  "no_checkpoint_skipped",
  "checkpoint_sequence",
  "no_mutation_after_freeze",
  "mutation_order_monotonic",
  "mutation_registry_nonempty",
  "mutation_missing_stage",
  "mutation_missing_owner",
  "mutation_invalid_counts",
]);

export function extractPipelineValidationFromResult(
  result: GenerationEvaluationResult,
): {
  postV3?: PipelineValidationReport;
  postRecovery?: PipelineValidationReport;
  postEvidence?: PipelineValidationReport;
  postRefill?: PipelineValidationReport;
  preResponse?: PipelineValidationReport;
} | null {
  const body = result.response;
  const finalization = body?.["finalization"] as Record<string, unknown> | undefined;
  const pipelineValidation = finalization?.["pipelineValidation"] as Record<string, PipelineValidationReport> | undefined;
  return pipelineValidation ?? null;
}

export function extractPipelineAuthorityFromResult(
  result: GenerationEvaluationResult,
): PipelineAuthorityDiagnostics | null {
  const body = result.response;
  const finalization = body?.["finalization"] as Record<string, unknown> | undefined;
  const diagnostics = finalization?.["pipelineAuthority"] as PipelineAuthorityDiagnostics | undefined;
  return diagnostics ?? null;
}

/** Strict-rc authority gate — playlist quality never affects this result. */
export function analyzePipelineAuthorityGate(
  results: GenerationEvaluationResult[],
): PipelineAuthorityGateSummary {
  const failurePromptIds: string[] = [];
  const violationIds = new Set<string>();
  let evaluated = 0;
  let failures = 0;
  let skipped = 0;

  for (const result of results) {
    if (!result.ok) {
      skipped += 1;
      continue;
    }
    const authority = extractPipelineAuthorityFromResult(result);
    if (!authority) {
      skipped += 1;
      violationIds.add("pipeline_authority_missing");
      failurePromptIds.push(result.benchmark.id);
      failures += 1;
      continue;
    }

    evaluated += 1;
    const terminalReport = authority.authorityValidation;
    const verification = verifyPipelineAuthorityDiagnostics(authority, {
      promptId: result.benchmark.id,
    });

    if (!terminalReport?.pass || !verification.pass) {
      failures += 1;
      failurePromptIds.push(result.benchmark.id);
      if (!terminalReport) violationIds.add("authority_validation_missing");
      for (const violation of terminalReport?.violations ?? []) {
        if (violation.severity === "error" && AUTHORITY_INVARIANT_IDS.has(violation.id)) {
          violationIds.add(violation.id);
        }
      }
      for (const v of verification.violations) {
        violationIds.add(v);
      }
    }
  }

  return {
    pass: failures === 0 && skipped === 0,
    evaluated,
    failures,
    skipped,
    failurePromptIds,
    violationIds: [...violationIds],
  };
}

/** Playlist quality gate — separate from authority. */
export function analyzePipelineQualityGate(
  results: GenerationEvaluationResult[],
): PipelineQualityGateSummary {
  const failurePromptIds: string[] = [];
  const violationIds = new Set<string>();
  let evaluated = 0;
  let failures = 0;
  let skipped = 0;

  for (const result of results) {
    if (!result.ok) {
      skipped += 1;
      continue;
    }
    const validation = extractPipelineValidationFromResult(result);
    if (!validation?.preResponse) {
      skipped += 1;
      violationIds.add("quality_checkpoint_skipped");
      failurePromptIds.push(result.benchmark.id);
      failures += 1;
      continue;
    }
    evaluated += 1;
    const failedCheckpoints = [
      validation.postV3,
      validation.postRecovery,
      validation.postEvidence,
      validation.postRefill,
      validation.preResponse,
    ].filter((entry): entry is PipelineValidationReport => !!entry && !entry.pass);
    if (failedCheckpoints.length > 0) {
      failures += 1;
      failurePromptIds.push(result.benchmark.id);
      for (const checkpoint of failedCheckpoints) {
        for (const violation of checkpoint.violations) {
          if (
            violation.severity === "error" &&
            (QUALITY_INVARIANT_IDS.has(violation.id) || !AUTHORITY_INVARIANT_IDS.has(violation.id))
          ) {
            violationIds.add(violation.id);
          }
        }
      }
    }
  }

  return {
    pass: failures === 0 && skipped === 0,
    evaluated,
    failures,
    skipped,
    failurePromptIds,
    violationIds: [...violationIds],
  };
}

/**
 * @deprecated Use analyzePipelineAuthorityGate for strict-rc.
 * Retained for backward compatibility — now delegates to authority gate only.
 */
export function analyzePipelineValidationGate(
  results: GenerationEvaluationResult[],
): PipelineValidationGateSummary {
  return analyzePipelineAuthorityGate(results);
}
