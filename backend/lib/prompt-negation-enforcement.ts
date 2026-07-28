/**
 * Hard negation enforcement — explicit prompt exclusions (no christmas, no rap, no guitar).
 * Used at retrieval prefilter and Human Quality Gate.
 */

export type PromptNegationProfile = {
  suppressChristmas: boolean;
  suppressRap: boolean;
  suppressGuitar: boolean;
  suppressAcoustic: boolean;
  suppressSad: boolean;
  suppressedTerms: string[];
};

const CHRISTMAS_NEGATION_RE =
  /\b(?:no|not|without|never|non[-\s]?)\s*(?:christmas|xmas|festive(?:\s+songs?)?|holiday\s+songs?)\b/i;

const WINTER_NO_CHRISTMAS_RE =
  /\b(?:winter|cold|snowy)\b.*\b(?:no|not|without)\s+christmas\b|\b(?:no|not|without)\s+christmas\b.*\b(?:winter|walk|evening|cozy)\b/i;

const RAP_NEGATION_RE =
  /\b(?:no|not|without)\s+(?:rap|hip[\s-]?hop|drill|grime|trap)\b|\bno\s+rap\b/i;

const GUITAR_NEGATION_RE = /\b(?:no|not|without)\s+guitar/i;

const ACOUSTIC_NEGATION_RE = /\b(?:no|not|without)\s+acoustic/i;

const SAD_NEGATION_RE = /\b(?:no|not|without)\s+sad(?:\s+songs?)?\b/i;

const CHRISTMAS_TRACK_RE =
  /\b(?:christmas|xmas|noel|santa|jingle|winter wonderland|silent night|holiday song|festive|yuletide|deck the halls|last christmas|all i want for christmas|wonderful christmastime|fairytale of new york|merry christmas|christmastime|rudolph|frosty|feliz navidad|baby it'?s cold outside|mistletoe|sleigh)\b/i;

const RAP_GENRE_RE =
  /\b(?:hip[\s-]?hop|rap|trap|drill|grime|uk\s*drill|gangsta|boom\s*bap)\b/i;

const RAP_ARTIST_HINT_RE =
  /\b(?:drake|kendrick|eminem|travis\s+scott|nicki\s+minaj|megan\s+thee|central\s+cee|stormzy|21\s+savage|lil\s+\w+|dmx|50\s+cent|jay-?z|kanye|playboi\s+carti|storm\s+queen)\b/i;

/** Rock/metal aggression is OK when user said "no rap" — only suppress hip-hop artists. */
const NO_RAP_ROCK_METAL_ALLOW_RE =
  /\b(?:ac\/?dc|metallica|foo\s+fighters|slipknot|bmth|bring\s+me\s+the\s+horizon|prodigy|guns\s+n|slayer|megadeth|black\s+sabbath|disturbed|godsmack|rage\s+against)\b/i;

const GUITAR_GENRE_RE =
  /\b(?:rock|metal|punk|grunge|indie\s+rock|alt(?:ernative)?\s+rock|classic\s+rock|hard\s+rock|acoustic|folk|country|americana|blues\s+rock)\b/i;

const ACOUSTIC_SIGNAL_RE =
  /\b(?:acoustic|unplugged|singer[-\s]?songwriter|folk\b|americana|indie\s+folk)\b/i;

const SAD_SIGNAL_RE =
  /\b(?:sad|ballad|slowcore|sadcore|melanchol|heartbreak|tearjerker|weepy|miserable)\b/i;

function trackTextBlob(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
}): string {
  const parts = [
    track.trackName ?? "",
    track.artistName ?? "",
    track.albumName ?? "",
    track.genreFamily ?? "",
    track.genrePrimary ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ];
  if (Array.isArray(track.spotifyArtistGenres)) {
    parts.push(...track.spotifyArtistGenres.filter((g): g is string => typeof g === "string"));
  }
  return parts.join(" ").toLowerCase();
}

/** Parse hard suppress rules from raw prompt text. */
export function parsePromptNegationEnforcement(prompt: string): PromptNegationProfile {
  const suppressedTerms: string[] = [];
  const suppressChristmas =
    CHRISTMAS_NEGATION_RE.test(prompt) || WINTER_NO_CHRISTMAS_RE.test(prompt);
  const suppressRap = RAP_NEGATION_RE.test(prompt);
  const suppressGuitar = GUITAR_NEGATION_RE.test(prompt);
  const suppressAcoustic = ACOUSTIC_NEGATION_RE.test(prompt);
  const suppressSad = SAD_NEGATION_RE.test(prompt);

  if (suppressChristmas) suppressedTerms.push("christmas");
  if (suppressRap) suppressedTerms.push("rap");
  if (suppressGuitar) suppressedTerms.push("guitar");
  if (suppressAcoustic) suppressedTerms.push("acoustic");
  if (suppressSad) suppressedTerms.push("sad");

  return { suppressChristmas, suppressRap, suppressGuitar, suppressAcoustic, suppressSad, suppressedTerms };
}

/** Returns violation reason or null when track is admissible. */
export function trackViolatesPromptNegation(
  track: {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    acousticness?: number | null;
    instrumentalness?: number | null;
  },
  profile: PromptNegationProfile,
): string | null {
  if (profile.suppressedTerms.length === 0) return null;
  const blob = trackTextBlob(track);
  const titleAlbum = `${track.trackName ?? ""} ${track.albumName ?? ""}`.toLowerCase();

  if (profile.suppressChristmas) {
    if (track.genreFamily === "christmas" || CHRISTMAS_TRACK_RE.test(blob) || CHRISTMAS_TRACK_RE.test(titleAlbum)) {
      return "negation:christmas";
    }
  }

  if (profile.suppressRap) {
    const artist = String(track.artistName ?? "").trim().toLowerCase();
    if (artist && NO_RAP_ROCK_METAL_ALLOW_RE.test(artist)) return null;
    if (track.genreFamily === "hip_hop") return "negation:rap";
    if (artist && RAP_ARTIST_HINT_RE.test(artist)) return "negation:rap";
    if (RAP_GENRE_RE.test(blob) && !/\b(?:rock|metal|hard\s+rock|heavy\s+metal|thrash|electronic|techno|house)\b/i.test(blob)) {
      return "negation:rap";
    }
  }

  if (profile.suppressGuitar) {
    const acoustic =
      typeof track.acousticness === "number" && Number.isFinite(track.acousticness)
        ? track.acousticness
        : null;
    const instrumental =
      typeof track.instrumentalness === "number" && Number.isFinite(track.instrumentalness)
        ? track.instrumentalness
        : null;
    const likelyGuitar =
      GUITAR_GENRE_RE.test(blob) ||
      (acoustic != null && acoustic > 0.42 && (instrumental == null || instrumental < 0.55));
    const electronicOk =
      /\b(?:electronic|ambient|techno|house|idm|downtempo|synth|electropop|electronica)\b/i.test(blob);
    if (likelyGuitar && !electronicOk) {
      return "negation:guitar";
    }
  }

  if (profile.suppressAcoustic) {
    const acousticness =
      typeof track.acousticness === "number" && Number.isFinite(track.acousticness)
        ? track.acousticness
        : null;
    if (ACOUSTIC_SIGNAL_RE.test(blob) || (acousticness != null && acousticness > 0.62)) {
      return "negation:acoustic";
    }
  }

  if (profile.suppressSad) {
    if (SAD_SIGNAL_RE.test(blob) || SAD_SIGNAL_RE.test(titleAlbum)) {
      return "negation:sad";
    }
  }

  return null;
}

/** Count opener-slot negation violations (slots 1–3). */
export function countOpenerNegationViolations<
  T extends {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    acousticness?: number | null;
    instrumentalness?: number | null;
  },
>(tracks: T[], profile: PromptNegationProfile, openerSlots = 3): number {
  if (profile.suppressedTerms.length === 0) return 0;
  let count = 0;
  for (const track of tracks.slice(0, openerSlots)) {
    if (trackViolatesPromptNegation(track, profile)) count += 1;
  }
  return count;
}

/** Count negation violations across the full delivered playlist. */
export function countAllNegationViolations<
  T extends {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    acousticness?: number | null;
    instrumentalness?: number | null;
  },
>(tracks: T[], profile: PromptNegationProfile): number {
  if (profile.suppressedTerms.length === 0) return 0;
  let count = 0;
  for (const track of tracks) {
    if (trackViolatesPromptNegation(track, profile)) count += 1;
  }
  return count;
}

/** Final delivery pass — remove any track that violates explicit negations. */
export function filterTracksForDeliveryNegation<
  T extends {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    genres?: string[] | null;
    spotifyArtistGenres?: unknown;
    acousticness?: number | null;
    instrumentalness?: number | null;
  },
>(tracks: T[], profile: PromptNegationProfile): { tracks: T[]; removed: number } {
  if (profile.suppressedTerms.length === 0) return { tracks, removed: 0 };
  const kept: T[] = [];
  let removed = 0;
  for (const track of tracks) {
    if (trackViolatesPromptNegation(track, profile)) {
      removed += 1;
      continue;
    }
    kept.push(track);
  }
  return { tracks: kept, removed };
}
