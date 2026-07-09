/**
 * Deterministic audio-feature inference when Spotify /audio-features is unavailable.
 * Uses genre taxonomy + track/artist metadata only — enrichment pipeline fallback.
 */

import { classifyTrack, type RootGenre } from "./genre-taxonomy";
import type { SpotifyAudioFeatures } from "./spotify";

export type MetadataAudioFeatureInput = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  popularity?: number | null;
  durationMs?: number | null;
};

type AudioPrior = {
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  loudness: number;
};

const GENRE_PRIORS: Record<RootGenre, AudioPrior> = {
  metal: { energy: 0.88, valence: 0.32, tempo: 138, danceability: 0.42, acousticness: 0.08, instrumentalness: 0.12, speechiness: 0.06, loudness: -6 },
  rock: { energy: 0.72, valence: 0.48, tempo: 125, danceability: 0.48, acousticness: 0.15, instrumentalness: 0.05, speechiness: 0.05, loudness: -8 },
  hip_hop: { energy: 0.68, valence: 0.46, tempo: 118, danceability: 0.78, acousticness: 0.12, instrumentalness: 0.02, speechiness: 0.28, loudness: -7 },
  electronic: { energy: 0.74, valence: 0.5, tempo: 126, danceability: 0.72, acousticness: 0.08, instrumentalness: 0.42, speechiness: 0.05, loudness: -8 },
  pop: { energy: 0.66, valence: 0.58, tempo: 118, danceability: 0.68, acousticness: 0.18, instrumentalness: 0.02, speechiness: 0.06, loudness: -7 },
  rnb: { energy: 0.58, valence: 0.52, tempo: 102, danceability: 0.68, acousticness: 0.22, instrumentalness: 0.02, speechiness: 0.1, loudness: -8 },
  soul: { energy: 0.6, valence: 0.56, tempo: 108, danceability: 0.66, acousticness: 0.28, instrumentalness: 0.02, speechiness: 0.08, loudness: -9 },
  jazz: { energy: 0.42, valence: 0.48, tempo: 112, danceability: 0.48, acousticness: 0.45, instrumentalness: 0.35, speechiness: 0.05, loudness: -12 },
  classical: { energy: 0.22, valence: 0.42, tempo: 88, danceability: 0.22, acousticness: 0.88, instrumentalness: 0.82, speechiness: 0.03, loudness: -16 },
  folk: { energy: 0.38, valence: 0.5, tempo: 104, danceability: 0.42, acousticness: 0.72, instrumentalness: 0.08, speechiness: 0.05, loudness: -12 },
  country: { energy: 0.58, valence: 0.56, tempo: 112, danceability: 0.58, acousticness: 0.48, instrumentalness: 0.02, speechiness: 0.05, loudness: -9 },
  indie: { energy: 0.52, valence: 0.46, tempo: 116, danceability: 0.52, acousticness: 0.38, instrumentalness: 0.08, speechiness: 0.05, loudness: -10 },
  blues: { energy: 0.48, valence: 0.4, tempo: 108, danceability: 0.46, acousticness: 0.42, instrumentalness: 0.12, speechiness: 0.06, loudness: -11 },
  reggae: { energy: 0.55, valence: 0.62, tempo: 98, danceability: 0.72, acousticness: 0.22, instrumentalness: 0.04, speechiness: 0.08, loudness: -9 },
  latin: { energy: 0.68, valence: 0.64, tempo: 118, danceability: 0.78, acousticness: 0.18, instrumentalness: 0.03, speechiness: 0.08, loudness: -8 },
  soundtrack: { energy: 0.45, valence: 0.44, tempo: 102, danceability: 0.35, acousticness: 0.42, instrumentalness: 0.55, speechiness: 0.04, loudness: -12 },
  world: { energy: 0.52, valence: 0.52, tempo: 108, danceability: 0.55, acousticness: 0.45, instrumentalness: 0.2, speechiness: 0.06, loudness: -11 },
  christmas: { energy: 0.58, valence: 0.68, tempo: 112, danceability: 0.55, acousticness: 0.42, instrumentalness: 0.05, speechiness: 0.05, loudness: -9 },
  unknown: { energy: 0.52, valence: 0.48, tempo: 112, danceability: 0.52, acousticness: 0.32, instrumentalness: 0.1, speechiness: 0.06, loudness: -10 },
};

const SUBGENRE_MODIFIERS: Record<string, Partial<AudioPrior>> = {
  pop_punk: { energy: 0.84, valence: 0.5, tempo: 156, danceability: 0.52 },
  punk_rock: { energy: 0.86, valence: 0.42, tempo: 160, danceability: 0.44 },
  trap: { energy: 0.62, valence: 0.38, tempo: 138, danceability: 0.76, speechiness: 0.32 },
  drill: { energy: 0.7, valence: 0.34, tempo: 142, danceability: 0.74, speechiness: 0.3 },
  house: { energy: 0.78, valence: 0.58, tempo: 124, danceability: 0.82, instrumentalness: 0.55 },
  techno: { energy: 0.82, valence: 0.46, tempo: 132, danceability: 0.78, instrumentalness: 0.62 },
  ambient: { energy: 0.18, valence: 0.42, tempo: 82, danceability: 0.28, acousticness: 0.35, instrumentalness: 0.72 },
  lo_fi: { energy: 0.28, valence: 0.44, tempo: 86, danceability: 0.42, acousticness: 0.55, instrumentalness: 0.35 },
  singer_songwriter: { energy: 0.34, valence: 0.42, tempo: 96, danceability: 0.38, acousticness: 0.72, speechiness: 0.04 },
  disco: { energy: 0.74, valence: 0.72, tempo: 118, danceability: 0.8 },
  garage: { energy: 0.76, valence: 0.54, tempo: 132, danceability: 0.78 },
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hashUnit(seed: string, salt: string): number {
  let h = 2166136261;
  const text = `${seed}\u0001${salt}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function spread(seed: string, salt: string, span: number): number {
  return (hashUnit(seed, salt) - 0.5) * 2 * span;
}

function applyTextModifiers(prior: AudioPrior, text: string): AudioPrior {
  const out = { ...prior };
  if (/\b(acoustic|unplugged|piano)\b/i.test(text)) {
    out.energy -= 0.12;
    out.acousticness += 0.22;
    out.danceability -= 0.08;
    out.tempo -= 12;
  }
  if (/\b(remix|club\s+mix|edit|extended)\b/i.test(text)) {
    out.energy += 0.08;
    out.danceability += 0.12;
    out.tempo += 8;
  }
  if (/\b(ballad|slow|lullaby|sleep)\b/i.test(text)) {
    out.energy -= 0.18;
    out.valence -= 0.06;
    out.tempo -= 18;
    out.danceability -= 0.12;
  }
  if (/\b(live|concert)\b/i.test(text)) {
    out.energy += 0.06;
    out.loudness += 2;
    out.acousticness -= 0.05;
  }
  if (/\b(instrumental|suite|overture|sonata)\b/i.test(text)) {
    out.instrumentalness = Math.max(out.instrumentalness, 0.72);
    out.speechiness = Math.min(out.speechiness, 0.04);
  }
  if (/\b(workout|gym|pump|hype|beast)\b/i.test(text)) {
    out.energy += 0.14;
    out.tempo += 10;
    out.danceability += 0.08;
  }
  return out;
}

function mergePrior(base: AudioPrior, patch: Partial<AudioPrior>): AudioPrior {
  return {
    energy: patch.energy ?? base.energy,
    valence: patch.valence ?? base.valence,
    tempo: patch.tempo ?? base.tempo,
    danceability: patch.danceability ?? base.danceability,
    acousticness: patch.acousticness ?? base.acousticness,
    instrumentalness: patch.instrumentalness ?? base.instrumentalness,
    speechiness: patch.speechiness ?? base.speechiness,
    loudness: patch.loudness ?? base.loudness,
  };
}

export function inferMetadataAudioFeatures(input: MetadataAudioFeatureInput): SpotifyAudioFeatures {
  const classification = classifyTrack({
    trackName: input.trackName,
    artistName: input.artistName,
    albumName: input.albumName ?? "",
    spotifyArtistGenres: input.spotifyArtistGenres,
    albumGenres: input.albumGenres,
  });

  const family = classification.genreFamily in GENRE_PRIORS ? classification.genreFamily : "unknown";
  let prior = { ...GENRE_PRIORS[family] };
  const subMod = SUBGENRE_MODIFIERS[classification.primarySubgenre];
  if (subMod) prior = mergePrior(prior, subMod);

  const text = `${input.trackName} ${input.artistName} ${input.albumName ?? ""}`;
  prior = applyTextModifiers(prior, text);

  const pop = typeof input.popularity === "number" ? input.popularity / 100 : 0.5;
  prior.energy += (pop - 0.5) * 0.08;
  prior.danceability += (pop - 0.5) * 0.06;

  const durationMs = input.durationMs ?? 210_000;
  if (durationMs > 300_000) {
    prior.energy -= 0.04;
    prior.instrumentalness += 0.05;
  } else if (durationMs < 150_000) {
    prior.energy += 0.04;
    prior.danceability += 0.03;
  }

  const id = input.trackId;
  return {
    id,
    energy: clamp01(prior.energy + spread(id, "energy", 0.1)),
    valence: clamp01(prior.valence + spread(id, "valence", 0.1)),
    tempo: Math.max(60, Math.min(200, prior.tempo + spread(id, "tempo", 14))),
    danceability: clamp01(prior.danceability + spread(id, "danceability", 0.1)),
    acousticness: clamp01(prior.acousticness + spread(id, "acousticness", 0.1)),
    instrumentalness: clamp01(prior.instrumentalness + spread(id, "instrumentalness", 0.12)),
    speechiness: clamp01(prior.speechiness + spread(id, "speechiness", 0.08)),
    loudness: Math.max(-24, Math.min(-2, prior.loudness + spread(id, "loudness", 3))),
  };
}
