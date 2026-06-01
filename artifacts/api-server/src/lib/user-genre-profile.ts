/**
 * User genre vector — taste backbone from full liked library.
 */

import { classifyTrack, type RootGenre, type TrackGenreClassification } from "./genre-taxonomy";

export type UserGenreVector = Partial<Record<RootGenre, number>>;

export interface UserGenreProfile {
  vector: UserGenreVector;
  dominant: RootGenre[];
  totalClassified: number;
  trackClassifications: Map<string, TrackGenreClassification>;
}

const VECTOR_KEYS: RootGenre[] = [
  "country",
  "hip_hop",
  "rock",
  "electronic",
  "jazz",
  "pop",
  "folk",
  "soul",
  "indie",
  "metal",
  "christmas",
  "classical",
];

export function buildUserGenreProfile(
  tracks: {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    energy: number | null;
    valence: number | null;
    acousticness: number | null;
    danceability: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
    tempo?: number | null;
  }[],
  vibe?: string
): UserGenreProfile {
  const vibeHints = extractVibeGenreHints(vibe ?? "");
  const counts: Partial<Record<RootGenre, number>> = {};
  const trackClassifications = new Map<string, TrackGenreClassification>();
  let totalClassified = 0;

  for (const t of tracks) {
    const c = classifyTrack(t, vibeHints);
    trackClassifications.set(t.trackId, c);
    if (c.genrePrimary === "unknown" && c.confidenceScore < 0.35) continue;
    totalClassified++;
    const w = c.confidenceScore;
    counts[c.genrePrimary] = (counts[c.genrePrimary] ?? 0) + w;
    if (c.genreSecondary) {
      counts[c.genreSecondary] = (counts[c.genreSecondary] ?? 0) + w * 0.45;
    }
  }

  const sum = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const vector: UserGenreVector = {};
  for (const k of VECTOR_KEYS) {
    vector[k] = (counts[k] ?? 0) / sum;
  }

  const dominant = [...VECTOR_KEYS]
    .sort((a, b) => (vector[b] ?? 0) - (vector[a] ?? 0))
    .filter((k) => (vector[k] ?? 0) >= 0.06)
    .slice(0, 5);

  return { vector, dominant, totalClassified, trackClassifications };
}

function extractVibeGenreHints(vibe: string): string[] {
  const lower = vibe.toLowerCase();
  const hints: string[] = [];
  if (/\b(country|americana|honky|nashville|bluegrass)\b/.test(lower)) hints.push("country");
  if (/\b(rap|hip hop|hip-hop|trap|drill)\b/.test(lower)) hints.push("hip_hop");
  if (/\b(rock|metal|punk|grunge)\b/.test(lower)) hints.push("rock");
  if (/\b(electronic|edm|house|techno|synth)\b/.test(lower)) hints.push("electronic");
  if (/\b(jazz|soul|motown|r&b|funk)\b/.test(lower)) hints.push("soul");
  if (/\b(folk|acoustic|singer-songwriter)\b/.test(lower)) hints.push("folk");
  if (/\b(pop|indie pop)\b/.test(lower)) hints.push("pop");
  if (/\b(christmas|xmas|holiday)\b/.test(lower)) hints.push("christmas");
  return hints;
}

export function libraryFitScore(
  classification: TrackGenreClassification,
  userVector: UserGenreVector
): number {
  const primary = userVector[classification.genrePrimary] ?? 0.02;
  const secondary = classification.genreSecondary
    ? (userVector[classification.genreSecondary] ?? 0) * 0.5
    : 0;
  const conf = 0.35 + classification.confidenceScore * 0.4;
  return Math.min(1, primary * 2.2 + secondary + conf * 0.25);
}
