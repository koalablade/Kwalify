import { PIPELINE_CHECKPOINT_ORDER } from "./types";
import type {
  DeliveryTrack,
  PipelineAuthorityDiagnostics,
  PipelineCheckpoint,
  PipelineMutationRecord,
  PipelineMutationType,
  PipelineValidationReport,
} from "./types";
import { diffTrackMutation } from "./track-identity";
import { detectDuplicateRuleOwners } from "./ownership";
import { DELIVERY_OWNER, SCORING_OWNER } from "./types";
import { validatePlaylistQuality } from "./pipeline-quality-validator";
import { validatePipelineAuthority } from "./pipeline-authority-validator";
import type { PipelineAuthorityValidationReport } from "./types";
import type { PipelineValidationContext } from "./types";
import {
  PipelineAuthorityViolationError,
  PipelineAuthorityFrozenError,
} from "./errors";

export type PipelineAuthoritySessionOptions = {
  strictMode?: boolean;
  enforceCheckpointOrder?: boolean;
  enforceTerminalImmutability?: boolean;
};

export type RecordMutationInput<T extends DeliveryTrack> = {
  stage: string;
  reason: string;
  owner: string;
  mutationType: PipelineMutationType;
  before: readonly T[];
  after: readonly T[];
};

export class PipelineAuthoritySession {
  private mutations: PipelineMutationRecord[] = [];
  private checkpoints: PipelineValidationReport[] = [];
  private authorityValidation: PipelineAuthorityValidationReport | null = null;
  private lastMutationStage: string | null = null;
  private terminalFrozen = false;
  private terminalFrozenAt: string | null = null;
  private lastCheckpointIndex = -1;
  private mutationOrder = 0;
  private readonly strictMode: boolean;
  private readonly enforceCheckpointOrder: boolean;
  private readonly enforceTerminalImmutability: boolean;

  constructor(opts: PipelineAuthoritySessionOptions = {}) {
    this.strictMode = opts.strictMode ?? false;
    this.enforceCheckpointOrder = opts.enforceCheckpointOrder ?? true;
    this.enforceTerminalImmutability = opts.enforceTerminalImmutability ?? true;
  }

  recordMutation<T extends DeliveryTrack>(input: RecordMutationInput<T>): void {
    if (this.enforceTerminalImmutability && this.terminalFrozen) {
      throw new PipelineAuthorityFrozenError(input.stage, input.reason);
    }
    const diff = diffTrackMutation(input.before, input.after);
    this.mutationOrder += 1;
    const record: PipelineMutationRecord = {
      order: this.mutationOrder,
      stage: input.stage,
      owner: input.owner,
      reason: input.reason,
      mutationType: input.mutationType,
      beforeCount: input.before.length,
      afterCount: input.after.length,
      tracksAdded: diff.added,
      tracksRemoved: diff.removed,
      tracksReplaced: diff.replaced,
      timestamp: new Date().toISOString(),
      checkpointAfter: null,
    };
    this.mutations.push(record);
    this.lastMutationStage = input.stage;
  }

  /** @deprecated Use PipelineDeliveryBuffer + recordMutation */
  mutate<T extends DeliveryTrack>(
    stage: string,
    reason: string,
    before: ReadonlyArray<T>,
    after: ReadonlyArray<T>,
  ): ReadonlyArray<T> {
    this.recordMutation({
      stage,
      reason,
      owner: DELIVERY_OWNER,
      mutationType: "replace",
      before,
      after,
    });
    return after;
  }

  runCheckpoint(context: PipelineValidationContext): PipelineValidationReport {
    const checkpointIndex = PIPELINE_CHECKPOINT_ORDER.indexOf(context.checkpoint);
    if (checkpointIndex < 0) {
      throw new Error(`Unknown checkpoint: ${context.checkpoint}`);
    }
    if (this.enforceCheckpointOrder && checkpointIndex <= this.lastCheckpointIndex) {
      const message = `Checkpoint ${context.checkpoint} executed out of order (last: ${PIPELINE_CHECKPOINT_ORDER[this.lastCheckpointIndex]})`;
      if (this.strictMode) {
        throw new PipelineAuthorityViolationError(message, context.checkpoint);
      }
    } else if (checkpointIndex > this.lastCheckpointIndex) {
      this.lastCheckpointIndex = checkpointIndex;
    }

    const lastMutation = this.mutations[this.mutations.length - 1];
    if (lastMutation && lastMutation.mutationType !== "freeze") {
      lastMutation.checkpointAfter = context.checkpoint;
    }

    const report = validatePlaylistQuality({
      ...context,
      lastMutationStage: this.lastMutationStage,
      strictMode: this.strictMode,
      sessionAudit: {
        mutations: this.mutations,
        checkpoints: this.checkpoints,
        terminalFrozen: this.terminalFrozen,
        terminalFrozenAt: this.terminalFrozenAt,
      },
    });
    this.checkpoints.push(report);

    if (this.strictMode && !report.pass) {
      const failed = report.violations.filter((v) => v.severity === "error");
      if (failed.length > 0) {
        throw new PipelineAuthorityViolationError(
          `Checkpoint ${context.checkpoint} failed: ${failed.map((v) => v.id).join(", ")}`,
          context.checkpoint,
          report,
        );
      }
    }
    return report;
  }

  freezeTerminal(stage: string): void {
    if (this.terminalFrozen) return;
    this.terminalFrozen = true;
    this.terminalFrozenAt = new Date().toISOString();
    this.mutationOrder += 1;
    this.mutations.push({
      order: this.mutationOrder,
      stage,
      owner: DELIVERY_OWNER,
      reason: "terminal_delivery_frozen",
      mutationType: "freeze",
      beforeCount: 0,
      afterCount: 0,
      tracksAdded: 0,
      tracksRemoved: 0,
      tracksReplaced: 0,
      timestamp: this.terminalFrozenAt,
      checkpointAfter: "pre_response",
    });
  }

  /**
   * Run authority validation against post-freeze session state.
   * Must be called after freezeTerminal().
   */
  runTerminalAuthorityValidation(): PipelineAuthorityValidationReport {
    if (!this.terminalFrozen) {
      const message = "Terminal authority validation requires terminal freeze";
      if (this.strictMode) {
        throw new PipelineAuthorityViolationError(message, "pre_response");
      }
    }
    const report = validatePipelineAuthority({
      mutations: this.mutations,
      checkpoints: this.checkpoints,
      terminalFrozen: this.terminalFrozen,
      terminalFrozenAt: this.terminalFrozenAt,
    });
    this.authorityValidation = report;
    if (this.strictMode && !report.pass) {
      const failed = report.violations.filter((v) => v.severity === "error");
      if (failed.length > 0) {
        throw new PipelineAuthorityViolationError(
          `Terminal authority validation failed: ${failed.map((v) => v.id).join(", ")}`,
          "pre_response",
        );
      }
    }
    return report;
  }

  getAuthorityValidation(): PipelineAuthorityValidationReport | null {
    return this.authorityValidation;
  }

  assertValidatorExecuted(checkpoint: PipelineCheckpoint): void {
    const executed = this.checkpoints.some((entry) => entry.checkpoint === checkpoint);
    if (!executed) {
      const message = `Required checkpoint not executed: ${checkpoint}`;
      if (this.strictMode) {
        throw new PipelineAuthorityViolationError(message, checkpoint);
      }
    }
  }

  getDiagnostics(): PipelineAuthorityDiagnostics {
    return {
      scoringOwner: SCORING_OWNER,
      deliveryOwner: DELIVERY_OWNER,
      mutations: [...this.mutations],
      checkpoints: [...this.checkpoints],
      terminalFrozen: this.terminalFrozen,
      terminalFrozenAt: this.terminalFrozenAt,
      duplicateRuleOwners: detectDuplicateRuleOwners(),
      authorityValidation: this.authorityValidation,
    };
  }

  get lastStage(): string | null {
    return this.lastMutationStage;
  }

  isTerminalFrozen(): boolean {
    return this.terminalFrozen;
  }

  getMutationCount(): number {
    return this.mutations.filter((m) => m.mutationType !== "freeze").length;
  }
}

export function createPipelineAuthoritySession(
  opts?: PipelineAuthoritySessionOptions,
): PipelineAuthoritySession {
  return new PipelineAuthoritySession(opts);
}
