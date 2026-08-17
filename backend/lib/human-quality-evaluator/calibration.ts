/**
 * Compare automated hypothesis vs human review — find disagreement cases.
 */

import type { AutomatedAuditResult, EvaluatedPlaylist, HumanReviewRubric, QualitativeBand } from "./types";

function humanOverallBand(review: HumanReviewRubric): QualitativeBand {
  const score = review.overallHumanQuality;
  if (score >= 4) return "strong";
  if (score >= 2.5) return "mixed";
  return "weak";
}

function automatedOverallBand(audit: AutomatedAuditResult): QualitativeBand {
  return audit.automatedHypothesis.humanQuality;
}

export function calibrateAutomatedVsHuman(
  automated: AutomatedAuditResult,
  human: HumanReviewRubric | null,
): EvaluatedPlaylist["calibration"] {
  if (!human) return { agreement: "no_human" };

  const autoBand = automatedOverallBand(automated);
  const humanBand = humanOverallBand(human);

  if (autoBand === humanBand) {
    return { agreement: "aligned", note: `Both ${autoBand}` };
  }
  if (autoBand === "strong" && (humanBand === "weak" || humanBand === "mixed")) {
    return {
      agreement: "automated_high_human_low",
      note: "Automated hypothesis optimistic — metric blind spot candidate",
    };
  }
  if (autoBand === "weak" && humanBand === "strong") {
    return {
      agreement: "automated_low_human_high",
      note: "Automated hypothesis pessimistic — possible false alarm",
    };
  }
  return { agreement: "mixed", note: `Automated ${autoBand}, human ${humanBand}` };
}

export function collectDisagreements(playlists: EvaluatedPlaylist[]): {
  falseAlarms: string[];
  blindSpots: string[];
} {
  const falseAlarms: string[] = [];
  const blindSpots: string[] = [];

  for (const p of playlists) {
    if (!p.calibration || p.calibration.agreement === "no_human") continue;
    const id = p.requestId;
    if (p.calibration.agreement === "automated_low_human_high") {
      falseAlarms.push(
        `${id}: automated ${p.automated.automatedHypothesis.humanQuality}, human overall ${p.humanReview?.overallHumanQuality ?? "?"} — "${p.humanReview?.opinion ?? ""}"`.trim(),
      );
    }
    if (p.calibration.agreement === "automated_high_human_low") {
      blindSpots.push(
        `${id}: automated ${p.automated.automatedHypothesis.humanQuality}, human overall ${p.humanReview?.overallHumanQuality ?? "?"} — "${p.humanReview?.opinion ?? ""}"`.trim(),
      );
    }
  }
  return { falseAlarms, blindSpots };
}
