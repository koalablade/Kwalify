/**
 * V41 ? Coverage-preserving candidate selection and marginal-gain playlist assembly.
 * V43 ? Compound-intent scoring so single-axis candidates cannot outrank musical-moment fits.
 */

import type { ContractCompositionMeta, ContractCompositionTrack } from "./contract-composition-types";
import { getContractCompositionMeta, requiredContractDimensions } from "./contract-composition-types";
import type { PlaylistContract } from "./types";
import { CONTRACT_AXIS_ACTIVATION_THRESHOLD, intersectionThreshold } from "./contract-axis-scoring";
import { compoundIntersectionStrength } from "./contract-semantic-moment";
import { passesCompoundRetrievalEligibility } from "./contract-compound-eligibility";

export type ContractCoverageSelectionDiagnostics = {
  inputCount: number;
  outputCount: number;
  requiredDimensions: string[];
  dimensionCoverage: Record<string, number>;
  intersectionCandidates: number;
  selectionPhases: string[];
};

const MAX_PER_ARTIST = 4;

function artistKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().trim();
}

function dimensionCoverageCount<T extends ContractCompositionTrack>(
  tracks: T[],
  dimension: string,
): number {
  return tracks.filter((t) => {
    const m = getContractCompositionMeta(t);
    return (m?.axisScores[dimension] ?? 0) >= 0.42;
  }).length;
}

/** V43 ? penalty when one tension axis is strong but its partner is inactive. */
export function singleAxisDominancePenalty(
  meta: ContractCompositionMeta,
  contract: PlaylistContract,
): number {
  let penalty = 0;
  for (const tension of contract.tension) {
    if (tension.resolution !== "preserve_both") continue;
    const a = meta.axisScores[tension.axes[0]] ?? 0;
    const b = meta.axisScores[tension.axes[1]] ?? 0;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    if (hi >= 0.5 && lo < CONTRACT_AXIS_ACTIVATION_THRESHOLD) {
      penalty += (hi - lo) * (hi - 0.4) * 0.38;
    }
  }
  return penalty;
}

/** V43 ? compound musical-moment score from tension axis geometry (not single-axis max). */
export function computeCompoundIntentScore(
  meta: ContractCompositionMeta | undefined,
  contract: PlaylistContract,
): number {
  if (!meta) return 0;
  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  if (preserveBoth.length === 0) {
    return meta.contractScore;
  }

  let bestCompound = 0;
  for (const tension of preserveBoth) {
    const a = meta.axisScores[tension.axes[0]] ?? 0;
    const b = meta.axisScores[tension.axes[1]] ?? 0;
    bestCompound = Math.max(bestCompound, compoundIntersectionStrength(a, b));
  }

  let score =
    bestCompound * 0.58 +
    meta.intersectionStrength * 0.32 +
    meta.contractScore * 0.1;
  score -= singleAxisDominancePenalty(meta, contract);
  return Math.max(0, score);
}

function compareCompoundIntent(
  a: ContractCompositionTrack,
  b: ContractCompositionTrack,
  contract: PlaylistContract,
): number {
  return (
    computeCompoundIntentScore(getContractCompositionMeta(b), contract) -
    computeCompoundIntentScore(getContractCompositionMeta(a), contract)
  );
}

/** Marginal value of adding candidate given current playlist coverage. */
export function marginalContractValue(
  meta: ContractCompositionMeta | undefined,
  contract: PlaylistContract,
  coveredDimensions: Map<string, number>,
  playlistSize: number,
): number {
  if (!meta || !meta.admissible) return -1;

  const compound = computeCompoundIntentScore(meta, contract);
  let value = compound * 0.68;
  const required = requiredContractDimensions(contract);
  for (const dim of required) {
    const score = meta.axisScores[dim] ?? 0;
    if (score < 0.35) continue;
    const current = coveredDimensions.get(dim) ?? 0;
    const target = Math.max(2, Math.ceil(playlistSize * 0.15));
    const coverageWeight = Math.min(score, compound + 0.15);
    if (current < target) {
      value += (1 - current / target) * coverageWeight * 0.32;
    } else {
      value += coverageWeight * 0.04;
    }
  }
  if (meta.intersectionStrength > 0.35) {
    const intKey = "__intersection";
    const intCount = coveredDimensions.get(intKey) ?? 0;
    const intTarget = Math.max(3, Math.ceil(playlistSize * 0.2));
    if (intCount < intTarget) value += meta.intersectionStrength * 0.48;
  }
  return value;
}

export function selectContractCoveragePreservingPool<T extends ContractCompositionTrack & {
  trackId: string;
  artistName?: string | null;
}>(
  tracks: T[],
  contract: PlaylistContract,
  limit: number,
): { tracks: T[]; diagnostics: ContractCoverageSelectionDiagnostics } {
  const required = requiredContractDimensions(contract);
  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  const phases: string[] = [];
  const admissible = tracks.filter((t) => getContractCompositionMeta(t)?.admissible !== false);
  const inputCount = tracks.length;

  if (required.length <= 1 || preserveBoth.length === 0) {
    const ranked = [...admissible].sort(
      (a, b) => (getContractCompositionMeta(b)?.contractScore ?? 0) - (getContractCompositionMeta(a)?.contractScore ?? 0),
    );
    phases.push("single_dimension_rank");
    return {
      tracks: pickWithArtistCap(ranked, limit),
      diagnostics: buildDiagnostics(inputCount, limit, required, pickWithArtistCap(ranked, limit), phases),
    };
  }

  const seen = new Set<string>();
  const out: T[] = [];
  const artistCounts = new Map<string, number>();

  const tryAdd = (track: T): boolean => {
    if (seen.has(track.trackId)) return false;
    const artist = artistKey(track.artistName);
    if (artist && (artistCounts.get(artist) ?? 0) >= MAX_PER_ARTIST) return false;
    seen.add(track.trackId);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    out.push(track);
    return true;
  };

  const byIntersection = [...admissible]
    .filter((t) => (getContractCompositionMeta(t)?.intersectionStrength ?? 0) >= intersectionThreshold(preserveBoth[0]!))
    .sort((a, b) => compareCompoundIntent(a, b, contract));
  const intersectionQuota = Math.min(Math.floor(limit * 0.28), byIntersection.length);
  for (const track of byIntersection.slice(0, intersectionQuota)) {
    tryAdd(track);
  }
  phases.push(`intersection:${intersectionQuota}`);

  for (const dim of required) {
    if (out.length >= limit) break;
    const dimRanked = [...admissible]
      .filter((t) => (getContractCompositionMeta(t)?.axisScores[dim] ?? 0) >= 0.42)
      .sort((a, b) => compareCompoundIntent(a, b, contract));
    const dimQuota = Math.min(Math.floor(limit * 0.22), dimRanked.length);
    let added = 0;
    for (const track of dimRanked) {
      if (added >= dimQuota || out.length >= limit) break;
      if (tryAdd(track)) added += 1;
    }
    phases.push(`axis:${dim}:${added}`);
  }

  const ranked = [...admissible].sort((a, b) => compareCompoundIntent(a, b, contract));
  for (const track of ranked) {
    if (out.length >= limit) break;
    if (preserveBoth.length > 0) {
      const meta = getContractCompositionMeta(track);
      if (meta && !passesCompoundRetrievalEligibility(meta, contract, { relaxed: true })) continue;
    }
    tryAdd(track);
  }
  phases.push("global_fill");

  if (out.length < limit) {
    for (const track of ranked) {
      if (out.length >= limit) break;
      tryAdd(track);
    }
    phases.push(`honest_tail:${out.length}`);
  }

  return {
    tracks: out.slice(0, limit),
    diagnostics: buildDiagnostics(inputCount, out.length, required, out, phases),
  };
}

function pickWithArtistCap<T extends { trackId: string; artistName?: string | null }>(
  tracks: T[],
  limit: number,
): T[] {
  const out: T[] = [];
  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    if (out.length >= limit) break;
    const artist = artistKey(track.artistName);
    if (artist && (artistCounts.get(artist) ?? 0) >= MAX_PER_ARTIST) continue;
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    out.push(track);
  }
  return out;
}

function buildDiagnostics<T extends ContractCompositionTrack>(
  inputCount: number,
  outputCount: number,
  required: string[],
  selected: T[],
  phases: string[],
): ContractCoverageSelectionDiagnostics {
  const dimensionCoverage: Record<string, number> = {};
  for (const dim of required) {
    dimensionCoverage[dim] = dimensionCoverageCount(selected, dim);
  }
  const intersectionCandidates = selected.filter(
    (t) => (getContractCompositionMeta(t)?.intersectionStrength ?? 0) >= 0.32,
  ).length;
  return {
    inputCount,
    outputCount,
    requiredDimensions: required,
    dimensionCoverage,
    intersectionCandidates,
    selectionPhases: phases,
  };
}

/** Post-V3 rebalance using marginal contract coverage (set-aware, not quota-fixed). */
export function rebalancePlaylistForContractCoverage<T extends ContractCompositionTrack & {
  trackId: string;
  artistName?: string | null;
  score?: number | null;
}>(
  selected: T[],
  candidatePool: T[],
  contract: PlaylistContract,
  targetLength: number,
  maxPerArtist: number,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  if (candidatePool.length === 0) {
    return { tracks: selected, diagnostics: { skipped: true, reason: "empty_pool" } };
  }
  const preserveBothTension = contract.tension.find((t) => t.resolution === "preserve_both");
  const preserveBoth = !!preserveBothTension;
  if (selected.length === 0 && !preserveBoth) {
    return { tracks: selected, diagnostics: { skipped: true, reason: "empty_selected" } };
  }
  if (!preserveBoth && requiredContractDimensions(contract).length <= 1) {
    return { tracks: selected.slice(0, targetLength), diagnostics: { skipped: "single_dimension" } };
  }

  const poolById = new Map(candidatePool.map((t) => [t.trackId, t]));
  const seed = selected.slice(0, Math.min(selected.length, Math.max(3, Math.floor(targetLength * 0.35))));
  const result: T[] = [];
  const used = new Set<string>();
  const artistCounts = new Map<string, number>();
  const coveredDimensions = new Map<string, number>();
  coveredDimensions.set("__intersection", 0);

  const required = requiredContractDimensions(contract);

  const register = (track: T) => {
    const meta = getContractCompositionMeta(track);
    if (!meta) return;
    for (const dim of required) {
      if ((meta.axisScores[dim] ?? 0) >= CONTRACT_AXIS_ACTIVATION_THRESHOLD) {
        coveredDimensions.set(dim, (coveredDimensions.get(dim) ?? 0) + 1);
      }
    }
    if (meta.intersectionStrength >= 0.32) {
      coveredDimensions.set("__intersection", (coveredDimensions.get("__intersection") ?? 0) + 1);
    }
  };

  const canAdd = (track: T): boolean => {
    const artist = artistKey(track.artistName);
    if (artist && (artistCounts.get(artist) ?? 0) >= maxPerArtist) return false;
    return true;
  };

  const addTrack = (track: T) => {
    if (used.has(track.trackId)) return false;
    if (!canAdd(track)) return false;
    used.add(track.trackId);
    const artist = artistKey(track.artistName);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    result.push(track);
    register(track);
    return true;
  };

  for (const track of seed) {
    if (result.length >= targetLength) break;
    addTrack(poolById.get(track.trackId) ?? track);
  }

  const minPerAxis = Math.max(2, Math.ceil(targetLength * 0.12));
  for (const dim of required) {
    if (result.length >= targetLength) break;
    const current = coveredDimensions.get(dim) ?? 0;
    if (current >= minPerAxis) continue;
    const dimRanked = candidatePool
      .filter(
        (t) =>
          !used.has(t.trackId) &&
          (getContractCompositionMeta(t)?.axisScores[dim] ?? 0) >= CONTRACT_AXIS_ACTIVATION_THRESHOLD,
      )
      .sort((a, b) => compareCompoundIntent(a, b, contract));
    let added = 0;
    for (const track of dimRanked) {
      if (added >= minPerAxis - current || result.length >= targetLength) break;
      if (addTrack(track)) added += 1;
    }
  }

  const intersectionQuota = Math.max(2, Math.ceil(targetLength * 0.16));
  const currentIntersection = coveredDimensions.get("__intersection") ?? 0;
  if (currentIntersection < intersectionQuota) {
    const byIntersection = candidatePool
      .filter(
        (t) =>
          !used.has(t.trackId) &&
          (getContractCompositionMeta(t)?.intersectionStrength ?? 0) >= intersectionThreshold(preserveBothTension!),
      )
      .sort((a, b) => compareCompoundIntent(a, b, contract));
    let added = 0;
    for (const track of byIntersection) {
      if (added >= intersectionQuota - currentIntersection || result.length >= targetLength) break;
      if (addTrack(track)) added += 1;
    }
  }

  const remaining = candidatePool.filter((t) => !used.has(t.trackId));
  while (result.length < targetLength && remaining.length > 0) {
    let bestIdx = -1;
    let bestVal = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const track = remaining[i]!;
      if (!canAdd(track)) continue;
      const val = marginalContractValue(
        getContractCompositionMeta(track),
        contract,
        coveredDimensions,
        targetLength,
      );
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestVal < 0) break;
    const [picked] = remaining.splice(bestIdx, 1);
    addTrack(picked!);
  }

  if (result.length < targetLength) {
    const tailSeen = new Set<string>(used);
    const tailCandidates: T[] = [];
    for (const track of candidatePool) {
      if (tailSeen.has(track.trackId)) continue;
      tailSeen.add(track.trackId);
      tailCandidates.push(track);
    }
    for (const track of selected) {
      const resolved = poolById.get(track.trackId) ?? track;
      if (tailSeen.has(resolved.trackId)) continue;
      tailSeen.add(resolved.trackId);
      tailCandidates.push(resolved);
    }
    tailCandidates.sort((a, b) => compareCompoundIntent(a, b, contract));
    for (const track of tailCandidates) {
      if (result.length >= targetLength) break;
      const meta = getContractCompositionMeta(track);
      if (preserveBoth && meta && !passesCompoundRetrievalEligibility(meta, contract, { relaxed: true })) {
        continue;
      }
      addTrack(track);
    }
  }

  return {
    tracks: result.slice(0, targetLength),
    diagnostics: {
      rebalanced: true,
      inputSelected: selected.length,
      outputCount: result.length,
      dimensionCoverage: Object.fromEntries(required.map((d) => [d, coveredDimensions.get(d) ?? 0])),
      rebalancePoolSize: candidatePool.length,
      intersectionCoverage: coveredDimensions.get("__intersection") ?? 0,
    },
  };
}

/** True when V41 post-V3 rebalance rewrote the playlist for compound axis coverage. */
export function contractRebalanceWasApplied(
  diagnostics: Record<string, unknown> | null | undefined,
): boolean {
  if (!diagnostics) return false;
  const rebalance = diagnostics["rebalance"] as { rebalanced?: boolean } | undefined;
  return rebalance?.rebalanced === true;
}
