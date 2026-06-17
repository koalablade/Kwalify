export interface DiversityTraceComponents {
  artistMemoryPenalty: number;
  recentTrackPenalty: number;
  trackReusePenalty: number;
  clusterSaturationPenalty: number;
  familySaturationPenalty: number;
  totalPenalty: number;
  finalMultiplier: number;
  artistGravity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundDiversity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function boundedTrackReusePenalty(recentTrackPenalty: number | undefined): number {
  return roundDiversity(clamp((recentTrackPenalty ?? 0) * 0.35, 0, 0.18));
}

export function boundedClusterSaturationPenalty(count: number): number {
  return roundDiversity(clamp(count * 0.012, 0, 0.06));
}

export function boundedFamilySaturationPenalty(count: number): number {
  return roundDiversity(clamp(count * 0.014, 0, 0.05));
}

export function buildDiversityTraceComponents(input: {
  artistMemoryMultiplier?: number;
  recentTrackPenalty?: number;
  trackReusePenalty?: number;
  clusterSaturationPenalty?: number;
  familySaturationPenalty?: number;
  artistGravity?: number;
}): DiversityTraceComponents {
  const artistMemoryPenalty = roundDiversity(clamp(1 - (input.artistMemoryMultiplier ?? 1), 0, 1));
  const recentTrackPenalty = roundDiversity(clamp(input.recentTrackPenalty ?? 0, 0, 1));
  const trackReusePenalty = roundDiversity(clamp(
    input.trackReusePenalty ?? boundedTrackReusePenalty(recentTrackPenalty),
    0,
    0.18
  ));
  const clusterSaturationPenalty = roundDiversity(clamp(input.clusterSaturationPenalty ?? 0, 0, 0.06));
  const familySaturationPenalty = roundDiversity(clamp(input.familySaturationPenalty ?? 0, 0, 0.05));
  const totalPenalty = roundDiversity(clamp(
    trackReusePenalty + clusterSaturationPenalty + familySaturationPenalty,
    0,
    0.26
  ));

  return {
    artistMemoryPenalty,
    recentTrackPenalty,
    trackReusePenalty,
    clusterSaturationPenalty,
    familySaturationPenalty,
    totalPenalty,
    finalMultiplier: roundDiversity(clamp(1 - totalPenalty, 0.74, 1)),
    artistGravity: roundDiversity(clamp(input.artistGravity ?? 0, 0, 1)),
  };
}

export function emptyDiversityTraceComponents(): DiversityTraceComponents {
  return buildDiversityTraceComponents({});
}
