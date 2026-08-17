/**
 * Human-centric playlist quality evaluator — public API.
 * Measures; does not modify generation.
 */

export * from "./types";
export * from "./prompt-corpus";
export * from "./automated-audit";
export * from "./segment-analysis";
export * from "./evidence-ingest";
export * from "./human-review";
export * from "./calibration";
export * from "./failure-clustering";
export * from "./report";

import { auditPlaylistAutomated } from "./automated-audit";
import { evaluateAllBetaEvidence, evaluateFromApiResponse } from "./evidence-ingest";
import { buildHumanQualityReport, writeHumanQualityReport } from "./report";
import { deploymentVersion } from "../deployment-version";

/** Audit beta evidence on disk and write report. */
export async function runBetaEvidenceQualityReport(outDir?: string) {
  const playlists = await evaluateAllBetaEvidence();
  const report = buildHumanQualityReport(playlists, deploymentVersion());
  const paths = await writeHumanQualityReport(report, outDir);
  return { report, paths, playlists };
}

/** Audit a single saved API response JSON file. */
export function auditSavedApiResponse(data: Record<string, unknown>) {
  return evaluateFromApiResponse(data);
}

/** Audit arbitrary prompt + tracks (fixtures, tests). */
export function auditFixture(prompt: string, tracks: Parameters<typeof auditPlaylistAutomated>[0]["tracks"]) {
  return auditPlaylistAutomated({ prompt, tracks });
}
