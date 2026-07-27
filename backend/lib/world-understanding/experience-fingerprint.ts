/**
 * Lightweight experience fingerprint for Human Experience Engine.
 * Complements SemanticMomentFingerprint (built after scene compat output).
 */

import type { IntentContract } from "./intent-contract";
import type { SemanticFingerprint, WorldConceptTaxonomy } from "./types";

const TRANSITION_CUES = [
  "finally",
  "after",
  "before",
  "moving",
  "leaving",
  "coming",
  "got home",
  "arrived",
  "ended",
  "starting",
];

const RELATIONAL_CUES = [
  "everyone",
  "friend",
  "family",
  "ex",
  "partner",
  "alone",
  "together",
  "neighbourhood",
  "moved away",
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function inferEnergy(
  taxonomy: WorldConceptTaxonomy,
  intent: IntentContract,
): "low" | "medium" | "high" | null {
  if (intent.energyBias) return intent.energyBias;
  const lowEmo = taxonomy.emotion.some((e) =>
    /peace|calm|exhaustion|relief|quiet|melanchol/i.test(e),
  );
  const highEmo = taxonomy.emotion.some((e) =>
    /motivation|confidence|joy|energy|hype/i.test(e),
  );
  if (lowEmo && !highEmo) return "low";
  if (highEmo && !lowEmo) return "high";
  if (intent.stressRecovery) return "low";
  return null;
}

function inferNarrativeFrame(prompt: string, intent: IntentContract): string | null {
  const lower = prompt.toLowerCase();
  if (intent.stressRecovery || /worst day|horrible day|difficult day|bad day/i.test(lower)) {
    return "stress_recovery";
  }
  if (intent.kind === "nostalgia" || /used to|remember when|old days/i.test(lower)) {
    return "nostalgia_return";
  }
  if (/finally got home|coming home|arrived home/i.test(lower)) {
    return "arrival_decompression";
  }
  if (/moving away|everyone left|goodbye/i.test(lower)) {
    return "loss_transition";
  }
  if (intent.kind === "achievement") {
    return "achievement_release";
  }
  if (/realise|changing|life is changing/i.test(lower)) {
    return "life_transition";
  }
  return null;
}

export function buildExperienceFingerprint(
  prompt: string,
  taxonomy: WorldConceptTaxonomy,
  intent: IntentContract,
): SemanticFingerprint {
  const lower = prompt.toLowerCase();

  const themes = unique([
    ...taxonomy.lifeContext.slice(0, 4),
    ...taxonomy.activity.slice(0, 3).map((a) => a.replace(/_/g, " ")),
    intent.kind !== "unknown" ? intent.kind.replace(/_/g, " ") : "",
  ]);

  const physicalContext = unique([
    ...taxonomy.environment,
    ...taxonomy.activity.filter((a) => /drive|walk|travel|home|motorway|train/i.test(a)),
  ]);

  const emotionalSignals = unique([...taxonomy.emotion, ...intent.emotionBoosts]);

  const temporalSignals = unique(
    taxonomy.environment.filter((e) =>
      /night|morning|evening|midnight|dawn|summer|winter|sunday/i.test(e),
    ),
  );
  for (const cue of TRANSITION_CUES) {
    if (lower.includes(cue)) temporalSignals.push(cue);
  }

  const relationalSignals = unique(taxonomy.social);
  for (const cue of RELATIONAL_CUES) {
    if (lower.includes(cue)) relationalSignals.push(cue);
  }

  const sensorySignals = unique(taxonomy.sensory);
  const narrativeFrame = inferNarrativeFrame(prompt, intent);
  const energyImplied = inferEnergy(taxonomy, intent);

  const richness =
    themes.length +
    physicalContext.length +
    emotionalSignals.length +
    temporalSignals.length +
    relationalSignals.length +
    sensorySignals.length;
  const confidence = Math.round(
    Math.min(0.95, 0.25 + richness * 0.04 + (narrativeFrame ? 0.12 : 0) + intent.confidence * 0.15) *
      100,
  ) / 100;

  return {
    themes,
    physicalContext,
    emotionalSignals,
    temporalSignals,
    relationalSignals,
    sensorySignals,
    narrativeFrame,
    energyImplied,
    confidence,
  };
}
