/**
 * Controlled surprise — structured injection, not randomness.
 */

export type SurpriseType = "safe_surprise" | "edge_surprise" | "memory_surprise" | "contrast_injection";

export {
  injectControlledSurprise as injectStructuredSurprise,
  type ScoredTrack,
} from "./controlled-surprise";
