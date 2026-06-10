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

export interface ClassificationDiagnostics {
  /** True if at least one text pattern, micro-style, or artist hint matched */
  taxonomyHit: boolean;
  /** The artistHints regex source that matched for the winning taxon, if any */
  artistHintMatched: string | null;
  /** The first text pattern or micro-style that matched for the winning taxon, if any */
  patternMatched: string | null;
  /** True if the winning classification came from audio signals only (no text match) */
  audioFallbackUsed: boolean;
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
  diagnostics?: ClassificationDiagnostics;
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
  diagnostics?: ClassificationDiagnostics;
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
    diagnostics: c.diagnostics,
  };
}

const SPOTIFY_GENRE_ROOT_TERMS: Record<RootGenre, string[]> = {
  country: ["country", "americana", "red dirt", "outlaw country", "honky tonk", "bluegrass", "nashville"],
  hip_hop: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "g-funk", "emo rap"],
  rock: ["rock", "new wave", "post-punk", "punk", "grunge", "psychedelic", "album rock"],
  electronic: ["electronic", "edm", "house", "techno", "trance", "dnb", "drum and bass", "dubstep"],
  jazz: ["jazz", "bebop", "swing", "bossa nova"],
  pop: ["pop", "dance pop", "synthpop", "new wave pop"],
  folk: ["folk", "singer-songwriter", "singer songwriter"],
  soul: ["soul", "funk", "motown"],
  metal: ["metal", "metalcore", "deathcore", "thrash"],
  classical: ["classical", "orchestral", "opera", "baroque"],
  christmas: ["christmas", "holiday"],
  indie: ["indie", "lo-fi", "bedroom pop", "alternative indie"],
  blues: ["blues"],
  rnb: ["r&b", "rnb", "neo soul"],
  reggae: ["reggae", "dancehall", "dub", "rocksteady"],
  latin: ["latin", "reggaeton", "salsa", "bachata", "cumbia"],
  soundtrack: ["soundtrack", "score", "ost", "film score"],
  world: ["afrobeats", "afrobeat", "amapiano", "world", "k-pop", "bollywood"],
  unknown: [],
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function spotifyGenreRoot(track: {
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}): RootGenre | null {
  const values = [...stringArray(track.spotifyArtistGenres), ...stringArray(track.albumGenres)]
    .map((value) => value.toLowerCase());
  if (values.length === 0) return null;
  for (const [root, terms] of Object.entries(SPOTIFY_GENRE_ROOT_TERMS) as [RootGenre, string[]][]) {
    if (root === "unknown") continue;
    if (values.some((value) => terms.some((term) => value.includes(term)))) {
      return root;
    }
  }
  return null;
}

function classificationFromRoot(root: RootGenre): TrackGenreClassification {
  const taxon = TAXONOMY.find((item) => item.root === root);
  return {
    genrePrimary: root,
    genreFamily: root,
    genreSecondary: null,
    primarySubgenre: taxon?.subgenre ?? root,
    secondarySubgenre: null,
    subGenres: [taxon?.subgenre ?? root],
    microStyle: taxon?.microStyles[0] ?? null,
    confidenceScore: 0.96,
    holidayBound: root === "christmas",
    diagnostics: {
      taxonomyHit: true,
      artistHintMatched: null,
      patternMatched: "spotify_genre_metadata",
      audioFallbackUsed: false,
    },
  };
}

export function classifyTrack(
  track: {
    trackName: string;
    artistName: string;
    albumName: string;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
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
  const spotifyRoot = spotifyGenreRoot(track);
  if (spotifyRoot) {
    return classificationFromRoot(spotifyRoot);
  }

  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const hits: { taxon: GenreTaxon; score: number; micro: string | null }[] = [];

  // Per-taxon diagnostic: first text pattern and artist hint that fired
  const textDiag = new Map<GenreTaxon, { patternMatched: string | null; artistHintMatched: string | null }>();

  for (const taxon of TAXONOMY) {
    let score = 0;
    let micro: string | null = null;
    let patternSrc: string | null = null;
    let hintSrc: string | null = null;

    for (const p of taxon.patterns) {
      if (p.test(blob)) {
        score += 0.42;
        if (!patternSrc) patternSrc = p.source;
      }
    }
    for (const m of taxon.microStyles) {
      if (blob.toLowerCase().includes(m.toLowerCase())) {
        score += 0.34;
        micro = m;
        if (!patternSrc) patternSrc = m;
      }
    }
    if (taxon.artistHints?.test(blob)) {
      score += 0.52;
      hintSrc = taxon.artistHints.source;
    }
    if (score > 0) {
      hits.push({ taxon, score, micro });
      textDiag.set(taxon, { patternMatched: patternSrc, artistHintMatched: hintSrc });
    }
  }

  // Record how many text hits existed before audio heuristics
  const textHitCount = hits.length;

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

  const topTextDiag = textDiag.get(top.taxon);
  const taxonomyHit = textHitCount > 0;
  // audioFallbackUsed: winning taxon had no text component (came purely from audio heuristics or inferGenreFromAudioOnly)
  const audioFallbackUsed = !textDiag.has(top.taxon);

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
    diagnostics: {
      taxonomyHit,
      artistHintMatched: topTextDiag?.artistHintMatched ?? null,
      patternMatched: topTextDiag?.patternMatched ?? null,
      audioFallbackUsed,
    },
  };
}

function inferGenreFromAudioOnly(track: {
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  speechiness?: number | null;
}): TrackGenreClassification | null {
  const presentAudioFields = [
    track.energy,
    track.valence,
    track.acousticness,
    track.danceability,
    track.speechiness,
  ].filter((value) => typeof value === "number").length;
  if (presentAudioFields < 3) return null;

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
    // Extreme acousticness (>0.78) with no text/artist hits is more likely indie-folk
    // or singer-songwriter than country. Country pairs acoustic with higher valence/danceability.
    root = a > 0.78 ? "folk" : "country";
    sub = a > 0.78 ? "singer_songwriter" : "folk_country";
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
    diagnostics: {
      taxonomyHit: false,
      artistHintMatched: null,
      patternMatched: null,
      audioFallbackUsed: true,
    },
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
  const hasA = typeof track.acousticness === "number";
  const hasE = typeof track.energy === "number";
  const hasD = typeof track.danceability === "number";
  const hasSp = typeof track.speechiness === "number";
  const hasInst = typeof track.instrumentalness === "number";
  const hasV = typeof track.valence === "number";
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;
  const inst = track.instrumentalness ?? 0.1;

  const v = track.valence ?? 0.5;
  const sunnyAcoustic = hasV && hasA && hasE && v >= 0.58 && a > 0.45 && e >= 0.35 && e <= 0.78;

  if (hasA && hasE && hasD && a > 0.58 && e < 0.55 && d < 0.6) {
    if (sunnyAcoustic) {
      pushHit(hits, "indie", "indie_pop", 0.36, "bright acoustic indie");
      pushHit(hits, "folk", "singer_songwriter", 0.22, null);
    } else if (a > 0.76) {
      // Very high acousticness without sunny valence → singer-songwriter / folk, not country.
      // Country artists typically pair acoustic with higher danceability and valence.
      pushHit(hits, "folk", "singer_songwriter", 0.38, "deep acoustic folk");
      pushHit(hits, "indie", "indie_folk", 0.22, null);
      pushHit(hits, "country", "folk_country", 0.14, null);
    } else {
      pushHit(hits, "country", "folk_country", 0.38, "acoustic country lean");
      pushHit(hits, "folk", "singer_songwriter", 0.18, null);
    }
  }
  if (
    hasA &&
    hasE &&
    a > 0.52 &&
    a < 0.88 &&
    e >= 0.35 &&
    e <= 0.72 &&
    (!hasSp || sp < 0.28)
  ) {
    if (sunnyAcoustic) {
      pushHit(hits, "indie", "indie_folk", 0.3, "warm acoustic indie");
      pushHit(hits, "pop", "indie_pop", 0.18, null);
    } else {
      pushHit(hits, "country", "alt_country", 0.32, "storytelling acoustic");
      pushHit(hits, "country", "modern_country", 0.24, null);
    }
  }
  if (hasSp && hasE && sp > 0.38 && e > 0.42) pushHit(hits, "hip_hop", "trap", 0.34, null);
  if (hasD && hasE && d > 0.72 && e > 0.62) {
    pushHit(hits, "electronic", "house", 0.28, null);
    pushHit(hits, "pop", "dance_pop", 0.2, null);
  }
  if (hasE && hasA && e < 0.32 && a > 0.45) pushHit(hits, "jazz", "smooth_jazz", 0.22, null);
  if (hasInst && hasE && inst > 0.55 && e < 0.45) pushHit(hits, "electronic", "ambient", 0.25, null);
  if (hasE && hasV && e > 0.78 && v < 0.4) pushHit(hits, "metal", "metalcore", 0.28, null);
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
    diagnostics: p.diagnostics,
  };
}

export function listSubgenresForFamily(family: RootGenre): string[] {
  const def = GENRE_FAMILIES.find((f) => f.family === family);
  return def?.subgenres.map((s) => s.id) ?? [];
}
