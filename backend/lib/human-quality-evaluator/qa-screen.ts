/**
 * Conservative QA pre-screen labels on top of forensic analysis.
 * Not human verification.
 */

import type { ForensicBucket, ForensicPlaylist } from "./forensic-analysis";

export type QaConfidence = "high" | "medium" | "low";

export type QaScreen = {
  overall: ForensicBucket;
  confidence: QaConfidence;
  humanReviewRecommended: boolean;
  reasons: string[];
  hcsDisclaimer: "AUTOMATED PROXY — NOT HUMAN VERIFICATION";
};

export function screenPlaylist(p: ForensicPlaylist, shortlisted: boolean): QaScreen {
  const reasons: string[] = [];
  if (p.bucketWhy) reasons.push(p.bucketWhy);
  if (p.delivered < p.requested) reasons.push(`Underfill ${p.delivered}/${p.requested} (${p.fillSeverity})`);
  if (p.library) {
    reasons.push(`Library opportunity ${p.library.opportunity} (${p.library.strongRelevantCount} strong / ${p.library.adjacentRelevantCount} adjacent of ${p.library.librarySize})`);
    reasons.push(`Library utilisation ${p.library.utilisation} — ${p.library.underfillVsOpportunity}`);
  }
  if (p.responseQuality) reasons.push(`Response quality hypothesis: ${p.responseQuality}`);
  for (const f of p.failureClasses) {
    if (f.class === "INCOMPLETE_TRACE") continue;
    reasons.push(`${f.class}: ${f.evidence}`);
  }
  if (p.hcsScore != null) {
    reasons.push(`HCS ${p.hcsScore} (${"AUTOMATED PROXY — NOT HUMAN VERIFICATION"})`);
  }

  let confidence: QaConfidence = "medium";
  if (
    p.bucket === "CLEARLY_BAD"
    || p.bucket === "TECHNICAL_FAILURE"
    || p.failureClasses.some((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE")
  ) {
    confidence = "high";
  } else if (p.bucket === "INSUFFICIENT_EVIDENCE" || p.bucket === "MIXED") {
    confidence = "low";
  }

  return {
    overall: p.bucket,
    confidence,
    humanReviewRecommended: shortlisted,
    reasons: reasons.slice(0, 12),
    hcsDisclaimer: "AUTOMATED PROXY — NOT HUMAN VERIFICATION",
  };
}
