import { SCENE_TEMPLATES } from "./knowledge";
import { CONCEPT_RELATIONSHIPS } from "./rich-knowledge";
import type { IntentContract } from "./intent-contract";
import { applyMomentBoost, type MomentInterpretation } from "./moment-interpreter";
import { FAMILY_BOOST, SCENE_FAMILIES } from "./scene-hierarchy";
import type { ComposedScene, WorldConceptTaxonomy } from "./types";

type SceneTemplate = (typeof SCENE_TEMPLATES)[number];

export interface SceneCandidate {
  id: string;
  label: string;
  humanMoment: string;
  score: number;
  breakdown: {
    environment: number;
    activity: number;
    time: number;
    weather: number;
    emotion: number;
    social: number;
    lifeContext: number;
    sensory: number;
    coherence: number;
    intent: number;
    graph: number;
    hint: number;
    penalty: number;
    moment: number;
  };
  momentReasons?: string[];
}

export interface SceneCompositionInput {
  taxonomy: WorldConceptTaxonomy;
  matchedConceptIds: Record<string, string[]>;
  sceneHints?: string[];
  graphSceneHints?: string[];
  intent?: IntentContract;
  momentInterpretation?: MomentInterpretation;
}

interface MomentSignals {
  environment: string[];
  activity: string[];
  time: string[];
  weather: string[];
  emotion: string[];
  social: string[];
  lifeContext: string[];
  sensory: string[];
  tokens: Set<string>;
}

interface EmotionalMomentProfile {
  stressRecovery: boolean;
  movementDecompression: boolean;
  weatherBackdrop: boolean;
  transitionHome: boolean;
  emotionalSupportIntent: boolean;
}

const STRONG_STRESS_PATTERN =
  /horrible|awful|terrible|rough|bad day|hard day|worst day|difficult|stressful|knackered|burnout|overwhelm|decompress/i;

function detectStressRecovery(signals: MomentSignals, intent?: IntentContract): boolean {
  if (intent?.stressRecovery) return true;
  if (signals.lifeContext.some((l) => /difficult|stress|mental_reset/i.test(l))) return true;
  if (intent?.trigger && STRONG_STRESS_PATTERN.test(intent.trigger)) return true;
  if (signals.emotion.some((e) => STRONG_STRESS_PATTERN.test(e))) return true;
  for (const token of signals.tokens) {
    if (STRONG_STRESS_PATTERN.test(token)) return true;
  }
  return false;
}

function detectEmotionalMoment(signals: MomentSignals, intent?: IntentContract): EmotionalMomentProfile {
  const stressRecovery = detectStressRecovery(signals, intent);

  const movementDecompression =
    signals.activity.some((a) => /driv|commut|travel|journey/i.test(a)) || signals.tokens.has("driving");

  const weatherBackdrop =
    signals.weather.length > 0 ||
    signals.environment.some((e) => /rain|snow|fog|grey|storm|drizzle/i.test(e)) ||
    signals.sensory.some((s) => /rain|windscreen|glass/i.test(s));

  const transitionHome =
    signals.tokens.has("home") ||
    signals.environment.some((e) => /home|domestic/i.test(e)) ||
    signals.activity.some((a) => /home/i.test(a));

  return {
    stressRecovery,
    movementDecompression,
    weatherBackdrop,
    transitionHome,
    emotionalSupportIntent: intent?.stressRecovery === true,
  };
}

function emotionalDominanceBonus(templateId: string, profile: EmotionalMomentProfile): number {
  const decompressionDrive = profile.stressRecovery && profile.movementDecompression;
  const fullDecompression =
    decompressionDrive && (profile.weatherBackdrop || profile.transitionHome);

  if (fullDecompression) {
    if (templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") return 100;
    if (templateId === "LATE_NIGHT_SOLITARY_JOURNEY") return 10;
    if (templateId === "WEATHER_REFLECTION") return -45;
    if (templateId === "DOMESTIC_QUIET") return -35;
    if (templateId === "NOCTURNAL_ESCAPE_DRIVE") return -20;
  } else if (decompressionDrive && profile.emotionalSupportIntent) {
    if (templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") return 75;
    if (templateId === "WEATHER_REFLECTION") return -30;
  } else if (
    profile.movementDecompression &&
    profile.weatherBackdrop &&
    !profile.stressRecovery
  ) {
    if (templateId === "LATE_NIGHT_SOLITARY_JOURNEY") return 30;
    if (templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") return -10;
  }
  return 0;
}

function tokenize(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    for (const part of v.toLowerCase().split(/[\s,/]+/)) {
      if (part.length > 2) out.add(part);
    }
    out.add(v.toLowerCase());
  }
  return out;
}

function buildMomentSignals(
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
): MomentSignals {
  const time = (matchedConceptIds.time ?? []).map((id) => id.replace(/_/g, " "));
  const weather = (matchedConceptIds.weather ?? []).map((id) => id.replace(/_/g, " "));
  const environment = [...taxonomy.environment];
  const activity = [...taxonomy.activity];
  const emotion = [...taxonomy.emotion];
  const social = [...taxonomy.social];
  const lifeContext = [...taxonomy.lifeContext];
  const sensory = [...taxonomy.sensory];

  const TIME_WORDS = ["night", "midnight", "late night", "evening", "morning", "sunday", "2am", "dawn"];
  const WEATHER_WORDS = ["rain", "rainy", "snow", "fog", "grey", "storm", "sun", "drizzle"];

  for (const env of environment) {
    const lower = env.toLowerCase();
    for (const tw of TIME_WORDS) {
      if (lower.includes(tw) && !time.includes(tw)) time.push(tw);
    }
    for (const ww of WEATHER_WORDS) {
      if (lower.includes(ww) && !weather.includes(ww)) weather.push(ww);
    }
  }

  const tokens = new Set<string>();
  for (const list of [environment, activity, time, weather, emotion, social, lifeContext, sensory]) {
    for (const t of tokenize(list)) tokens.add(t);
  }

  return { environment, activity, time, weather, emotion, social, lifeContext, sensory, tokens };
}

function overlapScore(tokens: Set<string>, needles: string[]): number {
  let score = 0;
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (tokens.has(n)) score += 12;
    else {
      for (const t of tokens) {
        if (t.includes(n) || n.includes(t)) score += 6;
      }
    }
  }
  return score;
}

function listOverlap(values: string[], needles: string[]): number {
  let score = 0;
  for (const v of values) {
    const lower = v.toLowerCase();
    for (const n of needles) {
      const needle = n.toLowerCase();
      if (lower.includes(needle) || needle.includes(lower)) score += 8;
    }
  }
  return score;
}

function composeHumanMoment(
  template: SceneTemplate,
  signals: MomentSignals,
  profile?: EmotionalMomentProfile,
): string {
  if (profile?.stressRecovery && profile?.movementDecompression) {
    const parts = ["private decompression"];
    const activity = signals.activity.find((a) => /driv|commut|travel/i.test(a)) ?? signals.activity[0];
    if (activity) parts.push(activity);
    if (profile.weatherBackdrop) parts.push("weather as backdrop");
    const emotion = signals.emotion.find((e) => /relief|reflection|exhaust/i.test(e)) ?? signals.emotion[0];
    if (emotion) parts.push(emotion);
    return parts.slice(0, 4).join(" · ");
  }

  const parts: string[] = [];
  const weather = signals.weather[0] ?? signals.environment.find((e) => /rain|snow|fog|grey|sun/i.test(e));
  const time = signals.time[0] ?? signals.environment.find((e) => /night|midnight|morning|evening|sunday/i.test(e));
  const activity = signals.activity[0];
  const emotion = signals.emotion[0];

  if (weather) parts.push(weather);
  if (time) parts.push(time);
  if (activity) parts.push(activity);
  else if (template.properties.environment?.[0]) parts.push(template.label.toLowerCase());
  if (emotion) parts.push(emotion);

  if (parts.length >= 2) return parts.slice(0, 4).join(" · ");
  return template.humanSummary.split("—")[0].trim();
}

function coherenceBonus(template: SceneTemplate, signals: MomentSignals): number {
  let dims = 0;
  const req = template.requires ?? {};
  if (listOverlap(signals.activity, req.activity ?? []) > 0) dims += 1;
  if (listOverlap(signals.emotion, req.emotion ?? []) > 0) dims += 1;
  if (listOverlap(signals.time, req.time ?? []) > 0 || listOverlap(signals.environment, req.time ?? []) > 0) dims += 1;
  if (listOverlap(signals.weather, req.weather ?? []) > 0 || listOverlap(signals.environment, req.weather ?? []) > 0) dims += 1;
  if (listOverlap(signals.social, req.social ?? []) > 0) dims += 1;
  if (listOverlap(signals.lifeContext, req.lifeContext ?? []) > 0) dims += 1;

  if (dims >= 4) return 45;
  if (dims === 3) return 30;
  if (dims === 2) return 15;
  return 0;
}

function compoundPatternBonus(templateId: string, signals: MomentSignals): number {
  const hasDriving = signals.activity.some((a) => /driv/i.test(a)) || signals.tokens.has("driving");
  const hasWalking = signals.activity.some((a) => /walk/i.test(a));
  const hasRain = signals.weather.length > 0 || signals.environment.some((e) => /rain/i.test(e)) || signals.tokens.has("rain");
  const hasNight = signals.time.some((t) => /night|midnight|late/i.test(t)) || signals.environment.some((e) => /night|midnight/i.test(e));
  const hasAlone = signals.social.some((s) => /alone/i.test(s)) || signals.tokens.has("alone");
  const hasStress = detectStressRecovery(signals);
  const hasNostalgia = signals.emotion.some((e) => /nostalg|bittersweet|longing/i.test(e));
  const hasHope = signals.emotion.some((e) => /hope|anticipation|fresh/i.test(e));
  const hasParty = signals.social.some((s) => /party|leaving/i.test(s)) || signals.tokens.has("party");
  const hasAchievement = signals.emotion.some((e) => /joy|pride|achievement|motivation|confidence/i.test(e));
  const hasIntrospection = signals.emotion.some((e) => /introspect|privacy|reflection|peace/i.test(e));
  const hasWindscreen = signals.sensory.some((s) => /windscreen|glass|rain/i.test(s)) || signals.tokens.has("windscreen");

  let bonus = 0;

  if (templateId === "LATE_NIGHT_SOLITARY_JOURNEY") {
    if (hasDriving && hasRain && (hasNight || hasAlone)) bonus += 55;
    else if (hasDriving && hasNight) bonus += 35;
    else if (hasDriving && hasRain) bonus += 30;
    if (hasWindscreen) bonus += 20;
    if (hasStress) bonus += 15;
    if (hasStress && hasDriving) bonus -= 25;
  }

  if (templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") {
    if (hasDriving && hasStress) bonus += 45;
    if (hasDriving && signals.emotion.some((e) => /avoid/i.test(e))) bonus += 40;
    if (hasDriving && signals.lifeContext.some((l) => /space|transition|difficult/i.test(l))) bonus += 25;
    if (hasDriving && signals.tokens.has("home")) bonus += 15;
  }

  if (templateId === "DEPARTURE_WALK" && hasWalking && (hasParty || signals.emotion.some((e) => /sad|grief|goodbye/i.test(e)))) {
    bonus += 45;
  }

  if (templateId === "MENTAL_RESET_WALK" && hasWalking && signals.emotion.some((e) => /relief|clear|reset|better/i.test(e))) {
    bonus += 40;
  }

  if (templateId === "QUIET_AFTERMATH" && (hasParty || signals.tokens.has("aftermath") || signals.emotion.some((e) => /aftermath|quiet/i.test(e)))) {
    bonus += 45;
  }

  if (templateId === "SUMMER_TRANSITION" && signals.emotion.some((e) => /nostalg|bittersweet/i.test(e))) bonus += 40;
  if (templateId === "SUMMER_TRANSITION" && signals.tokens.has("summer")) bonus += 35;
  if (templateId === "NOSTALGIC_RETURN" && hasNostalgia) bonus += 40;
  if (templateId === "FRESH_START_ALONE" && (hasHope || hasAchievement)) bonus += 35;
  if (templateId === "INTROSPECTIVE_PRIVACY" && hasIntrospection && !hasDriving) bonus += 30;
  if (templateId === "INTROSPECTIVE_PRIVACY" && !hasDriving && !hasWalking) {
    if (signals.tokens.has("chilling") || signals.emotion.some((e) => /peace|calm|feels/i.test(e))) bonus += 35;
    if (signals.activity.some((a) => /chill|relax|rest/i.test(a))) bonus += 30;
  }
  if (templateId === "DOMESTIC_QUIET" && !hasDriving && !hasWalking) {
    if (signals.activity.some((a) => /chill|relax|rest|shift/i.test(a))) bonus += 28;
  }
  if (templateId === "MENTAL_RESET_WALK" && !hasWalking && signals.emotion.some((e) => /clear|head/i.test(e))) {
    bonus -= 25;
  }
  if (templateId === "COASTAL_OPEN_ROAD" && signals.emotion.some((e) => /confidence|alive|freedom|main/i.test(e))) bonus += 35;

  return bonus;
}

function weatherOnlyPenalty(templateId: string, signals: MomentSignals): number {
  const hasMovement = signals.activity.some((a) => /driv|walk|travel|commut/i.test(a));
  if (!hasMovement) return 0;
  if (templateId === "WEATHER_REFLECTION") return 35;
  if (templateId === "DOMESTIC_QUIET") return 28;
  if (templateId === "UK_GREY_SUNDAY_INDOORS" && signals.weather.length === 0) return 20;
  return 0;
}

function graphBoost(templateId: string, graphSceneHints: string[]): number {
  const hits = graphSceneHints.filter((h) => h === templateId).length;
  return hits * 22;
}

function relationshipBoost(templateId: string, signals: MomentSignals): number {
  let boost = 0;
  for (const rel of CONCEPT_RELATIONSHIPS) {
    if (!signals.tokens.has(rel.concept) && !signals.sensory.some((s) => s.includes(rel.concept))) continue;
    const scenes = (rel as { related_scenes?: string[] }).related_scenes ?? [];
    if (scenes.includes(templateId)) boost += 18;
  }
  return boost;
}

function scoreTemplate(
  template: SceneTemplate,
  signals: MomentSignals,
  matchedConceptIds: Record<string, string[]>,
  input: SceneCompositionInput,
  emotionalProfile: EmotionalMomentProfile,
): SceneCandidate {
  const req = template.requires ?? {};
  const boostWhen = (template.boostWhen ?? {}) as Record<string, string[] | undefined>;

  const environment = listOverlap(signals.environment, [
    ...(req.environment ?? []),
    ...(template.properties.environment ?? []),
    ...(boostWhen.environment ?? []),
  ]);
  const activity = listOverlap(signals.activity, [
    ...(req.activity ?? []),
    ...(boostWhen.activity ?? []),
  ]);
  const time = listOverlap(signals.time, [...(req.time ?? []), ...(boostWhen.time ?? [])]) +
    listOverlap(signals.environment, [...(req.time ?? []), ...(boostWhen.time ?? [])]);
  const weather = listOverlap(signals.weather, [...(req.weather ?? []), ...(boostWhen.weather ?? [])]) +
    listOverlap(signals.environment, [...(req.weather ?? []), ...(boostWhen.weather ?? [])]);
  const emotion = listOverlap(signals.emotion, [
    ...(req.emotion ?? []),
    ...(template.properties.emotion ?? []),
    ...(boostWhen.emotion ?? []),
  ]);
  const social = listOverlap(signals.social, [...(req.social ?? []), ...(boostWhen.social ?? [])]);
  const lifeContext = listOverlap(signals.lifeContext, [...(req.lifeContext ?? []), ...(boostWhen.lifeContext ?? [])]);
  const sensory = listOverlap(signals.sensory, [...(boostWhen.sensory ?? [])]);

  const coherence = coherenceBonus(template, signals);
  const compound = compoundPatternBonus(template.id, signals);
  const graph = graphBoost(template.id, input.graphSceneHints ?? []) + relationshipBoost(template.id, signals);

  let intent = 0;
  if (input.intent) {
    const family = SCENE_FAMILIES[template.id];
    if (family && input.intent.sceneFamilies.includes(family)) intent += FAMILY_BOOST;
    intent += listOverlap(signals.emotion, input.intent.emotionBoosts);
    if (input.intent.preferredScenes?.includes(template.id)) intent += 40;
  }

  const emotionalDominance = emotionalDominanceBonus(template.id, emotionalProfile);

  let hint = 0;
  const hints = input.sceneHints ?? [];
  if (hints[0] === template.id) hint += 50;
  else if (hints.includes(template.id)) hint += 18;

  const penalty = weatherOnlyPenalty(template.id, signals);

  const baseTotal = Math.max(
    0,
    environment * 0.9 +
      activity * 1.4 +
      time * 1.1 +
      weather * 0.7 +
      emotion * 1.3 +
      social * 1.0 +
      lifeContext * 1.2 +
      sensory * 0.6 +
      coherence +
      compound +
      graph +
      intent +
      emotionalDominance +
      hint -
      penalty,
  );

  let moment = 0;
  let momentReasons: string[] = [];
  let total = baseTotal;
  if (input.momentInterpretation) {
    const applied = applyMomentBoost(template.id, baseTotal, input.momentInterpretation);
    total = applied.score;
    moment = applied.momentBoost - applied.momentPenalty;
    momentReasons = applied.reasons;
  }

  return {
    id: template.id,
    label: template.label,
    humanMoment: composeHumanMoment(template, signals, emotionalProfile),
    score: Math.round(total),
    breakdown: {
      environment,
      activity,
      time,
      weather,
      emotion,
      social,
      lifeContext,
      sensory,
      coherence: coherence + compound,
      intent,
      graph,
      hint,
      penalty,
      moment,
    },
    momentReasons,
  };
}

export function rankSceneCandidates(input: SceneCompositionInput, limit = 5): SceneCandidate[] {
  const signals = buildMomentSignals(input.taxonomy, input.matchedConceptIds);
  const emotionalProfile = detectEmotionalMoment(signals, input.intent);
  const ranked = SCENE_TEMPLATES.map((template) =>
    scoreTemplate(template, signals, input.matchedConceptIds, input, emotionalProfile),
  ).sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

export function composeScene(
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
  sceneHint?: string,
  options?: {
    sceneHints?: string[];
    graphSceneHints?: string[];
    intent?: IntentContract;
    momentInterpretation?: MomentInterpretation;
  },
): ComposedScene & { candidates: SceneCandidate[] } {
  const hints = [
    ...(options?.momentInterpretation?.sceneHints ?? []),
    ...(options?.sceneHints ?? []),
    ...(sceneHint ? [sceneHint] : []),
  ];
  const candidates = rankSceneCandidates(
    {
      taxonomy,
      matchedConceptIds,
      sceneHints: hints,
      graphSceneHints: options?.graphSceneHints,
      intent: options?.intent,
      momentInterpretation: options?.momentInterpretation,
    },
    5,
  );

  const signals = buildMomentSignals(taxonomy, matchedConceptIds);
  const emotionalProfile = detectEmotionalMoment(signals, options?.intent);
  const hasDriving = signals.activity.some((a) => /driv/i.test(a)) || signals.tokens.has("driving");
  const hasWalking = signals.activity.some((a) => /walk/i.test(a));

  let winner = candidates[0];
  const momentInterp = options?.momentInterpretation;
  if (winner && candidates[1] && winner.score - candidates[1].score < 15) {
    if (momentInterp?.lifeEvents.some((e) => e.category === "avoidance_delay")) {
      const reflective = candidates.find((c) => c.id === "REFLECTIVE_AVOIDANCE_JOURNEY");
      if (reflective) winner = reflective;
    } else if (emotionalProfile.stressRecovery && emotionalProfile.movementDecompression) {
      const reflective = candidates.find((c) => c.id === "REFLECTIVE_AVOIDANCE_JOURNEY");
      const lateNight = candidates.find((c) => c.id === "LATE_NIGHT_SOLITARY_JOURNEY");
      if (reflective && lateNight) {
        winner = reflective.score >= lateNight.score ? reflective : lateNight;
      } else if (reflective) {
        winner = reflective;
      }
    } else if (hasDriving || momentInterp?.movementExpected) {
      const movement = candidates.find((c) => SCENE_FAMILIES[c.id] === "MOVEMENT");
      if (movement) winner = movement;
    } else if (hasWalking) {
      const walkScene = candidates.find((c) =>
        ["DEPARTURE_WALK", "MENTAL_RESET_WALK"].includes(c.id),
      );
      if (walkScene) winner = walkScene;
    }
  }

  if (momentInterp?.sceneHints.length && winner) {
    const hinted = candidates.find((c) => momentInterp.sceneHints.includes(c.id));
    if (hinted && hinted.score >= winner.score - 20) winner = hinted;
  }
  const template =
    SCENE_TEMPLATES.find((s) => s.id === winner?.id && (winner?.score ?? 0) >= 20) ??
    SCENE_TEMPLATES.find((s) => s.id === "WEATHER_REFLECTION") ??
    SCENE_TEMPLATES[0];

  const resolved = winner && winner.score >= 20 ? template : SCENE_TEMPLATES.find((s) => s.id === "WEATHER_REFLECTION") ?? template;

  const environment = [
    ...new Set([...(resolved.properties.environment ?? []), ...taxonomy.environment.slice(0, 4)]),
  ].slice(0, 6);
  const emotion = [
    ...new Set([...resolved.properties.emotion, ...taxonomy.emotion.slice(0, 4)]),
  ].slice(0, 6);

  const top = candidates.find((c) => c.id === resolved.id) ?? winner;

  return {
    id: resolved.id,
    label: resolved.label,
    humanSummary: top?.humanMoment || resolved.humanSummary,
    score: top?.score ?? 0,
    properties: {
      environment,
      emotion,
      musicBehaviourId: resolved.properties.musicBehaviourId,
    },
    candidates,
  };
}
