export type PipelineStageTiming = {
  stageName: string;
  durationMs: number;
  inputSize: number;
  outputSize: number;
  dropRate: number;
  notes?: string;
};

export type PipelineUnderfillAnalysis = {
  cause: "retrieval" | "scoring" | "curator" | "dedup" | "constraint";
  severity: "low" | "medium" | "high";
  evidence: string[];
  recommendation: string;
};

export type CandidateFlowSummary = {
  retrieved: number;
  afterScoring: number;
  afterCurator: number;
  final: number;
};

function severityForShortfall(finalCount: number, expectedCount: number): "low" | "medium" | "high" {
  if (expectedCount <= 0 || finalCount >= expectedCount) return "low";
  const ratio = finalCount / expectedCount;
  if (ratio < 0.5) return "high";
  if (ratio < 0.85) return "medium";
  return "low";
}

function biggestDrop(stages: PipelineStageTiming[]): PipelineStageTiming | null {
  return [...stages]
    .filter((stage) => stage.inputSize > 0 && stage.outputSize >= 0)
    .sort((a, b) => b.dropRate - a.dropRate)[0] ?? null;
}

export function analyzePipelineUnderfill(opts: {
  expectedCount: number;
  finalCount: number;
  stages: PipelineStageTiming[];
  candidateFlow: CandidateFlowSummary;
  failureReasons?: string[];
  repairMissingAfter?: number;
}): PipelineUnderfillAnalysis {
  const evidence: string[] = [];
  const expectedCount = Math.max(1, opts.expectedCount);
  const finalCount = Math.max(0, opts.finalCount);
  const minCandidateThreshold = expectedCount * 5;
  const largestDrop = biggestDrop(opts.stages);
  const severity = severityForShortfall(finalCount, expectedCount);

  evidence.push(`final:${finalCount}/${expectedCount}`);
  evidence.push(`retrieved:${opts.candidateFlow.retrieved}`);
  evidence.push(`afterScoring:${opts.candidateFlow.afterScoring}`);
  evidence.push(`afterCurator:${opts.candidateFlow.afterCurator}`);
  if (largestDrop) {
    evidence.push(`largestDrop:${largestDrop.stageName}:${Math.round(largestDrop.dropRate * 100)}%`);
  }
  for (const reason of opts.failureReasons ?? []) evidence.push(`constraint:${reason}`);
  if ((opts.repairMissingAfter ?? 0) > 0) evidence.push(`repairMissingAfter:${opts.repairMissingAfter}`);

  if (opts.candidateFlow.retrieved < minCandidateThreshold) {
    return {
      cause: "retrieval",
      severity,
      evidence,
      recommendation: "Increase candidate production before scoring using the same query intent and safe adjacent pools.",
    };
  }
  if (opts.candidateFlow.afterScoring > 0 && opts.candidateFlow.afterCurator < Math.ceil(expectedCount * 1.5)) {
    return {
      cause: "curator",
      severity,
      evidence,
      recommendation: "Inspect curator identity scoring and cluster curation for excessive candidate collapse.",
    };
  }
  if (largestDrop?.stageName.toLowerCase().includes("dedup") || evidence.some((entry) => entry.includes("duplicate"))) {
    return {
      cause: "dedup",
      severity,
      evidence,
      recommendation: "Delay deduplication until after scoring or increase candidate fan-in before dedupe.",
    };
  }
  if ((opts.failureReasons ?? []).length > 0 || largestDrop?.stageName.toLowerCase().includes("constraint")) {
    return {
      cause: "constraint",
      severity,
      evidence,
      recommendation: "Relax only post-generation structural constraints or return an explicit best-available failure.",
    };
  }
  return {
    cause: "scoring",
    severity,
    evidence,
    recommendation: "Inspect scoring/guard stages for over-aggressive filtering before finalization.",
  };
}
