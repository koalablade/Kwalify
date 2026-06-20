/**
 * Metric audit — detect circular, self-reinforcing, and benchmark-biased scoring.
 */

import {
  buildIntentSurvivalDiagnostics,
  type IntentSurvivalDiagnostics,
  type SurvivalTrack,
} from "../intent-survival-diagnostics";
import type { LockedIntent } from "../../core/v3/intent";
import { extractPromptGroundTruth } from "./prompt-ground-truth";
import { computeTruthfulMetrics, type TruthfulMetricScores } from "./truthful-metrics";

export type MetricBiasKind =
  | "circular_calculation"
  | "self_reinforcing_scoring"
  | "benchmark_bias_inactive_100"
  | "optimistic_missing_default"
  | "contract_survival_alias"
  | "inflated_dimension";

export type MetricBiasFinding = {
  kind: MetricBiasKind;
  dimension: string;
  legacyScore: number | null;
  truthfulScore: number | null;
  delta: number;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
};

export type MetricAuditResult = {
  prompt: string;
  legacy: {
    intentSurvival: number;
    genreSurvival: number;
    emotionSurvival: number;
    atmosphereSurvival: number;
  };
  truthful: {
    intentSurvival: number | null;
    genreSurvival: number | null;
    emotionSurvival: number | null;
    atmosphereSurvival: number | null;
  };
  inflationDelta: {
    intentSurvival: number;
    genreSurvival: number;
    emotionSurvival: number;
    atmosphereSurvival: number;
  };
  findings: MetricBiasFinding[];
  circularRisk: boolean;
  benchmarkBiasRisk: boolean;
  overfittingRisk: boolean;
};

export type AuditMetricsOpts = {
  prompt: string;
  tracks: SurvivalTrack[];
  lockedIntent?: Partial<LockedIntent> & { primaryGenres?: string[] };
  emotionProfile?: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  } | null;
};

function delta(legacy: number | null, truthful: number | null): number {
  if (legacy == null || truthful == null) return legacy ?? 0;
  return Math.round((legacy - truthful) * 10) / 10;
}

function severityForDelta(value: number): MetricBiasFinding["severity"] {
  if (value >= 40) return "critical";
  if (value >= 25) return "high";
  if (value >= 12) return "medium";
  return "low";
}

function legacyFromDiagnostics(diag: IntentSurvivalDiagnostics): MetricAuditResult["legacy"] {
  return {
    intentSurvival: diag.scores.overallIntentSurvival,
    genreSurvival: diag.scores.genreSurvival,
    emotionSurvival: diag.scores.emotionSurvival,
    atmosphereSurvival: diag.scores.atmosphereSurvival,
  };
}

function truthfulSummary(truthful: TruthfulMetricScores): MetricAuditResult["truthful"] {
  return {
    intentSurvival: truthful.intentSurvival,
    genreSurvival: truthful.genreSurvival,
    emotionSurvival: truthful.emotionSurvival,
    atmosphereSurvival: truthful.atmosphereSurvival,
  };
}

function detectFindings(
  prompt: string,
  legacy: IntentSurvivalDiagnostics,
  truthful: TruthfulMetricScores,
  lockedIntent?: AuditMetricsOpts["lockedIntent"],
): MetricBiasFinding[] {
  const findings: MetricBiasFinding[] = [];
  const groundTruth = extractPromptGroundTruth(prompt);

  const pairs: Array<[string, number, number | null]> = [
    ["genreSurvival", legacy.scores.genreSurvival, truthful.genreSurvival],
    ["emotionSurvival", legacy.scores.emotionSurvival, truthful.emotionSurvival],
    ["atmosphereSurvival", legacy.scores.atmosphereSurvival, truthful.atmosphereSurvival],
    ["intentSurvival", legacy.scores.overallIntentSurvival, truthful.intentSurvival],
  ];

  for (const [dimension, legacyScore, truthfulScore] of pairs) {
    const inflation = delta(legacyScore, truthfulScore);
    if (inflation >= 8) {
      findings.push({
        kind: "inflated_dimension",
        dimension,
        legacyScore,
        truthfulScore,
        delta: inflation,
        severity: severityForDelta(inflation),
        description: `Legacy ${dimension} (${legacyScore}) exceeds truthful (${truthfulScore ?? "null"}) by ${inflation} points.`,
      });
    }
  }

  if (lockedIntent?.primaryGenres?.length && groundTruth.explicitGenres.length === 0) {
    findings.push({
      kind: "circular_calculation",
      dimension: "genreSurvival",
      legacyScore: legacy.scores.genreSurvival,
      truthfulScore: truthful.genreSurvival,
      delta: delta(legacy.scores.genreSurvival, truthful.genreSurvival),
      severity: "high",
      description: "Legacy genre survival uses lockedIntent genres not explicitly present in prompt text.",
    });
  }

  for (const dimension of ["genre", "emotion", "atmosphere", "subgenre", "activity"] as const) {
    const legacyDim = legacy.dimensions[dimension];
    if (!legacyDim.explicit && legacyDim.score === 100 && !truthful.inactiveDimensions.includes(dimension)) {
      findings.push({
        kind: "benchmark_bias_inactive_100",
        dimension,
        legacyScore: 100,
        truthfulScore: null,
        delta: 100,
        severity: "medium",
        description: `Inactive dimension '${dimension}' scored 100 in legacy metrics (benchmark inflation).`,
      });
    }
  }

  if (legacy.dimensions.atmosphere.explicit && groundTruth.explicitAtmospheres.length > 0) {
    const legacyAtmo = legacy.dimensions.atmosphere;
    const truthfulAtmo = truthful.atmosphereSurvival;
    if (
      typeof truthfulAtmo === "number"
      && legacyAtmo.score - truthfulAtmo >= 15
      && legacyAtmo.matchedCount > truthfulAtmo / 100 * legacyAtmo.totalCount
    ) {
      findings.push({
        kind: "self_reinforcing_scoring",
        dimension: "atmosphereSurvival",
        legacyScore: legacyAtmo.score,
        truthfulScore: truthfulAtmo,
        delta: legacyAtmo.score - truthfulAtmo,
        severity: "high",
        description: "Legacy atmosphere scoring uses mood/audio fallbacks not verifiable from track metadata text.",
      });
    }
  }

  if (legacy.dimensions.scene.explicit && legacy.dimensions.scene.score >= 80) {
    const sceneEvidence = legacy.dimensions.scene.evidence as Record<string, unknown>;
    if (sceneEvidence.sceneIntent && groundTruth.explicitAtmospheres.length === 0) {
      findings.push({
        kind: "self_reinforcing_scoring",
        dimension: "sceneSurvival",
        legacyScore: legacy.dimensions.scene.score,
        truthfulScore: truthful.intentSurvival,
        delta: delta(legacy.dimensions.scene.score, truthful.intentSurvival),
        severity: "medium",
        description: "Scene survival boosted by pipeline sceneIntent without explicit prompt atmosphere terms.",
      });
    }
  }

  return findings;
}

export function auditMetrics(opts: AuditMetricsOpts): MetricAuditResult {
  const legacyDiag = buildIntentSurvivalDiagnostics({
    prompt: opts.prompt,
    finalTracks: opts.tracks,
    lockedIntent: opts.lockedIntent,
    emotionProfile: opts.emotionProfile ?? null,
  });
  const truthful = computeTruthfulMetrics({ prompt: opts.prompt, tracks: opts.tracks });

  const findings = detectFindings(opts.prompt, legacyDiag, truthful, opts.lockedIntent);
  const legacy = legacyFromDiagnostics(legacyDiag);
  const truthfulSummary_ = truthfulSummary(truthful);

  return {
    prompt: opts.prompt,
    legacy,
    truthful: truthfulSummary_,
    inflationDelta: {
      intentSurvival: delta(legacy.intentSurvival, truthful.intentSurvival),
      genreSurvival: delta(legacy.genreSurvival, truthful.genreSurvival),
      emotionSurvival: delta(legacy.emotionSurvival, truthful.emotionSurvival),
      atmosphereSurvival: delta(legacy.atmosphereSurvival, truthful.atmosphereSurvival),
    },
    findings,
    circularRisk: findings.some((f) => f.kind === "circular_calculation"),
    benchmarkBiasRisk: findings.some((f) => f.kind === "benchmark_bias_inactive_100"),
    overfittingRisk: findings.some((f) => f.severity === "critical" || f.severity === "high"),
  };
}

export function summarizeMetricAudits(audits: MetricAuditResult[]): {
  count: number;
  meanInflation: Record<string, number>;
  findingCounts: Record<MetricBiasKind, number>;
  hiddenCollapseCases: MetricAuditResult[];
} {
  const keys = ["intentSurvival", "genreSurvival", "emotionSurvival", "atmosphereSurvival"] as const;
  const meanInflation = Object.fromEntries(
    keys.map((key) => [
      key,
      Math.round(audits.reduce((sum, row) => sum + row.inflationDelta[key], 0) / Math.max(1, audits.length) * 10) / 10,
    ]),
  ) as Record<string, number>;

  const findingCounts = {} as Record<MetricBiasKind, number>;
  for (const audit of audits) {
    for (const finding of audit.findings) {
      findingCounts[finding.kind] = (findingCounts[finding.kind] ?? 0) + 1;
    }
  }

  const hiddenCollapseCases = audits.filter((audit) =>
    audit.legacy.intentSurvival >= 75
    && (audit.truthful.intentSurvival ?? 100) <= 45,
  );

  return { count: audits.length, meanInflation, findingCounts, hiddenCollapseCases };
}
