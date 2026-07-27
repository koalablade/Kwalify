import { FUZZY_EXPANSIONS, PARAPHRASE_CLUSTERS } from "./knowledge";
import type { FuzzyExpansion } from "./types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchFuzzyConcepts(text: string): {
  expansions: FuzzyExpansion[];
  paraphraseCluster?: string;
  sceneHint?: string;
} {
  const lower = normalize(text);
  const expansions: FuzzyExpansion[] = [];
  let paraphraseCluster: string | undefined;
  let sceneHint: string | undefined;

  for (const cluster of PARAPHRASE_CLUSTERS) {
    for (const variant of cluster.variants) {
      if (normalize(variant) === lower) {
        paraphraseCluster = cluster.canonical;
        sceneHint = cluster.sceneId;
        break;
      }
    }
    if (paraphraseCluster) break;
  }

  for (const expansion of FUZZY_EXPANSIONS) {
    for (const trigger of expansion.triggers) {
      if (!lower.includes(trigger.toLowerCase())) continue;
      if (expansion.id === "motorway_rain_compound" && /\btrain\b|\brail\b/i.test(lower)) continue;
      expansions.push({
        id: expansion.id,
        matchedTrigger: trigger,
        concepts: expansion.concepts,
        sceneHint: expansion.sceneHint,
      });
      if (!sceneHint && expansion.sceneHint) sceneHint = expansion.sceneHint;
      break;
    }
  }

  // Compound fuzzy: motorway + rain + night without exact phrase
  const hasMotorway = /\b(motorway|empty road|a road|highway)\b/i.test(lower);
  const hasRain = /\b(rain|raining|rainy|wet|windscreen|windshield)\b/i.test(lower);
  const hasNight = /\b(midnight|late night|at night|night drive|after midnight)\b/i.test(lower);
  if (hasMotorway && hasRain && hasNight && !sceneHint) {
    sceneHint = "LATE_NIGHT_SOLITARY_JOURNEY";
    expansions.push({
      id: "compound_motorway_rain_night",
      matchedTrigger: "motorway+rain+night",
      concepts: {
        activity: ["driving"],
        environment: ["motorway", "car"],
        weather: ["rain"],
        time: ["midnight"],
        emotion: ["reflection", "peace", "loneliness"],
        social: ["alone"],
      },
      sceneHint: "LATE_NIGHT_SOLITARY_JOURNEY",
    });
  }

  return { expansions, paraphraseCluster, sceneHint };
}
