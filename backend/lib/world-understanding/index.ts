import { extractTaxonomy } from "./concept-extractor";
import { matchFuzzyConcepts } from "./fuzzy-matcher";
import { interpretPhrases } from "./phrase-interpreter";
import { composeScene } from "./scene-composer";
import { translateMusicBehaviour } from "./music-translator";
import { buildEmotionalSceneGraph } from "./scene-graph";
import type { WorldUnderstandingResult } from "./types";

function buildHumanNarrative(
  sceneLabel: string,
  emotions: string[],
  environment: string[],
): string {
  const emo = emotions.slice(0, 3).join(", ") || "quiet reflection";
  const env = environment.slice(0, 3).join(", ") || "an unspoken place";
  return `${sceneLabel} — ${env}. Feeling: ${emo}.`;
}

function computeConfidence(
  phraseCount: number,
  fuzzyCount: number,
  conceptCount: number,
  sceneScore: number,
): number {
  const phraseBoost = Math.min(phraseCount * 0.12, 0.36);
  const fuzzyBoost = Math.min(fuzzyCount * 0.08, 0.24);
  const conceptBoost = Math.min(conceptCount * 0.04, 0.28);
  const sceneBoost = Math.min(sceneScore / 120, 0.35);
  return Math.round(Math.min(0.98, 0.22 + phraseBoost + fuzzyBoost + conceptBoost + sceneBoost) * 100) / 100;
}

/**
 * Intermediate interpretation layer: prompt → human meaning → music behaviour.
 * Sits before playlist scoring; does not replace scene bus or canonicalizer.
 */
export function interpretWorld(prompt: string): WorldUnderstandingResult {
  const text = prompt.trim();
  const phraseMatches = interpretPhrases(text);
  const fuzzy = matchFuzzyConcepts(text);
  const { taxonomy, matchedConceptIds } = extractTaxonomy(
    text,
    phraseMatches,
    fuzzy.expansions,
  );

  const scene = composeScene(taxonomy, matchedConceptIds, fuzzy.sceneHint);
  const musicBehaviour = translateMusicBehaviour(scene, phraseMatches);
  const sceneGraph = buildEmotionalSceneGraph(taxonomy, scene, musicBehaviour);

  const matchedConcepts = [
    ...phraseMatches.map((p) => `phrase:${p.phrase}`),
    ...fuzzy.expansions.map((e) => `fuzzy:${e.id}`),
    ...Object.entries(matchedConceptIds).flatMap(([cat, ids]) =>
      ids.map((id) => `${cat}:${id}`),
    ),
  ].slice(0, 24);

  const conceptCount =
    taxonomy.environment.length +
    taxonomy.activity.length +
    taxonomy.emotion.length +
    taxonomy.social.length +
    taxonomy.lifeContext.length +
    taxonomy.sensory.length;

  const confidence = computeConfidence(
    phraseMatches.length,
    fuzzy.expansions.length,
    conceptCount,
    scene.score,
  );

  const humanNarrative = buildHumanNarrative(
    scene.label,
    taxonomy.emotion,
    taxonomy.environment,
  );

  return {
    prompt: text,
    taxonomy,
    scene,
    sceneGraph,
    musicBehaviour,
    matchedPhrases: phraseMatches,
    fuzzyExpansions: fuzzy.expansions,
    humanNarrative,
    confidence,
    debug: {
      matchedConceptIds,
      paraphraseCluster: fuzzy.paraphraseCluster,
      matchedConcepts,
    },
  };
}

export { applyWorldUnderstandingToProfile } from "./apply-profile";
export { buildWorldUnderstandingDebug } from "./debug";
export type { WorldUnderstandingResult } from "./types";
export type { WorldUnderstandingDebugView } from "./debug";
export type { EmotionalSceneGraph } from "./scene-graph";
