/**
 * Observational candidate funnel for audit payloads.
 * Records where candidates disappear. Does not filter, score, rank, or refill.
 */

export const CANDIDATE_FUNNEL_VERSION = 1 as const;

export type FunnelCountStatus = "actual" | "unknown" | "skipped";

export type FunnelCount = {
  value: number | null;
  status: FunnelCountStatus;
};

export type CandidateFunnelTrace = {
  version: typeof CANDIDATE_FUNNEL_VERSION;
  observational: true;
  requestedLength: number;
  deliveredLength: number;
  librarySize: FunnelCount;
  retrieved: FunnelCount;
  relevantToPrompt: FunnelCount;
  worldAdmitted: FunnelCount;
  rejected: FunnelCount;
  rejectionReasons: Record<string, number>;
  artistCapRemovals: FunnelCount;
  duplicateRemovals: FunnelCount;
  eraMismatchRemovals: FunnelCount;
  worldMismatchRemovals: FunnelCount;
  negativeConstraintRemovals: FunnelCount;
  compositionCandidates: FunnelCount;
  finalSelected: FunnelCount;
  refillAttempts: FunnelCount;
  refillAdded: FunnelCount;
  worldFilterDropped: FunnelCount;
  v3PreFilter: FunnelCount;
  postPurity: FunnelCount;
  postTerminal: FunnelCount;
  scoringPool: FunnelCount;
  finalTrackUris: string[];
  completeness: "complete" | "partial" | "incomplete";
  missingFields: string[];
};

export function funnelCount(value: number | null | undefined, present = true): FunnelCount {
  if (!present || value == null || !Number.isFinite(value)) {
    return { value: null, status: "unknown" };
  }
  return { value, status: "actual" };
}

export function skippedCount(): FunnelCount {
  return { value: null, status: "skipped" };
}

export type CandidateFunnelObserver = {
  artistCapRemovals: number;
  duplicateRemovals: number;
  eraMismatchRemovals: number;
  worldMismatchRemovals: number;
  negativeConstraintRemovals: number;
  refillAttempts: number;
  refillAdded: number;
  rejectionReasons: Record<string, number>;
  recordArtistCap(dropped: number): void;
  recordDuplicates(dropped: number): void;
  recordEraMismatch(dropped: number): void;
  recordWorldMismatch(dropped: number): void;
  recordNegativeConstraint(dropped: number): void;
  recordRefill(attempted: boolean, added: number): void;
  recordRejection(reason: string, count?: number): void;
};

export function createCandidateFunnelObserver(): CandidateFunnelObserver {
  const rejectionReasons: Record<string, number> = {};
  const obs: CandidateFunnelObserver = {
    artistCapRemovals: 0,
    duplicateRemovals: 0,
    eraMismatchRemovals: 0,
    worldMismatchRemovals: 0,
    negativeConstraintRemovals: 0,
    refillAttempts: 0,
    refillAdded: 0,
    rejectionReasons,
    recordArtistCap(dropped: number) {
      if (dropped > 0) obs.artistCapRemovals += dropped;
    },
    recordDuplicates(dropped: number) {
      if (dropped > 0) obs.duplicateRemovals += dropped;
    },
    recordEraMismatch(dropped: number) {
      if (dropped > 0) obs.eraMismatchRemovals += dropped;
    },
    recordWorldMismatch(dropped: number) {
      if (dropped > 0) obs.worldMismatchRemovals += dropped;
    },
    recordNegativeConstraint(dropped: number) {
      if (dropped > 0) obs.negativeConstraintRemovals += dropped;
    },
    recordRefill(attempted: boolean, added: number) {
      if (attempted) obs.refillAttempts += 1;
      if (added > 0) obs.refillAdded += added;
    },
    recordRejection(reason: string, count = 1) {
      if (!reason || count <= 0) return;
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
    },
  };
  return obs;
}

function requiredMissing(funnel: CandidateFunnelTrace): string[] {
  const checks: Array<[string, FunnelCount]> = [
    ["librarySize", funnel.librarySize],
    ["retrieved", funnel.retrieved],
    ["relevantToPrompt", funnel.relevantToPrompt],
    ["compositionCandidates", funnel.compositionCandidates],
    ["finalSelected", funnel.finalSelected],
    ["artistCapRemovals", funnel.artistCapRemovals],
    ["refillAttempts", funnel.refillAttempts],
  ];
  return checks.filter(([, c]) => c.status !== "actual").map(([name]) => name);
}

export function assembleCandidateFunnel(input: {
  requestedLength: number;
  deliveredLength: number;
  librarySize?: number | null;
  retrieved?: number | null;
  relevantToPrompt?: number | null;
  worldAdmitted?: number | null;
  rejected?: number | null;
  rejectionReasons?: Record<string, number>;
  artistCapRemovals?: number | null;
  duplicateRemovals?: number | null;
  eraMismatchRemovals?: number | null;
  worldMismatchRemovals?: number | null;
  negativeConstraintRemovals?: number | null;
  compositionCandidates?: number | null;
  refillAttempts?: number | null;
  refillAdded?: number | null;
  worldFilterDropped?: number | null;
  v3PreFilter?: number | null;
  postPurity?: number | null;
  postTerminal?: number | null;
  scoringPool?: number | null;
  observer?: CandidateFunnelObserver | null;
  finalTrackUris?: string[];
  /** When false, observer-backed fields stay unknown instead of actual 0. */
  observerActive?: boolean;
}): CandidateFunnelTrace {
  const observerOn = input.observerActive === true && input.observer != null;
  const artistCap = observerOn
    ? input.observer!.artistCapRemovals
    : input.artistCapRemovals;
  const duplicates = observerOn
    ? input.observer!.duplicateRemovals
    : input.duplicateRemovals;
  const era = input.eraMismatchRemovals;
  const worldMis = input.worldMismatchRemovals;
  const negative = input.negativeConstraintRemovals;
  const refillAttempts = observerOn ? input.observer!.refillAttempts : input.refillAttempts;
  const refillAdded = observerOn ? input.observer!.refillAdded : input.refillAdded;
  const reasons = {
    ...(input.rejectionReasons ?? {}),
    ...(observerOn ? input.observer!.rejectionReasons : {}),
  };

  const retrieved = funnelCount(input.retrieved);
  let worldAdmitted = funnelCount(input.worldAdmitted);
  if (
    retrieved.status === "actual"
    && worldAdmitted.status === "actual"
    && (worldAdmitted.value ?? 0) > (retrieved.value ?? 0)
  ) {
    worldAdmitted = { value: null, status: "unknown" };
  }
  let rejected = funnelCount(input.rejected);
  if (rejected.status !== "actual" && retrieved.status === "actual" && worldAdmitted.status === "actual") {
    rejected = funnelCount(Math.max(0, (retrieved.value ?? 0) - (worldAdmitted.value ?? 0)));
  }

  const uris = [...(input.finalTrackUris ?? [])];
  const funnel: CandidateFunnelTrace = {
    version: CANDIDATE_FUNNEL_VERSION,
    observational: true,
    requestedLength: input.requestedLength,
    deliveredLength: input.deliveredLength,
    librarySize: funnelCount(input.librarySize),
    retrieved,
    relevantToPrompt: funnelCount(input.relevantToPrompt),
    worldAdmitted,
    rejected,
    rejectionReasons: reasons,
    artistCapRemovals: funnelCount(artistCap, observerOn || input.artistCapRemovals != null),
    duplicateRemovals: funnelCount(duplicates, observerOn || input.duplicateRemovals != null),
    eraMismatchRemovals: funnelCount(era, input.eraMismatchRemovals != null),
    worldMismatchRemovals: funnelCount(worldMis, input.worldMismatchRemovals != null),
    negativeConstraintRemovals: funnelCount(negative, input.negativeConstraintRemovals != null),
    compositionCandidates: funnelCount(input.compositionCandidates),
    finalSelected: funnelCount(input.deliveredLength),
    refillAttempts: funnelCount(refillAttempts, observerOn || input.refillAttempts != null),
    refillAdded: funnelCount(refillAdded, observerOn || input.refillAdded != null),
    worldFilterDropped: funnelCount(input.worldFilterDropped, input.worldFilterDropped != null),
    v3PreFilter: funnelCount(input.v3PreFilter),
    postPurity: funnelCount(input.postPurity),
    postTerminal: funnelCount(input.postTerminal),
    scoringPool: funnelCount(input.scoringPool),
    finalTrackUris: uris,
    completeness: "incomplete",
    missingFields: [],
  };
  funnel.missingFields = requiredMissing(funnel);
  funnel.completeness = funnel.missingFields.length === 0
    ? "complete"
    : funnel.missingFields.length <= 3
      ? "partial"
      : "incomplete";
  return funnel;
}

export function readCandidateFunnel(source: Record<string, unknown> | null | undefined): CandidateFunnelTrace | null {
  const raw = source?.candidateFunnel ?? (source?.pipeline as Record<string, unknown> | undefined)?.candidateFunnel;
  if (!raw || typeof raw !== "object") return null;
  const funnel = raw as CandidateFunnelTrace;
  if (funnel.version !== 1 || funnel.observational !== true) return null;
  return funnel;
}

export function funnelIsIncomplete(funnel: CandidateFunnelTrace | null | undefined): boolean {
  if (!funnel) return true;
  return funnel.completeness !== "complete";
}

export function playlistUrisFromTracks(
  tracks: ReadonlyArray<{ uri?: unknown; id?: unknown; trackId?: unknown }>,
): string[] {
  return tracks.map((track) => {
    if (typeof track.uri === "string" && track.uri.startsWith("spotify:track:")) return track.uri;
    const id = typeof track.id === "string" && track.id
      ? track.id
      : typeof track.trackId === "string"
        ? track.trackId
        : "";
    if (!id) return "";
    return id.startsWith("spotify:track:") ? id : `spotify:track:${id}`;
  }).filter(Boolean);
}

function stageNumber(
  trace: { stages?: Record<string, unknown> } | null | undefined,
  key: string,
): number | null {
  if (!trace?.stages) return null;
  const value = trace.stages[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countMatchingReasons(reasons: string[] | undefined, pattern: RegExp): number | null {
  if (!Array.isArray(reasons)) return null;
  return reasons.filter((reason) => pattern.test(reason)).length;
}

function tallyReasons(reasons: string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const reason of reasons ?? []) {
    if (!reason) continue;
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

export function observeRefillAttempt(
  observer: CandidateFunnelObserver | null | undefined,
  added: number,
): void {
  observer?.recordRefill(true, Number.isFinite(added) ? added : 0);
}

export function observeArtistCapDropped(
  observer: CandidateFunnelObserver | null | undefined,
  dropped: number,
): void {
  observer?.recordArtistCap(Number.isFinite(dropped) ? dropped : 0);
}

export function observeDuplicateRemovals(
  observer: CandidateFunnelObserver | null | undefined,
  dropped: number,
): void {
  observer?.recordDuplicates(Number.isFinite(dropped) ? dropped : 0);
}

/**
 * Assemble the audit funnel from existing generation traces + optional observer.
 * Missing sources stay `unknown` — never coerced to 0.
 */
export function buildCandidateFunnelFromGenerationAudit(input: {
  requestedLength: number;
  deliveredLength: number;
  librarySize?: number | null;
  retrievalFunnel?: { stages?: Record<string, unknown> } | null;
  deliveryLossFunnel?: {
    orchestratorFinal?: number | null;
    v3PreFilterSurvivors?: number | null;
    v3Composed?: number | null;
    postPurity?: number | null;
    postTerminal?: number | null;
  } | null;
  puritySubFunnel?: {
    hardRejectOffWorldCount?: number | null;
    removedReasons?: string[];
    checkpointRemovedReasons?: string[];
  } | null;
  validCandidateSupply?: {
    strictValidCount?: number;
    relaxedValidCount?: number;
  } | null;
  retrievedFallback?: number | null;
  observer?: CandidateFunnelObserver | null;
  observerActive?: boolean;
  finalTrackUris?: string[];
}): CandidateFunnelTrace {
  const retrievalPresent = input.retrievalFunnel != null && typeof input.retrievalFunnel === "object";
  const retrieved = retrievalPresent
    ? stageNumber(input.retrievalFunnel, "afterFinalGate")
      ?? input.deliveryLossFunnel?.orchestratorFinal
      ?? input.retrievedFallback
    : input.deliveryLossFunnel?.orchestratorFinal ?? input.retrievedFallback;
  const afterGenre = retrievalPresent ? stageNumber(input.retrievalFunnel, "afterGenreFilter") : null;
  const afterWorld = retrievalPresent ? stageNumber(input.retrievalFunnel, "afterWorldFilter") : null;
  const scoringPool = retrievalPresent ? stageNumber(input.retrievalFunnel, "afterScoring") : null;
  const worldFilterDropped =
    afterGenre != null && afterWorld != null ? Math.max(0, afterGenre - afterWorld) : null;
  let worldAdmitted = afterWorld;
  if (retrieved != null && afterWorld != null && afterWorld > retrieved) {
    worldAdmitted = null;
  }
  const librarySize = input.librarySize
    ?? (retrievalPresent ? stageNumber(input.retrievalFunnel, "totalLibrary") : null);
  const relevant = input.validCandidateSupply?.strictValidCount
    ?? input.validCandidateSupply?.relaxedValidCount
    ?? null;
  const purityReasons = [
    ...(input.puritySubFunnel?.removedReasons ?? []),
    ...(input.puritySubFunnel?.checkpointRemovedReasons ?? []),
  ];
  const purityPresent = input.puritySubFunnel != null;
  const worldMismatch = purityPresent
    ? (typeof input.puritySubFunnel?.hardRejectOffWorldCount === "number"
      ? input.puritySubFunnel.hardRejectOffWorldCount
      : countMatchingReasons(purityReasons, /off.?world|world.?mismatch|purity/i) ?? 0)
    : null;
  const eraMismatch = purityPresent
    ? countMatchingReasons(purityReasons, /era|decade|year.?mismatch/i)
    : null;
  const negative = purityPresent
    ? countMatchingReasons(purityReasons, /christmas|negative|suppress|exclude|forbidden/i)
    : null;

  const funnel = assembleCandidateFunnel({
    requestedLength: input.requestedLength,
    deliveredLength: input.deliveredLength,
    librarySize,
    retrieved,
    relevantToPrompt: relevant,
    worldAdmitted,
    rejectionReasons: tallyReasons(purityReasons),
    worldMismatchRemovals: worldMismatch,
    eraMismatchRemovals: eraMismatch,
    negativeConstraintRemovals: negative,
    compositionCandidates: input.deliveryLossFunnel?.v3Composed ?? null,
    worldFilterDropped,
    v3PreFilter: input.deliveryLossFunnel?.v3PreFilterSurvivors ?? null,
    postPurity: input.deliveryLossFunnel?.postPurity ?? null,
    postTerminal: input.deliveryLossFunnel?.postTerminal ?? null,
    scoringPool,
    observer: input.observer,
    observerActive: input.observerActive === true,
    finalTrackUris: input.finalTrackUris,
  });
  return reconcileFunnelAgainstDelivery(funnel);
}

function copyActual(count: FunnelCount | undefined): number | null {
  if (!count || count.status !== "actual" || count.value == null || !Number.isFinite(count.value)) {
    return null;
  }
  return count.value;
}

/**
 * Recompute funnel honesty from raw retrieval/delivery traces.
 * Persisted observer fields (artist-cap, refill) are kept; library-wide
 * afterWorldFilter is not treated as retrieval-pool world admission.
 */
export function rebuildCandidateFunnelFromPersistedAudit(input: {
  requestedLength: number;
  deliveredLength: number;
  persisted?: CandidateFunnelTrace | null;
  retrievalFunnel?: { stages?: Record<string, unknown> } | null;
  deliveryLossFunnel?: {
    orchestratorFinal?: number | null;
    v3PreFilterSurvivors?: number | null;
    v3Composed?: number | null;
    postPurity?: number | null;
    postTerminal?: number | null;
  } | null;
  puritySubFunnel?: {
    hardRejectOffWorldCount?: number | null;
    removedReasons?: string[];
    checkpointRemovedReasons?: string[];
  } | null;
}): CandidateFunnelTrace {
  const persisted = input.persisted ?? null;
  const hasRawTraces = input.retrievalFunnel != null || input.deliveryLossFunnel != null;
  if (!hasRawTraces && persisted) return persisted;

  const observer = createCandidateFunnelObserver();
  let observerActive = false;
  const cap = copyActual(persisted?.artistCapRemovals);
  const dup = copyActual(persisted?.duplicateRemovals);
  const refillAttempts = copyActual(persisted?.refillAttempts);
  const refillAdded = copyActual(persisted?.refillAdded);
  if (cap != null) {
    observer.artistCapRemovals = cap;
    observerActive = true;
  }
  if (dup != null) {
    observer.duplicateRemovals = dup;
    observerActive = true;
  }
  if (refillAttempts != null) {
    observer.refillAttempts = refillAttempts;
    observerActive = true;
  }
  if (refillAdded != null) {
    observer.refillAdded = refillAdded;
    observerActive = true;
  }

  const relevant = copyActual(persisted?.relevantToPrompt);
  return buildCandidateFunnelFromGenerationAudit({
    requestedLength: input.requestedLength,
    deliveredLength: input.deliveredLength,
    librarySize: copyActual(persisted?.librarySize),
    retrievalFunnel: input.retrievalFunnel ?? null,
    deliveryLossFunnel: input.deliveryLossFunnel ?? null,
    puritySubFunnel: input.puritySubFunnel ?? null,
    validCandidateSupply: relevant != null ? { strictValidCount: relevant } : null,
    retrievedFallback: copyActual(persisted?.retrieved),
    observer: observerActive ? observer : null,
    observerActive,
    finalTrackUris: persisted?.finalTrackUris,
  });
}

function markUnknown(count: FunnelCount): FunnelCount {
  return { value: null, status: "unknown" };
}

/** Delivered tracks with a recorded 0 earlier in the funnel means the 0 is not trustworthy. */
export function reconcileFunnelAgainstDelivery(funnel: CandidateFunnelTrace): CandidateFunnelTrace {
  const next = { ...funnel, rejectionReasons: { ...funnel.rejectionReasons } };
  if (next.deliveredLength > 0 && next.retrieved.status === "actual" && next.retrieved.value === 0) {
    next.retrieved = markUnknown(next.retrieved);
  }
  if (next.deliveredLength > 0 && next.worldAdmitted.status === "actual" && next.worldAdmitted.value === 0) {
    next.worldAdmitted = markUnknown(next.worldAdmitted);
  }
  if (next.deliveredLength > 0 && next.compositionCandidates.status === "actual" && next.compositionCandidates.value === 0) {
    next.compositionCandidates = markUnknown(next.compositionCandidates);
  }
  next.missingFields = requiredMissing(next);
  next.completeness = next.missingFields.length === 0
    ? "complete"
    : next.missingFields.length <= 3
      ? "partial"
      : "incomplete";
  return next;
}

export type FunnelDropStage =
  | "library_never_retrieved"
  | "world_filter_noop"
  | "world_admission"
  | "rejection_filters"
  | "v3_prefilter"
  | "artist_cap"
  | "composition"
  | "post_composition_trim"
  | "refill_failed"
  | "final_selection"
  | "unknown";

export function inferFunnelDropStage(
  funnel: CandidateFunnelTrace,
  relevantLibraryCount?: number | null,
): { primary: FunnelDropStage; evidence: string } {
  if (funnelIsIncomplete(funnel)) {
    return {
      primary: "unknown",
      evidence: `candidateFunnel ${funnel.completeness}; missing ${funnel.missingFields.join(", ") || "none"}; do not treat unknown as 0`,
    };
  }
  const librarySize = funnel.librarySize.status === "actual" ? funnel.librarySize.value : null;
  const relevantRaw = relevantLibraryCount ?? funnel.relevantToPrompt.value ?? null;
  const relevantLooksLibraryWide =
    relevantRaw != null
    && librarySize != null
    && librarySize > 0
    && relevantRaw >= librarySize * 0.95;
  const relevant = relevantLooksLibraryWide ? 0 : (relevantRaw ?? 0);
  const retrieved = funnel.retrieved.value ?? 0;
  const admitted = funnel.worldAdmitted.status === "actual" ? funnel.worldAdmitted.value ?? 0 : null;
  const rejected = funnel.rejected.value ?? 0;
  const composed = funnel.compositionCandidates.value ?? 0;
  const finalCount = funnel.finalSelected.value ?? 0;
  const cap = funnel.artistCapRemovals.value ?? 0;
  const refillAttempts = funnel.refillAttempts.value ?? 0;
  const refillAdded = funnel.refillAdded.value ?? 0;
  const requested = funnel.requestedLength;
  const worldDropped = funnel.worldFilterDropped;
  const prefilter = funnel.v3PreFilter;
  const underfilled = requested > 0 && finalCount < requested * 0.8;

  if (prefilter?.status === "actual" && retrieved > 100 && (prefilter.value ?? 0) < 50 && underfilled) {
    return {
      primary: "v3_prefilter",
      evidence: `${retrieved} scoring-pool → ${prefilter.value} v3 prefilter survivors`,
    };
  }
  if (worldDropped?.status === "actual" && worldDropped.value === 0 && retrieved >= 100 && underfilled) {
    return {
      primary: "world_filter_noop",
      evidence: "afterWorldFilter dropped 0 vs afterGenreFilter; scoring pool is not a prompt-world subset",
    };
  }
  if (!relevantLooksLibraryWide && relevant >= 50 && retrieved < Math.max(25, relevant * 0.25)) {
    return {
      primary: "library_never_retrieved",
      evidence: `${relevant} relevant library tracks vs ${retrieved} retrieved`,
    };
  }
  if (admitted != null && retrieved > 0 && admitted < retrieved * 0.25) {
    return {
      primary: "world_admission",
      evidence: `${retrieved} retrieved → ${admitted} world-admitted`,
    };
  }
  if (rejected > 0 && admitted != null && rejected >= admitted && admitted < requested) {
    return {
      primary: "rejection_filters",
      evidence: `${rejected} rejected vs ${admitted} admitted; reasons=${JSON.stringify(funnel.rejectionReasons)}`,
    };
  }
  if (cap > 0 && finalCount < requested && cap >= Math.max(1, composed - finalCount)) {
    return {
      primary: "artist_cap",
      evidence: `${cap} artist-cap removals; ${composed} composed → ${finalCount} final`,
    };
  }
  if (admitted != null && admitted > 0 && composed < admitted * 0.5) {
    return {
      primary: "composition",
      evidence: `${admitted} world-admitted → ${composed} composition candidates`,
    };
  }
  if (refillAttempts > 0 && refillAdded === 0 && finalCount < requested) {
    return {
      primary: "refill_failed",
      evidence: `${refillAttempts} refill attempts added 0 tracks; final ${finalCount}/${requested}`,
    };
  }
  if (composed >= Math.min(requested, 20) && finalCount < requested * 0.75 && cap === 0) {
    return {
      primary: "post_composition_trim",
      evidence: `${composed} composed → ${finalCount} final; artist-cap removals 0`,
    };
  }
  if (composed > finalCount) {
    return {
      primary: "final_selection",
      evidence: `${composed} composition candidates → ${finalCount} selected`,
    };
  }
  return {
    primary: "unknown",
    evidence: "Complete counts do not isolate a single drop stage",
  };
}
