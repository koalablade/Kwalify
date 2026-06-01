/**
 * Cross-graph paths — same node, different routes = different flavour.
 */

import type { TypedEdge } from "./knowledge-graph-types";
import { CONCEPT_GRAPH, type ConceptNode } from "./knowledge-graph";

export interface GraphPath {
  from: string;
  to: string;
  via: string;
  edgeType: TypedEdge["type"];
}

/** One-hop paths from each active concept through typed edges. */
export function enumerateActivePaths(activeIds: string[], maxPaths = 8): GraphPath[] {
  const paths: GraphPath[] = [];
  const nodeMap = new Map(CONCEPT_GRAPH.map((n) => [n.id, n]));

  for (const fromId of activeIds.slice(0, 3)) {
    const node = nodeMap.get(fromId);
    if (!node) continue;
    for (const edge of node.edges) {
      if (!nodeMap.has(edge.targetId)) continue;
      paths.push({
        from: fromId,
        to: edge.targetId,
        via: edge.type,
        edgeType: edge.type,
      });
    }
  }

  return paths.slice(0, maxPaths);
}

/** Narrative labels for API */
export function describePaths(paths: GraphPath[]): string[] {
  return paths.map((p) => `${p.from} —${p.via}→ ${p.to}`);
}
