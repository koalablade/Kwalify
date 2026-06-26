/**
 * Editorial pattern PRIORS — not learned from a corpus until fitted.
 *
 * `human-playlist-patterns.json` and DEFAULT_* values are hand-calibrated
 * heuristics (better hardcoded rules). Replace by running corpus fitting:
 *   npm run fit:human-playlist-patterns
 * and pointing HUMAN_PLAYLIST_PATTERNS_PATH at the output.
 *
 * True learning requires thousands of real playlists + pairwise human judgement
 * (see pairwise-playlist-judge.ts and scripts/pairwise-human-playlist-benchmark.ts).
 */

import fs from "node:fs";
import bundledPatterns from "../../data/human-playlist-patterns.json";

export type HumanPlaylistPatternProfile = {
  artistSpacingP25: number;
  artistSpacingP50: number;
  artistSpacingP75: number;
  maxSameArtistShare: number;
  popularityFrontLoad: number;
  popularityMidPeak: number;
  popularityDiscoveryTail: number;
  discoveryRatioP25: number;
  discoveryRatioP50: number;
  discoveryRatioP75: number;
  energyArcRiseWeight: number;
  energyArcFlatWeight: number;
  energyArcWaveWeight: number;
  energyArcCooldownWeight: number;
  maxEnergyJumpP90: number;
  transitionSmoothShare: number;
};

export const DEFAULT_HUMAN_PLAYLIST_PATTERNS: HumanPlaylistPatternProfile = {
  artistSpacingP25: 2,
  artistSpacingP50: 4,
  artistSpacingP75: 7,
  maxSameArtistShare: 0.14,
  popularityFrontLoad: 0.38,
  popularityMidPeak: 0.34,
  popularityDiscoveryTail: 0.28,
  discoveryRatioP25: 0.12,
  discoveryRatioP50: 0.22,
  discoveryRatioP75: 0.35,
  energyArcRiseWeight: 0.28,
  energyArcFlatWeight: 0.22,
  energyArcWaveWeight: 0.32,
  energyArcCooldownWeight: 0.18,
  maxEnergyJumpP90: 0.22,
  transitionSmoothShare: 0.72,
};

let cachedProfile: HumanPlaylistPatternProfile | null = null;

export function loadHumanPlaylistPatternProfile(): HumanPlaylistPatternProfile {
  if (cachedProfile) return cachedProfile;
  const envPath = process.env.HUMAN_PLAYLIST_PATTERNS_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(envPath, "utf8")) as Partial<HumanPlaylistPatternProfile>;
      cachedProfile = { ...DEFAULT_HUMAN_PLAYLIST_PATTERNS, ...raw };
      return cachedProfile;
    } catch {
      // fall through to defaults
    }
  }
  cachedProfile = { ...DEFAULT_HUMAN_PLAYLIST_PATTERNS, ...bundledPatterns };
  return cachedProfile;
}

export type HumanPlaylistFeatureSnapshot = {
  artistSpacingMedian: number;
  maxArtistShare: number;
  discoveryRatio: number;
  energySlope: number;
  avgEnergyJump: number;
  smoothTransitionShare: number;
};

export type PatternScoringTrack = {
  trackId: string;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  popularity?: number | null;
  rediscoveryScore?: number | null;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function textureBucket(track: PatternScoringTrack): string {
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  if (acoustic >= 0.55) return "acoustic";
  if (dance >= 0.65) return "rhythmic";
  if (acoustic <= 0.25 && dance <= 0.45) return "dense";
  return "balanced";
}

export function computeHumanPlaylistFeatures(
  tracks: PatternScoringTrack[],
): HumanPlaylistFeatureSnapshot {
  if (tracks.length === 0) {
    return {
      artistSpacingMedian: 0,
      maxArtistShare: 0,
      discoveryRatio: 0,
      energySlope: 0,
      avgEnergyJump: 0,
      smoothTransitionShare: 0,
    };
  }

  const artistPositions = new Map<string, number[]>();
  const artistCounts = new Map<string, number>();
  for (let i = 0; i < tracks.length; i++) {
    const artist = (tracks[i]!.artistName ?? "unknown").toLowerCase();
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    const positions = artistPositions.get(artist) ?? [];
    positions.push(i);
    artistPositions.set(artist, positions);
  }

  const spacings: number[] = [];
  for (const positions of artistPositions.values()) {
    for (let i = 1; i < positions.length; i++) {
      spacings.push(positions[i]! - positions[i - 1]!);
    }
  }
  spacings.sort((a, b) => a - b);
  const artistSpacingMedian = spacings.length > 0
    ? spacings[Math.floor(spacings.length / 2)]!
    : tracks.length;

  const maxArtistShare = Math.max(...artistCounts.values()) / tracks.length;

  const discoverySignals = tracks.map((track) => {
    if (typeof track.rediscoveryScore === "number") return track.rediscoveryScore;
    if (typeof track.popularity === "number") return clamp01(1 - track.popularity / 100);
    return 0.35;
  });
  const discoveryRatio = discoverySignals.filter((v) => v >= 0.55).length / tracks.length;

  const energies = tracks.map((t) => t.energy ?? 0.5);
  const n = energies.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += energies[i]!;
    sumXY += i * energies[i]!;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const energySlope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

  const jumps: number[] = [];
  let smoothTransitions = 0;
  for (let i = 1; i < tracks.length; i++) {
    const prev = tracks[i - 1]!;
    const curr = tracks[i]!;
    const jump = Math.abs((curr.energy ?? 0.5) - (prev.energy ?? 0.5));
    jumps.push(jump);
    const textureChange = textureBucket(curr) !== textureBucket(prev);
    if (jump <= 0.18 || !textureChange) smoothTransitions += 1;
  }
  jumps.sort((a, b) => a - b);
  const avgEnergyJump = jumps.length > 0
    ? jumps.reduce((s, v) => s + v, 0) / jumps.length
    : 0;

  return {
    artistSpacingMedian,
    maxArtistShare,
    discoveryRatio,
    energySlope,
    avgEnergyJump,
    smoothTransitionShare: jumps.length > 0 ? smoothTransitions / jumps.length : 1,
  };
}

function bandScore(value: number, p25: number, p50: number, p75: number): number {
  if (value >= p25 && value <= p75) return 1;
  const dist = value < p25 ? p25 - value : value - p75;
  return clamp01(1 - dist / Math.max(1, p75 - p25 + 0.01));
}

export function scoreAgainstHumanPlaylistPatterns(
  tracks: PatternScoringTrack[],
  profile: HumanPlaylistPatternProfile = loadHumanPlaylistPatternProfile(),
): {
  score: number;
  features: HumanPlaylistFeatureSnapshot;
  breakdown: Record<string, number>;
} {
  const features = computeHumanPlaylistFeatures(tracks);
  const breakdown = {
    artistSpacing: bandScore(
      features.artistSpacingMedian,
      profile.artistSpacingP25,
      profile.artistSpacingP50,
      profile.artistSpacingP75,
    ),
    artistDiversity: clamp01(1 - Math.max(0, features.maxArtistShare - profile.maxSameArtistShare) * 4),
    discoveryRatio: bandScore(
      features.discoveryRatio,
      profile.discoveryRatioP25,
      profile.discoveryRatioP50,
      profile.discoveryRatioP75,
    ),
    energyArc: (() => {
      const slope = features.energySlope;
      const weights = [
        { w: profile.energyArcRiseWeight, target: 0.012 },
        { w: profile.energyArcFlatWeight, target: 0 },
        { w: profile.energyArcWaveWeight, target: Math.abs(slope) >= 0.008 && Math.abs(slope) <= 0.025 ? slope : 0.016 },
        { w: profile.energyArcCooldownWeight, target: -0.012 },
      ];
      let best = 0;
      for (const row of weights) {
        best = Math.max(best, clamp01(1 - Math.abs(slope - row.target) * 18) * row.w);
      }
      return clamp01(best / Math.max(0.01, profile.energyArcRiseWeight + profile.energyArcFlatWeight));
    })(),
    transitions: clamp01(
      features.smoothTransitionShare / Math.max(0.01, profile.transitionSmoothShare),
    ),
    energyJumps: clamp01(1 - Math.max(0, features.avgEnergyJump - profile.maxEnergyJumpP90) * 3),
  };

  const score = clamp01(
    breakdown.artistSpacing * 0.22 +
    breakdown.artistDiversity * 0.18 +
    breakdown.discoveryRatio * 0.16 +
    breakdown.energyArc * 0.18 +
    breakdown.transitions * 0.16 +
    breakdown.energyJumps * 0.10,
  );

  return { score, features, breakdown };
}
