/**
 * Gravity-biased asymmetric surprise — 60% grounded / 25% semi-distant / 15% outliers.
 * Prefers high-gravity, emotionally correct tracks (not low-score filler).
 */

import type { TrackGenreClassification, RootGenre } from "../../lib/genre-taxonomy";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import { scenePoolMultiplier } from "../scene-intelligence/scene-genre-routing";
import type { TrackGravityProfile, SurpriseGravityTier } from "./taste-gravity";

const SPLIT = {
  grounded: 0.6,
  semi_distant: 0.25,
  outlier: 0.15,
} as const;

export interface GravitySurpriseContext {
  surpriseBudget: number;
  sceneRouting: SceneGenreRouting;
  profiles: Map<string, TrackGravityProfile>;
  classifications: Map<string, TrackGenreClassification>;
  maxAllocationsPerTier?: number;
}

export interface GravitySurpriseResult<T> {
  tracks: T[];
  budgetUsed: number;
  allocations: { trackId: string; amount: number; reason: string; tier: SurpriseGravityTier }[];
  splitUsed: { grounded: number; semiDistant: number; outlier: number };
}

function tierWeight(p: TrackGravityProfile): number {
  return p.gravityScore * 0.45 + p.emotionalMass * 0.55;
}

export function applyGravityBiasedSurprise<T extends {
  trackId: string;
  score: number;
}>(
  tracks: T[],
  ctx: GravitySurpriseContext
): GravitySurpriseResult<T> {
  const allocations: GravitySurpriseResult<T>["allocations"] = [];
  const splitUsed = { grounded: 0, semiDistant: 0, outlier: 0 };
  const budget = ctx.surpriseBudget;
  const tierBudgets = {
    grounded: budget * SPLIT.grounded,
    semi_distant: budget * SPLIT.semi_distant,
    outlier: budget * SPLIT.outlier,
  };

  const maxPer = budget * 0.28;
  const maxPerTier = ctx.maxAllocationsPerTier ?? Math.max(8, Math.floor(tracks.length * 0.04));

  const candidates: {
    track: T;
    profile: TrackGravityProfile;
    tier: SurpriseGravityTier;
  }[] = [];

  for (const track of tracks) {
    const profile = ctx.profiles.get(track.trackId);
    if (!profile) continue;
    const c = ctx.classifications.get(track.trackId);
    const fam = c?.genreFamily ?? "unknown";
    if (fam === "unknown" || fam === "christmas") continue;
    if (scenePoolMultiplier(fam, ctx.sceneRouting) < 0.88) continue;
    if (profile.emotionalMass < 0.1 && profile.surpriseTier === "outlier") continue;
    candidates.push({ track, profile, tier: profile.surpriseTier });
  }

  const byTier = {
    grounded: [] as typeof candidates,
    semi_distant: [] as typeof candidates,
    outlier: [] as typeof candidates,
  };
  for (const c of candidates) {
    byTier[c.tier].push(c);
  }

  for (const tier of ["grounded", "semi_distant", "outlier"] as const) {
    byTier[tier].sort((a, b) => tierWeight(b.profile) - tierWeight(a.profile));
  }

  const scoreAdds = new Map<string, number>();
  const reasons = new Map<string, string>();

  function allocateTier(
    tier: SurpriseGravityTier,
    pool: typeof candidates,
    tierBudget: number
  ): number {
    let used = 0;
    const picked = pool.slice(0, maxPerTier);
    if (picked.length === 0) return 0;
    const perTrack = Math.min(maxPer, tierBudget / picked.length);

    for (const { track, profile } of picked) {
      const pull = tierWeight(profile);
      const amount = Math.min(maxPer, perTrack * (0.85 + pull * 0.3));
      if (amount < 0.002) continue;
      used += amount;
      scoreAdds.set(track.trackId, (scoreAdds.get(track.trackId) ?? 0) + amount);
      reasons.set(track.trackId, `gravity_${tier}`);
      allocations.push({
        trackId: track.trackId,
        amount: Math.round(amount * 1000) / 1000,
        reason: `gravity_${tier}`,
        tier,
      });
    }
    return used;
  }

  splitUsed.grounded = allocateTier("grounded", byTier.grounded, tierBudgets.grounded);
  splitUsed.semiDistant = allocateTier(
    "semi_distant",
    byTier.semi_distant,
    tierBudgets.semi_distant
  );
  splitUsed.outlier = allocateTier("outlier", byTier.outlier, tierBudgets.outlier);

  const budgetUsed = splitUsed.grounded + splitUsed.semiDistant + splitUsed.outlier;

  const boosted = tracks.map((t) => {
    const add = scoreAdds.get(t.trackId);
    if (!add) return t;
    return { ...t, score: t.score + add };
  });

  return {
    tracks: boosted.sort((a, b) => b.score - a.score),
    budgetUsed: Math.round(budgetUsed * 1000) / 1000,
    allocations: allocations.slice(0, 24),
    splitUsed,
  };
}
