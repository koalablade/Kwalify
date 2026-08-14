/**
 * Honest partial delivery via contract auditing — Phase 8.
 * Explains shortfall per unsatisfiable constraint; no forced completion.
 */

import type { ContractAuditResult } from "./contract-validator";
import type { PlaylistContract } from "./types";

export type HonestPartialDecision = {
  shouldCap: boolean;
  cap: number;
  reason: string;
  unsatisfiable: string[];
  userMessage: string | null;
};

export function deriveHonestPartialFromContract(
  contract: PlaylistContract,
  audit: ContractAuditResult,
  requestedLength: number,
  currentDelivered: number,
): HonestPartialDecision {
  const unsatisfiable = [
    ...audit.unsatisfiableConstraints,
    ...contract.tension.map((t) => t.description),
  ];

  if (audit.pass && unsatisfiable.length === 0 && audit.mustViolationCount === 0) {
    return {
      shouldCap: false,
      cap: currentDelivered,
      reason: "contract_satisfied",
      unsatisfiable: [],
      userMessage: null,
    };
  }

  const cap = audit.deliveredCap ?? Math.min(12, Math.ceil(requestedLength * 0.4));
  const effectiveCap = Math.min(cap, currentDelivered);

  let userMessage: string | null = null;
  if (contract.tension.length > 0) {
    const tensionDesc = contract.tension.map((t) => t.description).join(" and ");
    userMessage = `We couldn't fully satisfy "${tensionDesc}" in one playlist — here's an honest partial.`;
  } else if (contract.must.genres.length > 0 && contract.unknown.dimensions.includes("world")) {
    const genre = contract.must.genres[0]?.value ?? "that genre";
    userMessage = `Library lacks enough verified tracks for ${genre} with your other constraints.`;
  } else if (audit.mustViolationCount > 0) {
    userMessage = `Some tracks couldn't meet your must-not constraints — delivery capped honestly.`;
  } else if (unsatisfiable.length > 0) {
    userMessage = unsatisfiable[0] ?? "Partial delivery — not all constraints could be verified.";
  }

  return {
    shouldCap: effectiveCap < currentDelivered,
    cap: effectiveCap,
    reason: contract.tension.length > 0 ? "tension_unsatisfiable" : "constraint_violation",
    unsatisfiable,
    userMessage,
  };
}
