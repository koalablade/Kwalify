/**
 * Genre taxonomy — family backbone + classification API.
 */

import { GENRE_FAMILIES, type SubgenreDef } from "./genre-taxonomy-data";

export type RootGenre =
  | "country"
  | "hip_hop"
  | "rock"
  | "electronic"
  | "jazz"
  | "pop"
  | "folk"
  | "soul"
  | "metal"
  | "classical"
  | "christmas"
  | "indie"
  | "blues"
  | "rnb"
  | "reggae"
  | "latin"
  | "soundtrack"
  | "world"
  | "unknown";

export interface GenreTaxon {
  root: RootGenre;
  subgenre: string;
  microStyles: string[];
  patterns: RegExp[];
  artistHints?: RegExp;
}

export interface TrackGenreClassification {
  genrePrimary: RootGenre;
  genreSecondary: RootGenre | null;
  subGenres: string[];
  microStyle: string | null;
  confidenceScore: number;
  holidayBound: boolean;
  genreFamily: RootGenre;
  /** Primary subgenre id (not just family) */
  primarySubgenre: string;
  secondarySubgenre: string | null;
}

/** API alias per product spec */
export interface TrackGenreProfile {
  primary: string;
  secondary: string | null;
  subGenres: string[];
  confidence: number;
  genreFamily: RootGenre;
  genrePrimary: RootGenre;
  genreSecondary: RootGenre | null;
  holidayBound: boolean;
}

function buildTaxonomy(): GenreTaxon[] {
  const out: GenreTaxon[] = [];
  for (const fam of GENRE_FAMILIES) {
    for (const sub of fam.subgenres) {
      out.push({
        root: fam.family,
        subgenre: sub.id,
        microStyles: sub.microStyles,
        patterns: sub.patterns.map((p) => new RegExp(p, "i")),
        artistHints: sub.artistHints
          ? new RegExp(sub.artistHints.join("|"), "i")
          : undefined,
      });
    }
  }
  return out;
}

export const TAXONOMY: GenreTaxon[] = buildTaxonomy();

export const ALL_ROOT_GENRES: RootGenre[] = [
  "country",
  "hip_hop",
  "rock",
  "electronic",
  "jazz",
  "pop",
  "folk",
  "soul",
  "metal",
  "classical",
  "christmas",
  "indie",
  "blues",
  "rnb",
  "reggae",
  "latin",
  "soundtrack",
  "world",
];

export const GENRE_LOCK_THRESHOLD = 0.72;

export function toGenreProfile(c: TrackGenreClassification): TrackGenreProfile {
  return {
    primary: c.primarySubgenre,
    secondary: c.secondarySubgenre,
    subGenres: c.subGenres,
    confidence: c.confidenceScore,
    genreFamily: c.genreFamily,
    genrePrimary: c.genrePrimary,
    genreSecondary: c.genreSecondary,
    holidayBound: c.holidayBound,
  };
}

export function classifyTrack(
  track: {
    trackName: string;
    artistName: string;
    albumName: string;
    energy?: number | null;
    valence?: number | null;
    acousticness?: number | null;
    danceability?: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
    tempo?: number | null;
  },
  vibeGenreHints?: string[]
): TrackGenreClassification {
  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const hits: { taxon: GenreTaxon; score: number; micro: string | null }[] = [];

  for (const taxon of TAXONOMY) {
    let score = 0;
    let micro: string | null = null;
    for (const p of taxon.patterns) {
      if (p.test(blob)) score += 0.42;
    }
    for (const m of taxon.microStyles) {
      if (blob.toLowerCase().includes(m.toLowerCase())) {
        score += 0.34;
        micro = m;
      }
    }
    if (taxon.artistHints?.test(blob)) score += 0.52;
    if (score > 0) hits.push({ taxon, score, micro });
  }

  for (const hint of vibeGenreHints ?? []) {
    const t = TAXONOMY.find((x) => x.root === hint || x.subgenre === hint);
    if (t) hits.push({ taxon: t, score: 0.38, micro: null });
  }

  applyAudioGenreHeuristics(track, hits);
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0];
  const second = hits[1];

  if (!top) {
    const inferred = inferGenreFromAudioOnly(track);
    if (inferred) return inferred;
    return emptyClassification();
  }

  const confidence = Math.min(1, top.score / 1.15);
  const subGenres = [top.taxon.subgenre, ...(top.micro ? [top.micro] : [])];
  if (second && second.score > 0.32) {
    subGenres.push(second.taxon.subgenre);
    if (second.micro) subGenres.push(second.micro);
  }

  return {
    genrePrimary: top.taxon.root,
    genreFamily: top.taxon.root,
    genreSecondary: second && second.score > 0.32 ? second.taxon.root : null,
    primarySubgenre: top.taxon.subgenre,
    secondarySubgenre: second && second.score > 0.32 ? second.taxon.subgenre : null,
    subGenres: [...new Set(subGenres)],
    microStyle: top.micro,
    confidenceScore: confidence,
    holidayBound: top.taxon.root === "christmas",
  };
}

function inferGenreFromAudioOnly(track: {
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  speechiness?: number | null;
}): TrackGenreClassification | null {
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;
  let root: RootGenre = "indie";
  let sub = "indie_rock";
  if (sp > 0.4 && e > 0.45) {
    root = "hip_hop";
    sub = "trap";
  } else if (d > 0.72 && e > 0.6) {
    root = "electronic";
    sub = "house";
  } else if (a > 0.55 && e < 0.5 && (track.valence ?? 0.5) < 0.55) {
    root = "country";
    sub = "folk_country";
  } else if (a > 0.5 && (track.valence ?? 0.5) >= 0.58) {
    root = "indie";
    sub = "indie_pop";
  } else if (e > 0.75) {
    root = "rock";
    sub = "classic_rock";
  } else if (a > 0.5 && (track.valence ?? 0.5) < 0.45) {
    root = "jazz";
    sub = "smooth_jazz";
  }
  return {
    genrePrimary: root,
    genreFamily: root,
    genreSecondary: null,
    primarySubgenre: sub,
    secondarySubgenre: null,
    subGenres: [sub],
    microStyle: null,
    confidenceScore: 0.38,
    holidayBound: false,
  };
}

function emptyClassification(): TrackGenreClassification {
  return {
    genrePrimary: "unknown",
    genreFamily: "unknown",
    genreSecondary: null,
    primarySubgenre: "unknown",
    secondarySubgenre: null,
    subGenres: [],
    microStyle: null,
    confidenceScore: 0.22,
    holidayBound: false,
  };
}

function applyAudioGenreHeuristics(
  track: {
    energy?: number | null;
    valence?: number | null;
    acousticness?: number | null;
    danceability?: number | null;
    speechiness?: number | null;
    instrumentalness?: number | null;
  },
  hits: { taxon: GenreTaxon; score: number; micro: string | null }[]
): void {
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;
  const inst = track.instrumentalness ?? 0.1;

  const v = track.valence ?? 0.5;
  const sunnyAcoustic = v >= 0.58 && a > 0.45 && e >= 0.35 && e <= 0.78;

  if (a > 0.58 && e < 0.55 && d < 0.6) {
    if (sunnyAcoustic) {
      pushHit(hits, "indie", "indie_pop", 0.36, "bright acoustic indie");
      pushHit(hits, "folk", "singer_songwriter", 0.22, null);
    } else {
      pushHit(hits, "country", "folk_country", 0.38, "acoustic country lean");
      pushHit(hits, "folk", "singer_songwriter", 0.18, null);
    }
  }
  if (
    a > 0.52 &&
    a < 0.88 &&
    e >= 0.35 &&
    e <= 0.72 &&
    (track.speechiness ?? 0.2) < 0.28
  ) {
    if (sunnyAcoustic) {
      pushHit(hits, "indie", "indie_folk", 0.3, "warm acoustic indie");
      pushHit(hits, "pop", "indie_pop", 0.18, null);
    } else {
      pushHit(hits, "country", "alt_country", 0.32, "storytelling acoustic");
      pushHit(hits, "country", "modern_country", 0.24, null);
    }
  }
  if (sp > 0.38 && e > 0.42) pushHit(hits, "hip_hop", "trap", 0.34, null);
  if (d > 0.72 && e > 0.62) {
    pushHit(hits, "electronic", "house", 0.28, null);
    pushHit(hits, "pop", "dance_pop", 0.2, null);
  }
  if (e < 0.32 && a > 0.45) pushHit(hits, "jazz", "smooth_jazz", 0.22, null);
  if (inst > 0.55 && e < 0.45) pushHit(hits, "electronic", "ambient", 0.25, null);
  if (e > 0.78 && (track.valence ?? 0.5) < 0.4) pushHit(hits, "metal", "metalcore", 0.28, null);
}

function pushHit(
  hits: { taxon: GenreTaxon; score: number; micro: string | null }[],
  root: RootGenre,
  subgenre: string,
  score: number,
  micro: string | null
): void {
  const taxon = TAXONOMY.find((t) => t.root === root && t.subgenre === subgenre) ?? TAXONOMY.find((t) => t.root === root);
  if (!taxon) return;
  const existing = hits.find((h) => h.taxon.subgenre === taxon.subgenre);
  if (existing) existing.score += score;
  else hits.push({ taxon, score, micro });
}

export function isGenreLocked(classification: TrackGenreClassification): boolean {
  return classification.confidenceScore >= GENRE_LOCK_THRESHOLD;
}

export function genreLockWeight(classification: TrackGenreClassification): number {
  if (!isGenreLocked(classification)) return 0;
  return 0.6;
}

export function profileToClassification(p: TrackGenreProfile): TrackGenreClassification {
  return {
    genrePrimary: p.genrePrimary,
    genreFamily: p.genreFamily,
    genreSecondary: p.genreSecondary,
    primarySubgenre: p.primary,
    secondarySubgenre: p.secondary,
    subGenres: p.subGenres,
    microStyle: p.subGenres[1] ?? null,
    confidenceScore: p.confidence,
    holidayBound: p.holidayBound,
  };
}

export function listSubgenresForFamily(family: RootGenre): string[] {
  const def = GENRE_FAMILIES.find((f) => f.family === family);
  return def?.subgenres.map((s) => s.id) ?? [];
}
