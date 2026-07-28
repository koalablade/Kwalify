/**
 * Hard negation enforcement — explicit prompt exclusions (no christmas, no rap, no guitar).
 * Used at retrieval prefilter and Human Quality Gate.
 */

export type PromptNegationProfile = {
  suppressChristmas: boolean;
  suppressRap: boolean;
  suppressGuitar: boolean;
  suppressedTerms: string[];
};

const CHRISTMAS_NEGATION_RE =
  /\b(?:no|not|without|never|non[-\s]?)\s*(?:christmas|xmas|festive(?:\s+songs?)?|holiday\s+songs?)\b/i;

const WINTER_NO_CHRISTMAS_RE =
  /\b(?:winter|cold|snowy)\b.*\b(?:no|not|without)\s+christmas\b|\b(?:no|not|without)\s+christmas\b.*\b(?:winter|walk|evening|cozy)\b/i;

const RAP_NEGATION_RE =
  /\b(?:no|not|without)\s+(?:rap|hip[\s-]?hop|drill|grime|trap)\b|\bno\s+rap\b/i;

const GUITAR_NEGATION_RE = /\b(?:no|not|without)\s+guitar/i;

const CHRISTMAS_TRACK_RE =
  /\b(?:christmas|xmas|noel|santa|jingle|winter wonderland|silent night|holiday song|festive|yuletide|deck the halls|last christmas|all i want for christmas|wonderful christmastime|fairytale of new york|merry christmas|christmastime|rudolph|frosty|feliz navidad|baby it'?s cold outside|mistletoe|sleigh)\b/i;

const RAP_GENRE_RE =
  /\b(?:hip[\s-]?hop|rap|trap|drill|grime|uk\s*drill|gangsta|boom\s*bap)\b/i;

const RAP_ARTIST_HINT_RE =
  /\b(?:drake|kendrick|eminem|travis\s+scott|nicki\s+minaj|megan\s+thee|central\s+cee|stormzy|21\s+savage|lil\s+\w+|dmx|50\s+cent|jay-?z|kanye|playboi\s+carti)\b/i;

const GUITAR_GENRE_RE =
  /\b(?:rock|metal|punk|grunge|indie\s+rock|alt(?:ernative)?\s+rock|classic\s+rock|hard\s+rock|acoustic|folk|country|americana|blues\s+rock)\b/i;

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

  if (suppressChristmas) suppressedTerms.push("christmas");
  if (suppressRap) suppressedTerms.push("rap");
  if (suppressGuitar) suppressedTerms.push("guitar");

  return { suppressChristmas, suppressRap, suppressGuitar, suppressedTerms };
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
    if (
      RAP_GENRE_RE.test(blob) ||
      RAP_ARTIST_HINT_RE.test(blob) ||
      track.genreFamily === "hip_hop"
    ) {
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
