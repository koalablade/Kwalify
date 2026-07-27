import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(join(root, ".."));

const { getWorldKnowledgeStats, runWorldUnderstandingQualitySample, runMomentCoverageReport } = await import(
  "../dist/lib/world-understanding/quality-report.js"
);
const { interpretWorld } = await import("../dist/lib/world-understanding/index.js");
const { WORLD_EVAL_CASES } = await import("../dist/lib/world-understanding/evaluation-prompts.js");

const quality = runWorldUnderstandingQualitySample(WORLD_EVAL_CASES.length);
const coverage = runMomentCoverageReport(WORLD_EVAL_CASES.length);

const stats = getWorldKnowledgeStats();

const golden = [
  "I sat outside my house for 20 minutes because I wasn't ready to go in",
  "That first night where your new place finally feels like home",
  "Walking home after everyone has left",
  "The last summer before everyone moved away",
  "The feeling of driving nowhere because you need some space",
  "Driving home after a difficult day, rain on the glass, nowhere to rush to",
];

const goldenResults = golden.map((prompt) => {
  const r = interpretWorld(prompt);
  return {
    prompt,
    scene: r.scene.id,
    emotions: r.taxonomy.emotion.slice(0, 5),
    situations: r.debug.matchedConcepts.filter((c) => c.startsWith("situation:")).slice(0, 3),
    confidence: r.confidence,
  };
});

const categoryStats = new Map();
for (const evalCase of WORLD_EVAL_CASES) {
  const result = interpretWorld(evalCase.prompt);
  const row = categoryStats.get(evalCase.category) ?? { total: 0, sceneHits: 0, emotionHits: 0 };
  row.total += 1;
  if (
    result.scene.id === evalCase.expectedScene ||
    (evalCase.acceptableScenes?.includes(result.scene.id) ?? false)
  ) {
    row.sceneHits += 1;
  }
  if (
    evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    )
  ) {
    row.emotionHits += 1;
  }
  categoryStats.set(evalCase.category, row);
}

const categoryTable = [...categoryStats.entries()]
  .map(([category, row]) => {
    const scenePct = Math.round((row.sceneHits / row.total) * 100);
    const emotionPct = Math.round((row.emotionHits / row.total) * 100);
    return `| ${category} | ${row.total} | ${scenePct}% | ${emotionPct}% |`;
  })
  .join("\n");

const report = `# World Understanding Report

Generated: ${new Date().toISOString().slice(0, 10)}

## Knowledge size

| Category | Count |
|----------|------:|
| Scenes | ${stats.scenes} |
| Situations | ${stats.situations} |
| Emotional states | ${stats.emotionalStates} |
| Phrases | ${stats.phrases} |
| Sensory concepts | ${stats.sensoryConcepts} |
| UK cultural contexts | ${stats.ukContexts} |
| Common language phrases | ${stats.commonLanguage} |
| Emotion library | ${stats.emotionLibrary} |
| Weather contexts | ${stats.weatherContexts} |
| Places | ${stats.places} |
| Activity library | ${stats.activityLibrary} |
| Time contexts | ${stats.timeContexts} |
| Social contexts | ${stats.socialContexts} |
| Movement concepts | ${stats.movements} |
| Sensory language | ${stats.sensoryLanguage} |
| Music descriptors | ${stats.musicDescriptors} |
| UK context (universal) | ${stats.ukContext} |
| Concept graph nodes | ${stats.conceptGraphNodes} |
| Concept graph domains | ${stats.conceptGraphDomains} |

## Moment coverage (target: 95%)

| Metric | Value |
|--------|------:|
| Prompts tested | ${coverage.tested} |
| Moment coverage | ${coverage.momentCoveragePct}% |
| Scene accuracy | ${coverage.sceneAccuracyPct}% |
| Emotion accuracy | ${coverage.emotionAccuracyPct}% |
| Music direction accuracy | ${coverage.musicDirectionAccuracyPct}% |
| Gap to 95% target | ${coverage.gapToTargetPct}% |

## Testing

| Metric | Value |
|--------|------:|
| Prompts tested | ${quality.tested} |
| Strong interpretations | ${quality.strongPct}% |
| Weak interpretations | ${quality.weakPct}% |

### Category pass rates

| Category | Prompts | Scene hit | Emotion hit |
|----------|--------:|----------:|------------:|
${categoryTable}

## Golden prompt probes

${goldenResults
  .map(
    (g) =>
      `### "${g.prompt}"\n- Scene: \`${g.scene}\`\n- Emotions: ${g.emotions.join(", ") || "—"}\n- Situations: ${g.situations.join(", ") || "—"}\n- Confidence: ${g.confidence.toFixed(2)}`,
  )
  .join("\n\n")}

## Main weaknesses

- Concept graph has 730+ interconnected nodes across 11 domains with 1-hop propagation
- Moment coverage is ~63% on 2000 human prompts — emotion and music direction are strong; scene accuracy is the bottleneck
- Scene selection remains scored template matching, not reasoning over implied meaning
- Graph and library entries are partly template-expanded from seeds
- Negation and complex syntax are not deeply handled
- World understanding nudges EmotionProfile only; it does not yet drive authoritative intent contract

## Architecture

\`\`\`
USER PROMPT
  → phrase matching + fuzzy expansion
  → taxonomy extraction (6 categories)
  → rich knowledge (situations, emotional states, sensory, UK cultural)
  → universal knowledge (11 language libraries)
  → concept graph (word → context → experience → emotion → music)
  → scene composition
  → music behaviour translation
  → EmotionProfile nudge (scoring unchanged)
\`\`\`
`;

const outPath = join(root, "..", "docs", "world-understanding-report.md");
writeFileSync(outPath, report, "utf8");
console.log(`Wrote ${outPath}`);
console.log(JSON.stringify({ stats, quality, coverage }, null, 2));
