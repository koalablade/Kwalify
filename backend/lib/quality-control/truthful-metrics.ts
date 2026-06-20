/**
 * Truthful metric system — externally verifiable scoring from prompt + track metadata only.
 *
 * Rules:
 * - No locked intent, constraint layer, or pipeline diagnostics as inputs.
 * - Inactive dimensions return null (never inflated to 100).
 * - No audio-heuristic fallbacks when text evidence is absent.
 * - Negated genres are hard failures when present on tracks.
 */

import type { SurvivalTrack } from "../intent-survival-diagnostics";
import { extractPromptGroundTruth, type PromptGroundTruth } from "./prompt-ground-truth";

export type TruthfulMetricScores = {
  intentSurvival: number | null;
  genreSurvival: number | null;
  emotionSurvival: number | null;
  atmosphereSurvival: number | null;
  activitySurvival: number | null;
  subgenreSurvival: number | null;
  activeDimensions: string[];
  inactiveDimensions: string[];
  evidence: Record<string, unknown>;
};

export type TruthfulMetricInput = {
  prompt: string;
  tracks: SurvivalTrack[];
  groundTruth?: PromptGroundTruth;
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function trackFamilies(track: SurvivalTrack): string[] {
  const families = new Set<string>();
  for (const raw of [track.genreFamily, track.genrePrimary, ...(track.genres ?? [])]) {
    if (typeof raw === "string" && raw.trim()) {
      families.add(normalize(raw).replace(/\s+/g, "_"));
    }
  }
  return [...families];
}

function trackText(track: SurvivalTrack): string {
  return normalize([
    track.trackName,
    track.artistName,
    track.albumName,
    track.genrePrimary,
    track.genreFamily,
    ...(track.genres ?? []),
  ].filter((item): item is string => typeof item === "string").join(" "));
}

function roundPercent(matched: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((matched / total) * 100)));
}

function genreMatchesExpected(families: string[], expected: string[]): boolean {
  return expected.some((genre) =>
    families.some((family) => family === genre || family.includes(genre) || genre.includes(family)),
  );
}

function emotionAffinity(track: SurvivalTrack, emotion: string): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  const danceability = track.danceability ?? 0.5;
  const tempoNorm = Math.max(0, Math.min(1, ((track.tempo ?? 110) - 60) / 140));

  const table: Record<string, number> = {
    melancholy: (1 - valence) * 0.55 + (1 - energy) * 0.25 + acousticness * 0.2,
    nostalgia: acousticness * 0.35 + (track.releaseYear != null && track.releaseYear < 2010 ? 0.35 : 0.12) + (1 - energy) * 0.15,
    tension: (1 - valence) * 0.45 + energy * 0.28 + tempoNorm * 0.16,
    aggression: energy * 0.5 + tempoNorm * 0.22 + (1 - valence) * 0.2,
    peace: (1 - energy) * 0.45 + acousticness * 0.24 + valence * 0.16,
    euphoria: valence * 0.45 + energy * 0.32 + danceability * 0.18,
    loneliness: (1 - valence) * 0.35 + (1 - danceability) * 0.24 + acousticness * 0.16,
    longing: (1 - valence) * 0.35 + acousticness * 0.2 + (1 - energy) * 0.18,
  };
  return table[emotion] ?? 0;
}

function activityMatch(track: SurvivalTrack, activity: string): boolean {
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  if (activity === "driving") return energy >= 0.3 && tempo >= 72;
  if (activity === "focus") return energy <= 0.62 && (acousticness >= 0.2 || danceability <= 0.72);
  if (activity === "gym") return energy >= 0.55 || tempo >= 120;
  if (activity === "party") return energy >= 0.58 && danceability >= 0.52;
  if (activity === "relaxing") return energy <= 0.52 || acousticness >= 0.38;
  return false;
}

function scoreActiveDimension(
  tracks: SurvivalTrack[],
  predicate: (track: SurvivalTrack) => boolean,
): number | null {
  if (tracks.length === 0) return null;
  const matched = tracks.filter(predicate).length;
  return roundPercent(matched, tracks.length);
}

function negatedGenreViolation(track: SurvivalTrack, negations: string[]): boolean {
  if (negations.length === 0) return false;
  const families = trackFamilies(track);
  const text = trackText(track);
  return negations.some((neg) =>
    families.some((family) => family.includes(neg) || neg.includes(family))
    || text.includes(neg.replace(/_/g, " ")),
  );
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  genre: 1.25,
  subgenre: 1.2,
  emotion: 1.35,
  atmosphere: 0.9,
  activity: 1.0,
};

export function computeTruthfulMetrics(input: TruthfulMetricInput): TruthfulMetricScores {
  const groundTruth = input.groundTruth ?? extractPromptGroundTruth(input.prompt);
  const tracks = input.tracks;
  const activeDimensions: string[] = [];
  const inactiveDimensions: string[] = [];

  let genreSurvival: number | null = null;
  if (groundTruth.explicitGenres.length > 0) {
    activeDimensions.push("genre");
    const negViolations = tracks.filter((track) => negatedGenreViolation(track, groundTruth.explicitNegations)).length;
    const genreHits = tracks.filter((track) => genreMatchesExpected(trackFamilies(track), groundTruth.explicitGenres)).length;
    const effectiveHits = Math.max(0, genreHits - negViolations);
    genreSurvival = roundPercent(effectiveHits, tracks.length);
  } else {
    inactiveDimensions.push("genre");
  }

  let subgenreSurvival: number | null = null;
  if (groundTruth.explicitSubgenres.length > 0) {
    activeDimensions.push("subgenre");
    subgenreSurvival = scoreActiveDimension(tracks, (track) =>
      groundTruth.explicitSubgenres.some((term) => trackText(track).includes(term.replace(/_/g, " "))),
    );
  } else {
    inactiveDimensions.push("subgenre");
  }

  let emotionSurvival: number | null = null;
  if (groundTruth.explicitEmotions.length > 0) {
    activeDimensions.push("emotion");
    const dominant = groundTruth.explicitEmotions[0]!;
    emotionSurvival = scoreActiveDimension(tracks, (track) => emotionAffinity(track, dominant) >= 0.48);
  } else {
    inactiveDimensions.push("emotion");
  }

  let atmosphereSurvival: number | null = null;
  if (groundTruth.explicitAtmospheres.length > 0) {
    activeDimensions.push("atmosphere");
    atmosphereSurvival = scoreActiveDimension(tracks, (track) => {
      const text = trackText(track);
      return groundTruth.explicitAtmospheres.some((atmosphere) => text.includes(atmosphere.replace(/_/g, " ")));
    });
  } else {
    inactiveDimensions.push("atmosphere");
  }

  let activitySurvival: number | null = null;
  if (groundTruth.explicitActivities.length > 0) {
    activeDimensions.push("activity");
    const activity = groundTruth.explicitActivities[0]!;
    activitySurvival = scoreActiveDimension(tracks, (track) => activityMatch(track, activity));
  } else {
    inactiveDimensions.push("activity");
  }

  const scoredEntries = [
    ["genre", genreSurvival],
    ["subgenre", subgenreSurvival],
    ["emotion", emotionSurvival],
    ["atmosphere", atmosphereSurvival],
    ["activity", activitySurvival],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");

  let intentSurvival: number | null = null;
  if (scoredEntries.length > 0) {
    const totalWeight = scoredEntries.reduce((sum, [dim]) => sum + (DIMENSION_WEIGHTS[dim] ?? 1), 0);
    intentSurvival = Math.round(
      scoredEntries.reduce((sum, [dim, score]) => sum + score * (DIMENSION_WEIGHTS[dim] ?? 1), 0) / totalWeight,
    );
  }

  return {
    intentSurvival,
    genreSurvival,
    emotionSurvival,
    atmosphereSurvival,
    activitySurvival,
    subgenreSurvival,
    activeDimensions,
    inactiveDimensions,
    evidence: {
      groundTruth,
      trackCount: tracks.length,
      scoringVersion: "truthful-metrics-v1",
      rules: [
        "prompt_text_only_expectations",
        "inactive_dimensions_null_not_100",
        "no_pipeline_locked_intent",
        "no_atmosphere_mood_fallback",
        "negation_violations_penalize_genre",
      ],
    },
  };
}
