/**
 * Compare current vs baseline pipeline traces and locate convergence stage.
 */

import type { ExtractedPipelineTrace, PipelineStageSnapshot } from "./extract";
import { buildStageSnapshots, trackIdsFromResponse } from "./extract";

export type StageComparison = {
  stageId: string;
  label: string;
  baselineTrackIds: string[];
  currentTrackIds: string[];
  baselineCount?: number;
  currentCount?: number;
  jaccardSimilarity: number;
  orderedMatch: boolean;
  matchesBaselineFinal: boolean;
  matchesBaselineStage: boolean;
};

export type ConvergenceAnalysis = {
  baselineFinalTrackIds: string[];
  currentFinalTrackIds: string[];
  finalOrderedMatch: boolean;
  finalJaccard: number;
  retrievalCompositionChanged: boolean;
  retrievalOverrideEvidence: string[];
  scoringOverrodeRetrieval: boolean;
  firstStageMatchingBaselineRun: string | null;
  firstStageMatchingBaselineFinal: string | null;
  stageComparisons: StageComparison[];
  summary: string;
};

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const id of setA) {
    if (setB.has(id)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function orderedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function sourceDistributionKey(bySource: Record<string, number>): string {
  return Object.entries(bySource)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

function compareSnapshots(
  baseline: PipelineStageSnapshot[],
  current: PipelineStageSnapshot[],
  baselineFinalIds: string[],
): StageComparison[] {
  const byId = new Map(baseline.map((s) => [s.stageId, s]));
  const comparisons: StageComparison[] = [];

  for (const cur of current) {
    const base = byId.get(cur.stageId);
    const baselineIds = base?.orderedTrackIds ?? base?.trackIds ?? [];
    const currentIds = cur.orderedTrackIds ?? cur.trackIds;
    comparisons.push({
      stageId: cur.stageId,
      label: cur.label,
      baselineTrackIds: baselineIds,
      currentTrackIds: currentIds,
      baselineCount: base?.candidateCount,
      currentCount: cur.candidateCount,
      jaccardSimilarity: Math.round(jaccard(baselineIds, currentIds) * 1000) / 1000,
      orderedMatch: orderedEqual(baselineIds, currentIds),
      matchesBaselineFinal: orderedEqual(currentIds, baselineFinalIds) || (
        currentIds.length > 0 && jaccard(currentIds, baselineFinalIds) === 1
      ),
      matchesBaselineStage: base ? orderedEqual(baselineIds, currentIds) : false,
    });
  }

  return comparisons;
}

function retrievalCompositionFingerprint(trace: ExtractedPipelineTrace): string {
  const parts = [
    sourceDistributionKey(trace.retrieval.bySource),
    String(trace.retrieval.outputCount ?? ""),
    String(trace.retrieval.inputCount ?? ""),
    trace.retrieval.strategy ?? "",
    JSON.stringify(trace.retrieval.libraryCapability?.["limitingFactors"] ?? []),
    String(trace.retrieval.combinedConfidence ?? ""),
    String(trace.retrieval.retrievalAttempts ?? ""),
  ];
  return parts.join("::");
}

export function analyzeConvergence(
  baselineTrace: ExtractedPipelineTrace,
  currentTrace: ExtractedPipelineTrace,
  baselineResponse?: Record<string, unknown>,
): ConvergenceAnalysis {
  const baselineFinalIds = baselineTrace.finalPlaylist.map((t) => t.trackId);
  const currentFinalIds = currentTrace.finalPlaylist.map((t) => t.trackId);

  if (baselineFinalIds.length === 0 && baselineResponse) {
    baselineFinalIds.push(...trackIdsFromResponse(baselineResponse));
  }

  const baselineSnapshots = buildStageSnapshots(baselineTrace);
  const currentSnapshots = buildStageSnapshots(currentTrace);
  const stageComparisons = compareSnapshots(baselineSnapshots, currentSnapshots, baselineFinalIds);

  const retrievalChanged =
    retrievalCompositionFingerprint(baselineTrace) !== retrievalCompositionFingerprint(currentTrace);

  const retrievalIds = new Set(currentTrace.top20EnteringScoring.map((t) => t.trackId));
  const finalIds = new Set(currentFinalIds);
  const postScoringIds = new Set(currentTrace.top20AfterScoring.map((t) => t.trackId));

  const overrideEvidence: string[] = [];
  if (retrievalChanged) {
    overrideEvidence.push("Retrieval source distribution or output count differs from baseline.");
  }
  if (retrievalIds.size > 0 && jaccard([...retrievalIds], currentFinalIds) < 0.5) {
    overrideEvidence.push("Final playlist shares <50% Jaccard with top-20 pre-scoring pool.");
  }
  if (postScoringIds.size > 0 && !orderedEqual(currentTrace.top20AfterScoring.map((t) => t.trackId), currentFinalIds)) {
    overrideEvidence.push("Top-20 after scoring does not match final playlist order.");
  }
  if (currentTrace.fastFallback && currentTrace.recoveryTriggered) {
    overrideEvidence.push("Fast fallback + recovery path reshaped the candidate pool after retrieval.");
  }
  if (currentTrace.failureCode === "LIBRARY_INSUFFICIENT_FOR_PROMPT") {
    overrideEvidence.push("Orchestrator gate blocked pipeline before scoring (no retrieval output reached V3).");
  }

  const scoringOverrode =
    retrievalIds.size > 0 &&
    jaccard([...retrievalIds], currentFinalIds) < 1 &&
    currentFinalIds.length > 0;

  let firstStageMatchingBaselineRun: string | null = null;
  let firstStageMatchingBaselineFinal: string | null = null;

  for (const row of stageComparisons) {
    if (!firstStageMatchingBaselineRun && row.matchesBaselineStage && row.currentTrackIds.length > 0) {
      firstStageMatchingBaselineRun = row.stageId;
    }
    if (!firstStageMatchingBaselineFinal && row.matchesBaselineFinal && row.currentTrackIds.length > 0) {
      firstStageMatchingBaselineFinal = row.stageId;
    }
  }

  if (!firstStageMatchingBaselineFinal && orderedEqual(currentFinalIds, baselineFinalIds)) {
    firstStageMatchingBaselineFinal = "final_playlist";
  }

  const finalJaccard = jaccard(currentFinalIds, baselineFinalIds);
  const finalOrderedMatch = orderedEqual(currentFinalIds, baselineFinalIds);

  let summary: string;
  if (!baselineTrace.success && !currentTrace.success) {
    summary = `Both runs failed early (${baselineTrace.failureCode ?? "unknown"} vs ${currentTrace.failureCode ?? "unknown"}).`;
  } else if (!currentTrace.success) {
    summary = `Current run failed at ${currentTrace.failureCode ?? "unknown"}; baseline produced ${baselineFinalIds.length} tracks.`;
  } else if (finalOrderedMatch) {
    summary = retrievalChanged
      ? `Playlists match exactly, but retrieval composition changed — convergence at ${firstStageMatchingBaselineFinal ?? "final_playlist"}.`
      : "Playlists and retrieval composition match baseline.";
  } else if (finalJaccard >= 0.9) {
    summary = `Near-identical finals (${Math.round(finalJaccard * 100)}% overlap). First stage matching baseline final: ${firstStageMatchingBaselineFinal ?? "none detected"}.`;
  } else {
    summary = `Divergent finals (${Math.round(finalJaccard * 100)}% overlap). Retrieval changed: ${retrievalChanged}. First convergence to baseline final: ${firstStageMatchingBaselineFinal ?? "never"}.`;
  }

  return {
    baselineFinalTrackIds: baselineFinalIds,
    currentFinalTrackIds: currentFinalIds,
    finalOrderedMatch,
    finalJaccard: Math.round(finalJaccard * 1000) / 1000,
    retrievalCompositionChanged: retrievalChanged,
    retrievalOverrideEvidence: overrideEvidence,
    scoringOverrodeRetrieval: scoringOverrode,
    firstStageMatchingBaselineRun,
    firstStageMatchingBaselineFinal,
    stageComparisons,
    summary,
  };
}
