import { PIPELINE_CHECKPOINT_ORDER } from "./types";
import type {
  PipelineAuthorityValidationReport,
  PipelineInvariantResult,
  PipelineSessionAuditInput,
} from "./types";

function invariant(
  id: string,
  pass: boolean,
  severity: "info" | "warn" | "error",
  expected: unknown,
  actual: unknown,
): PipelineInvariantResult {
  return { id, pass, severity, expected, actual };
}

/**
 * Authority-only validation — run after terminal freeze against final session audit.
 * Never includes playlist quality rules (genre, duplicates, length, etc.).
 */
export function validatePipelineAuthority(
  audit: PipelineSessionAuditInput,
): PipelineAuthorityValidationReport {
  const invariants: PipelineInvariantResult[] = [];
  const contentMutations = audit.mutations.filter((m) => m.mutationType !== "freeze");
  const checkpointIds = audit.checkpoints.map((c) => c.checkpoint);
  const expectedCheckpoints = [...PIPELINE_CHECKPOINT_ORDER];

  invariants.push(
    invariant(
      "terminal_frozen",
      audit.terminalFrozen,
      "error",
      true,
      audit.terminalFrozen,
    ),
  );

  const freezeRecorded = audit.mutations.some((m) => m.mutationType === "freeze");
  invariants.push(
    invariant(
      "freeze_recorded",
      freezeRecorded,
      "error",
      true,
      freezeRecorded,
    ),
  );

  invariants.push(
    invariant(
      "checkpoint_order",
      expectedCheckpoints.every((cp) => checkpointIds.includes(cp)),
      "error",
      expectedCheckpoints,
      checkpointIds,
    ),
  );

  invariants.push(
    invariant(
      "no_duplicate_checkpoint",
      checkpointIds.length === new Set(checkpointIds).size,
      "error",
      "unique checkpoints",
      checkpointIds,
    ),
  );

  const skipped = expectedCheckpoints.filter((cp) => !checkpointIds.includes(cp));
  invariants.push(
    invariant(
      "no_checkpoint_skipped",
      skipped.length === 0,
      "error",
      expectedCheckpoints,
      skipped,
    ),
  );

  let outOfOrder = false;
  let lastIndex = -1;
  for (const cp of checkpointIds) {
    const idx = PIPELINE_CHECKPOINT_ORDER.indexOf(cp);
    if (idx <= lastIndex) outOfOrder = true;
    lastIndex = Math.max(lastIndex, idx);
  }
  invariants.push(
    invariant(
      "checkpoint_sequence",
      !outOfOrder && checkpointIds.length === expectedCheckpoints.length,
      "error",
      expectedCheckpoints,
      checkpointIds,
    ),
  );

  const freezeIndex = audit.mutations.findIndex((m) => m.mutationType === "freeze");
  const postFreezeContent =
    freezeIndex >= 0
      ? audit.mutations.slice(freezeIndex + 1).filter((m) => m.mutationType !== "freeze")
      : [];
  invariants.push(
    invariant(
      "no_mutation_after_freeze",
      postFreezeContent.length === 0,
      "error",
      0,
      postFreezeContent.map((m) => m.stage),
    ),
  );

  const mutationOrders = contentMutations.map((m) => m.order);
  invariants.push(
    invariant(
      "mutation_order_monotonic",
      mutationOrders.every((order, index) => index === 0 || order > mutationOrders[index - 1]!),
      "error",
      "strictly increasing order",
      mutationOrders,
    ),
  );

  invariants.push(
    invariant(
      "mutation_registry_nonempty",
      contentMutations.length >= 1,
      "error",
      ">= 1 content mutation",
      contentMutations.length,
    ),
  );

  for (const mutation of contentMutations) {
    if (!mutation.stage) {
      invariants.push(
        invariant("mutation_missing_stage", false, "error", "non-empty stage", mutation.stage),
      );
    }
    if (!mutation.owner) {
      invariants.push(
        invariant("mutation_missing_owner", false, "error", "non-empty owner", mutation.owner),
      );
    }
    if (mutation.beforeCount < 0 || mutation.afterCount < 0) {
      invariants.push(
        invariant("mutation_invalid_counts", false, "error", ">= 0 counts", {
          before: mutation.beforeCount,
          after: mutation.afterCount,
        }),
      );
    }
  }

  const artistCapMutations = contentMutations.filter(
    (m) =>
      m.stage === "post_recovery" ||
      m.stage === "post_refill" ||
      m.stage === "terminal_delivery",
  );
  invariants.push(
    invariant(
      "artist_cap_execution_count",
      artistCapMutations.length >= 1,
      "warn",
      ">= 1",
      artistCapMutations.length,
    ),
  );

  const violations = invariants.filter((entry) => !entry.pass);
  const errors = violations.filter((entry) => entry.severity === "error");

  return {
    pass: errors.length === 0,
    validatedAt: new Date().toISOString(),
    terminalFrozen: audit.terminalFrozen,
    checkpointProof: {
      pass:
        skipped.length === 0 &&
        !outOfOrder &&
        checkpointIds.length === expectedCheckpoints.length &&
        checkpointIds.length === new Set(checkpointIds).size,
      expected: expectedCheckpoints,
      observed: checkpointIds,
      missing: skipped,
      duplicates: checkpointIds.filter((cp, i) => checkpointIds.indexOf(cp) !== i),
      outOfOrder,
    },
    invariants,
    violations,
  };
}
