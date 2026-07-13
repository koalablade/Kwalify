import {
  adjacentSubgenreTermsForIntent,
  trackMatchesAdjacentSubgenreEvidence,
} from "./genre-subgenre-adjacency";
import { assessGenreEvidenceTier, type GenreEvidenceTier } from "./genre-evidence-tier";

export type GenreEvidenceConfidence = {
  confidence: number;
  tier: GenreEvidenceTier;
};

export type ExplicitSubgenreIntent = {
  primarySubgenre: string | null;
  secondarySubgenre: string | null;
  subgenreTerms: string[];
  genreFamilies?: string[];
};

export type GenreClassEntry = {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
};

export type GenreEvidenceTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  score?: number;
};

export function normalizeGenreEvidenceTerm(term: string): string {
  return term.toLowerCase().replace(/^genre:/, "").replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

export function explicitSubgenreTerms(intent: ExplicitSubgenreIntent): string[] {
  return [
    intent.primarySubgenre,
    intent.secondarySubgenre,
    ...intent.subgenreTerms,
  ]
    .filter((term): term is string => !!term && term.trim().length > 0)
    .map(normalizeGenreEvidenceTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

export function adjacentExplicitSubgenreTerms(lockedSubgenre: string, genreFamilies: string[] = []): string[] {
  return adjacentSubgenreTermsForIntent({
    primarySubgenre: lockedSubgenre,
    secondarySubgenre: null,
    subgenreTerms: [],
    genreFamilies,
  });
}

export function trackGenreTerms(
  track: GenreEvidenceTrack,
  classMap: Map<string, GenreClassEntry>,
): string[] {
  const classification = classMap.get(track.trackId);
  if (!classification) return [];
  return [
    classification.genreFamily,
    classification.genrePrimary,
    classification.primarySubgenre,
    classification.secondarySubgenre,
    ...classification.subGenres,
  ].filter((term): term is string => !!term && term.trim().length > 0);
}

export function trackMatchesAdjacentExplicitSubgenre(
  track: GenreEvidenceTrack,
  intent: ExplicitSubgenreIntent,
  classMap: Map<string, GenreClassEntry>,
): boolean {
  const expected = explicitSubgenreTerms(intent);
  if (expected.length === 0) return false;
  const terms = trackGenreTerms(track, classMap).map(normalizeGenreEvidenceTerm);
  return trackMatchesAdjacentSubgenreEvidence(terms, {
    primarySubgenre: intent.primarySubgenre,
    secondarySubgenre: intent.secondarySubgenre,
    subgenreTerms: intent.subgenreTerms,
    genreFamilies: intent.genreFamilies ?? [],
  });
}

export function trackMatchesExplicitSubgenreEvidence(
  track: GenreEvidenceTrack,
  intent: ExplicitSubgenreIntent,
  classMap: Map<string, GenreClassEntry>,
  opts: { allowIntentAdjacentSubgenres?: boolean; genreFamilies?: string[] } = {},
): boolean {
  const expected = explicitSubgenreTerms(intent);
  if (expected.length === 0) return true;
  const terms = trackGenreTerms(track, classMap).map(normalizeGenreEvidenceTerm);
  if (expected.some((term) =>
    terms.some((candidate) => candidate === term || candidate.includes(term) || term.includes(candidate))
  )) {
    return true;
  }
  if (!opts.allowIntentAdjacentSubgenres) return false;
  return trackMatchesAdjacentSubgenreEvidence(terms, {
    primarySubgenre: intent.primarySubgenre,
    secondarySubgenre: intent.secondarySubgenre,
    subgenreTerms: intent.subgenreTerms,
    genreFamilies: opts.genreFamilies ?? intent.genreFamilies ?? [],
  });
}

export function fillVerifiedPlaylistFromV3Output<T extends GenreEvidenceTrack>(opts: {
  verified: T[];
  v3Tracks: T[];
  targetLength: number;
  isCompatibleFill: (track: T) => boolean;
}): { tracks: T[]; filledFromV3Count: number; verifiedPreservedCount: number } {
  const seen = new Set(opts.verified.map((track) => track.trackId));
  const tracks = [...opts.verified];
  const verifiedPreservedCount = tracks.length;
  if (tracks.length >= opts.targetLength) {
    return { tracks: tracks.slice(0, opts.targetLength), filledFromV3Count: 0, verifiedPreservedCount };
  }
  let filledFromV3Count = 0;
  for (const track of opts.v3Tracks) {
    if (tracks.length >= opts.targetLength) break;
    if (seen.has(track.trackId)) continue;
    if (!opts.isCompatibleFill(track)) continue;
    seen.add(track.trackId);
    tracks.push(track);
    filledFromV3Count += 1;
  }
  return { tracks, filledFromV3Count, verifiedPreservedCount };
}

export const PARTIAL_GENRE_VERIFICATION_PASS_RATIO = 0.65;
export const MIN_GENRE_EVIDENCE_VERIFIED_FLOOR = 5;
/** Minimum confidence to include a track in repair fill (taxonomy tier). */
export const REPAIR_MIN_CONFIDENCE_THRESHOLD = 0.62;
/** Prefer high-confidence tracks first during repair (album_genre tier+). */
export const REPAIR_HIGH_CONFIDENCE_THRESHOLD = 0.68;

export type AdaptiveGenreEvidenceRequiredInput = {
  evidenceBasisCount: number;
  targetLength: number;
  baseRatio: number;
  /** Tracks in V3 output that pass full genre+subgenre evidence */
  availableVerifiedSupply: number;
  strictValidSupply?: number | null;
};

export type AdaptiveGenreEvidenceRequiredResult = {
  requiredCount: number;
  effectiveRatio: number;
  partialPlaylistExpected: boolean;
  supplyCapped: boolean;
  baseRequiredCount: number;
  availableVerifiedSupply: number;
};

/**
 * Caps required verified count when library/V3 supply cannot satisfy the nominal ratio gate.
 */
export function computeAdaptiveGenreEvidenceRequiredCount(
  input: AdaptiveGenreEvidenceRequiredInput,
): AdaptiveGenreEvidenceRequiredResult {
  const { evidenceBasisCount, targetLength, baseRatio, availableVerifiedSupply, strictValidSupply } = input;
  const partialPlaylistExpected = evidenceBasisCount < Math.ceil(targetLength * 0.9);
  const effectiveRatio = partialPlaylistExpected
    ? Math.min(baseRatio, PARTIAL_GENRE_VERIFICATION_PASS_RATIO)
    : baseRatio;

  const baseRequiredCount = evidenceBasisCount === 0
    ? Math.min(targetLength, Math.max(1, MIN_GENRE_EVIDENCE_VERIFIED_FLOOR))
    : Math.min(
        evidenceBasisCount,
        Math.max(
          partialPlaylistExpected ? Math.min(MIN_GENRE_EVIDENCE_VERIFIED_FLOOR, evidenceBasisCount) : 1,
          Math.ceil(evidenceBasisCount * effectiveRatio),
        ),
      );

  const supplyCeiling = Math.min(
    availableVerifiedSupply > 0 ? availableVerifiedSupply : evidenceBasisCount,
    strictValidSupply != null && strictValidSupply > 0 ? strictValidSupply : Number.POSITIVE_INFINITY,
    targetLength,
  );
  const supplyAwareRequired = supplyCeiling > 0 && Number.isFinite(supplyCeiling)
    ? Math.min(
        baseRequiredCount,
        Math.max(
          partialPlaylistExpected ? Math.min(MIN_GENRE_EVIDENCE_VERIFIED_FLOOR, supplyCeiling) : 1,
          Math.ceil(supplyCeiling * effectiveRatio),
        ),
      )
    : baseRequiredCount;

  return {
    requiredCount: supplyAwareRequired,
    effectiveRatio,
    partialPlaylistExpected,
    supplyCapped: supplyAwareRequired < baseRequiredCount,
    baseRequiredCount,
    availableVerifiedSupply,
  };
}

export type PartialGenreVerificationScore = {
  score: number;
  passes: boolean;
  supplyExhausted: boolean;
  confidenceWeightedScore: number;
  reason:
    | "meets_adaptive_required"
    | "supply_exhausted"
    | "partial_ratio_pass"
    | "confidence_weighted_pass"
    | "high_confidence_near_miss"
    | "below_threshold";
};

export function computeConfidenceWeightedVerificationScore(
  verifiedConfidences: number[],
  requiredCount: number,
): number {
  if (verifiedConfidences.length === 0) return 0;
  const required = Math.max(1, requiredCount);
  const sum = verifiedConfidences.reduce((acc, value) => acc + value, 0);
  return Math.min(1, sum / (required * 0.92));
}

export function computePartialGenreVerificationScore(opts: {
  verifiedCount: number;
  requiredCount: number;
  availableVerifiedSupply: number;
  minVerifiedFloor?: number;
  verifiedConfidences?: number[];
}): PartialGenreVerificationScore {
  const floor = opts.minVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  const required = Math.max(1, opts.requiredCount);
  const score = Math.min(1, opts.verifiedCount / required);
  const confidences = opts.verifiedConfidences ?? [];
  const confidenceWeightedScore = computeConfidenceWeightedVerificationScore(confidences, required);
  const averageConfidence = confidences.length > 0
    ? confidences.reduce((acc, value) => acc + value, 0) / confidences.length
    : 0;
  const supplyExhausted =
    opts.availableVerifiedSupply >= floor &&
    opts.verifiedCount >= Math.max(floor, Math.floor(opts.availableVerifiedSupply * 0.9));
  let reason: PartialGenreVerificationScore["reason"] = "below_threshold";
  let passes = false;
  if (opts.verifiedCount >= opts.requiredCount) {
    passes = true;
    reason = "meets_adaptive_required";
  } else if (opts.verifiedCount >= floor && supplyExhausted) {
    passes = true;
    reason = "supply_exhausted";
  } else if (opts.verifiedCount >= floor && score >= PARTIAL_GENRE_VERIFICATION_PASS_RATIO) {
    passes = true;
    reason = "partial_ratio_pass";
  } else if (
    opts.verifiedCount >= floor &&
    confidenceWeightedScore >= PARTIAL_GENRE_VERIFICATION_PASS_RATIO
  ) {
    passes = true;
    reason = "confidence_weighted_pass";
  } else if (
    opts.verifiedCount >= floor &&
    opts.verifiedCount >= opts.requiredCount - 1 &&
    averageConfidence >= REPAIR_HIGH_CONFIDENCE_THRESHOLD
  ) {
    passes = true;
    reason = "high_confidence_near_miss";
  }
  return { score, passes, supplyExhausted, confidenceWeightedScore, reason };
}

export type GenreAwareRepairInput<T extends GenreEvidenceTrack> = {
  /** Verified tracks from genre guard — preserved in order at playlist prefix */
  verifiedPrefix: T[];
  /** V3 output before genre guard mutations */
  v3Tracks: T[];
  requestedLength: number;
  /** Count of v3Tracks passing full genre evidence (incl. adjacent subgenre when allowed) */
  availableGenreVerifiedSupply: number;
  isGenreVerified: (track: T) => boolean;
  passesHardConstraints: (track: T) => boolean;
  /** When set, repair fill prefers high-confidence genre evidence before lower tiers */
  genreEvidenceConfidence?: (track: T) => GenreEvidenceConfidence;
};

export type GenreAwareRepairResult<T extends GenreEvidenceTrack> = {
  tracks: T[];
  verifiedPreservedCount: number;
  filledFromV3Count: number;
  postRepairVerifiedCount: number;
  repairTargetLength: number;
  supplyCapped: boolean;
  highConfidenceFillCount: number;
  minConfidenceFillCount: number;
  averageRepairConfidence: number;
};

function fillFromConfidenceRankedV3<T extends GenreEvidenceTrack>(opts: {
  verified: T[];
  v3Tracks: T[];
  targetLength: number;
  isCompatibleFill: (track: T) => boolean;
  genreEvidenceConfidence: (track: T) => GenreEvidenceConfidence;
}): {
  tracks: T[];
  filledFromV3Count: number;
  verifiedPreservedCount: number;
  highConfidenceFillCount: number;
  minConfidenceFillCount: number;
  averageRepairConfidence: number;
} {
  const seen = new Set(opts.verified.map((track) => track.trackId));
  const tracks = [...opts.verified];
  const verifiedPreservedCount = tracks.length;
  if (tracks.length >= opts.targetLength) {
    const confidences = tracks.map((track) => opts.genreEvidenceConfidence(track).confidence);
    const averageRepairConfidence = confidences.length > 0
      ? confidences.reduce((acc, value) => acc + value, 0) / confidences.length
      : 0;
    return {
      tracks: tracks.slice(0, opts.targetLength),
      filledFromV3Count: 0,
      verifiedPreservedCount,
      highConfidenceFillCount: 0,
      minConfidenceFillCount: 0,
      averageRepairConfidence,
    };
  }

  const candidates = opts.v3Tracks
    .map((track, v3Index) => ({ track, v3Index }))
    .filter(({ track }) => !seen.has(track.trackId) && opts.isCompatibleFill(track))
    .map(({ track, v3Index }) => ({
      track,
      v3Index,
      ...opts.genreEvidenceConfidence(track),
    }))
    .filter((row) => row.confidence >= REPAIR_MIN_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence || a.v3Index - b.v3Index);

  let filledFromV3Count = 0;
  let highConfidenceFillCount = 0;
  let minConfidenceFillCount = 0;
  const fillPasses: Array<typeof candidates> = [
    candidates.filter((row) => row.confidence >= REPAIR_HIGH_CONFIDENCE_THRESHOLD),
    candidates.filter((row) => row.confidence < REPAIR_HIGH_CONFIDENCE_THRESHOLD),
  ];
  for (const pass of fillPasses) {
    for (const row of pass) {
      if (tracks.length >= opts.targetLength) break;
      if (seen.has(row.track.trackId)) continue;
      seen.add(row.track.trackId);
      tracks.push(row.track);
      filledFromV3Count += 1;
      if (row.confidence >= REPAIR_HIGH_CONFIDENCE_THRESHOLD) highConfidenceFillCount += 1;
      else minConfidenceFillCount += 1;
    }
    if (tracks.length >= opts.targetLength) break;
  }

  const confidences = tracks.map((track) => opts.genreEvidenceConfidence(track).confidence);
  const averageRepairConfidence = confidences.length > 0
    ? confidences.reduce((acc, value) => acc + value, 0) / confidences.length
    : 0;
  return {
    tracks,
    filledFromV3Count,
    verifiedPreservedCount,
    highConfidenceFillCount,
    minConfidenceFillCount,
    averageRepairConfidence,
  };
}

/**
 * Genre-aware repair: preserve verified prefix, then fill remaining slots from V3 order
 * using only genre-verified + constraint-safe tracks. Caps target by available supply.
 */
export function repairGenreAwarePlaylistFromV3<T extends GenreEvidenceTrack>(
  input: GenreAwareRepairInput<T>,
): GenreAwareRepairResult<T> {
  const supply = Math.max(0, input.availableGenreVerifiedSupply);
  const repairTargetLength = supply > 0
    ? Math.min(input.requestedLength, supply)
    : input.requestedLength;

  const isCompatibleFill = (track: T) =>
    input.passesHardConstraints(track) && input.isGenreVerified(track);

  const filled = input.genreEvidenceConfidence
    ? fillFromConfidenceRankedV3({
        verified: input.verifiedPrefix,
        v3Tracks: input.v3Tracks,
        targetLength: repairTargetLength,
        isCompatibleFill,
        genreEvidenceConfidence: input.genreEvidenceConfidence,
      })
    : (() => {
        const base = fillVerifiedPlaylistFromV3Output({
          verified: input.verifiedPrefix,
          v3Tracks: input.v3Tracks,
          targetLength: repairTargetLength,
          isCompatibleFill,
        });
        return {
          ...base,
          highConfidenceFillCount: 0,
          minConfidenceFillCount: base.filledFromV3Count,
          averageRepairConfidence: 0,
        };
      })();

  const postRepairVerifiedCount = filled.tracks.filter(input.isGenreVerified).length;
  return {
    tracks: filled.tracks,
    verifiedPreservedCount: filled.verifiedPreservedCount,
    filledFromV3Count: filled.filledFromV3Count,
    postRepairVerifiedCount,
    repairTargetLength,
    supplyCapped: repairTargetLength < input.requestedLength,
    highConfidenceFillCount: filled.highConfidenceFillCount,
    minConfidenceFillCount: filled.minConfidenceFillCount,
    averageRepairConfidence: filled.averageRepairConfidence,
  };
}

export function countConfidenceQualifiedGenreTracks<T extends GenreEvidenceTrack>(
  tracks: T[],
  isGenreVerified: (track: T) => boolean,
  genreEvidenceConfidence: (track: T) => GenreEvidenceConfidence,
  minConfidence = REPAIR_MIN_CONFIDENCE_THRESHOLD,
): number {
  return tracks.filter((track) =>
    isGenreVerified(track) && genreEvidenceConfidence(track).confidence >= minConfidence
  ).length;
}

/**
 * Use the richest verified supply for ratio/publish gates — confidence-qualified
 * must not undercut the V3-verified or published-verified pools (cal-001 collapse).
 */
export function resolveEffectiveGenreVerifiedSupply(opts: {
  confidenceQualifiedSupply: number;
  v3VerifiedSupply: number;
  verifiedCount: number;
  postRepairVerifiedCount?: number;
}): number {
  return Math.max(
    opts.confidenceQualifiedSupply,
    opts.v3VerifiedSupply,
    opts.verifiedCount,
    opts.postRepairVerifiedCount ?? 0,
  );
}

/**
 * Prefer the V3-verified prefix when intermediate guards collapsed finals
 * below the genre-verified pool size.
 */
export function resolveGenreEvidenceVerifiedPrefix<T extends GenreEvidenceTrack>(
  finalsVerified: T[],
  v3Tracks: T[],
  isGenreVerified: (track: T) => boolean,
  passesHardConstraints: (track: T) => boolean,
): T[] {
  const fromV3 = v3Tracks.filter((track) => isGenreVerified(track) && passesHardConstraints(track));
  return fromV3.length > finalsVerified.length ? fromV3 : finalsVerified;
}

export function buildVerifiedV3OutputPlaylist<T extends GenreEvidenceTrack>(
  input: GenreAwareRepairInput<T>,
): GenreAwareRepairResult<T> {
  const verifiedPrefix = input.verifiedPrefix.filter(
    (track) => input.isGenreVerified(track) && input.passesHardConstraints(track),
  );
  return repairGenreAwarePlaylistFromV3({
    ...input,
    verifiedPrefix,
  });
}

export function shouldPublishVerifiedV3Output(opts: {
  active: boolean;
  verifiedCount: number;
  rejectedCount: number;
  partialVerificationPasses: boolean;
  publishedTrackCount: number;
  requestedLength: number;
  confidenceAwarePasses?: boolean;
  minVerifiedFloor?: number;
}): boolean {
  const floor = opts.minVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  if (!opts.active || opts.verifiedCount < floor) return false;
  if (opts.confidenceAwarePasses === true) return true;
  return (
    !opts.partialVerificationPasses ||
    opts.publishedTrackCount < opts.requestedLength ||
    opts.rejectedCount > 0
  );
}

export type ConfidenceAwarePublicationAssessment = {
  shouldPublish: boolean;
  passes: boolean;
  publishReason: string;
  confidenceQualifiedSupply: number;
  confidenceWeightedScore: number;
  averageVerifiedConfidence: number;
  highConfidenceVerifiedCount: number;
  partialVerificationReason: PartialGenreVerificationScore["reason"];
};

export function assessConfidenceAwarePublication(opts: {
  active: boolean;
  verifiedCount: number;
  requiredCount: number;
  availableVerifiedSupply: number;
  confidenceQualifiedSupply: number;
  verifiedConfidences: number[];
  partialVerificationPasses: boolean;
  rejectedCount: number;
  publishedTrackCount: number;
  requestedLength: number;
  minVerifiedFloor?: number;
}): ConfidenceAwarePublicationAssessment {
  const floor = opts.minVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  const partial = computePartialGenreVerificationScore({
    verifiedCount: opts.verifiedCount,
    requiredCount: opts.requiredCount,
    availableVerifiedSupply: opts.availableVerifiedSupply,
    verifiedConfidences: opts.verifiedConfidences,
    minVerifiedFloor: floor,
  });
  const highConfidenceVerifiedCount = opts.verifiedConfidences.filter(
    (confidence) => confidence >= REPAIR_HIGH_CONFIDENCE_THRESHOLD,
  ).length;
  const averageVerifiedConfidence = opts.verifiedConfidences.length > 0
    ? opts.verifiedConfidences.reduce((acc, value) => acc + value, 0) / opts.verifiedConfidences.length
    : 0;
  const confidencePasses =
    partial.reason === "confidence_weighted_pass" ||
    partial.reason === "high_confidence_near_miss" ||
    (
      opts.confidenceQualifiedSupply >= floor &&
      opts.confidenceQualifiedSupply >= Math.min(opts.requiredCount, opts.availableVerifiedSupply)
    );
  const passes = opts.partialVerificationPasses || confidencePasses;
  const shouldPublish = opts.active && opts.verifiedCount >= floor && (
    passes ||
    opts.rejectedCount > 0 ||
    opts.publishedTrackCount < opts.requestedLength
  );
  let publishReason = "confidence_aware_below_threshold";
  if (partial.reason === "high_confidence_near_miss") {
    publishReason = "publish_confidence_aware_near_miss";
  } else if (partial.reason === "confidence_weighted_pass") {
    publishReason = "publish_confidence_aware_weighted";
  } else if (partial.reason === "partial_ratio_pass" || partial.reason === "meets_adaptive_required") {
    publishReason = "publish_confidence_aware_partial";
  } else if (partial.reason === "supply_exhausted") {
    publishReason = "publish_confidence_aware_supply";
  } else if (
    opts.confidenceQualifiedSupply >= floor &&
    opts.confidenceQualifiedSupply >= Math.min(opts.requiredCount, opts.availableVerifiedSupply)
  ) {
    publishReason = "publish_confidence_aware_supply";
  } else if (passes) {
    publishReason = "publish_confidence_aware_partial";
  } else if (shouldPublish) {
    publishReason = "publish_confidence_aware_repair";
  }
  return {
    shouldPublish,
    passes,
    publishReason,
    confidenceQualifiedSupply: opts.confidenceQualifiedSupply,
    confidenceWeightedScore: partial.confidenceWeightedScore,
    averageVerifiedConfidence,
    highConfidenceVerifiedCount,
    partialVerificationReason: partial.reason,
  };
}

export function shouldPublishConfidenceAwareOutput(
  assessment: ConfidenceAwarePublicationAssessment,
): boolean {
  return assessment.shouldPublish && assessment.passes;
}

export type ConfidenceAwarePublication<T extends GenreEvidenceTrack> = VerifiedV3OutputPublication<T> & {
  confidenceAware: true;
  assessment: ConfidenceAwarePublicationAssessment;
};

/**
 * Publish confidence-ranked verified V3 output when count/ratio gates are borderline.
 */
export function publishConfidenceAwarePlaylist<T extends GenreEvidenceTrack>(
  input: GenreAwareRepairInput<T>,
  assessment: ConfidenceAwarePublicationAssessment,
): ConfidenceAwarePublication<T> {
  const publication = publishVerifiedV3OutputPlaylist(input);
  const reason = publication.published ? assessment.publishReason : publication.reason;
  return {
    ...publication,
    reason,
    confidenceAware: true,
    assessment,
  };
}

export type VerifiedV3OutputPublication<T extends GenreEvidenceTrack> = {
  published: boolean;
  result: GenreAwareRepairResult<T>;
  reason: string;
};

/**
 * Publish playlist built from genre-verified V3 output (preserve verified prefix, fill from V3 order).
 */
export function publishVerifiedV3OutputPlaylist<T extends GenreEvidenceTrack>(
  input: GenreAwareRepairInput<T>,
): VerifiedV3OutputPublication<T> {
  const result = buildVerifiedV3OutputPlaylist(input);
  const reason = result.filledFromV3Count > 0
    ? result.supplyCapped
      ? "publish_verified_v3_output_supply_capped"
      : "publish_verified_v3_output"
    : result.tracks.length < input.requestedLength
      ? "publish_verified_v3_output_partial"
      : "publish_verified_v3_output";
  return { published: result.tracks.length > 0, result, reason };
}

export function assessRepairGenreEvidenceConfidence(
  track: GenreEvidenceTrack,
  opts: {
    subgenreMatch: boolean;
    taxonomyHit?: boolean;
    audioFallbackUsed?: boolean;
  },
): GenreEvidenceConfidence {
  return assessGenreEvidenceTier({
    subgenreMatch: opts.subgenreMatch,
    spotifyArtistGenres: track.spotifyArtistGenres,
    albumGenres: track.albumGenres,
    taxonomyHit: opts.taxonomyHit === true,
    audioFallbackUsed: opts.audioFallbackUsed === true,
  });
}

export type GenreEvidencePublicationAction =
  | "publish_repaired"
  | "publish_verified_partial"
  | "publish_confidence_aware"
  | "publish_honest_constrained"
  | "fallback_constrained"
  | "publish_degraded"
  | "block";

export type GenreEvidencePublicationDecision = {
  action: GenreEvidencePublicationAction;
  publishReason: string;
  /** Do not replace playlist with mergedConstrainedRecoveryPool */
  skipConstrainedPrefix: boolean;
  /** Do not strip genre leaks after a genre-aware repair publish */
  skipGenreLeakStrip: boolean;
  /** How many tracks to stream during partial publish updates */
  partialPublishLimit: number;
  /** Whether partial publish is an honest verified/supply-capped subset */
  honestPartialPublished: boolean;
  adaptivePartialPublishReason: string;
  confidenceAwarePublished: boolean;
  confidencePublicationReason: string | null;
};

/** Early streaming preview while generation is still running. */
export const PARTIAL_PUBLISH_STREAMING_PREVIEW_COUNT = 5;

export type AdaptivePartialPublishInput = {
  requestedLength: number;
  publishedTrackCount: number;
  verifiedCount: number;
  postRepairVerifiedCount?: number;
  availableVerifiedSupply?: number;
  repairTargetLength?: number;
  supplyCapped?: boolean;
  partialVerificationPasses?: boolean;
  minVerifiedFloor?: number;
};

export type AdaptivePartialPublishResult = {
  limit: number;
  honestPartial: boolean;
  reason:
    | "full_length"
    | "supply_ceiling"
    | "honest_thin_library"
    | "honest_verified_partial"
    | "repair_target"
    | "adaptive_default"
    | "empty";
};

/**
 * Caps streamed partial publish to verified supply — not a fixed 5-track prefix.
 * Thin-library prompts (e.g. 2–3 verified latin/tekk tracks) publish honestly.
 */
export function computeAdaptivePartialPublishLimit(
  opts: AdaptivePartialPublishInput,
): AdaptivePartialPublishResult {
  const floor = opts.minVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  const published = Math.max(0, opts.publishedTrackCount);
  const verified = Math.max(opts.postRepairVerifiedCount ?? opts.verifiedCount, 0);
  const supply = Math.max(opts.availableVerifiedSupply ?? verified, 0);
  const requested = Math.max(1, opts.requestedLength);

  if (published === 0) {
    return { limit: 0, honestPartial: false, reason: "empty" };
  }

  const repairTarget = opts.repairTargetLength ?? Math.min(requested, supply > 0 ? supply : requested);

  if (opts.supplyCapped === true && supply > 0 && supply < requested) {
    const limit = Math.min(published, Math.max(verified, repairTarget));
    return { limit, honestPartial: true, reason: "supply_ceiling" };
  }

  if (published >= requested && verified >= requested) {
    return { limit: published, honestPartial: false, reason: "full_length" };
  }

  if (published >= requested && opts.partialVerificationPasses === true && verified >= repairTarget) {
    return { limit: published, honestPartial: false, reason: "full_length" };
  }

  if (verified > 0 && verified < floor) {
    return { limit: Math.min(published, verified), honestPartial: true, reason: "honest_thin_library" };
  }

  if (verified >= floor && verified < requested) {
    return { limit: Math.min(published, verified), honestPartial: true, reason: "honest_verified_partial" };
  }

  if (repairTarget > 0 && repairTarget < published) {
    return {
      limit: Math.min(published, repairTarget),
      honestPartial: repairTarget < requested,
      reason: "repair_target",
    };
  }

  return {
    limit: Math.min(published, Math.max(verified, floor)),
    honestPartial: verified < requested,
    reason: "adaptive_default",
  };
}

export type HonestConstrainedPublishInput<T extends GenreEvidenceTrack> = {
  verifiedPrefix: T[];
  v3Tracks?: T[];
  recoveryPool: T[];
  requestedLength: number;
  availableVerifiedSupply: number;
  repairTargetLength?: number;
  supplyCapped?: boolean;
  partialVerificationPasses?: boolean;
  minimumVerifiedFloor?: number;
  isGenreVerified: (track: T) => boolean;
  passesHardConstraints: (track: T) => boolean;
};

export type HonestConstrainedPublishResult<T extends GenreEvidenceTrack> = {
  tracks: T[];
  verifiedPreservedCount: number;
  v3FillCount: number;
  recoveryFillCount: number;
  postRepairVerifiedCount: number;
  publishLimit: number;
  honestConstrained: boolean;
  reason:
    | "honest_constrained_verified_only"
    | "honest_constrained_verified_plus_v3"
    | "honest_constrained_verified_plus_recovery"
    | "honest_constrained_empty";
  usedBlindRecoveryReplacement: boolean;
};

/**
 * Publish verified prefix + V3 fills before blind recovery-pool replacement.
 * Preserves editorially verified tracks instead of swapping the whole playlist for a thin recovery pool.
 */
export function buildHonestConstrainedPlaylist<T extends GenreEvidenceTrack>(
  input: HonestConstrainedPublishInput<T>,
): HonestConstrainedPublishResult<T> {
  const floor = input.minimumVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  const verifiedPrefix = input.verifiedPrefix.filter(
    (track) => input.isGenreVerified(track) && input.passesHardConstraints(track),
  );
  const partial = computeAdaptivePartialPublishLimit({
    requestedLength: input.requestedLength,
    publishedTrackCount: input.requestedLength,
    verifiedCount: verifiedPrefix.length,
    availableVerifiedSupply: input.availableVerifiedSupply,
    repairTargetLength: input.repairTargetLength,
    supplyCapped: input.supplyCapped ?? input.availableVerifiedSupply < input.requestedLength,
    partialVerificationPasses: input.partialVerificationPasses,
  });
  const targetLength = Math.max(verifiedPrefix.length > 0 ? 1 : 0, partial.limit);
  const seen = new Set<string>();
  const tracks: T[] = [];

  const pushTrack = (track: T, requireGenreVerified: boolean): boolean => {
    if (tracks.length >= targetLength || seen.has(track.trackId)) return false;
    if (!input.passesHardConstraints(track)) return false;
    if (requireGenreVerified && !input.isGenreVerified(track)) return false;
    seen.add(track.trackId);
    tracks.push(track);
    return true;
  };

  for (const track of verifiedPrefix) {
    pushTrack(track, false);
  }

  let v3FillCount = 0;
  for (const track of input.v3Tracks ?? []) {
    if (tracks.length >= targetLength) break;
    if (pushTrack(track, true)) v3FillCount += 1;
  }

  let recoveryFillCount = 0;
  if (tracks.length < targetLength && verifiedPrefix.length < floor) {
    for (const track of input.recoveryPool) {
      if (tracks.length >= targetLength) break;
      if (pushTrack(track, true)) recoveryFillCount += 1;
    }
  }

  const postRepairVerifiedCount = tracks.filter(input.isGenreVerified).length;
  const reason = recoveryFillCount > 0
    ? "honest_constrained_verified_plus_recovery"
    : v3FillCount > 0
      ? "honest_constrained_verified_plus_v3"
      : verifiedPrefix.length > 0
        ? "honest_constrained_verified_only"
        : "honest_constrained_empty";

  return {
    tracks,
    verifiedPreservedCount: verifiedPrefix.length,
    v3FillCount,
    recoveryFillCount,
    postRepairVerifiedCount,
    publishLimit: Math.min(tracks.length, partial.limit),
    honestConstrained: tracks.length > 0,
    reason,
    usedBlindRecoveryReplacement: false,
  };
}

export function shouldPreferHonestConstrainedPublish(opts: {
  verifiedCount: number;
  minimumVerifiedFloor?: number;
  partialVerificationPasses?: boolean;
}): boolean {
  const floor = opts.minimumVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  return opts.verifiedCount > 0 && (opts.verifiedCount >= floor || opts.partialVerificationPasses === true);
}

export function shouldUseBlindConstrainedReplacement(opts: {
  verifiedCount: number;
  honestConstrainedDelivered: number;
  recoveryPoolSize: number;
  minimumVerifiedFloor?: number;
}): boolean {
  const floor = opts.minimumVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  return (
    opts.honestConstrainedDelivered < 1 &&
    opts.recoveryPoolSize > 0 &&
    opts.verifiedCount < floor &&
    opts.verifiedCount === 0
  );
}

export type HonestConstrainedPublication<T extends GenreEvidenceTrack> = {
  published: boolean;
  result: HonestConstrainedPublishResult<T>;
};

export function publishHonestConstrainedPlaylist<T extends GenreEvidenceTrack>(
  input: HonestConstrainedPublishInput<T>,
): HonestConstrainedPublication<T> {
  const result = buildHonestConstrainedPlaylist(input);
  return { published: result.honestConstrained, result };
}

function resolveAdaptivePartialPublishLimit(opts: {
  requestedLength: number;
  publishedTrackCount: number;
  verifiedCount: number;
  postRepairVerifiedCount: number;
  availableVerifiedSupply?: number;
  repairTargetLength?: number;
  supplyCapped?: boolean;
  partialVerificationPasses?: boolean;
  minVerifiedFloor?: number;
}): AdaptivePartialPublishResult {
  return computeAdaptivePartialPublishLimit({
    requestedLength: opts.requestedLength,
    publishedTrackCount: opts.publishedTrackCount,
    verifiedCount: opts.verifiedCount,
    postRepairVerifiedCount: opts.postRepairVerifiedCount,
    availableVerifiedSupply: opts.availableVerifiedSupply,
    repairTargetLength: opts.repairTargetLength,
    supplyCapped: opts.supplyCapped,
    partialVerificationPasses: opts.partialVerificationPasses,
    minVerifiedFloor: opts.minVerifiedFloor,
  });
}

/**
 * Central publication policy after genre evidence guard + optional V3 repair.
 */
export function resolveGenreEvidencePublication(opts: {
  active: boolean;
  repairedFromV3: boolean;
  postRepairPartialPasses: boolean;
  initialPartialPasses: boolean;
  verifiedCount: number;
  postRepairVerifiedCount: number;
  publishedTrackCount: number;
  requestedLength: number;
  availableVerifiedSupply?: number;
  confidenceQualifiedSupply?: number;
  confidenceAwarePasses?: boolean;
  confidencePublicationReason?: string | null;
  repairTargetLength?: number;
  supplyCapped?: boolean;
  minVerifiedFloor?: number;
}): GenreEvidencePublicationDecision {
  const floor = opts.minVerifiedFloor ?? MIN_GENRE_EVIDENCE_VERIFIED_FLOOR;
  const alignedSupply = resolveEffectiveGenreVerifiedSupply({
    confidenceQualifiedSupply: opts.confidenceQualifiedSupply ?? 0,
    v3VerifiedSupply: opts.availableVerifiedSupply ?? 0,
    verifiedCount: opts.verifiedCount,
    postRepairVerifiedCount: opts.postRepairVerifiedCount,
  });
  const partialPublish = resolveAdaptivePartialPublishLimit({
    requestedLength: opts.requestedLength,
    publishedTrackCount: opts.publishedTrackCount,
    verifiedCount: opts.verifiedCount,
    postRepairVerifiedCount: opts.postRepairVerifiedCount,
    availableVerifiedSupply: alignedSupply,
    repairTargetLength: opts.repairTargetLength,
    supplyCapped: opts.supplyCapped,
    partialVerificationPasses: opts.postRepairPartialPasses || opts.initialPartialPasses || opts.confidenceAwarePasses === true,
    minVerifiedFloor: floor,
  });
  const withPartialLimit = (
    decision: Omit<
      GenreEvidencePublicationDecision,
      | "partialPublishLimit"
      | "honestPartialPublished"
      | "adaptivePartialPublishReason"
      | "confidenceAwarePublished"
      | "confidencePublicationReason"
    >,
    confidencePublicationReason?: string | null,
  ): GenreEvidencePublicationDecision => ({
    ...decision,
    partialPublishLimit: partialPublish.limit,
    honestPartialPublished: partialPublish.honestPartial,
    adaptivePartialPublishReason: partialPublish.reason,
    confidenceAwarePublished: confidencePublicationReason != null,
    confidencePublicationReason: confidencePublicationReason ?? null,
  });
  if (!opts.active) {
    return withPartialLimit({
      action: "publish_repaired",
      publishReason: "genre_evidence_inactive",
      skipConstrainedPrefix: true,
      skipGenreLeakStrip: false,
    });
  }
  if (opts.repairedFromV3) {
    return withPartialLimit({
      action: opts.confidenceAwarePasses ? "publish_confidence_aware" : "publish_repaired",
      publishReason: opts.confidencePublicationReason ?? "genre_evidence_repaired_v3_published",
      skipConstrainedPrefix: true,
      skipGenreLeakStrip: true,
    }, opts.confidencePublicationReason);
  }
  if (opts.confidenceAwarePasses && !opts.postRepairPartialPasses && !opts.initialPartialPasses) {
    return withPartialLimit({
      action: "publish_confidence_aware",
      publishReason: opts.confidencePublicationReason ?? "publish_confidence_aware",
      skipConstrainedPrefix: true,
      skipGenreLeakStrip: true,
    }, opts.confidencePublicationReason);
  }
  if (opts.postRepairPartialPasses || opts.initialPartialPasses) {
    return withPartialLimit({
      action: opts.publishedTrackCount < opts.requestedLength
        ? "publish_verified_partial"
        : opts.confidenceAwarePasses ? "publish_confidence_aware" : "publish_repaired",
      publishReason: opts.confidencePublicationReason ?? "publish_verified_v3_output",
      skipConstrainedPrefix: true,
      skipGenreLeakStrip: true,
    }, opts.confidencePublicationReason);
  }
  if (opts.verifiedCount >= floor) {
    return withPartialLimit({
      action: "publish_honest_constrained",
      publishReason: "genre_evidence_honest_constrained_verified",
      skipConstrainedPrefix: true,
      skipGenreLeakStrip: false,
    });
  }
  return withPartialLimit({
    action: "fallback_constrained",
    publishReason: "genre_evidence_insufficient_verified",
    skipConstrainedPrefix: false,
    skipGenreLeakStrip: false,
  });
}

export function countGenreVerifiedTracks<T extends GenreEvidenceTrack>(
  tracks: T[],
  isGenreVerified: (track: T) => boolean,
): number {
  return tracks.filter(isGenreVerified).length;
}
