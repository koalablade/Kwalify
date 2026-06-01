/**
 * Taste gravity — asymmetric attraction per track (not uniform scoring layers).
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { EmotionProfile } from "../../lib/emotion";
import type { UserGenreVector } from "../../lib/user-genre-profile";
import type { LibrarySignals } from "../../lib/library-signals";
import type { GenreMemoryTrace } from "../genre-intelligence/genre-memory-trace";
import { memoryTraceBoost } from "../genre-intelligence/genre-memory-trace";
import type { SceneContext } from "../../lib/scene-validation";
import { sceneMatchScore } from "../../lib/scene-validation";
import { ecosystemOf } from "../genre-intelligence/genre-ecosystems";
import { graphRelatedGenres } from "../../shared/embeddings/genre-similarity-graph";
import {
  gravityWellPullForGenre,
  type GravityWell,
} from "../genre-intelligence/gravity-wells";
import { persistenceStickiness, type TrackPersistenceStore } from "../memory-rediscovery/track-persistence-memory";

export type SurpriseGravityTier = "grounded" | "semi_distant" | "outlier";

export interface TrackGravityProfile {
  trackId: string;
  gravityScore: number;
  emotionalMass: number;
  sceneAffinity: number;
  memoryStrength: number;
  explorationDistance: number;
  historicalAffinity: number;
  resonanceStrength: number;
  stickiness: number;
  wellPull: number;
  surpriseTier: SurpriseGravityTier;
}

export interface TasteGravityContext {
  emotionProfile: EmotionProfile;
  sceneCtx: SceneContext;
  userVector: UserGenreVector;
  librarySignals: LibrarySignals;
  memoryTrace: GenreMemoryTrace;
  classifications: Map<string, TrackGenreClassification>;
  gravityWells: GravityWell[];
  persistence: TrackPersistenceStore;
  memoryByTrack: (trackId: string) => number;
  noveltyByTrack: (trackId: string) => number;
  dominantGenres: RootGenre[];
}

function emotionResonance(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  return (
    1 -
    (Math.abs((track.energy ?? 0.5) - profile.energy) +
      Math.abs((track.valence ?? 0.5) - profile.valence)) /
      2
  );
}

export function classifySurpriseTier(
  fam: RootGenre,
  anchorFam: RootGenre | undefined,
  sceneAffinity: number,
  explorationDistance: number,
  resonanceStrength: number
): SurpriseGravityTier {
  if (fam === "unknown") return "grounded";

  const anchorEco = anchorFam ? ecosystemOf(anchorFam) : null;
  const famEco = ecosystemOf(fam);

  if (
    resonanceStrength >= 0.58 &&
    explorationDistance >= 0.45 &&
    sceneAffinity >= 0.5 &&
    anchorEco &&
    famEco &&
    anchorEco !== famEco
  ) {
    return "outlier";
  }

  if (anchorFam && fam !== anchorFam) {
    const related = graphRelatedGenres(anchorFam, 1);
    if (!related.includes(fam) && anchorEco && famEco && anchorEco !== famEco) {
      return sceneAffinity >= 0.48 ? "semi_distant" : "grounded";
    }
  }

  if (explorationDistance > 0.55 && sceneAffinity >= 0.52) return "semi_distant";
  return "grounded";
}

export function computeTrackGravity<T extends {
  trackId: string;
  energy: number | null;
  valence: number | null;
}>(
  track: T,
  ctx: TasteGravityContext
): TrackGravityProfile {
  const c = ctx.classifications.get(track.trackId);
  const fam = c?.genreFamily ?? "unknown";

  const sceneAffinity = sceneMatchScore(ctx.sceneCtx, ctx.emotionProfile, track);
  const resonanceStrength =
    sceneAffinity * 0.55 + emotionResonance(track, ctx.emotionProfile) * 0.45;

  const genreShare = fam !== "unknown" ? (ctx.userVector[fam] ?? 0) : 0;
  const overexposure = ctx.dominantGenres.includes(fam) ? 0.25 : 0;
  const genreFamiliarity = Math.max(0.15, Math.min(1, genreShare * 2.2 + 0.2 - overexposure));

  const signal = ctx.librarySignals.tracks.get(track.trackId);
  const playlistApps = signal?.playlistAppearances ?? 0;
  const historicalAffinity = Math.min(
    1,
    genreFamiliarity * 0.5 +
      (playlistApps > 0 ? Math.min(0.35, playlistApps * 0.08) : 0.05) +
      (signal?.dateLiked ? 0.08 : 0)
  );

  const memTrace = fam !== "unknown" ? memoryTraceBoost(fam, ctx.memoryTrace) : 0;
  const memoryStrength = Math.min(
    1,
    0.35 + Math.max(0, memTrace + 0.12) + ctx.memoryByTrack(track.trackId) * 0.4
  );

  const explorationDistance = Math.max(0, Math.min(1, ctx.noveltyByTrack(track.trackId)));
  const stickiness = persistenceStickiness(track.trackId, ctx.persistence);
  const wellPull = fam !== "unknown" ? gravityWellPullForGenre(fam, ctx.gravityWells) : 0;

  let gravityScore =
    historicalAffinity * 0.22 +
    resonanceStrength * 0.28 +
    genreFamiliarity * 0.12 +
    memoryStrength * 0.18 +
    explorationDistance * 0.1 +
    stickiness * 0.1;

  gravityScore *= 1 + wellPull;
  gravityScore = Math.max(0.08, Math.min(1, gravityScore));

  const emotionalMass =
    Math.round(gravityScore * sceneAffinity * memoryStrength * 1000) / 1000;

  const anchorFam = ctx.dominantGenres[0];
  const surpriseTier = classifySurpriseTier(
    fam,
    anchorFam,
    sceneAffinity,
    explorationDistance,
    resonanceStrength
  );

  return {
    trackId: track.trackId,
    gravityScore: Math.round(gravityScore * 1000) / 1000,
    emotionalMass,
    sceneAffinity: Math.round(sceneAffinity * 1000) / 1000,
    memoryStrength: Math.round(memoryStrength * 1000) / 1000,
    explorationDistance: Math.round(explorationDistance * 1000) / 1000,
    historicalAffinity: Math.round(historicalAffinity * 1000) / 1000,
    resonanceStrength: Math.round(resonanceStrength * 1000) / 1000,
    stickiness: Math.round(stickiness * 1000) / 1000,
    wellPull: Math.round(wellPull * 1000) / 1000,
    surpriseTier,
  };
}

export function buildGravityProfiles<T extends {
  trackId: string;
  energy: number | null;
  valence: number | null;
}>(tracks: T[], ctx: TasteGravityContext): Map<string, TrackGravityProfile> {
  const map = new Map<string, TrackGravityProfile>();
  for (const t of tracks) {
    map.set(t.trackId, computeTrackGravity(t, ctx));
  }
  return map;
}

export function attachGravityFieldsToTracks<T extends { trackId: string; score: number }>(
  tracks: T[],
  profiles: Map<string, TrackGravityProfile>
): (T & {
  gravityScore: number;
  emotionalMass: number;
  stickiness: number;
  gravityWellPull: number;
  surpriseTier: SurpriseGravityTier;
  historicalAffinity: number;
  explorationDistance: number;
  resonanceStrength: number;
})[] {
  return tracks.map((t) => {
    const g = profiles.get(t.trackId);
    if (!g) {
      return {
        ...t,
        gravityScore: 0,
        emotionalMass: 0,
        stickiness: 0,
        gravityWellPull: 0,
        surpriseTier: "grounded" as SurpriseGravityTier,
        historicalAffinity: 0,
        explorationDistance: 0,
        resonanceStrength: 0,
      };
    }
    return {
      ...t,
      gravityScore: g.gravityScore,
      emotionalMass: g.emotionalMass,
      stickiness: g.stickiness,
      gravityWellPull: g.wellPull,
      surpriseTier: g.surpriseTier,
      historicalAffinity: g.historicalAffinity,
      explorationDistance: g.explorationDistance,
      resonanceStrength: g.resonanceStrength,
    };
  });
}

export function applyEmotionalMassToScores<T extends { trackId: string; score: number }>(
  tracks: T[],
  profiles: Map<string, TrackGravityProfile>
): T[] {
  return tracks.map((t) => {
    const g = profiles.get(t.trackId);
    if (!g || g.emotionalMass < 0.12) return t;
    const boost = g.emotionalMass * 0.09;
    return { ...t, score: t.score + boost };
  });
}

export interface GravityDiagnostics {
  averageGravity: number;
  gravityDistribution: { low: number; mid: number; high: number };
  gravityOutliers: { trackId: string; gravityScore: number; emotionalMass: number }[];
  emotionalMassCurve: number[];
  surpriseGravitySplit: { grounded: number; semiDistant: number; outlier: number };
  activeWells: string[];
  averageEmotionalMass: number;
}

export function buildGravityDiagnostics(
  profiles: Map<string, TrackGravityProfile>,
  split: { grounded: number; semiDistant: number; outlier: number },
  wells: GravityWell[],
  topTrackIds: string[]
): GravityDiagnostics {
  const vals = [...profiles.values()];
  const avg =
    vals.length > 0 ? vals.reduce((s, p) => s + p.gravityScore, 0) / vals.length : 0;
  const massAvg =
    vals.length > 0 ? vals.reduce((s, p) => s + p.emotionalMass, 0) / vals.length : 0;

  let low = 0;
  let mid = 0;
  let high = 0;
  for (const p of vals) {
    if (p.gravityScore < 0.35) low++;
    else if (p.gravityScore < 0.62) mid++;
    else high++;
  }

  const curve = topTrackIds
    .map((id) => profiles.get(id)?.emotionalMass ?? 0)
    .slice(0, 24);

  const outliers = vals
    .filter((p) => p.surpriseTier === "outlier" || p.gravityScore >= 0.72)
    .sort((a, b) => b.emotionalMass - a.emotionalMass)
    .slice(0, 8)
    .map((p) => ({
      trackId: p.trackId,
      gravityScore: p.gravityScore,
      emotionalMass: p.emotionalMass,
    }));

  return {
    averageGravity: Math.round(avg * 1000) / 1000,
    gravityDistribution: { low, mid, high },
    gravityOutliers: outliers,
    emotionalMassCurve: curve,
    surpriseGravitySplit: split,
    activeWells: wells.map((w) => w.id),
    averageEmotionalMass: Math.round(massAvg * 1000) / 1000,
  };
}
