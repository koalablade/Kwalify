/**
 * Genre detection pipeline — weighted multi-signal inference (deterministic).
 *
 * Signals: metadata text, artist history, audio features, user library bias.
 */

import {
  classifyTrack,
  type RootGenre,
  type TrackGenreClassification,
  type TrackGenreProfile,
  toGenreProfile,
} from "./genre-taxonomy";
import type { UserGenreVector } from "./user-genre-profile";
import { applyCountryClassificationBias } from "../core/genre-intelligence/country-scoring";

const WEIGHTS = {
  metadata: 0.35,
  artistHistory: 0.35,
  audio: 0.2,
  userBias: 0.1,
} as const;

export interface ArtistGenreHistory {
  /** Dominant family for this artist */
  family: RootGenre;
  subgenre: string;
  weight: number;
  trackCount: number;
}

export interface GenreDetectionContext {
  userVector: UserGenreVector;
  artistHistory: Map<string, ArtistGenreHistory>;
  vibeHints: string[];
}

type TrackInput = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
};

export function buildArtistGenreHistory(
  tracks: TrackInput[],
  baseClassifications?: Map<string, TrackGenreClassification>
): Map<string, ArtistGenreHistory> {
  const byArtist = new Map<string, { families: Record<string, number>; subs: Record<string, number>; count: number }>();

  for (const t of tracks) {
    const c =
      baseClassifications?.get(t.trackId) ??
      classifyTrack(t);
    const key = t.artistName.toLowerCase().trim();
    if (!key) continue;
    const bucket = byArtist.get(key) ?? { families: {}, subs: {}, count: 0 };
    bucket.families[c.genreFamily] = (bucket.families[c.genreFamily] ?? 0) + c.confidenceScore;
    bucket.subs[c.primarySubgenre] = (bucket.subs[c.primarySubgenre] ?? 0) + c.confidenceScore;
    bucket.count++;
    byArtist.set(key, bucket);
  }

  const out = new Map<string, ArtistGenreHistory>();
  for (const [artist, bucket] of byArtist) {
    const topFamily = topKey(bucket.families);
    const topSub = topKey(bucket.subs);
    if (!topFamily) continue;
    out.set(artist, {
      family: topFamily as RootGenre,
      subgenre: topSub ?? topFamily,
      weight: Math.min(1, (bucket.families[topFamily] ?? 0) / bucket.count),
      trackCount: bucket.count,
    });
  }
  return out;
}

function topKey(rec: Record<string, number>): string | null {
  let best: string | null = null;
  let bestV = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best;
}

function scoreAudioFamily(track: TrackInput, family: RootGenre): number {
  const presentAudioFields = [
    track.acousticness,
    track.energy,
    track.danceability,
    track.speechiness,
    track.instrumentalness,
    track.valence,
  ].filter((value) => typeof value === "number").length;
  if (presentAudioFields < 2) return 0;

  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;
  const inst = track.instrumentalness ?? 0.1;

  switch (family) {
    case "country":
    case "folk":
      return clamp01(a * 0.5 + (1 - e) * 0.25 + (1 - d) * 0.15);
    case "hip_hop":
      return clamp01(sp * 0.55 + d * 0.25 + e * 0.15);
    case "electronic":
    case "pop":
      return clamp01(d * 0.45 + e * 0.35 + (1 - a) * 0.15);
    case "metal":
      return clamp01(e * 0.5 + (1 - (track.valence ?? 0.5)) * 0.3);
    case "jazz":
    case "classical":
      return clamp01(a * 0.35 + inst * 0.35 + (1 - sp) * 0.2);
    case "soundtrack":
      return clamp01(inst * 0.45 + a * 0.3 + (1 - sp) * 0.15);
    default:
      return 0.4;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Full pipeline — never single-tag */
export function detectTrackGenre(
  track: TrackInput,
  ctx: GenreDetectionContext
): TrackGenreProfile {
  const meta = classifyTrack(track, ctx.vibeHints);
  const familyScores: Partial<Record<RootGenre, number>> = {};

  const add = (family: RootGenre, sub: string, w: number) => {
    familyScores[family] = (familyScores[family] ?? 0) + w;
    if (family === meta.genreFamily) {
      /* keep meta subgenre lead */
    }
  };

  add(meta.genreFamily, meta.primarySubgenre, meta.confidenceScore * WEIGHTS.metadata);

  const artistKey = track.artistName.toLowerCase().trim();
  const ah = ctx.artistHistory.get(artistKey);
  if (ah && ah.weight > 0.25) {
    add(ah.family, ah.subgenre, ah.weight * WEIGHTS.artistHistory);
  }

  for (const family of Object.keys(familyScores) as RootGenre[]) {
    const audio = scoreAudioFamily(track, family);
    familyScores[family] = (familyScores[family] ?? 0) + audio * WEIGHTS.audio;
  }
  if (!familyScores[meta.genreFamily]) {
    familyScores[meta.genreFamily] = scoreAudioFamily(track, meta.genreFamily) * WEIGHTS.audio;
  }

  const userShare = ctx.userVector[meta.genreFamily] ?? 0.02;
  familyScores[meta.genreFamily] = (familyScores[meta.genreFamily] ?? 0) + userShare * WEIGHTS.userBias * 3;

  let bestFamily: RootGenre = meta.genreFamily;
  let bestScore = 0;
  for (const [fam, sc] of Object.entries(familyScores) as [RootGenre, number][]) {
    if (sc > bestScore) {
      bestScore = sc;
      bestFamily = fam;
    }
  }

  const confidence = Math.min(1, bestScore / 0.85);
  const merged: TrackGenreClassification = {
    ...meta,
    genrePrimary: bestFamily,
    genreFamily: bestFamily,
    confidenceScore: Math.max(meta.confidenceScore * 0.4, confidence),
    genreSecondary:
      meta.genreFamily !== bestFamily ? meta.genreFamily : meta.genreSecondary,
    secondarySubgenre:
      meta.genreFamily !== bestFamily ? meta.primarySubgenre : meta.secondarySubgenre,
  };

  if (ah && ah.family === bestFamily) {
    merged.primarySubgenre = ah.subgenre;
    if (!merged.subGenres.includes(ah.subgenre)) merged.subGenres.unshift(ah.subgenre);
  }

  merged.holidayBound = merged.genreFamily === "christmas" || meta.holidayBound;

  return toGenreProfile(
    applyCountryClassificationBias(merged, {
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName,
      energy: track.energy,
      valence: track.valence,
      acousticness: track.acousticness,
      danceability: track.danceability,
      speechiness: track.speechiness ?? null,
      tempo: track.tempo ?? null,
    })
  );
}

export function detectLibraryGenres(
  tracks: TrackInput[],
  vibe?: string
): {
  classifications: Map<string, TrackGenreProfile>;
  artistHistory: Map<string, ArtistGenreHistory>;
  userVector: UserGenreVector;
} {
  const t0 = Date.now();
  // Library genre profiles must describe tracks, not the current prompt.
  // Prompt hints are applied later during retrieval/scoring; using them here
  // can relabel unrelated artists as the requested genre.
  const vibeHints: string[] = [];
  const pass1 = new Map<string, TrackGenreClassification>();
  for (const t of tracks) {
    pass1.set(t.trackId, classifyTrack(t, vibeHints));
  }

  const artistHistory = buildArtistGenreHistory(tracks, pass1);
  const counts: Partial<Record<RootGenre, number>> = {};
  for (const c of pass1.values()) {
    if (c.genreFamily === "unknown") continue;
    counts[c.genreFamily] = (counts[c.genreFamily] ?? 0) + c.confidenceScore;
  }
  const sum1 = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const userVector: UserGenreVector = {};
  for (const [fam, n] of Object.entries(counts) as [RootGenre, number][]) {
    userVector[fam] = n / sum1;
  }

  const classifications = new Map<string, TrackGenreProfile>();
  for (const t of tracks) {
    classifications.set(
      t.trackId,
      detectTrackGenre(t, { userVector, artistHistory, vibeHints })
    );
  }

  console.info("[generate-timing] detectLibraryGenres", {
    ms: Date.now() - t0,
    trackCount: tracks.length,
  });
  return { classifications, artistHistory, userVector };
}

function extractVibeHints(vibe: string): string[] {
  const lower = vibe.toLowerCase();
  const hints: string[] = [];
  if (/\b(country|americana|bluegrass|honky|nashville|road trip|highway|outlaw)\b/.test(lower)) {
    hints.push("country");
  }
  if (/\b(afrobeat|afrobeats|amapiano|highlife)\b/.test(lower)) hints.push("world", "latin");
  if (/\b(rap|hip hop|trap|drill)\b/.test(lower)) hints.push("hip_hop");
  if (/\b(rock|metal|punk|emo)\b/.test(lower)) hints.push("rock");
  if (/\b(electronic|house|techno|dnb|trance)\b/.test(lower)) hints.push("electronic");
  if (/\b(jazz|blues|soul|funk|motown)\b/.test(lower)) hints.push("jazz");
  if (/\b(r&b|rnb)\b/.test(lower)) hints.push("rnb");
  if (/\b(reggae|dancehall|dub)\b/.test(lower)) hints.push("reggae");
  if (/\b(reggaeton|latin|salsa|bachata)\b/.test(lower)) hints.push("latin");
  if (/\b(folk|acoustic|singer-songwriter)\b/.test(lower)) hints.push("folk");
  if (/\b(pop|indie pop)\b/.test(lower)) hints.push("pop");
  if (/\b(soundtrack|cinematic|film score)\b/.test(lower)) hints.push("soundtrack");
  if (/\b(afrobeats|k-pop|world music)\b/.test(lower)) hints.push("world");
  if (/\b(christmas|xmas|holiday)\b/.test(lower)) hints.push("christmas");
  return hints;
}
