export type HumanPlaylistBenchmark = {
  expectedGenres: string[];
  expectedMoodArc: string;
  expectedEraDistribution: string;
  deviationScore: number;
  biggestDeviations: string[];
};

export type BenchmarkTrack = {
  trackId?: string;
  trackName?: string;
  artistName?: string;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
};

type PromptExpectation = {
  genres: string[];
  moods: string[];
  moodArc: string[];
  era: { label: string; start: number | null; end: number | null };
};

const GENRE_HINTS: Array<{ terms: RegExp; genres: string[] }> = [
  { terms: /\b(?:indie|alternative|alt)\b/i, genres: ["indie", "alternative", "rock"] },
  { terms: /\b(?:electronic|ambient|synth|synthwave|techno|house|dance)\b/i, genres: ["electronic", "ambient"] },
  { terms: /\b(?:hip\s*hop|rap|grime|trap)\b/i, genres: ["hip_hop", "rap"] },
  { terms: /\b(?:post-?rock|cinematic|soundtrack|score)\b/i, genres: ["post_rock", "ambient", "soundtrack"] },
  { terms: /\b(?:folk|acoustic|americana)\b/i, genres: ["folk", "americana"] },
  { terms: /\b(?:dream\s*pop|shoegaze)\b/i, genres: ["dream_pop", "shoegaze", "indie"] },
  { terms: /\b(?:blues)\b/i, genres: ["blues", "rock"] },
  { terms: /\b(?:rock)\b/i, genres: ["rock", "alternative"] },
  { terms: /\b(?:world|global|around the world|international)\b/i, genres: ["world", "folk", "latin", "afrobeat"] },
  { terms: /\b(?:coffee|coding|focus|study|minimal vocals|minimal)\b/i, genres: ["ambient", "electronic", "post_rock"] },
  { terms: /\b(?:gym|workout|intensity|high energy)\b/i, genres: ["electronic", "hip_hop", "dance"] },
];

const MOOD_HINTS: Array<{ terms: RegExp; moods: string[] }> = [
  { terms: /\b(?:sad|grief|heartbreak|getting over|move on|faded|lonely)\b/i, moods: ["sad", "reflective"] },
  { terms: /\b(?:hopeful|optimistic|relief|confidence|confident|momentum|rebuilding)\b/i, moods: ["hopeful", "confident"] },
  { terms: /\b(?:nostalgic|hometown|photographs|attic|family|bittersweet)\b/i, moods: ["nostalgic", "bittersweet"] },
  { terms: /\b(?:burnout|frustration|exhausted|uncertain|setback)\b/i, moods: ["tense", "exhausted"] },
  { terms: /\b(?:calm|focus|coding|ambient|minimal)\b/i, moods: ["calm", "focused"] },
  { terms: /\b(?:gym|workout|motivation|determination|intensity)\b/i, moods: ["energised", "determined"] },
  { terms: /\b(?:2am|night|late night|london|road movie)\b/i, moods: ["nocturnal", "cinematic"] },
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedGenreTerms(track: BenchmarkTrack): string[] {
  return unique([
    track.genrePrimary ?? "",
    track.genreFamily ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].map((value) => value.toLowerCase().replace(/[\s-]+/g, "_")));
}

function promptExpectation(prompt: string): PromptExpectation {
  const genres = unique(GENRE_HINTS.flatMap((hint) => hint.terms.test(prompt) ? hint.genres : []));
  const moods = unique(MOOD_HINTS.flatMap((hint) => hint.terms.test(prompt) ? hint.moods : []));
  const lower = prompt.toLowerCase();
  const moodArc =
    /\b(?:starts?|begin).*\b(?:ends?|end)\b|\bgradually\b|\btransition\b|\brebuilding\b|\bmove through\b/.test(lower)
      ? ["low", "reflective", "hopeful"]
      : /\b(?:sad and hopeful|both sad and hopeful|bittersweet)\b/.test(lower)
        ? ["bittersweet", "bittersweet", "hopeful"]
        : /\b(?:gym|workout|build intensity)\b/.test(lower)
          ? ["energised", "intense", "peak"]
          : /\b(?:focus|coding|ambient|minimal)\b/.test(lower)
            ? ["calm", "steady", "calm"]
            : ["coherent", "coherent", "coherent"];
  const era =
    /\b1990s|\b90s\b/.test(lower)
      ? { label: "mostly 1990s with nearby era support", start: 1988, end: 2002 }
      : /\b1980s|\b80s\b/.test(lower)
        ? { label: "1980s-inspired or adjacent modern reinterpretations", start: 1980, end: null }
        : /\bmodern\b/.test(lower)
          ? { label: "mostly modern", start: 2008, end: null }
          : { label: "era-flexible if mood and genre stay intentional", start: null, end: null };
  return { genres, moods, moodArc, era };
}

function genreHitRate(tracks: BenchmarkTrack[], expectedGenres: string[]): number {
  if (tracks.length === 0 || expectedGenres.length === 0) return 1;
  const expected = expectedGenres.map((genre) => genre.toLowerCase().replace(/[\s-]+/g, "_"));
  const hits = tracks.filter((track) => {
    const terms = normalizedGenreTerms(track);
    return terms.some((term) => expected.some((genre) => term.includes(genre) || genre.includes(term)));
  }).length;
  return hits / tracks.length;
}

function eraHitRate(tracks: BenchmarkTrack[], era: PromptExpectation["era"]): number {
  if (era.start === null && era.end === null) return 1;
  const known = tracks.filter((track) => typeof track.releaseYear === "number");
  if (known.length === 0) return 0.65;
  const hits = known.filter((track) => {
    const year = track.releaseYear!;
    return (era.start === null || year >= era.start) && (era.end === null || year <= era.end);
  }).length;
  return hits / known.length;
}

function arcDescription(arc: string[]): string {
  return arc.join(" -> ");
}

export function estimateHumanPlaylistBenchmark(
  prompt: string,
  tracks: BenchmarkTrack[]
): HumanPlaylistBenchmark {
  const expected = promptExpectation(prompt);
  const genreRate = genreHitRate(tracks, expected.genres);
  const eraRate = eraHitRate(tracks, expected.era);
  const knownYears = tracks
    .map((track) => track.releaseYear)
    .filter((year): year is number => typeof year === "number" && Number.isFinite(year));
  const eraSpan = knownYears.length ? Math.max(...knownYears) - Math.min(...knownYears) : 0;
  const wildEraMix = expected.era.start === null && eraSpan > 35;
  const deviationScore = Math.round(Math.max(0, Math.min(100, 100 - ((1 - genreRate) * 45 + (1 - eraRate) * 30 + (wildEraMix ? 18 : 0)))));
  const biggestDeviations = [
    expected.genres.length > 0 && genreRate < 0.6 ? "Expected genre universe is weakly represented." : null,
    eraRate < 0.6 ? "Era distribution does not match the prompt expectation." : null,
    wildEraMix ? "Era spread is very wide without an obvious prompt reason." : null,
    tracks.length > 0 && new Set(tracks.map((track) => (track.artistName ?? "").toLowerCase()).filter(Boolean)).size < Math.ceil(tracks.length * 0.55)
      ? "Artist variety is lower than a human editor would usually choose."
      : null,
  ].filter((value): value is string => !!value);

  return {
    expectedGenres: expected.genres,
    expectedMoodArc: arcDescription(expected.moodArc),
    expectedEraDistribution: expected.era.label,
    deviationScore,
    biggestDeviations,
  };
}
