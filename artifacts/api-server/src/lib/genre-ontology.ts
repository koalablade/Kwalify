/**
 * Layer A — Genre ontology (human-readable graph).
 * Family → Genre → Subgenre → Microstyle (+ cross-axis expansion).
 */

import { GENRE_FAMILIES } from "./genre-taxonomy-data";
import type { RootGenre } from "./genre-taxonomy";

export type OntologyLevel = "family" | "genre" | "subgenre" | "microstyle";

export interface OntologyNode {
  id: string;
  parentId: string | null;
  level: OntologyLevel;
  family: RootGenre;
  label: string;
  keywords: string[];
  weight: number;
}

export interface OntologyEdge {
  from: string;
  to: string;
  type: "parent" | "similarity" | "co_occurrence" | "transition";
  weight: number;
}

/** Root families (seed graph) */
export const ROOT_FAMILIES: RootGenre[] = [
  "pop",
  "rock",
  "hip_hop",
  "rnb",
  "electronic",
  "country",
  "jazz",
  "classical",
  "metal",
  "folk",
  "indie",
  "latin",
  "reggae",
  "soul",
  "blues",
  "soundtrack",
  "world",
  "christmas",
];

const CROSS_ERAS = ["90s", "2000s", "2010s", "2020s"] as const;
const CROSS_MOODS = ["rainy", "sunset", "night_drive", "summer_day"] as const;

let cachedOntology: { nodes: OntologyNode[]; edges: OntologyEdge[] } | null = null;

export function buildGenreOntology(): { nodes: OntologyNode[]; edges: OntologyEdge[] } {
  if (cachedOntology) return cachedOntology;

  const nodes: OntologyNode[] = [];
  const edges: OntologyEdge[] = [];

  for (const family of ROOT_FAMILIES) {
    const familyId = `family:${family}`;
    nodes.push({
      id: familyId,
      parentId: null,
      level: "family",
      family,
      label: family.replace(/_/g, " "),
      keywords: [family],
      weight: 1,
    });
  }

  for (const famDef of GENRE_FAMILIES) {
    const familyId = `family:${famDef.family}`;
    if (!nodes.find((n) => n.id === familyId)) {
      nodes.push({
        id: familyId,
        parentId: null,
        level: "family",
        family: famDef.family,
        label: famDef.family,
        keywords: [famDef.family],
        weight: 1,
      });
    }

    for (const sub of famDef.subgenres) {
      const subId = `sub:${famDef.family}:${sub.id}`;
      nodes.push({
        id: subId,
        parentId: familyId,
        level: "subgenre",
        family: famDef.family,
        label: sub.id.replace(/_/g, " "),
        keywords: [sub.id, ...sub.patterns.slice(0, 3)],
        weight: 0.85,
      });
      edges.push({ from: familyId, to: subId, type: "parent", weight: 1 });

      for (const micro of sub.microStyles) {
        const microId = `micro:${famDef.family}:${sub.id}:${slug(micro)}`;
        nodes.push({
          id: microId,
          parentId: subId,
          level: "microstyle",
          family: famDef.family,
          label: micro,
          keywords: [micro, sub.id],
          weight: 0.7,
        });
        edges.push({ from: subId, to: microId, type: "parent", weight: 1 });
      }

      expandCrossAxis(nodes, edges, famDef.family, subId, sub.id);
    }
  }

  addSimilarityEdges(nodes, edges);
  cachedOntology = { nodes, edges };
  return cachedOntology;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

/** genre × era × mood micro-nodes (bounded expansion) */
function expandCrossAxis(
  nodes: OntologyNode[],
  edges: OntologyEdge[],
  family: RootGenre,
  subId: string,
  subKey: string
): void {
  const expandable = ["country", "hip_hop", "electronic", "indie", "folk", "rock", "pop"];
  if (!expandable.includes(family)) return;

  for (const era of CROSS_ERAS.slice(0, 2)) {
    for (const mood of CROSS_MOODS.slice(0, 2)) {
      const id = `x:${family}:${subKey}:${era}:${mood}`;
      const label = `${era} ${mood.replace(/_/g, " ")} ${subKey.replace(/_/g, " ")}`;
      nodes.push({
        id,
        parentId: subId,
        level: "microstyle",
        family,
        label,
        keywords: [era, mood, subKey, family],
        weight: 0.55,
      });
      edges.push({ from: subId, to: id, type: "parent", weight: 0.6 });
    }
  }
}

/** Stylistic bridges between related families */
const SIMILARITY_BRIDGES: [RootGenre, RootGenre, number][] = [
  ["country", "folk", 0.82],
  ["country", "rock", 0.55],
  ["soul", "rnb", 0.88],
  ["soul", "jazz", 0.65],
  ["indie", "rock", 0.75],
  ["indie", "folk", 0.7],
  ["electronic", "pop", 0.68],
  ["hip_hop", "rnb", 0.72],
  ["metal", "rock", 0.8],
  ["blues", "rock", 0.6],
  ["reggae", "latin", 0.55],
];

function addSimilarityEdges(nodes: OntologyNode[], edges: OntologyEdge[]): void {
  for (const [a, b, w] of SIMILARITY_BRIDGES) {
    const from = `family:${a}`;
    const to = `family:${b}`;
    if (nodes.some((n) => n.id === from) && nodes.some((n) => n.id === to)) {
      edges.push({ from, to, type: "similarity", weight: w });
      edges.push({ from: to, to: from, type: "similarity", weight: w });
    }
  }
}

export function findOntologyNode(nodeId: string): OntologyNode | undefined {
  return buildGenreOntology().nodes.find((n) => n.id === nodeId);
}

export function nodesForFamily(family: RootGenre): OntologyNode[] {
  return buildGenreOntology().nodes.filter((n) => n.family === family);
}

export function ontologyStats(): { nodeCount: number; edgeCount: number; byLevel: Record<string, number> } {
  const { nodes, edges } = buildGenreOntology();
  const byLevel: Record<string, number> = {};
  for (const n of nodes) {
    byLevel[n.level] = (byLevel[n.level] ?? 0) + 1;
  }
  return { nodeCount: nodes.length, edgeCount: edges.length, byLevel };
}
