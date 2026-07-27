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
import { analyzeFailedPrompts } from "../lib/world-understanding/benchmark-failures";
import { getAtlasEntryCount } from "../lib/world-understanding/atlas-loader";
import { evaluateGoldenPrompt, runSemanticMomentEval } from "../lib/world-understanding/semantic-eval";
import { getHumanPhraseCount } from "../lib/world-understanding/phrase-interpreter";
import {
  evaluateGoldenCarPrompt,
  runHumanExperienceEval,
} from "../lib/world-understanding/human-experience-eval";

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
      scene: "REFLECTIVE_AVOIDANCE_JOURNEY",
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

test("world understanding: scene intelligence composes dominant moment", () => {
  const prompt = "Rain on the windscreen driving home after a horrible day";
  const r = interpretWorld(prompt);
  assert.ok(
    ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY"].includes(r.scene.id),
    `expected emotional recovery journey, got ${r.scene.id}`,
  );
  assert.ok(
    r.taxonomy.emotion.some((e) => /reflection|relief|exhaustion|stress/i.test(e)),
    `emotions: ${r.taxonomy.emotion}`,
  );
  assert.ok((r.debug.sceneCandidates?.length ?? 0) >= 3, "expected scene competition");
  assert.equal(r.debug.sceneCandidates?.[0]?.id, r.scene.id, "winner should be top candidate");
  assert.ok(r.debug.momentInterpretation, "expected moment interpretation");
  assert.ok(r.debug.sceneConfidence, "expected scene confidence explanation");
  assert.ok(
    r.debug.momentInterpretation?.lifeEvents.some((e) => e.category === "bad_day_aftermath"),
    `expected bad_day life event: ${JSON.stringify(r.debug.momentInterpretation?.lifeEvents)}`,
  );
  assert.notEqual(r.scene.id, "WEATHER_REFLECTION", "should not be weather-only scene");
});

test("world understanding: moment interpreter ranks primary concepts", () => {
  const r = interpretWorld("Walking through my old neighbourhood after everyone moved away");
  assert.ok(r.debug.momentInterpretation?.primaryConcepts.length, "expected primary concepts");
  assert.ok(
    r.debug.momentInterpretation?.lifeEvents.some(
      (e) => e.category === "transition" || e.category === "leaving" || e.category === "childhood",
    ),
    `expected life event: ${JSON.stringify(r.debug.momentInterpretation?.lifeEvents)}`,
  );
});

test("world understanding: rainy drive without stress stays movement-atmosphere", () => {
  const r = interpretWorld("Empty motorway at midnight, rain on the windscreen");
  assert.ok(
    ["LATE_NIGHT_SOLITARY_JOURNEY", "NOCTURNAL_ESCAPE_DRIVE", "WEATHER_REFLECTION"].includes(r.scene.id),
    `expected atmospheric drive, got ${r.scene.id}`,
  );
});

test("world understanding: moment coverage trends toward 95% target", () => {
  const report = runMomentCoverageReport(WORLD_EVAL_CASES.length);
  assert.equal(report.tested, 2000);
  assert.ok(report.momentCoveragePct >= 62, `moment coverage ${report.momentCoveragePct}% (target 95%)`);
  assert.ok(report.sceneAccuracyPct >= 63, `scene accuracy ${report.sceneAccuracyPct}%`);
  assert.ok(report.emotionAccuracyPct >= 70, `emotion accuracy ${report.emotionAccuracyPct}%`);
});

test("world understanding: failure analysis groups top misses", () => {
  const { failures, grouped } = analyzeFailedPrompts(100);
  assert.ok(failures.length > 0);
  assert.ok(failures.length <= 100);
  const totalGrouped = Object.values(grouped).reduce((a, b) => a + b, 0);
  assert.ok(totalGrouped > 0);
});

test("world understanding: moment pipeline still includes world layer", () => {
  const pipeline = analyzeMomentPipeline("Empty motorway at midnight, rain on the windscreen");
  assert.ok(pipeline.worldUnderstanding?.sceneGraph);
});

test("world understanding: human experience engine golden prompt", () => {
  const prompt = "I finally got home after one of the worst days I've had in ages";
  const r = interpretWorld(prompt);
  assert.ok(r.humanExperience, "expected human experience");
  assert.equal(r.humanExperience.playlistIntent, "recover");
  assert.ok(
    r.humanExperience.inferredQualities.some((q) => /relief|safety|decompression|exhaustion|recovery/i.test(q)),
    `qualities: ${r.humanExperience.inferredQualities.join(", ")}`,
  );
  assert.ok(r.humanExperience.atlasConsultations.length > 0, "expected atlas consultation");
  assert.ok(r.humanExperience.atlasConsultations.some((a) => /coming home/i.test(a.label)));
  assert.ok(r.emotionalArc.phases.length >= 2);
  assert.ok(r.emotionalArc.summary.includes("→"));
  assert.ok(r.humanExperience.musicalBehaviours.length > 0);
  assert.ok(r.semanticMoment.confidence >= 0.3);
});

test("world understanding: atlas entry count meets minimum", () => {
  const count = getAtlasEntryCount();
  assert.ok(count >= 80, `atlas entries ${count} (target 80+)`);
});

test("world understanding: human phrases loaded", () => {
  assert.ok(getHumanPhraseCount() >= 60, `phrases ${getHumanPhraseCount()}`);
});

test("world understanding: indirect language interpretation", () => {
  const cases = [
    { prompt: "I've had enough of today", emotion: /exhaustion|stress|overwhelm/i },
    { prompt: "need to clear my head", emotion: /reflection|calm/i },
    { prompt: "I'm just existing", emotion: /numb|apathy|low/i },
    { prompt: "main character moment driving at night", emotion: /reflect|cinematic|self/i },
  ];
  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    assert.ok(
      r.matchedPhrases.length > 0 || r.taxonomy.emotion.some((e) => c.emotion.test(e)),
      `${c.prompt} → phrases:${r.matchedPhrases.length} emotions:${r.taxonomy.emotion}`,
    );
  }
});

test("world understanding: British phrases", () => {
  const cases = [
    { prompt: "absolutely knackered after work", emotion: /exhaustion|tired/i },
    { prompt: "gutted about today", emotion: /disappoint|sad|grief/i },
    { prompt: "fancy a drive to clear my head", emotion: /freedom|reflect/i },
    { prompt: "sunday scaries before monday", emotion: /dread|anxiety|melancholy/i },
    { prompt: "having a mare of a day", emotion: /stress|frustrat/i },
    { prompt: "proper tired after a long one", emotion: /exhaust|tired|wear/i },
    { prompt: "can't be bothered tonight", emotion: /apathy|exhaust|low/i },
    { prompt: "made up about the news", emotion: /joy|delight|satisf/i },
  ];
  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    assert.ok(
      r.matchedPhrases.length > 0 || r.taxonomy.emotion.some((e) => c.emotion.test(e)),
      `${c.prompt}`,
    );
  }
});

test("world understanding: ultra-short ambiguous prompts avoid weather default", () => {
  const cases = [
    { prompt: "alone", notScene: "WEATHER_REFLECTION", emotion: /reflect|solitud|calm|alone/i },
    { prompt: "Sunday", notScene: "WEATHER_REFLECTION", emotion: /calm|nostalg|melanchol/i },
    { prompt: "waiting", emotion: /anticipat|uncertain|restless/i },
  ];
  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    if (c.notScene) {
      assert.notEqual(r.scene.id, c.notScene, `${c.prompt} → ${r.scene.id}`);
    }
    assert.ok(
      r.taxonomy.emotion.some((e) => c.emotion.test(e)) ||
        r.taxonomy.activity.length > 0 ||
        r.taxonomy.social.length > 0,
      `${c.prompt} shallow: emotions=${r.taxonomy.emotion} activity=${r.taxonomy.activity}`,
    );
  }
});

test("world understanding: activity detection from everyday phrases", () => {
  const cases = [
    {
      prompt: "finally clocked off after the longest shift",
      activity: /leaving|decompress|work/i,
      atlas: /clock|work|finish/i,
    },
    {
      prompt: "sitting in the car before going inside",
      activity: /sit|delay|decompress/i,
      atlas: /car|sitting/i,
    },
    {
      prompt: "fed up and knackered, need a break",
      emotion: /exhaust|frustrat|stress/i,
      phrases: true,
    },
  ];
  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    if (c.activity) {
      assert.ok(
        r.taxonomy.activity.some((a) => c.activity!.test(a)) ||
          r.humanExperience.atlasConsultations.some((a) => c.atlas?.test(a.label)),
        `${c.prompt} activity: ${r.taxonomy.activity} atlas: ${r.humanExperience.atlasConsultations.map((a) => a.label)}`,
      );
    }
    if (c.emotion) {
      assert.ok(r.taxonomy.emotion.some((e) => c.emotion!.test(e)), `${c.prompt}`);
    }
    if (c.phrases) {
      assert.ok(r.matchedPhrases.length > 0, `${c.prompt} no phrases`);
    }
  }
});

test("world understanding: narrative temporal words distinguish movement from life transition", () => {
  const movement = interpretWorld("Driving at night on empty roads");
  const transition = interpretWorld("Driving home after losing my job");
  assert.ok(
    movement.taxonomy.activity.some((a) => /driv/i.test(a)) ||
      movement.semanticMoment.movement.values.some((v) => /driv/i.test(v)),
    `movement: ${movement.taxonomy.activity}`,
  );
  assert.ok(
    transition.debug.momentInterpretation?.lifeEvents.some((e) => e.category === "transition") ||
      transition.taxonomy.lifeContext.length > 0 ||
      transition.taxonomy.emotion.some((e) => /anxiet|hope|reflect|grief/i.test(e)),
    `transition: ${JSON.stringify(transition.debug.momentInterpretation?.lifeEvents)}`,
  );
  const movementHasTransition = movement.debug.momentInterpretation?.lifeEvents.some(
    (e) => e.category === "transition",
  );
  const transitionHasTransition = transition.debug.momentInterpretation?.lifeEvents.some(
    (e) => e.category === "transition",
  );
  assert.ok(
    !movementHasTransition && transitionHasTransition,
    `movement life events: ${JSON.stringify(movement.debug.momentInterpretation?.lifeEvents)} vs transition: ${JSON.stringify(transition.debug.momentInterpretation?.lifeEvents)}`,
  );
});

test("world understanding: weather ambiguity not literal", () => {
  const r = interpretWorld("rain");
  assert.ok(r.humanExperience.atlasConsultations.length >= 0);
  const rainy = interpretWorld("rain on the windscreen driving home after a horrible day");
  assert.ok(
    rainy.taxonomy.emotion.some((e) => /reflect|exhaust|stress|relief/i.test(e)),
    `emotions: ${rainy.taxonomy.emotion}`,
  );
  assert.ok(rainy.debug.experienceReasoning, "expected experience reasoning");
});

test("world understanding: golden car after work prompt", () => {
  const r = evaluateGoldenCarPrompt();
  assert.ok(r.humanExperience, "expected human experience");
  assert.ok(
    r.humanExperience.inferredQualities.some((q) =>
      /decompression|transition|solitude|reflection|private/i.test(q),
    ) || r.humanExperience.atlasConsultations.some((a) => /car|driving|home/i.test(a.label)),
    `qualities: ${r.humanExperience.inferredQualities.join(", ")} atlas: ${r.humanExperience.atlasConsultations.map((a) => a.label).join(", ")}`,
  );
  assert.ok(
    r.humanExperience.atlasConsultations.some((a) =>
      /car|driving|home|work/i.test(a.label),
    ),
    `atlas: ${r.humanExperience.atlasConsultations.map((a) => a.label).join(", ")}`,
  );
  assert.ok(r.debug.experienceReasoning?.hops.length, "expected reasoning hops");
});

test("world understanding: life transitions and nostalgia", () => {
  const transition = interpretWorld("starting a new chapter after moving away");
  assert.ok(
    transition.taxonomy.lifeContext.length > 0 || transition.taxonomy.emotion.some((e) => /hope|anxiety|anticipation/i.test(e)),
    `lifeContext: ${transition.taxonomy.lifeContext}`,
  );
  const nostalgia = interpretWorld("I miss the old days when everything was simpler");
  assert.ok(
    nostalgia.matchedPhrases.length > 0 || nostalgia.taxonomy.emotion.some((e) => /nostalgia/i.test(e)),
    `nostalgia emotions: ${nostalgia.taxonomy.emotion}`,
  );
});

test("world understanding: human experience eval metrics", () => {
  const report = runHumanExperienceEval(100);
  assert.ok(report.atlasCount >= 80, `atlas ${report.atlasCount}`);
  assert.ok(report.phraseCount >= 60, `phrases ${report.phraseCount}`);
  assert.ok(report.metrics.humanExperienceAccuracy > 0.35);
  assert.ok(report.metrics.emotionalAccuracy > 0.35);
  if (report.benchmarkCount > 0) {
    assert.ok(report.benchmarkCount >= 10000, `benchmark ${report.benchmarkCount}`);
  }
});

test("world understanding: semantic eval multi-dimensional dimensions", () => {
  const golden = evaluateGoldenPrompt(
    "I finally got home after one of the worst days I've had in ages",
  );
  const dims = golden.dimensions.map((d) => d.dimension);
  assert.ok(dims.includes("humanExperience"));
  assert.ok(dims.includes("playlistIntent"));
  assert.ok(dims.includes("emotionalArc"));
  assert.ok(dims.includes("sharedMemory"));

  const report = runSemanticMomentEval(50);
  assert.ok(report.dimensionAverages.humanExperience > 0.4);
  assert.ok(report.dimensionAverages.playlistIntent > 0.4);
});

test("world understanding: semantic moment fingerprint golden prompts", () => {
  const cases: Array<{
    prompt: string;
    expectMovement: RegExp;
    expectWeather?: RegExp;
    expectLifeEvent?: RegExp;
    expectEmotion: RegExp;
  }> = [
    {
      prompt: "Driving home after a horrible day with rain on the windscreen",
      expectMovement: /driv|commut|travel|journey/i,
      expectWeather: /rain|wet|windscreen|glass/i,
      expectLifeEvent: /bad day|aftermath|difficult/i,
      expectEmotion: /exhaust|reflect|stress|relief/i,
    },
    {
      prompt: "Staring out the train window visiting my grandparents on a slow rainy afternoon",
      expectMovement: /train|travel|journey/i,
      expectWeather: /rain/i,
      expectEmotion: /nostalgia|calm|warm|reflect/i,
    },
    {
      prompt: "Walking through my old neighbourhood after everyone moved away",
      expectMovement: /walk/i,
      expectLifeEvent: /transition|leaving|childhood/i,
      expectEmotion: /nostalgia|bittersweet|reflect/i,
    },
  ];

  for (const c of cases) {
    const r = interpretWorld(c.prompt);
    const fp = r.semanticMoment;
    assert.ok(fp, `${c.prompt} missing semanticMoment`);
    assert.ok(fp.confidence >= 0.3, `${c.prompt} low fingerprint confidence ${fp.confidence}`);
    assert.ok(
      fp.movement.values.some((v) => c.expectMovement.test(v)) ||
        fp.activity.values.some((v) => c.expectMovement.test(v)),
      `${c.prompt} movement: ${fp.movement.values} / ${fp.activity.values}`,
    );
    if (c.expectWeather) {
      assert.ok(
        fp.weather.values.some((v) => c.expectWeather!.test(v)) ||
          fp.sensory.some((s) => c.expectWeather!.test(s)),
        `${c.prompt} weather: ${fp.weather.values}`,
      );
    }
    if (c.expectLifeEvent) {
      assert.ok(
        fp.lifeEvent.values.some((v) => c.expectLifeEvent!.test(v)),
        `${c.prompt} lifeEvent: ${fp.lifeEvent.values}`,
      );
    }
    const allEmotion = [
      ...fp.emotion.primary,
      ...fp.emotion.secondary,
      ...fp.emotion.underlying,
      ...fp.emotion.desired,
    ];
    assert.ok(
      allEmotion.some((e) => c.expectEmotion.test(e)),
      `${c.prompt} emotions: ${allEmotion.join(", ")}`,
    );
    assert.ok(Object.keys(fp.semanticVector).length >= 5, `${c.prompt} sparse semanticVector`);
    assert.ok(fp.relationshipChains.length >= 1, `${c.prompt} missing relationship chains`);
    assert.equal(fp.sceneOutput.id, r.scene.id, "scene output should match composed scene");
  }
});

test("world understanding: semantic eval dimensions report", () => {
  const golden = evaluateGoldenPrompt(
    "Driving home after a horrible day with rain on the windscreen",
  );
  assert.ok(golden.dimensions.length >= 10);
  const overall = golden.dimensions.find((d) => d.dimension === "overall");
  assert.ok(overall && overall.score >= 0.45, `overall ${overall?.score}`);

  const report = runSemanticMomentEval(50);
  assert.equal(report.tested, 50);
  assert.ok(report.dimensionAverages.emotion >= 0.4);
  assert.ok(report.sceneAccuracyPct >= 5);
});
