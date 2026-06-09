export type PlaylistEvalPrompt = {
  id: string;
  prompt: string;
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  expectedMood?: string[];
  minGenrePurity: number;
  minPromptAlignment: number;
};

export type PlaylistEvalTrack = {
  trackId?: string;
  id?: string;
  genrePrimary?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
};

export const PLAYLIST_EVAL_PROMPTS: PlaylistEvalPrompt[] = [
  {
    id: "country-red-dirt",
    prompt: "american country cowboy red dirt",
    expectedGenres: ["country", "red dirt", "americana"],
    minGenrePurity: 0.70,
    minPromptAlignment: 0.72,
  },
  {
    id: "rainy-90s-indie",
    prompt: "90s rainy night sad indie",
    expectedGenres: ["indie", "alternative"],
    expectedEra: { start: 1988, end: 2002 },
    expectedMood: ["sad", "rainy", "night"],
    minGenrePurity: 0.58,
    minPromptAlignment: 0.68,
  },
  {
    id: "late-night-uk-garage",
    prompt: "late night uk garage drive",
    expectedGenres: ["garage", "uk garage", "electronic", "dance"],
    expectedMood: ["late night", "drive"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
  },
  {
    id: "pop-punk-gym",
    prompt: "2000s pop punk gym",
    expectedGenres: ["pop punk", "punk", "rock"],
    expectedEra: { start: 1998, end: 2012 },
    expectedMood: ["gym", "high energy"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
  },
];

function lowerTerms(values: Array<string | null | undefined>): string[] {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
}

function trackGenreTerms(track: PlaylistEvalTrack): string[] {
  return lowerTerms([
    track.genrePrimary,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]);
}

export function auditPlaylistAgainstPrompt(
  prompt: PlaylistEvalPrompt,
  tracks: PlaylistEvalTrack[],
): Record<string, unknown> {
  if (tracks.length === 0) {
    return { pass: false, genrePurity: 0, eraFit: 0, promptAlignment: 0, violations: ["empty_playlist"] };
  }
  const expectedGenres = lowerTerms(prompt.expectedGenres ?? []);
  const genreHits = expectedGenres.length === 0
    ? tracks.length
    : tracks.filter((track) => trackGenreTerms(track).some((genre) =>
        expectedGenres.some((expected) => genre.includes(expected) || expected.includes(genre))
      )).length;
  const genrePurity = genreHits / tracks.length;
  const eraFit = prompt.expectedEra
    ? tracks.filter((track) =>
        typeof track.releaseYear === "number" &&
        track.releaseYear >= prompt.expectedEra!.start &&
        track.releaseYear <= prompt.expectedEra!.end
      ).length / tracks.length
    : 1;
  const promptAlignment = Math.round(((genrePurity * 0.70) + (eraFit * 0.30)) * 1000) / 1000;
  const violations = [
    genrePurity < prompt.minGenrePurity ? "genre_purity_below_eval_threshold" : null,
    promptAlignment < prompt.minPromptAlignment ? "prompt_alignment_below_eval_threshold" : null,
    prompt.expectedEra && eraFit < 0.45 ? "era_fit_below_eval_threshold" : null,
  ].filter((value): value is string => !!value);
  return {
    pass: violations.length === 0,
    promptId: prompt.id,
    genrePurity: Math.round(genrePurity * 1000) / 1000,
    eraFit: Math.round(eraFit * 1000) / 1000,
    promptAlignment,
    violations,
  };
}
