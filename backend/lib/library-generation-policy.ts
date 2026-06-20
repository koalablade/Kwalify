/**
 * Library-aware generation policy — profiles user catalog density/distribution
 * and prompt uncertainty, then resolves scoring/retrieval/diversity behaviour.
 *
 * Single systemic adaptation layer (no prompt archetypes).
 */

import type { EmotionProfile } from "./emotion";
import type { TrackGenreClassification } from "./genre-taxonomy";

export type LibraryRichnessLabel = "sparse" | "moderate" | "rich";
export type LibraryDistributionLabel = "mainstream_heavy" | "balanced" | "niche_heavy";

export type UserLibraryProfile = {
  trackCount: number;
  artistCount: number;
  artistSpread: number;
  genreEntropy: number;
  genreLockedRatio: number;
  avgPopularity: number | null;
  mainstreamRatio: number;
  embeddingVariance: number;
  discoveryCapacity: number;
  richness: LibraryRichnessLabel;
  distribution: LibraryDistributionLabel;
};

export type PromptUncertaintyProfile = {
  score: number;
  signalCount: number;
  explicitDimensions: number;
};

export type GenerationPolicy = {
  library: UserLibraryProfile;
  prompt: PromptUncertaintyProfile;
  retrievalBreadth: number;
  diversityPressure: number;
  mainstreamSuppression: number;
  discoveryBoost: number;
  intentElasticity: number;
  disableFastPath: boolean;
  minCandidateRatio: number;
  escapeDiversityRatio: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function shannonEntropyNormalized(counts: Map<string, number>): number {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total <= 0 || counts.size <= 1) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(counts.size);
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function profileUserLibrary<T extends {
  trackId: string;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  popularity?: number | null;
}>(
  tracks: T[],
  classMap: Map<string, TrackGenreClassification>,
): UserLibraryProfile {
  const trackCount = tracks.length;
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  let popularitySum = 0;
  let popularityCount = 0;
  let mainstreamCount = 0;
  const embeddingSamples: number[] = [];

  for (const track of tracks) {
    const artist = track.artistName?.toLowerCase().trim();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);

    const family = classMap.get(track.trackId)?.genreFamily ?? "unknown";
    genreCounts.set(family, (genreCounts.get(family) ?? 0) + 1);

    if (typeof track.popularity === "number" && Number.isFinite(track.popularity)) {
      popularitySum += track.popularity;
      popularityCount += 1;
      if (track.popularity >= 75) mainstreamCount += 1;
    }

    if (typeof track.energy === "number" && typeof track.valence === "number") {
      embeddingSamples.push(track.energy, track.valence);
    }
  }

  const artistCount = artistCounts.size;
  const artistSpread = trackCount > 0 ? artistCount / trackCount : 0;
  const genreEntropy = shannonEntropyNormalized(genreCounts);
  const maxGenreShare = trackCount > 0
    ? Math.max(...genreCounts.values(), 0) / trackCount
    : 1;
  const avgPopularity = popularityCount > 0 ? popularitySum / popularityCount : null;
  const mainstreamRatio = trackCount > 0 ? mainstreamCount / trackCount : 0;
  const embeddingVariance = variance(embeddingSamples);

  const richness: LibraryRichnessLabel =
    trackCount < 900 || artistCount < 180 ? "sparse"
      : trackCount >= 3500 && artistCount >= 700 && genreEntropy >= 0.55 ? "rich"
        : "moderate";

  const distribution: LibraryDistributionLabel =
    mainstreamRatio >= 0.42 || (avgPopularity != null && avgPopularity >= 68)
      ? "mainstream_heavy"
      : genreEntropy <= 0.28 || maxGenreShare >= 0.62
        ? "niche_heavy"
        : "balanced";

  const discoveryCapacity = clamp01(
    artistSpread * 0.35 +
    genreEntropy * 0.30 +
    Math.min(1, trackCount / 4000) * 0.20 +
    (1 - mainstreamRatio) * 0.15,
  );

  return {
    trackCount,
    artistCount,
    artistSpread: round3(artistSpread),
    genreEntropy: round3(genreEntropy),
    genreLockedRatio: round3(maxGenreShare),
    avgPopularity: avgPopularity == null ? null : round3(avgPopularity),
    mainstreamRatio: round3(mainstreamRatio),
    embeddingVariance: round3(embeddingVariance),
    discoveryCapacity: round3(discoveryCapacity),
    richness,
    distribution,
  };
}

export function estimatePromptUncertainty(input: {
  vibe: string;
  moodCount: number;
  explicitDimensions: number;
  interpretationComplexity?: "low" | "medium" | "high";
  sceneConfidence?: number | null;
  emotionProfile?: EmotionProfile;
}): PromptUncertaintyProfile {
  const words = input.vibe.trim().split(/\s+/).filter(Boolean).length;
  let score = 0.22;
  score += Math.min(0.22, words / 18);
  score += Math.min(0.18, input.moodCount * 0.07);
  score += Math.min(0.16, input.explicitDimensions * 0.04);

  if (input.interpretationComplexity === "low") score += 0.10;
  if (input.interpretationComplexity === "high") score -= 0.06;

  if (typeof input.sceneConfidence === "number") {
    score += Math.max(0, 0.60 - input.sceneConfidence) * 0.28;
  }

  const profile = input.emotionProfile;
  if (profile) {
    const axisHits = [
      profile.timeOfDay,
      profile.environment,
      profile.motionState,
      profile.valence >= 0.58 || profile.valence <= 0.42,
      profile.nostalgia >= 0.45,
      profile.calm >= 0.52,
      profile.tension >= 0.45,
    ].filter(Boolean).length;
    score += Math.min(0.14, Math.max(0, axisHits - 1) * 0.035);
  }

  const signalCount = input.explicitDimensions + input.moodCount + (profile?.timeOfDay ? 1 : 0);
  return {
    score: round3(clamp01(score)),
    signalCount,
    explicitDimensions: input.explicitDimensions,
  };
}

export function resolveGenerationPolicy(
  library: UserLibraryProfile,
  prompt: PromptUncertaintyProfile,
): GenerationPolicy {
  const sparse = library.richness === "sparse";
  const rich = library.richness === "rich";
  const mainstream = library.distribution === "mainstream_heavy";
  const genreLocked = library.genreLockedRatio >= 0.55;
  const lowDiscovery = library.discoveryCapacity < 0.42;
  const ambiguous = prompt.score >= 0.50;
  const multiSignal = prompt.signalCount >= 3;

  let retrievalBreadth = 1;
  let diversityPressure = 1;
  let mainstreamSuppression = 1;
  let discoveryBoost = 1;
  let intentElasticity = 1;
  let disableFastPath = false;
  let minCandidateRatio = 0.75;
  let escapeDiversityRatio = 0.12;

  if (sparse) {
    retrievalBreadth = 1.22;
    diversityPressure = 1.14;
    discoveryBoost = 1.30;
    intentElasticity = 0.84;
    minCandidateRatio = 0.42;
    escapeDiversityRatio = 0.18;
    disableFastPath = true;
  } else if (rich) {
    retrievalBreadth = 1.12;
    diversityPressure = 1.10;
    discoveryBoost = 1.22;
    minCandidateRatio = 0.82;
    escapeDiversityRatio = 0.16;
  }

  if (mainstream || lowDiscovery) {
    mainstreamSuppression = Math.max(mainstreamSuppression, mainstream ? 1.75 : 1.35);
    discoveryBoost = Math.max(discoveryBoost, 1.18);
    diversityPressure = Math.max(diversityPressure, 1.08);
  }

  if (genreLocked) {
    diversityPressure = Math.max(diversityPressure, 1.10);
    intentElasticity = Math.min(intentElasticity, 0.88);
    escapeDiversityRatio = Math.max(escapeDiversityRatio, 0.20);
  }

  if (ambiguous || multiSignal) {
    retrievalBreadth = Math.max(retrievalBreadth, 1.14);
    diversityPressure = Math.max(diversityPressure, 1.08);
    intentElasticity = Math.min(intentElasticity, 0.90);
    disableFastPath = true;
  }

  if (library.embeddingVariance < 0.012) {
    diversityPressure = Math.max(diversityPressure, 1.12);
    discoveryBoost = Math.max(discoveryBoost, 1.15);
    disableFastPath = true;
  }

  return {
    library,
    prompt,
    retrievalBreadth: round3(retrievalBreadth),
    diversityPressure: round3(diversityPressure),
    mainstreamSuppression: round3(mainstreamSuppression),
    discoveryBoost: round3(discoveryBoost),
    intentElasticity: round3(intentElasticity),
    disableFastPath,
    minCandidateRatio: round3(minCandidateRatio),
    escapeDiversityRatio: round3(escapeDiversityRatio),
  };
}
