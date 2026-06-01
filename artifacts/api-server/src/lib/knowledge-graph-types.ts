/** Typed edges — structure between concepts, not tag soup. */

export type RelationType =
  | "amplifies"
  | "softens"
  | "contradicts"
  | "transitions_to"
  | "nostalgic_for"
  | "often_coexists_with"
  | "co_occurs_with"
  | "soundtrack_to";

export interface TypedEdge {
  /** Target concept id */
  targetId: string;
  /** Spec alias for targetId */
  to?: string;
  type: RelationType;
  /** 0–1 edge strength */
  weight: number;
}

export const RELATION_DEFAULT_STRENGTH: Record<RelationType, number> = {
  amplifies: 0.65,
  softens: 0.5,
  contradicts: 0.55,
  transitions_to: 0.45,
  nostalgic_for: 0.7,
  often_coexists_with: 0.35,
  co_occurs_with: 0.35,
  soundtrack_to: 0.85,
};
