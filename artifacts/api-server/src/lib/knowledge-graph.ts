/**
 * Multi-layer knowledge graph with typed relationships.
 */

import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";
import type { TypedEdge } from "./knowledge-graph-types";
import { RELATION_DEFAULT_STRENGTH } from "./knowledge-graph-types";

export type { RelationType, TypedEdge } from "./knowledge-graph-types";

export interface ConceptNode {
  id: string;
  terms: string[];
  edges: TypedEdge[];
  weights: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
  };
  sceneHints?: {
    environment?: string;
    timeOfDay?: string;
    motionState?: string;
  };
  /** Optional journey hint when this node is primary */
  journeyArc?: JourneyArc;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function edge(id: string, type: TypedEdge["type"], weight: number): TypedEdge {
  return { targetId: id, type, weight };
}

export const CONCEPT_GRAPH: ConceptNode[] = [
  {
    id: "motown",
    terms: ["motown", "northern soul", "philly soul"],
    edges: [
      edge("soul", "soundtrack_to", 0.9),
      edge("nostalgia", "nostalgic_for", 0.85),
      edge("warmth", "amplifies", 0.75),
      edge("driving", "often_coexists_with", 0.5),
    ],
    weights: { valence: 0.12, nostalgia: 0.2, calm: 0.08 },
  },
  {
    id: "britpop",
    terms: ["britpop", "madchester", "oasis vibes"],
    edges: [
      edge("year_1990s", "nostalgic_for", 0.8),
      edge("youth", "amplifies", 0.7),
      edge("confidence", "amplifies", 0.65),
      edge("road_trip", "often_coexists_with", 0.55),
      edge("friendship", "often_coexists_with", 0.6),
    ],
    weights: { energy: 0.1, valence: 0.15, nostalgia: 0.25 },
  },
  {
    id: "emo_2000s",
    terms: ["2000s emo", "emo phase", "myspace emo"],
    edges: [
      edge("heartbreak", "amplifies", 0.8),
      edge("introspection", "often_coexists_with", 0.7),
      edge("driving", "soundtrack_to", 0.75),
      edge("loneliness", "amplifies", 0.65),
      edge("healing", "transitions_to", 0.55),
    ],
    weights: { valence: -0.1, tension: 0.15, nostalgia: 0.35, energy: -0.05 },
    sceneHints: { timeOfDay: "late_night" },
    journeyArc: "recovery",
  },
  {
    id: "late_summer_friends",
    terms: [
      "late summer evening",
      "driving home from seeing old friends",
      "after seeing friends",
      "summer evening with friends",
    ],
    edges: [
      edge("nostalgia", "amplifies", 0.85),
      edge("driving", "soundtrack_to", 0.9),
      edge("warmth", "amplifies", 0.7),
      edge("reflection", "often_coexists_with", 0.6),
      edge("optimism", "transitions_to", 0.5),
      edge("autumn_transition", "transitions_to", 0.45),
    ],
    weights: { nostalgia: 0.22, valence: 0.12, calm: 0.1 },
    sceneHints: { motionState: "driving", timeOfDay: "evening" },
  },
  {
    id: "petrol_liminal",
    terms: ["2am petrol station", "late petrol station", "fluorescent forecourt"],
    edges: [
      edge("loneliness", "amplifies", 0.7),
      edge("introspection", "soundtrack_to", 0.85),
      edge("driving", "often_coexists_with", 0.5),
      edge("neon", "often_coexists_with", 0.55),
    ],
    weights: { energy: -0.15, nostalgia: 0.2, tension: 0.12, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
    journeyArc: "slow_burn",
  },
  {
    id: "airport_sunrise",
    terms: ["airport at sunrise", "departure lounge morning", "early flight hope"],
    edges: [
      edge("optimism", "amplifies", 0.75),
      edge("anticipation", "amplifies", 0.8),
      edge("travel", "soundtrack_to", 0.7),
      edge("morning", "often_coexists_with", 0.6),
    ],
    weights: { valence: 0.1, tension: 0.08, energy: 0.05 },
    sceneHints: { motionState: "transit", timeOfDay: "morning" },
    journeyArc: "linear_rise",
  },
  {
    id: "rain_drive",
    terms: ["rain on windscreen", "rain on windshield", "rainy night drive"],
    edges: [
      edge("driving", "soundtrack_to", 0.9),
      edge("melancholy", "softens", 0.5),
      edge("introspection", "amplifies", 0.7),
      edge("cinematic", "often_coexists_with", 0.6),
    ],
    weights: { nostalgia: 0.18, calm: 0.1, tension: 0.08 },
    sceneHints: { environment: "rainy", motionState: "driving" },
  },
  {
    id: "lockdown",
    terms: ["lockdown", "lockdown era", "covid era"],
    edges: [
      edge("nostalgia", "nostalgic_for", 0.8),
      edge("introspection", "amplifies", 0.65),
      edge("healing", "transitions_to", 0.5),
    ],
    weights: { nostalgia: 0.25, calm: 0.12, energy: -0.1 },
    sceneHints: { environment: "indoor" },
  },
  {
    id: "road_trip",
    terms: ["road trip", "windows down", "open road"],
    edges: [
      edge("freedom", "amplifies", 0.75),
      edge("friendship", "often_coexists_with", 0.65),
      edge("discovery", "amplifies", 0.5),
    ],
    weights: { energy: 0.12, valence: 0.15, nostalgia: 0.15 },
    sceneHints: { motionState: "driving" },
  },
  {
    id: "archaeology",
    terms: ["music you forgot you loved", "hidden corners of your library"],
    edges: [
      edge("nostalgia", "nostalgic_for", 0.9),
      edge("discovery", "amplifies", 0.7),
      edge("surprise", "amplifies", 0.6),
    ],
    weights: { nostalgia: 0.28, valence: 0.08 },
  },
  {
    id: "year_1990s",
    terms: ["1990s", "nineties", "90s music"],
    edges: [edge("britpop", "often_coexists_with", 0.7), edge("nostalgia", "nostalgic_for", 0.85)],
    weights: { nostalgia: 0.28, valence: 0.08 },
  },
  {
    id: "driving",
    terms: ["driving", "night drive", "motorway"],
    edges: [
      edge("road_trip", "often_coexists_with", 0.5),
      edge("late_summer_friends", "often_coexists_with", 0.45),
    ],
    weights: { nostalgia: 0.1, energy: 0.05 },
    sceneHints: { motionState: "driving" },
  },
  {
    id: "soul",
    terms: ["soul music", "soul", "r&b soul"],
    edges: [edge("motown", "often_coexists_with", 0.6), edge("warmth", "amplifies", 0.7)],
    weights: { valence: 0.1, nostalgia: 0.15, calm: 0.08 },
  },
  {
    id: "warmth",
    terms: ["warm", "warmth", "emotional warmth"],
    edges: [edge("friendship", "often_coexists_with", 0.55)],
    weights: { valence: 0.12, calm: 0.1 },
  },
  {
    id: "friendship",
    terms: ["old friends", "best friend", "friendship"],
    edges: [edge("nostalgia", "nostalgic_for", 0.7), edge("warmth", "amplifies", 0.65)],
    weights: { valence: 0.15, nostalgia: 0.15 },
  },
  {
    id: "heartbreak",
    terms: ["heartbreak", "heartbroken", "broke up"],
    edges: [
      edge("healing", "transitions_to", 0.7),
      edge("loneliness", "amplifies", 0.65),
      edge("driving", "often_coexists_with", 0.5),
    ],
    weights: { valence: -0.2, tension: 0.2 },
  },
  {
    id: "healing",
    terms: ["healing", "moving on", "getting better"],
    edges: [edge("optimism", "transitions_to", 0.6)],
    weights: { valence: 0.15, calm: 0.15 },
    journeyArc: "recovery",
  },
  {
    id: "loneliness",
    terms: ["lonely", "loneliness", "alone at night"],
    edges: [
      edge("introspection", "amplifies", 0.7),
      edge("peaceful", "contradicts", 0.45),
    ],
    weights: { valence: -0.1, calm: 0.1 },
  },
  {
    id: "introspection",
    terms: ["introspective", "introspection", "reflective"],
    edges: [edge("clarity", "transitions_to", 0.5)],
    weights: { calm: 0.15, nostalgia: 0.1 },
  },
  {
    id: "optimism",
    terms: ["optimistic", "hopeful", "optimism"],
    weights: { valence: 0.2, tension: -0.1 },
    edges: [],
  },
  {
    id: "autumn_transition",
    terms: ["autumn coming", "end of summer", "last day of summer"],
    edges: [edge("nostalgia", "amplifies", 0.75)],
    weights: { nostalgia: 0.2, valence: 0.05 },
  },
  {
    id: "neon",
    terms: ["neon", "neon lights", "city lights"],
    edges: [edge("cinematic", "often_coexists_with", 0.6)],
    weights: { tension: 0.08, nostalgia: 0.15 },
    sceneHints: { environment: "urban", timeOfDay: "late_night" },
  },
  {
    id: "cinematic",
    terms: ["cinematic", "film score", "soundtrack vibes"],
    weights: { tension: 0.08, nostalgia: 0.12 },
    edges: [],
  },
  {
    id: "youth",
    terms: ["youth", "teenage", "younger days"],
    edges: [edge("nostalgia", "nostalgic_for", 0.8)],
    weights: { nostalgia: 0.2, valence: 0.1 },
  },
  {
    id: "confidence",
    terms: ["confident", "confidence", "empowered"],
    weights: { valence: 0.15, energy: 0.12 },
    edges: [],
  },
  {
    id: "discovery",
    terms: ["discovery", "rediscover", "forgotten"],
    weights: { valence: 0.08, nostalgia: 0.15 },
    edges: [],
  },
  {
    id: "anticipation",
    terms: ["anticipation", "excited for", "can't wait"],
    weights: { tension: 0.15, valence: 0.12, energy: 0.08 },
    edges: [],
  },
  {
    id: "freedom",
    terms: ["freedom", "free", "liberated"],
    weights: { valence: 0.18, energy: 0.1 },
    edges: [],
  },
  {
    id: "clarity",
    terms: ["clarity", "clear headed", "peace of mind"],
    weights: { calm: 0.2, valence: 0.1, tension: -0.1 },
    edges: [],
  },
  {
    id: "peaceful",
    terms: ["peaceful", "at peace", "serene"],
    weights: { calm: 0.25, valence: 0.12 },
    edges: [],
  },
  {
    id: "melancholy",
    terms: ["melancholy", "melancholic", "bittersweet sad"],
    weights: { valence: -0.12, nostalgia: 0.2 },
    edges: [],
  },
];

const NODE_BY_ID = new Map(CONCEPT_GRAPH.map((n) => [n.id, n]));

export interface GraphPropagationHop {
  from: string;
  to: string;
  type: TypedEdge["type"];
  weight: number;
  hop: 1 | 2;
}

export interface GraphApplyResult {
  profile: EmotionProfile;
  activeConcepts: string[];
  expandedConcepts: string[];
  propagationPath: GraphPropagationHop[];
  suggestedJourneyArc: JourneyArc | null;
}

function applyEdgeEffect(
  p: EmotionProfile,
  edge: TypedEdge,
  target: ConceptNode,
  strength: number
): void {
  const w = target.weights;
  const edgeScale = edge.weight * RELATION_DEFAULT_STRENGTH[edge.type] * strength;

  switch (edge.type) {
    case "amplifies":
      if (w.energy) p.energy += w.energy * edgeScale;
      if (w.valence) p.valence += w.valence * edgeScale;
      if (w.tension) p.tension += w.tension * edgeScale;
      if (w.nostalgia) p.nostalgia += w.nostalgia * edgeScale;
      if (w.calm) p.calm += w.calm * edgeScale;
      break;
    case "softens":
      if (w.tension) p.tension += w.tension * edgeScale * 0.5;
      if (w.valence) p.valence += Math.abs(w.valence) * edgeScale * 0.3;
      p.calm += 0.05 * edgeScale;
      break;
    case "contradicts":
      p.tension += 0.08 * edgeScale;
      p.valence += (w.valence ?? 0) * edgeScale * 0.6;
      break;
    case "nostalgic_for":
      p.nostalgia += (w.nostalgia ?? 0.15) * edgeScale * 1.2;
      if (w.valence) p.valence += w.valence * edgeScale * 0.5;
      break;
    case "often_coexists_with":
    case "co_occurs_with":
    case "soundtrack_to":
      if (w.energy) p.energy += w.energy * edgeScale;
      if (w.valence) p.valence += w.valence * edgeScale;
      if (w.nostalgia) p.nostalgia += w.nostalgia * edgeScale;
      if (target.sceneHints?.environment && !p.environment) p.environment = target.sceneHints.environment;
      if (target.sceneHints?.timeOfDay && !p.timeOfDay) p.timeOfDay = target.sceneHints.timeOfDay;
      if (target.sceneHints?.motionState && !p.motionState) p.motionState = target.sceneHints.motionState;
      break;
    case "transitions_to":
      break;
  }
}

export function matchConcepts(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: { id: string; len: number }[] = [];

  for (const node of CONCEPT_GRAPH) {
    let best = 0;
    for (const term of node.terms) {
      if (lower.includes(term) && term.length > best) best = term.length;
    }
    if (best > 0) matched.push({ id: node.id, len: best });
  }

  matched.sort((a, b) => b.len - a.len);
  return matched.map((m) => m.id);
}

export function expandConceptsTyped(activeIds: string[]): string[] {
  const out = new Set<string>(activeIds);
  for (const id of activeIds) {
    const node = NODE_BY_ID.get(id);
    if (!node) continue;
    for (const e of node.edges) {
      if (NODE_BY_ID.has(e.targetId)) out.add(e.targetId);
    }
  }
  return [...out];
}

const PRIMARY_BLEND = 0.65;
const EDGE_BLEND = 0.42;

export function applyKnowledgeGraph(profile: EmotionProfile, text: string): EmotionProfile {
  const result = applyKnowledgeGraphFull(profile, text);
  return result.profile;
}

/** Weighted 2-hop graph propagation (deterministic). */
export function propagateGraph(
  profile: EmotionProfile,
  text: string,
  maxHops: 1 | 2 = 2
): GraphApplyResult {
  const active = matchConcepts(text).slice(0, 4);
  if (active.length === 0) {
    return {
      profile,
      activeConcepts: [],
      expandedConcepts: [],
      propagationPath: [],
      suggestedJourneyArc: null,
    };
  }

  const p = { ...profile };
  const propagationPath: GraphPropagationHop[] = [];
  const visited = new Set<string>(active);
  let suggestedJourneyArc: JourneyArc | null = null;

  const applyNode = (id: string, strength: number) => {
    const node = NODE_BY_ID.get(id);
    if (!node) return;
    const w = node.weights;
    if (w.energy) p.energy += w.energy * strength;
    if (w.valence) p.valence += w.valence * strength;
    if (w.tension) p.tension += w.tension * strength;
    if (w.nostalgia) p.nostalgia += w.nostalgia * strength;
    if (w.calm) p.calm += w.calm * strength;
    if (node.journeyArc) suggestedJourneyArc = node.journeyArc;
    if (node.sceneHints?.environment && !p.environment) p.environment = node.sceneHints.environment;
    if (node.sceneHints?.timeOfDay && !p.timeOfDay) p.timeOfDay = node.sceneHints.timeOfDay;
    if (node.sceneHints?.motionState && !p.motionState) p.motionState = node.sceneHints.motionState;
  };

  for (const id of active) {
    applyNode(id, PRIMARY_BLEND);
    const node = NODE_BY_ID.get(id);
    if (!node) continue;

    for (const edge of node.edges) {
      const target = NODE_BY_ID.get(edge.targetId);
      if (!target) continue;
      const hop1Strength = EDGE_BLEND * edge.weight;
      applyEdgeEffect(p, edge, target, hop1Strength);
      propagationPath.push({
        from: id,
        to: edge.targetId,
        type: edge.type,
        weight: edge.weight,
        hop: 1,
      });
      if (edge.type === "transitions_to" && target.journeyArc) {
        suggestedJourneyArc = target.journeyArc;
      }

      if (maxHops < 2 || visited.has(edge.targetId)) continue;
      visited.add(edge.targetId);

      for (const edge2 of target.edges) {
        if (visited.has(edge2.targetId)) continue;
        const target2 = NODE_BY_ID.get(edge2.targetId);
        if (!target2) continue;
        const hop2Strength = EDGE_BLEND * 0.55 * edge.weight * edge2.weight;
        applyEdgeEffect(p, edge2, target2, hop2Strength);
        propagationPath.push({
          from: edge.targetId,
          to: edge2.targetId,
          type: edge2.type,
          weight: edge2.weight * edge.weight,
          hop: 2,
        });
        visited.add(edge2.targetId);
        if (edge2.type === "transitions_to" && target2.journeyArc && !suggestedJourneyArc) {
          suggestedJourneyArc = target2.journeyArc;
        }
      }
    }
  }

  p.energy = clamp(p.energy);
  p.valence = clamp(p.valence);
  p.tension = clamp(p.tension);
  p.nostalgia = clamp(p.nostalgia);
  p.calm = clamp(p.calm);

  return {
    profile: p,
    activeConcepts: active,
    expandedConcepts: [...visited],
    propagationPath,
    suggestedJourneyArc,
  };
}

export function applyKnowledgeGraphFull(
  profile: EmotionProfile,
  text: string
): GraphApplyResult {
  return propagateGraph(profile, text, 2);
}

export function describeMatchedConcepts(text: string): string[] {
  return matchConcepts(text).slice(0, 6);
}
