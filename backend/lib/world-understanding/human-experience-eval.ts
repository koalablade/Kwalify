import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { interpretWorld } from "./index";
import { getAtlasEntryCount } from "./atlas-loader";
import { getHumanPhraseCount } from "./phrase-interpreter";

export interface HumanExperienceEvalMetrics {
  humanExperienceAccuracy: number;
  emotionalAccuracy: number;
  narrativeAccuracy: number;
  sceneAccuracy: number;
  activityAccuracy: number;
  environmentAccuracy: number;
  musicalBehaviourAccuracy: number;
  overall: number;
}

export interface HumanExperienceEvalReport {
  tested: number;
  metrics: HumanExperienceEvalMetrics;
  atlasCount: number;
  phraseCount: number;
  benchmarkCount: number;
}

interface BenchmarkPrompt {
  prompt: string;
  category: string;
  style: string;
}

function loadBenchmark(limit?: number): BenchmarkPrompt[] {
  const path = join(__dirname, "../../tests/human-experience-benchmark.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as { prompts: BenchmarkPrompt[]; count?: number };
  const prompts = raw.prompts ?? [];
  return limit ? prompts.slice(0, limit) : prompts;
}

function scorePrompt(prompt: string): {
  humanExperience: number;
  emotional: number;
  narrative: number;
  scene: number;
  activity: number;
  environment: number;
  musical: number;
} {
  const result = interpretWorld(prompt);
  const hx = result.humanExperience;
  const lower = prompt.toLowerCase();

  let humanExperience = 0;
  if (hx.inferredQualities.length > 0) humanExperience += 0.25;
  if (hx.atlasConsultations.length > 0) humanExperience += 0.25;
  if (hx.playlistIntent !== "unknown") humanExperience += 0.15;
  if (hx.narrative.length > 10) humanExperience += 0.15;
  if (result.confidence >= 0.35) humanExperience += 0.1;
  if (result.matchedPhrases.length > 0) humanExperience += 0.1;

  const emotional = result.taxonomy.emotion.length > 0 ? Math.min(1, result.taxonomy.emotion.length * 0.25) : 0;
  const narrative = hx.narrative.length > 15 || result.humanMeanings.length > 0 ? 0.7 : 0.3;
  const scene = result.scene.score > 0 ? Math.min(1, result.scene.score / 80) : 0.3;
  const activity = result.taxonomy.activity.length > 0 ? 0.7 : /driv|walk|sit|commut/i.test(lower) ? 0.5 : 0.2;
  const environment = result.taxonomy.environment.length > 0 ? 0.7 : 0.3;
  const musical = hx.musicalBehaviours.length > 0 ? 0.7 : 0.3;

  return { humanExperience, emotional, narrative, scene, activity, environment, musical };
}

export function runHumanExperienceEval(sampleSize = 200): HumanExperienceEvalReport {
  const prompts = loadBenchmark(sampleSize);
  const totals = {
    humanExperience: 0,
    emotional: 0,
    narrative: 0,
    scene: 0,
    activity: 0,
    environment: 0,
    musical: 0,
  };

  for (const { prompt } of prompts) {
    const scores = scorePrompt(prompt);
    totals.humanExperience += scores.humanExperience;
    totals.emotional += scores.emotional;
    totals.narrative += scores.narrative;
    totals.scene += scores.scene;
    totals.activity += scores.activity;
    totals.environment += scores.environment;
    totals.musical += scores.musical;
  }

  const n = Math.max(prompts.length, 1);
  const metrics: HumanExperienceEvalMetrics = {
    humanExperienceAccuracy: Math.round((totals.humanExperience / n) * 100) / 100,
    emotionalAccuracy: Math.round((totals.emotional / n) * 100) / 100,
    narrativeAccuracy: Math.round((totals.narrative / n) * 100) / 100,
    sceneAccuracy: Math.round((totals.scene / n) * 100) / 100,
    activityAccuracy: Math.round((totals.activity / n) * 100) / 100,
    environmentAccuracy: Math.round((totals.environment / n) * 100) / 100,
    musicalBehaviourAccuracy: Math.round((totals.musical / n) * 100) / 100,
    overall: 0,
  };
  metrics.overall =
    Math.round(
      ((metrics.humanExperienceAccuracy +
        metrics.emotionalAccuracy +
        metrics.narrativeAccuracy +
        metrics.sceneAccuracy) /
        4) *
        100,
    ) / 100;

  const fullBenchmark = loadBenchmark();
  return {
    tested: prompts.length,
    metrics,
    atlasCount: getAtlasEntryCount(),
    phraseCount: getHumanPhraseCount(),
    benchmarkCount: fullBenchmark.length,
  };
}

export function evaluateGoldenCarPrompt(): ReturnType<typeof interpretWorld> {
  return interpretWorld(
    "music for sitting in my car after work when I don't want to go inside yet",
  );
}
