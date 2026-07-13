import type { OpeningLock } from "../opening-lock";
import type { ThinLibraryPolicyResult } from "../thin-library-policy";

export const SCORING_OWNER = "v3_pipeline" as const;
export const DELIVERY_OWNER = "controller.delivery" as const;

export type PipelineCheckpoint =
  | "post_v3"
  | "post_recovery"
  | "post_evidence"
  | "post_refill"
  | "pre_response";

export const PIPELINE_CHECKPOINT_ORDER: readonly PipelineCheckpoint[] = [
  "post_v3",
  "post_recovery",
  "post_evidence",
  "post_refill",
  "pre_response",
] as const;

export type PipelineRuleId =
  | "artist_cap"
  | "duplicate_prevention"
  | "genre_evidence"
  | "era_validation"
  | "playlist_length"
  | "opening_lock"
  | "recovery"
  | "thin_library"
  | "partial_publish"
  | "activity_safety"
  | "editorial_sequencing"
  | "telemetry";

export type DeliveryTrack = {
  trackId: string;
  artistName?: string | null;
  trackName?: string | null;
  name?: string | null;
  artist?: string | null;
  scoreBreakdown?: unknown;
  scoreChannels?: unknown;
};

export type PipelineInvariantSeverity = "info" | "warn" | "error";

export type PipelineInvariantResult = {
  id: string;
  pass: boolean;
  severity: PipelineInvariantSeverity;
  expected: unknown;
  actual: unknown;
  violatedAt?: string;
};

export type PipelineValidationReport = {
  checkpoint: PipelineCheckpoint;
  pass: boolean;
  trackCount: number;
  invariants: PipelineInvariantResult[];
  violations: PipelineInvariantResult[];
  ownership: {
    scoringOwner: typeof SCORING_OWNER;
    deliveryOwner: typeof DELIVERY_OWNER;
    lastMutationStage: string | null;
  };
  executedAt: string;
};

export type PipelineMutationType =
  | "replace"
  | "append"
  | "filter"
  | "reorder"
  | "truncate"
  | "freeze";

export type PipelineMutationRecord = {
  order: number;
  stage: string;
  owner: string;
  reason: string;
  mutationType: PipelineMutationType;
  beforeCount: number;
  afterCount: number;
  tracksAdded: number;
  tracksRemoved: number;
  tracksReplaced: number;
  timestamp: string;
  checkpointAfter: PipelineCheckpoint | null;
};

export type PipelineRuleOwnership = {
  rule: PipelineRuleId;
  owner: string;
  allowedMutationStages: readonly string[];
  validationCheckpoint: PipelineCheckpoint;
};

export type PipelineSessionAuditInput = {
  mutations: readonly PipelineMutationRecord[];
  checkpoints: readonly PipelineValidationReport[];
  terminalFrozen: boolean;
  terminalFrozenAt: string | null;
};

export type PipelineValidationContext = {
  checkpoint: PipelineCheckpoint;
  tracks: DeliveryTrack[];
  vibe: string;
  requestedLength: number;
  maxPerArtist: number;
  promptCentralArtists?: ReadonlySet<string>;
  thinLibraryPolicy?: ThinLibraryPolicyResult;
  openingLock?: OpeningLock | null;
  confidence?: { percent: number } | null;
  recoveryPoolSize?: number;
  hasExplicitGenreIntent?: boolean;
  hasExplicitEraIntent?: boolean;
  genreHardCheck?: (track: DeliveryTrack) => boolean;
  eraHardCheck?: (track: DeliveryTrack) => boolean;
  genreEvidenceVerifiedCount?: number;
  genreEvidenceRequiredCount?: number;
  requireTelemetry?: boolean;
  lastMutationStage?: string | null;
  strictMode?: boolean;
  sessionAudit?: PipelineSessionAuditInput;
};

export type PipelineAuthorityValidationReport = {
  pass: boolean;
  validatedAt: string;
  terminalFrozen: boolean;
  checkpointProof: {
    pass: boolean;
    expected: readonly PipelineCheckpoint[];
    observed: PipelineCheckpoint[];
    missing: PipelineCheckpoint[];
    duplicates: PipelineCheckpoint[];
    outOfOrder: boolean;
  };
  invariants: PipelineInvariantResult[];
  violations: PipelineInvariantResult[];
};

export type PipelineAuthorityDiagnostics = {
  scoringOwner: typeof SCORING_OWNER;
  deliveryOwner: typeof DELIVERY_OWNER;
  mutations: PipelineMutationRecord[];
  checkpoints: PipelineValidationReport[];
  terminalFrozen: boolean;
  terminalFrozenAt: string | null;
  duplicateRuleOwners: string[];
  /** Post-freeze authority validation — authoritative for strict-rc authority gate */
  authorityValidation: PipelineAuthorityValidationReport | null;
};

export type PipelineDeploymentFingerprint = {
  commit: string;
  buildTimestamp: string | null;
  pipelineAuthorityEnabled: boolean;
  pipelineAuthorityVersion: number;
};
