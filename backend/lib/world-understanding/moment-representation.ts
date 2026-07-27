/**
 * Semantic Moment Engine — multi-dimensional human experience fingerprint.
 * Composes from existing world-understanding layers; scene ID is an output, not the model.
 */

import { CONCEPT_RELATIONSHIPS, type ConceptRelationship } from "./rich-knowledge";
import type { IntentContract } from "./intent-contract";
import type { GraphMatch } from "./concept-graph";
import {
  type LifeEventSignal,
  type MomentInterpretation,
} from "./moment-interpreter";
import type {
  ComposedScene,
  MusicBehaviourModel,
  WorldConceptTaxonomy,
} from "./types";

export interface DimensionSignal {
  values: string[];
  confidence: number;
  sources: string[];
}

export interface EmotionLayers {
  primary: string[];
  secondary: string[];
  tertiary: string[];
  underlying: string[];
  desired: string[];
}

export interface NarrativeFrame {
  before: string[];
  during: string[];
  after: string[];
  arcPhase: string | null;
}

export interface RelationshipChain {
  seed: string;
  chain: string[];
}

export interface SemanticMomentFingerprint {
  activity: DimensionSignal;
  movement: DimensionSignal;
  environment: DimensionSignal;
  weather: DimensionSignal;
  time: DimensionSignal;
  lighting: DimensionSignal;
  social: DimensionSignal;
  lifeEvent: DimensionSignal;
  emotion: EmotionLayers;
  narrative: NarrativeFrame;
  sensory: string[];
  emotionalGoal: string | null;
  playlistBehaviour: {
    energy: number;
    tempoBpm: [number, number];
    textures: string[];
    preferredGenres: string[];
    avoidGenres: string[];
    progression: string;
  };
  energyCurve: number[];
  relationshipChains: RelationshipChain[];
  sceneOutput: { id: string; label: string; score: number; rank: number };
  sceneCandidates: Array<{ id: string; label: string; score: number }>;
  /** Flat weighted tokens for additive scoring — not a keyword list */
  semanticVector: Record<string, number>;
  confidence: number;
}

export interface BuildSemanticMomentInput {
  prompt: string;
  taxonomy: WorldConceptTaxonomy;
  matchedConceptIds: Record<string, string[]>;
  momentInterpretation: MomentInterpretation;
  intent: IntentContract;
  graphMatches: GraphMatch[];
  scene: ComposedScene;
  sceneCandidates: Array<{ id: string; label: string; score: number }>;
  musicBehaviour: MusicBehaviourModel;
  humanMeanings: string[];
  worldConfidence: number;
}

const MOVEMENT_RE =
  /\b(?:driv|walk|commut|travel|journey|run(?:ning)?|cycl|train|bus|motorway|road trip|heading|on the way)\b/i;
const WEATHER_RE =
  /\b(?:rain|rainy|snow|fog|grey|gray|storm|drizzle|windscreen|windshield|wet|overcast)\b/i;
const TIME_RE =
  /\b(?:night|midnight|late night|evening|morning|dawn|dusk|2am|3am|afternoon|sunday)\b/i;
const LIGHTING_RE =
  /\b(?:streetlight|headlight|neon|golden hour|dim|glow|blurred lights|reflections?|street reflections)\b/i;
const SOLITARY_RE = /\b(?:alone|solitary|lonely|by myself|no one|empty|private)\b/i;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pushUnique(target: string[], values: string[]): void {
  for (const v of values) {
    const label = v.replace(/_/g, " ").trim();
    if (label && !target.some((x) => x.toLowerCase() === label.toLowerCase())) {
      target.push(label);
    }
  }
}

function dimSignal(values: string[], confidence: number, sources: string[]): DimensionSignal {
  return {
    values: values.slice(0, 8),
    confidence: clamp01(confidence),
    sources: sources.slice(0, 6),
  };
}

function splitMovementActivity(
  activity: string[],
  matchedConceptIds: Record<string, string[]>,
  prompt: string,
): { movement: string[]; activity: string[] } {
  const movementIds = (matchedConceptIds.movement ?? []).map((id) => id.replace(/_/g, " "));
  const movement: string[] = [...movementIds];
  const rest: string[] = [];
  const lower = prompt.toLowerCase();

  if (/\btrain\b|\brail\b|\bcarriage\b/i.test(lower)) {
    pushUnique(movement, ["train journey"]);
  }
  if (/\bwalk|\bstroll|\bhike/i.test(lower)) pushUnique(movement, ["walking"]);
  if (/\bdriv|\bmotorway|\bcommut/i.test(lower) && !/\btrain\b/i.test(lower)) {
    pushUnique(movement, ["driving"]);
  }

  for (const a of activity) {
    const isMovement = MOVEMENT_RE.test(a);
    const trainPrompt = /\btrain\b/i.test(lower);
    if (trainPrompt && /driv/i.test(a)) continue;
    if (isMovement) movement.push(a);
    else rest.push(a);
  }

  if (/\btrain\b/i.test(lower)) {
    const filteredRest = rest.filter((a) => !/driv/i.test(a));
    return { movement: uniqueStrings(movement).slice(0, 6), activity: filteredRest.slice(0, 6) };
  }

  return { movement: movement.slice(0, 6), activity: rest.slice(0, 6) };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function extractWeatherTime(
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
): { weather: string[]; time: string[] } {
  const weather = (matchedConceptIds.weather ?? []).map((id) => id.replace(/_/g, " "));
  const time = (matchedConceptIds.time ?? []).map((id) => id.replace(/_/g, " "));

  for (const env of taxonomy.environment) {
    const lower = env.toLowerCase();
    if (WEATHER_RE.test(lower) && !weather.includes(env)) weather.push(env);
    if (TIME_RE.test(lower) && !time.includes(env)) time.push(env);
  }
  for (const s of taxonomy.sensory) {
    if (WEATHER_RE.test(s) && !weather.includes(s)) weather.push(s);
  }

  return { weather: weather.slice(0, 6), time: time.slice(0, 6) };
}

function inferLighting(
  time: string[],
  weather: string[],
  sensory: string[],
  environment: string[],
): string[] {
  const lighting: string[] = [];
  for (const s of [...sensory, ...environment]) {
    if (LIGHTING_RE.test(s)) lighting.push(s);
  }
  const timeText = time.join(" ").toLowerCase();
  if (/night|midnight|late|evening|2am|3am/.test(timeText)) {
    pushUnique(lighting, ["street lights", "dim cabin light", "blurred headlights"]);
  }
  if (weather.some((w) => /rain|fog|grey|storm/i.test(w))) {
    pushUnique(lighting, ["rain on glass", "wet reflections", "muted glow"]);
  }
  if (lighting.length === 0 && time.length === 0 && weather.length === 0) {
    return [];
  }
  return lighting.slice(0, 6);
}

function buildEmotionLayers(
  taxonomy: WorldConceptTaxonomy,
  momentInterpretation: MomentInterpretation,
  intent: IntentContract,
  lifeEvents: LifeEventSignal[],
): EmotionLayers {
  const fromTaxonomy = [...taxonomy.emotion];
  const primaryConceptEmotions = momentInterpretation.primaryConcepts
    .filter((c) => c.category === "emotion" || c.emotional >= 0.6)
    .map((c) => c.label);

  const primary: string[] = [];
  const secondary: string[] = [];
  const tertiary: string[] = [];
  const underlying: string[] = [];
  const desired: string[] = [];

  pushUnique(primary, primaryConceptEmotions.slice(0, 2));
  pushUnique(primary, fromTaxonomy.slice(0, 2));
  pushUnique(secondary, fromTaxonomy.slice(2, 5));
  pushUnique(tertiary, fromTaxonomy.slice(5, 8));

  for (const le of lifeEvents) {
    if (le.category === "bad_day_aftermath" || le.category === "loss" || le.category === "breakup") {
      pushUnique(underlying, le.emotionBoosts);
    }
  }
  if (intent.stressRecovery) {
    pushUnique(underlying, ["exhaustion", "stress", "overwhelm"]);
    pushUnique(desired, ["relief", "decompression", "calm"]);
  }
  pushUnique(desired, intent.emotionBoosts);

  if (momentInterpretation.dominantStory) {
    if (/hope|fresh|start/i.test(momentInterpretation.dominantStory)) {
      pushUnique(desired, ["hope", "anticipation"]);
    }
    if (/grief|loss|goodbye/i.test(momentInterpretation.dominantStory)) {
      pushUnique(underlying, ["grief", "longing"]);
    }
  }

  return {
    primary: primary.slice(0, 4),
    secondary: secondary.slice(0, 4),
    tertiary: tertiary.slice(0, 4),
    underlying: underlying.slice(0, 4),
    desired: desired.slice(0, 4),
  };
}

function buildNarrativeFrame(
  momentInterpretation: MomentInterpretation,
  lifeEvents: LifeEventSignal[],
): NarrativeFrame {
  const before: string[] = [];
  const during: string[] = [];
  const after: string[] = [];

  for (const t of momentInterpretation.temporal) {
    const bucket =
      t.phase === "before" ? before : t.phase === "after" ? after : during;
    bucket.push(t.trigger);
  }

  for (const le of lifeEvents) {
    if (le.category === "bad_day_aftermath") after.push(le.trigger);
    else if (le.category === "avoidance_delay") during.push(le.trigger);
    else if (le.category === "transition" || le.category === "leaving") before.push(le.trigger);
  }

  let arcPhase: string | null = null;
  if (momentInterpretation.dominantStory) {
    arcPhase = momentInterpretation.dominantStory;
  } else if (after.length > 0 && during.length > 0) {
    arcPhase = "processing_transition";
  } else if (after.length > 0) {
    arcPhase = "aftermath";
  } else if (before.length > 0) {
    arcPhase = "anticipation";
  } else if (momentInterpretation.narrativeDominance >= 0.55) {
    arcPhase = "in_the_moment";
  }

  return {
    before: before.slice(0, 4),
    during: during.slice(0, 4),
    after: after.slice(0, 4),
    arcPhase,
  };
}

function inferEmotionalGoal(
  intent: IntentContract,
  lifeEvents: LifeEventSignal[],
  momentInterpretation: MomentInterpretation,
): string | null {
  if (intent.stressRecovery) return "decompression and emotional recovery";
  if (intent.kind === "nostalgia") return "remember and feel bittersweet warmth";
  if (intent.kind === "emotional_support") return "feel held through difficulty";
  if (intent.kind === "reflection") return "process and make sense";
  if (lifeEvents.some((e) => e.category === "fresh_start")) return "step into a new chapter";
  if (momentInterpretation.movementExpected && lifeEvents.length > 0) {
    return "travel while processing";
  }
  if (intent.kind !== "unknown") return intent.kind.replace(/_/g, " ");
  return null;
}

function buildRelationshipChains(
  prompt: string,
  graphMatches: GraphMatch[],
  taxonomy: WorldConceptTaxonomy,
): RelationshipChain[] {
  const lower = prompt.toLowerCase();
  const chains: RelationshipChain[] = [];
  const used = new Set<string>();

  const tryChain = (rel: ConceptRelationship) => {
    const concept = rel.concept.toLowerCase();
    if (!lower.includes(concept) && !used.has(concept)) {
      const partial = rel.children?.some((c) => lower.includes(c.toLowerCase()));
      if (!partial) return;
    }
    used.add(concept);
    const chain: string[] = [rel.concept];
    pushUnique(chain, rel.parents ?? []);
    pushUnique(chain, rel.children?.slice(0, 2) ?? []);
    if (rel.emotional_links?.length) chain.push(rel.emotional_links[0]);
    chains.push({ seed: rel.concept, chain: chain.slice(0, 6) });
  };

  for (const rel of CONCEPT_RELATIONSHIPS) {
    tryChain(rel);
    if (chains.length >= 5) break;
  }

  for (const hit of graphMatches.slice(0, 3)) {
    const seed = hit.node.name.toLowerCase();
    if (used.has(seed)) continue;
    used.add(seed);
    const chain = [hit.node.name];
    pushUnique(chain, hit.node.contexts ?? []);
    pushUnique(chain, hit.node.emotional_meaning?.slice(0, 2) ?? []);
    for (const relId of hit.node.related_concepts?.slice(0, 2) ?? []) {
      const related = CONCEPT_RELATIONSHIPS.find(
        (r) => r.concept.toLowerCase() === relId.toLowerCase(),
      );
      if (related) pushUnique(chain, [related.concept, ...(related.children?.slice(0, 1) ?? [])]);
    }
    chains.push({ seed: hit.node.name, chain: chain.slice(0, 6) });
    if (chains.length >= 6) break;
  }

  if (chains.length === 0) {
    for (const env of taxonomy.environment.slice(0, 2)) {
      chains.push({ seed: env, chain: [env, "place", "atmosphere"] });
    }
  }

  return chains.slice(0, 6);
}

function buildEnergyCurve(
  musicEnergy: number,
  narrative: NarrativeFrame,
  lifeEvents: LifeEventSignal[],
): number[] {
  const points = 5;
  const base = musicEnergy;
  const hasAftermath = narrative.after.length > 0 || lifeEvents.some((e) => e.category === "bad_day_aftermath");
  const hasFreshStart = lifeEvents.some((e) => e.category === "fresh_start");

  const curve: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    let e = base;
    if (hasAftermath) {
      e = base * (0.75 + t * 0.35);
    } else if (hasFreshStart) {
      e = base * (0.85 + t * 0.25);
    } else {
      e = base * (0.9 + Math.sin(t * Math.PI) * 0.08);
    }
    curve.push(Math.round(clamp01(e) * 100) / 100);
  }
  return curve;
}

function buildSemanticVector(fp: Omit<SemanticMomentFingerprint, "semanticVector">): Record<string, number> {
  const vec: Record<string, number> = {};
  const add = (prefix: string, values: string[], weight: number) => {
    for (const v of values) {
      const key = `${prefix}:${v.toLowerCase().replace(/\s+/g, "_")}`;
      vec[key] = Math.max(vec[key] ?? 0, weight);
    }
  };

  add("activity", fp.activity.values, fp.activity.confidence);
  add("movement", fp.movement.values, fp.movement.confidence);
  add("environment", fp.environment.values, fp.environment.confidence);
  add("weather", fp.weather.values, fp.weather.confidence);
  add("time", fp.time.values, fp.time.confidence);
  add("lighting", fp.lighting.values, fp.lighting.confidence * 0.85);
  add("social", fp.social.values, fp.social.confidence);
  add("life", fp.lifeEvent.values, fp.lifeEvent.confidence);
  add("emotion_primary", fp.emotion.primary, 1);
  add("emotion_secondary", fp.emotion.secondary, 0.7);
  add("emotion_underlying", fp.emotion.underlying, 0.85);
  add("emotion_desired", fp.emotion.desired, 0.75);
  add("sensory", fp.sensory, 0.8);

  if (fp.narrative.arcPhase) vec[`narrative:${fp.narrative.arcPhase}`] = 0.9;
  for (const phase of ["before", "during", "after"] as const) {
    add(`narrative_${phase}`, fp.narrative[phase], 0.65);
  }

  for (const chain of fp.relationshipChains) {
    for (const node of chain.chain) {
      const key = `chain:${node.toLowerCase().replace(/\s+/g, "_")}`;
      vec[key] = Math.max(vec[key] ?? 0, 0.55);
    }
  }

  vec[`scene:${fp.sceneOutput.id}`] = clamp01(fp.sceneOutput.score / 100) * 0.6;
  return vec;
}

function confidenceFor(values: string[], base: number, bonus = 0): number {
  if (values.length === 0) return 0;
  return clamp01(base + Math.min(values.length * 0.08, 0.25) + bonus);
}

export function buildSemanticMomentFingerprint(
  input: BuildSemanticMomentInput,
): SemanticMomentFingerprint {
  const {
    prompt,
    taxonomy,
    matchedConceptIds,
    momentInterpretation,
    intent,
    graphMatches,
    scene,
    sceneCandidates,
    musicBehaviour,
    humanMeanings,
    worldConfidence,
  } = input;

  const { weather, time } = extractWeatherTime(taxonomy, matchedConceptIds);
  const { movement, activity } = splitMovementActivity(taxonomy.activity, matchedConceptIds, prompt);

  const environment = [...taxonomy.environment].filter(
    (e) => !WEATHER_RE.test(e) && !TIME_RE.test(e),
  );
  const lighting = inferLighting(time, weather, taxonomy.sensory, environment);

  const social = [...taxonomy.social];
  if (SOLITARY_RE.test(prompt) || momentInterpretation.primaryConcepts.some((c) => /alone|solitary/i.test(c.label))) {
    pushUnique(social, ["solitary", "private"]);
  }

  const lifeEventValues = momentInterpretation.lifeEvents.map((e) => e.category.replace(/_/g, " "));
  const lifeEventTriggers = momentInterpretation.lifeEvents.map((e) => e.trigger);

  const emotion = buildEmotionLayers(taxonomy, momentInterpretation, intent, momentInterpretation.lifeEvents);
  const narrative = buildNarrativeFrame(momentInterpretation, momentInterpretation.lifeEvents);
  const emotionalGoal = inferEmotionalGoal(intent, momentInterpretation.lifeEvents, momentInterpretation);
  const relationshipChains = buildRelationshipChains(prompt, graphMatches, taxonomy);

  const sensory = [...taxonomy.sensory];
  for (const chain of relationshipChains) {
    const rel = CONCEPT_RELATIONSHIPS.find((r) => r.concept === chain.seed);
    if (rel?.sensory) pushUnique(sensory, rel.sensory);
  }

  const rankedCandidates = sceneCandidates.map((c) => ({
    id: c.id,
    label: c.label,
    score: c.score,
  }));
  const sceneRank = Math.max(1, rankedCandidates.findIndex((c) => c.id === scene.id) + 1);

  const momentConfBoost = momentInterpretation.primaryConcepts.length > 0 ? 0.08 : 0;
  const baseConf = clamp01(worldConfidence);

  const partial: Omit<SemanticMomentFingerprint, "semanticVector"> = {
    activity: dimSignal(activity, confidenceFor(activity, baseConf, momentConfBoost), ["taxonomy", "concept"]),
    movement: dimSignal(
      movement,
      confidenceFor(movement, baseConf, momentInterpretation.movementExpected ? 0.12 : 0),
      ["taxonomy", "movement"],
    ),
    environment: dimSignal(environment, confidenceFor(environment, baseConf), ["taxonomy", "environment"]),
    weather: dimSignal(
      weather,
      confidenceFor(weather, baseConf, momentInterpretation.weatherIsSecondary ? -0.1 : 0.05),
      ["taxonomy", "weather"],
    ),
    time: dimSignal(time, confidenceFor(time, baseConf * 0.9), ["taxonomy", "time"]),
    lighting: dimSignal(lighting, confidenceFor(lighting, baseConf * 0.75), ["inference", "sensory"]),
    social: dimSignal(social, confidenceFor(social, baseConf * 0.85), ["taxonomy", "social"]),
    lifeEvent: dimSignal(
      [...lifeEventValues, ...lifeEventTriggers.slice(0, 2)],
      confidenceFor(lifeEventValues, baseConf, momentInterpretation.lifeEvents[0]?.strength ?? 0),
      ["moment-interpreter"],
    ),
    emotion,
    narrative,
    sensory: sensory.slice(0, 10),
    emotionalGoal,
    playlistBehaviour: {
      energy: musicBehaviour.energy,
      tempoBpm: musicBehaviour.tempoBpm,
      textures: musicBehaviour.textures,
      preferredGenres: musicBehaviour.preferredGenres,
      avoidGenres: musicBehaviour.avoidGenres,
      progression: `${musicBehaviour.sequence.beginning} → ${musicBehaviour.sequence.middle} → ${musicBehaviour.sequence.ending}`,
    },
    energyCurve: buildEnergyCurve(musicBehaviour.energy, narrative, momentInterpretation.lifeEvents),
    relationshipChains,
    sceneOutput: {
      id: scene.id,
      label: scene.label,
      score: scene.score,
      rank: sceneRank,
    },
    sceneCandidates: rankedCandidates.slice(0, 6),
    confidence: clamp01(
      (baseConf +
        (momentInterpretation.primaryConcepts.length > 0 ? 0.05 : 0) +
        (lifeEventValues.length > 0 ? 0.04 : 0) +
        (humanMeanings.length > 0 ? 0.03 : 0)) /
        1.05,
    ),
  };

  return {
    ...partial,
    semanticVector: buildSemanticVector(partial),
  };
}

/** Summarise fingerprint dimensions for debug / eval */
export function summariseFingerprintDimensions(fp: SemanticMomentFingerprint): Record<string, string[]> {
  return {
    activity: fp.activity.values,
    movement: fp.movement.values,
    environment: fp.environment.values,
    weather: fp.weather.values,
    time: fp.time.values,
    lighting: fp.lighting.values,
    social: fp.social.values,
    lifeEvent: fp.lifeEvent.values,
    emotion: [
      ...fp.emotion.primary,
      ...fp.emotion.secondary,
      ...fp.emotion.underlying,
    ],
    narrative: [
      ...(fp.narrative.arcPhase ? [fp.narrative.arcPhase] : []),
      ...fp.narrative.before.map((x) => `before: ${x}`),
      ...fp.narrative.during.map((x) => `during: ${x}`),
      ...fp.narrative.after.map((x) => `after: ${x}`),
    ],
    sensory: fp.sensory,
    playlistDirection: [
      `energy ${Math.round(fp.playlistBehaviour.energy * 100)}%`,
      ...fp.playlistBehaviour.preferredGenres.slice(0, 3),
    ],
  };
}
