import type { LockedIntent } from "./v3/intent";

type CoherenceTrack = {
  trackId: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  genrePrimary?: string | null;
  score?: number;
  rediscoveryScore?: number;
};

export type PlaylistCoherenceDiagnostics = {
  energy_curve: Array<number | null>;
  avg_transition_score: number | null;
  coherence_fallback_used: boolean;
  fallback_reason: string | null;
};

export type PlaylistCoherenceResult<T extends CoherenceTrack> = {
  reorderedTracks: T[];
  diagnostics: PlaylistCoherenceDiagnostics;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feature(track: CoherenceTrack, key: "energy" | "valence" | "danceability" | "acousticness", fallback = 0.5): number {
  const value = track[key];
  return isNumber(value) ? clamp01(value) : fallback;
}

function energySimilarity(a: CoherenceTrack, b: CoherenceTrack): number {
  if (!isNumber(a.energy) || !isNumber(b.energy)) return 0.65;
  return clamp01(1 - Math.abs(a.energy - b.energy));
}

function moodSimilarity(a: CoherenceTrack, b: CoherenceTrack): number {
  const valence = 1 - Math.abs(feature(a, "valence") - feature(b, "valence"));
  const energy = 1 - Math.abs(feature(a, "energy") - feature(b, "energy"));
  const acoustic = 1 - Math.abs(feature(a, "acousticness") - feature(b, "acousticness"));
  return clamp01(valence * 0.55 + energy * 0.25 + acoustic * 0.20);
}

function genreProximity(a: CoherenceTrack, b: CoherenceTrack): number {
  const genreA = a.genrePrimary?.toLowerCase().trim();
  const genreB = b.genrePrimary?.toLowerCase().trim();
  if (genreA && genreB && genreA === genreB) return 1;
  if (!genreA || !genreB) return 0.65;
  const dance = 1 - Math.abs(feature(a, "danceability") - feature(b, "danceability"));
  const acoustic = 1 - Math.abs(feature(a, "acousticness") - feature(b, "acousticness"));
  return clamp01(0.25 + (dance * 0.18) + (acoustic * 0.12));
}

function familiarityBalance(a: CoherenceTrack, b: CoherenceTrack): number {
  const scoreA = isNumber(a.score) ? a.score : 0.6;
  const scoreB = isNumber(b.score) ? b.score : 0.6;
  const rediscoveryA = isNumber(a.rediscoveryScore) ? a.rediscoveryScore : 0.5;
  const rediscoveryB = isNumber(b.rediscoveryScore) ? b.rediscoveryScore : 0.5;
  const qualityContinuity = 1 - Math.min(1, Math.abs(scoreA - scoreB));
  const discoveryContinuity = 1 - Math.min(1, Math.abs(rediscoveryA - rediscoveryB));
  return clamp01(qualityContinuity * 0.65 + discoveryContinuity * 0.35);
}

function transitionScore(a: CoherenceTrack, b: CoherenceTrack): number {
  return clamp01(
    0.4 * energySimilarity(a, b) +
    0.3 * moodSimilarity(a, b) +
    0.2 * genreProximity(a, b) +
    0.1 * familiarityBalance(a, b)
  );
}

function rankBias(index: number, total: number): number {
  if (total <= 1) return 1;
  return clamp01(1 - index / Math.max(1, total - 1));
}

function targetEnergyAt(position: number, total: number, intent: LockedIntent): number {
  if (intent.energy === "low") return 0.30;
  if (intent.energy === "high") return position < total * 0.72 ? 0.76 : 0.52;
  const progress = total <= 1 ? 0 : position / Math.max(1, total - 1);
  if (progress < 0.18) return 0.36;
  if (progress < 0.45) return 0.55;
  if (progress < 0.70) return 0.74;
  if (progress < 0.88) return 0.52;
  return 0.34;
}

function arcFit(track: CoherenceTrack, position: number, total: number, intent: LockedIntent): number {
  if (!isNumber(track.energy)) return 0.60;
  return clamp01(1 - Math.abs(track.energy - targetEnergyAt(position, total, intent)));
}

function metadataReliability(tracks: CoherenceTrack[]): number {
  if (tracks.length === 0) return 0;
  const usable = tracks.filter((track) =>
    isNumber(track.energy) ||
    isNumber(track.valence) ||
    !!track.genrePrimary
  ).length;
  return usable / tracks.length;
}

function diagnosticsFor<T extends CoherenceTrack>(
  tracks: T[],
  coherence_fallback_used: boolean,
  fallback_reason: string | null,
): PlaylistCoherenceDiagnostics {
  const transitions = tracks.slice(1).map((track, index) => transitionScore(tracks[index], track));
  const avg = transitions.length
    ? transitions.reduce((sum, value) => sum + value, 0) / transitions.length
    : null;
  return {
    energy_curve: tracks.map((track) => isNumber(track.energy) ? Math.round(track.energy * 100) / 100 : null),
    avg_transition_score: avg === null ? null : Math.round(avg * 1000) / 1000,
    coherence_fallback_used,
    fallback_reason,
  };
}

function sameTrackSet<T extends CoherenceTrack>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const track of a) counts.set(track.trackId, (counts.get(track.trackId) ?? 0) + 1);
  for (const track of b) {
    const next = (counts.get(track.trackId) ?? 0) - 1;
    if (next < 0) return false;
    if (next === 0) counts.delete(track.trackId);
    else counts.set(track.trackId, next);
  }
  return counts.size === 0;
}

export function buildCoherentPlaylist<T extends CoherenceTrack>(
  rankedTracks: T[],
  intent: LockedIntent,
): PlaylistCoherenceResult<T> {
  if (rankedTracks.length <= 2) {
    return {
      reorderedTracks: rankedTracks,
      diagnostics: diagnosticsFor(rankedTracks, true, "too_few_tracks"),
    };
  }

  if (metadataReliability(rankedTracks) < 0.45) {
    return {
      reorderedTracks: rankedTracks,
      diagnostics: diagnosticsFor(rankedTracks, true, "insufficient_metadata"),
    };
  }

  const remaining = rankedTracks.map((track, rank) => ({ track, rank }));
  const introWindow = remaining.slice(0, Math.min(5, remaining.length));
  const start = [...introWindow].sort((a, b) => {
    const aScore = rankBias(a.rank, rankedTracks.length) * 0.55 + arcFit(a.track, 0, rankedTracks.length, intent) * 0.45;
    const bScore = rankBias(b.rank, rankedTracks.length) * 0.55 + arcFit(b.track, 0, rankedTracks.length, intent) * 0.45;
    return bScore - aScore;
  })[0] ?? remaining[0];

  const path = [start.track];
  remaining.splice(remaining.findIndex((item) => item.track.trackId === start.track.trackId), 1);

  while (remaining.length > 0) {
    const current = path[path.length - 1];
    const position = path.length;
    const next = [...remaining].sort((a, b) => {
      const scoreA =
        transitionScore(current, a.track) * 0.65 +
        rankBias(a.rank, rankedTracks.length) * 0.20 +
        arcFit(a.track, position, rankedTracks.length, intent) * 0.15;
      const scoreB =
        transitionScore(current, b.track) * 0.65 +
        rankBias(b.rank, rankedTracks.length) * 0.20 +
        arcFit(b.track, position, rankedTracks.length, intent) * 0.15;
      return scoreB - scoreA;
    })[0];
    if (!next) break;
    path.push(next.track);
    remaining.splice(remaining.findIndex((item) => item.track.trackId === next.track.trackId), 1);
  }

  if (!sameTrackSet(rankedTracks, path)) {
    return {
      reorderedTracks: rankedTracks,
      diagnostics: diagnosticsFor(rankedTracks, true, "track_set_mismatch"),
    };
  }

  return {
    reorderedTracks: path,
    diagnostics: diagnosticsFor(path, false, null),
  };
}
