/**
 * Multi-object playlist planner (Year 2-3) — distinct retrieval objects per journey phase.
 */

import type { SegmentPlaylistPlan, SegmentTarget } from "../core/segment-playlist-planner";

export type RetrievalObject = {
  id: string;
  label: string;
  genreFamilies: string[];
  energyRange: [number, number];
  valenceRange: [number, number];
  weight: number;
  trackShare: number;
};

export type MultiObjectPlan = {
  objects: RetrievalObject[];
  segmentPlan: SegmentPlaylistPlan;
};

export function buildMultiObjectPlan(segmentPlan: SegmentPlaylistPlan): MultiObjectPlan {
  const objects: RetrievalObject[] = segmentPlan.segments.map((segment: SegmentTarget) => ({
    id: `retrieval_${segment.segment.id}`,
    label: segment.segment.label,
    genreFamilies: segment.genreFamilies,
    energyRange: [segment.energyMin, segment.energyMax] as [number, number],
    valenceRange: [segment.valenceMin, segment.valenceMax] as [number, number],
    weight: segment.segment.share,
    trackShare: segment.trackCount / Math.max(1, segmentPlan.totalTracks),
  }));

  return { objects, segmentPlan };
}

export function retrievalBoostForObject<T extends { energy?: number | null; valence?: number | null; genreFamily?: string | null }>(
  track: T,
  object: RetrievalObject,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  let score = 0;
  if (energy >= object.energyRange[0] && energy <= object.energyRange[1]) score += 0.35;
  if (valence >= object.valenceRange[0] && valence <= object.valenceRange[1]) score += 0.25;
  if (track.genreFamily && object.genreFamilies.includes(track.genreFamily)) score += 0.25;
  return score * object.weight * 0.4;
}

export function activeRetrievalObject(
  plan: MultiObjectPlan,
  segmentId: string,
): RetrievalObject | null {
  return plan.objects.find((obj) => obj.id === `retrieval_${segmentId}`) ?? plan.objects[0] ?? null;
}

/** Best segment-object fit across the journey plan — used at retrieval ranking time. */
export function multiObjectRetrievalBoost<T extends {
  energy?: number | null;
  valence?: number | null;
  genreFamily?: string | null;
}>(
  track: T,
  plan: MultiObjectPlan | null | undefined,
): number {
  if (!plan?.objects?.length) return 0;
  let best = 0;
  for (const object of plan.objects) {
    const boost = retrievalBoostForObject(
      {
        ...track,
        genreFamily: track.genreFamily ?? null,
      },
      object,
    );
    if (boost > best) best = boost;
  }
  return best;
}
