/**
 * Primary-path cross-playlist novelty — penalize repeated winners before final ranking.
 *
 * Complements recovery-only playlistFrequencyPenalty and jitter-based noveltyByTrack.
 * Does not remove tracks; subtractive score adjustment only.
 */

import type { FreshnessStats } from "./playlist-freshness";

export type CrossPlaylistNoveltyConfig = {
  enabled: boolean;
  stats: FreshnessStats;
  previousPlaylistCount: number;
  /** Session frequency multipliers from buildPlaylistFrequencyPenalty (optional). */
  frequencyPenalty?: Map<string, number>;
  saveCountByTrack?: Readonly<Record<string, number>>;
  artistAffinityByArtist?: Readonly<Record<string, number>>;
  /** Prior-playlist artist appearances (lowercase keys). */
  artistAppearances?: Map<string, number>;
};

export type NoveltyPenaltyAuditEntry = {
  trackId: string;
  artistName: string;
  trackName: string;
  trackFrequency: number;
  previousPlaylistCount: number;
  noveltyPenalty: number;
  scoreBefore: number;
  scoreAfter: number;
  scoringStage: "post_score_primary_path";
};

export type NoveltyDiagnostics = {
  trackFrequency: Record<string, number>;
  previousPlaylistCount: number;
  noveltyPenalty: Record<string, number>;
  scoreBefore: Record<string, number>;
  scoreAfter: Record<string, number>;
  displacedTracks: Array<{
    trackId: string;
    artistName: string;
    trackName: string;
    trackFrequency: number;
    noveltyPenalty: number;
    scoreBefore: number;
    scoreAfter: number;
    alternativeTrackId?: string;
    alternativeArtistName?: string;
    alternativeTrackName?: string;
    alternativeScoreAfter?: number;
  }>;
  /** Fallback when full diagnostics were not assembled but audit sample exists. */
  auditSample?: NoveltyPenaltyAuditEntry[];
};

export function trackPlaylistAppearanceCount(
  stats: FreshnessStats,
  trackId: string,
): number {
  return stats.trackAppearances.get(trackId) ?? 0;
}

/**
 * Subtractive penalty from prior playlist appearances.
 * 0 appearances → no penalty. Escalates with heavy reuse.
 */
export function primaryPathNoveltyDeduction(
  appearanceCount: number,
  opts?: {
    saveCount?: number;
    artistAffinity?: number;
    frequencyMultiplier?: number;
  },
): number {
  if (appearanceCount <= 0) return 0;

  let deduction: number;
  if (appearanceCount === 1) deduction = 0.04;
  else if (appearanceCount === 2) deduction = 0.09;
  else if (appearanceCount === 3) deduction = 0.14;
  else if (appearanceCount <= 5) deduction = 0.22;
  else if (appearanceCount <= 8) deduction = 0.32;
  else if (appearanceCount <= 12) deduction = 0.42;
  else deduction = 0.52;

  const freqMult = opts?.frequencyMultiplier;
  if (freqMult != null && freqMult < 1) {
    deduction += (1 - freqMult) * 0.18;
  }

  const saveCount = opts?.saveCount ?? 0;
  if (saveCount >= 2) deduction *= 0.25;
  else if (saveCount >= 1) deduction *= 0.5;

  if ((opts?.artistAffinity ?? 0) > 0.4) deduction *= 0.7;

  return Math.round(Math.min(0.65, deduction) * 1000) / 1000;
}

/**
 * Subtractive penalty when the same artist wins across playlists with different tracks.
 * Does not soften via artistAffinity — rotating-track dominance is the target.
 */
export function primaryPathArtistNoveltyDeduction(artistPlaylistCount: number): number {
  if (artistPlaylistCount <= 0) return 0;
  let deduction: number;
  if (artistPlaylistCount === 1) deduction = 0.05;
  else if (artistPlaylistCount === 2) deduction = 0.10;
  else if (artistPlaylistCount === 3) deduction = 0.16;
  else if (artistPlaylistCount <= 5) deduction = 0.24;
  else if (artistPlaylistCount <= 8) deduction = 0.32;
  else if (artistPlaylistCount <= 12) deduction = 0.38;
  else deduction = 0.45;
  return Math.round(Math.min(0.5, deduction) * 1000) / 1000;
}

export function applyPrimaryPathNoveltyPenalty(
  score: number,
  trackId: string,
  artistName: string,
  config: CrossPlaylistNoveltyConfig | undefined,
): { score: number; penalty: number; appearanceCount: number; artistPenalty: number } {
  if (!config?.enabled) {
    return { score, penalty: 0, appearanceCount: 0, artistPenalty: 0 };
  }

  const appearanceCount = trackPlaylistAppearanceCount(config.stats, trackId);
  const saveCount = config.saveCountByTrack?.[trackId] ?? 0;
  const artistAffinity = config.artistAffinityByArtist?.[artistName] ?? 0;
  const frequencyMultiplier = config.frequencyPenalty?.get(trackId);
  const artistKey = artistName.toLowerCase().trim();
  const artistPlaylistCount = config.artistAppearances?.get(artistKey) ?? 0;

  const trackPenalty = primaryPathNoveltyDeduction(appearanceCount, {
    saveCount,
    artistAffinity,
    frequencyMultiplier,
  });
  const artistPenalty = primaryPathArtistNoveltyDeduction(artistPlaylistCount);
  const penalty = Math.round(Math.min(0.65, trackPenalty + artistPenalty) * 1000) / 1000;

  return {
    score: Math.max(0.05, score - penalty),
    penalty,
    appearanceCount,
    artistPenalty,
  };
}

type RankedCandidate = {
  trackId: string;
  artistName: string;
  trackName: string;
  scoreBefore: number;
  scoreAfter: number;
  penalty: number;
  appearanceCount: number;
};

export function buildNoveltyDiagnostics(
  candidates: RankedCandidate[],
  config: CrossPlaylistNoveltyConfig | undefined,
  sampleLimit = 12,
): NoveltyDiagnostics | null {
  if (!config?.enabled) return null;

  const penalized = candidates
    .filter((c) => c.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty || b.appearanceCount - a.appearanceCount);

  const topPenalized = penalized.slice(0, sampleLimit);
  const byScoreAfter = [...candidates].sort((a, b) => b.scoreAfter - a.scoreAfter);

  if (topPenalized.length === 0) {
    return {
      trackFrequency: {},
      previousPlaylistCount: config.previousPlaylistCount,
      noveltyPenalty: {},
      scoreBefore: {},
      scoreAfter: {},
      displacedTracks: [],
    };
  }

  const trackFrequency: Record<string, number> = {};
  const noveltyPenalty: Record<string, number> = {};
  const scoreBefore: Record<string, number> = {};
  const scoreAfter: Record<string, number> = {};

  for (const row of topPenalized) {
    trackFrequency[row.trackId] = row.appearanceCount;
    noveltyPenalty[row.trackId] = row.penalty;
    scoreBefore[row.trackId] = row.scoreBefore;
    scoreAfter[row.trackId] = row.scoreAfter;
  }

  const displacedTracks = topPenalized.map((row) => {
    const alt = byScoreAfter.find(
      (c) => c.trackId !== row.trackId && c.appearanceCount === 0 && c.scoreAfter >= row.scoreAfter - 0.05,
    );
    return {
      trackId: row.trackId,
      artistName: row.artistName,
      trackName: row.trackName,
      trackFrequency: row.appearanceCount,
      noveltyPenalty: row.penalty,
      scoreBefore: row.scoreBefore,
      scoreAfter: row.scoreAfter,
      ...(alt
        ? {
            alternativeTrackId: alt.trackId,
            alternativeArtistName: alt.artistName,
            alternativeTrackName: alt.trackName,
            alternativeScoreAfter: alt.scoreAfter,
          }
        : {}),
    };
  });

  return {
    trackFrequency,
    previousPlaylistCount: config.previousPlaylistCount,
    noveltyPenalty,
    scoreBefore,
    scoreAfter,
    displacedTracks,
  };
}

export function resolveNoveltyDiagnostics(
  scoringDiagnostics: Record<string, unknown> | undefined,
  previousPlaylistCount: number,
  enabled = false,
): NoveltyDiagnostics | null {
  const direct = scoringDiagnostics?.noveltyDiagnostics;
  if (direct && typeof direct === "object") {
    return direct as NoveltyDiagnostics;
  }
  const auditSample = scoringDiagnostics?.noveltyPenaltyAuditSample;
  if (Array.isArray(auditSample) && auditSample.length > 0) {
    return {
      trackFrequency: {},
      previousPlaylistCount,
      noveltyPenalty: {},
      scoreBefore: {},
      scoreAfter: {},
      displacedTracks: [],
      auditSample: auditSample as NoveltyPenaltyAuditEntry[],
    };
  }
  if (enabled && previousPlaylistCount > 0) {
    return {
      trackFrequency: {},
      previousPlaylistCount,
      noveltyPenalty: {},
      scoreBefore: {},
      scoreAfter: {},
      displacedTracks: [],
    };
  }
  return null;
}
