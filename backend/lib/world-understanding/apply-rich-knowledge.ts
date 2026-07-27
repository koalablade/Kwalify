import type { WorldConceptTaxonomy } from "./types";
import type { RichMatch, SituationEntry } from "./rich-knowledge";
import {
  matchSituations,
  matchEmotionalStates,
  matchSensoryContexts,
  matchUkCultural,
  propagateConceptRelationships,
} from "./rich-knowledge";

export interface RichKnowledgeApplication {
  taxonomy: WorldConceptTaxonomy;
  matchedConceptIds: Record<string, string[]>;
  situationMatches: RichMatch<SituationEntry>[];
  sceneHint?: string;
  matchedConcepts: string[];
}

function pushUnique(target: string[], values: string[]): void {
  for (const v of values) {
    const label = v.replace(/_/g, " ");
    if (!target.includes(label)) target.push(label);
  }
}

export function applyRichKnowledge(
  text: string,
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
): RichKnowledgeApplication {
  const situations = matchSituations(text);
  const emotionalStates = matchEmotionalStates(text);
  const sensory = matchSensoryContexts(text);
  const uk = matchUkCultural(text);

  const nextTaxonomy: WorldConceptTaxonomy = {
    environment: [...taxonomy.environment],
    activity: [...taxonomy.activity],
    social: [...taxonomy.social],
    emotion: [...taxonomy.emotion],
    lifeContext: [...taxonomy.lifeContext],
    sensory: [...taxonomy.sensory],
  };
  const nextIds = { ...matchedConceptIds, situations: [] as string[] };
  const matchedConcepts: string[] = [];

  let sceneHint: string | undefined;

  for (const hit of situations) {
    nextIds.situations.push(hit.entry.id);
    matchedConcepts.push(`situation:${hit.entry.id}`);
    pushUnique(nextTaxonomy.emotion, hit.entry.emotional_meaning);
    pushUnique(nextTaxonomy.emotion, hit.entry.related_emotions);
    if (!sceneHint) sceneHint = hit.entry.scene_hint;
  }

  for (const hit of emotionalStates) {
    matchedConcepts.push(`emotion_state:${hit.entry.id}`);
    pushUnique(nextTaxonomy.emotion, hit.entry.related_emotions);
    pushUnique(nextTaxonomy.emotion, [hit.entry.name]);
  }

  for (const hit of sensory) {
    matchedConcepts.push(`sensory:${hit.entry.name}`);
    pushUnique(nextTaxonomy.sensory, hit.entry.sensory);
    pushUnique(nextTaxonomy.emotion, hit.entry.emotional_links);
    pushUnique(nextTaxonomy.environment, hit.entry.concepts.filter((c) =>
      /night|urban|morning|city|coast/i.test(c),
    ));
  }

  for (const hit of uk) {
    matchedConcepts.push(`uk:${hit.entry.name}`);
    pushUnique(nextTaxonomy.emotion, hit.entry.emotion ?? []);
    pushUnique(nextTaxonomy.environment, hit.entry.concepts.filter((c) =>
      /home|coast|train|estate|lane|street/i.test(c),
    ));
  }

  const propagated = propagateConceptRelationships(text, nextTaxonomy);
  matchedConcepts.push(...propagated.matched);

  for (const key of Object.keys(nextTaxonomy) as (keyof WorldConceptTaxonomy)[]) {
    nextTaxonomy[key] = nextTaxonomy[key].slice(0, 10);
  }

  return {
    taxonomy: propagated.taxonomy,
    matchedConceptIds: nextIds,
    situationMatches: situations,
    sceneHint,
    matchedConcepts,
  };
}
