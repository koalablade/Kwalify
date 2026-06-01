/**
 * Emotional Discovery Engine — controlled wildcards that still fit the arc.
 */

import type { EmotionProfile } from "./emotion";
import type { SurpriseMix } from "./human-surprise";

export interface ScoredTrack {
  trackId: string;
  score: number;
  rediscoveryScore: number;
  energy: number | null;
  valence: number | null;
  narrativeRole?: string;
}

export function injectEmotionalWildcards<T extends ScoredTrack>(
  orderedTracks: T[],
  candidatePool: T[],
  profile: EmotionProfile,
  mix: SurpriseMix,
  length: number
): T[] {
  if (orderedTracks.length < 8 || mix.wildcardRatio <= 0) return orderedTracks;

  const wildcardSlots = Math.max(
    1,
    Math.min(4, Math.floor(length * mix.wildcardRatio))
  );

  const used = new Set(orderedTracks.map((t) => t.trackId));
  const medianScore =
    orderedTracks[Math.floor(orderedTracks.length / 2)]?.score ?? 0.5;

  const wildcards = candidatePool
    .filter((t) => !used.has(t.trackId))
    .filter((t) => t.rediscoveryScore >= 0.45)
    .filter((t) => emotionalWildcardFit(t, profile))
    .filter((t) => t.score >= medianScore - 0.22 && t.score <= medianScore + 0.18)
    .sort(
      (a, b) =>
        b.rediscoveryScore * 0.6 +
        b.score * 0.4 -
        (a.rediscoveryScore * 0.6 + a.score * 0.4)
    )
    .slice(0, wildcardSlots * 3);

  if (wildcards.length === 0) return orderedTracks;

  const result = [...orderedTracks];
  const replaceableRoles = new Set(["momentum", "reflection", "early_build", "resolution"]);
  let wi = 0;
  let replaced = 0;

  for (let i = result.length - 1; i >= Math.floor(result.length * 0.35) && replaced < wildcardSlots; i--) {
    const role = result[i]?.narrativeRole;
    if (role && !replaceableRoles.has(role)) continue;
    const w = wildcards[wi++];
    if (!w) break;
    result[i] = { ...w, narrativeRole: role ?? result[i]?.narrativeRole };
    replaced++;
  }

  return result;
}

function emotionalWildcardFit(
  track: ScoredTrack,
  profile: EmotionProfile
): boolean {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const eOk = Math.abs(e - profile.energy) < 0.35;
  const vOk = Math.abs(v - profile.valence) < 0.4;
  return eOk && vOk;
}

/** Blend comfort vs discovery picks when building pool (top fraction). */
export function applyRediscoveryPoolBias<T extends ScoredTrack>(
  sorted: T[],
  mix: SurpriseMix,
  poolSize: number
): T[] {
  if (mix.rediscoveryRatio <= 0.1 || sorted.length <= poolSize) return sorted.slice(0, poolSize);

  const rediscoverySlots = Math.floor(poolSize * mix.rediscoveryRatio);
  const comfortSlots = poolSize - rediscoverySlots;

  const byRediscovery = [...sorted].sort((a, b) => b.rediscoveryScore - a.rediscoveryScore);
  const byFit = sorted;

  const picked = new Set<string>();
  const out: T[] = [];

  for (const t of byFit) {
    if (out.length >= comfortSlots) break;
    if (!picked.has(t.trackId)) {
      out.push(t);
      picked.add(t.trackId);
    }
  }

  for (const t of byRediscovery) {
    if (out.length >= poolSize) break;
    if (!picked.has(t.trackId) && t.rediscoveryScore >= 0.35) {
      out.push(t);
      picked.add(t.trackId);
    }
  }

  for (const t of sorted) {
    if (out.length >= poolSize) break;
    if (!picked.has(t.trackId)) {
      out.push(t);
      picked.add(t.trackId);
    }
  }

  return out.slice(0, poolSize);
}
