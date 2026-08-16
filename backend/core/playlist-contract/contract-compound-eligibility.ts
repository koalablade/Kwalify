/**
 * V45 — Compound-intent eligibility for retrieval and composition.
 * Prevents single-axis spam (party energy without emotional meaning, etc.).
 */

import type { ContractCompositionMeta } from "./contract-composition-types";
import { CONTRACT_AXIS_ACTIVATION_THRESHOLD } from "./contract-axis-scoring";
import { compoundEmotionalBangerAntiPatternPenalty } from "./contract-semantic-moment";
import type { ContractTension, PlaylistContract } from "./types";

const ACTIVATION = CONTRACT_AXIS_ACTIVATION_THRESHOLD;

/** Semantic partner axes require full activation — not relaxed single-side floors. */
const SEMANTIC_PARTNER_AXES = new Set([
  "melancholy",
  "not_cheesy",
  "not_boring",
]);

export function compoundPartnerFloor(partnerAxis: string): number {
  if (SEMANTIC_PARTNER_AXES.has(partnerAxis)) return ACTIVATION;
  return ACTIVATION * 0.82;
}

/** True when track satisfies preserve_both geometry for at least one tension pair. */
export function passesCompoundRetrievalEligibility(
  meta: ContractCompositionMeta | undefined,
  contract: PlaylistContract,
  opts?: { relaxed?: boolean; track?: { trackName?: string | null; artistName?: string | null; genreFamily?: string | null; genrePrimary?: string | null } },
): boolean {
  if (!meta?.admissible) return false;
  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  if (preserveBoth.length === 0) return true;

  if (opts?.track) {
    const antiPattern = compoundEmotionalBangerAntiPatternPenalty(opts.track, contract);
    if (antiPattern >= 0.45) return false;
  }

  const minIntersection = opts?.relaxed ? 0.24 : 0.28;
  for (const tension of preserveBoth) {
    const [a, b] = tension.axes;
    const sa = meta.axisScores[a] ?? 0;
    const sb = meta.axisScores[b] ?? 0;
    const floorA = compoundPartnerFloor(a);
    const floorB = compoundPartnerFloor(b);
    if (sa >= floorA && sb >= floorB) return true;
    if (meta.intersectionStrength >= minIntersection && sa >= floorA * 0.92 && sb >= floorB * 0.92) {
      return true;
    }
  }
  return false;
}

export type CompoundFeasibilityAssessment = {
  satisfiable: boolean;
  gracefulDegradation: boolean;
  compoundEligibleCount: number;
  intersectionCount: number;
  singleAxisOnlyCount: number;
  minHonestDelivery: number;
  reasons: string[];
};

/** Assess whether library supply supports imperfect-but-honest compound delivery. */
export function assessCompoundFeasibility(
  metas: ContractCompositionMeta[],
  contract: PlaylistContract,
  requestedLength: number,
): CompoundFeasibilityAssessment {
  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  const reasons: string[] = [];
  if (preserveBoth.length === 0) {
    const admissible = metas.filter((m) => m.admissible).length;
    return {
      satisfiable: admissible >= Math.min(requestedLength, 8),
      gracefulDegradation: admissible >= 3,
      compoundEligibleCount: admissible,
      intersectionCount: 0,
      singleAxisOnlyCount: 0,
      minHonestDelivery: Math.min(admissible, Math.max(3, Math.ceil(requestedLength * 0.4))),
      reasons: admissible < 3 ? ["insufficient_admissible_supply"] : [],
    };
  }

  const compoundEligible = metas.filter((m) => passesCompoundRetrievalEligibility(m, contract));
  const intersection = compoundEligible.filter((m) => m.intersectionStrength >= 0.32);
  const singleAxisOnly = metas.filter(
    (m) => m.admissible && !passesCompoundRetrievalEligibility(m, contract),
  ).length;

  const minHonest = Math.min(
    requestedLength,
    Math.max(3, Math.ceil(requestedLength * 0.4)),
  );
  const satisfiable = compoundEligible.length >= minHonest;
  const gracefulDegradation = compoundEligible.length >= 3 || intersection.length >= 2;

  if (!satisfiable && gracefulDegradation) reasons.push("imperfect_compound_supply");
  if (!gracefulDegradation) reasons.push("compound_supply_too_thin");
  if (singleAxisOnly > compoundEligible.length * 2) reasons.push("single_axis_contamination_risk");

  return {
    satisfiable,
    gracefulDegradation,
    compoundEligibleCount: compoundEligible.length,
    intersectionCount: intersection.length,
    singleAxisOnlyCount: singleAxisOnly,
    minHonestDelivery: Math.min(compoundEligible.length, minHonest),
    reasons,
  };
}

export function tensionAxisPair(tension: ContractTension): [string, string] {
  return [tension.axes[0]!, tension.axes[1]!];
}
