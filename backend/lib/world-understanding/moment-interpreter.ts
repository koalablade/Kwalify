/**
 * Human Moment Interpreter v2 — ranks PRIMARY vs SECONDARY concepts.
 * Stories and life events outweigh isolated physical cues (weather, sensory).
 */

import type { IntentContract } from "./intent-contract";
import { SCENE_FAMILIES, type SceneFamily } from "./scene-hierarchy";
import type { WorldConceptTaxonomy } from "./types";

export type ConceptDimension = "physical" | "emotional" | "narrative";

export interface WeightedConcept {
  label: string;
  category: string;
  physical: number;
  emotional: number;
  narrative: number;
  total: number;
  isPrimary: boolean;
}

export type LifeEventCategory =
  | "loss"
  | "breakup"
  | "transition"
  | "homecoming"
  | "childhood"
  | "bad_day_aftermath"
  | "fresh_start"
  | "leaving"
  | "avoidance_delay"
  | "quiet_moment";

export type TemporalPhase = "before" | "during" | "after" | "ongoing";

export interface LifeEventSignal {
  category: LifeEventCategory;
  trigger: string;
  strength: number;
  sceneFamilies: SceneFamily[];
  sceneHints: string[];
  emotionBoosts: string[];
}

export interface TemporalSignal {
  phase: TemporalPhase;
  trigger: string;
  narrativeBoost: number;
}

export interface MomentInterpretation {
  concepts: WeightedConcept[];
  primaryConcepts: WeightedConcept[];
  lifeEvents: LifeEventSignal[];
  temporal: TemporalSignal[];
  narrativeDominance: number;
  dominantStory: string | null;
  sceneFamilyBoosts: Partial<Record<SceneFamily, number>>;
  sceneHints: string[];
  emotionBoosts: string[];
  weatherIsSecondary: boolean;
  movementExpected: boolean;
}

export interface SceneConfidenceExplanation {
  detectedMoment: { id: string; label: string; humanMoment: string; score: number };
  positiveSignals: string[];
  rejectedAlternatives: Array<{
    id: string;
    label: string;
    score: number;
    gap: number;
    reasons: string[];
  }>;
  conceptPriority: Array<{
    label: string;
    category: string;
    role: "primary" | "secondary" | "ambient";
    weights: { physical: number; emotional: number; narrative: number };
  }>;
  lifeEvents: string[];
  temporalPhases: string[];
  narrativeOverPhysical: boolean;
}

const CATEGORY_BASE: Record<string, { physical: number; emotional: number; narrative: number }> = {
  emotion: { physical: 0.1, emotional: 0.9, narrative: 0.7 },
  lifeContext: { physical: 0.2, emotional: 0.7, narrative: 0.95 },
  social: { physical: 0.15, emotional: 0.75, narrative: 0.8 },
  activity: { physical: 0.7, emotional: 0.4, narrative: 0.55 },
  environment: { physical: 0.85, emotional: 0.35, narrative: 0.4 },
  sensory: { physical: 0.9, emotional: 0.3, narrative: 0.25 },
  weather: { physical: 0.95, emotional: 0.35, narrative: 0.2 },
  time: { physical: 0.6, emotional: 0.45, narrative: 0.5 },
};

const LABEL_MODIFIERS: Array<{
  test: RegExp;
  delta: Partial<Record<ConceptDimension, number>>;
}> = [
  { test: /reflect|introspect|process|thought|peace|calm|relief/i, delta: { emotional: 0.2, narrative: 0.15 } },
  { test: /nostalg|memory|childhood|old|remember|miss/i, delta: { emotional: 0.25, narrative: 0.3 } },
  { test: /grief|loss|sad|heartbreak|breakup|goodbye/i, delta: { emotional: 0.35, narrative: 0.35 } },
  { test: /hope|fresh|start|new|achiev|success|graduat/i, delta: { emotional: 0.2, narrative: 0.3 } },
  { test: /exhaust|stress|difficult|horrible|rough|hard|bad/i, delta: { emotional: 0.3, narrative: 0.25 } },
  { test: /avoid|delay|wasn.?t ready|long way/i, delta: { emotional: 0.25, narrative: 0.35 } },
  { test: /driv|walk|travel|commut|journey|road/i, delta: { physical: 0.15, narrative: 0.2 } },
  { test: /rain|snow|fog|grey|storm|windscreen|glass/i, delta: { physical: 0.3 } },
  { test: /night|midnight|late|evening|dawn|morning/i, delta: { physical: 0.2, narrative: 0.1 } },
  { test: /home|house|apartment|flat|bedroom/i, delta: { physical: 0.25, narrative: 0.15 } },
  { test: /alone|solitary|lonely/i, delta: { emotional: 0.2, narrative: 0.15 } },
  { test: /party|leaving|aftermath|everyone (left|gone)/i, delta: { emotional: 0.2, narrative: 0.25 } },
];

const LIFE_EVENT_PATTERNS: Array<{
  category: LifeEventCategory;
  patterns: RegExp[];
  strength: number;
  sceneFamilies: SceneFamily[];
  sceneHints: string[];
  emotionBoosts: string[];
}> = [
  {
    category: "loss",
    patterns: [
      /\b(?:lost|losing|passed away|died|death|grief|mourning|funeral)\b/i,
      /\bafter (?:losing|losing someone|they (?:left|died|passed))\b/i,
    ],
    strength: 0.95,
    sceneFamilies: ["PRIVATE", "MOVEMENT", "NOSTALGIA"],
    sceneHints: ["DEPARTURE_WALK", "INTROSPECTIVE_PRIVACY", "NOSTALGIC_RETURN"],
    emotionBoosts: ["grief", "sadness", "reflection"],
  },
  {
    category: "breakup",
    patterns: [
      /\b(?:breakup|broke up|split up|ex[ -]?(?:partner|boyfriend|girlfriend)|heartbreak)\b/i,
      /\bafter (?:the|a) (?:breakup|argument|fight|split)\b/i,
    ],
    strength: 0.9,
    sceneFamilies: ["MOVEMENT", "PRIVATE"],
    sceneHints: ["REFLECTIVE_AVOIDANCE_JOURNEY", "DEPARTURE_WALK", "LATE_NIGHT_SOLITARY_JOURNEY"],
    emotionBoosts: ["sadness", "reflection", "grief"],
  },
  {
    category: "bad_day_aftermath",
    patterns: [
      /\b(?:horrible|terrible|awful|worst) day\b/i,
      /\bafter (?:a |the )?(?:horrible|terrible|awful|rough|hard|bad|worst|long|stressful) day\b/i,
      /\bget(?:ting)? through (?:the day|today)\b/i,
    ],
    strength: 0.9,
    sceneFamilies: ["MOVEMENT", "PRIVATE"],
    sceneHints: ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY", "MENTAL_RESET_WALK"],
    emotionBoosts: ["exhaustion", "relief", "reflection", "stress"],
  },
  {
    category: "bad_day_aftermath",
    patterns: [
      /\b(?:difficult|rough|hard|bad) day\b/i,
    ],
    strength: 0.55,
    sceneFamilies: ["MOVEMENT", "PRIVATE"],
    sceneHints: [],
    emotionBoosts: ["exhaustion", "relief", "reflection"],
  },
  {
    category: "transition",
    patterns: [
      /\b(?:moving (?:away|house|out|in)|new (?:city|job|chapter|phase)|life (?:changing|is changing)|starting again|fresh chapter)\b/i,
      /\b(?:leaving (?:work|job|uni|university|college)|last (?:day|summer|night))\b/i,
      /\b(?:last summer before|summer ending|end of summer)\b/i,
      /\b(?:transition|turning point|crossroads)\b/i,
      /\bdriving home after (?:losing|getting fired|redundancy)\b/i,
      /\bafter losing my job\b/i,
    ],
    strength: 0.85,
    sceneFamilies: ["LIFE_TRANSITIONS", "MOVEMENT", "NOSTALGIA"],
    sceneHints: ["FRESH_START_ALONE", "SUMMER_TRANSITION", "DEPARTURE_WALK"],
    emotionBoosts: ["hope", "anticipation", "anxiety", "nostalgia"],
  },
  {
    category: "homecoming",
    patterns: [
      /\b(?:finally home|back home at last|home at last)\b/i,
    ],
    strength: 0.7,
    sceneFamilies: ["PRIVATE"],
    sceneHints: ["DOMESTIC_QUIET", "INTROSPECTIVE_PRIVACY"],
    emotionBoosts: ["relief", "reflection", "exhaustion"],
  },
  {
    category: "homecoming",
    patterns: [
      /\b(?:coming home|driving home|heading home|going home)\b/i,
    ],
    strength: 0.45,
    sceneFamilies: ["MOVEMENT"],
    sceneHints: [],
    emotionBoosts: ["relief", "reflection"],
  },
  {
    category: "childhood",
    patterns: [
      /\b(?:childhood|teenage years|when i was (?:young|a kid)|old neighbourhood|old neighborhood|where i grew up)\b/i,
      /\b(?:memories of|remember when|used to be)\b/i,
    ],
    strength: 0.85,
    sceneFamilies: ["NOSTALGIA"],
    sceneHints: ["NOSTALGIC_RETURN", "SUMMER_TRANSITION"],
    emotionBoosts: ["nostalgia", "bittersweet", "longing"],
  },
  {
    category: "fresh_start",
    patterns: [
      /\b(?:first (?:night|day|apartment|flat|place)|new place|boxes unpacked|finally feels like home)\b/i,
      /\b(?:fresh start|new beginning|starting over|clean slate)\b/i,
    ],
    strength: 0.82,
    sceneFamilies: ["LIFE_TRANSITIONS"],
    sceneHints: ["FRESH_START_ALONE"],
    emotionBoosts: ["hope", "anticipation", "contentment"],
  },
  {
    category: "leaving",
    patterns: [
      /\b(?:leaving (?:the )?(?:party|club|bar|gig|event)|after (?:everyone|the party) (?:left|gone))\b/i,
      /\b(?:walking away after|said goodbye)\b/i,
    ],
    strength: 0.83,
    sceneFamilies: ["MOVEMENT", "SOCIAL"],
    sceneHints: ["DEPARTURE_WALK", "QUIET_AFTERMATH"],
    emotionBoosts: ["sadness", "reflection", "loneliness"],
  },
  {
    category: "avoidance_delay",
    patterns: [
      /\b(?:wasn.?t ready to go (?:in|back)|not ready to go (?:in|back))\b/i,
      /\b(?:sat outside|sitting outside).*(?:house|home|door)\b/i,
      /\b(?:long way (?:home|back)|took the long way)\b/i,
      /\b(?:wasn.?t ready to return|delaying going (?:in|home|back))\b/i,
    ],
    strength: 0.92,
    sceneFamilies: ["MOVEMENT", "PRIVATE"],
    sceneHints: ["REFLECTIVE_AVOIDANCE_JOURNEY"],
    emotionBoosts: ["avoidance", "reflection", "processing"],
  },
  {
    category: "quiet_moment",
    patterns: [
      /\b(?:just chilling|taking it easy|daydreaming|in my feels)\b/i,
      /\b(?:can.?t sleep so|lying awake|quiet night in)\b/i,
      /\b(?:after (?:a |the )?(?:shift|work))\b/i,
      /\b(?:needed some space|need(?:ed)? space|clearing my head)\b/i,
    ],
    strength: 0.72,
    sceneFamilies: ["PRIVATE"],
    sceneHints: ["INTROSPECTIVE_PRIVACY", "DOMESTIC_QUIET"],
    emotionBoosts: ["reflection", "peace", "introspection"],
  },
];

const TEMPORAL_PATTERNS: Array<{
  phase: TemporalPhase;
  patterns: RegExp[];
  narrativeBoost: number;
}> = [
  {
    phase: "after",
    patterns: [
      /\bafter (?:a |the |everyone |the party |the argument |work |school |uni )\b/i,
      /\bafter (?:losing|breaking|leaving|finishing|ending|losing my job)\b/i,
      /\b(?:finally|at last|when (?:it|everything) (?:ended|stopped|quieted))\b/i,
      /\b(?:not anymore|can't believe|anymore)\b/i,
    ],
    narrativeBoost: 0.35,
  },
  {
    phase: "before",
    patterns: [
      /\bbefore (?:the |a |going|leaving|starting|moving|monday)\b/i,
      /\b(?:about to|on the verge|last (?:summer|night|day) before)\b/i,
      /\banticipat/i,
      /\bone day\b/i,
    ],
    narrativeBoost: 0.25,
  },
  {
    phase: "during",
    patterns: [
      /\b(?:while|during|as i|walking through|driving (?:through|at|down|home)|on the way)\b/i,
      /\b(?:in the middle of|mid-)\b/i,
      /\bstill\b/i,
    ],
    narrativeBoost: 0.1,
  },
  {
    phase: "ongoing",
    patterns: [
      /\b(?:still|keeps?|can.?t stop|ongoing|every day)\b/i,
      /\b(?:used to|remember when)\b/i,
      /\b(?:again|once)\b/i,
      /\bsomeday\b/i,
    ],
    narrativeBoost: 0.15,
  },
];

const WEATHER_ONLY_SCENES = new Set(["WEATHER_REFLECTION", "UK_GREY_SUNDAY_INDOORS", "DOMESTIC_QUIET"]);

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function weightConcept(label: string, category: string): WeightedConcept {
  const base = CATEGORY_BASE[category] ?? { physical: 0.5, emotional: 0.5, narrative: 0.5 };
  let physical = base.physical;
  let emotional = base.emotional;
  let narrative = base.narrative;

  for (const mod of LABEL_MODIFIERS) {
    if (mod.test.test(label)) {
      physical += mod.delta.physical ?? 0;
      emotional += mod.delta.emotional ?? 0;
      narrative += mod.delta.narrative ?? 0;
    }
  }

  physical = clamp(physical);
  emotional = clamp(emotional);
  narrative = clamp(narrative);
  const total = physical * 0.25 + emotional * 0.35 + narrative * 0.4;

  return { label, category, physical, emotional, narrative, total, isPrimary: false };
}

function detectLifeEvents(prompt: string): LifeEventSignal[] {
  const found: LifeEventSignal[] = [];
  for (const entry of LIFE_EVENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      const match = prompt.match(pattern);
      if (!match) continue;
      found.push({
        category: entry.category,
        trigger: match[0],
        strength: entry.strength,
        sceneFamilies: entry.sceneFamilies,
        sceneHints: entry.sceneHints,
        emotionBoosts: entry.emotionBoosts,
      });
      break;
    }
  }
  return found;
}

function detectTemporal(prompt: string): TemporalSignal[] {
  const found: TemporalSignal[] = [];
  for (const entry of TEMPORAL_PATTERNS) {
    for (const pattern of entry.patterns) {
      const match = prompt.match(pattern);
      if (!match) continue;
      found.push({ phase: entry.phase, trigger: match[0], narrativeBoost: entry.narrativeBoost });
      break;
    }
  }
  return found;
}

function collectConcepts(
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
): WeightedConcept[] {
  const concepts: WeightedConcept[] = [];

  const add = (label: string, category: string) => {
    if (!label) return;
    concepts.push(weightConcept(label, category));
  };

  for (const v of taxonomy.emotion) add(v, "emotion");
  for (const v of taxonomy.lifeContext) add(v, "lifeContext");
  for (const v of taxonomy.social) add(v, "social");
  for (const v of taxonomy.activity) add(v, "activity");
  for (const v of taxonomy.environment) add(v, "environment");
  for (const v of taxonomy.sensory) add(v, "sensory");

  for (const id of matchedConceptIds.weather ?? []) {
    add(id.replace(/_/g, " "), "weather");
  }
  for (const id of matchedConceptIds.time ?? []) {
    add(id.replace(/_/g, " "), "time");
  }

  return concepts;
}

function markPrimaryConcepts(
  concepts: WeightedConcept[],
  lifeEvents: LifeEventSignal[],
  temporal: TemporalSignal[],
): void {
  const narrativeFloor =
    0.45 + temporal.filter((t) => t.phase === "after").length * 0.1 + lifeEvents.length * 0.08;

  const sorted = [...concepts].sort((a, b) => b.total - a.total);
  if (sorted.length === 0) return;

  const primaryThreshold = Math.max(narrativeFloor, sorted[0].total * 0.65);
  for (const c of concepts) {
    const narrativeHeavy = c.narrative >= 0.55 && c.narrative > c.physical;
    const lifeContext = c.category === "lifeContext" || c.category === "emotion";
    c.isPrimary = c.total >= primaryThreshold || (narrativeHeavy && lifeContext && c.total >= 0.4);
  }

  if (!concepts.some((c) => c.isPrimary) && sorted[0]) {
    sorted[0].isPrimary = true;
  }
}

function buildDominantStory(
  lifeEvents: LifeEventSignal[],
  temporal: TemporalSignal[],
  primaryConcepts: WeightedConcept[],
): string | null {
  if (lifeEvents.length > 0) {
    const top = lifeEvents.sort((a, b) => b.strength - a.strength)[0];
    const phase = temporal.find((t) => t.phase === "after")?.phase ?? temporal[0]?.phase;
    const phaseLabel = phase ? `${phase} ` : "";
    return `${phaseLabel}${top.category.replace(/_/g, " ")} (${top.trigger})`;
  }
  if (temporal.some((t) => t.phase === "after") && primaryConcepts.length > 0) {
    return `aftermath — ${primaryConcepts.map((c) => c.label).slice(0, 2).join(", ")}`;
  }
  if (primaryConcepts.length >= 2) {
    return primaryConcepts
      .sort((a, b) => b.narrative - a.narrative)
      .slice(0, 2)
      .map((c) => c.label)
      .join(" · ");
  }
  return null;
}

export function interpretMoment(
  prompt: string,
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
  intent?: IntentContract,
): MomentInterpretation {
  const lifeEvents = detectLifeEvents(prompt);
  const temporal = detectTemporal(prompt);
  const concepts = collectConcepts(taxonomy, matchedConceptIds);
  markPrimaryConcepts(concepts, lifeEvents, temporal);

  const primaryConcepts = concepts.filter((c) => c.isPrimary);
  const narrativeDominance = concepts.length
    ? concepts.reduce((s, c) => s + c.narrative * (c.isPrimary ? 1.5 : 0.5), 0) /
      concepts.reduce((s, c) => s + (c.isPrimary ? 1.5 : 0.5), 0)
    : 0;

  const physicalDominance = concepts.length
    ? concepts.reduce((s, c) => s + c.physical * (c.isPrimary ? 0.5 : 1), 0) / concepts.length
    : 0;

  const weatherIsSecondary =
    narrativeDominance > 0.55 &&
    (lifeEvents.some((e) => e.strength >= 0.85) ||
      lifeEvents.some((e) => e.category === "avoidance_delay" || e.category === "breakup" || e.category === "loss")) &&
    primaryConcepts.some((c) => c.category === "emotion" || c.category === "lifeContext" || c.category === "social");

  const hasMovementActivity =
    concepts.some((c) => c.category === "activity" && /driv|walk|travel|commut|journey|run/i.test(c.label)) ||
    /\b(?:driving|walking|on the way|heading|commut|took the long way)/i.test(prompt);

  const movementExpected = hasMovementActivity && !lifeEvents.some((e) => e.category === "quiet_moment");

  const sceneFamilyBoosts: Partial<Record<SceneFamily, number>> = {};
  const sceneHints: string[] = [];
  const emotionBoosts: string[] = [];

  for (const le of lifeEvents) {
    const familyBoost = Math.round(le.strength * 35);
    for (const fam of le.sceneFamilies) {
      sceneFamilyBoosts[fam] = (sceneFamilyBoosts[fam] ?? 0) + familyBoost;
    }
    if (le.strength >= 0.75 || le.category === "quiet_moment" || le.category === "avoidance_delay") {
      sceneHints.push(...le.sceneHints);
    }
    emotionBoosts.push(...le.emotionBoosts);
  }

  if (temporal.some((t) => t.phase === "after") && movementExpected) {
    sceneFamilyBoosts.MOVEMENT = (sceneFamilyBoosts.MOVEMENT ?? 0) + 18;
  }
  if (temporal.some((t) => t.phase === "after") && !movementExpected) {
    sceneFamilyBoosts.PRIVATE = (sceneFamilyBoosts.PRIVATE ?? 0) + 18;
  }

  if (intent) {
    for (const fam of intent.sceneFamilies) {
      const family = fam as SceneFamily;
      sceneFamilyBoosts[family] = (sceneFamilyBoosts[family] ?? 0) + 18;
    }
    emotionBoosts.push(...intent.emotionBoosts);
  }

  if (movementExpected && (lifeEvents.length > 0 || temporal.some((t) => t.phase === "after"))) {
    sceneFamilyBoosts.MOVEMENT = (sceneFamilyBoosts.MOVEMENT ?? 0) + 25;
  }

  const dominantStory = buildDominantStory(lifeEvents, temporal, primaryConcepts);

  return {
    concepts,
    primaryConcepts,
    lifeEvents,
    temporal,
    narrativeDominance,
    dominantStory,
    sceneFamilyBoosts,
    sceneHints: Array.from(new Set(sceneHints)),
    emotionBoosts: Array.from(new Set(emotionBoosts)),
    weatherIsSecondary,
    movementExpected,
  };
}

export function applyMomentBoost(
  templateId: string,
  baseScore: number,
  interpretation: MomentInterpretation,
): { score: number; momentBoost: number; momentPenalty: number; reasons: string[] } {
  let boost = 0;
  let penalty = 0;
  const reasons: string[] = [];

  const family = SCENE_FAMILIES[templateId];
  if (family && interpretation.sceneFamilyBoosts[family]) {
    boost += interpretation.sceneFamilyBoosts[family]!;
    reasons.push(`life-event/story favours ${family} family (+${interpretation.sceneFamilyBoosts[family]})`);
  }

  if (interpretation.sceneHints.includes(templateId)) {
    boost += 28;
    reasons.push("life-event pattern match (+28)");
  }

  const narrativeEmotionOverlap = interpretation.primaryConcepts.filter(
    (c) => c.category === "emotion" || c.category === "lifeContext",
  ).length;
  if (narrativeEmotionOverlap > 0 && !WEATHER_ONLY_SCENES.has(templateId)) {
    boost += narrativeEmotionOverlap * 12;
    if (narrativeEmotionOverlap >= 1) reasons.push(`narrative concepts (+${narrativeEmotionOverlap * 12})`);
  }

  if (interpretation.weatherIsSecondary && WEATHER_ONLY_SCENES.has(templateId)) {
    penalty += 38;
    reasons.push("weather-only scene penalised when story dominates (-38)");
  }

  if (
    interpretation.movementExpected &&
    interpretation.lifeEvents.length > 0 &&
    !interpretation.lifeEvents.some((e) => e.category === "quiet_moment") &&
    family === "MOVEMENT" &&
    !WEATHER_ONLY_SCENES.has(templateId)
  ) {
    boost += 20;
    reasons.push("movement + life-event journey (+20)");
  }

  if (interpretation.dominantStory && interpretation.temporal.some((t) => t.phase === "after")) {
    const journeyScenes = [
      "LATE_NIGHT_SOLITARY_JOURNEY",
      "REFLECTIVE_AVOIDANCE_JOURNEY",
      "MENTAL_RESET_WALK",
      "DEPARTURE_WALK",
    ];
    if (
      journeyScenes.includes(templateId) &&
      interpretation.movementExpected &&
      !interpretation.lifeEvents.some((e) => e.category === "quiet_moment")
    ) {
      boost += 18;
      reasons.push("aftermath journey arc (+18)");
    }
  }

  const afterBadDay = interpretation.lifeEvents.some(
    (e) => e.category === "bad_day_aftermath" && e.strength >= 0.85,
  );
  if (afterBadDay && interpretation.movementExpected) {
    const recoveryScenes = ["LATE_NIGHT_SOLITARY_JOURNEY", "REFLECTIVE_AVOIDANCE_JOURNEY"];
    if (recoveryScenes.includes(templateId)) {
      boost += 20;
      reasons.push("emotional recovery journey (+20)");
    }
  }

  if (interpretation.lifeEvents.some((e) => e.category === "transition" && /summer/i.test(e.trigger))) {
    if (templateId === "SUMMER_TRANSITION") {
      boost += 30;
      reasons.push("summer transition arc (+30)");
    }
    if (templateId === "FRESH_START_ALONE") {
      penalty += 15;
    }
  }

  if (interpretation.lifeEvents.some((e) => e.category === "avoidance_delay")) {
    if (templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") {
      boost += 35;
      reasons.push("avoidance/delay pattern (+35)");
    }
  }

  if (interpretation.lifeEvents.some((e) => e.category === "quiet_moment") && !interpretation.movementExpected) {
    if (templateId === "INTROSPECTIVE_PRIVACY" || templateId === "DOMESTIC_QUIET") {
      boost += 45;
      reasons.push("quiet private moment (+45)");
    }
    if (templateId === "LATE_NIGHT_SOLITARY_JOURNEY" || templateId === "REFLECTIVE_AVOIDANCE_JOURNEY") {
      penalty += 35;
      reasons.push("movement scene penalised for static moment (-35)");
    }
    if (templateId === "MENTAL_RESET_WALK") {
      penalty += 30;
      reasons.push("walk scene penalised for static moment (-30)");
    }
  }

  return { score: Math.max(0, baseScore + boost - penalty), momentBoost: boost, momentPenalty: penalty, reasons };
}

export function buildSceneConfidenceExplanation(
  winnerId: string,
  winnerLabel: string,
  winnerMoment: string,
  winnerScore: number,
  allCandidates: Array<{ id: string; label: string; score: number; momentReasons?: string[] }>,
  interpretation: MomentInterpretation,
): SceneConfidenceExplanation {
  const winner = allCandidates.find((c) => c.id === winnerId);
  const positiveSignals: string[] = [];

  if (interpretation.dominantStory) {
    positiveSignals.push(`Dominant story: ${interpretation.dominantStory}`);
  }
  for (const le of interpretation.lifeEvents) {
    positiveSignals.push(`Life event: ${le.category} ("${le.trigger}")`);
  }
  for (const t of interpretation.temporal) {
    positiveSignals.push(`Temporal: ${t.phase} ("${t.trigger}")`);
  }
  for (const c of interpretation.primaryConcepts.slice(0, 4)) {
    positiveSignals.push(
      `Primary: ${c.label} [phys ${c.physical.toFixed(1)}, emo ${c.emotional.toFixed(1)}, narr ${c.narrative.toFixed(1)}]`,
    );
  }
  if (winner?.momentReasons?.length) {
    positiveSignals.push(...winner.momentReasons);
  }

  const rejectedAlternatives = allCandidates
    .filter((c) => c.id !== winnerId)
    .slice(0, 4)
    .map((c) => {
      const reasons: string[] = [];
      const gap = winnerScore - c.score;
      if (WEATHER_ONLY_SCENES.has(c.id) && interpretation.weatherIsSecondary) {
        reasons.push("weather-only scene deprioritised — narrative story dominates");
      }
      if (interpretation.sceneHints.length > 0 && !interpretation.sceneHints.includes(c.id)) {
        reasons.push("no life-event pattern alignment");
      }
      const cFamily = SCENE_FAMILIES[c.id];
      const topFamilyBoost = Object.entries(interpretation.sceneFamilyBoosts).sort(
        (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
      )[0];
      if (topFamilyBoost && cFamily !== topFamilyBoost[0]) {
        reasons.push(`scene family ${cFamily} vs favoured ${topFamilyBoost[0]}`);
      }
      if (gap > 30) reasons.push(`score gap ${gap} — weaker dimensional match`);
      else if (gap <= 10) reasons.push(`close contender (gap ${gap}) — lost on narrative weighting`);
      if (reasons.length === 0) reasons.push("lower composite score across dimensions");
      return { id: c.id, label: c.label, score: c.score, gap, reasons };
    });

  const conceptPriority = interpretation.concepts
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((c) => ({
      label: c.label,
      category: c.category,
      role: c.isPrimary ? ("primary" as const) : c.physical > c.narrative ? ("ambient" as const) : ("secondary" as const),
      weights: { physical: c.physical, emotional: c.emotional, narrative: c.narrative },
    }));

  return {
    detectedMoment: { id: winnerId, label: winnerLabel, humanMoment: winnerMoment, score: winnerScore },
    positiveSignals,
    rejectedAlternatives,
    conceptPriority,
    lifeEvents: interpretation.lifeEvents.map((e) => `${e.category}: "${e.trigger}"`),
    temporalPhases: interpretation.temporal.map((t) => `${t.phase}: "${t.trigger}"`),
    narrativeOverPhysical: interpretation.narrativeDominance > 0.5 && interpretation.weatherIsSecondary,
  };
}
