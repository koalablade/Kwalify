/**
 * PlaylistContract — intent-preserving SSOT for V38 architecture.
 *
 * Replaces parallel CommittedWorld + LockedIntent + EditorialIntentVector
 * for generation decisions when feature flags are enabled.
 *
 * Sections:
 *   MUST      — hard constraints; violation → reject track or honest partial
 *   PREFER    — soft scoring dimensions; influence retrieval/composition
 *   MUST_NOT  — irreversible suppress (doctrine: seasonal negation is hard)
 *   CONTEXT   — activity/scene/setting; not a musical world substitute
 *   TENSION   — contradictory axes the contract preserves (not collapsed)
 *   UNKNOWN   — unmatched tokens + low-confidence dimensions
 */

export type ContractConfidence = {
  overall: number;
  /** Per-dimension confidence 0–1 */
  dimensions: Partial<Record<ContractDimension, number>>;
};

export type ContractDimension =
  | "genre"
  | "era"
  | "mood"
  | "energy"
  | "activity"
  | "scene"
  | "negation"
  | "world";

export type ContractConstraint<T = string> = {
  value: T;
  source: string;
  confidence: number;
};

export type ContractGenreMust = ContractConstraint<string> & {
  family?: string;
  subgenre?: string | null;
};

export type ContractEraMust = ContractConstraint<string> & {
  range?: { start: number; end: number } | null;
};

export type ContractEnergyPrefer = ContractConstraint<"low" | "medium" | "high"> & {
  min?: number;
  max?: number;
};

export type ContractMoodPrefer = ContractConstraint<string>;

export type ContractNegation = ContractConstraint<string> & {
  kind: "genre" | "artist" | "attribute" | "seasonal";
  hard: boolean;
};

export type ContractTension = {
  axes: [string, string];
  description: string;
  resolution: "preserve_both" | "prefer_first" | "unresolved";
};

export type ContractWorldHypothesis = {
  id: string | null;
  hardLock: boolean;
  confidence: number;
  source: string;
  musicalWorldId?: string | null;
  activityContext?: string | null;
};

export type PlaylistContract = {
  version: "playlist-contract-v1";
  prompt: string;
  must: {
    genres: ContractGenreMust[];
    eras: ContractEraMust[];
    activities: ContractConstraint<string>[];
  };
  prefer: {
    moods: ContractMoodPrefer[];
    energy: ContractEnergyPrefer[];
    scenes: ContractConstraint<string>[];
  };
  mustNot: ContractNegation[];
  context: {
    activity: string | null;
    scene: string | null;
    setting: string | null;
    timeOfDay: string | null;
  };
  tension: ContractTension[];
  unknown: {
    tokens: string[];
    dimensions: ContractDimension[];
  };
  worldHypothesis: ContractWorldHypothesis;
  confidence: ContractConfidence;
  buildSignature: string;
};

export type ContractDisagreement = {
  kind:
    | "world_id_mismatch"
    | "genre_family_mismatch"
    | "activity_mismatch"
    | "negation_missing_in_world"
    | "tension_collapsed"
    | "unknown_tokens_ignored"
    | "hard_lock_softened";
  contractValue: string | null;
  worldValue: string | null;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
};

export type ContractShadowDiagnostics = {
  contract: ReturnType<typeof compactContract>;
  disagreements: ContractDisagreement[];
  disagreementCount: number;
  collapseRisk: string;
};

/** Compact serializable form for logging. */
export function compactContract(contract: PlaylistContract) {
  return {
    version: contract.version,
    must: {
      genres: contract.must.genres.map((g) => g.value),
      eras: contract.must.eras.map((e) => e.value),
      activities: contract.must.activities.map((a) => a.value),
    },
    prefer: {
      moods: contract.prefer.moods.map((m) => m.value),
      energy: contract.prefer.energy[0]?.value ?? null,
      scenes: contract.prefer.scenes.map((s) => s.value),
    },
    mustNot: contract.mustNot.map((n) => ({ value: n.value, kind: n.kind, hard: n.hard })),
    context: contract.context,
    tension: contract.tension.map((t) => t.description),
    unknown: contract.unknown,
    worldHypothesis: {
      id: contract.worldHypothesis.id,
      hardLock: contract.worldHypothesis.hardLock,
      confidence: contract.worldHypothesis.confidence,
    },
    confidence: contract.confidence.overall,
  };
}
