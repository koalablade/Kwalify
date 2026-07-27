/**
 * Ultra-short / ambiguous prompt resolver — multiple hypotheses, not weather-default.
 * Runs before scene selection in interpretWorld.
 */

import { consultAtlas, getAtlasEntry } from "./atlas-loader";
import type { SemanticFingerprint, WorldConceptTaxonomy } from "./types";

export interface AmbiguousHypothesis {
  id: string;
  label: string;
  weight: number;
}

export interface AmbiguousPromptResolution {
  matched: boolean;
  hypotheses: AmbiguousHypothesis[];
  taxonomyBoosts: Partial<WorldConceptTaxonomy>;
  sceneHints: string[];
  emotionBoosts: string[];
  suppressWeatherReflection: boolean;
  humanMeanings: string[];
}

const ULTRA_SHORT_MAX_WORDS = 4;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function pushUnique(target: string[], values: string[]): void {
  for (const v of values) {
    const label = v.replace(/_/g, " ");
    if (!target.includes(label)) target.push(label);
  }
}

const AMBIGUOUS_PATTERNS: Array<{
  test: RegExp;
  hypotheses: AmbiguousHypothesis[];
  taxonomy: Partial<WorldConceptTaxonomy>;
  sceneHints: string[];
  suppressWeather: boolean;
  humanMeanings: string[];
}> = [
  {
    test: /^\s*alone\s*$/i,
    hypotheses: [
      { id: "solitude", label: "solitude", weight: 0.9 },
      { id: "reflection", label: "reflection", weight: 0.85 },
      { id: "recovery", label: "recovery", weight: 0.7 },
      { id: "sadness", label: "sadness", weight: 0.55 },
      { id: "independence", label: "independence", weight: 0.5 },
    ],
    taxonomy: {
      emotion: ["reflection", "solitude", "calm"],
      social: ["alone"],
      lifeContext: ["private moment", "self-care"],
      activity: ["resting", "reflecting"],
    },
    sceneHints: ["INTROSPECTIVE_PRIVACY", "DOMESTIC_QUIET"],
    suppressWeather: true,
    humanMeanings: ["Solitude chosen or imposed — a private moment without weather as the story."],
  },
  {
    test: /^\s*sunday\s*$/i,
    hypotheses: [
      { id: "rest", label: "rest", weight: 0.85 },
      { id: "preparation", label: "preparation", weight: 0.7 },
      { id: "nostalgia", label: "nostalgia", weight: 0.65 },
      { id: "quietness", label: "quietness", weight: 0.8 },
    ],
    taxonomy: {
      emotion: ["calm", "nostalgia", "melancholy"],
      lifeContext: ["weekend ritual", "slow pace"],
      activity: ["resting", "recovering"],
      environment: ["home", "domestic"],
    },
    sceneHints: ["DOMESTIC_QUIET", "UK_GREY_SUNDAY_INDOORS", "LAZY_SUNDAY"],
    suppressWeather: true,
    humanMeanings: ["Sunday rhythm — rest, quiet, and the week ahead hovering."],
  },
  {
    test: /^\s*waiting\s*$/i,
    hypotheses: [
      { id: "anticipation", label: "anticipation", weight: 0.9 },
      { id: "uncertainty", label: "uncertainty", weight: 0.85 },
      { id: "reflection", label: "reflection", weight: 0.7 },
    ],
    taxonomy: {
      emotion: ["anticipation", "uncertainty", "restlessness"],
      activity: ["waiting"],
      lifeContext: ["suspended moment"],
    },
    sceneHints: ["INTROSPECTIVE_PRIVACY", "DEPARTURE_WALK"],
    suppressWeather: true,
    humanMeanings: ["Suspended between — time thickens when you're waiting."],
  },
  {
    test: /^\s*home\s*$/i,
    hypotheses: [
      { id: "safety", label: "safety", weight: 0.85 },
      { id: "domestic", label: "domestic quiet", weight: 0.8 },
      { id: "belonging", label: "belonging", weight: 0.75 },
    ],
    taxonomy: {
      environment: ["home", "domestic"],
      emotion: ["comfort", "safety"],
      activity: ["resting"],
    },
    sceneHints: ["DOMESTIC_QUIET", "INTROSPECTIVE_PRIVACY"],
    suppressWeather: true,
    humanMeanings: ["Home as refuge — the ordinary sacred."],
  },
  {
    test: /^\s*road\s*$/i,
    hypotheses: [
      { id: "movement", label: "movement", weight: 0.9 },
      { id: "freedom", label: "freedom", weight: 0.8 },
      { id: "transition", label: "transition", weight: 0.75 },
    ],
    taxonomy: {
      activity: ["driving", "travelling"],
      environment: ["road", "car"],
      emotion: ["freedom", "reflection"],
    },
    sceneHints: ["LATE_NIGHT_SOLITARY_JOURNEY", "NOCTURNAL_ESCAPE_DRIVE"],
    suppressWeather: true,
    humanMeanings: ["The road as escape — motion without destination."],
  },
];

const ACTIVITY_PHRASE_HINTS: Array<{
  test: RegExp;
  taxonomy: Partial<WorldConceptTaxonomy>;
  sceneHints?: string[];
  suppressWeather?: boolean;
}> = [
  {
    test: /\bfinally clocked off\b/i,
    taxonomy: {
      activity: ["leaving work", "decompressing"],
      emotion: ["relief", "exhaustion", "freedom"],
      lifeContext: ["after work", "transition"],
    },
    suppressWeather: true,
  },
  {
    test: /\bsitting in (?:the |my )?car before going (?:in|inside)\b/i,
    taxonomy: {
      activity: ["sitting", "delaying", "decompressing"],
      environment: ["car", "driveway"],
      emotion: ["decompression", "avoidance", "reflection"],
    },
    suppressWeather: true,
  },
  {
    test: /\b(?:knackered|shattered|proper tired)\b/i,
    taxonomy: {
      emotion: ["exhaustion", "weariness"],
      lifeContext: ["after work", "need recovery"],
      activity: ["resting"],
    },
  },
  {
    test: /\b(?:rough day|fed up|can't face it|doing my head in)\b/i,
    taxonomy: {
      emotion: ["stress", "frustration", "exhaustion"],
      lifeContext: ["bad day aftermath"],
      activity: ["decompressing"],
    },
    suppressWeather: true,
  },
];

export function resolveAmbiguousPrompt(
  prompt: string,
  fingerprint?: SemanticFingerprint,
): AmbiguousPromptResolution {
  const empty: AmbiguousPromptResolution = {
    matched: false,
    hypotheses: [],
    taxonomyBoosts: {},
    sceneHints: [],
    emotionBoosts: [],
    suppressWeatherReflection: false,
    humanMeanings: [],
  };

  const trimmed = prompt.trim();
  if (!trimmed) return empty;

  const taxonomyBoosts: Partial<WorldConceptTaxonomy> = {};
  const sceneHints: string[] = [];
  const emotionBoosts: string[] = [];
  const humanMeanings: string[] = [];
  let hypotheses: AmbiguousHypothesis[] = [];
  let suppressWeatherReflection = false;
  let matched = false;

  const isUltraShort = wordCount(trimmed) <= ULTRA_SHORT_MAX_WORDS;

  if (isUltraShort) {
    for (const pattern of AMBIGUOUS_PATTERNS) {
      if (!pattern.test.test(trimmed)) continue;
      matched = true;
      hypotheses = pattern.hypotheses;
      mergeTaxonomy(taxonomyBoosts, pattern.taxonomy);
      sceneHints.push(...pattern.sceneHints);
      humanMeanings.push(...pattern.humanMeanings);
      if (pattern.suppressWeather) suppressWeatherReflection = true;
      for (const h of pattern.hypotheses) {
        if (/reflect|sad|calm|nostalg|anticipat|uncertain|freedom|exhaust/i.test(h.label)) {
          emotionBoosts.push(h.label);
        }
      }
      break;
    }
  }

  for (const hint of ACTIVITY_PHRASE_HINTS) {
    if (!hint.test.test(trimmed)) continue;
    matched = true;
    mergeTaxonomy(taxonomyBoosts, hint.taxonomy);
    if (hint.suppressWeather) suppressWeatherReflection = true;
  }

  if (fingerprint) {
    const atlasHits = consultAtlas(trimmed, fingerprint, 3);
    for (const hit of atlasHits) {
      const entry = getAtlasEntry(hit.entryId);
      if (!entry) continue;
      if (entry.domain === "activities" || entry.activity.length > 0) {
        matched = true;
        mergeTaxonomy(taxonomyBoosts, {
          activity: entry.activity,
          environment: entry.environment,
          emotion: entry.emotional_states,
          social: entry.social_context,
          lifeContext: entry.hidden_emotions,
        });
        if (entry.human_meaning) humanMeanings.push(entry.human_meaning);
      }
    }
  }

  return {
    matched,
    hypotheses,
    taxonomyBoosts,
    sceneHints: [...new Set(sceneHints)],
    emotionBoosts: [...new Set(emotionBoosts)],
    suppressWeatherReflection,
    humanMeanings: [...new Set(humanMeanings)].slice(0, 4),
  };
}

function mergeTaxonomy(
  target: Partial<WorldConceptTaxonomy>,
  source: Partial<WorldConceptTaxonomy>,
): void {
  const keys: (keyof WorldConceptTaxonomy)[] = [
    "environment",
    "activity",
    "social",
    "emotion",
    "lifeContext",
    "sensory",
  ];
  for (const key of keys) {
    const values = source[key];
    if (!values?.length) continue;
    const bucket = (target[key] ??= []);
    pushUnique(bucket, values);
  }
}

export function applyAmbiguousResolution(
  taxonomy: WorldConceptTaxonomy,
  resolution: AmbiguousPromptResolution,
): void {
  mergeTaxonomy(taxonomy, resolution.taxonomyBoosts);
}

export function applyAtlasTaxonomyBoost(
  prompt: string,
  fingerprint: SemanticFingerprint,
  taxonomy: WorldConceptTaxonomy,
): string[] {
  const hits = consultAtlas(prompt, fingerprint, 4);

  for (const hit of hits) {
    const entry = getAtlasEntry(hit.entryId);
    if (!entry || hit.matchScore < 0.3) continue;

    const activityDomains = new Set(["activities", "transport", "home", "places", "daily-life", "british-life"]);
    if (!activityDomains.has(entry.domain) && hit.matchScore < 0.55) continue;

    pushUnique(taxonomy.activity, entry.activity);
    pushUnique(taxonomy.environment, entry.environment);
    pushUnique(taxonomy.emotion, entry.emotional_states);
    pushUnique(taxonomy.emotion, entry.hidden_emotions);
    pushUnique(taxonomy.social, entry.social_context);
  }

  return [];
}
