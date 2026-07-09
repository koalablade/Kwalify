/**
 * Recovery tiering diagnostics — classify when recovery materially changed the playlist
 * vs. informational pipeline annotations (arc ordering, segment planning).
 */

export type RecoveryTier = "none" | "soft" | "constrained" | "degraded" | "fallback";

export type RecoveryRelaxationClass = "material" | "informational" | "pipeline_annotation";

export type RecoveryTriggerReason =
  | "none"
  | "underfill_recovery"
  | "evidence_guard_relaxation"
  | "intent_pool_recovery"
  | "coherence_degraded_publish"
  | "artist_album_limit_relaxed"
  | "timeout_or_fallback"
  | "pipeline_annotation_only";

export type RecoveryStageLoss = {
  stage: string;
  before: number;
  after: number;
  removed: number;
};

export type RecoveryDiagnostics = {
  tier: RecoveryTier;
  materialRecovery: boolean;
  triggerReason: RecoveryTriggerReason;
  triggerDetail: string | null;
  candidateCountBeforeRecovery: number | null;
  candidateCountAfterRecovery: number | null;
  stageLosses: RecoveryStageLoss[];
  relaxations: {
    all: string[];
    material: string[];
    informational: string[];
    pipelineAnnotations: string[];
  };
  qualityImpact: {
    estimatedHarm: boolean;
    harmSignals: string[];
    fallbackLevel: string;
    finalTrackCount: number;
    requestedLength: number;
  };
};

/** Ordering / arc / segment steps — not material recovery. */
const PIPELINE_ANNOTATION_RELAXATIONS = new Set([
  "segment_playlist_planning",
  "emotional_arc_ordering",
  "opening_window_locked_through_arc",
]);

const MATERIAL_RECOVERY_PREFIXES = [
  "genre_evidence_",
  "era_evidence_",
  "genre_leak_",
  "locked_intent_",
  "intent_pool_",
  "empty_finalization_",
  "controlled_recovery_",
  "strict_coherence_gate_",
  "human_coherence_",
  "playlist_coherence_",
  "world_constraint_",
  "scene_lock_",
  "balanced_coherence_",
  "human_taste_validator_",
  "artist_limit_relaxed",
  "album_limit_relaxed",
];

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function classifyRecoveryRelaxation(code: string): RecoveryRelaxationClass {
  if (PIPELINE_ANNOTATION_RELAXATIONS.has(code)) return "pipeline_annotation";
  if (startsWithAny(code, MATERIAL_RECOVERY_PREFIXES)) return "material";
  if (
    code === "soft" ||
    code === "relaxed_scene" ||
    code === "deterministic" ||
    code === "global" ||
    code === "hardSafe"
  ) {
    return "material";
  }
  return "informational";
}

export function partitionRecoveryRelaxations(relaxations: string[]): {
  material: string[];
  informational: string[];
  pipelineAnnotations: string[];
} {
  const material: string[] = [];
  const informational: string[] = [];
  const pipelineAnnotations: string[] = [];
  for (const code of relaxations) {
    const kind = classifyRecoveryRelaxation(code);
    if (kind === "material") material.push(code);
    else if (kind === "pipeline_annotation") pipelineAnnotations.push(code);
    else informational.push(code);
  }
  return { material, informational, pipelineAnnotations };
}

export function inferRecoveryTier(opts: {
  fallbackLevel: string;
  materialRelaxations: string[];
  underfillRecovery: boolean;
}): RecoveryTier {
  if (opts.fallbackLevel === "hardSafe") return "fallback";
  if (opts.materialRelaxations.some((r) => r.includes("degraded") || r.includes("best_available"))) {
    return "degraded";
  }
  if (opts.materialRelaxations.length > 0 || opts.underfillRecovery) return "constrained";
  return "none";
}

export function inferRecoveryTriggerReason(opts: {
  fallbackLevel: string;
  materialRelaxations: string[];
  underfillRecovery: boolean;
}): RecoveryTriggerReason {
  if (opts.fallbackLevel === "hardSafe") return "timeout_or_fallback";
  if (opts.materialRelaxations.some((r) => r.startsWith("intent_pool_"))) return "intent_pool_recovery";
  if (
    opts.materialRelaxations.some((r) =>
      r.startsWith("genre_evidence_") || r.startsWith("era_evidence_") || r.startsWith("genre_leak_")
    )
  ) {
    return "evidence_guard_relaxation";
  }
  if (
    opts.materialRelaxations.some((r) =>
      r.includes("coherence") || r.includes("degraded_publish")
    )
  ) {
    return "coherence_degraded_publish";
  }
  if (
    opts.materialRelaxations.some((r) =>
      r === "artist_limit_relaxed" || r === "album_limit_relaxed"
    )
  ) {
    return "artist_album_limit_relaxed";
  }
  if (opts.underfillRecovery || opts.materialRelaxations.length > 0) return "underfill_recovery";
  return "pipeline_annotation_only";
}

export function buildRecoveryDiagnostics(opts: {
  recoveryRelaxations: string[];
  fallbackLevel: string;
  finalTrackCount: number;
  requestedLength: number;
  candidatesBeforeRecovery?: number | null;
  candidatesAfterRecovery?: number | null;
  stageWaterfall?: Array<{ stage: string; before: number; after?: number; count: number; removed: number }>;
  humanCoherenceScore?: number | null;
  preRecoveryCoherence?: number | null;
}): RecoveryDiagnostics {
  const partitioned = partitionRecoveryRelaxations(opts.recoveryRelaxations);
  const underfillRecovery = opts.finalTrackCount < Math.ceil(opts.requestedLength * 0.7);
  const materialRecovery =
    opts.fallbackLevel === "hardSafe" ||
    partitioned.material.length > 0;

  const tier = inferRecoveryTier({
    fallbackLevel: opts.fallbackLevel,
    materialRelaxations: partitioned.material,
    underfillRecovery,
  });

  const triggerReason = materialRecovery
    ? inferRecoveryTriggerReason({
        fallbackLevel: opts.fallbackLevel,
        materialRelaxations: partitioned.material,
        underfillRecovery,
      })
    : "none";

  const harmSignals: string[] = [];
  if (opts.fallbackLevel !== "none") harmSignals.push("fallback_path");
  if (partitioned.material.some((r) => r.includes("degraded") || r.includes("best_available"))) {
    harmSignals.push("degraded_evidence_publish");
  }
  if (underfillRecovery) harmSignals.push("underfilled_playlist");
  if (
    typeof opts.humanCoherenceScore === "number" &&
    typeof opts.preRecoveryCoherence === "number" &&
    opts.humanCoherenceScore < opts.preRecoveryCoherence - 0.08
  ) {
    harmSignals.push("coherence_drop_after_recovery");
  }

  const stageLosses: RecoveryStageLoss[] = (opts.stageWaterfall ?? [])
    .filter((s) => s.removed > 0)
    .map((s) => ({
      stage: s.stage,
      before: s.before ?? s.count + s.removed,
      after: s.count,
      removed: s.removed,
    }));

  return {
    tier,
    materialRecovery,
    triggerReason,
    triggerDetail: partitioned.material[0] ?? partitioned.informational[0] ?? null,
    candidateCountBeforeRecovery: opts.candidatesBeforeRecovery ?? null,
    candidateCountAfterRecovery: opts.candidatesAfterRecovery ?? null,
    stageLosses,
    relaxations: {
      all: opts.recoveryRelaxations,
      ...partitioned,
    },
    qualityImpact: {
      estimatedHarm: harmSignals.length > 0,
      harmSignals,
      fallbackLevel: opts.fallbackLevel,
      finalTrackCount: opts.finalTrackCount,
      requestedLength: opts.requestedLength,
    },
  };
}

export function shouldMarkRecoveryTriggered(diagnostics: RecoveryDiagnostics): boolean {
  return diagnostics.materialRecovery;
}
