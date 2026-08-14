/**
 * Contract validator — terminal gate prototype (Phase 6-7).
 * Audits delivered playlist against PlaylistContract violations.
 */

import type { ContractRetrievalTrack } from "./constraint-aware-retrieval";
import { scoreTrackAgainstContract } from "./constraint-aware-retrieval";
import type { PlaylistContract } from "./types";

export type ContractViolationSummary = {
  trackId: string;
  trackName?: string | null;
  violations: string[];
};

export type ContractAuditResult = {
  pass: boolean;
  honestPartial: boolean;
  deliveredCap: number | null;
  violationCount: number;
  mustViolationCount: number;
  softViolationCount: number;
  unsatisfiableConstraints: string[];
  trackViolations: ContractViolationSummary[];
  explanation: string | null;
};

export function auditPlaylistAgainstContract(
  tracks: ContractRetrievalTrack[],
  contract: PlaylistContract,
  requestedLength: number,
): ContractAuditResult {
  const trackViolations: ContractViolationSummary[] = [];
  let mustViolationCount = 0;
  let softViolationCount = 0;

  for (const track of tracks) {
    const scored = scoreTrackAgainstContract(track, contract);
    const hard = scored.violations.filter((v) => v.startsWith("MUST_NOT"));
    const soft = scored.violations.filter((v) => !v.startsWith("MUST_NOT"));
    if (hard.length) {
      mustViolationCount += hard.length;
      trackViolations.push({
        trackId: track.trackId,
        trackName: track.trackName,
        violations: hard,
      });
    }
    softViolationCount += soft.length;
  }

  const unsatisfiable: string[] = [];
  if (contract.tension.length > 0) {
    for (const t of contract.tension) {
      unsatisfiable.push(`Unresolved tension: ${t.description}`);
    }
  }
  for (const dim of contract.unknown.dimensions) {
    if (dim === "genre" && contract.must.genres.length === 0) {
      unsatisfiable.push("No verified genre constraint — library match uncertain");
    }
  }

  const violationCount = mustViolationCount + softViolationCount;
  const pass = mustViolationCount === 0 && contract.tension.length === 0;
  const honestPartial = !pass || unsatisfiable.length > 0;

  let deliveredCap: number | null = null;
  if (honestPartial && contract.tension.length > 0) {
    deliveredCap = Math.min(12, Math.ceil(requestedLength * 0.4));
  } else if (mustViolationCount > 0) {
    deliveredCap = Math.max(0, tracks.length - trackViolations.length);
  }

  let explanation: string | null = null;
  if (contract.tension.length > 0) {
    explanation = `Cannot fully satisfy: ${contract.tension.map((t) => t.description).join("; ")}`;
  } else if (mustViolationCount > 0) {
    explanation = `${mustViolationCount} MUST constraint violation(s) in delivered playlist`;
  } else if (unsatisfiable.length > 0) {
    explanation = unsatisfiable[0] ?? null;
  }

  return {
    pass,
    honestPartial,
    deliveredCap,
    violationCount,
    mustViolationCount,
    softViolationCount,
    unsatisfiableConstraints: unsatisfiable,
    trackViolations,
    explanation,
  };
}
