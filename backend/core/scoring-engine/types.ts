import type { TrackScoringDebug } from "../../lib/hybrid-scoring";

/** Track row with score fields used through the playlist pipeline */
export type ScoredLibraryTrack<T extends { trackId: string }> = T & {
  score: number;
  rediscoveryScore: number;
  scoringDebug: TrackScoringDebug;
  gravityScore?: number;
  emotionalMass?: number;
  stickiness?: number;
  gravityWellPull?: number;
  surpriseTier?: import("./taste-gravity").SurpriseGravityTier;
  historicalAffinity?: number;
  explorationDistance?: number;
  resonanceStrength?: number;
  /** V3 enrichment — populated by create-playlist after V3 track mapping */
  genrePrimary?: string | null;
};

export type { TrackScoringDebug, HybridScoringContext, HybridScoreResult } from "../../lib/hybrid-scoring";
