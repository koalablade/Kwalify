/**
 * World coherence — "Would Spotify make this playlist?"
 *
 * Composite editorial score from:
 * - worldConsistency (scene-world membership)
 * - dominant-world density (Disco 24 / Soul 3 / Rock 2 = excellent)
 * - prototype affinity (Donna Summer neighbourhood, not bare "disco")
 * - retrieval entropy penalty (15 unrelated worlds in first N = bad)
 *
 * Energy/valence tuning is intentionally NOT part of this score.
 */
import { ecosystemOf, type GenreEcosystem } from "../genre-intelligence/genre-ecosystems";
import type { RootGenre } from "../../lib/genre-taxonomy";
import {
  resolveGenrePrototypeCentres,
  scorePrototypeAffinity,
  type GenrePrototypeCentre,
} from "./genre-prototype-centres";

export type WorldDensityBreakdown = {
  /** Family → count */
  counts: Record<string, number>;
  /** Family → share 0–1 */
  shares: Record<string, number>;
  dominantFamily: string | null;
  dominantShare: number;
  /** Ecosystem → share */
  ecosystemShares: Partial<Record<GenreEcosystem, number>>;
  dominantEcosystem: GenreEcosystem | null;
  familyCount: number;
};

export type WorldCoherenceScore = {
  /** 0–1 composite — higher = more like a curated Spotify editorial playlist */
  score: number;
  wouldSpotifyMakeThis: boolean;
  density: WorldDensityBreakdown;
  /** 0–1 — share of tracks in the dominant musical world */
  dominantWorldDensity: number;
  worldConsistency: number;
  prototypeAffinity: number;
  /** 0–1 — higher = more scattered unrelated worlds (bad) */
  retrievalEntropy: number;
  prototypeCentres: string[];
  reasons: string[];
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeDominantWorldDensity(
  tracks: Array<{ genreFamily?: string | null; genrePrimary?: string | null }>,
): WorldDensityBreakdown {
  const counts: Record<string, number> = {};
  for (const track of tracks) {
    const family = (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase();
    if (!family || family === "unknown") continue;
    counts[family] = (counts[family] ?? 0) + 1;
  }
  const tagged = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const shares: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    shares[k] = Math.round((v / tagged) * 1000) / 1000;
  }
  let dominantFamily: string | null = null;
  let dominantShare = 0;
  for (const [k, share] of Object.entries(shares)) {
    if (share > dominantShare) {
      dominantShare = share;
      dominantFamily = k;
    }
  }

  const ecosystemShares: Partial<Record<GenreEcosystem, number>> = {};
  for (const [family, share] of Object.entries(shares)) {
    const eco = ecosystemOf(family as RootGenre);
    if (!eco) continue;
    ecosystemShares[eco] = (ecosystemShares[eco] ?? 0) + share;
  }
  let dominantEcosystem: GenreEcosystem | null = null;
  let ecoMax = 0;
  for (const [eco, share] of Object.entries(ecosystemShares) as [GenreEcosystem, number][]) {
    if (share > ecoMax) {
      ecoMax = share;
      dominantEcosystem = eco;
    }
  }

  return {
    counts,
    shares,
    dominantFamily,
    dominantShare,
    ecosystemShares,
    dominantEcosystem,
    familyCount: Object.keys(counts).length,
  };
}

/**
 * Density quality: strong dominant world is good (Spotify editorial).
 * Scattered equal stacks (Disco 7 / Rock 6 / HipHop 5 / Metal 4) score poorly.
 */
export function scoreDominantWorldDensity(density: WorldDensityBreakdown): number {
  if (density.familyCount === 0) return 0.35;
  const max = density.dominantShare;
  // Excellent: ≥55% one world with a few satellites
  if (max >= 0.55) return clamp01(0.7 + (max - 0.55) * 0.8);
  // Acceptable: 40–55%
  if (max >= 0.4) return clamp01(0.45 + (max - 0.4) * 1.5);
  // Scattered: many near-equal worlds
  const entropyPenalty = Math.min(0.45, (density.familyCount - 3) * 0.06);
  return clamp01(0.25 + max * 0.4 - entropyPenalty);
}

/** Entropy of genre-family distribution among early candidates / final tracks. */
export function scoreRetrievalEntropy(
  tracks: Array<{ genreFamily?: string | null; genrePrimary?: string | null }>,
  window = 20,
): number {
  const slice = tracks.slice(0, window);
  if (slice.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const track of slice) {
    const family = (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase();
    counts[family] = (counts[family] ?? 0) + 1;
  }
  const n = slice.length;
  const unique = Object.keys(counts).length;
  // 15 unrelated worlds in 20 candidates → high entropy (bad for curation)
  const uniqueRatio = unique / Math.max(1, Math.min(window, n));
  let h = 0;
  for (const c of Object.values(counts)) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(Math.max(2, unique));
  const normalized = maxH > 0 ? h / maxH : 0;
  return clamp01(0.55 * normalized + 0.45 * uniqueRatio);
}

export function computeWorldCoherenceScore(opts: {
  tracks: Array<{
    artistName?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
  }>;
  worldConsistency?: number | null;
  vibe?: string;
  primarySubgenre?: string | null;
  genreFamilies?: string[];
  prototypeCentres?: GenrePrototypeCentre[];
}): WorldCoherenceScore {
  const density = computeDominantWorldDensity(opts.tracks);
  const dominantWorldDensity = scoreDominantWorldDensity(density);
  const worldConsistency =
    typeof opts.worldConsistency === "number" && Number.isFinite(opts.worldConsistency)
      ? clamp01(opts.worldConsistency)
      : // Fallback: use ecosystem dominance as a weak stand-in when scene-world is inactive
        clamp01(0.35 + density.dominantShare * 0.5);

  const centres =
    opts.prototypeCentres ??
    resolveGenrePrototypeCentres({
      vibe: opts.vibe,
      primarySubgenre: opts.primarySubgenre,
      genreFamilies: opts.genreFamilies ?? (density.dominantFamily ? [density.dominantFamily] : []),
    });
  const prototypeAffinity = scorePrototypeAffinity(opts.tracks, centres);
  const retrievalEntropy = scoreRetrievalEntropy(opts.tracks, 20);

  // "Would Spotify make this?" — density + world lock dominate; entropy penalises scatter.
  const score = clamp01(
    worldConsistency * 0.34 +
      dominantWorldDensity * 0.36 +
      prototypeAffinity * 0.18 +
      (1 - retrievalEntropy) * 0.12,
  );

  const reasons: string[] = [];
  if (dominantWorldDensity >= 0.7 && density.dominantFamily) {
    reasons.push(`dominant_world_${density.dominantFamily}_${Math.round(density.dominantShare * 100)}`);
  }
  if (density.familyCount >= 6 && density.dominantShare < 0.35) {
    reasons.push("scattered_genre_worlds");
  }
  if (retrievalEntropy >= 0.72) {
    reasons.push("high_retrieval_entropy");
  }
  if (prototypeAffinity >= 0.55 && centres.length > 0) {
    reasons.push(`prototype_hit_${centres[0]!.subgenre}`);
  }
  if (prototypeAffinity < 0.35 && centres.length > 0) {
    reasons.push("missing_prototype_neighbourhood");
  }

  return {
    score,
    wouldSpotifyMakeThis: score >= 0.58 && dominantWorldDensity >= 0.42 && retrievalEntropy <= 0.78,
    density,
    dominantWorldDensity,
    worldConsistency,
    prototypeAffinity,
    retrievalEntropy,
    prototypeCentres: centres.map((c) => c.id),
    reasons,
  };
}
