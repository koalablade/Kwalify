import type { WorldConceptTaxonomy } from "./types";
import {
  matchConceptGraph,
  propagateConceptGraph,
  type GraphMatch,
} from "./concept-graph";

export interface ConceptGraphApplication {
  taxonomy: WorldConceptTaxonomy;
  matches: GraphMatch[];
  matchedConcepts: string[];
  humanMeanings: string[];
  experiences: string[];
  sceneHint?: string;
}

export function applyConceptGraph(
  text: string,
  taxonomy: WorldConceptTaxonomy,
): ConceptGraphApplication {
  const matches = matchConceptGraph(text);
  const propagated = propagateConceptGraph(matches, taxonomy);

  return {
    taxonomy: propagated.taxonomy,
    matches,
    matchedConcepts: propagated.matchedConcepts,
    humanMeanings: propagated.humanMeanings,
    experiences: propagated.experiences,
    sceneHint: propagated.sceneHints[0],
  };
}
