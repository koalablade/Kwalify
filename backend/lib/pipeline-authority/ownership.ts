import type { PipelineCheckpoint, PipelineRuleId, PipelineRuleOwnership } from "./types";

export const PIPELINE_RULE_OWNERSHIP: readonly PipelineRuleOwnership[] = [
  {
    rule: "artist_cap",
    owner: "playlist-artist-cap.applyDeliveryPerPlaylistArtistCap",
    allowedMutationStages: ["post_recovery", "post_refill", "terminal_delivery"],
    validationCheckpoint: "pre_response",
  },
  {
    rule: "duplicate_prevention",
    owner: "finalizePlaylistTracks",
    allowedMutationStages: ["recovery_finalize", "tier3_fill", "api_refill", "anti_blandness_repair"],
    validationCheckpoint: "pre_response",
  },
  {
    rule: "genre_evidence",
    owner: "genre-evidence-guard.resolveGenreEvidencePublication",
    allowedMutationStages: ["genre_evidence_guard", "degraded_partial_publish"],
    validationCheckpoint: "post_evidence",
  },
  {
    rule: "era_validation",
    owner: "generation.controller.eraEvidenceGuard",
    allowedMutationStages: ["era_evidence_guard"],
    validationCheckpoint: "post_evidence",
  },
  {
    rule: "playlist_length",
    owner: "generation.controller.effectiveDeliveryLength",
    allowedMutationStages: ["recovery_finalize", "tier3_fill", "thin_library_cap", "api_refill"],
    validationCheckpoint: "pre_response",
  },
  {
    rule: "opening_lock",
    owner: "opening-lock.enforceOpeningLock",
    allowedMutationStages: ["opening_curator_v2", "opening_lock_enforce", "pre_terminal_opening_lock"],
    validationCheckpoint: "pre_response",
  },
  {
    rule: "recovery",
    owner: "generation.controller.finalizePlaylistTracks",
    allowedMutationStages: ["recovery_finalize", "tier3_fill", "empty_recovery_floor", "relaxed_recovery"],
    validationCheckpoint: "post_recovery",
  },
  {
    rule: "thin_library",
    owner: "thin-library-policy.evaluateThinLibraryPolicy",
    allowedMutationStages: ["early_thin_library_gate", "thin_library_delivery_cap"],
    validationCheckpoint: "pre_response",
  },
  {
    rule: "partial_publish",
    owner: "genre-evidence-guard.resolveGenreEvidencePublication",
    allowedMutationStages: ["genre_evidence_guard", "era_partial_publish", "empty_recovery_floor"],
    validationCheckpoint: "post_evidence",
  },
  {
    rule: "activity_safety",
    owner: "activity-profiles.applyActivityGuard",
    allowedMutationStages: ["activity_guard", "gym_safe_filter"],
    validationCheckpoint: "post_refill",
  },
  {
    rule: "editorial_sequencing",
    owner: "opening-curator-v2 + emotional-arc-planner",
    allowedMutationStages: [
      "coherence_rebuild",
      "opening_curator_v2",
      "emotional_arc",
      "human_taste_repair",
      "session_artist_gravity",
      "playlist_identity_distance",
      "opener_dedup",
    ],
    validationCheckpoint: "post_refill",
  },
  {
    rule: "telemetry",
    owner: "score-breakdown.attachScoreAttribution",
    allowedMutationStages: ["score_attribution"],
    validationCheckpoint: "pre_response",
  },
] as const;

export function getRuleOwnership(rule: PipelineRuleId): PipelineRuleOwnership {
  const found = PIPELINE_RULE_OWNERSHIP.find((entry) => entry.rule === rule);
  if (!found) throw new Error(`Unknown pipeline rule: ${rule}`);
  return found;
}

export function getCheckpointForRule(rule: PipelineRuleId): PipelineCheckpoint {
  return getRuleOwnership(rule).validationCheckpoint;
}

/** Known duplicate implementations — technical debt tracked for consolidation. */
export const KNOWN_DUPLICATE_RULE_IMPLEMENTATIONS: Readonly<Record<PipelineRuleId, readonly string[]>> = {
  artist_cap: [
    "playlist-pipeline V3 maxPerArtist",
    "enforcePerPlaylistArtistCap (early V3 handoff)",
    "applyFinalDeliveryArtistCap (post_recovery, post_refill, terminal)",
    "finalizePlaylistTracks artist limits",
    "api_refill push-time maxPerArtist",
  ],
  duplicate_prevention: [
    "finalizePlaylistTracks seen sets",
    "tier3_fill seen sets",
    "api_refill seen sets",
    "anti_blandness_repair",
  ],
  genre_evidence: [
    "genre-evidence-guard.resolveGenreEvidencePublication",
    "blind constrained prefix (controller)",
    "degraded verified partial (controller)",
  ],
  era_validation: ["era evidence guard", "finalizePlaylistTracks era filter"],
  playlist_length: [
    "effectiveDeliveryLength",
    "thin-library delivery cap",
    "tier3_fill push loop",
    "api_refill push loop",
  ],
  opening_lock: ["opening-lock.enforceOpeningLock (multiple call sites)", "opening-curator-v2"],
  recovery: [
    "playlist-pipeline post-V3 recovery",
    "finalizePlaylistTracks",
    "tier3_fill",
    "buildEmptyPlaylistRecoveryFloor",
  ],
  thin_library: ["early thin-library gate", "applyThinLibraryDeliveryCap", "compound bypass override"],
  partial_publish: ["genre evidence partial", "era partial", "empty recovery floor"],
  activity_safety: ["activity-profiles guard", "gym_safe_filter"],
  editorial_sequencing: [
    "coherence-gate",
    "opening-curator-v2",
    "emotional-arc-planner",
    "session-artist-gravity",
    "playlist-identity-distance",
    "opening-window-dedup",
  ],
  telemetry: ["attachScoreAttribution"],
};

export function detectDuplicateRuleOwners(): string[] {
  return Object.entries(KNOWN_DUPLICATE_RULE_IMPLEMENTATIONS)
    .filter(([, implementations]) => implementations.length > 1)
    .map(([rule, implementations]) => `${rule}: ${implementations.join(" | ")}`);
}

export function isStageAllowedForRule(rule: PipelineRuleId, stage: string): boolean {
  const ownership = getRuleOwnership(rule);
  return ownership.allowedMutationStages.includes(stage);
}
