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
