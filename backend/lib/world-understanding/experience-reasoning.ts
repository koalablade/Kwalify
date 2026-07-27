/**
 * Experience reasoning — multi-hop chains and interpretation priority.
 * Priority: life events > human intent > emotional > narrative > relationship > activity > environment > weather > objects
 */

import experienceChainsData from "../../data/world-atlas/experience-chains.json";
import type { WorldConceptTaxonomy } from "./types";
import type { MomentInterpretation } from "./moment-interpreter";

export type ReasoningCategory =
  | "lifeEvent"
  | "humanIntent"
  | "emotional"
  | "narrative"
  | "relationship"
  | "activity"
  | "environment"
  | "weather"
  | "object";

export interface ReasoningHop {
  from: string;
  to: string;
  relation: string;
}

export interface ExperienceChain {
  id: string;
  before: string[];
  during: string[];
  after: string[];
}

export interface ReasoningResult {
  chains: Array<{ id: string; phase: "before" | "during" | "after"; experiences: string[] }>;
  hops: ReasoningHop[];
  prioritizedConcepts: Array<{ label: string; category: ReasoningCategory; score: number; role: "primary" | "secondary" | "ignored" }>;
  alternativeInterpretations: string[];
  confidence: number;
}

const CATEGORY_PRIORITY: Record<ReasoningCategory, number> = {
  lifeEvent: 1.0,
  humanIntent: 0.92,
  emotional: 0.85,
  narrative: 0.78,
  relationship: 0.72,
  activity: 0.6,
  environment: 0.5,
  weather: 0.35,
  object: 0.25,
};

const MULTI_HOP_CHAINS: ReasoningHop[] = [
  { from: "windscreen", to: "car", relation: "enclosed_in" },
  { from: "car", to: "driving", relation: "activity" },
  { from: "driving", to: "journey", relation: "motion" },
  { from: "journey", to: "transition", relation: "between_states" },
  { from: "transition", to: "reflection", relation: "emotional" },
  { from: "tea", to: "home", relation: "domestic" },
  { from: "home", to: "routine", relation: "ritual" },
  { from: "routine", to: "comfort", relation: "emotional" },
  { from: "empty pub", to: "social absence", relation: "contrast" },
  { from: "social absence", to: "loneliness", relation: "emotional" },
  { from: "rain", to: "window", relation: "sensory" },
  { from: "window", to: "indoors", relation: "safety" },
  { from: "indoors", to: "reflection", relation: "emotional" },
];

const CHAINS: ExperienceChain[] = (experienceChainsData as { chains: ExperienceChain[] }).chains ?? [];

function inferCategory(label: string, taxonomyCategory?: string): ReasoningCategory {
  const lower = label.toLowerCase();
  if (/loss|grief|graduat|promot|moving|breakup|fresh start|new chapter|bad day/i.test(lower)) return "lifeEvent";
  if (/intent|want|need|recover|escape|celebrate/i.test(lower)) return "humanIntent";
  if (/sad|joy|grief|anxiety|nostalgia|relief|exhaust/i.test(lower)) return "emotional";
  if (/story|narrative|arc|before|after|transition/i.test(lower)) return "narrative";
  if (/friend|family|partner|love|relationship|date/i.test(lower)) return "relationship";
  if (/driv|walk|sit|commut|cook|shower/i.test(lower)) return "activity";
  if (/rain|sun|snow|fog|storm|wind/i.test(lower)) return "weather";
  if (/car|home|pub|beach|office|bedroom|road/i.test(lower)) return "environment";
  if (taxonomyCategory === "emotion") return "emotional";
  if (taxonomyCategory === "activity") return "activity";
  if (taxonomyCategory === "environment") return "environment";
  if (taxonomyCategory === "lifeContext") return "lifeEvent";
  if (taxonomyCategory === "social") return "relationship";
  return "object";
}

function matchExperienceChains(prompt: string): ReasoningResult["chains"] {
  const lower = prompt.toLowerCase();
  const matched: ReasoningResult["chains"] = [];

  for (const chain of CHAINS) {
    const allIds = [...chain.before, ...chain.during, ...chain.after];
    const hits = allIds.filter((id) => lower.includes(id.replace(/_/g, " ")));
    if (hits.length === 0) continue;

    if (chain.before.some((id) => lower.includes(id.replace(/_/g, " ")))) {
      matched.push({ id: chain.id, phase: "before", experiences: chain.before });
    }
    if (chain.during.some((id) => lower.includes(id.replace(/_/g, " ")))) {
      matched.push({ id: chain.id, phase: "during", experiences: chain.during });
    }
    if (chain.after.some((id) => lower.includes(id.replace(/_/g, " ")))) {
      matched.push({ id: chain.id, phase: "after", experiences: chain.after });
    }
  }

  return matched;
}

function buildMultiHopHops(prompt: string): ReasoningHop[] {
  const lower = prompt.toLowerCase();
  const hops: ReasoningHop[] = [];
  for (const hop of MULTI_HOP_CHAINS) {
    if (lower.includes(hop.from.toLowerCase())) {
      hops.push(hop);
    }
  }
  return hops;
}

function prioritizeConcepts(
  taxonomy: WorldConceptTaxonomy,
  momentInterpretation: MomentInterpretation,
): ReasoningResult["prioritizedConcepts"] {
  const concepts: ReasoningResult["prioritizedConcepts"] = [];

  for (const event of momentInterpretation.lifeEvents) {
    concepts.push({
      label: event.category.replace(/_/g, " "),
      category: "lifeEvent",
      score: CATEGORY_PRIORITY.lifeEvent * event.strength,
      role: "primary",
    });
  }

  const buckets: Array<{ items: string[]; category: ReasoningCategory; taxonomyKey: keyof WorldConceptTaxonomy }> = [
    { items: taxonomy.emotion, category: "emotional", taxonomyKey: "emotion" },
    { items: taxonomy.lifeContext, category: "lifeEvent", taxonomyKey: "lifeContext" },
    { items: taxonomy.social, category: "relationship", taxonomyKey: "social" },
    { items: taxonomy.activity, category: "activity", taxonomyKey: "activity" },
    { items: taxonomy.environment, category: "environment", taxonomyKey: "environment" },
    { items: taxonomy.sensory, category: "object", taxonomyKey: "sensory" },
  ];

  for (const bucket of buckets) {
    for (const label of bucket.items) {
      const cat = inferCategory(label, bucket.taxonomyKey);
      const score = CATEGORY_PRIORITY[cat];
      const isWeather = /rain|snow|sun|fog|storm|wind|grey/i.test(label);
      const weatherSecondary = momentInterpretation.weatherIsSecondary && isWeather;
      concepts.push({
        label,
        category: isWeather ? "weather" : cat,
        score: weatherSecondary ? score * 0.4 : score,
        role: weatherSecondary ? "ignored" : score >= 0.7 ? "primary" : score >= 0.5 ? "secondary" : "ignored",
      });
    }
  }

  for (const pc of momentInterpretation.primaryConcepts) {
    const existing = concepts.find((c) => c.label === pc.label);
    if (existing) {
      existing.role = "primary";
      existing.score = Math.max(existing.score, pc.total);
    } else {
      concepts.push({
        label: pc.label,
        category: inferCategory(pc.label, pc.category),
        score: pc.total,
        role: "primary",
      });
    }
  }

  return concepts
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

export function reasonAboutExperience(
  prompt: string,
  taxonomy: WorldConceptTaxonomy,
  momentInterpretation: MomentInterpretation,
): ReasoningResult {
  const chains = matchExperienceChains(prompt);
  const hops = buildMultiHopHops(prompt);
  const prioritizedConcepts = prioritizeConcepts(taxonomy, momentInterpretation);

  const alternatives: string[] = [];
  if (momentInterpretation.weatherIsSecondary) {
    alternatives.push("Weather is ambient, not the primary story");
  }
  if (momentInterpretation.dominantStory) {
    alternatives.push(momentInterpretation.dominantStory);
  }
  for (const hop of hops.slice(0, 3)) {
    alternatives.push(`${hop.from} → ${hop.to} (${hop.relation})`);
  }

  const primaryCount = prioritizedConcepts.filter((c) => c.role === "primary").length;
  const confidence = Math.min(0.95, 0.35 + primaryCount * 0.1 + chains.length * 0.08 + hops.length * 0.05);

  return {
    chains,
    hops,
    prioritizedConcepts,
    alternativeInterpretations: alternatives.slice(0, 5),
    confidence: Math.round(confidence * 100) / 100,
  };
}

export function getPhraseCount(): number {
  return 0; // re-exported from phrase-interpreter
}
