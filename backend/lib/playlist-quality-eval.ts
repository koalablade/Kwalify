export type PlaylistEvalPrompt = {
  id: string;
  prompt: string;
  expectedGenres?: string[];
  expectedEra?: { start: number; end: number };
  expectedMood?: string[];
  minGenrePurity: number;
  minPromptAlignment: number;
  minMoodFit?: number;
};

export type PlaylistEvalTrack = {
  trackId?: string;
  id?: string;
  genrePrimary?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  whyReasons?: string[] | null;
  moodTags?: string[] | null;
};

export const PLAYLIST_EVAL_PROMPTS: PlaylistEvalPrompt[] = [
  {
    id: "country-red-dirt",
    prompt: "american country cowboy red dirt",
    expectedGenres: ["country", "red dirt", "americana"],
    expectedMood: ["cowboy", "american"],
    minGenrePurity: 0.85,
    minPromptAlignment: 0.80,
    minMoodFit: 0.50,
  },
  {
    id: "misspelled-americana-red-dirt",
    prompt: "americarna red-dirt cowboy county",
    expectedGenres: ["country", "red dirt", "americana"],
    expectedMood: ["cowboy", "american"],
    minGenrePurity: 0.85,
    minPromptAlignment: 0.80,
    minMoodFit: 0.50,
  },
  {
    id: "uk-freshers-pres",
    prompt: "freshers pre drinks ukg grime buzzing night out",
    expectedGenres: ["uk garage", "garage", "grime", "rap", "electronic"],
    expectedMood: ["party", "high energy", "night"],
    minGenrePurity: 0.60,
    minPromptAlignment: 0.68,
    minMoodFit: 0.58,
  },
  {
    id: "british-event-place-era",
    prompt: "naughties manchster bank holiday pub sesh",
    expectedGenres: ["britpop", "indie", "rock", "garage", "pop"],
    expectedEra: { start: 2000, end: 2009 },
    expectedMood: ["party", "nostalgic", "city"],
    minGenrePurity: 0.50,
    minPromptAlignment: 0.64,
    minMoodFit: 0.52,
  },
  {
    id: "rainy-90s-indie",
    prompt: "90s rainy night sad indie",
    expectedGenres: ["indie", "alternative"],
    expectedEra: { start: 1988, end: 2002 },
    expectedMood: ["sad", "rainy", "night"],
    minGenrePurity: 0.58,
    minPromptAlignment: 0.68,
    minMoodFit: 0.60,
  },
  {
    id: "late-night-uk-garage",
    prompt: "late night uk garage drive",
    expectedGenres: ["garage", "uk garage", "electronic", "dance"],
    expectedMood: ["late night", "drive"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
    minMoodFit: 0.58,
  },
  {
    id: "90s-rnb-slow-jams",
    prompt: "90s r&b slow jams late night",
    expectedGenres: ["rnb", "r&b", "soul", "quiet storm"],
    expectedEra: { start: 1988, end: 2004 },
    expectedMood: ["late night", "soft", "romantic"],
    minGenrePurity: 0.66,
    minPromptAlignment: 0.72,
    minMoodFit: 0.55,
  },
  {
    id: "70s-disco-party",
    prompt: "70s disco party dancefloor",
    expectedGenres: ["disco", "soul", "funk", "dance", "pop"],
    expectedEra: { start: 1970, end: 1982 },
    expectedMood: ["party", "high energy", "happy"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
    minMoodFit: 0.58,
  },
  {
    id: "pop-punk-gym",
    prompt: "2000s pop punk gym",
    expectedGenres: ["pop punk", "punk", "rock"],
    expectedEra: { start: 1998, end: 2012 },
    expectedMood: ["gym", "high energy"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
    minMoodFit: 0.58,
  },
  {
    id: "ambient-focus-morning",
    prompt: "calm ambient morning focus coding",
    expectedGenres: ["ambient", "electronic", "classical", "instrumental"],
    expectedMood: ["calm", "low energy"],
    minGenrePurity: 0.55,
    minPromptAlignment: 0.66,
    minMoodFit: 0.62,
  },
  {
    id: "latin-summer-beach",
    prompt: "latin summer beach party",
    expectedGenres: ["latin", "reggaeton", "salsa", "bachata", "tropical"],
    expectedMood: ["party", "happy", "high energy"],
    minGenrePurity: 0.62,
    minPromptAlignment: 0.70,
    minMoodFit: 0.58,
  },
  {
    id: "volvo-garage",
    prompt: "music for working on my volvo in the garage late at night rainy sunday",
    expectedGenres: ["blues", "indie", "rock", "folk", "country"],
    expectedMood: ["solitary", "rainy", "calm", "low energy"],
    minGenrePurity: 0.55,
    minPromptAlignment: 0.62,
    minMoodFit: 0.50,
  },
  {
    id: "kerrang-alt",
    prompt: "kerrang era alt rock and emo from my teenage years",
    expectedGenres: ["rock", "metal", "indie", "punk", "emo"],
    expectedMood: ["nostalgic", "aggressive", "high energy"],
    minGenrePurity: 0.58,
    minPromptAlignment: 0.65,
    minMoodFit: 0.52,
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

function trackMoodTerms(track: PlaylistEvalTrack): string[] {
  return lowerTerms([
    ...(Array.isArray(track.whyReasons) ? track.whyReasons : []),
    ...(Array.isArray(track.moodTags) ? track.moodTags : []),
    typeof track.energy === "number" && track.energy >= 0.68 ? "high energy" : null,
    typeof track.energy === "number" && track.energy <= 0.38 ? "low energy" : null,
    typeof track.valence === "number" && track.valence <= 0.38 ? "sad" : null,
    typeof track.valence === "number" && track.valence >= 0.65 ? "happy" : null,
  ]);
}

export function auditPlaylistAgainstPrompt(
  prompt: PlaylistEvalPrompt,
  tracks: PlaylistEvalTrack[],
): Record<string, unknown> {
  if (tracks.length === 0) {
    return { pass: false, genrePurity: 0, eraFit: 0, moodFit: 0, promptAlignment: 0, noObviousDrift: false, violations: ["empty_playlist"] };
  }
  const expectedGenres = lowerTerms(prompt.expectedGenres ?? []);
  const genreMetadataPresent = tracks.filter((track) => trackGenreTerms(track).length > 0).length / tracks.length;
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
  const expectedMood = lowerTerms(prompt.expectedMood ?? []);
  const moodFit = expectedMood.length === 0
    ? 1
    : tracks.filter((track) => {
        const terms = trackMoodTerms(track);
        return terms.some((term) => expectedMood.some((expected) => term.includes(expected) || expected.includes(term)));
      }).length / tracks.length;
  const promptAlignment = Math.round(((genrePurity * 0.55) + (eraFit * 0.20) + (moodFit * 0.25)) * 1000) / 1000;
  const noObviousDrift = genrePurity >= Math.max(0.45, prompt.minGenrePurity - 0.15) &&
    moodFit >= (prompt.minMoodFit ?? 0.45) - 0.15 &&
    (!prompt.expectedEra || eraFit >= 0.35) &&
    genreMetadataPresent >= 0.85;
  const violations = [
    genreMetadataPresent < 0.85 ? "genre_metadata_missing" : null,
    genrePurity < prompt.minGenrePurity ? "genre_purity_below_eval_threshold" : null,
    moodFit < (prompt.minMoodFit ?? 0.45) ? "mood_fit_below_eval_threshold" : null,
    promptAlignment < prompt.minPromptAlignment ? "prompt_alignment_below_eval_threshold" : null,
    prompt.expectedEra && eraFit < 0.45 ? "era_fit_below_eval_threshold" : null,
    !noObviousDrift ? "obvious_prompt_drift" : null,
  ].filter((value): value is string => !!value);
  return {
    pass: violations.length === 0,
    promptId: prompt.id,
    genreMetadataPresent: Math.round(genreMetadataPresent * 1000) / 1000,
    genrePurity: Math.round(genrePurity * 1000) / 1000,
    eraFit: Math.round(eraFit * 1000) / 1000,
    moodFit: Math.round(moodFit * 1000) / 1000,
    promptAlignment,
    noObviousDrift,
    violations,
  };
}
