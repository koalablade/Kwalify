/**
 * Multi-dimensional semantic moment evaluation — independent dimension scores.
 */

import { interpretWorld } from "./index";
import { summariseFingerprintDimensions, type SemanticMomentFingerprint } from "./moment-representation";
import { WORLD_EVAL_CASES } from "./evaluation-prompts";

export type SemanticDimension =
  | "activity"
  | "environment"
  | "weather"
  | "time"
  | "social"
  | "lifeEvent"
  | "emotion"
  | "narrative"
  | "sensory"
  | "sharedMemory"
  | "playlistIntent"
  | "emotionalArc"
  | "humanExperience"
  | "playlistDirection"
  | "overall";

export interface SemanticDimensionScore {
  dimension: SemanticDimension;
  score: number;
  populated: boolean;
  sample: string[];
}

export interface SemanticEvalCaseResult {
  prompt: string;
  category: string;
  dimensions: SemanticDimensionScore[];
  sceneId: string;
  sceneAccuracy: boolean;
  fingerprintConfidence: number;
}

export interface SemanticEvalReport {
  tested: number;
  dimensionAverages: Record<SemanticDimension, number>;
  sceneAccuracyPct: number;
  overallMomentPct: number;
  failuresByDimension: Record<SemanticDimension, number>;
  sampleFailures: SemanticEvalCaseResult[];
}

const DIMENSION_MIN_VALUES: Record<Exclude<SemanticDimension, "overall">, number> = {
  activity: 1,
  environment: 1,
  weather: 0,
  time: 0,
  social: 0,
  lifeEvent: 0,
  emotion: 1,
  narrative: 0,
  sensory: 0,
  sharedMemory: 0,
  playlistIntent: 1,
  emotionalArc: 1,
  humanExperience: 1,
  playlistDirection: 1,
};

function scoreDimension(
  dimension: Exclude<SemanticDimension, "overall">,
  values: string[],
  fp: SemanticMomentFingerprint,
): SemanticDimensionScore {
  const minExpected = DIMENSION_MIN_VALUES[dimension];
  const populated = values.length >= minExpected;
  let score = 0;
  if (values.length > 0) score += 0.5;
  if (values.length >= minExpected) score += 0.35;
  if (fp.confidence >= 0.35) score += 0.15;
  return {
    dimension,
    score: Math.min(1, score),
    populated,
    sample: values.slice(0, 4),
  };
}

function evaluateCase(
  prompt: string,
  category: string,
  expectedScene?: string,
  acceptableScenes?: string[],
): SemanticEvalCaseResult {
  const result = interpretWorld(prompt);
  const fp = result.semanticMoment;
  const dims = summariseFingerprintDimensions(fp);

  const dimensions: SemanticDimensionScore[] = [
    scoreDimension("activity", dims.activity, fp),
    scoreDimension("environment", dims.environment, fp),
    scoreDimension("weather", dims.weather, fp),
    scoreDimension("time", dims.time, fp),
    scoreDimension("social", dims.social, fp),
    scoreDimension("lifeEvent", dims.lifeEvent, fp),
    scoreDimension("emotion", dims.emotion, fp),
    scoreDimension("narrative", dims.narrative, fp),
    scoreDimension("sensory", dims.sensory, fp),
    scoreDimension(
      "sharedMemory",
      result.humanExperience.sharedMemories,
      fp,
    ),
    scoreDimension(
      "playlistIntent",
      result.humanExperience.playlistIntent !== "unknown"
        ? [result.humanExperience.playlistIntent]
        : [],
      fp,
    ),
    scoreDimension(
      "emotionalArc",
      result.emotionalArc.summary ? [result.emotionalArc.summary] : [],
      fp,
    ),
    scoreDimension(
      "humanExperience",
      result.humanExperience.inferredQualities,
      fp,
    ),
    scoreDimension("playlistDirection", dims.playlistDirection, fp),
  ];

  const coreAvg =
    dimensions.reduce((s, d) => s + d.score, 0) / Math.max(1, dimensions.length);
  dimensions.push({
    dimension: "overall",
    score: coreAvg,
    populated: coreAvg >= 0.5,
    sample: [fp.sceneOutput.label],
  });

  const sceneOk =
    !expectedScene ||
    result.scene.id === expectedScene ||
    (acceptableScenes?.includes(result.scene.id) ?? false);

  return {
    prompt,
    category,
    dimensions,
    sceneId: result.scene.id,
    sceneAccuracy: sceneOk,
    fingerprintConfidence: fp.confidence,
  };
}

export function runSemanticMomentEval(sampleSize = WORLD_EVAL_CASES.length): SemanticEvalReport {
  const cases = WORLD_EVAL_CASES.slice(0, sampleSize);
  const dimensionTotals: Record<SemanticDimension, number> = {
    activity: 0,
    environment: 0,
    weather: 0,
    time: 0,
    social: 0,
    lifeEvent: 0,
    emotion: 0,
    narrative: 0,
    sensory: 0,
    sharedMemory: 0,
    playlistIntent: 0,
    emotionalArc: 0,
    humanExperience: 0,
    playlistDirection: 0,
    overall: 0,
  };
  const failuresByDimension: Record<SemanticDimension, number> = { ...dimensionTotals };
  let sceneHits = 0;
  let overallHits = 0;
  const sampleFailures: SemanticEvalCaseResult[] = [];

  for (const evalCase of cases) {
    const row = evaluateCase(
      evalCase.prompt,
      evalCase.category,
      evalCase.expectedScene,
      evalCase.acceptableScenes,
    );
    if (row.sceneAccuracy) sceneHits += 1;
    if (row.dimensions.find((d) => d.dimension === "overall")!.score >= 0.55) {
      overallHits += 1;
    }

    for (const d of row.dimensions) {
      dimensionTotals[d.dimension] += d.score;
      if (!d.populated || d.score < 0.45) {
        failuresByDimension[d.dimension] += 1;
        if (sampleFailures.length < 12 && d.dimension === "overall") {
          sampleFailures.push(row);
        }
      }
    }
  }

  const tested = cases.length;
  const dimensionAverages = Object.fromEntries(
    Object.entries(dimensionTotals).map(([k, v]) => [
      k,
      Math.round((v / tested) * 1000) / 1000,
    ]),
  ) as Record<SemanticDimension, number>;

  return {
    tested,
    dimensionAverages,
    sceneAccuracyPct: Math.round((sceneHits / tested) * 1000) / 10,
    overallMomentPct: Math.round((overallHits / tested) * 1000) / 10,
    failuresByDimension,
    sampleFailures,
  };
}

export function evaluateGoldenPrompt(prompt: string): SemanticEvalCaseResult {
  return evaluateCase(prompt, "golden");
}
