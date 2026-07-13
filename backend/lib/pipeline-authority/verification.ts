import { PIPELINE_CHECKPOINT_ORDER } from "./types";
import type {
  PipelineAuthorityDiagnostics,
  PipelineCheckpoint,
  PipelineMutationRecord,
  PipelineValidationReport,
} from "./types";

export type MutationTimelineEntry = {
  order: number;
  stage: string;
  owner: string;
  reason: string;
  mutationType: string;
  beforeCount: number;
  afterCount: number;
  tracksAdded: number;
  tracksRemoved: number;
  tracksReplaced: number;
  checkpointAfter: PipelineCheckpoint | null;
  frozen: boolean;
  timestamp: string;
};

export type CheckpointProof = {
  pass: boolean;
  expected: readonly PipelineCheckpoint[];
  observed: PipelineCheckpoint[];
  missing: PipelineCheckpoint[];
  duplicates: PipelineCheckpoint[];
  outOfOrder: boolean;
  details: string[];
};

export type PipelineAuthorityVerificationResult = {
  pass: boolean;
  promptId?: string;
  mutationCount: number;
  contentMutationCount: number;
  freezeRecorded: boolean;
  timeline: MutationTimelineEntry[];
  checkpointProof: CheckpointProof;
  violations: string[];
};

export function buildMutationTimeline(
  diagnostics: PipelineAuthorityDiagnostics,
): MutationTimelineEntry[] {
  const freezeIndex = diagnostics.mutations.findIndex((m) => m.mutationType === "freeze");
  return diagnostics.mutations.map((mutation, index) => ({
    order: mutation.order,
    stage: mutation.stage,
    owner: mutation.owner,
    reason: mutation.reason,
    mutationType: mutation.mutationType,
    beforeCount: mutation.beforeCount,
    afterCount: mutation.afterCount,
    tracksAdded: mutation.tracksAdded,
    tracksRemoved: mutation.tracksRemoved,
    tracksReplaced: mutation.tracksReplaced,
    checkpointAfter: mutation.checkpointAfter,
    frozen: freezeIndex >= 0 && index > freezeIndex,
    timestamp: mutation.timestamp,
  }));
}

export function proveCheckpointOrder(
  checkpoints: readonly PipelineValidationReport[],
): CheckpointProof {
  const observed = checkpoints.map((c) => c.checkpoint);
  const missing = PIPELINE_CHECKPOINT_ORDER.filter((cp) => !observed.includes(cp));
  const seen = new Set<PipelineCheckpoint>();
  const duplicates: PipelineCheckpoint[] = [];
  for (const cp of observed) {
    if (seen.has(cp)) duplicates.push(cp);
    seen.add(cp);
  }
  let outOfOrder = false;
  let lastIndex = -1;
  for (const cp of observed) {
    const idx = PIPELINE_CHECKPOINT_ORDER.indexOf(cp);
    if (idx <= lastIndex) outOfOrder = true;
    lastIndex = Math.max(lastIndex, idx);
  }
  const details: string[] = [];
  if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
  if (duplicates.length > 0) details.push(`duplicates: ${duplicates.join(", ")}`);
  if (outOfOrder) details.push("checkpoints executed out of order");
  const pass = missing.length === 0 && duplicates.length === 0 && !outOfOrder
    && observed.length === PIPELINE_CHECKPOINT_ORDER.length;
  return {
    pass,
    expected: PIPELINE_CHECKPOINT_ORDER,
    observed,
    missing,
    duplicates,
    outOfOrder,
    details,
  };
}

export function verifyPipelineAuthorityDiagnostics(
  diagnostics: PipelineAuthorityDiagnostics,
  opts?: { promptId?: string },
): PipelineAuthorityVerificationResult {
  const violations: string[] = [];
  const timeline = buildMutationTimeline(diagnostics);
  const contentMutations = diagnostics.mutations.filter((m) => m.mutationType !== "freeze");
  const freezeRecorded = diagnostics.mutations.some((m) => m.mutationType === "freeze");

  if (diagnostics.authorityValidation?.pass === true) {
    const checkpointProof = proveCheckpointOrder(diagnostics.checkpoints);
    return {
      pass: true,
      promptId: opts?.promptId,
      mutationCount: diagnostics.mutations.length,
      contentMutationCount: contentMutations.length,
      freezeRecorded,
      timeline,
      checkpointProof: diagnostics.authorityValidation.checkpointProof.pass
        ? {
            pass: true,
            expected: PIPELINE_CHECKPOINT_ORDER,
            observed: diagnostics.authorityValidation.checkpointProof.observed,
            missing: diagnostics.authorityValidation.checkpointProof.missing,
            duplicates: diagnostics.authorityValidation.checkpointProof.duplicates,
            outOfOrder: diagnostics.authorityValidation.checkpointProof.outOfOrder,
            details: [],
          }
        : proveCheckpointOrder(diagnostics.checkpoints),
      violations: [],
    };
  }

  if (!freezeRecorded) violations.push("freeze_not_recorded");
  if (!diagnostics.terminalFrozen) violations.push("terminal_not_frozen");

  const postFreezeContent = (() => {
    const freezeIdx = diagnostics.mutations.findIndex((m) => m.mutationType === "freeze");
    if (freezeIdx < 0) return [];
    return diagnostics.mutations.slice(freezeIdx + 1).filter((m) => m.mutationType !== "freeze");
  })();
  if (postFreezeContent.length > 0) {
    violations.push(`mutations_after_freeze: ${postFreezeContent.map((m) => m.stage).join(", ")}`);
  }

  for (let i = 1; i < contentMutations.length; i += 1) {
    if (contentMutations[i]!.order <= contentMutations[i - 1]!.order) {
      violations.push("mutation_order_not_monotonic");
      break;
    }
  }

  for (const mutation of contentMutations) {
    if (!mutation.stage) violations.push("mutation_missing_stage");
    if (!mutation.owner) violations.push("mutation_missing_owner");
    if (mutation.beforeCount < 0 || mutation.afterCount < 0) violations.push("mutation_invalid_counts");
  }

  const checkpointProof = proveCheckpointOrder(diagnostics.checkpoints);
  if (!checkpointProof.pass) {
    violations.push(...checkpointProof.details);
  }

  if (!diagnostics.authorityValidation) {
    violations.push("authority_validation_missing");
  } else if (!diagnostics.authorityValidation.pass) {
    const authorityErrors = diagnostics.authorityValidation.violations.filter((v) => v.severity === "error");
    if (authorityErrors.length > 0) {
      violations.push(`authority_failed: ${authorityErrors.map((v) => v.id).join(", ")}`);
    }
  }

  return {
    pass: violations.length === 0,
    promptId: opts?.promptId,
    mutationCount: diagnostics.mutations.length,
    contentMutationCount: contentMutations.length,
    freezeRecorded,
    timeline,
    checkpointProof,
    violations,
  };
}

export type StaticMutationSite = {
  line: number;
  kind: "init" | "replace" | "append" | "truncate" | "filter" | "reorder" | "artist_cap" | "assignFT";
  stage: string;
  conditional: boolean;
};

export function analyzeStaticMutationSites(source: string): StaticMutationSite[] {
  const sites: StaticMutationSite[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNum = i + 1;
    if (line.includes("delivery.init(")) {
      sites.push({ line: lineNum, kind: "init", stage: "v3_handoff", conditional: false });
    }
    if (line.includes("delivery.replaceTracks(")) {
      const stageMatch = line.match(/replaceTracks\(\s*["']([^"']+)["']/);
      sites.push({
        line: lineNum,
        kind: "replace",
        stage: stageMatch?.[1] ?? "unknown",
        conditional: !line.includes("delivery.init"),
      });
    }
    if (line.includes("delivery.appendTracks(")) {
      const stageMatch = line.match(/appendTracks\(\s*["']([^"']+)["']/);
      sites.push({ line: lineNum, kind: "append", stage: stageMatch?.[1] ?? "unknown", conditional: true });
    }
    if (line.includes("delivery.truncateTracks(")) {
      sites.push({ line: lineNum, kind: "truncate", stage: "playlist_length", conditional: true });
    }
    if (line.includes("applyArtistCapAtCheckpoint(")) {
      sites.push({ line: lineNum, kind: "artist_cap", stage: "artist_cap", conditional: true });
    }
    if (line.includes('assignFT(')) {
      const stageMatch = line.match(/assignFT\(\s*["']([^"']+)["']/);
      sites.push({
        line: lineNum,
        kind: "assignFT",
        stage: stageMatch?.[1] ?? "unknown",
        conditional: true,
      });
    }
  }
  return sites;
}

export function summarizeVerificationBatch(
  results: PipelineAuthorityVerificationResult[],
): {
  total: number;
  passed: number;
  failed: number;
  failurePromptIds: string[];
  violationCounts: Record<string, number>;
  mutationCountMin: number;
  mutationCountMax: number;
  mutationCountAvg: number;
} {
  const violationCounts: Record<string, number> = {};
  const failurePromptIds: string[] = [];
  let mutationSum = 0;
  let mutationMin = Number.POSITIVE_INFINITY;
  let mutationMax = 0;
  for (const result of results) {
    mutationSum += result.contentMutationCount;
    mutationMin = Math.min(mutationMin, result.contentMutationCount);
    mutationMax = Math.max(mutationMax, result.contentMutationCount);
    if (!result.pass) {
      failurePromptIds.push(result.promptId ?? "unknown");
      for (const v of result.violations) {
        violationCounts[v] = (violationCounts[v] ?? 0) + 1;
      }
    }
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    failurePromptIds,
    violationCounts,
    mutationCountMin: results.length ? mutationMin : 0,
    mutationCountMax: results.length ? mutationMax : 0,
    mutationCountAvg: results.length ? Math.round((mutationSum / results.length) * 10) / 10 : 0,
  };
}
