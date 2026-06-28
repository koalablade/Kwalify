/**
 * Playlist genome — learned playlist-level distributions from real public playlists.
 *
 * Replaces handcrafted editorial priors with measured percentiles, arc mix,
 * segment shapes, scoring weights, and pairwise thresholds.
 *
 * Fit: npm run fit:playlist-genome
 * Override: PLAYLIST_GENOME_PATH
 */

import fs from "node:fs";
import bundledGenome from "../../data/playlist-genome.json";
import {
  computeHumanPlaylistFeatures,
  DEFAULT_HUMAN_PLAYLIST_PATTERNS,
  type HumanPlaylistFeatureSnapshot,
  type HumanPlaylistPatternProfile,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import type { PairwiseDimension } from "./pairwise-playlist-judge";

export type FeatureDistribution = {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  stddev: number;
};

export type EnergyArcMix = {
  rise: number;
  flat: number;
  wave: number;
  cooldown: number;
};

export type GenomeScoringWeights = {
  artistSpacing: number;
  artistDiversity: number;
  discoveryRatio: number;
  energyArc: number;
  transitions: number;
  energyJumps: number;
  popularityCurve: number;
  decadeBalance: number;
  tempoDrift: number;
};

export type GenomePairwiseThresholds = {
  maxArtistShareCringe: number;
  maxEnergyJumpCringe: number;
  minSmoothTransitionShare: number;
  discoveryRatioLow: number;
  discoveryRatioHigh: number;
  artistSpacingGood: number;
  hardEnergyJump: number;
};

export type SegmentGenome = {
  artistSpacingMedian: FeatureDistribution;
  discoveryRatio: FeatureDistribution;
  avgEnergyJump: FeatureDistribution;
  smoothTransitionShare: FeatureDistribution;
  popularityShare: FeatureDistribution;
};

export type PlaylistGenomeProfile = {
  version: 1;
  fittedAt: string;
  corpusSize: number;
  trackCountMedian: number;
  patterns: HumanPlaylistPatternProfile;
  distributions: Record<keyof HumanPlaylistFeatureSnapshot, FeatureDistribution>;
  segmentDistributions: {
    opening: SegmentGenome;
    ending: SegmentGenome;
  };
  segmentBlend: {
    full: number;
    opening: number;
    ending: number;
  };
  energyArcMix: EnergyArcMix;
  scoringWeights: GenomeScoringWeights;
  pairwiseThresholds: GenomePairwiseThresholds;
  pairwiseWeights: Record<PairwiseDimension, number>;
};

export type CorpusPlaylist = {
  tracks: PatternScoringTrack[];
};

const FEATURE_KEYS = [
  "artistSpacingMedian",
  "maxArtistShare",
  "discoveryRatio",
  "energySlope",
  "avgEnergyJump",
  "smoothTransitionShare",
  "popularityFrontShare",
  "popularityMidShare",
  "popularityTailShare",
  "decadeSpread",
  "tempoDrift",
] as const satisfies ReadonlyArray<keyof HumanPlaylistFeatureSnapshot>;

const DEFAULT_PAIRWISE_THRESHOLDS: GenomePairwiseThresholds = {
  maxArtistShareCringe: 0.14,
  maxEnergyJumpCringe: 0.22,
  minSmoothTransitionShare: 0.55,
  discoveryRatioLow: 0.22,
  discoveryRatioHigh: 0.48,
  artistSpacingGood: 4,
  hardEnergyJump: 0.28,
};

const DEFAULT_SEGMENT_BLEND = { full: 0.5, opening: 0.28, ending: 0.22 };

const DEFAULT_SCORING_WEIGHTS: GenomeScoringWeights = {
  artistSpacing: 0.18,
  artistDiversity: 0.14,
  discoveryRatio: 0.14,
  energyArc: 0.14,
  transitions: 0.12,
  energyJumps: 0.08,
  popularityCurve: 0.12,
  decadeBalance: 0.04,
  tempoDrift: 0.04,
};

let cachedGenome: PlaylistGenomeProfile | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function fitFeatureDistribution(values: number[]): FeatureDistribution {
  return {
    p10: percentile(values, 0.1),
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    mean: mean(values),
    stddev: stddev(values),
  };
}

function classifyEnergyArc(slope: number): keyof EnergyArcMix {
  if (slope >= 0.008) return "rise";
  if (slope <= -0.008) return "cooldown";
  if (Math.abs(slope) < 0.004) return "flat";
  return "wave";
}

function normalizeWeights(weights: Record<string, number>): GenomeScoringWeights {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  if (sum <= 0) return { ...DEFAULT_SCORING_WEIGHTS };
  const out = {} as GenomeScoringWeights;
  for (const [key, value] of Object.entries(weights)) {
    out[key as keyof GenomeScoringWeights] = value / sum;
  }
  return out;
}

function blendWeights(
  measured: GenomeScoringWeights,
  fallback: GenomeScoringWeights,
  measuredShare: number,
): GenomeScoringWeights {
  const share = clamp01(measuredShare);
  const out = {} as GenomeScoringWeights;
  for (const key of Object.keys(fallback) as Array<keyof GenomeScoringWeights>) {
    out[key] = measured[key] * share + fallback[key] * (1 - share);
  }
  return normalizeWeights(out as unknown as Record<string, number>);
}

function distributionSpread(dist: FeatureDistribution): number {
  return Math.max(0, dist.p75 - dist.p25);
}

function deriveScoringWeights(
  distributions: PlaylistGenomeProfile["distributions"],
): GenomeScoringWeights {
  const spreads = {
    artistSpacing: distributionSpread(distributions.artistSpacingMedian),
    artistDiversity: distributionSpread(distributions.maxArtistShare),
    discoveryRatio: distributionSpread(distributions.discoveryRatio),
    energyArc: distributionSpread(distributions.energySlope),
    transitions: distributionSpread(distributions.smoothTransitionShare),
    energyJumps: distributionSpread(distributions.avgEnergyJump),
    popularityCurve:
      distributionSpread(distributions.popularityFrontShare) +
      distributionSpread(distributions.popularityMidShare) +
      distributionSpread(distributions.popularityTailShare),
    decadeBalance: distributionSpread(distributions.decadeSpread),
    tempoDrift: distributionSpread(distributions.tempoDrift),
  };
  const informative = Object.values(spreads).filter((spread) => spread > 0.001).length;
  const measuredShare = clamp01(informative / Object.keys(spreads).length);
  const measured = normalizeWeights(spreads as unknown as Record<string, number>);
  return blendWeights(measured, DEFAULT_SCORING_WEIGHTS, measuredShare);
}

function deriveSegmentBlend(
  fullScores: number[],
  openingScores: number[],
  endingScores: number[],
): { full: number; opening: number; ending: number } {
  const spreads = {
    full: stddev(fullScores),
    opening: stddev(openingScores),
    ending: stddev(endingScores),
  };
  const sum = spreads.full + spreads.opening + spreads.ending;
  if (sum <= 0) return { ...DEFAULT_SEGMENT_BLEND };
  return {
    full: spreads.full / sum,
    opening: spreads.opening / sum,
    ending: spreads.ending / sum,
  };
}

function pickThreshold(
  measured: number,
  fallback: number,
  minSpread = 0.001,
  spread = 0,
): number {
  return spread > minSpread && Number.isFinite(measured) ? measured : fallback;
}

function derivePairwiseThresholds(
  distributions: PlaylistGenomeProfile["distributions"],
): GenomePairwiseThresholds {
  return {
    maxArtistShareCringe: pickThreshold(
      distributions.maxArtistShare.p90,
      DEFAULT_PAIRWISE_THRESHOLDS.maxArtistShareCringe,
      0.001,
      distributionSpread(distributions.maxArtistShare),
    ),
    maxEnergyJumpCringe: pickThreshold(
      distributions.avgEnergyJump.p90,
      DEFAULT_PAIRWISE_THRESHOLDS.maxEnergyJumpCringe,
      0.01,
      distributionSpread(distributions.avgEnergyJump),
    ),
    minSmoothTransitionShare: pickThreshold(
      distributions.smoothTransitionShare.p25,
      DEFAULT_PAIRWISE_THRESHOLDS.minSmoothTransitionShare,
      0.01,
      distributionSpread(distributions.smoothTransitionShare),
    ),
    discoveryRatioLow: pickThreshold(
      distributions.discoveryRatio.p25,
      DEFAULT_PAIRWISE_THRESHOLDS.discoveryRatioLow,
      0.01,
      distributionSpread(distributions.discoveryRatio),
    ),
    discoveryRatioHigh: pickThreshold(
      distributions.discoveryRatio.p75,
      DEFAULT_PAIRWISE_THRESHOLDS.discoveryRatioHigh,
      0.01,
      distributionSpread(distributions.discoveryRatio),
    ),
    artistSpacingGood: pickThreshold(
      distributions.artistSpacingMedian.p50,
      DEFAULT_PAIRWISE_THRESHOLDS.artistSpacingGood,
      0.5,
      distributionSpread(distributions.artistSpacingMedian),
    ),
    hardEnergyJump: pickThreshold(
      Math.max(distributions.avgEnergyJump.p90, distributions.avgEnergyJump.p90 * 1.15),
      DEFAULT_PAIRWISE_THRESHOLDS.hardEnergyJump,
      0.01,
      distributionSpread(distributions.avgEnergyJump),
    ),
  };
}

function patternsFromDistributions(
  distributions: PlaylistGenomeProfile["distributions"],
  energyArcMix: EnergyArcMix,
): HumanPlaylistPatternProfile {
  return {
    ...DEFAULT_HUMAN_PLAYLIST_PATTERNS,
    artistSpacingP25: distributions.artistSpacingMedian.p25,
    artistSpacingP50: distributions.artistSpacingMedian.p50,
    artistSpacingP75: distributions.artistSpacingMedian.p75,
    maxSameArtistShare: distributions.maxArtistShare.p90,
    popularityFrontLoad: distributions.popularityFrontShare.p50,
    popularityMidPeak: distributions.popularityMidShare.p50,
    popularityDiscoveryTail: distributions.popularityTailShare.p50,
    discoveryRatioP25: distributions.discoveryRatio.p25,
    discoveryRatioP50: distributions.discoveryRatio.p50,
    discoveryRatioP75: distributions.discoveryRatio.p75,
    maxEnergyJumpP90: distributions.avgEnergyJump.p90,
    transitionSmoothShare: distributions.smoothTransitionShare.p50,
    energyArcRiseWeight: energyArcMix.rise,
    energyArcFlatWeight: energyArcMix.flat,
    energyArcWaveWeight: energyArcMix.wave,
    energyArcCooldownWeight: energyArcMix.cooldown,
  };
}

function segmentGenomeFromRows(rows: Array<{
  artistSpacingMedian: number;
  discoveryRatio: number;
  avgEnergyJump: number;
  smoothTransitionShare: number;
  popularityShare: number;
}>): SegmentGenome {
  return {
    artistSpacingMedian: fitFeatureDistribution(rows.map((row) => row.artistSpacingMedian)),
    discoveryRatio: fitFeatureDistribution(rows.map((row) => row.discoveryRatio)),
    avgEnergyJump: fitFeatureDistribution(rows.map((row) => row.avgEnergyJump)),
    smoothTransitionShare: fitFeatureDistribution(rows.map((row) => row.smoothTransitionShare)),
    popularityShare: fitFeatureDistribution(rows.map((row) => row.popularityShare)),
  };
}

export function fitPlaylistGenomeFromCorpus(playlists: CorpusPlaylist[]): PlaylistGenomeProfile {
  const usable = playlists.filter((playlist) => (playlist.tracks?.length ?? 0) >= 10);
  if (usable.length < 3) {
    throw new Error("Corpus must contain at least 3 playlists with 10+ tracks.");
  }

  const featureRows: HumanPlaylistFeatureSnapshot[] = [];
  const openingRows: Array<{
    artistSpacingMedian: number;
    discoveryRatio: number;
    avgEnergyJump: number;
    smoothTransitionShare: number;
    popularityShare: number;
  }> = [];
  const endingRows: typeof openingRows = [];
  const fullScores: number[] = [];
  const openingScores: number[] = [];
  const endingScores: number[] = [];
  const trackCounts: number[] = [];
  const arcCounts: EnergyArcMix = { rise: 0, flat: 0, wave: 0, cooldown: 0 };

  for (const playlist of usable) {
    const tracks = playlist.tracks;
    trackCounts.push(tracks.length);
    const features = computeHumanPlaylistFeatures(tracks);
    featureRows.push(features);
    arcCounts[classifyEnergyArc(features.energySlope)] += 1;

    const opening = tracks.slice(0, 5);
    const ending = tracks.slice(-Math.min(8, tracks.length));
    const openingFeatures = computeHumanPlaylistFeatures(opening);
    const endingFeatures = computeHumanPlaylistFeatures(ending);
    const openingPop = openingFeatures.popularityFrontShare;
    const endingPop = endingFeatures.popularityTailShare;

    openingRows.push({
      artistSpacingMedian: openingFeatures.artistSpacingMedian,
      discoveryRatio: openingFeatures.discoveryRatio,
      avgEnergyJump: openingFeatures.avgEnergyJump,
      smoothTransitionShare: openingFeatures.smoothTransitionShare,
      popularityShare: openingPop,
    });
    endingRows.push({
      artistSpacingMedian: endingFeatures.artistSpacingMedian,
      discoveryRatio: endingFeatures.discoveryRatio,
      avgEnergyJump: endingFeatures.avgEnergyJump,
      smoothTransitionShare: endingFeatures.smoothTransitionShare,
      popularityShare: endingPop,
    });

    fullScores.push(features.smoothTransitionShare);
    openingScores.push(openingFeatures.smoothTransitionShare);
    endingScores.push(endingFeatures.smoothTransitionShare);
  }

  const arcTotal = arcCounts.rise + arcCounts.flat + arcCounts.wave + arcCounts.cooldown;
  const energyArcMix: EnergyArcMix = arcTotal > 0
    ? {
        rise: arcCounts.rise / arcTotal,
        flat: arcCounts.flat / arcTotal,
        wave: arcCounts.wave / arcTotal,
        cooldown: arcCounts.cooldown / arcTotal,
      }
    : {
        rise: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcRiseWeight,
        flat: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcFlatWeight,
        wave: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcWaveWeight,
        cooldown: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcCooldownWeight,
      };

  const distributions = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, fitFeatureDistribution(featureRows.map((row) => row[key]))]),
  ) as PlaylistGenomeProfile["distributions"];

  const patterns = patternsFromDistributions(distributions, energyArcMix);
  const scoringWeights = deriveScoringWeights(distributions);
  const pairwiseThresholds = derivePairwiseThresholds(distributions);
  const segmentBlend = deriveSegmentBlend(fullScores, openingScores, endingScores);

  return {
    version: 1,
    fittedAt: new Date().toISOString(),
    corpusSize: usable.length,
    trackCountMedian: percentile(trackCounts, 0.5),
    patterns,
    distributions,
    segmentDistributions: {
      opening: segmentGenomeFromRows(openingRows),
      ending: segmentGenomeFromRows(endingRows),
    },
    segmentBlend,
    energyArcMix,
    scoringWeights,
    pairwiseThresholds,
    pairwiseWeights: {
      human_saveable: 1,
      opening_intention: 1,
      full_playlist_shape: 1,
      cringe_resistance: 1,
      prompt_alignment: 1,
      transition_flow: 1,
      discovery_pacing: 1,
      ending_satisfaction: 1,
    },
  };
}

function isPlaylistGenomeProfile(value: unknown): value is PlaylistGenomeProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlaylistGenomeProfile>;
  return candidate.version === 1 && !!candidate.patterns && !!candidate.distributions;
}

export function defaultPlaylistGenomeProfile(): PlaylistGenomeProfile {
  const empty = fitFeatureDistribution([]);
  const distributions = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, { ...empty }]),
  ) as PlaylistGenomeProfile["distributions"];
  return {
    version: 1,
    fittedAt: "hand-tuned",
    corpusSize: 0,
    trackCountMedian: 30,
    patterns: { ...DEFAULT_HUMAN_PLAYLIST_PATTERNS, ...bundledGenome.patterns },
    distributions,
    segmentDistributions: {
      opening: {
        artistSpacingMedian: empty,
        discoveryRatio: empty,
        avgEnergyJump: empty,
        smoothTransitionShare: empty,
        popularityShare: empty,
      },
      ending: {
        artistSpacingMedian: empty,
        discoveryRatio: empty,
        avgEnergyJump: empty,
        smoothTransitionShare: empty,
        popularityShare: empty,
      },
    },
    segmentBlend: { ...DEFAULT_SEGMENT_BLEND },
    energyArcMix: {
      rise: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcRiseWeight,
      flat: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcFlatWeight,
      wave: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcWaveWeight,
      cooldown: DEFAULT_HUMAN_PLAYLIST_PATTERNS.energyArcCooldownWeight,
    },
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    pairwiseThresholds: { ...DEFAULT_PAIRWISE_THRESHOLDS },
    pairwiseWeights: {
      human_saveable: 1,
      opening_intention: 1,
      full_playlist_shape: 1,
      cringe_resistance: 1,
      prompt_alignment: 1,
      transition_flow: 1,
      discovery_pacing: 1,
      ending_satisfaction: 1,
    },
  };
}

export function loadPlaylistGenome(): PlaylistGenomeProfile {
  if (cachedGenome) return cachedGenome;

  const envPath = process.env.PLAYLIST_GENOME_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(envPath, "utf8")) as Partial<PlaylistGenomeProfile>;
      if (isPlaylistGenomeProfile(raw)) {
        cachedGenome = raw;
        return cachedGenome;
      }
    } catch {
      // fall through
    }
  }

  if (isPlaylistGenomeProfile(bundledGenome)) {
    cachedGenome = bundledGenome;
    return cachedGenome;
  }

  cachedGenome = defaultPlaylistGenomeProfile();
  return cachedGenome;
}

export function genomeBandScore(value: number, dist: FeatureDistribution): number {
  if (dist.p75 <= dist.p25) return 1;
  if (value >= dist.p25 && value <= dist.p75) return 1;
  const distEdge = value < dist.p25 ? dist.p25 - value : value - dist.p75;
  return clamp01(1 - distEdge / Math.max(0.01, dist.p75 - dist.p25 + 0.01));
}

export function genomeCurveScore(actual: number, target: number, tolerance = 0.12): number {
  return clamp01(1 - Math.abs(actual - target) / tolerance);
}

export function scoreFeaturesAgainstGenome(
  features: HumanPlaylistFeatureSnapshot,
  genome: PlaylistGenomeProfile = loadPlaylistGenome(),
): {
  score: number;
  breakdown: Record<string, number>;
} {
  const profile = genome.patterns;
  const weights = genome.scoringWeights;
  const breakdown = {
    artistSpacing: genomeBandScore(features.artistSpacingMedian, genome.distributions.artistSpacingMedian),
    artistDiversity: clamp01(1 - Math.max(0, features.maxArtistShare - profile.maxSameArtistShare) * 4),
    discoveryRatio: genomeBandScore(features.discoveryRatio, genome.distributions.discoveryRatio),
    energyArc: (() => {
      const slope = features.energySlope;
      const rows = [
        { w: profile.energyArcRiseWeight, target: 0.012 },
        { w: profile.energyArcFlatWeight, target: 0 },
        { w: profile.energyArcWaveWeight, target: Math.abs(slope) >= 0.008 && Math.abs(slope) <= 0.025 ? slope : 0.016 },
        { w: profile.energyArcCooldownWeight, target: -0.012 },
      ];
      let best = 0;
      for (const row of rows) {
        best = Math.max(best, clamp01(1 - Math.abs(slope - row.target) * 18) * row.w);
      }
      return clamp01(best / Math.max(0.01, profile.energyArcRiseWeight + profile.energyArcFlatWeight));
    })(),
    transitions: clamp01(
      features.smoothTransitionShare / Math.max(0.01, profile.transitionSmoothShare),
    ),
    energyJumps: clamp01(1 - Math.max(0, features.avgEnergyJump - profile.maxEnergyJumpP90) * 3),
    popularityCurve: clamp01(
      genomeCurveScore(features.popularityFrontShare, profile.popularityFrontLoad, 0.14) * 0.34 +
      genomeCurveScore(features.popularityMidShare, profile.popularityMidPeak, 0.14) * 0.33 +
      genomeCurveScore(features.popularityTailShare, profile.popularityDiscoveryTail, 0.14) * 0.33,
    ),
    decadeBalance: clamp01(
      features.decadeSpread >= genome.distributions.decadeSpread.p25 &&
      features.decadeSpread <= genome.distributions.decadeSpread.p75
        ? 1
        : 0.62,
    ),
    tempoDrift: clamp01(1 - Math.max(0, features.tempoDrift - genome.distributions.tempoDrift.p75) * 1.2),
  };

  const score = clamp01(
    breakdown.artistSpacing * weights.artistSpacing +
    breakdown.artistDiversity * weights.artistDiversity +
    breakdown.discoveryRatio * weights.discoveryRatio +
    breakdown.energyArc * weights.energyArc +
    breakdown.transitions * weights.transitions +
    breakdown.energyJumps * weights.energyJumps +
    breakdown.popularityCurve * weights.popularityCurve +
    breakdown.decadeBalance * weights.decadeBalance +
    breakdown.tempoDrift * weights.tempoDrift,
  );

  return { score, breakdown };
}

export function attachPairwiseWeights(
  genome: PlaylistGenomeProfile,
  weights: Record<PairwiseDimension, number>,
): PlaylistGenomeProfile {
  return { ...genome, pairwiseWeights: weights };
}
