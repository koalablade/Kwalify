/**
 * Hierarchical genre ontology — target 1000+ nodes (family → genre → subgenre → microgenre).
 */

import { GENRE_FAMILIES } from "./genre-taxonomy-data";
import type { RootGenre } from "./genre-taxonomy";

export type GenreLevel = "family" | "genre" | "subgenre" | "microgenre";

/** @deprecated use GenreLevel */
export type OntologyLevel = GenreLevel;

export interface GenreNode {
  id: string;
  name: string;
  parent: string | null;
  children: string[];
  level: GenreLevel;
  family: RootGenre;
  keywords: string[];
  weight: number;
  embedding?: number[];
}

/** @deprecated use GenreNode */
export type OntologyNode = GenreNode;

export interface OntologyEdge {
  from: string;
  to: string;
  type: "parent" | "similarity" | "co_occurrence" | "transition";
  weight: number;
}

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

const CROSS_ERAS = ["80s", "90s", "2000s", "2010s", "2020s"] as const;
const CROSS_MOODS = [
  "rainy",
  "sunset",
  "night",
  "summer",
  "winter",
  "driving",
  "introspective",
  "hype",
  "melancholic",
  "chill",
] as const;
const CROSS_REGIONS = ["uk", "us", "latin", "nordic", "afro"] as const;

const SKIP_CROSS_AXIS: RootGenre[] = ["christmas"];

let cached: { nodes: GenreNode[]; edges: OntologyEdge[] } | null = null;

export function buildGenreOntology(): { nodes: GenreNode[]; edges: OntologyEdge[] } {
  if (cached) return cached;

  const nodeMap = new Map<string, GenreNode>();
  const edges: OntologyEdge[] = [];

  const addNode = (n: Omit<GenreNode, "children">) => {
    if (!nodeMap.has(n.id)) {
      nodeMap.set(n.id, { ...n, children: [] });
    }
  };

  const link = (parentId: string, childId: string, w = 1) => {
    edges.push({ from: parentId, to: childId, type: "parent", weight: w });
    const parent = nodeMap.get(parentId);
    const child = nodeMap.get(childId);
    if (parent && child && !parent.children.includes(childId)) {
      parent.children.push(childId);
      child.parent = parentId;
    }
  };

  for (const family of ROOT_FAMILIES) {
    const id = `family:${family}`;
    addNode({
      id,
      name: family.replace(/_/g, " "),
      parent: null,
      level: "family",
      family,
      keywords: [family],
      weight: 1,
    });
  }

  for (const famDef of GENRE_FAMILIES) {
    const familyId = `family:${famDef.family}`;
    if (!nodeMap.has(familyId)) {
      addNode({
        id: familyId,
        name: famDef.family,
        parent: null,
        level: "family",
        family: famDef.family,
        keywords: [famDef.family],
        weight: 1,
      });
    }

    for (const sub of famDef.subgenres) {
      const subId = `sub:${famDef.family}:${sub.id}`;
      addNode({
        id: subId,
        name: sub.id.replace(/_/g, " "),
        parent: familyId,
        level: "subgenre",
        family: famDef.family,
        keywords: [sub.id, ...sub.patterns.slice(0, 4)],
        weight: 0.85,
      });
      link(familyId, subId);

      for (const micro of sub.microStyles) {
        const microId = `micro:${famDef.family}:${sub.id}:${slug(micro)}`;
        addNode({
          id: microId,
          name: micro,
          parent: subId,
          level: "microgenre",
          family: famDef.family,
          keywords: [micro, sub.id],
          weight: 0.72,
        });
        link(subId, microId);
      }

      expandCrossAxis(nodeMap, edges, link, famDef.family, subId, sub.id);
    }
  }

  addGenreTierNodes(nodeMap, link);
  cached = { nodes: [...nodeMap.values()], edges };
  return cached;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
}

/** Era × mood × region microgenre expansion (Spotify-scale density) */
function expandCrossAxis(
  nodeMap: Map<string, GenreNode>,
  edges: OntologyEdge[],
  link: (p: string, c: string, w?: number) => void,
  family: RootGenre,
  subId: string,
  subKey: string
): void {
  if (SKIP_CROSS_AXIS.includes(family)) return;

  for (const era of CROSS_ERAS) {
    for (const mood of CROSS_MOODS) {
      const id = `xg:${family}:${subKey}:${era}:${mood}`;
      const name = `${era} ${mood} ${subKey.replace(/_/g, " ")}`;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          name,
          parent: subId,
          children: [],
          level: "microgenre",
          family,
          keywords: [era, mood, subKey, family],
          weight: 0.52,
        });
        link(subId, id, 0.65);
      }
    }
  }

  for (const region of CROSS_REGIONS) {
    for (const era of CROSS_ERAS.slice(0, 3)) {
      const id = `xr:${family}:${subKey}:${region}:${era}`;
      const name = `${region} ${era} ${subKey.replace(/_/g, " ")}`;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          name,
          parent: subId,
          children: [],
          level: "microgenre",
          family,
          keywords: [region, era, subKey, family],
          weight: 0.48,
        });
        link(subId, id, 0.55);
      }
    }
  }
}

/** Intermediate "genre" tier nodes (parallel branches under family) */
function addGenreTierNodes(
  nodeMap: Map<string, GenreNode>,
  link: (p: string, c: string) => void
): void {
  const tiers: Partial<Record<RootGenre, string[]>> = {
    country: ["country_mainstream", "country_alternative", "country_traditional"],
    hip_hop: ["hip_hop_mainstream", "hip_hop_underground", "hip_hop_experimental"],
    rock: ["rock_mainstream", "rock_alternative", "rock_heavy"],
    electronic: ["electronic_dance", "electronic_ambient", "electronic_bass"],
    jazz: ["jazz_traditional", "jazz_modern", "jazz_fusion"],
    pop: ["pop_mainstream", "pop_alternative", "pop_retro"],
    metal: ["metal_heavy", "metal_extreme", "metal_melodic"],
    folk: ["folk_indie", "folk_traditional", "folk_acoustic"],
    soul: ["soul_classic", "soul_modern", "soul_funk"],
    rnb: ["rnb_contemporary", "rnb_classic", "rnb_alternative"],
    blues: ["blues_electric", "blues_acoustic", "blues_rock"],
    latin: ["latin_pop", "latin_urban", "latin_traditional"],
    reggae: ["reggae_roots", "reggae_dancehall", "reggae_dub"],
    world: ["world_afro", "world_asia", "world_europe"],
  };

  for (const [family, genres] of Object.entries(tiers) as [RootGenre, string[]][]) {
    const familyId = `family:${family}`;
    if (!nodeMap.has(familyId)) continue;
    for (const g of genres) {
      const gid = `genre:${family}:${g}`;
      if (nodeMap.has(gid)) continue;
      nodeMap.set(gid, {
        id: gid,
        name: g.replace(/_/g, " "),
        parent: familyId,
        children: [],
        level: "genre",
        family,
        keywords: [g, family],
        weight: 0.78,
      });
      link(familyId, gid);
    }
  }
}

export function findGenreNode(nodeId: string): GenreNode | undefined {
  return buildGenreOntology().nodes.find((n) => n.id === nodeId);
}

export function findOntologyNode(nodeId: string): GenreNode | undefined {
  return findGenreNode(nodeId);
}

export function nodesForFamily(family: RootGenre): GenreNode[] {
  return buildGenreOntology().nodes.filter((n) => n.family === family);
}

export function ontologyStats(): {
  nodeCount: number;
  edgeCount: number;
  byLevel: Record<string, number>;
  targetMet: boolean;
} {
  const { nodes, edges } = buildGenreOntology();
  const byLevel: Record<string, number> = {};
  for (const n of nodes) {
    byLevel[n.level] = (byLevel[n.level] ?? 0) + 1;
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byLevel,
    targetMet: nodes.length >= 1000,
  };
}
