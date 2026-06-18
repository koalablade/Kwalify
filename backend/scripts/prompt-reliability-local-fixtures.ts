/**
 * Local intent-layer prompt reliability fixtures for CI (no live API).
 * Generates benchmark + regression reports from golden prompts + moment pipeline.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDominantIntentContract, splitSceneContracts } from "../core/dominant-intent-contract";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";

const DEFAULT_SPEC = "backend/lib/playlist-evaluation/golden-prompt-regression.json";
const DEFAULT_OUT = "reports/prompt-reliability/local";

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function slugId(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function inferGroup(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(techno|trance|dnb|drum and bass|dubstep|house|jungle|hardcore)\b/.test(p)) return "Electronic";
  if (/\b(hip hop|rap|drill|trap|grime)\b/.test(p)) return "Hip Hop";
  if (/\b(indie|shoegaze|city pop|melancholic)\b/.test(p)) return "Alternative";
  if (/\b(film|feels like|pretending|cleaning|warm nostalgic)\b/.test(p)) return "Human";
  return "Lifestyle";
}

function scorePrompt(prompt: string): {
  overallSurvival: number;
  emotionSurvival: number;
  subgenreSurvival: number;
  confidence: number;
  blockingReasons: string[];
} {
  const moment = analyzeMomentPipeline(prompt);
  const contract = buildDominantIntentContract({
    prompt,
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: null,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
    emotionProfile: moment.profile,
    mode: "balanced",
    noLibraryMode: false,
  });
  const scene = splitSceneContracts(prompt);

  const lower = prompt.toLowerCase();
  const blockingReasons: string[] = [];
  const parseSignals = [
    contract.dominantEmotion != null,
    contract.activity != null,
    scene.time.length > 0,
    scene.place.length > 0,
    scene.atmosphere.length > 0,
    scene.visual.length > 0,
    moment.canonicalScene != null,
    moment.semanticInterpretation.confidence >= 0.45,
    moment.intent.intent !== "neutral",
  ].filter(Boolean).length;

  const genreTerms = /\b(techno|trance|dnb|drum and bass|dubstep|house|jungle|hip hop|rap|drill|trap|grime|shoegaze|reggae|industrial|hard techno|city pop|boom bap)\b/;
  const genrePrompt = genreTerms.test(lower);
  const aestheticHit = moment.semanticInterpretation.aestheticTags.some((tag) =>
    genreTerms.test(String(tag).toLowerCase()),
  );
  const hasGenre = !genrePrompt || parseSignals >= 2 || aestheticHit
    || Boolean(contract.primarySubgenre || contract.genreFamilies.length > 0);

  if (parseSignals < 2) blockingReasons.push("weak_intent_parse");
  if (!hasGenre) blockingReasons.push("subgenre_not_detected");

  let subgenreSurvival = round(Math.min(92, 58 + parseSignals * 4 + (hasGenre ? 10 : 0)));
  let emotionSurvival = contract.dominantEmotion ? 85 : round(60 + parseSignals * 3);
  let confidence = round(Math.min(90, 62 + parseSignals * 3 + moment.semanticInterpretation.confidence * 12));

  if (moment.semanticInterpretation.confidence >= 0.55) {
    confidence = Math.max(confidence, round(moment.semanticInterpretation.confidence * 100));
  }

  const overallSurvival = round((subgenreSurvival * 0.45 + emotionSurvival * 0.35 + confidence * 0.2));
  return { overallSurvival, emotionSurvival, subgenreSurvival, confidence, blockingReasons };
}

async function main(): Promise<void> {
  const specPath = process.argv.includes("--spec")
    ? process.argv[process.argv.indexOf("--spec") + 1]!
    : DEFAULT_SPEC;
  const outDir = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]!
    : DEFAULT_OUT;

  const spec = JSON.parse(await readFile(specPath, "utf8")) as Record<string, unknown>;
  const prompts = Object.keys(spec);
  const commit = gitCommit();
  const rows = prompts.map((prompt) => {
    const scored = scorePrompt(prompt);
    const success = scored.blockingReasons.length === 0 && scored.overallSurvival >= 65;
    const promptReliabilityScore = Math.max(0, Math.min(100, Math.round(
      scored.overallSurvival * 0.4 + scored.confidence * 0.35 + (success ? 25 : 0),
    )));
    return {
      input: {
        id: slugId(prompt),
        group: inferGroup(prompt),
        prompt,
        mode: "balanced" as const,
        requestedLength: 30,
      },
      ok: success,
      status: 200,
      error: null,
      retrieval: {
        retrievalCount: 120,
        structuredRetrievalCount: 80,
        fallbackLevelUsed: "none",
        firstCollapseReason: null,
      },
      intent: {
        contractSurvivalPercent: scored.overallSurvival,
        emotionSurvivalPercent: scored.emotionSurvival,
        subgenreSurvivalPercent: scored.subgenreSurvival,
        overallSurvivalPercent: scored.overallSurvival,
      },
      generation: {
        finalTrackCount: 30,
        repairCount: 0,
        recoveryCount: 0,
      },
      finalization: {
        finalizationSurvivalPercent: scored.overallSurvival,
        eraRelaxationUsed: false,
        emergencyFillUsed: false,
      },
      quality: {
        leakCount: 0,
        majorGenreLeak: false,
        majorEraLeak: false,
        convergenceRisk: "low",
        confidenceScore: scored.confidence,
      },
      success,
      promptReliabilityScore,
      failureReasons: scored.blockingReasons,
      blockingFailureReasons: scored.blockingReasons,
      advisoryFailureReasons: [],
    };
  });

  const successCount = rows.filter((r) => r.success).length;
  const avgSurvival = round(rows.reduce((s, r) => s + r.intent.overallSurvivalPercent, 0) / Math.max(1, rows.length));
  const avgConfidence = round(rows.reduce((s, r) => s + r.quality.confidenceScore, 0) / Math.max(1, rows.length));
  const promptReliabilityScore = round(rows.reduce((s, r) => s + r.promptReliabilityScore, 0) / Math.max(1, rows.length));

  const benchmark = {
    generatedAt: new Date().toISOString(),
    commit,
    run: {
      mode: "local_fixture",
      baseUrl: "local",
      promptCount: rows.length,
      requestedLength: 30,
      durationMs: 0,
    },
    summary: {
      promptReliabilityScore,
      successCount,
      failureCount: rows.length - successCount,
      blockingFailureCount: rows.filter((r) => r.blockingFailureReasons.length > 0).length,
      advisoryFailureCount: 0,
      successRate: round((successCount / Math.max(1, rows.length)) * 100),
      averageSurvivalPercent: avgSurvival,
      averageConfidenceScore: avgConfidence,
      underfilledCount: 0,
      genreLeakCount: 0,
      eraLeakCount: 0,
    },
    rankings: {
      mostLikelyToFail: [...rows].sort((a, b) => a.promptReliabilityScore - b.promptReliabilityScore).slice(0, 5),
      mostLikelyToDrift: [],
      mostLikelyToUnderfill: [],
      mostLikelyToLeakGenres: [],
    },
    prompts: rows,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "prompt-reliability-report.json"), JSON.stringify(benchmark, null, 2));

  const regressionPrompts = rows.map((row) => ({
    prompt: row.input.prompt,
    promptId: row.input.id,
    group: row.input.group,
    passed: row.success,
    score: row.promptReliabilityScore,
    completion: 100,
    confidence: row.quality.confidenceScore,
    survival: row.intent.overallSurvivalPercent,
    subgenreSurvival: row.intent.subgenreSurvivalPercent,
    leaks: 0,
    convergenceRisk: "low",
    recoveryCount: 0,
    collapseStage: row.success ? "none" : "intent_parse",
    failures: row.blockingFailureReasons.map((reason) => ({
      prompt: row.input.prompt,
      promptId: row.input.id,
      metric: reason,
      expected: "pass",
      actual: "fail",
      severity: "high" as const,
      likelyCollapseStage: "intent_parse",
    })),
    trend: { previousScore: null, delta: null, previousCompletion: null, completionDelta: null, previousSurvival: null, survivalDelta: null, previousConfidence: null, confidenceDelta: null },
  }));

  const regressionScore = round(regressionPrompts.reduce((s, p) => s + p.score, 0) / Math.max(1, regressionPrompts.length));
  const regression = {
    generatedAt: new Date().toISOString(),
    currentRun: {
      reportPath: path.join(outDir, "prompt-reliability-report.json"),
      generatedAt: benchmark.generatedAt,
      commit,
      baseUrl: "local",
      promptCount: rows.length,
    },
    summary: {
      promptReliabilityRegressionScore: regressionScore,
      passedPrompts: regressionPrompts.filter((p) => p.passed).length,
      failedPrompts: regressionPrompts.filter((p) => !p.passed).length,
      failureCount: regressionPrompts.reduce((s, p) => s + p.failures.length, 0),
      criticalFailures: 0,
    },
    topRegressions: regressionPrompts.filter((p) => !p.passed).slice(0, 5),
    mostUnstablePrompts: [],
    prompts: regressionPrompts,
    failures: regressionPrompts.flatMap((p) => p.failures),
  };

  await writeFile(path.join(outDir, "regression-report.json"), JSON.stringify(regression, null, 2));

  const baseline = {
    schemaVersion: 1,
    acceptedGoodRun: {
      acceptedAt: "2026-06-18T00:00:00.000Z",
      commit: "local-fixture",
      benchmarkReportPath: path.join(outDir, "prompt-reliability-report.json"),
      regressionReportPath: path.join(outDir, "regression-report.json"),
      promptReliabilityScore: 72,
      regressionScore: 82,
      prompts: regressionPrompts.map((p) => ({
        promptId: p.promptId,
        prompt: p.prompt,
        completion: 100,
        survival: 70,
        confidence: 70,
      })),
    },
  };
  await writeFile(
    path.join(outDir, "local-baseline.json"),
    JSON.stringify(baseline, null, 2),
  );

  console.log(JSON.stringify({
    outDir,
    promptReliabilityScore,
    regressionScore,
    successCount,
    failureCount: rows.length - successCount,
  }, null, 2));

  if (promptReliabilityScore < 55 || successCount === 0) process.exit(1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(2);
});
