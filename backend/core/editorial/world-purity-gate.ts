/**
 * V15 world purity gate — full-playlist immersion after thesis opener.
 * Position-tiered thresholds, shorten-not-corrupt first five, honest partial with coverage caps.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAvoidArtist, rosterTierScoreFloor } from "./cultural-identity-profile";
import type { CoverageLevel, CoverageTier } from "./world-coverage";
import {
  buildDeliveryMessage,
  coverageLevelToMaxTracks,
  coverageUserMessage,
  getDeliveryCap,
  coverageLevelToDeliveryTier,
} from "./world-coverage";
import { recordRetrievalRejection } from "./retrieval-rejection-trace";
import {
  decomposeTrackWorldIdentity,
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
  type WorldIdentityEvidenceTier,
} from "./world-identity-score";
import {
  isAtmosphericLexicalHack,
  isAtmosphericWorld,
  resolveAtmosphericContext,
  scoreAtmosphericContextFit,
} from "./atmospheric-context-scoring";
import { sequenceAfterPurityFilter } from "./world-sequencer";
import { selectThesisOpener } from "./thesis-opener-gate";
import { replaceCheckpointFailures } from "./checkpoint-backfill";
import {
  mergeDeliverableCandidatePools,
  rankDeliverableCandidates,
  refillDeliverableDepth,
  type DeliverableDepthRefillDiagnostics,
} from "./deliverable-depth-refill";

/** Checkpoint indices (0-based): tracks 1, 2, 5, 10, 15 */
export const WORLD_PURITY_CHECKPOINT_INDICES = [0, 1, 4, 9, 14] as const;

/** Audit-only sub-stage counts observed inside applyWorldPurityGate (no extra purity pass). */
export type PurityCheckpointDecision = {
  checkpointSurvivorIndex: number;
  compositionPosition: number;
  artist: string;
  track: string;
  score: number;
  threshold: number;
  passed: boolean;
};

export type PuritySubFunnelDiagnostics = {
  prePurityCount: number;
  postFilterByWorldPurityCount: number;
  postDeliverableDepthRefillCount: number;
  deliverableDepthRefill: DeliverableDepthRefillDiagnostics | null;
  postCheckpointBackfillCount: number;
  checkpointBackfillReplacements: number;
  postCheckpointStripCount: number;
  checkpointStripApplied: boolean;
  removedReasons: string[];
  checkpointDecisions: PurityCheckpointDecision[];
  checkpointRemovedReasons: string[];
};

export type WorldPurityResult = {
  tracks: WorldIdentityTrack[];
  removed: number;
  removedReasons: string[];
  checkpointFailures: string[];
  wouldStillBelieve: boolean;
  honestPartial: boolean;
  coverageMessage: string | null;
  deliveryMessage: string | null;
  salvageableCount: number;
  /** Populated on every applyWorldPurityGate call — diagnostic only. */
  subFunnel: PuritySubFunnelDiagnostics;
};

function identitySubFunnel(tracks: WorldIdentityTrack[], removedReasons: string[] = []): PuritySubFunnelDiagnostics {
  const count = tracks.length;
  return {
    prePurityCount: count,
    postFilterByWorldPurityCount: count,
    postDeliverableDepthRefillCount: count,
    deliverableDepthRefill: null,
    postCheckpointBackfillCount: count,
    checkpointBackfillReplacements: 0,
    postCheckpointStripCount: count,
    checkpointStripApplied: false,
    removedReasons,
    checkpointDecisions: [],
    checkpointRemovedReasons: [],
  };
}

/** V15 position-tier purity threshold (0–100): T1 95+, T2-3 90+, T4-5 85+, T6-10 85+, T11+ 80+. */
export function worldPurityThresholdForPosition(position: number): number {
  if (position === 0) return 95;
  if (position <= 2) return 90;
  if (position <= 4) return 85;
  if (position <= 9) return 85;
  return 80;
}

/** Evidence-aligned purity threshold — instrumentation members pass at score ceiling, not position-tier cliff. */
export function evidenceAlignedPurityThreshold(
  evidenceTier: WorldIdentityEvidenceTier,
  compositionPosition: number,
  scorePercent: number,
  positionThreshold: number,
): number {
  if (evidenceTier !== "instrumentation_token") return positionThreshold;
  if (compositionPosition <= 2) return positionThreshold;
  const evidenceCeiling = Math.max(58, Math.min(62, scorePercent));
  return Math.min(positionThreshold, evidenceCeiling);
}

/** Estimate purity survival for hard-lock compose depth scaling. */
export function estimatePuritySurvivalRate(
  tracks: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  sampleSize = 40,
): number {
  if (tracks.length === 0) return 0.4;
  const sample = tracks.slice(0, Math.min(sampleSize, tracks.length));
  let passed = 0;
  for (let i = 0; i < sample.length; i++) {
    if (trackPassesWorldPurity(sample[i]!, profile, i % 25)) passed += 1;
  }
  return Math.max(0.25, passed / sample.length);
}

/** Scale V3 compose depth when hard-lock purity will thin the composed set. */
export function purityAwareComposeTarget(
  requestedLength: number,
  opts: {
    hardLock?: boolean;
    candidatePoolSize?: number;
    sampleTracks?: WorldIdentityTrack[];
    profile?: CulturalWorldProfile | null;
  },
): number {
  if (!opts.hardLock || !opts.profile) return requestedLength;
  const poolCap = Math.min(
    Math.max(opts.candidatePoolSize ?? 0, requestedLength),
    isAtmosphericWorld(opts.profile?.worldId) ? 95 : 75,
  );
  const sampleRetention = opts.sampleTracks?.length
    ? estimatePuritySurvivalRate(opts.sampleTracks, opts.profile)
    : null;
  const atmospheric = isAtmosphericWorld(opts.profile?.worldId);
  // Sample can overstate survival after calibration — plan with conservative retention.
  const planningRetention = sampleRetention != null
    ? Math.min(sampleRetention, atmospheric ? 0.26 : 0.42)
    : atmospheric ? 0.26 : 0.35;
  const depthNeeded = Math.max(
    Math.ceil(requestedLength / planningRetention),
    Math.ceil(requestedLength * (atmospheric ? 2.1 : 1.65)),
  );
  return Math.min(poolCap, Math.max(requestedLength, depthNeeded));
}

/** Position tier with roster floor — roster-qualified artists pass at their roster score, not arbitrary metadata tiers. */
export function effectivePurityThresholdForTrack(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  compositionPosition: number,
  opts?: { isThesisOpener?: boolean },
): number {
  const artist = String(track.artistName ?? "").trim();
  const isAnchor = artist ? isAnchorArtistForProfile(artist, profile) : false;
  const decomp = decomposeTrackWorldIdentity(track, profile);
  const scorePercent = Math.round(decomp.score * 100);

  if (compositionPosition === 0 && (opts?.isThesisOpener || isAnchor)) {
    return Math.round((profile.openerRules.minWorldIdentityScore ?? 0.8) * 100);
  }

  const positionThreshold = worldPurityThresholdForPosition(compositionPosition);
  if (!artist) {
    return evidenceAlignedPurityThreshold(
      decomp.evidenceTier,
      compositionPosition,
      scorePercent,
      positionThreshold,
    );
  }

  const rosterFloor = rosterTierScoreFloor(artist, profile);
  if (rosterFloor != null) return Math.min(positionThreshold, Math.round(rosterFloor * 100));

  return evidenceAlignedPurityThreshold(
    decomp.evidenceTier,
    compositionPosition,
    scorePercent,
    positionThreshold,
  );
}

/** World identity score scaled 0–100; blends atmospheric sonic fit for mood worlds. */
export function scoreTrackPurityPercent(track: WorldIdentityTrack, profile: CulturalWorldProfile): number {
  const identity = scoreTrackWorldIdentity(track, profile);
  const context = resolveAtmosphericContext(profile.worldId);
  if (!context) return Math.round(identity * 100);

  const atmosphericTrack = {
    trackName: track.trackName,
    artistName: track.artistName,
    energy: track.energy ?? null,
    valence: track.valence ?? null,
    danceability: track.danceability ?? null,
    acousticness: (track as { acousticness?: number | null }).acousticness ?? null,
    instrumentalness: track.instrumentalness ?? null,
    speechiness: (track as { speechiness?: number | null }).speechiness ?? null,
    genreFamily: track.genreFamily ?? null,
    genrePrimary: track.genrePrimary ?? null,
  };
  if (isAtmosphericLexicalHack(atmosphericTrack, context)) return 0;
  const atmospheric = scoreAtmosphericContextFit(atmosphericTrack, context);
  const decomp = decomposeTrackWorldIdentity(track, profile);
  const weakEvidence =
    decomp.evidenceTier === "weak" ||
    decomp.evidenceTier === "era_energy" ||
    decomp.evidenceTier === "instrumentation_token";
  if (weakEvidence) {
    if (atmospheric + 0.08 < identity) {
      return Math.round(Math.min(identity, atmospheric + 0.1) * 100);
    }
    return Math.round(identity * 100);
  }
  const blended = identity * 0.55 + atmospheric * 0.45;
  return Math.round(blended * 100);
}

export function trackPassesWorldPurity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  position: number,
  opts?: { isThesisOpener?: boolean },
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (artist && matchesAvoidArtist(artist, profile)) return false;

  const score = scoreTrackPurityPercent(track, profile);
  const threshold = effectivePurityThresholdForTrack(track, profile, position, opts);
  return score >= threshold;
}

/** Human listener simulation — curator belief at checkpoints. */
export function evaluateCheckpointDecisions(
  tracks: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  compositionPositions?: readonly number[],
): PurityCheckpointDecision[] {
  const decisions: PurityCheckpointDecision[] = [];
  for (const idx of WORLD_PURITY_CHECKPOINT_INDICES) {
    if (idx >= tracks.length) continue;
    const track = tracks[idx]!;
    const compositionPosition = compositionPositions?.[idx] ?? idx;
    const score = scoreTrackPurityPercent(track, profile);
    const isThesis = compositionPosition === 0;
    const isAnchor = isAnchorArtistForProfile(track.artistName, profile);
    const threshold = effectivePurityThresholdForTrack(track, profile, compositionPosition, {
      isThesisOpener: isThesis && isAnchor,
    });
    const passed = !(
      String(track.artistName ?? "").trim() &&
      matchesAvoidArtist(String(track.artistName ?? ""), profile)
    ) && score >= threshold;
    decisions.push({
      checkpointSurvivorIndex: idx,
      compositionPosition,
      artist: String(track.artistName ?? "?"),
      track: String(track.trackName ?? "?"),
      score,
      threshold,
      passed,
    });
  }
  return decisions;
}

export function wouldStillBelieveSameCurator(
  prompt: string,
  tracks: WorldIdentityTrack[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
  compositionPositions?: readonly number[],
): { believe: boolean; failures: string[] } {
  void prompt;
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return { believe: true, failures: [] };
  }
  const decisions = evaluateCheckpointDecisions(tracks, profile, compositionPositions);
  const failures = decisions
    .filter((d) => !d.passed)
    .map(
      (d) =>
        `checkpoint_${d.checkpointSurvivorIndex + 1}:${d.artist} — ${d.track}:${d.score}<${d.threshold}@pos_${d.compositionPosition + 1}`,
    );
  return { believe: failures.length === 0, failures };
}

/** Remove tracks failing position-tier purity — no backfill, shorten-not-corrupt. */
export function filterByWorldPurity<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
): {
  tracks: T[];
  removed: number;
  removedReasons: string[];
  survivorCompositionPositions: number[];
} {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
  }
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
  }

  const thesis = selectThesisOpener(tracks, profile);
  const thesisKey = thesis ? `${thesis.track.artistName}|${thesis.track.trackName}` : null;

  const kept: T[] = [];
  const survivorCompositionPositions: number[] = [];
  const removedReasons: string[] = [];
  let removed = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const trackKey = `${track.artistName}|${track.trackName}`;
    const isThesisOpener = i === 0 || (thesisKey != null && trackKey === thesisKey);
    if (trackPassesWorldPurity(track, profile, i, { isThesisOpener })) {
      kept.push(track);
      survivorCompositionPositions.push(i);
    } else {
      removed += 1;
      const score = scoreTrackPurityPercent(track, profile);
      const threshold = effectivePurityThresholdForTrack(track, profile, i, { isThesisOpener });
      const worldId = committed.worldIds?.[0] ?? committed.id;
      recordRetrievalRejection({
        worldId,
        artistName: track.artistName ?? "",
        trackName: track.trackName ?? "",
        reason: `purity_pos_${i + 1}:${score}<${threshold}`,
        stage: "purity_gate",
        worldIdentityScore: score / 100,
      });
      removedReasons.push(
        `pos_${i + 1}:${track.artistName ?? "?"} — ${track.trackName ?? "?"}:${score}<${threshold}`,
      );
    }
  }

  if (kept.length > 0 || removed === 0) {
    return { tracks: kept, removed, removedReasons, survivorCompositionPositions };
  }
  return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
}

/** Checkpoints that guard opening/first-five belief — tail failures should not truncate honest partials. */
const EARLY_BELIEF_CHECKPOINT_INDICES = new Set<number>([0, 1, 4]);

/** Strip from first failing early checkpoint forward when belief breaks. */
export function stripFromCheckpointFailure<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
  compositionPositions?: readonly number[],
): {
  tracks: T[];
  stripped: number;
  failures: string[];
  checkpointDecisions: PurityCheckpointDecision[];
  checkpointRemovedReasons: string[];
} {
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return {
      tracks,
      stripped: 0,
      failures: [],
      checkpointDecisions: [],
      checkpointRemovedReasons: [],
    };
  }
  const checkpointDecisions = evaluateCheckpointDecisions(tracks, profile, compositionPositions);
  const belief = wouldStillBelieveSameCurator("", tracks, committed, profile, compositionPositions);
  if (belief.believe) {
    return {
      tracks,
      stripped: 0,
      failures: [],
      checkpointDecisions,
      checkpointRemovedReasons: [],
    };
  }

  let cutIndex = tracks.length;
  for (const decision of checkpointDecisions) {
    if (!decision.passed && EARLY_BELIEF_CHECKPOINT_INDICES.has(decision.checkpointSurvivorIndex)) {
      cutIndex = Math.min(cutIndex, decision.checkpointSurvivorIndex);
      break;
    }
  }
  const checkpointRemovedReasons = checkpointDecisions
    .filter((d) => !d.passed)
    .map(
      (d) =>
        `checkpoint_${d.checkpointSurvivorIndex + 1}:${d.artist} — ${d.track}:${d.score}<${d.threshold}@pos_${d.compositionPosition + 1}`,
    );

  if (cutIndex >= tracks.length) {
    return { tracks, stripped: 0, failures: belief.failures, checkpointDecisions, checkpointRemovedReasons };
  }
  const kept = tracks.slice(0, cutIndex);
  if (kept.length >= 3) {
    return {
      tracks: kept,
      stripped: tracks.length - kept.length,
      failures: belief.failures,
      checkpointDecisions,
      checkpointRemovedReasons,
    };
  }
  if (kept.length > 0) {
    return {
      tracks: kept,
      stripped: tracks.length - kept.length,
      failures: belief.failures,
      checkpointDecisions,
      checkpointRemovedReasons,
    };
  }
  return { tracks, stripped: 0, failures: belief.failures, checkpointDecisions, checkpointRemovedReasons };
}

/** V15 final pass — purity filter, checkpoint strip, sequence, honest partial cap. */
export function applyWorldPurityGate<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  opts?: {
    prompt?: string;
    requestedLength?: number;
    coverageLevel?: CoverageLevel | null;
    coverageTier?: CoverageTier | null;
    preserveOpener?: boolean;
    /** Candidates eligible for checkpoint replace-not-truncate (defaults to input tracks). */
    replacementPool?: WorldIdentityTrack[];
    /** Genre evidence gate for hard-lock explicit genre refill paths. */
    isGenreVerified?: (track: T) => boolean;
    enrichTrack?: (track: T) => T;
  },
): WorldPurityResult & { tracks: T[] } {
  const requested = Math.max(1, opts?.requestedLength ?? 25);
  const coverageLevel = opts?.coverageLevel ?? null;
  const coverageTier =
    opts?.coverageTier ?? (coverageLevel != null ? coverageLevelToDeliveryTier(coverageLevel) : null);

  const prePurityCount = tracks.length;

  if (!committed?.hardLock || tracks.length === 0) {
    return {
      tracks,
      removed: 0,
      removedReasons: [],
      checkpointFailures: [],
      wouldStillBelieve: true,
      honestPartial: false,
      coverageMessage: null,
      deliveryMessage: null,
      salvageableCount: tracks.length,
      subFunnel: identitySubFunnel(tracks),
    };
  }

  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return {
      tracks,
      removed: 0,
      removedReasons: [],
      checkpointFailures: [],
      wouldStillBelieve: true,
      honestPartial: false,
      coverageMessage: null,
      deliveryMessage: null,
      salvageableCount: tracks.length,
      subFunnel: identitySubFunnel(tracks),
    };
  }

  const opener = opts?.preserveOpener && tracks.length > 0 ? tracks[0] : null;
  let working = [...tracks];
  const filtered = filterByWorldPurity(working, committed);
  if (filtered.removed > 0 && filtered.tracks.length > 0) {
    working = filtered.tracks;
  } else if (filtered.removed > 0 && filtered.tracks.length === 0 && tracks.length > 0) {
    const thesis = selectThesisOpener(tracks, profile);
    if (thesis) {
      const rest = tracks.filter(
        (t) =>
          `${t.artistName}|${t.trackName}` !== `${thesis.track.artistName}|${thesis.track.trackName}`,
      );
      const salvage = [thesis.track, ...rest].filter((t, i) =>
        trackPassesWorldPurity(t, profile, i, { isThesisOpener: i === 0 }),
      );
      if (salvage.length > 0) working = salvage as T[];
    }
  }

  const postFilterByWorldPurityCount = working.length;

  const REPLACEMENT_POOL_CAP = 384;
  const rawReplacementPool = mergeDeliverableCandidatePools(
    tracks,
    opts?.replacementPool ?? tracks,
  );
  const replacementPool = rawReplacementPool.length > REPLACEMENT_POOL_CAP
    ? rankDeliverableCandidates(rawReplacementPool, profile, {
      isGenreVerified: opts?.isGenreVerified as ((track: WorldIdentityTrack) => boolean) | undefined,
    }).slice(0, REPLACEMENT_POOL_CAP)
    : rawReplacementPool;

  let deliverableDepthRefill: DeliverableDepthRefillDiagnostics | null = null;
  if (working.length < requested && replacementPool.length > working.length) {
    const refilled = refillDeliverableDepth(working, replacementPool as T[], {
      prompt: opts?.prompt,
      requestedLength: requested,
      committed,
      profile,
      preserveOpener: opts?.preserveOpener,
      isGenreVerified: opts?.isGenreVerified,
      enrichTrack: opts?.enrichTrack,
      maxPoolSize: REPLACEMENT_POOL_CAP,
    });
    deliverableDepthRefill = refilled.diagnostics;
    if (refilled.tracks.length > working.length) {
      working = refilled.tracks;
    }
  }
  const postDeliverableDepthRefillCount = working.length;
  const backfill = replaceCheckpointFailures(
    working,
    replacementPool as T[],
    committed,
    profile,
    {
      prompt: opts?.prompt,
      compositionPositions: filtered.survivorCompositionPositions,
    },
  );
  if (backfill.replacements > 0) {
    working = backfill.tracks;
  }
  const postCheckpointBackfillCount = working.length;

  const stripped = stripFromCheckpointFailure(
    working,
    committed,
    profile,
    filtered.survivorCompositionPositions,
  );
  const checkpointStripApplied = stripped.stripped > 0 && stripped.tracks.length > 0;
  if (checkpointStripApplied) {
    working = stripped.tracks;
  }
  const postCheckpointStripCount = working.length;

  if (working.length < requested && replacementPool.length > working.length) {
    const postStripRefill = refillDeliverableDepth(working, replacementPool as T[], {
      prompt: opts?.prompt,
      requestedLength: requested,
      committed,
      profile,
      preserveOpener: opts?.preserveOpener,
      isGenreVerified: opts?.isGenreVerified,
      enrichTrack: opts?.enrichTrack,
      maxPoolSize: REPLACEMENT_POOL_CAP,
    });
    if (postStripRefill.diagnostics.refilledCount > 0) {
      deliverableDepthRefill = {
        ...(deliverableDepthRefill ?? postStripRefill.diagnostics),
        refilledCount: (deliverableDepthRefill?.refilledCount ?? 0) + postStripRefill.diagnostics.refilledCount,
        outputCount: postStripRefill.diagnostics.outputCount,
        tailAppends: (deliverableDepthRefill?.tailAppends ?? 0) + postStripRefill.diagnostics.tailAppends,
        positionReplacements: (deliverableDepthRefill?.positionReplacements ?? 0) + postStripRefill.diagnostics.positionReplacements,
      };
      working = postStripRefill.tracks;
    }
  }

  const belief = wouldStillBelieveSameCurator(
    opts?.prompt ?? "",
    working,
    committed,
    profile,
    filtered.survivorCompositionPositions.slice(0, working.length),
  );

  if (opener && working.length > 0 && working[0] !== opener) {
    const rest = working.filter((t) => t !== opener);
    working = [opener, ...rest] as T[];
  }

  const sequenced = sequenceAfterPurityFilter(working, committed, profile) as T[];
  working = sequenced;

  const coverageCap =
    coverageTier != null
      ? getDeliveryCap(coverageTier, requested)
      : coverageLevel != null
        ? coverageLevelToMaxTracks(coverageLevel, requested)
        : requested;
  const honestPartial = working.length < requested;
  let salvageableCount = working.length;
  if (working.length > coverageCap && coverageCap > 0) {
    salvageableCount = coverageCap;
    working = working.slice(0, coverageCap);
  }

  const deliveryMessage =
    honestPartial && working.length > 0
      ? buildDeliveryMessage(working.length, coverageTier)
      : null;
  const coverageMessage =
    deliveryMessage ??
    (honestPartial && coverageLevel
      ? coverageUserMessage(coverageLevel)
      : honestPartial
        ? `Found ${working.length} track${working.length === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`
        : null);

  return {
    tracks: working,
    removed: filtered.removed + stripped.stripped,
    removedReasons: [...filtered.removedReasons],
    checkpointFailures: belief.failures,
    wouldStillBelieve: belief.believe,
    honestPartial,
    coverageMessage,
    deliveryMessage,
    salvageableCount: Math.max(salvageableCount, working.length > 0 ? working.length : 0),
    subFunnel: {
      prePurityCount,
      postFilterByWorldPurityCount,
      postDeliverableDepthRefillCount,
      deliverableDepthRefill,
      postCheckpointBackfillCount,
      checkpointBackfillReplacements: backfill.replacements,
      postCheckpointStripCount,
      checkpointStripApplied,
      removedReasons: [...filtered.removedReasons],
      checkpointDecisions: stripped.checkpointDecisions,
      checkpointRemovedReasons: stripped.checkpointRemovedReasons,
    },
  };
}
