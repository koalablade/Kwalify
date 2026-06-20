/**
 * Real vs synthetic benchmark auditor — compares fixture cohort vs simulation cohort.
 */

import { buildLockedIntent } from "../../core/v3/intent";
import { generateAdversarialPrompts } from "../stress-testing/adversarial-prompts";
import { ROBUSTNESS_SCENE_PROMPTS, SYNTHETIC_LIBRARIES } from "../stress-testing/synthetic-libraries";
import { evaluatePromptStress, summarizeStressResults } from "../stress-testing/stress-evaluator";
import type { StressEvaluation } from "../stress-testing/types";
import type { SurvivalTrack } from "../intent-survival-diagnostics";
import { auditMetrics, summarizeMetricAudits, type MetricAuditResult } from "./metric-audit";
import { computeTruthfulMetrics } from "./truthful-metrics";

export const FIXTURE_BENCHMARK_PROMPTS = [
  "Reading Agatha Christie",
  "Tokyo at 3am",
  "Warehouse rave at midnight",
  "sad indie driving at night",
  "uk garage workout",
  "Reading Tolkien by the fire",
  "Cyberpunk dystopia",
  "Paris café in the rain",
  "no rap please",
  "Reading Sherlock Holmes",
];

export type CohortSummary = {
  cohort: "fixture" | "real_simulation";
  prompts: number;
  stressPassRate: number;
  stressPassed: number;
  stressFailed: number;
  meanTruthfulIntentSurvival: number | null;
  meanLegacyIntentSurvival: number;
  meanInflation: number;
  collapseTypes: Record<string, number>;
};

export type BenchmarkAuditorReport = {
  schemaVersion: "real-vs-synthetic-auditor-v1";
  generatedAt: string;
  fixtureCohort: CohortSummary;
  realSimulationCohort: CohortSummary;
  delta: {
    passRateGap: number;
    truthfulIntentGap: number;
    legacyIntentGap: number;
    inflationGap: number;
    overfittingDetected: boolean;
    inflatedScoresDetected: boolean;
  };
  correctedProductionScoreEstimate: number;
  hiddenCollapseCases: Array<{
    prompt: string;
    legacyIntentSurvival: number;
    truthfulIntentSurvival: number | null;
    collapseType?: string;
  }>;
  metricAuditSummary: ReturnType<typeof summarizeMetricAudits>;
  recommendedFixes: string[];
  samples: {
    fixtureFailures: StressEvaluation[];
    realSimulationFailures: StressEvaluation[];
    metricAudits: MetricAuditResult[];
  };
};

function tracksFromLibrary(libraryId: string): SurvivalTrack[] {
  const library = SYNTHETIC_LIBRARIES.find((row) => row.id === libraryId) ?? SYNTHETIC_LIBRARIES[3]!;
  return library.tracks.map((track) => ({
    trackId: track.trackId,
    trackName: track.trackName,
    artistName: track.artistName,
    genreFamily: track.genreFamily,
    genrePrimary: track.genreFamily,
    energy: track.energy,
    valence: track.valence,
    tempo: track.tempo,
    danceability: track.danceability,
    acousticness: track.acousticness,
    releaseYear: null,
  }));
}

function evaluateCohort(
  cohort: "fixture" | "real_simulation",
  prompts: string[],
  libraryId: string,
): {
  summary: CohortSummary;
  stressResults: StressEvaluation[];
  metricAudits: MetricAuditResult[];
} {
  const library = SYNTHETIC_LIBRARIES.find((row) => row.id === libraryId) ?? SYNTHETIC_LIBRARIES[3]!;
  const tracks = tracksFromLibrary(libraryId);
  const signatureIndex = new Map<string, string[]>();
  const stressResults: StressEvaluation[] = [];
  const metricAudits: MetricAuditResult[] = [];

  for (const prompt of prompts) {
    stressResults.push(evaluatePromptStress({
      prompt,
      libraryId: library.id,
      tracks: library.tracks,
      coldStart: library.coldStart,
      signatureIndex,
    }));

    const lockedIntent = buildLockedIntent(prompt);
    metricAudits.push(auditMetrics({
      prompt,
      tracks,
      lockedIntent,
    }));
  }

  const stressSummary = summarizeStressResults(stressResults);
  const auditSummary = summarizeMetricAudits(metricAudits);
  const truthfulScores = metricAudits
    .map((row) => row.truthful.intentSurvival)
    .filter((score): score is number => typeof score === "number");
  const legacyScores = metricAudits.map((row) => row.legacy.intentSurvival);

  return {
    summary: {
      cohort,
      prompts: prompts.length,
      stressPassRate: stressSummary.passRate,
      stressPassed: stressSummary.passed,
      stressFailed: stressSummary.failed,
      meanTruthfulIntentSurvival: truthfulScores.length
        ? Math.round(truthfulScores.reduce((a, b) => a + b, 0) / truthfulScores.length)
        : null,
      meanLegacyIntentSurvival: Math.round(legacyScores.reduce((a, b) => a + b, 0) / legacyScores.length),
      meanInflation: Math.round(auditSummary.meanInflation.intentSurvival * 10) / 10,
      collapseTypes: stressSummary.collapseCounts,
    },
    stressResults,
    metricAudits,
  };
}

function buildRecommendedFixes(
  fixture: CohortSummary,
  realSim: CohortSummary,
  auditSummary: ReturnType<typeof summarizeMetricAudits>,
  hiddenCollapses: BenchmarkAuditorReport["hiddenCollapseCases"],
): string[] {
  const fixes: string[] = [];

  if (fixture.stressPassRate - realSim.stressPassRate >= 15) {
    fixes.push("Reduce fixture overfitting: expand CI gates with adversarial/real-simulation cohort, not only curated fixtures.");
  }
  if (auditSummary.meanInflation.intentSurvival >= 12) {
    fixes.push("Replace legacy intentSurvival in gates with computeTruthfulMetrics(); inactive dimensions must stay null.");
  }
  if ((auditSummary.findingCounts.circular_calculation ?? 0) > 0) {
    fixes.push("Stop scoring genreSurvival from lockedIntent; use prompt-ground-truth explicit genres only.");
  }
  if ((auditSummary.findingCounts.benchmark_bias_inactive_100 ?? 0) > 0) {
    fixes.push("Remove inactive-dimension=100 behavior in scoreDimension(); exclude from overallIntentSurvival.");
  }
  if ((auditSummary.findingCounts.self_reinforcing_scoring ?? 0) > 0) {
    fixes.push("Remove atmosphere/scene mood and audio fallbacks from survival predicates.");
  }
  if (hiddenCollapses.length > 0) {
    fixes.push(`Investigate ${hiddenCollapses.length} hidden collapse case(s) where legacy ≥75 but truthful ≤45.`);
  }
  if (realSim.stressPassRate < 50) {
    fixes.push("Real-simulation pass rate below 50%: prioritize collapse types with highest stageCounts in adversarial report.");
  }
  if (fixes.length === 0) {
    fixes.push("No critical auditor findings; continue monitoring truthful vs legacy delta on live prompt samples.");
  }
  return fixes;
}

function correctedProductionScore(
  fixture: CohortSummary,
  realSim: CohortSummary,
  auditSummary: ReturnType<typeof summarizeMetricAudits>,
): number {
  const stressBlend = fixture.stressPassRate * 0.25 + realSim.stressPassRate * 0.75;
  const truthfulBase = realSim.meanTruthfulIntentSurvival ?? fixture.meanTruthfulIntentSurvival ?? 0;
  const inflationPenalty = Math.min(25, auditSummary.meanInflation.intentSurvival * 0.6);
  const hiddenPenalty = auditSummary.hiddenCollapseCases.length * 3;
  return Math.max(0, Math.min(100, Math.round(stressBlend * 0.55 + truthfulBase * 0.45 - inflationPenalty - hiddenPenalty)));
}

export type RunBenchmarkAuditorOpts = {
  adversarialLimit?: number;
  seed?: number;
  libraryId?: string;
};

export function runBenchmarkAuditor(opts: RunBenchmarkAuditorOpts = {}): BenchmarkAuditorReport {
  const libraryId = opts.libraryId ?? "uk-electronic-only";
  const adversarialLimit = opts.adversarialLimit ?? 100;
  const seed = opts.seed ?? 42;

  const fixtureEval = evaluateCohort("fixture", FIXTURE_BENCHMARK_PROMPTS, libraryId);
  const adversarial = generateAdversarialPrompts({ seed, limit: adversarialLimit }).map((row) => row.prompt);
  const realPrompts = [...new Set([...ROBUSTNESS_SCENE_PROMPTS, ...adversarial])];
  const realEval = evaluateCohort("real_simulation", realPrompts, libraryId);

  const auditSummary = summarizeMetricAudits([
    ...fixtureEval.metricAudits,
    ...realEval.metricAudits,
  ]);

  const passRateGap = fixtureEval.summary.stressPassRate - realEval.summary.stressPassRate;
  const truthfulIntentGap = (fixtureEval.summary.meanTruthfulIntentSurvival ?? 0)
    - (realEval.summary.meanTruthfulIntentSurvival ?? 0);
  const legacyIntentGap = fixtureEval.summary.meanLegacyIntentSurvival - realEval.summary.meanLegacyIntentSurvival;
  const inflationGap = fixtureEval.summary.meanInflation - realEval.summary.meanInflation;

  const hiddenCollapseCases = auditSummary.hiddenCollapseCases.map((row) => ({
    prompt: row.prompt,
    legacyIntentSurvival: row.legacy.intentSurvival,
    truthfulIntentSurvival: row.truthful.intentSurvival,
    collapseType: realEval.stressResults.find((stress) => stress.prompt === row.prompt)?.collapseType,
  }));

  const recommendedFixes = buildRecommendedFixes(
    fixtureEval.summary,
    realEval.summary,
    auditSummary,
    hiddenCollapseCases,
  );

  return {
    schemaVersion: "real-vs-synthetic-auditor-v1",
    generatedAt: new Date().toISOString(),
    fixtureCohort: fixtureEval.summary,
    realSimulationCohort: realEval.summary,
    delta: {
      passRateGap: Math.round(passRateGap * 10) / 10,
      truthfulIntentGap: Math.round(truthfulIntentGap * 10) / 10,
      legacyIntentGap: Math.round(legacyIntentGap * 10) / 10,
      inflationGap: Math.round(inflationGap * 10) / 10,
      overfittingDetected: passRateGap >= 15 || legacyIntentGap >= 20,
      inflatedScoresDetected: auditSummary.meanInflation.intentSurvival >= 12,
    },
    correctedProductionScoreEstimate: correctedProductionScore(
      fixtureEval.summary,
      realEval.summary,
      auditSummary,
    ),
    hiddenCollapseCases,
    metricAuditSummary: auditSummary,
    recommendedFixes,
    samples: {
      fixtureFailures: fixtureEval.stressResults.filter((row) => !row.passed).slice(0, 10),
      realSimulationFailures: realEval.stressResults.filter((row) => !row.passed).slice(0, 15),
      metricAudits: [...fixtureEval.metricAudits, ...realEval.metricAudits]
        .filter((row) => row.overfittingRisk)
        .slice(0, 10),
    },
  };
}

/** Lightweight check for strict enforcement — diagnostic CI runs report-only by default. */
export function benchmarkAuditorGate(report: BenchmarkAuditorReport, strict = false): { pass: boolean; reasons: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (report.delta.overfittingDetected) {
    warnings.push(`fixture-real pass rate gap ${report.delta.passRateGap}% (overfitting risk)`);
  }
  if (report.delta.inflatedScoresDetected) {
    warnings.push(`mean intent inflation ${report.metricAuditSummary.meanInflation.intentSurvival} points`);
  }
  if (report.hiddenCollapseCases.length > 0) {
    warnings.push(`${report.hiddenCollapseCases.length} hidden collapse case(s)`);
  }
  warnings.push(`corrected production score estimate: ${report.correctedProductionScoreEstimate}`);

  if (!strict) {
    return { pass: true, reasons: [], warnings };
  }

  const reasons: string[] = [];
  if (report.delta.overfittingDetected && report.delta.passRateGap >= 25) {
    reasons.push(`fixture-real pass rate gap ${report.delta.passRateGap}% exceeds 25%`);
  }
  if (report.hiddenCollapseCases.length >= 5) {
    reasons.push(`${report.hiddenCollapseCases.length} hidden collapse cases (legacy high, truthful low)`);
  }
  if (report.correctedProductionScoreEstimate < 35) {
    reasons.push(`corrected production score ${report.correctedProductionScoreEstimate} below 35`);
  }
  return { pass: reasons.length === 0, reasons, warnings };
}

export { computeTruthfulMetrics };
