import type { WorldConceptTaxonomy } from "./types";
import {
  applyUniversalMatchesToTaxonomy,
  buildHumanMeanings,
  matchUniversalKnowledge,
  type UniversalMatch,
} from "./universal-knowledge";

export interface UniversalKnowledgeApplication {
  taxonomy: WorldConceptTaxonomy;
  matches: UniversalMatch[];
  matchedConcepts: string[];
  humanMeanings: string[];
  sceneHint?: string;
}

export function applyUniversalKnowledge(
  text: string,
  taxonomy: WorldConceptTaxonomy,
): UniversalKnowledgeApplication {
  const matches = matchUniversalKnowledge(text);
  const applied = applyUniversalMatchesToTaxonomy(matches, taxonomy);
  const humanMeanings = buildHumanMeanings(matches);

  return {
    taxonomy: applied.taxonomy,
    matches,
    matchedConcepts: applied.matchedConcepts,
    humanMeanings,
    sceneHint: applied.sceneHints[0],
  };
}
