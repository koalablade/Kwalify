import test from "node:test";
import assert from "node:assert/strict";
import { interpretWorld } from "../lib/world-understanding";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { ANTI_KEYWORD_CASES, WORLD_EVAL_CASES } from "../lib/world-understanding/evaluation-prompts";
import {
  EMOTIONAL_STATES,
  SENSORY_ENTRIES,
  SITUATIONS,
  UK_CULTURAL_ENTRIES,
} from "../lib/world-understanding/rich-knowledge";
import {
  COMMON_LANGUAGE,
  EMOTION_LIBRARY,
  WEATHER_CONTEXTS,
  PLACES,
  ACTIVITY_LIBRARY,
  TIME_CONTEXTS,
  SOCIAL_CONTEXTS,
  MOVEMENTS,
  SENSORY_LANGUAGE,
  MUSIC_DESCRIPTORS,
  UK_CONTEXT,
} from "../lib/world-understanding/universal-knowledge";
import { PHRASES, SCENE_TEMPLATES } from "../lib/world-understanding/knowledge";
import { CONCEPT_GRAPH_NODES, getConceptGraphStats } from "../lib/world-understanding/concept-graph";
import { runMomentCoverageReport } from "../lib/world-understanding/quality-report";

test("world understanding knowledge size meets expansion targets", () => {
  assert.ok(SITUATIONS.length >= 300, `situations ${SITUATIONS.length}`);
  assert.ok(EMOTIONAL_STATES.length >= 200, `emotional states ${EMOTIONAL_STATES.length}`);
  assert.ok(SENSORY_ENTRIES.length >= 300, `sensory ${SENSORY_ENTRIES.length}`);
  assert.ok(UK_CULTURAL_ENTRIES.length >= 50, `uk cultural ${UK_CULTURAL_ENTRIES.length}`);
  assert.ok(PHRASES.length >= 39, `phrases ${PHRASES.length}`);
  assert.ok(SCENE_TEMPLATES.length >= 14, `scenes ${SCENE_TEMPLATES.length}`);
  assert.ok(COMMON_LANGUAGE.length >= 80, `common language ${COMMON_LANGUAGE.length}`);
  assert.ok(EMOTION_LIBRARY.length >= 500, `emotion library ${EMOTION_LIBRARY.length}`);
  assert.ok(WEATHER_CONTEXTS.length >= 60, `weather contexts ${WEATHER_CONTEXTS.length}`);
  assert.ok(PLACES.length >= 100, `places ${PLACES.length}`);
  assert.ok(ACTIVITY_LIBRARY.length >= 80, `activity library ${ACTIVITY_LIBRARY.length}`);
  assert.ok(TIME_CONTEXTS.length >= 50, `time contexts ${TIME_CONTEXTS.length}`);
  assert.ok(SOCIAL_CONTEXTS.length >= 60, `social contexts ${SOCIAL_CONTEXTS.length}`);
  assert.ok(MOVEMENTS.length >= 60, `movements ${MOVEMENTS.length}`);
  assert.ok(SENSORY_LANGUAGE.length >= 100, `sensory language ${SENSORY_LANGUAGE.length}`);
  assert.ok(MUSIC_DESCRIPTORS.length >= 50, `music descriptors ${MUSIC_DESCRIPTORS.length}`);
  assert.ok(UK_CONTEXT.length >= 80, `uk context ${UK_CONTEXT.length}`);
  const graphStats = getConceptGraphStats();
  assert.ok(graphStats.totalNodes >= 700, `concept graph nodes ${graphStats.totalNodes}`);
  assert.equal(graphStats.domains.length, 11, `graph domains ${graphStats.domains.join(",")}`);
});

test("world understanding: deep expansion golden prompts", () => {
  const cases: Array<{ prompt: string; scene: string; emotion: RegExp }> = [
    {
      prompt: "I sat outside my house for 20 minutes because I wasn't ready to go in",
      scene: "REFLECTIVE_AVOIDANCE_JOURNEY",
      emotion: /avoidance|reflection/i,
    },
    {
      prompt: "That first night where your new place finally feels like home",
      scene: "FRESH_START_ALONE",
      emotion: /hope|contentment/i,
    },
    {
      prompt: "The last summer before everyone moved away",
      scene: "SUMMER_TRANSITION",
      emotion: /nostalgia|bittersweet/i,
    },
    {
      prompt: "Driving home after a difficult day, rain on the glass, nowhere to rush to",
      scene: "LATE_NIGHT_SOLITARY_JOURNEY",
      emotion: /reflection|relief|exhaustion/i,
    },
  ];

  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    assert.ok(
      r.scene.id === c.scene || r.debug.matchedConcepts.some((x) => x.startsWith("situation:")),
      `${c.prompt} → ${r.scene.id}`,
    );
    assert.ok(r.taxonomy.emotion.some((e) => c.emotion.test(e)), `${c.prompt} emotions: ${r.taxonomy.emotion}`);
  }
});

test("world understanding: universal language golden prompts", () => {
  const cases: Array<{ prompt: string; scene: string; emotion: RegExp }> = [
    {
      prompt: "Driving home after midnight with the rain coming down",
      scene: "LATE_NIGHT_SOLITARY_JOURNEY",
      emotion: /reflection|peace|calm/i,
    },
    {
      prompt: "The feeling of summer ending",
      scene: "SUMMER_TRANSITION",
      emotion: /nostalgia|bittersweet/i,
    },
    {
      prompt: "Walking around a city when everyone has gone home",
      scene: "DEPARTURE_WALK",
      emotion: /reflection|loneliness|freedom/i,
    },
    {
      prompt: "That weird calm after a party finishes",
      scene: "QUIET_AFTERMATH",
      emotion: /reflection|peace|loneliness/i,
    },
    {
      prompt: "I want music for when you realise your life is changing",
      scene: "FRESH_START_ALONE",
      emotion: /hope|anticipation|anxiety/i,
    },
  ];

  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    assert.ok(
      r.scene.id === c.scene ||
        r.debug.matchedConcepts.some((x) => x.startsWith("language:") || x.startsWith("movement:")),
      `${c.prompt} → ${r.scene.id}`,
    );
    assert.ok(r.taxonomy.emotion.some((e) => c.emotion.test(e)), `${c.prompt} emotions: ${r.taxonomy.emotion}`);
    assert.ok(r.humanMeanings.length > 0 || r.humanNarrative.length > 10, `${c.prompt} missing human meaning`);
  }
});

test("world understanding: short medium long prompt coverage", () => {
  const cases: Array<{ prompt: string; emotion: RegExp; graph?: boolean }> = [
    { prompt: "rainy night", emotion: /reflection|calm|peace/i, graph: true },
    { prompt: "summer memories", emotion: /nostalgia|joy/i, graph: true },
    { prompt: "gym playlist", emotion: /motivation|confidence/i, graph: true },
    { prompt: "driving home", emotion: /reflection|relief|freedom/i, graph: true },
    {
      prompt: "music for walking through the city after midnight",
      emotion: /reflection|freedom|loneliness/i,
      graph: true,
    },
    {
      prompt: "something like my old teenage years",
      emotion: /nostalgia|innocence/i,
      graph: true,
    },
    {
      prompt: "I want something for when you realise life is changing and you don't know where you're going",
      emotion: /hope|anticipation|anxiety/i,
      graph: true,
    },
    {
      prompt: "Driving home after a long day while it rains",
      emotion: /exhaustion|reflection|relief/i,
      graph: true,
    },
    {
      prompt: "Music for when you finally achieve something",
      emotion: /joy|relief|pride/i,
      graph: true,
    },
    {
      prompt: "Walking through my old neighbourhood",
      emotion: /nostalgia|bittersweet/i,
      graph: true,
    },
  ];

  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    assert.ok(r.taxonomy.emotion.some((e) => c.emotion.test(e)), `${c.prompt} → ${r.taxonomy.emotion}`);
    assert.ok(r.confidence >= 0.35, `${c.prompt} low confidence ${r.confidence}`);
    if (c.graph) {
      assert.ok(
        r.debug.matchedConcepts.some((x) => x.startsWith("graph:")) ||
          r.debug.graphMatches?.length,
        `${c.prompt} no graph match`,
      );
    }
  }
});

test("world understanding eval database has 2000 prompts across 27 categories", () => {
  assert.equal(WORLD_EVAL_CASES.length, 2000);
  const expected: Record<string, number> = {
    Driving: 50,
    Weather: 50,
    Relationships: 50,
    Nostalgia: 50,
    "Life changes": 50,
    "UK everyday life": 100,
    "Abstract feelings": 100,
    Places: 50,
    Activities: 50,
    "Everyday language": 75,
    "Music language": 75,
    "Travel and movement": 75,
    "Social moments": 75,
    "Time atmosphere": 75,
    "Sensory moments": 75,
    "Short prompts": 100,
    "Gym and fitness": 100,
    "Gaming and focus": 50,
    Achievement: 50,
    "Memory and neighbourhood": 100,
    "Main character": 75,
    Motivation: 75,
    "Work routine": 75,
    "Human moments": 75,
    "UK extended": 100,
    "Social extended": 100,
    "Travel extended": 100,
  };
  for (const [category, count] of Object.entries(expected)) {
    assert.equal(WORLD_EVAL_CASES.filter((c) => c.category === category).length, count);
  }
});

test("world understanding: anti-keyword implied meaning cases", () => {
  for (const evalCase of ANTI_KEYWORD_CASES) {
    const result = interpretWorld(evalCase.prompt);
    const sceneOk =
      result.scene.id === evalCase.expectedScene ||
      (evalCase.acceptableScenes?.includes(result.scene.id) ?? false);
    assert.ok(sceneOk, `${evalCase.id}: scene ${result.scene.id}`);

    const emotionOk = evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    );
    assert.ok(emotionOk, `${evalCase.id}: emotions ${result.taxonomy.emotion.join(", ")}`);

    const depth =
      result.taxonomy.emotion.length +
      result.taxonomy.lifeContext.length +
      result.taxonomy.sensory.length +
      result.matchedPhrases.length +
      result.fuzzyExpansions.length +
      result.debug.matchedConcepts.filter((c) => c.startsWith("situation:")).length +
      (result.debug.graphMatches?.length ?? 0);
    assert.ok(depth >= 2, `${evalCase.id}: shallow (${depth})`);
  }
});

test("world understanding eval: category pass rates meet minimum thresholds", () => {
  const categoryStats = new Map<string, { total: number; sceneHits: number; emotionHits: number }>();

  for (const evalCase of WORLD_EVAL_CASES) {
    const result = interpretWorld(evalCase.prompt);
    const stats = categoryStats.get(evalCase.category) ?? { total: 0, sceneHits: 0, emotionHits: 0 };
    stats.total += 1;

    if (
      result.scene.id === evalCase.expectedScene ||
      (evalCase.acceptableScenes?.includes(result.scene.id) ?? false)
    ) {
      stats.sceneHits += 1;
    }

    if (
      evalCase.expectedEmotions.some((expected) =>
        result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
      )
    ) {
      stats.emotionHits += 1;
    }

    categoryStats.set(evalCase.category, stats);
  }

  for (const [category, stats] of categoryStats) {
    const sceneRate = stats.sceneHits / stats.total;
    const emotionRate = stats.emotionHits / stats.total;
    assert.ok(sceneRate >= 0.1, `${category} scene rate ${sceneRate.toFixed(2)}`);
    assert.ok(emotionRate >= 0.15, `${category} emotion rate ${emotionRate.toFixed(2)}`);
  }
});

test("world understanding: moment coverage trends toward 95% target", () => {
  const report = runMomentCoverageReport(WORLD_EVAL_CASES.length);
  assert.equal(report.tested, 2000);
  assert.ok(report.momentCoveragePct >= 60, `moment coverage ${report.momentCoveragePct}%`);
  assert.ok(report.sceneAccuracyPct >= 50, `scene accuracy ${report.sceneAccuracyPct}%`);
  assert.ok(report.emotionAccuracyPct >= 70, `emotion accuracy ${report.emotionAccuracyPct}%`);
});

test("world understanding: moment pipeline still includes world layer", () => {
  const pipeline = analyzeMomentPipeline("Empty motorway at midnight, rain on the windscreen");
  assert.ok(pipeline.worldUnderstanding?.sceneGraph);
});
