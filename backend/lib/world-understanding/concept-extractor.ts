import { getConceptLabel, matchIndexedCues } from "./knowledge";
import type { ConceptCategory, PhraseMatch, WorldConceptTaxonomy, FuzzyExpansion } from "./types";

const CATEGORY_KEYS: ConceptCategory[] = [
  "environment",
  "activity",
  "social",
  "emotion",
  "lifeContext",
  "sensory",
];

function uniquePush(target: string[], values: string[]): void {
  for (const value of values) {
    const label = value.replace(/_/g, " ");
    if (!target.includes(label)) target.push(label);
  }
}

function mergePhraseMeaning(
  taxonomy: WorldConceptTaxonomy,
  extra: Record<string, string[]>,
): void {
  const map: Record<string, ConceptCategory> = {
    environment: "environment",
    activity: "activity",
    social: "social",
    emotion: "emotion",
    emotions: "emotion",
    lifeContext: "lifeContext",
    life_context: "lifeContext",
    sensory: "sensory",
    weather: "environment",
    time: "environment",
  };
  for (const [key, values] of Object.entries(extra)) {
    const category = map[key];
    if (!category || !values?.length) continue;
    uniquePush(
      taxonomy[category],
      values.map((id) => getConceptLabel(category === "environment" && key === "weather" ? "weather" : category === "environment" && key === "time" ? "time" : category, id)),
    );
  }
}

export function extractTaxonomy(
  text: string,
  phraseMatches: PhraseMatch[],
  fuzzyExpansions: FuzzyExpansion[],
): { taxonomy: WorldConceptTaxonomy; matchedConceptIds: Record<string, string[]> } {
  const taxonomy: WorldConceptTaxonomy = {
    environment: [],
    activity: [],
    social: [],
    emotion: [],
    lifeContext: [],
    sensory: [],
  };
  const matchedConceptIds: Record<string, string[]> = {
    environment: [],
    activity: [],
    social: [],
    emotion: [],
    lifeContext: [],
    sensory: [],
    weather: [],
    time: [],
  };

  const cueHits = matchIndexedCues(text);
  for (const hit of cueHits) {
    if (hit.category === "weather") {
      uniquePush(taxonomy.environment, [getConceptLabel("weather", hit.conceptId)]);
      if (!matchedConceptIds.weather.includes(hit.conceptId)) {
        matchedConceptIds.weather.push(hit.conceptId);
      }
      continue;
    }
    if (hit.category === "time") {
      uniquePush(taxonomy.environment, [getConceptLabel("time", hit.conceptId)]);
      if (!matchedConceptIds.time.includes(hit.conceptId)) {
        matchedConceptIds.time.push(hit.conceptId);
      }
      continue;
    }
    const category = hit.category as ConceptCategory;
    uniquePush(taxonomy[category], [hit.label]);
    if (!matchedConceptIds[category].includes(hit.conceptId)) {
      matchedConceptIds[category].push(hit.conceptId);
    }
  }

  for (const phrase of phraseMatches) {
    mergePhraseMeaning(taxonomy, phrase.meaning as Record<string, string[]>);
  }

  for (const expansion of fuzzyExpansions) {
    mergePhraseMeaning(taxonomy, expansion.concepts as Record<string, string[]>);
  }

  // Infer alone when no social cues but journey/late-night language present
  if (
    taxonomy.social.length === 0 &&
    (taxonomy.activity.some((a) => /driv|walk|travel/i.test(a)) ||
      taxonomy.environment.some((e) => /night|midnight|motorway|car/i.test(e)))
  ) {
    uniquePush(taxonomy.social, ["alone"]);
    if (!matchedConceptIds.social.includes("alone")) {
      matchedConceptIds.social.push("alone");
    }
  }

  for (const key of CATEGORY_KEYS) {
    taxonomy[key] = taxonomy[key].slice(0, 8);
    matchedConceptIds[key] = matchedConceptIds[key].slice(0, 8);
  }
  matchedConceptIds.weather = matchedConceptIds.weather.slice(0, 8);
  matchedConceptIds.time = matchedConceptIds.time.slice(0, 8);

  return { taxonomy, matchedConceptIds };
}
