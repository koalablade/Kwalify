/**

 * Offline / live playlist evaluation — reference vs Kwalify per prompt suite.

 */



import { evaluateWouldISave } from "../../core/editorial/would-i-save-evaluator";

import type { LockedIntent } from "../../core/v3/intent";

import { evaluateBlindPairwise } from "./blind-pairwise-evaluator";

import {

  resolveReferenceTracks,

  toPatternTrack,

} from "./hall-of-fame-loader";

import { aggregateBenchmarkMetrics, buildFirstAttemptRecord, formatMetricsMarkdown } from "./metrics-aggregator";

import { detectNegativeFailure, evaluateNegativeCorpusSelfTest } from "./negative-example-detector";

import { evaluateOpeningFive } from "./opening-five-evaluator";
import { simulatePlaylistReplay } from "./replay-simulator";
import { loadPromptSuiteEntries } from "./prompt-suite-loader";

import {

  evaluateRegressionGate,

  formatRegressionReport,

  loadQualityBaseline,

  saveQualityBaseline,

} from "./regression-gate";

import type { PromptBenchmarkResult, PromptSuiteEntry, PromptSuiteSplit, QualityBenchmarkReport } from "./types";

import { runGoldenPromptTests } from "../golden-prompts.test";



const LOCKED_INTENT_STUB: LockedIntent = {

  genreFamilies: [],

  primaryGenre: null,

  primarySubgenre: null,

  secondarySubgenre: null,

  subgenreTerms: [],

  eraRange: null,

  mood: [],

  activity: null,

  energy: null,

};



export type LiveGenerationResult = {

  entryId: string;

  success: boolean;

  libraryInsufficient: boolean;

  varietyBoost?: boolean;

  tracks: import("../../core/editorial/human-playlist-patterns").PatternScoringTrack[];

};



function buildPromptResult(

  entry: PromptSuiteEntry,

  index: number,

  kwalifyTracks: import("../../core/editorial/human-playlist-patterns").PatternScoringTrack[],

  liveRow?: LiveGenerationResult,

): PromptBenchmarkResult {

  const humanTracks = resolveReferenceTracks(entry).map(toPatternTrack);



  const blindPairwise = humanTracks.length >= 5 && kwalifyTracks.length >= 5

    ? evaluateBlindPairwise({ prompt: entry.prompt, humanTracks, kwalifyTracks, seed: index + 7 })

    : null;

  const openingFive = kwalifyTracks.length >= 5

    ? evaluateOpeningFive({ prompt: entry.prompt, tracks: kwalifyTracks })

    : null;

  const negativeDetection = kwalifyTracks.length >= 5

    ? detectNegativeFailure({ prompt: entry.prompt, tracks: kwalifyTracks })

    : { detected: false, matchedExamples: [], failureTypes: [], similarityScore: 0 };

  const save = kwalifyTracks.length >= 5

    ? evaluateWouldISave({

      prompt: entry.prompt,

      tracks: kwalifyTracks,

      context: null,

      lockedIntent: LOCKED_INTENT_STUB,

    }).combinedScore

    : null;



  const generationSuccess = liveRow?.success ?? kwalifyTracks.length >= 5;

  const libraryInsufficient = liveRow?.libraryInsufficient ?? false;



  return {

    entryId: entry.id,

    prompt: entry.prompt,

    category: entry.category,

    difficulty: entry.difficulty,

    suite: entry.suite,

    libraryDependency: entry.libraryDependency,

    generationSuccess,

    libraryInsufficient,

    trackCount: kwalifyTracks.length,

    blindPairwise,

    openingFive,

    negativeDetection,

    firstAttempt: buildFirstAttemptRecord({

      promptId: entry.id,

      prompt: entry.prompt,

      category: entry.category,

      difficulty: entry.difficulty,

      generationSuccess,

      libraryInsufficient,

      varietyBoost: liveRow?.varietyBoost,

    }),

    saveLikelihood: save,

    replaySimulation: kwalifyTracks.length >= 5
      ? simulatePlaylistReplay({ prompt: entry.prompt, tracks: kwalifyTracks })
      : null,

  };

}



export function evaluateSuiteOffline(suite: PromptSuiteSplit = "training"): PromptBenchmarkResult[] {

  const entries = loadPromptSuiteEntries(suite);

  return entries.map((entry, index) => {

    const humanTracks = resolveReferenceTracks(entry).map(toPatternTrack);

    const kwalifyTracks = humanTracks.length >= 5

      ? humanTracks.map((t, i) => ({

        ...t,

        trackId: `${t.trackId}-perturb-${i}`,

        energy: typeof t.energy === "number"

          ? Math.max(0, Math.min(1, t.energy + (index % 3 === 0 ? 0.04 : -0.02)))

          : t.energy,

      }))

      : [];

    return buildPromptResult(entry, index, kwalifyTracks);

  });

}



/** @deprecated use evaluateSuiteOffline("training") */

export function evaluateHallOfFameOffline(): PromptBenchmarkResult[] {

  return evaluateSuiteOffline("training");

}



export function mergeLiveGenerationsForSuite(

  suite: PromptSuiteSplit,

  live: LiveGenerationResult[],

): PromptBenchmarkResult[] {

  const entries = loadPromptSuiteEntries(suite);

  const byId = new Map(live.map((row) => [row.entryId, row]));



  return entries.map((entry, index) => {

    const liveRow = byId.get(entry.id);

    return buildPromptResult(entry, index, liveRow?.tracks ?? [], liveRow);

  });

}



/** @deprecated use mergeLiveGenerationsForSuite("training", live) */

export function mergeLiveGenerations(live: LiveGenerationResult[]): PromptBenchmarkResult[] {

  return mergeLiveGenerationsForSuite("training", live);

}



export function runQualityBenchmarkReport(opts?: {

  mode?: "offline" | "live";

  suite?: PromptSuiteSplit;

  liveResults?: LiveGenerationResult[];

  writeBaseline?: boolean;

  hrpsAvgImprovement?: number | null;

}): QualityBenchmarkReport {

  const suite = opts?.suite ?? "training";

  const negativeSelfTest = evaluateNegativeCorpusSelfTest();

  if (!negativeSelfTest.pass) {

    throw new Error(`Negative corpus self-test failed:\n${negativeSelfTest.failures.join("\n")}`);

  }



  const golden = runGoldenPromptTests();

  const results = opts?.mode === "live" && opts.liveResults

    ? mergeLiveGenerationsForSuite(suite, opts.liveResults)

    : evaluateSuiteOffline(suite);



  const metrics = aggregateBenchmarkMetrics(

    results,

    { passed: golden.passed, failed: golden.failed },

    opts?.hrpsAvgImprovement ?? null,

  );



  if (opts?.writeBaseline) {

    saveQualityBaseline(metrics, `Captured from ${opts?.mode ?? "offline"} ${suite} run`);

  }



  const baseline = loadQualityBaseline();

  const regression = evaluateRegressionGate(metrics, baseline?.metrics ?? null);



  return {

    generatedAt: new Date().toISOString(),

    mode: opts?.mode ?? "offline",

    results,

    metrics,

    regression,

  };

}



export function formatQualityBenchmarkMarkdown(report: QualityBenchmarkReport): string {

  return [

    "# Playlist Quality Regression Report",

    "",

    `Generated: ${report.generatedAt}`,

    `Mode: ${report.mode}`,

    "",

    formatMetricsMarkdown(report.metrics),

    "",

    formatRegressionReport(report.regression),

    "",

    "## Per prompt",

    "",

    ...report.results.map((row) => {

      const bp = row.blindPairwise;

      const op = row.openingFive;

      return [

        `### ${row.entryId}`,

        `- Suite: ${row.suite} · library: ${row.libraryDependency}`,

        `- Category: ${row.category} (${row.difficulty})`,

        `- First attempt: ${row.firstAttempt.outcome} (success=${row.firstAttempt.firstGenerationSuccess})`,

        `- Blind winner: ${bp?.winner ?? "n/a"} (${bp?.confidence != null ? (bp.confidence * 100).toFixed(0) + "%" : "n/a"})`,

        `- Opening pass: ${op?.pass ?? "n/a"} (score ${op?.score ?? "n/a"})`,

        `- Negative failure: ${row.negativeDetection.detected ? row.negativeDetection.failureTypes.join(", ") : "none"}`,

        `- Save likelihood: ${row.saveLikelihood?.toFixed(2) ?? "n/a"}`,

        op?.openerText ? `- Opener: ${op.openerText}` : "",

      ].filter(Boolean).join("\n");

    }),

  ].join("\n");

}

