/**
 * Dominant Ecosystem Locking — enforces scene-driven genre composition.
 *
 * When semantic scene confidence is high (> 0.7), the playlist must draw
 * 80% of tracks from the primary ecosystem and at most 5% from unrelated genres.
 *
 * Phases:
 *   1. classifyPoolByEcosystem  — bucket every candidate by primary/adjacent/unrelated
 *   2. selectAnchorTracks       — pick 10 anchor tracks from primary ecosystem first
 *   3. enforceEcosystemFloor    — after composition, swap out violating tracks
 *   4. buildEcosystemDebug      — emit per-generation breakdown for debug panel
 */

import type { RootGenre } from "./genre-taxonomy";
import { classifyTrack } from "./genre-taxonomy";
import type { SemanticSceneVector } from "./semantic-scene-engine";

// Confidence threshold above which the ecosystem lock activates
// Lowered from 0.7 → 0.55 so common scene prompts (outlaw country, dirt road, etc.) always lock
export const ECOSYSTEM_LOCK_THRESHOLD = 0.55;

// Composition targets (shares of final playlist)
const PRIMARY_TARGET = 0.80;
const ADJACENT_TARGET = 0.20;
const UNRELATED_MAX = 0.05;

export type EcosystemTier = "primary" | "adjacent" | "unrelated" | "anti";

export interface EcosystemClassifiedTrack<T> {
  track: T;
  tier: EcosystemTier;
  ecosystemWeight: number;
}

/**
 * Threshold for "primary" vs "adjacent" within the scene's genreEcosystem.
 * Genres with weight >= PRIMARY_WEIGHT_FLOOR are primary, others are adjacent.
 */
const PRIMARY_WEIGHT_FLOOR = 0.65;

/** Classify a single track's genre against the scene vector. */
function tierForGenre(genre: RootGenre, vector: SemanticSceneVector): EcosystemTier {
  if (vector.antiGenres.includes(genre)) return "anti";
  const entry = vector.genreEcosystem.find((e) => e.genre === genre);
  if (!entry) return "unrelated";
  return entry.weight >= PRIMARY_WEIGHT_FLOOR ? "primary" : "adjacent";
}

/** Determine the best tier for a track (primary genre wins, secondary can upgrade). */
function classifyTrackTier<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}>(
  track: T,
  vector: SemanticSceneVector
): { tier: EcosystemTier; ecosystemWeight: number } {
  const classification = classifyTrack(track);
  const primaryTier = tierForGenre(classification.genrePrimary, vector);
  const secondaryTier = classification.genreSecondary
    ? tierForGenre(classification.genreSecondary, vector)
    : "unrelated";

  const primaryEcosystemEntry = vector.genreEcosystem.find((e) => e.genre === classification.genrePrimary);
  const secondaryEcosystemEntry = classification.genreSecondary
    ? vector.genreEcosystem.find((e) => e.genre === classification.genreSecondary)
    : undefined;

  const primaryWeight = primaryEcosystemEntry?.weight ?? 0;
  const secondaryWeight = secondaryEcosystemEntry?.weight ?? 0;
  const ecosystemWeight = primaryWeight * 0.75 + secondaryWeight * 0.25;

  // Upgrade logic: if secondary is primary-tier and primary is adjacent, keep adjacent
  // (secondary alone cannot fully save an anti-genre primary)
  const effectiveTier =
    primaryTier === "anti"
      ? "anti"
      : primaryTier === "primary"
        ? "primary"
        : secondaryTier === "primary"
          ? "adjacent" // secondary primary-tier lifts adjacent tier, not full primary
          : primaryTier === "adjacent" || secondaryTier === "adjacent"
            ? "adjacent"
            : "unrelated";

  return { tier: effectiveTier, ecosystemWeight };
}

/**
 * Bucket a scored pool into ecosystem tiers.
 */
export function classifyPoolByEcosystem<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  score: number;
}>(
  pool: T[],
  vector: SemanticSceneVector
): {
  primary: T[];
  adjacent: T[];
  unrelated: T[];
  anti: T[];
  classified: EcosystemClassifiedTrack<T>[];
} {
  const primary: T[] = [];
  const adjacent: T[] = [];
  const unrelated: T[] = [];
  const anti: T[] = [];
  const classified: EcosystemClassifiedTrack<T>[] = [];

  for (const track of pool) {
    const { tier, ecosystemWeight } = classifyTrackTier(track, vector);
    classified.push({ track, tier, ecosystemWeight });
    if (tier === "primary") primary.push(track);
    else if (tier === "adjacent") adjacent.push(track);
    else if (tier === "anti") anti.push(track);
    else unrelated.push(track);
  }

  return { primary, adjacent, unrelated, anti, classified };
}

/**
 * Select up to `count` anchor tracks from the primary ecosystem.
 * These are the genre-defining tracks that form the playlist spine.
 * Sorted by score descending — takes the strongest primary-ecosystem matches.
 */
export function selectAnchorTracks<T extends { trackId: string; score: number }>(
  primaryPool: T[],
  count = 10
): T[] {
  return [...primaryPool]
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/**
 * Reorder the sorted pool so anchor tracks appear first.
 * This biases the composer toward primary-ecosystem tracks without breaking
 * the overall score ordering for non-anchor slots.
 */
export function hoistAnchorTracksInPool<T extends { trackId: string; score: number }>(
  sortedPool: T[],
  anchors: T[]
): T[] {
  const anchorIds = new Set(anchors.map((a) => a.trackId));
  const anchorSlots = sortedPool.filter((t) => anchorIds.has(t.trackId));
  const rest = sortedPool.filter((t) => !anchorIds.has(t.trackId));
  return [...anchorSlots, ...rest];
}

/**
 * Enforce ecosystem floor on the final playlist.
 *
 * If primary ecosystem share < ecosystemFloor (default 0.70):
 *   - Replace the lowest-scored non-primary tracks with primary-ecosystem
 *     tracks from the broader pool until the floor is met.
 *
 * Returns the adjusted tracks and a diagnostics object.
 */
export function enforceEcosystemFloor<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  score: number;
}>(
  finalTracks: T[],
  sortedPool: T[],
  vector: SemanticSceneVector,
  maxAttempts = 1
): {
  tracks: T[];
  swapsApplied: number;
  primaryShare: number;
  rejectedAndRegenerated: boolean;
} {
  const floor = vector.ecosystemFloor;
  const poolClassified = classifyPoolByEcosystem(sortedPool, vector);

  let current = [...finalTracks];
  let swapsApplied = 0;
  let rejectedAndRegenerated = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentClassified = classifyPoolByEcosystem(current, vector);
    const primaryCount = currentClassified.primary.length;
    const primaryShare = primaryCount / Math.max(1, current.length);

    if (primaryShare >= floor) break;

    // Below floor — need to swap
    const needed = Math.ceil(floor * current.length) - primaryCount;

    // Candidates: primary tracks from pool not already in final
    const finalIds = new Set(current.map((t) => t.trackId));
    const primaryCandidates = poolClassified.primary
      .filter((t) => !finalIds.has(t.trackId))
      .sort((a, b) => b.score - a.score);

    if (primaryCandidates.length === 0) break;

    // Find the weakest non-primary tracks to swap out (anti first, then unrelated, then adjacent)
    const nonPrimary = currentClassified.classified
      .filter((c) => c.tier !== "primary")
      .sort((a, b) => {
        const tierOrder = { anti: 0, unrelated: 1, adjacent: 2, primary: 3 };
        const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
        if (tierDiff !== 0) return tierDiff;
        return a.track.score - b.track.score;
      });

    const swapCount = Math.min(needed, primaryCandidates.length, nonPrimary.length);
    if (swapCount === 0) break;

    const toRemove = new Set(nonPrimary.slice(0, swapCount).map((c) => c.track.trackId));
    const replacements = primaryCandidates.slice(0, swapCount);

    current = [
      ...current.filter((t) => !toRemove.has(t.trackId)),
      ...replacements,
    ];
    swapsApplied += swapCount;
    rejectedAndRegenerated = swapCount > 0;
  }

  const finalClassified = classifyPoolByEcosystem(current, vector);
  const primaryShare = finalClassified.primary.length / Math.max(1, current.length);

  // Hard cap: unrelated tracks must be <= UNRELATED_MAX of playlist
  const unrelatedMax = Math.ceil(UNRELATED_MAX * current.length);
  if (finalClassified.unrelated.length > unrelatedMax) {
    const unrelatedIds = new Set(
      finalClassified.unrelated
        .slice(unrelatedMax)
        .map((t) => t.trackId)
    );
    const trimmedFinalIds = new Set(current.map((t) => t.trackId));
    const extraPrimary = poolClassified.primary
      .filter((t) => !trimmedFinalIds.has(t.trackId))
      .sort((a, b) => b.score - a.score)
      .slice(0, unrelatedIds.size);

    current = [
      ...current.filter((t) => !unrelatedIds.has(t.trackId)),
      ...extraPrimary,
    ];
    swapsApplied += unrelatedIds.size;
  }

  return { tracks: current, swapsApplied, primaryShare, rejectedAndRegenerated };
}

export interface EcosystemDebug {
  locked: boolean;
  sceneId: string;
  sceneLabel: string;
  sceneConfidence: number;
  primaryEcosystem: string[];
  adjacentEcosystem: string[];
  antiGenres: string[];
  anchorTrackIds: string[];
  candidatePoolBreakdown: {
    primary: number;
    adjacent: number;
    unrelated: number;
    anti: number;
    total: number;
  };
  finalPlaylistBreakdown: Record<string, number>;
  primaryShare: number;
  primaryFloor: number;
  swapsApplied: number;
  rejectedAndRegenerated: boolean;
  compositionSummary: string;
  /** Narrative flow phases for the detected scene */
  flowPhases: { intro: string; core: string; peak: string; cooldown: string };
  /** Per-scene composition target + whether it was met */
  ecosystemCompliance: {
    targetPct: number;
    actualPct: number;
    passed: boolean;
    compositionTarget: { primaryMin: number; adjacentMax: number; otherMax: number };
  };
}

/**
 * Build a rich debug object for admin panel / diagnostics.
 */
export function buildEcosystemDebug<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  score: number;
}>(opts: {
  vector: SemanticSceneVector;
  sceneConfidence: number;
  locked: boolean;
  pool: T[];
  finalTracks: T[];
  anchorTrackIds: string[];
  swapsApplied: number;
  rejectedAndRegenerated: boolean;
}): EcosystemDebug {
  const { vector, sceneConfidence, locked, pool, finalTracks, anchorTrackIds, swapsApplied, rejectedAndRegenerated } = opts;

  const primaryGenres = vector.genreEcosystem
    .filter((e) => e.weight >= PRIMARY_WEIGHT_FLOOR)
    .map((e) => e.genre);
  const adjacentGenres = vector.genreEcosystem
    .filter((e) => e.weight < PRIMARY_WEIGHT_FLOOR)
    .map((e) => e.genre);

  const poolClassified = classifyPoolByEcosystem(pool, vector);
  const finalClassified = classifyPoolByEcosystem(finalTracks, vector);

  // Final genre breakdown by RootGenre
  const genreCounts: Record<string, number> = {};
  for (const track of finalTracks) {
    const classification = classifyTrack(track);
    const genre = classification.genrePrimary;
    genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
  }
  const total = Math.max(1, finalTracks.length);
  const finalBreakdown: Record<string, number> = {};
  for (const [genre, count] of Object.entries(genreCounts)) {
    finalBreakdown[genre] = Math.round((count / total) * 100);
  }

  const primaryShare = finalClassified.primary.length / total;

  const compositionParts: string[] = [];
  for (const [genre, pct] of Object.entries(finalBreakdown).sort((a, b) => b[1] - a[1])) {
    compositionParts.push(`${genre} ${pct}%`);
  }

  const ct = vector.compositionTarget;
  const ecosystemCompliance = {
    targetPct: Math.round(ct.primaryMin * 100),
    actualPct: Math.round(primaryShare * 100),
    passed: primaryShare >= ct.primaryMin,
    compositionTarget: ct,
  };

  return {
    locked,
    sceneId: vector.id,
    sceneLabel: vector.label,
    sceneConfidence,
    primaryEcosystem: primaryGenres,
    adjacentEcosystem: adjacentGenres,
    antiGenres: vector.antiGenres,
    anchorTrackIds,
    candidatePoolBreakdown: {
      primary: poolClassified.primary.length,
      adjacent: poolClassified.adjacent.length,
      unrelated: poolClassified.unrelated.length,
      anti: poolClassified.anti.length,
      total: pool.length,
    },
    finalPlaylistBreakdown: finalBreakdown,
    primaryShare: Math.round(primaryShare * 100) / 100,
    primaryFloor: vector.ecosystemFloor,
    swapsApplied,
    rejectedAndRegenerated,
    compositionSummary: compositionParts.join(", "),
    flowPhases: vector.flowPhases,
    ecosystemCompliance,
  };
}
