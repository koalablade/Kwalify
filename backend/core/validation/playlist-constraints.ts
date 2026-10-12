export type PlaylistConstraintTrack = {
  trackId?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
};

export type PlaylistConstraintReport = {
  passed: boolean;
  expectedCount: number;
  minimumCount: number;
  actualCount: number;
  completenessScore: number;
  minimumViable: boolean;
  repaired: boolean;
  failureReasons: string[];
  completionDiagnostics: {
    missingTracks: number;
    underfilled: boolean;
    belowMinimumViable: boolean;
    genreEvidenceEmpty: boolean;
    singleGenreDominance: boolean;
    likelyReason: string | null;
  };
};

export type PlaylistConstraintOptions = {
  prompt: string;
  requestedTrackCount: number;
  expectedTrackCount?: {
    min?: number;
    target?: number;
  };
  repaired?: boolean;
};

const MINIMUM_VIABLE_TRACKS = 8;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function explicitPromptTrackTarget(prompt: string): number | null {
  const match = prompt.match(/\b(\d{1,2})\s*(?:track|tracks|song|songs)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function allowsSingleGenre(prompt: string): boolean {
  return /\b(?:only|pure|strict|all|exclusively|just)\b.{0,24}\b(?:genre|rock|pop|country|metal|ambient|classical|jazz|rap|hip\s*hop|folk|techno|house|punk|blues)\b/i.test(prompt) ||
    /\b(?:single\s+genre|one\s+genre|genre-locked|genre locked)\b/i.test(prompt);
}

function genreTerms(track: PlaylistConstraintTrack): string[] {
  return [
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase().trim());
}

export function validatePlaylistConstraints(
  tracks: PlaylistConstraintTrack[],
  opts: PlaylistConstraintOptions
): PlaylistConstraintReport {
  const explicitTarget = explicitPromptTrackTarget(opts.prompt);
  const expectedCount = explicitTarget ?? opts.expectedTrackCount?.target ?? opts.requestedTrackCount;
  const minimumCount = Math.max(
    MINIMUM_VIABLE_TRACKS,
    opts.expectedTrackCount?.min ?? expectedCount
  );
  const actualCount = tracks.length;
  const completenessScore = round2(clamp01(actualCount / Math.max(1, expectedCount)));
  const failureReasons: string[] = [];
  if (actualCount < expectedCount) failureReasons.push("missing_track_count");
  if (actualCount < minimumCount) failureReasons.push("below_expected_minimum");
  if (actualCount < MINIMUM_VIABLE_TRACKS) failureReasons.push("below_minimum_viable_playlist");

  const allGenreTerms = tracks.flatMap(genreTerms);
  const genreEvidenceEmpty = tracks.length > 0 && allGenreTerms.length === 0;
  if (genreEvidenceEmpty) failureReasons.push("missing_genre_evidence");
  const dominantGenreCount = allGenreTerms.length
    ? Math.max(...[...new Set(allGenreTerms)].map((genre) => allGenreTerms.filter((value) => value === genre).length))
    : 0;
  const singleGenreDominance = tracks.length >= MINIMUM_VIABLE_TRACKS &&
    allGenreTerms.length > 0 &&
    dominantGenreCount / allGenreTerms.length > 0.92 &&
    !allowsSingleGenre(opts.prompt);
  if (singleGenreDominance) failureReasons.push("single_genre_dominance");

  const underfilled = actualCount < expectedCount;
  const belowMinimumViable = actualCount < MINIMUM_VIABLE_TRACKS;
  const likelyReason =
    belowMinimumViable ? "final output below minimum viable playlist size" :
    underfilled ? "generation returned fewer tracks than requested" :
    genreEvidenceEmpty ? "final tracks lack genre metadata" :
    singleGenreDominance ? "genre diversity sanity check flagged over-concentration" :
    null;

  return {
    passed: failureReasons.length === 0,
    expectedCount,
    minimumCount,
    actualCount,
    completenessScore,
    minimumViable: actualCount >= MINIMUM_VIABLE_TRACKS,
    repaired: !!opts.repaired,
    failureReasons,
    completionDiagnostics: {
      missingTracks: Math.max(0, expectedCount - actualCount),
      underfilled,
      belowMinimumViable,
      genreEvidenceEmpty,
      singleGenreDominance,
      likelyReason,
    },
  };
}
