/**
 * Controlled chaos — typed surprises, not random wildcards.
 */

import type { EmotionProfile } from "./emotion";
import type { HumanIntent } from "./intent-decoder";
import type { SurpriseMix } from "./human-surprise";

export type SurpriseType = "safe" | "edge" | "memory_shock" | "contrast";

export interface ScoredTrack {
  trackId: string;
  score: number;
  rediscoveryScore: number;
  energy: number | null;
  valence: number | null;
  narrativeRole?: string;
}

function fit(track: ScoredTrack, profile: EmotionProfile, window: number): boolean {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return Math.abs(e - profile.energy) < window && Math.abs(v - profile.valence) < window + 0.05;
}

function pickCandidate<T extends ScoredTrack>(
  pool: T[],
  used: Set<string>,
  predicate: (t: T) => boolean,
  sort: (a: T, b: T) => number
): T | null {
  const c = pool.filter((t) => !used.has(t.trackId) && predicate(t)).sort(sort);
  return c[0] ?? null;
}

export function injectControlledSurprise<T extends ScoredTrack>(
  ordered: T[],
  pool: T[],
  profile: EmotionProfile,
  mix: SurpriseMix,
  intent: HumanIntent,
  length: number
): T[] {
  if (ordered.length < 8) return ordered;

  const slots = Math.min(4, Math.max(1, Math.floor(length * mix.wildcardRatio)));
  const used = new Set(ordered.map((t) => t.trackId));
  const result = [...ordered];
  const replaceIdx: number[] = [];

  for (let i = result.length - 1; i >= Math.floor(result.length * 0.3); i--) {
    const role = result[i]?.narrativeRole;
    if (role && !["momentum", "reflection", "early_build", "resolution"].includes(role)) continue;
    replaceIdx.push(i);
    if (replaceIdx.length >= slots) break;
  }

  const plan: SurpriseType[] = [];
  if (intent === "nostalgia" || mix.nostalgia > 0.4) {
    plan.push("memory_shock", "safe");
  } else if (intent === "energise") {
    plan.push("safe", "edge");
  } else if (intent === "emotional_processing" || intent === "heal") {
    plan.push("safe", "contrast");
  } else {
    plan.push("safe", "edge", "memory_shock");
  }

  let ri = 0;
  for (const type of plan.slice(0, replaceIdx.length)) {
    const idx = replaceIdx[ri++];
    if (idx == null) break;

    let pick: T | null = null;
    switch (type) {
      case "safe":
        pick = pickCandidate(pool, used, (t) => fit(t, profile, 0.28), (a, b) => b.score - a.score);
        break;
      case "edge":
        pick = pickCandidate(
          pool,
          used,
          (t) => fit(t, profile, 0.42) && t.rediscoveryScore > 0.3,
          (a, b) => b.rediscoveryScore - a.rediscoveryScore
        );
        break;
      case "memory_shock":
        pick = pickCandidate(
          pool,
          used,
          (t) => t.rediscoveryScore >= 0.55,
          (a, b) => b.rediscoveryScore * 0.7 + b.score * 0.3 - (a.rediscoveryScore * 0.7 + a.score * 0.3)
        );
        break;
      case "contrast":
        pick = pickCandidate(
          pool,
          used,
          (t) => (t.energy ?? 0.5) < profile.energy - 0.15 || (t.valence ?? 0.5) > profile.valence + 0.1,
          (a, b) => b.score - a.score
        );
        break;
    }

    if (pick && result[idx]) {
      used.add(pick.trackId);
      result[idx] = { ...pick, narrativeRole: result[idx].narrativeRole };
    }
  }

  return result;
}
