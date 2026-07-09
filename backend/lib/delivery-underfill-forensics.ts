/**
 * Diagnosis-only delivery underfill forensics (post-afterDiversity).
 * Pure helpers — no ranking / threshold / recovery behaviour.
 */

export type DeliveryTrackSnap = {
  trackId: string;
  trackName: string;
  artistName: string;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  score?: number | null;
};

export type DeliveryStageSnap = {
  stage: string;
  enter?: number;
  exit: number;
  lost: number;
  added: number;
  removedTrackIds: string[];
  addedTrackIds: string[];
};

export type DeliveryRemovalRow = {
  trackId: string;
  artist: string;
  title: string;
  removalStage: string;
  rule: string;
  functionName: string;
  approxLines: string;
  removalReason: string;
  replacementAttempted: boolean;
  replacementSucceeded: boolean;
  replacementTrack: DeliveryTrackSnap | null;
  replacementScore: number | null;
  replacementAvailable: "YES" | "NO" | "UNKNOWN";
  replacementNote: string;
};

function asTrack(track: {
  trackId?: string;
  id?: string;
  trackName?: string | null;
  name?: string | null;
  artistName?: string | null;
  artist?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  score?: number | null;
}): DeliveryTrackSnap {
  return {
    trackId: String(track.trackId ?? track.id ?? ""),
    trackName: String(track.trackName ?? track.name ?? ""),
    artistName: String(track.artistName ?? track.artist ?? ""),
    genreFamily: track.genreFamily ?? null,
    genrePrimary: track.genrePrimary ?? null,
    releaseYear: track.releaseYear ?? null,
    score: typeof track.score === "number" ? track.score : null,
  };
}

export function snapshotDeliveryTracks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tracks: readonly any[],
): DeliveryTrackSnap[] {
  return tracks.map((track) => asTrack(track)).filter((row) => row.trackId.length > 0);
}

export function diffDeliveryStages(
  previous: DeliveryTrackSnap[],
  next: DeliveryTrackSnap[],
  stage: string,
): DeliveryStageSnap {
  const prevIds = new Set(previous.map((t) => t.trackId));
  const nextIds = new Set(next.map((t) => t.trackId));
  const removedTrackIds = previous.filter((t) => !nextIds.has(t.trackId)).map((t) => t.trackId);
  const addedTrackIds = next.filter((t) => !prevIds.has(t.trackId)).map((t) => t.trackId);
  return {
    stage,
    enter: previous.length,
    exit: next.length,
    lost: removedTrackIds.length,
    added: addedTrackIds.length,
    removedTrackIds,
    addedTrackIds,
  };
}

export function summarizeRemovalReasons(rows: DeliveryRemovalRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.removalReason] = (out[row.removalReason] ?? 0) + 1;
  }
  return out;
}

export type GenreEvidenceForensicInput = {
  pipelineExit: DeliveryTrackSnap[];
  afterEvidence: DeliveryTrackSnap[];
  verified: DeliveryTrackSnap[];
  rejected: DeliveryTrackSnap[];
  mergedConstrainedPool: DeliveryTrackSnap[];
  verifiedCount: number;
  rejectedCount: number;
  requiredCount: number;
  requiredRatio: number;
  explicitConstraintPartialReason: string | null;
  exactPoolSize: number;
  adjacentPoolSize: number;
  genrePoolSize: number;
  familyPoolSize: number;
  mergedPoolSize: number;
};

/**
 * Explain the genre-evidence underfill pattern:
 * verified < required → publishConstrainedPrefix replaces whole playlist with thin recovery pool.
 */
export function buildGenreEvidenceUnderfillAudit(
  input: GenreEvidenceForensicInput,
): {
  stageLoss: DeliveryStageSnap;
  removals: DeliveryRemovalRow[];
  counterfactual: {
    ifKeptVerifiedOnly: number;
    ifKeptVerifiedPlusRejectedWhenBelowRequired: string;
    wouldReachTargetWithVerified: boolean;
  };
  rootCauseHints: string[];
} {
  const stageLoss = diffDeliveryStages(
    input.pipelineExit,
    input.afterEvidence,
    "genre_evidence_guard",
  );

  const afterIds = new Set(input.afterEvidence.map((t) => t.trackId));
  const verifiedIds = new Set(input.verified.map((t) => t.trackId));
  const poolById = new Map(input.mergedConstrainedPool.map((t) => [t.trackId, t]));

  const removals: DeliveryRemovalRow[] = [];

  for (const track of input.rejected) {
    const keptAnyway = afterIds.has(track.trackId);
    removals.push({
      trackId: track.trackId,
      artist: track.artistName,
      title: track.trackName,
      removalStage: "genre_evidence_guard",
      rule: "finalTrackMatchesExplicitGenre === false",
      functionName: "strictGenreEvidenceDiagnostics / genre leak strip",
      approxLines: "generation.controller.ts:7790-8055",
      removalReason: "genre_evidence_rejected_leak",
      replacementAttempted: false,
      replacementSucceeded: false,
      replacementTrack: null,
      replacementScore: null,
      replacementAvailable: input.mergedPoolSize > input.afterEvidence.length ? "YES" : "NO",
      replacementNote: keptAnyway
        ? "Track later reappeared in constrained recovery set."
        : `Rejected as unverified genre leak (${input.rejectedCount} leaks). Required verified=${input.requiredCount}, had=${input.verifiedCount}.`,
    });
  }

  for (const track of input.pipelineExit) {
    if (afterIds.has(track.trackId)) continue;
    if (!verifiedIds.has(track.trackId)) continue; // rejected handled above
    const alt = [...poolById.values()].find((c) => !afterIds.has(c.trackId) && c.trackId !== track.trackId) ?? null;
    removals.push({
      trackId: track.trackId,
      artist: track.artistName,
      title: track.trackName,
      removalStage: "genre_evidence_constrained_prefix",
      rule: "verifiedCount < requiredCount → publishConstrainedPrefix(mergedConstrainedRecoveryPool)",
      functionName: "publishConstrainedPrefix",
      approxLines: "generation.controller.ts:7755-7762,7835-7856",
      removalReason: input.explicitConstraintPartialReason ?? "genre_evidence_partial_constrained_prefix",
      replacementAttempted: true,
      replacementSucceeded: input.afterEvidence.length > 0,
      replacementTrack: null,
      replacementScore: null,
      replacementAvailable: input.mergedPoolSize >= input.pipelineExit.length ? "YES" : "NO",
      replacementNote:
        `Verified track discarded because whole playlist was replaced by mergedConstrainedRecoveryPool ` +
        `(exact=${input.exactPoolSize}, adjacent=${input.adjacentPoolSize}, genre=${input.genrePoolSize}, ` +
        `family=${input.familyPoolSize}, merged=${input.mergedPoolSize}). ` +
        (alt
          ? `Unused pool candidate example: ${alt.artistName} — ${alt.trackName}`
          : "Constrained recovery pool exhausted relative to target length."),
    });
  }

  const rootCauseHints: string[] = [];
  if (input.verifiedCount < input.requiredCount && input.verifiedCount >= 5) {
    rootCauseHints.push(
      `verified(${input.verifiedCount}) < required(${input.requiredCount} @ ratio ${input.requiredRatio}) ` +
        `triggered constrained prefix; keeping verified-only would have delivered ${input.verifiedCount} tracks.`,
    );
  }
  if (input.mergedPoolSize < input.pipelineExit.length) {
    rootCauseHints.push(
      `mergedConstrainedRecoveryPool size ${input.mergedPoolSize} < pipeline exit ${input.pipelineExit.length}; ` +
        `prefix publish cannot restore length.`,
    );
  }
  if (input.rejectedCount > 0 && input.verifiedCount + 1 >= input.requiredCount) {
    rootCauseHints.push(
      `Only ${input.requiredCount - input.verifiedCount} more verified track(s) were needed to pass the ratio gate; ` +
        `instead the controller replaced the playlist with a ${input.mergedPoolSize}-track recovery pool.`,
    );
  }

  return {
    stageLoss,
    removals,
    counterfactual: {
      ifKeptVerifiedOnly: input.verifiedCount,
      ifKeptVerifiedPlusRejectedWhenBelowRequired:
        "Branch at 7857 (verified.slice) never runs when publishConstrainedPrefix succeeds first.",
      wouldReachTargetWithVerified: input.verifiedCount >= 26 || input.verifiedCount >= Math.ceil(30 * 0.85),
    },
    rootCauseHints,
  };
}
