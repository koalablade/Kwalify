/**
 * Emotional gradient flow — familiarity → exploration → peak mass → resolution.
 */

import type { TrackGravityProfile } from "../scoring-engine/taste-gravity";

export interface GradientFlowInput<T> {
  tracks: T[];
  playlistLength: number;
  gravityByTrackId: Map<string, TrackGravityProfile>;
  peakTrackId: string | null;
}

export interface GradientFlowResult<T> {
  tracks: T[];
  phases: { start: number; explore: number; peak: number; resolve: number };
}

export function applyEmotionalGradientFlow<T extends { trackId: string }>(
  input: GradientFlowInput<T>
): GradientFlowResult<T> {
  const { tracks, playlistLength, gravityByTrackId, peakTrackId } = input;
  const len = Math.min(tracks.length, playlistLength);
  if (len < 8) {
    return { tracks: tracks.slice(0, len), phases: { start: len, explore: 0, peak: 0, resolve: 0 } };
  }

  const startN = Math.max(2, Math.floor(len * 0.25));
  const exploreN = Math.max(2, Math.floor(len * 0.45));
  const peakN = 1;
  const resolveN = Math.max(1, len - startN - exploreN - peakN);

  const used = new Set<string>();
  const pool = [...tracks];

  const take = (ordered: T[], predicate: (t: T, g: TrackGravityProfile) => boolean, sortFn: (a: T, b: T) => number, n: number) => {
    const candidates = pool
      .filter((t) => !used.has(t.trackId))
      .map((t) => ({ t, g: gravityByTrackId.get(t.trackId) }))
      .filter((x): x is { t: T; g: TrackGravityProfile } => !!x.g && predicate(x.t, x.g))
      .sort((a, b) => sortFn(a.t, b.t))
      .slice(0, n);
    for (const { t } of candidates) {
      used.add(t.trackId);
      ordered.push(t);
    }
  };

  const ordered: T[] = [];

  take(
    ordered,
    (t, g) => t.trackId !== peakTrackId && (g.surpriseTier === "grounded" || g.historicalAffinity >= 0.38),
    (a, b) =>
      (gravityByTrackId.get(b.trackId)?.historicalAffinity ?? 0) -
      (gravityByTrackId.get(a.trackId)?.historicalAffinity ?? 0),
    startN
  );

  take(
    ordered,
    (t, g) =>
      t.trackId !== peakTrackId &&
      (g.surpriseTier !== "grounded" || g.explorationDistance >= 0.42),
    (a, b) =>
      (gravityByTrackId.get(b.trackId)?.explorationDistance ?? 0) -
      (gravityByTrackId.get(a.trackId)?.explorationDistance ?? 0),
    exploreN
  );

  let peakPlaced = 0;
  if (peakTrackId) {
    const peak = pool.find((t) => t.trackId === peakTrackId);
    if (peak && !used.has(peak.trackId)) {
      ordered.push(peak);
      used.add(peak.trackId);
      peakPlaced = 1;
    }
  }
  if (peakPlaced === 0) {
    const peakCand = pool
      .filter((t) => !used.has(t.trackId))
      .map((t) => ({ t, m: gravityByTrackId.get(t.trackId)?.emotionalMass ?? 0 }))
      .sort((a, b) => b.m - a.m)[0];
    if (peakCand) {
      ordered.push(peakCand.t);
      used.add(peakCand.t.trackId);
      peakPlaced = 1;
    }
  }

  take(
    ordered,
    (t) => !used.has(t.trackId),
    (a, b) =>
      (gravityByTrackId.get(a.trackId)?.resonanceStrength ?? 0) -
      (gravityByTrackId.get(b.trackId)?.resonanceStrength ?? 0),
    resolveN
  );

  for (const t of pool) {
    if (ordered.length >= len) break;
    if (!used.has(t.trackId)) {
      ordered.push(t);
      used.add(t.trackId);
    }
  }

  return {
    tracks: ordered.slice(0, len),
    phases: { start: startN, explore: exploreN, peak: peakPlaced, resolve: resolveN },
  };
}
