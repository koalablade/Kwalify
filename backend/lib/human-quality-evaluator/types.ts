/**
 * Human-centric playlist quality evaluation — types and rubric.
 * Automated scores are HYPOTHESES until validated against human review or beta evidence.
 * Does NOT affect playlist generation.
 */

export const EVALUATOR_VERSION = "human-quality-evaluator-v1";

export type QualitativeBand = "strong" | "mixed" | "weak" | "unknown";

export type PromptDifficulty =
  | "easy"
  | "normal"
  | "hard"
  | "compound"
  | "ambiguous"
  | "adversarial";

export type PromptCategory =
  | "genre"
  | "mood"
  | "activity"
  | "atmosphere"
  | "era"
  | "compound"
  | "negative_constraint"
  | "vague"
  | "edge_case"
  | "natural";

export type FailureClass =
  | "prompt_understanding"
  | "compound_intent"
  | "world_atmosphere"
  | "genre"
  | "mood"
  | "taste"
  | "retrieval"
  | "candidate_admission"
  | "scoring"
  | "diversity"
  | "artist_repetition"
  | "sequencing"
  | "tail"
  | "underfill"
  | "spotify"
  | "ux"
  | "reliability"
  | "trust"
  | "other";

export type RootCauseConfidence = "confirmed" | "probable" | "possible" | "unknown";

export type EvidenceStrength =
  | "single_observation"
  | "pattern"
  | "repeated_failure_class"
  | "systemic";

/** 0–5 human rubric dimensions (human review is authoritative when present). */
export type HumanReviewRubric = {
  humanSaveability: number;
  momentFidelity: number;
  musicalCoherence: number;
  tasteFit: number;
  openingQuality: number;
  tailQuality: number;
  discoveryQuality: number;
  replayability: number;
  overallHumanQuality: number;
  /** Free-text — most valuable signal. */
  opinion?: string | null;
  /** Would press play / keep listening / save — quick binary checks. */
  wouldPressPlay?: boolean | null;
  wouldKeepListening?: boolean | null;
  wouldSave?: boolean | null;
  obviousBadTracks?: string | null;
  reviewerId?: string | null;
  reviewedAt?: string;
};

export type ConstraintStatus = "satisfied" | "partial" | "violated" | "not_measurable";

export type PromptConstraint = {
  label: string;
  kind: "genre" | "mood" | "activity" | "atmosphere" | "era" | "energy" | "negation" | "compound" | "other";
  status: ConstraintStatus;
  confidence: RootCauseConfidence;
  note?: string;
};

export type SegmentBand = {
  range: string;
  trackCount: number;
  misfitCount: number;
  avgSemanticFit: number | null;
  note?: string;
};

export type OutlierTrack = {
  position: number;
  name: string;
  artist: string;
  reasons: string[];
  confidence: RootCauseConfidence;
};

export type AutomatedAuditResult = {
  evaluatorVersion: typeof EVALUATOR_VERSION;
  auditedAt: string;
  /** Automated only — treat as hypothesis. */
  automatedHypothesis: {
    humanQuality: QualitativeBand;
    momentFidelity: QualitativeBand;
    musicalCoherence: QualitativeBand;
    taste: QualitativeBand;
    sequencing: QualitativeBand;
    reliability: QualitativeBand;
  };
  hcs: {
    totalScore: number;
    wouldPressPlay: string;
    wouldSave: string;
    wouldShare: string;
    aiObviousness: string;
  };
  independentVerifier: {
    playlistVerdict: string;
    misfitCount: number;
    failureReasons: string[];
    topRoiFailures: Array<{ code: string; reason: string; impact: number }>;
  };
  constraints: PromptConstraint[];
  segments: SegmentBand[];
  outliers: OutlierTrack[];
  artistDiversity: {
    uniqueArtists: number;
    maxPerArtist: number;
    repeatedArtists: Array<{ artist: string; count: number }>;
    suspiciousRepetition: boolean;
  };
  underfill: {
    requested: number;
    delivered: number;
    honestPartial: boolean;
    outcome: string;
    note?: string;
  };
  failureClasses: Array<{
    class: FailureClass;
    confidence: RootCauseConfidence;
    evidence: string;
  }>;
  signalProvenance: {
    direct: string[];
    inferred: string[];
    proxy: string[];
    unavailable: string[];
  };
};

export type EvaluatedPlaylist = {
  source: "beta_evidence" | "api_response" | "fixture";
  requestId: string;
  prompt: string;
  commit: string | null;
  capturedAt: string | null;
  mode: string | null;
  interpretation: Record<string, unknown>;
  pipeline: Record<string, unknown>;
  tracks: Array<{
    position: number;
    name: string;
    artist: string;
    album: string | null;
    spotifyId: string;
    releaseYear: number | null;
  }>;
  userFeedback: {
    verdict: string | null;
    opinion: string | null;
    reasons: string[];
  } | null;
  automated: AutomatedAuditResult;
  humanReview: HumanReviewRubric | null;
  /** When human review exists, compare automated hypothesis vs human. */
  calibration: {
    agreement: "aligned" | "automated_high_human_low" | "automated_low_human_high" | "mixed" | "no_human";
    note?: string;
  } | null;
};

export type FailureCluster = {
  failureClass: FailureClass;
  count: number;
  severity: "P0" | "P1" | "P2" | "P3";
  exampleRequestIds: string[];
  humanEvidenceCount: number;
  automatedEvidenceCount: number;
  summary: string;
  confidence: RootCauseConfidence;
};

export type HumanQualityReport = {
  generatedAt: string;
  evaluatorVersion: typeof EVALUATOR_VERSION;
  engineCommit: string | null;
  playlistsEvaluated: number;
  humanReviewed: number;
  betaEvidenceIntegrated: number;
  qualitativeSummary: {
    humanQuality: QualitativeBand;
    momentFidelity: QualitativeBand;
    musicalCoherence: QualitativeBand;
    taste: QualitativeBand;
    sequencing: QualitativeBand;
    reliability: QualitativeBand;
  };
  strongestAreas: string[];
  failureClusters: FailureCluster[];
  falseAlarms: string[];
  blindSpots: string[];
  engineChanges: "NONE";
  recommendedNextStep: string;
  confidence: "low" | "medium" | "high";
  playlists: EvaluatedPlaylist[];
};
