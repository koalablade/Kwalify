/**
 * Human Experience Benchmark Audit — measurement-only diagnostic harness.
 * Evaluates interpretWorld() across 10k prompts with per-dimension scoring,
 * failure classification, pattern clustering, and adversarial probes.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { interpretWorld } from "./index";
import { summariseFingerprintDimensions } from "./moment-representation";
import type { WorldUnderstandingResult } from "./types";

export type AuditDimension =
  | "humanExperience"
  | "emotionalInterpretation"
  | "narrative"
  | "activity"
  | "environment"
  | "weatherInterpretation"
  | "socialContext"
  | "lifeEventDetection"
  | "emotionalArc"
  | "playlistIntent"
  | "musicalBehaviour";

export type FailureCategory =
  | "wrong_experience"
  | "missing_concept"
  | "priority_mistake"
  | "phrase_interpretation_failure"
  | "multi_hop_failure"
  | "emotional_arc_failure";

export interface BenchmarkPrompt {
  prompt: string;
  category: string;
  style: string;
}

export interface PromptExpectations {
  humanExperience: string[];
  emotion: string[];
  narrative: string[];
  activity: string[];
  environment: string[];
  weather: string[];
  social: string[];
  lifeEvent: string[];
  emotionalArc: string[];
  playlistIntent: string[];
  requiresMusicalBehaviour: boolean;
  requiresPhraseMatch: boolean;
  multiHopChain: string[];
  weatherIsSecondary: boolean;
}

export interface DimensionResult {
  dimension: AuditDimension;
  passed: boolean;
  score: number;
  expected: string[];
  actual: string[];
}

export interface AuditFailure {
  prompt: string;
  category: string;
  expected: Record<string, string[]>;
  actual: Record<string, string[]>;
  category_failures: FailureCategory[];
  missing_reason: string;
  recommended_fix: string;
  debug: {
    conceptExtraction: Record<string, string[]>;
    primaryConcepts: string[];
    secondaryConcepts: string[];
    ignoredConcepts: string[];
    chosen: string;
    rejected: Array<{ id: string; label: string; score: number }>;
  };
}

export interface FailurePattern {
  pattern: string;
  count: number;
  category: FailureCategory;
  example_prompts: string[];
  recommended_fix: string;
}

export interface HumanExperienceAuditReport {
  generatedAt: string;
  total_prompts: number;
  accuracy: Record<AuditDimension, number>;
  accuracy_pct: Record<AuditDimension, number>;
  weakest_dimensions: Array<{ dimension: AuditDimension; pct: number }>;
  failure_summary: Record<FailureCategory, number>;
  failures: AuditFailure[];
  top_failure_patterns: FailurePattern[];
  atlas_gap_recommendations: Array<{ gap: string; evidence_count: number; example_prompts: string[] }>;
  weight_calibration: {
    life_event: { current: number; suggested: number; rationale: string };
    emotion: { current: number; suggested: number; rationale: string };
    weather: { current: number; suggested: number; rationale: string };
    activity: { current: number; suggested: number; rationale: string };
    environment: { current: number; suggested: number; rationale: string };
  };
  adversarial_results: Record<
    string,
    Array<{
      prompt: string;
      passed: boolean;
      scene: string;
      playlistIntent: string;
      emotions: string[];
      debug_chain: string[];
    }>
  >;
  architecture_assessment: {
    target_95_pct_realistic: boolean;
    current_overall_pct: number;
    gap_to_95: number;
    bottleneck: string;
    path_to_improvement: string[];
  };
}

const ACTIVITY_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bdriv/i, tokens: ["driv", "car", "motorway", "road", "journey", "vehicle"] },
  { re: /\bwalk/i, tokens: ["walk", "foot"] },
  { re: /\bsit(?:ting)?\b/i, tokens: ["sit", "still", "stationary"] },
  { re: /\bcommut/i, tokens: ["commut", "travel", "journey"] },
  { re: /\btrain\b/i, tokens: ["train", "rail", "journey"] },
  { re: /\btaxi\b/i, tokens: ["taxi", "ride", "car"] },
  { re: /\bcycl/i, tokens: ["cycl", "bike"] },
  { re: /\bshower\b/i, tokens: ["shower", "wash"] },
  { re: /\bcuppa|tea\b/i, tokens: ["tea", "drink", "ritual"] },
  { re: /\bcook|baking\b/i, tokens: ["cook", "kitchen", "food"] },
  { re: /\bgam(?:e|ing)\b/i, tokens: ["gam", "play", "focus"] },
  { re: /\bread(?:ing)?\b/i, tokens: ["read", "book", "quiet"] },
  { re: /\bscroll/i, tokens: ["scroll", "phone", "screen"] },
  { re: /\bwait(?:ing)?\b/i, tokens: ["wait", "anticipat", "suspended"] },
  { re: /\bclock(?:ed)? off\b/i, tokens: ["work", "leav", "finish", "release"] },
  { re: /\bgarden/i, tokens: ["garden", "outdoor", "potter"] },
  { re: /\brun(?:ning)?\b/i, tokens: ["run", "exercise", "pace"] },
];

const ENV_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bcar\b/i, tokens: ["car", "vehicle", "enclosed"] },
  { re: /\bhome\b|\bhouse\b|\bflat\b|\bindoors\b/i, tokens: ["home", "domestic", "indoor", "house"] },
  { re: /\bpub\b/i, tokens: ["pub", "bar", "social"] },
  { re: /\bbeach\b/i, tokens: ["beach", "coast", "sea"] },
  { re: /\bbedroom\b/i, tokens: ["bedroom", "bed", "private"] },
  { re: /\bkitchen\b/i, tokens: ["kitchen", "home", "domestic"] },
  { re: /\bmotorway\b/i, tokens: ["motorway", "road", "highway"] },
  { re: /\bsupermarket\b/i, tokens: ["supermarket", "shop", "store"] },
  { re: /\bhospital\b/i, tokens: ["hospital", "medical", "waiting"] },
  { re: /\bpetrol\b/i, tokens: ["petrol", "station", "fuel"] },
  { re: /\bgarage\b/i, tokens: ["garage", "shed", "workshop"] },
  { re: /\bwaiting room\b/i, tokens: ["waiting", "reception", "lobby"] },
  { re: /\bsofa\b|\bcouch\b/i, tokens: ["sofa", "living", "home"] },
  { re: /\bgarden\b/i, tokens: ["garden", "outdoor", "yard"] },
];

const WEATHER_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\brain/i, tokens: ["rain", "wet", "drizzle", "storm"] },
  { re: /\bwindscreen\b/i, tokens: ["rain", "wet", "windscreen", "glass"] },
  { re: /\bfog/i, tokens: ["fog", "mist", "uncertain"] },
  { re: /\bsun(?:ny)?\b/i, tokens: ["sun", "warm", "bright", "free"] },
  { re: /\bstorm/i, tokens: ["storm", "rain", "wind"] },
  { re: /\bovercast|grey\b/i, tokens: ["grey", "overcast", "cloud"] },
];

const EMOTION_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bsad\b/i, tokens: ["sad", "melanchol", "grief", "sorrow"] },
  { re: /\bnostalg/i, tokens: ["nostalg", "memory", "past", "remember"] },
  { re: /\banxious|dread|scaries\b/i, tokens: ["anxiet", "dread", "worr", "unease"] },
  { re: /\bexhaust|knackered|shattered|tiring\b/i, tokens: ["exhaust", "tired", "fatigue", "drain", "decompress"] },
  { re: /\bpeaceful|calm|quiet\b/i, tokens: ["peace", "calm", "quiet", "serene"] },
  { re: /\blonely|alone\b/i, tokens: ["lonel", "alone", "isolat", "solitary"] },
  { re: /\bhopeful|buzzing\b/i, tokens: ["hope", "optim", "excit", "buzz"] },
  { re: /\bheartbreak|gutted|grief\b/i, tokens: ["heartbreak", "grief", "loss", "sad"] },
  { re: /\bfree(?:dom)?\b/i, tokens: ["free", "liberat", "release"] },
  { re: /\bnumb|overwhelm/i, tokens: ["numb", "overwhelm", "heavy"] },
  { re: /\breflect/i, tokens: ["reflect", "contemplat", "thought"] },
];

const SOCIAL_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\balone\b|\bby myself\b|\bno one\b/i, tokens: ["alone", "solitary", "isolat", "private"] },
  { re: /\bfamily\b/i, tokens: ["family", "relative", "kin"] },
  { re: /\bfriend|mate\b/i, tokens: ["friend", "mate", "social"] },
  { re: /\bparty\b|\beveryone left\b/i, tokens: ["party", "social", "aftermath", "alone"] },
  { re: /\bdate\b|\blove\b|\bmiss(?:ing)?\b/i, tokens: ["love", "romance", "miss", "relationship"] },
  { re: /\btext back\b|\bwaiting for\b/i, tokens: ["wait", "anticipat", "relationship", "anxiet"] },
];

const LIFE_EVENT_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bbreakup|broke up\b/i, tokens: ["breakup", "break", "heartbreak", "loss"] },
  { re: /\bgraduat/i, tokens: ["graduat", "achievement", "milestone"] },
  { re: /\bmoving\b|\bnew (?:flat|apartment|place|chapter)\b/i, tokens: ["moving", "transition", "new", "change"] },
  { re: /\bgrief|funeral|losing someone\b/i, tokens: ["grief", "loss", "death", "mourning"] },
  { re: /\bpromot/i, tokens: ["promot", "achievement", "success"] },
  { re: /\bfirst (?:job|day)\b/i, tokens: ["first", "new", "beginning", "milestone"] },
  { re: /\bworst day|horrible day|rough day|bad day|difficult day\b/i, tokens: ["stress", "exhaust", "recovery", "decompress", "bad day"] },
  { re: /\bnew chapter|life is changing\b/i, tokens: ["change", "transition", "uncertain", "new"] },
];

const NARRATIVE_SIGNALS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bafter (?:work|the|a|losing)\b/i, tokens: ["after", "transition", "decompress", "recovery"] },
  { re: /\bfinally(?: got home| clocked off)?\b/i, tokens: ["arrival", "relief", "release", "transition"] },
  { re: /\bdon't want to go inside\b/i, tokens: ["delay", "decompress", "private", "transition"] },
  { re: /\bnot ready\b/i, tokens: ["delay", "transition", "hesitat"] },
  { re: /\bbefore monday\b/i, tokens: ["anticipat", "dread", "before", "transition"] },
  { re: /\bending\b|\blast summer\b/i, tokens: ["ending", "nostalg", "loss", "change"] },
  { re: /\bremember when\b|\bused to\b/i, tokens: ["nostalg", "memory", "past", "change"] },
  { re: /\bnot anymore\b|\bcan't believe\b/i, tokens: ["loss", "transition", "acceptance"] },
  { re: /\bstill\b|\bagain\b|\bonce\b/i, tokens: ["ongoing", "repetition", "narrative"] },
  { re: /\bone day\b|\bsomeday\b/i, tokens: ["hope", "anticipat", "future"] },
];

const PLAYLIST_INTENT_SIGNALS: Array<{ re: RegExp; intent: string }> = [
  { re: /\brecover|decompress|worst day|horrible day|rough day|shattered|knackered\b/i, intent: "recover" },
  { re: /\bdriv|motorway|road trip\b/i, intent: "drive" },
  { re: /\bescape|disappear|clear my head\b/i, intent: "escape" },
  { re: /\bcelebrat|promot|buzzing|graduat\b/i, intent: "celebrate" },
  { re: /\bcry|grief|heartbreak|gutted\b/i, intent: "cry" },
  { re: /\brelax|cosy|lazy\b/i, intent: "relax" },
  { re: /\bremember|nostalg|old days|miss\b/i, intent: "remember" },
  { re: /\bprocess|overthink|2am thoughts\b/i, intent: "process" },
];

const BRITISH_PHRASES: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bknackered\b/i, tokens: ["exhaust", "tired", "fatigue"] },
  { re: /\bshattered\b/i, tokens: ["exhaust", "tired", "drain"] },
  { re: /\bgutted\b/i, tokens: ["disappoint", "sad", "upset"] },
  { re: /\bcuppa\b/i, tokens: ["tea", "comfort", "ritual"] },
  { re: /\bcan't be (?:bothered|arsed)\b/i, tokens: ["apathet", "exhaust", "low energy"] },
  { re: /\bproper (?:rough|tired)\b/i, tokens: ["difficult", "stress", "exhaust"] },
  { re: /\bdoing my head in\b/i, tokens: ["stress", "overwhelm", "anxiet"] },
  { re: /\bsunday scaries\b/i, tokens: ["dread", "anxiet", "anticipat"] },
  { re: /\bbank holiday\b/i, tokens: ["leisure", "relax", "weekend"] },
  { re: /\bfed up\b/i, tokens: ["frustrat", "exhaust", "resent"] },
  { re: /\bneed a break\b/i, tokens: ["exhaust", "overwhelm", "rest"] },
  { re: /\bcan't face it\b/i, tokens: ["avoid", "anxiet", "exhaust"] },
  { re: /\bhaving a mare\b/i, tokens: ["stress", "chaos", "frustrat"] },
  { re: /\bchilled out\b/i, tokens: ["calm", "relax", "content"] },
  { re: /\bmade up\b/i, tokens: ["joy", "delight", "happy"] },
  { re: /\bsorted\b/i, tokens: ["relief", "resolv", "content"] },
  { re: /\bpop(?:ping)? out\b/i, tokens: ["errand", "trip", "local"] },
  { re: /\bnipping out\b/i, tokens: ["errand", "trip", "local"] },
  { re: /\bclocked off\b/i, tokens: ["work", "leav", "release", "exhaust"] },
  { re: /\blong one\b/i, tokens: ["exhaust", "difficult", "day"] },
];

const MULTI_HOP_CHAINS: Array<{ trigger: RegExp; chain: string[] }> = [
  { trigger: /\bwindscreen\b/i, chain: ["car", "driv", "journey"] },
  { trigger: /\bcuppa\b/i, chain: ["tea", "home", "comfort"] },
  { trigger: /\bempty pub\b/i, chain: ["alone", "solitary", "quiet"] },
  { trigger: /\bafter work\b/i, chain: ["decompress", "transition", "recover"] },
  { trigger: /\b2am\b/i, chain: ["night", "insomnia", "reflect"] },
  { trigger: /\bwaiting for (?:train|them)\b/i, chain: ["wait", "anticipat"] },
];

const CATEGORY_MINIMUMS: Record<string, Partial<Record<AuditDimension, boolean>>> = {
  transport: { activity: true, humanExperience: true },
  home: { environment: true, humanExperience: true },
  relationships: { socialContext: true, emotionalInterpretation: true },
  life: { lifeEventDetection: true, emotionalInterpretation: true },
  social: { socialContext: true },
  weather: { weatherInterpretation: true },
  time: { narrative: true },
  british: { phrase_interpretation: true } as unknown as Partial<Record<AuditDimension, boolean>>,
  poetic: { narrative: true, humanExperience: true },
  messy: { humanExperience: true, emotionalInterpretation: true },
  golden: { humanExperience: true, playlistIntent: true, emotionalInterpretation: true },
};

const CURRENT_WEIGHTS = {
  life_event: 1.0,
  emotion: 0.85,
  weather: 0.35,
  activity: 0.6,
  environment: 0.5,
};

function loadBenchmark(limit?: number): BenchmarkPrompt[] {
  const path = join(__dirname, "../../tests/human-experience-benchmark.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as { prompts: BenchmarkPrompt[] };
  const prompts = raw.prompts ?? [];
  return limit ? prompts.slice(0, limit) : prompts;
}

function matchAny(haystack: string[], needles: string[]): boolean {
  const lower = haystack.map((h) => h.toLowerCase()).join(" ");
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function collectSignals<T extends { re: RegExp; tokens: string[] }>(
  prompt: string,
  signals: T[],
): string[] {
  const out: string[] = [];
  for (const sig of signals) {
    if (sig.re.test(prompt)) out.push(...sig.tokens);
  }
  return [...new Set(out)];
}

function deriveExpectations(prompt: string, category: string): PromptExpectations {
  const lower = prompt.toLowerCase();
  const playlistIntents = PLAYLIST_INTENT_SIGNALS.filter((s) => s.re.test(lower)).map((s) => s.intent);
  const multiHop = MULTI_HOP_CHAINS.filter((c) => c.trigger.test(lower)).flatMap((c) => c.chain);
  const hasEmotionalContext =
    EMOTION_SIGNALS.some((s) => s.re.test(lower)) ||
    LIFE_EVENT_SIGNALS.some((s) => s.re.test(lower)) ||
    /\bafter (?:work|the|a)\b/i.test(lower);
  const hasWeather = WEATHER_SIGNALS.some((s) => s.re.test(lower));

  return {
    humanExperience: [
      ...collectSignals(prompt, EMOTION_SIGNALS),
      ...collectSignals(prompt, LIFE_EVENT_SIGNALS),
      category,
    ],
    emotion: collectSignals(prompt, EMOTION_SIGNALS),
    narrative: collectSignals(prompt, NARRATIVE_SIGNALS),
    activity: collectSignals(prompt, ACTIVITY_SIGNALS),
    environment: collectSignals(prompt, ENV_SIGNALS),
    weather: collectSignals(prompt, WEATHER_SIGNALS),
    social: collectSignals(prompt, SOCIAL_SIGNALS),
    lifeEvent: collectSignals(prompt, LIFE_EVENT_SIGNALS),
    emotionalArc: [
      ...(hasEmotionalContext ? ["transition", "arc", "phase"] : []),
      ...(LIFE_EVENT_SIGNALS.some((s) => s.re.test(lower)) ? ["milestone", "change"] : []),
    ],
    playlistIntent: playlistIntents,
    requiresMusicalBehaviour: true,
    requiresPhraseMatch: BRITISH_PHRASES.some((p) => p.re.test(lower)) || category === "british",
    multiHopChain: multiHop,
    weatherIsSecondary: hasWeather && hasEmotionalContext,
  };
}

function extractActual(result: WorldUnderstandingResult): Record<string, string[]> {
  const dims = summariseFingerprintDimensions(result.semanticMoment);
  const hx = result.humanExperience;
  const debug = result.debug;

  const primary =
    debug.sceneConfidence?.conceptPriority
      ?.filter((c) => c.role === "primary")
      .map((c) => c.label) ?? [];
  const secondary =
    debug.sceneConfidence?.conceptPriority
      ?.filter((c) => c.role === "secondary")
      .map((c) => c.label) ?? [];
  const ignored =
    debug.sceneConfidence?.conceptPriority
      ?.filter((c) => c.role === "ambient")
      .map((c) => c.label) ?? [];

  return {
    humanExperience: [
      ...hx.inferredQualities,
      ...hx.atlasConsultations.map((a) => a.label),
      ...hx.interpretationReasons,
    ],
    emotion: [...result.taxonomy.emotion, ...dims.emotion],
    narrative: [hx.narrative, result.humanNarrative, ...dims.narrative, ...result.humanMeanings],
    activity: [...result.taxonomy.activity, ...dims.activity, ...dims.movement],
    environment: [...result.taxonomy.environment, ...dims.environment],
    weather: [...dims.weather, ...(result.debug.matchedConceptIds.weather ?? [])],
    social: [...result.taxonomy.social, ...dims.social],
    lifeEvent: [...dims.lifeEvent, ...(debug.sceneConfidence?.lifeEvents ?? [])],
    emotionalArc: [
      result.emotionalArc.summary,
      hx.emotionalArcSummary,
      ...result.emotionalArc.phases.map((p) => p.emotion),
    ].filter(Boolean),
    playlistIntent: hx.playlistIntent !== "unknown" ? [hx.playlistIntent] : [],
    musicalBehaviour: hx.musicalBehaviours,
    primaryConcepts: primary,
    secondaryConcepts: secondary,
    ignoredConcepts: ignored,
    matchedPhrases: result.matchedPhrases.map((p) => p.phrase),
    scene: [result.scene.id, result.scene.label],
    allConcepts: result.debug.matchedConcepts,
  };
}

function scoreDimension(
  dimension: AuditDimension,
  expected: string[],
  actual: string[],
  category: string,
  result: WorldUnderstandingResult,
): DimensionResult {
  let passed = false;
  let score = 0;

  switch (dimension) {
    case "humanExperience": {
      const hasQualities = result.humanExperience.inferredQualities.length > 0;
      const hasAtlas = result.humanExperience.atlasConsultations.length > 0;
      const hasIntent = result.humanExperience.playlistIntent !== "unknown";
      const hasNarrative = result.humanExperience.narrative.length > 10;
      score =
        (hasQualities ? 0.25 : 0) +
        (hasAtlas ? 0.25 : 0) +
        (hasIntent ? 0.15 : 0) +
        (hasNarrative ? 0.15 : 0) +
        (result.confidence >= 0.35 ? 0.1 : 0) +
        (result.matchedPhrases.length > 0 ? 0.1 : 0);
      if (expected.length > 0) {
        passed = matchAny(actual, expected) || score >= 0.55;
      } else {
        passed = score >= 0.45;
      }
      break;
    }
    case "emotionalInterpretation":
      if (expected.length === 0) {
        passed = actual.length > 0 || result.confidence >= 0.4;
        score = passed ? 0.65 : 0.25;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : actual.length > 0 ? 0.4 : 0.1;
      }
      break;
    case "narrative":
      if (expected.length === 0) {
        passed =
          result.humanExperience.narrative.length > 8 ||
          result.humanMeanings.length > 0 ||
          result.emotionalArc.phases.length > 0;
        score = passed ? 0.7 : 0.3;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : 0.35;
      }
      break;
    case "activity":
      if (expected.length === 0) {
        passed = actual.length > 0;
        score = passed ? 0.7 : 0.2;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : actual.length > 0 ? 0.45 : 0.15;
      }
      break;
    case "environment":
      if (expected.length === 0) {
        passed = actual.length > 0 || result.scene.score > 20;
        score = passed ? 0.65 : 0.3;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : 0.35;
      }
      break;
    case "weatherInterpretation": {
      const weatherMentioned = expected.length > 0;
      if (!weatherMentioned) {
        passed = true;
        score = 1;
      } else {
        const weatherDetected = matchAny(actual, expected);
        const priority = result.debug.sceneConfidence?.conceptPriority ?? [];
        const weatherPrimary = priority.some(
          (c) => c.role === "primary" && /rain|weather|wet|storm|fog/i.test(c.label),
        );
        const emotionalPrimary = priority.some(
          (c) => c.role === "primary" && /emotion|exhaust|recover|decompress|stress/i.test(c.label),
        );
        if (deriveExpectations(result.prompt, category).weatherIsSecondary) {
          passed = weatherDetected && (!weatherPrimary || emotionalPrimary);
          score = passed ? 1 : weatherDetected ? 0.5 : 0.2;
        } else {
          passed = weatherDetected;
          score = passed ? 1 : 0.2;
        }
      }
      break;
    }
    case "socialContext":
      if (expected.length === 0) {
        passed = true;
        score = 1;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : 0.25;
      }
      break;
    case "lifeEventDetection":
      if (expected.length === 0) {
        passed = category !== "life";
        score = passed ? 0.8 : actual.length > 0 ? 0.5 : 0.2;
      } else {
        passed = matchAny(actual, expected);
        score = passed ? 1 : 0.2;
      }
      break;
    case "emotionalArc":
      if (expected.length === 0) {
        passed = result.emotionalArc.phases.length > 0 || result.emotionalArc.summary.length > 5;
        score = passed ? 0.75 : 0.3;
      } else {
        passed =
          matchAny(actual, expected) ||
          result.emotionalArc.phases.length >= 2;
        score = passed ? 1 : result.emotionalArc.phases.length > 0 ? 0.45 : 0.15;
      }
      break;
    case "playlistIntent":
      if (expected.length === 0) {
        passed = result.humanExperience.playlistIntent !== "unknown";
        score = passed ? 0.75 : 0.25;
      } else {
        passed = expected.some((e) =>
          actual.some((a) => a.toLowerCase().includes(e.toLowerCase())),
        );
        score = passed ? 1 : result.humanExperience.playlistIntent !== "unknown" ? 0.4 : 0.1;
      }
      break;
    case "musicalBehaviour":
      passed = result.humanExperience.musicalBehaviours.length > 0;
      score = passed ? 0.75 : 0.3;
      break;
  }

  return {
    dimension,
    passed,
    score: Math.round(score * 1000) / 1000,
    expected,
    actual: actual.slice(0, 8),
  };
}

function classifyFailures(
  prompt: string,
  category: string,
  expectations: PromptExpectations,
  actual: Record<string, string[]>,
  dimensionResults: DimensionResult[],
  result: WorldUnderstandingResult,
): FailureCategory[] {
  const categories: FailureCategory[] = [];
  const failedDims = dimensionResults.filter((d) => !d.passed).map((d) => d.dimension);

  if (failedDims.length === 0) return categories;

  const priority = result.debug.sceneConfidence?.conceptPriority ?? [];
  const weatherPrimary = priority.some(
    (c) => c.role === "primary" && /rain|weather|wet|storm|fog|wind/i.test(c.label),
  );
  const emotionalOrLifePrimary = priority.some(
    (c) =>
      c.role === "primary" &&
      /emotion|exhaust|recover|decompress|stress|life|transition|grief/i.test(c.label),
  );

  if (
    expectations.weatherIsSecondary &&
    weatherPrimary &&
    !emotionalOrLifePrimary &&
    failedDims.includes("weatherInterpretation")
  ) {
    categories.push("priority_mistake");
  }

  if (expectations.requiresPhraseMatch && result.matchedPhrases.length === 0) {
    categories.push("phrase_interpretation_failure");
  }

  if (expectations.multiHopChain.length > 0 && !matchAny(actual.allConcepts ?? [], expectations.multiHopChain)) {
    categories.push("multi_hop_failure");
  }

  if (
    expectations.emotionalArc.length > 0 &&
    (failedDims.includes("emotionalArc") ||
      result.emotionalArc.phases.length < 2)
  ) {
    categories.push("emotional_arc_failure");
  }

  if (
    failedDims.includes("socialContext") ||
    failedDims.includes("activity") ||
    failedDims.includes("environment")
  ) {
    categories.push("missing_concept");
  }

  if (
    failedDims.includes("humanExperience") ||
    (failedDims.includes("lifeEventDetection") && category === "life") ||
    (actual.scene && expectations.lifeEvent.length > 0 && !matchAny(actual.scene, expectations.lifeEvent))
  ) {
    const sceneMismatch =
      expectations.lifeEvent.length > 0 &&
      /rain|weather|comfort/i.test(actual.scene?.join(" ") ?? "") &&
      /decompress|recover|after work|bad day/i.test(prompt);
    if (sceneMismatch || failedDims.includes("humanExperience")) {
      categories.push("wrong_experience");
    }
  }

  if (categories.length === 0) {
    if (failedDims.includes("emotionalInterpretation") || failedDims.includes("narrative")) {
      categories.push("missing_concept");
    } else if (failedDims.includes("weatherInterpretation")) {
      categories.push("priority_mistake");
    } else {
      categories.push("wrong_experience");
    }
  }

  return [...new Set(categories)];
}

function recommendFix(categories: FailureCategory[], prompt: string): string {
  if (categories.includes("phrase_interpretation_failure")) {
    return "Expand human-phrases.json with British idiom mappings and boost phrase-interpreter priority";
  }
  if (categories.includes("priority_mistake")) {
    return "Lower weather weight below emotional/life-event signals in experience-reasoning CATEGORY_PRIORITY";
  }
  if (categories.includes("multi_hop_failure")) {
    return "Extend experience-chains.json multi-hop paths (e.g. windscreen→car→journey→decompression)";
  }
  if (categories.includes("emotional_arc_failure")) {
    return "Strengthen emotional-arc builder for multi-phase prompts (pressure→achievement→relief)";
  }
  if (categories.includes("missing_concept")) {
    if (/alone|solitary|no one/i.test(prompt)) {
      return "Add social absence detection in concept-extractor and atlas social_context fields";
    }
    return "Add atlas entry or concept-graph node for under-detected context";
  }
  return "Review scene competition weights and atlas consultation matching for this prompt family";
}

function extractPatternKey(prompt: string, categories: FailureCategory[]): string {
  const lower = prompt.toLowerCase();
  const fragments: string[] = [];

  if (categories.includes("priority_mistake")) fragments.push("weather_dominates_emotion");
  if (categories.includes("phrase_interpretation_failure")) fragments.push("british_phrase_unmapped");
  if (categories.includes("multi_hop_failure")) fragments.push("multi_hop_chain_missing");
  if (categories.includes("emotional_arc_failure")) fragments.push("arc_not_captured");

  if (/\bafter work\b/i.test(lower)) fragments.push("after_work");
  if (/\brain/i.test(lower)) fragments.push("rain_mentioned");
  if (/\bdriv/i.test(lower)) fragments.push("driving");
  if (/\balone\b/i.test(lower)) fragments.push("alone");
  if (/\bknackered|shattered|cuppa|gutted\b/i.test(lower)) fragments.push("british_slang");
  if (/\bwindscreen\b/i.test(lower)) fragments.push("windscreen");
  if (/\b2am|can't sleep\b/i.test(lower)) fragments.push("insomnia");
  if (/\bsunday scaries\b/i.test(lower)) fragments.push("sunday_scaries");
  if (/\bhome\b/i.test(lower)) fragments.push("home");
  if (/\bcar\b/i.test(lower)) fragments.push("car");
  if (/\bdecompress|don't want to go inside\b/i.test(lower)) fragments.push("decompression");
  if (/\bbreakup|heartbreak\b/i.test(lower)) fragments.push("breakup");
  if (/\bgraduat|promot|moving\b/i.test(lower)) fragments.push("life_milestone");

  if (fragments.length === 0) {
    const words = lower.replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
    fragments.push(words.slice(0, 2).join("_") || "generic");
  }

  return fragments.slice(0, 3).join("+");
}

function buildDebugSnapshot(result: WorldUnderstandingResult): AuditFailure["debug"] {
  const priority = result.debug.sceneConfidence?.conceptPriority ?? [];
  return {
    conceptExtraction: result.debug.matchedConceptIds,
    primaryConcepts: priority.filter((c) => c.role === "primary").map((c) => c.label),
    secondaryConcepts: priority.filter((c) => c.role === "secondary").map((c) => c.label),
    ignoredConcepts: priority.filter((c) => c.role === "ambient").map((c) => c.label),
    chosen: `${result.scene.id} (${result.scene.label})`,
    rejected: (result.debug.sceneCandidates ?? [])
      .filter((c) => c.id !== result.scene.id)
      .slice(0, 4)
      .map((c) => ({ id: c.id, label: c.label, score: c.score })),
  };
}

const ADVERSARIAL_PROMPTS: Record<string, string[]> = {
  short: ["rainy drive", "Sunday", "done with today", "need space"],
  messy: [
    "need tunes for when ur absolutely shattered after work",
    "just wanna disappear for a bit",
    "sat in my car outside for ages",
  ],
  british: [
    "proper rough day",
    "can't be arsed",
    "need a cuppa and some music",
    "off down the pub",
  ],
  poetic: [
    "watching the city lights blur through wet glass",
    "the world feels quiet tonight",
  ],
  ambiguous: ["summer night", "alone", "home", "road", "waiting"],
};

export function runHumanExperienceAudit(options?: {
  limit?: number;
  maxFailuresStored?: number;
}): HumanExperienceAuditReport {
  const prompts = loadBenchmark(options?.limit);
  const maxFailures = options?.maxFailuresStored ?? 500;

  const dimensions: AuditDimension[] = [
    "humanExperience",
    "emotionalInterpretation",
    "narrative",
    "activity",
    "environment",
    "weatherInterpretation",
    "socialContext",
    "lifeEventDetection",
    "emotionalArc",
    "playlistIntent",
    "musicalBehaviour",
  ];

  const dimensionTotals: Record<AuditDimension, number> = Object.fromEntries(
    dimensions.map((d) => [d, 0]),
  ) as Record<AuditDimension, number>;
  const failureSummary: Record<FailureCategory, number> = {
    wrong_experience: 0,
    missing_concept: 0,
    priority_mistake: 0,
    phrase_interpretation_failure: 0,
    multi_hop_failure: 0,
    emotional_arc_failure: 0,
  };

  const failures: AuditFailure[] = [];
  const patternMap = new Map<string, FailurePattern>();
  const atlasGaps = new Map<string, { count: number; examples: string[] }>();

  for (const { prompt, category } of prompts) {
    const result = interpretWorld(prompt);
    const expectations = deriveExpectations(prompt, category);
    const actualRaw = extractActual(result);

    const dimensionKeyMap: Record<AuditDimension, keyof PromptExpectations | "musicalBehaviour"> = {
      humanExperience: "humanExperience",
      emotionalInterpretation: "emotion",
      narrative: "narrative",
      activity: "activity",
      environment: "environment",
      weatherInterpretation: "weather",
      socialContext: "social",
      lifeEventDetection: "lifeEvent",
      emotionalArc: "emotionalArc",
      playlistIntent: "playlistIntent",
      musicalBehaviour: "requiresMusicalBehaviour",
    };

    const actualKeyMap: Record<AuditDimension, string> = {
      humanExperience: "humanExperience",
      emotionalInterpretation: "emotion",
      narrative: "narrative",
      activity: "activity",
      environment: "environment",
      weatherInterpretation: "weather",
      socialContext: "social",
      lifeEventDetection: "lifeEvent",
      emotionalArc: "emotionalArc",
      playlistIntent: "playlistIntent",
      musicalBehaviour: "musicalBehaviour",
    };

    const dimensionResults: DimensionResult[] = dimensions.map((dim) => {
      const expKey = dimensionKeyMap[dim];
      const expected =
        expKey === "requiresMusicalBehaviour"
          ? []
          : (expectations[expKey as keyof PromptExpectations] as string[]);
      const actual = actualRaw[actualKeyMap[dim]] ?? [];
      return scoreDimension(dim, expected, actual, category, result);
    });

    for (const dr of dimensionResults) {
      dimensionTotals[dr.dimension] += dr.score;
    }

    const anyFailed = dimensionResults.some((d) => !d.passed);
    if (anyFailed) {
      const failCategories = classifyFailures(
        prompt,
        category,
        expectations,
        actualRaw,
        dimensionResults,
        result,
      );
      for (const fc of failCategories) failureSummary[fc] += 1;

      const patternKey = extractPatternKey(prompt, failCategories);
      const existing = patternMap.get(patternKey);
      if (existing) {
        existing.count += 1;
        if (existing.example_prompts.length < 3) existing.example_prompts.push(prompt);
      } else {
        patternMap.set(patternKey, {
          pattern: patternKey,
          count: 1,
          category: failCategories[0] ?? "wrong_experience",
          example_prompts: [prompt],
          recommended_fix: recommendFix(failCategories, prompt),
        });
      }

      if (failCategories.includes("missing_concept") && /alone|waiting|night/i.test(prompt)) {
        const gapKey = `waiting/alone at night: ${category}`;
        const gap = atlasGaps.get(gapKey) ?? { count: 0, examples: [] };
        gap.count += 1;
        if (gap.examples.length < 3) gap.examples.push(prompt);
        atlasGaps.set(gapKey, gap);
      }

      if (failures.length < maxFailures) {
        const failedDims = dimensionResults.filter((d) => !d.passed);
        failures.push({
          prompt,
          category,
          expected: Object.fromEntries(failedDims.map((d) => [d.dimension, d.expected])),
          actual: Object.fromEntries(failedDims.map((d) => [d.dimension, d.actual])),
          category_failures: failCategories,
          missing_reason: failedDims.map((d) => `${d.dimension}: expected ${d.expected.join("|") || "signal"}, got ${d.actual.join("|") || "none"}`).join("; "),
          recommended_fix: recommendFix(failCategories, prompt),
          debug: buildDebugSnapshot(result),
        });
      }
    }
  }

  const n = Math.max(prompts.length, 1);
  const accuracy = Object.fromEntries(
    dimensions.map((d) => [d, Math.round((dimensionTotals[d] / n) * 1000) / 1000]),
  ) as Record<AuditDimension, number>;
  const accuracyPct = Object.fromEntries(
    dimensions.map((d) => [d, Math.round(accuracy[d] * 1000) / 10]),
  ) as Record<AuditDimension, number>;

  const weakest = dimensions
    .map((d) => ({ dimension: d, pct: accuracyPct[d] }))
    .sort((a, b) => a.pct - b.pct);

  const topPatterns = [...patternMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);

  const atlasGapRecommendations = [...atlasGaps.entries()]
    .map(([gap, data]) => ({
      gap,
      evidence_count: data.count,
      example_prompts: data.examples,
    }))
    .sort((a, b) => b.evidence_count - a.evidence_count)
    .slice(0, 20);

  const priorityMistakeRate = failureSummary.priority_mistake / n;
  const phraseFailRate = failureSummary.phrase_interpretation_failure / n;
  const lifeEventAccuracy = accuracy.lifeEventDetection;

  const adversarialResults: HumanExperienceAuditReport["adversarial_results"] = {};
  for (const [group, groupPrompts] of Object.entries(ADVERSARIAL_PROMPTS)) {
    adversarialResults[group] = groupPrompts.map((prompt) => {
      const result = interpretWorld(prompt);
      const expectations = deriveExpectations(prompt, group);
      const actualRaw = extractActual(result);
      const dims: AuditDimension[] = ["humanExperience", "emotionalInterpretation", "playlistIntent"];
      const passed = dims.every((dim) => {
        const expKey =
          dim === "humanExperience"
            ? "humanExperience"
            : dim === "emotionalInterpretation"
              ? "emotion"
              : "playlistIntent";
        const expected = expectations[expKey as keyof PromptExpectations] as string[];
        const actual = actualRaw[
          dim === "humanExperience" ? "humanExperience" : dim === "emotionalInterpretation" ? "emotion" : "playlistIntent"
        ] ?? [];
        return scoreDimension(dim, expected, actual, group, result).passed;
      });
      const chain: string[] = [
        `scene: ${result.scene.id}`,
        `intent: ${result.humanExperience.playlistIntent}`,
        `emotions: ${result.taxonomy.emotion.slice(0, 3).join(", ") || "none"}`,
        `atlas: ${result.humanExperience.atlasConsultations.map((a) => a.label).join(", ") || "none"}`,
        ...(result.debug.experienceReasoning?.hops ?? []),
        ...(result.debug.experienceReasoning?.prioritizedConcepts ?? [])
          .slice(0, 3)
          .map((c) => `${c.role}:${c.label}`),
      ];
      return {
        prompt,
        passed,
        scene: result.scene.id,
        playlistIntent: result.humanExperience.playlistIntent,
        emotions: result.taxonomy.emotion.slice(0, 5),
        debug_chain: chain,
      };
    });
  }

  const overallPct =
    Math.round(
      (dimensions.reduce((s, d) => s + accuracy[d], 0) / dimensions.length) * 1000,
    ) / 10;

  return {
    generatedAt: new Date().toISOString(),
    total_prompts: prompts.length,
    accuracy,
    accuracy_pct: accuracyPct,
    weakest_dimensions: weakest,
    failure_summary: failureSummary,
    failures,
    top_failure_patterns: topPatterns,
    atlas_gap_recommendations: atlasGapRecommendations,
    weight_calibration: {
      life_event: {
        current: CURRENT_WEIGHTS.life_event,
        suggested: lifeEventAccuracy < 0.55 ? 1.15 : 1.0,
        rationale:
          lifeEventAccuracy < 0.55
            ? `Life event detection at ${accuracyPct.lifeEventDetection}% — boost weight above humanIntent`
            : "Life event weight appears adequate",
      },
      emotion: {
        current: CURRENT_WEIGHTS.emotion,
        suggested: accuracy.emotionalInterpretation < 0.7 ? 0.92 : 0.85,
        rationale:
          accuracy.emotionalInterpretation < 0.7
            ? `Emotional accuracy ${accuracyPct.emotionalInterpretation}% — increase above narrative`
            : "Emotion weight is performing within range",
      },
      weather: {
        current: CURRENT_WEIGHTS.weather,
        suggested: priorityMistakeRate > 0.05 ? 0.22 : 0.35,
        rationale:
          priorityMistakeRate > 0.05
            ? `${failureSummary.priority_mistake} priority mistakes (${Math.round(priorityMistakeRate * 1000) / 10}%) — weather beating emotional context`
            : "Weather weight appears balanced",
      },
      activity: {
        current: CURRENT_WEIGHTS.activity,
        suggested: accuracy.activity < 0.65 ? 0.68 : 0.6,
        rationale:
          accuracy.activity < 0.65
            ? `Activity detection at ${accuracyPct.activity}% — slight boost for transport prompts`
            : "Activity weight adequate",
      },
      environment: {
        current: CURRENT_WEIGHTS.environment,
        suggested: accuracy.environment < 0.6 ? 0.55 : 0.5,
        rationale:
          accuracy.environment < 0.6
            ? `Environment at ${accuracyPct.environment}% — minor boost for place-based prompts`
            : "Environment weight adequate",
      },
    },
    adversarial_results: adversarialResults,
    architecture_assessment: {
      target_95_pct_realistic: false,
      current_overall_pct: overallPct,
      gap_to_95: Math.round((95 - overallPct) * 10) / 10,
      bottleneck: weakest[0]?.dimension ?? "humanExperience",
      path_to_improvement: [
        "Expand British phrase coverage in human-phrases.json (knackered, shattered, cuppa, can't be arsed)",
        "Strengthen multi-hop experience chains (windscreen→car→journey→decompression)",
        "Add atlas entries for high-failure social-absence patterns (waiting alone, car outside house)",
        "Lower weather priority when emotional/life-event signals present",
        "Improve emotional arc builder for multi-phase life events (exams, graduation, breakup)",
        phraseFailRate > 0.02
          ? `Phrase interpretation failures at ${Math.round(phraseFailRate * 1000) / 10}% — highest ROI fix`
          : "Continue tuning scene competition weights before atlas expansion",
      ],
    },
  };
}
