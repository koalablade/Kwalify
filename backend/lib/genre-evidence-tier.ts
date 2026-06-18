/**
 * Spotify metadata evidence tiering for subgenre confidence.
 */

export type GenreEvidenceTier = "exact_tag" | "artist_genre" | "album_genre" | "taxonomy" | "audio_fallback" | "none";

export type GenreEvidenceAssessment = {
  tier: GenreEvidenceTier;
  confidence: number;
  sources: string[];
};

export function assessGenreEvidenceTier(opts: {
  subgenreMatch?: boolean;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  taxonomyHit?: boolean;
  audioFallbackUsed?: boolean;
}): GenreEvidenceAssessment {
  const sources: string[] = [];
  if (opts.subgenreMatch) {
    sources.push("exact_subgenre");
    return { tier: "exact_tag", confidence: 0.92, sources };
  }
  const artistGenres = Array.isArray(opts.spotifyArtistGenres) ? opts.spotifyArtistGenres : [];
  const albumGenres = Array.isArray(opts.albumGenres) ? opts.albumGenres : [];
  if (artistGenres.length > 0) {
    sources.push("spotify_artist_genre");
    return { tier: "artist_genre", confidence: 0.78, sources };
  }
  if (albumGenres.length > 0) {
    sources.push("album_genre");
    return { tier: "album_genre", confidence: 0.68, sources };
  }
  if (opts.taxonomyHit) {
    sources.push("taxonomy");
    return { tier: "taxonomy", confidence: 0.62, sources };
  }
  if (opts.audioFallbackUsed) {
    sources.push("audio_fallback");
    return { tier: "audio_fallback", confidence: 0.42, sources };
  }
  return { tier: "none", confidence: 0.15, sources };
}
