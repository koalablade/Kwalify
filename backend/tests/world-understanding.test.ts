import test from "node:test";
import assert from "node:assert/strict";
import { interpretWorld } from "../lib/world-understanding";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { ANTI_KEYWORD_CASES, WORLD_EVAL_CASES } from "../lib/world-understanding/evaluation-prompts";

test("world understanding: motorway rain paraphrases resolve to same scene", () => {
  const literal = interpretWorld("rain night motorway");
  const human = interpretWorld(
    "That feeling driving home after midnight when it's raining and the whole world feels quiet",
  );
  const canonical = interpretWorld("Empty motorway at midnight, rain on the windscreen");

  assert.equal(literal.scene.id, "LATE_NIGHT_SOLITARY_JOURNEY");
  assert.equal(human.scene.id, "LATE_NIGHT_SOLITARY_JOURNEY");
  assert.equal(canonical.scene.id, "LATE_NIGHT_SOLITARY_JOURNEY");
  assert.ok(literal.confidence >= 0.4);
  assert.ok(human.confidence >= 0.5);
});

test("world understanding: long way home understands avoidance not keywords", () => {
  const result = interpretWorld(
    "I took the long way home tonight because I wasn't ready to go back yet",
  );
  assert.equal(result.scene.id, "REFLECTIVE_AVOIDANCE_JOURNEY");
  assert.ok(result.taxonomy.emotion.some((e) => /avoidance|reflection/i.test(e)));
  assert.ok(result.taxonomy.lifeContext.some((c) => /transition|space/i.test(c)));
  assert.ok(result.sceneGraph.music.textures.some((t) => /warm|atmospheric|introspective/i.test(t)));
});

test("world understanding: rough night is emotional not meteorological", () => {
  const result = interpretWorld("had a rough night, still processing it");
  assert.ok(result.taxonomy.emotion.some((e) => /exhaust|stress|reflect/i.test(e)));
  assert.ok(
    result.matchedPhrases.some((p) => p.phrase === "rough night") ||
      result.fuzzyExpansions.length > 0,
  );
});

test("world understanding: phrase mappings produce music behaviour", () => {
  const result = interpretWorld("windows down on the coastal drive at sunset");
  assert.ok(result.musicBehaviour.energy >= 0.45);
  assert.ok(result.taxonomy.emotion.some((e) => /freedom/i.test(e)));
});

test("world understanding: moment pipeline includes world layer", () => {
  const prompt = "Empty motorway at midnight, rain on the windscreen";
  const pipeline = analyzeMomentPipeline(prompt);
  assert.ok(pipeline.worldUnderstanding);
  assert.equal(pipeline.worldUnderstanding.scene.id, "LATE_NIGHT_SOLITARY_JOURNEY");
  assert.ok(pipeline.worldUnderstanding.sceneGraph);
  const summary = pipeline.pipelineSummary.worldUnderstanding as Record<string, unknown>;
  assert.equal(summary.sceneId, "LATE_NIGHT_SOLITARY_JOURNEY");
  assert.ok(Array.isArray(summary.emotions));
});

test("world understanding eval database has 300 prompts across 7 categories", () => {
  assert.equal(WORLD_EVAL_CASES.length, 300);
  const expectedCounts: Record<string, number> = {
    DRIVING: 50,
    WEATHER: 30,
    RELATIONSHIPS: 40,
    NOSTALGIA: 40,
    "LIFE EVENTS": 40,
    "UK CULTURE": 50,
    "ABSTRACT EMOTIONS": 50,
  };
  for (const [category, count] of Object.entries(expectedCounts)) {
    assert.equal(
      WORLD_EVAL_CASES.filter((c) => c.category === category).length,
      count,
      `expected ${count} cases for ${category}`,
    );
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

    // Must extract more than bare keywords would give.
    const dimensionCount =
      result.taxonomy.emotion.length +
      result.taxonomy.lifeContext.length +
      result.taxonomy.social.length +
      result.taxonomy.sensory.length +
      result.matchedPhrases.length +
      result.fuzzyExpansions.length;
    assert.ok(dimensionCount >= 2, `${evalCase.id}: too shallow (${dimensionCount})`);
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

    const emotionHit = evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    );
    if (emotionHit) stats.emotionHits += 1;

    const music = evalCase.expectedMusicBehaviour;
    if (music.maxEnergy != null) {
      assert.ok(
        result.musicBehaviour.energy <= music.maxEnergy + 0.15,
        `${evalCase.id}: energy ${result.musicBehaviour.energy} > ${music.maxEnergy}`,
      );
    }
    if (music.minEnergy != null) {
      assert.ok(
        result.musicBehaviour.energy >= music.minEnergy - 0.1,
        `${evalCase.id}: energy ${result.musicBehaviour.energy} < ${music.minEnergy}`,
      );
    }
    if (music.genres?.length) {
      const overlap = music.genres.some((g) =>
        result.musicBehaviour.preferredGenres.some((p) => p.toLowerCase().includes(g)),
      );
      assert.ok(overlap, `${evalCase.id}: expected genre overlap`);
    }

    categoryStats.set(evalCase.category, stats);
  }

  for (const [category, stats] of categoryStats) {
    const sceneRate = stats.sceneHits / stats.total;
    const emotionRate = stats.emotionHits / stats.total;
    assert.ok(sceneRate >= 0.12, `${category} scene rate ${sceneRate.toFixed(2)} too low`);
    const emotionThreshold = category === "ABSTRACT EMOTIONS" ? 0.15 : 0.2;
    assert.ok(emotionRate >= emotionThreshold, `${category} emotion rate ${emotionRate.toFixed(2)} too low`);
  }
});
