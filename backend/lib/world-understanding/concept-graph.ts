import conceptsData from "../../data/world-knowledge/concepts/nodes.json";
import environmentsData from "../../data/world-knowledge/environments/nodes.json";
import emotionsGraphData from "../../data/world-knowledge/emotions/nodes.json";
import activitiesGraphData from "../../data/world-knowledge/activities/nodes.json";
import weatherGraphData from "../../data/world-knowledge/weather/nodes.json";
import timeGraphData from "../../data/world-knowledge/time/nodes.json";
import socialGraphData from "../../data/world-knowledge/social/nodes.json";
import travelGraphData from "../../data/world-knowledge/travel/nodes.json";
import musicLanguageGraphData from "../../data/world-knowledge/music-language/nodes.json";
import phrasePatternsData from "../../data/world-knowledge/phrase-patterns/nodes.json";
import ukContextGraphData from "../../data/world-knowledge/uk-context/nodes.json";
import type { WorldConceptTaxonomy } from "./types";

export interface ConceptGraphNode {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  phrases?: string[];
  related_concepts?: string[];
  contexts?: string[];
  experience?: string;
  emotional_meaning: string[];
  sensory?: string[];
  scene_possibilities?: string[];
  music?: {
    energy: string;
    tempo: string;
    texture: string;
    genres?: string[];
  };
}

export interface GraphMatch {
  node: ConceptGraphNode;
  matchedCue: string;
  score: number;
  source: "alias" | "phrase";
}

const ALL_NODES: ConceptGraphNode[] = [
  ...(conceptsData as { nodes: ConceptGraphNode[] }).nodes,
  ...(environmentsData as { nodes: ConceptGraphNode[] }).nodes,
  ...(emotionsGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(activitiesGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(weatherGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(timeGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(socialGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(travelGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(musicLanguageGraphData as { nodes: ConceptGraphNode[] }).nodes,
  ...(phrasePatternsData as { nodes: ConceptGraphNode[] }).nodes,
  ...(ukContextGraphData as { nodes: ConceptGraphNode[] }).nodes,
];

const NODE_BY_ID = new Map(ALL_NODES.map((n) => [n.id, n]));
const NODE_BY_NAME = new Map<string, ConceptGraphNode>();
for (const node of ALL_NODES) {
  NODE_BY_NAME.set(node.id, node);
  NODE_BY_NAME.set(node.name.toLowerCase(), node);
}

interface IndexedCue {
  cue: string;
  node: ConceptGraphNode;
  source: "alias" | "phrase";
  length: number;
}

const INDEXED_CUES: IndexedCue[] = [];
for (const node of ALL_NODES) {
  for (const phrase of node.phrases ?? []) {
    INDEXED_CUES.push({ cue: phrase.toLowerCase(), node, source: "phrase", length: phrase.length });
  }
  for (const alias of node.aliases) {
    INDEXED_CUES.push({ cue: alias.toLowerCase(), node, source: "alias", length: alias.length });
  }
}
INDEXED_CUES.sort((a, b) => b.length - a.length);

export const CONCEPT_GRAPH_NODES = ALL_NODES;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchConceptGraph(text: string, limit = 10): GraphMatch[] {
  const lower = normalize(text);
  const matches: GraphMatch[] = [];
  const usedSpans: Array<[number, number]> = [];

  for (const entry of INDEXED_CUES) {
    const idx = lower.indexOf(entry.cue);
    if (idx < 0) continue;
    const end = idx + entry.cue.length;
    const overlaps = usedSpans.some(([s, e]) => !(end <= s || idx >= e));
    if (overlaps) continue;
    usedSpans.push([idx, end]);
    const score =
      entry.length +
      (entry.source === "phrase" ? 20 : 0) +
      (entry.cue.includes(" ") ? 10 : 0);
    matches.push({
      node: entry.node,
      matchedCue: entry.cue,
      score,
      source: entry.source,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

function resolveRelated(relatedId: string): ConceptGraphNode | undefined {
  return NODE_BY_ID.get(relatedId) ?? NODE_BY_NAME.get(relatedId.toLowerCase());
}

export function propagateConceptGraph(
  matches: GraphMatch[],
  taxonomy: WorldConceptTaxonomy,
): {
  taxonomy: WorldConceptTaxonomy;
  matchedConcepts: string[];
  humanMeanings: string[];
  sceneHints: string[];
  experiences: string[];
} {
  const next: WorldConceptTaxonomy = {
    environment: [...taxonomy.environment],
    activity: [...taxonomy.activity],
    social: [...taxonomy.social],
    emotion: [...taxonomy.emotion],
    lifeContext: [...taxonomy.lifeContext],
    sensory: [...taxonomy.sensory],
  };
  const matchedConcepts: string[] = [];
  const humanMeanings: string[] = [];
  const sceneHints: string[] = [];
  const experiences: string[] = [];
  const visited = new Set<string>();

  const pushUnique = (arr: string[], values: string[]) => {
    for (const v of values) {
      const label = v.replace(/_/g, " ");
      if (!arr.includes(label)) arr.push(label);
    }
  };

  const applyNode = (node: ConceptGraphNode, depth: number) => {
    if (visited.has(node.id) || depth > 2) return;
    visited.add(node.id);
    matchedConcepts.push(`graph:${node.domain}:${node.id}`);
    pushUnique(next.emotion, node.emotional_meaning);
    pushUnique(next.sensory, node.sensory ?? []);
    pushUnique(next.environment, node.contexts ?? []);
    if (node.domain === "environments") pushUnique(next.environment, [node.name]);
    if (node.domain === "activities") pushUnique(next.activity, [node.name]);
    if (node.domain === "social") pushUnique(next.social, [node.name]);
    if (node.domain === "travel") pushUnique(next.activity, [node.name]);
    if (node.domain === "weather") pushUnique(next.environment, [node.name]);
    if (node.domain === "time") pushUnique(next.environment, [node.name]);
    if (node.experience && !experiences.includes(node.experience)) {
      experiences.push(node.experience);
      humanMeanings.push(node.experience);
    }
    for (const scene of node.scene_possibilities ?? []) {
      if (!sceneHints.includes(scene)) sceneHints.push(scene);
    }
    if (depth < 2) {
      for (const rel of node.related_concepts ?? []) {
        const related = resolveRelated(rel);
        if (related) applyNode(related, depth + 1);
      }
    }
  };

  for (const hit of matches) {
    applyNode(hit.node, 0);
  }

  for (const key of Object.keys(next) as (keyof WorldConceptTaxonomy)[]) {
    next[key] = next[key].slice(0, 14);
  }

  return { taxonomy: next, matchedConcepts, humanMeanings, sceneHints, experiences };
}

export function getConceptGraphStats() {
  return {
    totalNodes: ALL_NODES.length,
    domains: [...new Set(ALL_NODES.map((n) => n.domain))],
    byDomain: ALL_NODES.reduce<Record<string, number>>((acc, n) => {
      acc[n.domain] = (acc[n.domain] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
