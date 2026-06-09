import type { EraBucket } from "../../lib/intent-parser";
import type { LaneScoredTrack, ScorerTrack } from "./lane-scorer";

export interface TrackDecision<T extends ScorerTrack> {
  readonly track: T;
  readonly laneId: string;
  readonly score: number;
  readonly genrePrimary: string;
  readonly laneEra: EraBucket;
  readonly valid: boolean;
  readonly weight: number;
  readonly clusterIds: string[];
  readonly embeddingAffinity: number;
  readonly retrievalNeighborhood: string;
  readonly sceneAffinity: number;
  readonly tasteAffinity: number;
  readonly freshnessAffinity: number;
  readonly finalScore: number;
  readonly relevanceScore: number;
  readonly affinityScore: number;
}

export function createTrackDecision<T extends ScorerTrack>(
  item: LaneScoredTrack<T>,
  laneId: string,
): TrackDecision<T> {
  return {
    track: item.track,
    laneId,
    score: item.laneScore,
    genrePrimary: item.genrePrimary,
    laneEra: item.era,
    valid: false,
    weight: 0,
    clusterIds: [],
    embeddingAffinity: 0.5,
    retrievalNeighborhood: "scene",
    sceneAffinity: 0.5,
    tasteAffinity: item.laneScore,
    freshnessAffinity: 0.5,
    finalScore: 0,
    relevanceScore: item.laneScore,
    affinityScore: item.laneScore,
  };
}

export function withDecisionValidity<T extends ScorerTrack>(
  decision: TrackDecision<T>,
  valid: boolean,
): TrackDecision<T> {
  return { ...decision, valid };
}

export function withDecisionClusters<T extends ScorerTrack>(
  decision: TrackDecision<T>,
  clusterIds: string[],
): TrackDecision<T> {
  return { ...decision, clusterIds };
}

export function withDecisionWeight<T extends ScorerTrack>(
  decision: TrackDecision<T>,
  weight: number,
): TrackDecision<T> {
  return { ...decision, weight };
}

export function withDecisionAffinities<T extends ScorerTrack>(
  decision: TrackDecision<T>,
  affinities: {
    sceneAffinity: number;
    tasteAffinity: number;
    freshnessAffinity?: number;
    embeddingAffinity?: number;
    retrievalNeighborhood?: string;
  },
): TrackDecision<T> {
  return {
    ...decision,
    sceneAffinity: affinities.sceneAffinity,
    tasteAffinity: affinities.tasteAffinity,
    freshnessAffinity: affinities.freshnessAffinity ?? decision.freshnessAffinity,
    embeddingAffinity: affinities.embeddingAffinity ?? decision.embeddingAffinity,
    retrievalNeighborhood: affinities.retrievalNeighborhood ?? decision.retrievalNeighborhood,
  };
}

export function withDecisionFinalScore<T extends ScorerTrack>(
  decision: TrackDecision<T>,
  finalScore: number,
): TrackDecision<T> {
  return {
    ...decision,
    finalScore,
    relevanceScore: finalScore,
    affinityScore: finalScore,
  };
}
