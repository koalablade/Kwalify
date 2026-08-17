/**
 * Human quality evaluation report — evidence-first, not score-chasing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { qualitativeBandLabel } from "./automated-audit";
import { collectDisagreements } from "./calibration";
import { clusterFailures, repeatedFailureClasses } from "./failure-clustering";
import { corpusByCategory, corpusByDifficulty, HUMAN_QUALITY_PROMPT_CORPUS } from "./prompt-corpus";
import type { EvaluatedPlaylist, HumanQualityReport, QualitativeBand } from "./types";
import { EVALUATOR_VERSION } from "./types";

function aggregateBand(values: QualitativeBand[]): QualitativeBand {
  const scored = values.filter((v) => v !== "unknown");
  if (scored.length === 0) return "unknown";
  const weak = scored.filter((v) => v === "weak").length;
  const mixed = scored.filter((v) => v === "mixed").length;
  const strong = scored.filter((v) => v === "strong").length;
  if (weak > scored.length * 0.4) return "weak";
  if (strong > scored.length * 0.5) return "strong";
  if (mixed + strong > weak) return "mixed";
  return "weak";
}

function strongestAreas(playlists: EvaluatedPlaylist[]): string[] {
  const areas: string[] = [];
  const strongMoment = playlists.filter((p) => p.automated.automatedHypothesis.momentFidelity === "strong").length;
  const strongCohesion = playlists.filter((p) => p.automated.automatedHypothesis.musicalCoherence === "strong").length;
  const noUnderfill = playlists.filter((p) => p.automated.underfill.outcome === "success").length;
  const lowRepetition = playlists.filter((p) => !p.automated.artistDiversity.suspiciousRepetition).length;

  if (playlists.length === 0) return ["Insufficient data"];
  if (strongCohesion / playlists.length >= 0.5) areas.push("Musical coherence (automated hypothesis)");
  if (strongMoment / playlists.length >= 0.5) areas.push("Moment fidelity (automated hypothesis)");
  if (noUnderfill / playlists.length >= 0.7) areas.push("Delivery completeness");
  if (lowRepetition / playlists.length >= 0.7) areas.push("Artist diversity");
  if (areas.length === 0) areas.push("No dominant strength detected — need more human review");
  return areas;
}

function recommendNextStep(
  playlists: EvaluatedPlaylist[],
  clusters: ReturnType<typeof clusterFailures>,
  humanReviewed: number,
): { step: string; confidence: HumanQualityReport["confidence"] } {
  if (playlists.length < 3) {
    return {
      step: "Gather more real beta generations — insufficient evidence for any product decision.",
      confidence: "low",
    };
  }
  if (humanReviewed < 3) {
    return {
      step: "Complete human review on a cross-section (automated best/worst/borderline) before trusting automated bands.",
      confidence: "low",
    };
  }
  const repeated = repeatedFailureClasses(clusters);
  if (repeated.length === 0) {
    return {
      step: "No repeated failure class yet — continue closed beta collection.",
      confidence: "medium",
    };
  }
  const top = repeated[0]!;
  return {
    step: `Investigate repeated failure class: ${top.summary} (${top.count} playlists, ${top.humanEvidenceCount} human signals). Do NOT implement engine change until root cause confirmed.`,
    confidence: top.humanEvidenceCount >= 2 ? "high" : "medium",
  };
}

export function buildHumanQualityReport(
  playlists: EvaluatedPlaylist[],
  engineCommit: string | null = null,
): HumanQualityReport {
  const humanReviewed = playlists.filter((p) => p.humanReview != null).length;
  const betaCount = playlists.filter((p) => p.source === "beta_evidence").length;
  const { falseAlarms, blindSpots } = collectDisagreements(playlists);
  const failureClusters = clusterFailures(playlists);
  const { step, confidence } = recommendNextStep(playlists, failureClusters, humanReviewed);

  const hypothesis = playlists.map((p) => p.automated.automatedHypothesis);

  return {
    generatedAt: new Date().toISOString(),
    evaluatorVersion: EVALUATOR_VERSION,
    engineCommit,
    playlistsEvaluated: playlists.length,
    humanReviewed,
    betaEvidenceIntegrated: betaCount,
    qualitativeSummary: {
      humanQuality: aggregateBand(hypothesis.map((h) => h.humanQuality)),
      momentFidelity: aggregateBand(hypothesis.map((h) => h.momentFidelity)),
      musicalCoherence: aggregateBand(hypothesis.map((h) => h.musicalCoherence)),
      taste: aggregateBand(hypothesis.map((h) => h.taste)),
      sequencing: aggregateBand(hypothesis.map((h) => h.sequencing)),
      reliability: aggregateBand(hypothesis.map((h) => h.reliability)),
    },
    strongestAreas: strongestAreas(playlists),
    failureClusters,
    falseAlarms,
    blindSpots,
    engineChanges: "NONE",
    recommendedNextStep: step,
    confidence,
    playlists,
  };
}

export function formatHumanQualityReportMarkdown(report: HumanQualityReport): string {
  const q = report.qualitativeSummary;
  const lines: string[] = [
    "# KWALIFY PLAYLIST QUALITY REPORT",
    "",
    `Generated: ${report.generatedAt}`,
    `Evaluator: ${report.evaluatorVersion}`,
    `Engine commit: ${report.engineCommit ?? "unknown"}`,
    "",
    "## Summary",
    "",
    `Playlists evaluated: ${report.playlistsEvaluated}`,
    `Human-reviewed: ${report.humanReviewed}`,
    `Beta evidence integrated: ${report.betaEvidenceIntegrated}`,
    "",
    "## Human quality (automated HYPOTHESIS — validate with human review)",
    "",
    `- Human quality: ${qualitativeBandLabel(q.humanQuality)}`,
    `- Moment fidelity: ${qualitativeBandLabel(q.momentFidelity)}`,
    `- Musical coherence: ${qualitativeBandLabel(q.musicalCoherence)}`,
    `- Taste: ${qualitativeBandLabel(q.taste)}`,
    `- Sequencing: ${qualitativeBandLabel(q.sequencing)}`,
    `- Reliability: ${qualitativeBandLabel(q.reliability)}`,
    "",
    "## Strongest areas",
    ...report.strongestAreas.map((a) => `- ${a}`),
    "",
  ];

  if (report.failureClusters.length > 0) {
    lines.push("## Failure clusters", "");
    for (const c of report.failureClusters.slice(0, 8)) {
      lines.push(
        `### ${c.summary}`,
        `- Count: ${c.count} | Human signals: ${c.humanEvidenceCount} | Severity: ${c.severity} | Confidence: ${c.confidence}`,
        `- Examples: ${c.exampleRequestIds.join(", ")}`,
        "",
      );
    }
  }

  if (report.falseAlarms.length > 0) {
    lines.push("## False alarms (automated pessimistic)", ...report.falseAlarms.map((f) => `- ${f}`), "");
  }
  if (report.blindSpots.length > 0) {
    lines.push("## Blind spots (automated optimistic)", ...report.blindSpots.map((b) => `- ${b}`), "");
  }

  lines.push(
    "## Engine changes",
    "",
    "**NONE** — evaluator is observational only.",
    "",
    "## Recommended next step",
    "",
    report.recommendedNextStep,
    "",
    `Confidence: ${report.confidence.toUpperCase()}`,
    "",
    "---",
    "",
    "## Prompt corpus (for benchmark matrix)",
    "",
    `Total corpus prompts: ${HUMAN_QUALITY_PROMPT_CORPUS.length}`,
    `By difficulty: ${JSON.stringify(corpusByDifficulty())}`,
    `By category: ${JSON.stringify(corpusByCategory())}`,
    "",
    "> Automated scores are proxies. Human listening and beta feedback remain authoritative.",
  );

  return lines.join("\n");
}

export async function writeHumanQualityReport(
  report: HumanQualityReport,
  outDir = join(process.cwd(), "reports", "human-quality"),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `quality-report-${stamp}.json`);
  const mdPath = join(outDir, `quality-report-${stamp}.md`);
  const { playlists, ...summary } = report;
  await writeFile(jsonPath, `${JSON.stringify({ ...summary, playlistSummaries: playlists.map((p) => ({
    requestId: p.requestId,
    prompt: p.prompt,
    commit: p.commit,
    automated: p.automated.automatedHypothesis,
    hcs: p.automated.hcs,
    verifier: p.automated.independentVerifier.playlistVerdict,
    humanReview: p.humanReview,
    calibration: p.calibration,
    userFeedback: p.userFeedback,
  })) })}\n`, "utf8");
  await writeFile(mdPath, formatHumanQualityReportMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}
